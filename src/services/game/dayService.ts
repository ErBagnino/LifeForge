import { DEFAULT_CARDIO_STAGES } from '@/data/cardio';
import { computeDifficultyState, sideQuestBudget } from '@/domain/adaptive';
import { type RampLimits, rampLimits } from '@/domain/capacity';
import { applyWorkToPlan, gymBlocked, resolveWork } from '@/domain/schedule';
import { countersForDayClose, C } from '@/domain/counters';
import { closeDay as closeDayDomain, weeklyStreakTarget } from '@/domain/dayClose';
import { startingEnergy } from '@/domain/energy';
import { learnTimes } from '@/domain/habits';
import { FEATURE_LEVELS } from '@/domain/level';
import { daysLeftInWeek, isDueOn } from '@/domain/recurrence';
import { applyWeekToStreak } from '@/domain/streak';
import { evaluateRules } from '@/domain/rulesEngine';
import {
  activityRepository,
  aggregateMetrics,
  metaRepository,
  questRepository,
  routineRepository,
  settingsRepository,
  statsRepository,
  withTransaction,
  workoutRepository,
} from '@/repositories';
import type { Activity, DayLog, DayPlan, DayType, ISODate, Quest, Settings } from '@/types';
import { dateRange, daysBetween, hmToMinutes, isWeekend, minutesToHm, shiftDate, weekday, weekKey, weekStart } from '@/utils/date';
import { clock } from '../clock';
import type { ServiceResult } from '../events';
import { planFor, trainingAvailable } from './dayPlan';
import { emptyLog, GameTx } from './gameTx';
import { generateChallenge, generateHidden, generateLongQuests, generateSideQuestsFor, templateContext } from './generation';
import { type FactoryContext, firstQuest, questFromActivity, workoutQuest } from './questFactory';
import { applyCompletion, loadDay, runRules, settleDay } from './questService';
import { refreshLog, scoreDay } from './scoring';
import { adventureDay, applyDecisions, capacityHistory, computeDayLoad } from './load';

const MAX_GAP_DAYS = 45;
let rolloverLock: Promise<ServiceResult> | null = null;

/** Make sure today exists: close any past days, then start today. Safe to call repeatedly. */
export function ensureToday(): Promise<ServiceResult> {
  rolloverLock ??= doEnsureToday().finally(() => {
    rolloverLock = null;
  });
  return rolloverLock;
}

async function doEnsureToday(): Promise<ServiceResult> {
  const today = clock.today();
  const current = await metaRepository.get<string>('currentDate');
  const events: ServiceResult['events'] = [];
  if (current === today) return { events };
  if (current && current < today) {
    const gap = dateRange(current, shiftDate(today, -1));
    const days = gap.slice(-MAX_GAP_DAYS);
    for (const date of days) {
      const r = await closeDay(date);
      if (date === days[days.length - 1]) events.push(...r.events);
    }
  }
  if (!current || current < today) {
    const r = await startDay(today);
    events.push(...r.events);
    await metaRepository.set('currentDate', today);
  }
  return { events };
}

async function learnedWorkoutTime(date: ISODate): Promise<number | undefined> {
  const recent = await questRepository.byRange(shiftDate(date, -60), shiftDate(date, -1));
  const samples = recent
    .filter((q) => q.kind === 'workout' && q.status === 'completed' && q.completedAt)
    .map((q) => ({ activityId: 'workout', minute: hmToMinutes(q.actualTime ?? minutesToHm(new Date(q.completedAt!).getHours() * 60)), weekend: isWeekend(q.date) }));
  const learned = learnTimes(samples)[0];
  if (!learned) return undefined;
  return (isWeekend(date) ? learned.weekendMedian : learned.weekdayMedian) ?? learned.median;
}

function defaultWorkoutTime(plan: DayPlan): string {
  if (plan.dayType === 'work' && plan.work) return minutesToHm(hmToMinutes(plan.work.end) + 30);
  if (plan.workEnd) return minutesToHm(hmToMinutes(plan.workEnd) + 30);
  // Unknown or open-ended work: suggest early evening, the player can move it.
  if (plan.workStatus === 'unknown' || plan.workStatus === 'partial') return '18:30';
  return '11:00';
}

/** Rank core quests for the first days: the player's own goals first, then quick, important ones. */
function rampScore(q: Quest, activities: Activity[]): number {
  const a = activities.find((x) => x.id === q.activityId);
  const goal = a?.tags?.includes('nofap') || q.metric === 'leisure' ? 100 : 0;
  return goal + (a?.importance ?? 3) * 10 + (q.durationMin <= 5 ? 8 : 0) - q.durationMin / 5;
}

/** Trim a new board to the first-week limits (quests are simply not created yet). */
export function applyRamp(created: Quest[], ramp: RampLimits, activities: Activity[], dayIndex: number, existing: Quest[] = []): void {
  const keep = new Set<string>();
  const byScore = (list: Quest[]) => [...list].sort((a, b) => rampScore(b, activities) - rampScore(a, activities));
  const had = (tier: Quest['tier']) => existing.filter((q) => q.kind === 'scheduled' && (q.baseTier ?? q.tier) === tier).length;
  byScore(created.filter((q) => q.kind === 'scheduled' && q.tier === 'core')).slice(0, Math.max(0, ramp.core - had('core'))).forEach((q) => keep.add(q.id));
  byScore(created.filter((q) => q.kind === 'scheduled' && q.tier === 'important')).slice(0, Math.max(0, ramp.important - had('important'))).forEach((q) => keep.add(q.id));
  if (ramp.routines) created.filter((q) => q.kind === 'scheduled' && q.tier === 'optional').forEach((q) => keep.add(q.id));
  for (let i = created.length - 1; i >= 0; i--) {
    const q = created[i];
    if (q.kind === 'workout') {
      if (dayIndex === 0) Object.assign(q, { tier: 'optional' as const, reason: 'Day 1 bonus: start whenever you feel ready.' });
      continue;
    }
    if (q.kind === 'scheduled' && !keep.has(q.id)) created.splice(i, 1);
  }
}

/** Build today's quest board: scheduled, workout, adaptive side quests, challenge, hidden, weekly, boss. */
export async function startDay(date: ISODate, opts: { regenerate?: boolean } = {}): Promise<ServiceResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(date);
    const { settings } = tx;
    const plan = await planFor(date, settings);
    const restDay = plan.dayType === 'rest';
    const activities = await activityRepository.active();
    const history = await questRepository.byRange(shiftDate(date, -30), shiftDate(date, -1));
    const existing = await loadDay(date);
    const routines = await routineRepository.all();

    // Expire effects/boosts, set energy
    tx.player.effects = tx.player.effects.filter((e) => e.expiresOn >= date);
    tx.player.boosts = tx.player.boosts.filter((b) => b.expiresAt > tx.now);
    tx.player.maxEnergy = tx.maxEnergy;
    const sleep = (await statsRepository.metricsOfType('sleep', date, date)).at(-1)?.value;
    if (!opts.regenerate) {
      tx.player.energy = startingEnergy({ sleepHours: sleep, restDay, maxEnergy: tx.maxEnergy, recoveryMode: tx.player.recoveryMode }, settings.rules.energy);
      const regen = Math.round(tx.bonuses.hpRegen);
      if (regen > 0) tx.addHp(regen, 'World regeneration');
    }

    const ctx: FactoryContext = { settings, level: tx.level, date, now: tx.now };
    const already = new Set(existing.day.map((q) => q.activityId).filter(Boolean));
    const ws = weekStart(date);
    const created: Quest[] = [];

    // Workout from the active plan (decided first: cardio avoids strength days)
    const workoutPlan = await workoutRepository.activePlan();
    const gymOff = gymBlocked(settings, date);
    const fixedTemplate = workoutPlan?.templates.find((t) => t.weekday === weekday(date));
    const flexible = !!workoutPlan && (settings.known.training === 'unknown' || workoutPlan.templates.every((t) => t.weekday === null || t.weekday === undefined));
    const workoutsThisWeek = history.filter((q) => q.kind === 'workout' && q.status === 'completed' && q.date >= ws);
    const trainedYesterday = history.some((q) => q.kind === 'workout' && q.status === 'completed' && q.date === shiftDate(date, -1));
    let template = fixedTemplate;
    if (!template && flexible && workoutPlan && !trainedYesterday && workoutsThisWeek.length < workoutPlan.templates.length) {
      // Flexible plan: rotate through the templates, one session whenever the day allows it.
      const lastDone = history.filter((q) => q.kind === 'workout' && q.status === 'completed').sort((a, b) => b.date.localeCompare(a.date))[0];
      const lastIdx = workoutPlan.templates.findIndex((t) => t.id === lastDone?.workoutTemplateId);
      template = workoutPlan.templates[(lastIdx + 1) % workoutPlan.templates.length];
    }
    const workoutToday = !!template && !restDay && !gymOff;
    const freeDaysLeftAfterToday = Array.from({ length: daysLeftInWeek(date) - 1 }, (_, i) => shiftDate(date, i + 1)).filter((d) => resolveWork(d, settings.work).status === 'off').length;

    // Scheduled activities
    for (const a of activities) {
      if (a.recurrence.type === 'pool' || already.has(a.id)) continue;
      if (a.tags?.includes('cardio_program') && !settings.cardio.enabled) continue;
      if (a.metric === 'leisure' && !settings.leisure.enabled) continue;
      if (tx.player.recoveryMode && a.tier !== 'core' && a.importance < 4) continue;
      const mine = history.filter((q) => q.activityId === a.id && q.status === 'completed');
      const due = isDueOn(a, {
        date,
        dayType: plan.dayType,
        trainingAvailable: trainingAvailable(date, settings, plan),
        completedThisWeek: mine.filter((q) => q.date >= ws).length,
        lastCompletedDate: mine.map((q) => q.date).sort().at(-1),
        daysLeftInWeek: daysLeftInWeek(date),
        freeDaysLeftAfterToday,
        workoutToday,
      });
      if (due) created.push(questFromActivity(a, ctx));
    }

    if (template && workoutToday && !existing.day.some((q) => q.kind === 'workout')) {
      const learned = await learnedWorkoutTime(date);
      const wq = workoutQuest(template, ctx, learned !== undefined ? minutesToHm(Math.round(learned / 15) * 15) : defaultWorkoutTime(plan));
      if (!fixedTemplate) Object.assign(wq, { tier: 'important' as const, reason: 'Flexible plan: train today if it fits your day.' });
      created.push(wq);
    }

    // Progressive complexity: the first days start small.
    const dayIndex = await adventureDay(date, tx.player, settings);
    const ramp = rampLimits(dayIndex);
    if (ramp) applyRamp(created, ramp, activities, dayIndex, existing.day);
    for (const q of created) q.baseTier ??= q.tier;

    // Daily capacity + priority balancing (core stays, optional work is trimmed first)
    const allDay = [...existing.day, ...created];
    const samples = await capacityHistory(date);
    const loadInput = { settings, plan, date, energy: tx.player.energy, maxEnergy: tx.maxEnergy, history: samples, dayIndex, quests: allDay, activities };
    const firstLoad = computeDayLoad(loadInput);
    const recentLogs = (await statsRepository.logs(shiftDate(date, -7), shiftDate(date, -1))).filter((l) => l.closed);
    const done7 = recentLogs.reduce((s, l) => s + l.core.done + l.important.done, 0);
    const total7 = recentLogs.reduce((s, l) => s + l.core.total + l.important.total, 0);
    const completion7d = recentLogs.length >= 3 && total7 > 0 ? done7 / total7 : null;
    const consistency7d = recentLogs.length >= 3 ? recentLogs.filter((l) => l.success).length / recentLogs.length : null;
    const missedCore3d = recentLogs.filter((l) => daysBetween(l.date, date) <= 3).reduce((s, l) => s + (l.core.total - l.core.done), 0);
    const state = computeDifficultyState(
      { workload: firstLoad.score, energy: tx.player.energy, completion7d, missedCore3d, hp: tx.player.hp, recoveryMode: tx.player.recoveryMode },
      settings.rules.adaptive,
    );
    const load = computeDayLoad({ ...loadInput, state });
    const changedExisting = applyDecisions(existing.day, load);
    applyDecisions(created, load);
    if (changedExisting.length) await questRepository.bulkPut(changedExisting.map((q) => ({ ...q, updatedAt: tx.now })));
    const workload = { score: load.score, level: load.level, freeAfterQuestsMin: load.leftoverMin };

    const log: DayLog = {
      ...(tx.log.date === date ? tx.log : emptyLog(date, tx.player)),
      dayType: plan.dayType === 'rest' ? 'rest' : plan.dayType,
      restDay,
      workload: workload.score,
      workloadLevel: workload.level,
      difficultyState: state,
      consistency7d,
      capacityMin: load.capacity.minutes,
      plannedMin: load.plannedMin,
      freeMin: load.capacity.freeMin,
      workStatus: plan.workStatus,
      dayIndex,
    };
    if (!opts.regenerate) {
      log.energyStart = tx.player.energy;
      log.hpStart = tx.player.hp;
    }
    tx.log = log;
    const metrics = await statsRepository.metricsByDate(date);
    if (metrics.length) tx.log.metrics = aggregateMetrics(metrics);

    // Smart rules at day start can trim side quests
    const protect = evaluateRules(
      settings.rules.smartRules,
      'day_start',
      { workload: workload.score, hp: tx.player.hp, energy: tx.player.energy, dayType: plan.dayType, recoveryMode: tx.player.recoveryMode },
      new Set(),
    ).find((r) => r.action.type === 'reduceSideQuests');

    // Side quests
    if (tx.level >= FEATURE_LEVELS.sideQuests && !existing.day.some((q) => q.kind === 'side')) {
      const coreEnergy = allDay.filter((q) => q.tier === 'core').reduce((s, q) => s + Math.max(0, q.energyCost), 0);
      let budget = sideQuestBudget(
        {
          workloadLevel: workload.level,
          state,
          preset: settings.rules.difficultyPresets[settings.difficulty],
          extraSlots: tx.bonuses.sideQuestSlots,
          energyAfterCore: tx.player.energy - coreEnergy,
          freeAfterQuestsMin: workload.freeAfterQuestsMin,
          dayType: plan.dayType,
        },
        settings.rules.generator,
      );
      if (protect) budget = { ...budget, count: Math.min(budget.count, Number(protect.action.params?.keep ?? 0)) };
      if (ramp) budget = { ...budget, count: Math.min(budget.count, ramp.side), challenge: budget.challenge && dayIndex > 0 };
      const side = await generateSideQuestsFor({
        ctx,
        dayQuests: allDay,
        longQuests: existing.long,
        budget,
        state,
        ownedBuildings: new Set(tx.buildings.filter((b) => b.level > 0).map((b) => b.id)),
        freeMinutes: workload.freeAfterQuestsMin,
        seed: 'side',
      });
      created.push(...side);
      const tctx = await templateContext(settings, date, tx.level, plan.dayType, state);
      if (budget.challenge && !existing.day.some((q) => q.kind === 'challenge')) created.push(...(await generateChallenge(ctx, tctx, budget.challengeBoost)));
    }
    const tctx = await templateContext(settings, date, tx.level, plan.dayType, state);
    if (!existing.day.some((q) => q.kind === 'hidden')) created.push(...(await generateHidden(ctx, tctx)));
    created.push(...(await generateLongQuests(ctx, tctx, existing.long)));

    await questRepository.bulkPut(created);
    tx.log = refreshLog(tx.log, settings, [...existing.day, ...created], routines);
    if (!opts.regenerate) {
      const { day, long } = await loadDay(date);
      await runRules(tx, 'day_start', day, long);
    }
    await tx.commit();
    return { events: tx.events };
  });
}

/** Close a past day: final score, streak, HP, penalties, world income. Idempotent. */
export async function closeDay(date: ISODate): Promise<ServiceResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(date);
    if (tx.log.closed) return { events: [] };
    const { settings } = tx;
    const quests = (await questRepository.byDate(date)).filter((q) => q.kind !== 'weekly' && q.kind !== 'boss');
    const routines = await routineRepository.all();
    const hadQuests = quests.length > 0;

    // Play-time budget quests resolve at day end: under budget = win.
    for (const q of quests) {
      if (q.metricMode === 'atMost' && q.status === 'pending' && q.target !== undefined && q.progress <= q.target) {
        const done = await applyCompletion(tx, q);
        Object.assign(q, done);
      }
    }
    tx.log = refreshLog(tx.log, settings, quests, routines);

    const result = closeDayDomain({
      date,
      quests,
      log: tx.log,
      player: tx.player,
      rules: settings.rules,
      difficulty: settings.difficulty,
      score: {
        steps: settings.steps,
        waterTargetMl: settings.hydration.targetMl,
        nutrition: settings.nutrition,
        trackNutrition: settings.tracking.nutrition,
        routine: null,
        consistency7d: tx.log.consistency7d ?? null,
        achievementsToday: tx.log.achievements.length,
      },
      worldDailyIncome: tx.bonuses.dailyIncome,
    });
    const breakdown = scoreDay(settings, tx.log, quests, routines);

    // Inactive days (app not opened) only affect the streak — no HP/coin penalties.
    const streakBefore = tx.player.streak.current;
    tx.player.streak = result.streak.streak;
    if (result.streak.usedFreeze) {
      tx.player.inventory.streakFreeze -= 1;
      tx.inc({ [C.freezesUsed]: 1 });
    }
    if (hadQuests) {
      tx.addHp(result.hp.delta, 'Day close');
      const rec = result.recovery;
      tx.player.hp = rec.hp;
      if (rec.entered) {
        tx.player.recoveryMode = true;
        tx.player.recoveryStartedOn = date;
        if (rec.knockedOut) tx.inc({ [C.knockouts]: 1 });
      }
      if (rec.exited) {
        tx.player.recoveryMode = false;
        tx.inc({ [C.recoveryExits]: 1 });
      }
      const penaltyCoins = result.penalties.filter((p) => p.kind === 'coins').reduce((sum, p) => sum + p.amount, 0);
      if (penaltyCoins) tx.addCoins(penaltyCoins, 'Penalties');
      if (result.worldIncome) tx.addCoins(result.worldIncome, 'World income');
      tx.player.effects = [...tx.player.effects.filter((e) => e.expiresOn >= date), ...result.effects];
    }
    if (result.milestoneCoins) tx.addCoins(result.milestoneCoins, `Streak ${result.streak.milestone}`);
    tx.player.inventory.streakFreeze += result.milestoneFreeze;

    const counters = tx.counters();
    const dc = countersForDayClose({
      log: { ...tx.log, score: breakdown.total },
      perfectCore: result.perfectCore,
      allTiers: result.allTiers,
      stepsIdeal: settings.steps.ideal,
      waterTarget: settings.hydration.targetMl,
      proteinTarget: settings.nutrition.protein,
      calorieTarget: settings.nutrition.calories,
      previousPerfectRun: counters[C.perfectCoreRun] ?? 0,
      previousPerfectRunBest: counters[C.perfectCoreRunBest] ?? 0,
      leisureLimit: settings.leisure.enabled && hadQuests ? settings.leisure.dailyLimitMin : undefined,
      previousLeisureRun: counters[C.leisureUnderRun] ?? 0,
      previousLeisureRunBest: counters[C.leisureUnderRunBest] ?? 0,
    });
    if (hadQuests) {
      tx.inc(dc.inc);
      tx.set(dc.set);
    }
    if (hadQuests && breakdown.total > (counters['record.score'] ?? 0)) tx.set({ 'record.score': breakdown.total });

    const dayScoped = quests.filter((q) => !q.endDate && q.status !== 'moved');
    tx.log = {
      ...tx.log,
      plannedMin: dayScoped.filter((q) => (q.tier === 'core' || q.tier === 'important') && !q.goal).reduce((sum, q) => sum + q.durationMin, 0),
      completedMin: dayScoped.filter((q) => q.status === 'completed').reduce((sum, q) => sum + q.durationMin, 0),
      score: breakdown.total,
      breakdown,
      success: result.success,
      closed: true,
      closedAt: tx.now,
      penalties: hadQuests ? result.penalties : [],
      worldIncome: hadQuests ? result.worldIncome : 0,
      hpEnd: tx.player.hp,
      streak: tx.player.streak.current,
    };

    // Weekly streak on Sundays
    if (weekday(date) === 0) {
      const logs = await statsRepository.logs(weekStart(date), date);
      const wins = logs.filter((l) => (l.date === date ? result.success : l.success)).length;
      tx.player.streak = applyWeekToStreak(tx.player.streak, weekKey(date), wins >= weeklyStreakTarget(settings.difficulty));
    }

    // Unfinished day quests expire (keeps history honest)
    const expired = quests.filter((q) => q.status === 'pending').map((q) => ({ ...q, status: 'failed' as const, updatedAt: tx.now }));
    if (expired.length) await questRepository.bulkPut(expired);

    const { day, long } = await loadDay(date);
    await runRules(tx, 'day_end', day, long, { score: breakdown.total });
    await tx.checkAchievements();
    await tx.commit();

    const events: ServiceResult['events'] = [{ type: 'dayClosed', date, score: breakdown.total, success: result.success }];
    if (result.streak.event === 'extended' && result.streak.milestone) {
      events.push({ type: 'streak', value: tx.player.streak.current, kind: 'extended', milestone: result.streak.milestone });
    } else if (result.streak.event === 'frozen') events.push({ type: 'streak', value: streakBefore, kind: 'frozen' });
    else if (result.streak.event === 'broken') events.push({ type: 'streak', value: streakBefore, kind: 'broken' });
    return { events: [...events, ...tx.events] };
  });
}

/** Change today's day type (workday / free / rest) and rebuild side quests accordingly. */
export async function setDayType(date: ISODate, dayType: DayType, settings: Settings): Promise<ServiceResult> {
  const plan = await planFor(date, settings);
  let next: DayPlan;
  if (dayType === 'rest') next = { ...plan, dayType: 'rest' };
  else if (dayType === 'free') next = { ...applyWorkToPlan({ ...plan, dayType: 'free' }, { status: 'off' }), temporary: true };
  else {
    // "Working today" never invents hours: keep what we know, otherwise hours stay unset.
    const known = plan.workStatus === 'set' || plan.workStatus === 'partial';
    next = known ? { ...plan, dayType: 'work', temporary: true } : { ...applyWorkToPlan({ ...plan, dayType: 'free' }, { status: 'partial' }), temporary: true };
  }
  await statsRepository.putPlan(next);
  return rebuildDay(date);
}

/** Save a day-plan override (work hours, busy blocks, wake/sleep) and rebuild. */
export async function saveDayPlan(plan: DayPlan): Promise<ServiceResult> {
  await statsRepository.putPlan(plan);
  return rebuildDay(plan.date);
}

/**
 * Rebuild the adaptive parts of a day: pending side quests/challenges are regenerated,
 * scheduled quests that no longer apply (e.g. workout on a rest day) are removed.
 */
export async function rebuildDay(date: ISODate): Promise<ServiceResult> {
  await withTransaction(async () => {
    const quests = await questRepository.byDate(date);
    const s = await settingsRepository.get();
    if (!s) return;
    const plan = await planFor(date, s);
    const removable = quests.filter(
      (q) =>
        q.status === 'pending' &&
        q.source !== 'coach' &&
        (q.kind === 'side' || q.kind === 'challenge' || (plan.dayType === 'rest' && (q.kind === 'workout' || q.category === 'fitness' || q.category === 'cardio' || q.tier === 'optional'))),
    );
    for (const q of removable) await questRepository.remove(q.id);
  });
  const r = await startDay(date, { regenerate: true });
  return r;
}

export async function setSickDay(date: ISODate, sick: boolean): Promise<ServiceResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(date);
    tx.log.sick = sick;
    if (sick) tx.events.push({ type: 'toast', text: 'Sick day: no penalties, streak protected. Rest up.', icon: '🤒', tone: 'info' });
    await settleDay(tx);
    await tx.commit();
    return { events: tx.events };
  });
}

/** Called after level-ups that unlock features, so they appear today instead of tomorrow. */
export async function unlockFeaturesToday(): Promise<ServiceResult> {
  return startDay(clock.today(), { regenerate: true });
}

/** Onboarding: seed the first quest and start the first day. */
export async function beginAdventure(): Promise<ServiceResult> {
  const today = clock.today();
  if (!(await metaRepository.get<string>('adventureStart'))) await metaRepository.set('adventureStart', today);
  await metaRepository.remove('currentDate');
  const r = await ensureToday();
  await withTransaction(async () => {
    const tx = await GameTx.open(today);
    const { day } = await loadDay(today);
    if (!day.some((q) => q.kind === 'first')) await questRepository.put(firstQuest({ settings: tx.settings, level: tx.level, date: today, now: tx.now }));
    await settleDay(tx);
    await tx.commit();
  });
  return r;
}

export { DEFAULT_CARDIO_STAGES };
