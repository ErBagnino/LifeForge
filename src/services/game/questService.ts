import { countersForQuest, C } from '@/domain/counters';
import { hpForQuest } from '@/domain/hp';
import { evaluateRules, type Facts } from '@/domain/rulesEngine';
import { applyMultipliers, isRecoveryCategory, rewardMultipliers } from '@/domain/rewards';
import { countedQuests, tierCount } from '@/domain/score';
import { activityStreak } from '@/domain/streak';
import {
  activityRepository,
  questRepository,
  routineRepository,
  suggestionRepository,
  withTransaction,
} from '@/repositories';
import type { Difficulty, ID, Quest, QuestTier, RuleTrigger, SkipReason, TimeHM } from '@/types';
import { dateTimeToTs, shiftDate, tsToHm } from '@/utils/date';
import { uid } from '@/utils/id';
import { clock } from '../clock';
import type { ServiceResult } from '../events';
import { GameTx } from './gameTx';
import { evaluateGoalQuests } from './goalService';
import { currentTimeOfDay, generateSideQuestsFor } from './generation';
import { manualQuest, questFromActivity } from './questFactory';
import { refreshLog } from './scoring';

export interface QuestResult extends ServiceResult {
  features: string[];
  quest?: Quest;
}

const isLong = (q: Quest) => q.kind === 'weekly' || q.kind === 'boss';

export async function loadDay(date: string): Promise<{ day: Quest[]; long: Quest[] }> {
  const [day, long] = await Promise.all([questRepository.byDate(date), questRepository.longActive(date)]);
  return { day: day.filter((q) => !isLong(q)), long };
}

/** Grant everything a completed quest is worth. Mutates the tx; persists the quest. */
export async function applyCompletion(tx: GameTx, quest: Quest, actualTime?: TimeHM): Promise<Quest> {
  const rules = tx.settings.rules;
  const bonuses = tx.bonuses;
  const multipliers = rewardMultipliers(
    {
      now: tx.now,
      date: tx.date,
      streak: tx.player.streak.current,
      preset: rules.difficultyPresets[tx.settings.difficulty],
      boosts: tx.player.boosts,
      effects: tx.player.effects,
      categoryXpPct: bonuses.xpPctByCategory[quest.category] ?? 0,
      categoryCoinPct: bonuses.coinPctByCategory[quest.category] ?? 0,
      recoveryMode: tx.player.recoveryMode,
    },
    rules.xp,
  );
  const reward = applyMultipliers({ xp: quest.xp, coins: quest.coins }, multipliers);
  const hp = hpForQuest(
    { tier: quest.tier, recovery: isRecoveryCategory(quest.category), gainedToday: tx.log.hpFromQuests ?? 0, recoveryMode: tx.player.recoveryMode },
    rules.hp,
  );
  const hpDelta = tx.addHp(hp, 'Quest', quest.id);
  tx.log.hpFromQuests = (tx.log.hpFromQuests ?? 0) + Math.max(0, hpDelta);
  const energyDelta = tx.applyEnergy(quest.energyCost, 'Quest', quest.id);
  tx.addStats(quest.stats);
  tx.addXp(reward.xp, `Quest: ${quest.title}`, quest.id);
  tx.addCoins(reward.coins, `Quest: ${quest.title}`, quest.id);

  const completedAt = actualTime ? dateTimeToTs(quest.date, actualTime, tx.settings.dayStartHour) : tx.now;
  const done: Quest = {
    ...quest,
    status: 'completed',
    completedAt,
    actualTime: actualTime ?? tsToHm(completedAt),
    progress: quest.target !== undefined && quest.metricMode !== 'atMost' ? Math.max(quest.progress, quest.target) : quest.progress,
    snoozedUntil: undefined,
    earned: { xp: reward.xp, coins: reward.coins, hp: hpDelta, energy: energyDelta },
    updatedAt: tx.now,
  };
  await questRepository.put(done);
  tx.inc(countersForQuest(done, completedAt));

  if (done.activityId) {
    const history = await questRepository.byActivity(done.activityId, shiftDate(tx.date, -400));
    const merged = history.map((q) => (q.id === done.id ? done : q));
    tx.setMax(C.actStreak(done.activityId), activityStreak(merged, tx.date));
  }

  tx.events.push({
    type: 'questComplete',
    questId: done.id,
    title: done.hidden ? `Hidden: ${done.title}` : done.title,
    icon: done.icon,
    kind: done.kind,
    rarity: done.rarity,
    xp: reward.xp,
    coins: reward.coins,
    stats: done.stats,
    hp: hpDelta,
    energy: energyDelta,
    multipliers,
  });
  return done;
}

function buildFacts(tx: GameTx, day: Quest[]): Facts {
  const counted = countedQuests(day);
  const done = counted.filter((q) => q.status === 'completed').length;
  const core = tierCount(day, 'core');
  const threshold = tx.settings.rules.difficultyPresets[tx.settings.difficulty].streakThreshold;
  return {
    completionRate: counted.length ? done / counted.length : 0,
    coreCompletion: core.total ? core.done / core.total : 1,
    pendingCore: core.total - core.done,
    energy: tx.player.energy,
    hp: tx.player.hp,
    workload: tx.log.workload,
    hour: new Date(tx.now).getHours(),
    score: tx.log.score,
    streak: tx.player.streak.current,
    streakAtRisk: tx.player.streak.current > 0 && tx.log.score < threshold,
    recoveryMode: tx.player.recoveryMode,
    dayType: tx.log.dayType,
    completion7d: tx.log.consistency7d ?? undefined,
  };
}

/** Execute smart-rule actions that make sense outside workouts. */
export async function runRules(tx: GameTx, trigger: RuleTrigger, day: Quest[], long: Quest[], extraFacts: Facts = {}): Promise<Quest[]> {
  const fired = evaluateRules(tx.settings.rules.smartRules, trigger, { ...buildFacts(tx, day), ...extraFacts }, new Set(tx.log.rulesFired ?? []));
  const created: Quest[] = [];
  for (const rule of fired) {
    tx.log.rulesFired = [...(tx.log.rulesFired ?? []), rule.id];
    const p = rule.action.params ?? {};
    switch (rule.action.type) {
      case 'coachMessage':
        tx.events.push({ type: 'coach', text: String(p.text ?? rule.description), icon: '🧠' });
        break;
      case 'grantHp': {
        const d = tx.addHp(Number(p.amount ?? 5), rule.name);
        if (d > 0) tx.events.push({ type: 'toast', text: `${rule.name}: +${d} HP`, icon: '❤️', tone: 'success' });
        break;
      }
      case 'suggestSideQuest': {
        const quests = await generateSideQuestsFor({
          ctx: { settings: tx.settings, level: tx.level, date: tx.date, now: tx.now },
          dayQuests: day,
          longQuests: long,
          budget: { count: 1, maxDuration: 20, energyBudget: Math.max(10, tx.player.energy - 20), challengeBoost: 1, challenge: false },
          state: 'too_easy',
          ownedBuildings: new Set(tx.buildings.filter((b) => b.level > 0).map((b) => b.id)),
          freeMinutes: 60,
          seed: `momentum:${tx.now}`,
          timeOfDay: currentTimeOfDay(),
          reason: 'Momentum bonus — you are on fire today',
        });
        if (quests.length) {
          await questRepository.bulkPut(quests);
          created.push(...quests);
          tx.events.push({ type: 'coach', text: `On a roll! Bonus quest unlocked: ${quests[0].title}`, icon: '🔥' });
        }
        break;
      }
      case 'suggestRest':
        await suggestionRepository.offer({
          id: uid('sg_'),
          key: `rest:${tx.date}`,
          type: 'restDay',
          title: 'Take a planned rest day?',
          body: 'HP is low. A planned rest day keeps the streak safe with essentials only — and heals HP.',
          payload: { date: tx.date },
          status: 'pending',
          createdAt: tx.now,
        });
        break;
      default:
        break;
    }
  }
  return created;
}

/**
 * Everything that follows a change in today's quests: routine bonuses, goal quests,
 * score refresh, achievements and smart rules.
 */
export async function settleDay(tx: GameTx, trigger?: RuleTrigger): Promise<void> {
  const routines = await routineRepository.all();
  for (let pass = 0; pass < 3; pass++) {
    const { day, long } = await loadDay(tx.date);
    for (const r of routines) {
      if (!r.active || tx.log.routinesDone?.includes(r.id)) continue;
      const items = day.filter((q) => q.activityId && r.activityIds.includes(q.activityId) && q.status !== 'moved');
      if (items.length >= 2 && items.every((q) => q.status === 'completed')) {
        tx.log.routinesDone = [...(tx.log.routinesDone ?? []), r.id];
        tx.addXp(r.bonusXp, `Routine: ${r.name}`, r.id);
        tx.addCoins(r.bonusCoins, `Routine: ${r.name}`, r.id);
        tx.inc({ [C.routinesAny]: 1, ...(r.kind === 'morning' ? { [C.routinesMorning]: 1 } : {}), ...(r.kind === 'night' ? { [C.routinesNight]: 1 } : {}) });
        tx.events.push({ type: 'routine', name: r.name, icon: r.icon, xp: r.bonusXp, coins: r.bonusCoins });
      }
    }
    tx.log = refreshLog(tx.log, tx.settings, day, routines);
    const reached = await evaluateGoalQuests(tx.settings, tx.log, day, long);
    if (!reached.length) break;
    for (const q of reached) await applyCompletion(tx, q);
  }
  await tx.checkAchievements();
  const { day, long } = await loadDay(tx.date);
  tx.log = refreshLog(tx.log, tx.settings, day, routines);
  if (trigger) {
    const created = await runRules(tx, trigger, day, long);
    if (created.length) tx.log = refreshLog(tx.log, tx.settings, [...day, ...created], routines);
  }
}

async function run(fn: (tx: GameTx) => Promise<Quest | undefined | void>): Promise<QuestResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open();
    const quest = (await fn(tx)) ?? undefined;
    await tx.commit();
    return { events: tx.events, features: tx.unlockedFeatures, quest };
  });
}

async function mustGet(id: ID): Promise<Quest> {
  const q = await questRepository.get(id);
  if (!q) throw new Error('Quest not found');
  return q;
}

export function completeQuest(id: ID, actualTime?: TimeHM): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    if (q.status === 'completed') return q;
    if (q.metricMode === 'atMost' && q.target !== undefined && q.progress > q.target) {
      tx.events.push({ type: 'toast', text: 'Budget already exceeded today — this one resets tomorrow.', icon: '⛔', tone: 'warn' });
      return q;
    }
    const done = await applyCompletion(tx, q, actualTime);
    await settleDay(tx, 'quest_completed');
    return done;
  });
}

/** Undo a completion (mis-tap). Reverses XP, coins, HP, energy and stats; achievements stay. */
export function uncompleteQuest(id: ID): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    if (q.status !== 'completed') return q;
    const e = q.earned ?? { xp: 0, coins: 0, hp: 0, energy: 0 };
    tx.addXp(-e.xp, `Undo: ${q.title}`, q.id);
    tx.addCoins(-e.coins, `Undo: ${q.title}`, q.id);
    tx.player.lifetime.coinsEarned = Math.max(0, tx.player.lifetime.coinsEarned - e.coins);
    tx.player.lifetime.xpEarned = Math.max(0, tx.player.lifetime.xpEarned - e.xp);
    tx.addHp(-e.hp, 'Undo', q.id);
    tx.log.hpFromQuests = Math.max(0, (tx.log.hpFromQuests ?? 0) - Math.max(0, e.hp));
    tx.applyEnergy(e.energy, 'Undo', q.id);
    tx.addStats(q.stats, -1);
    const neg = Object.fromEntries(Object.entries(countersForQuest(q, q.completedAt ?? tx.now)).map(([k, v]) => [k, -v]));
    tx.inc(neg);
    const reverted: Quest = { ...q, status: 'pending', completedAt: undefined, actualTime: undefined, earned: undefined, updatedAt: tx.now };
    await questRepository.put(reverted);
    await settleDay(tx);
    return reverted;
  });
}

export function skipQuest(id: ID, reason: SkipReason): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    const next: Quest = { ...q, status: 'skipped', skipReason: reason, snoozedUntil: undefined, updatedAt: tx.now };
    await questRepository.put(next);
    tx.inc({ [C.skips]: 1 });
    await settleDay(tx);
    return next;
  });
}

export function failQuest(id: ID): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    const next: Quest = { ...q, status: 'failed', updatedAt: tx.now };
    await questRepository.put(next);
    await settleDay(tx);
    return next;
  });
}

export function snoozeQuest(id: ID, until: number): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    const next: Quest = { ...q, snoozedUntil: until, snoozeCount: q.snoozeCount + 1, scheduledTime: tsToHm(until), updatedAt: tx.now };
    await questRepository.put(next);
    tx.inc({ [C.snoozes]: 1 });
    const warnAt = tx.settings.rules.penalties.snoozeWarnAt;
    if (q.tier !== 'optional' && next.snoozeCount >= warnAt) {
      tx.events.push({
        type: 'toast',
        icon: '⏰',
        tone: 'warn',
        text: next.snoozeCount > warnAt ? `Snoozed ${next.snoozeCount}× — each extra snooze costs coins tonight.` : `Snoozed ${next.snoozeCount}×. Maybe shrink it instead of moving it?`,
      });
    }
    await tx.checkAchievements();
    return next;
  });
}

/** Move a quest to tomorrow (a new quest is created there; today's copy is marked "moved"). */
export function moveQuestToTomorrow(id: ID): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    const moved: Quest = { ...q, status: 'moved', updatedAt: tx.now };
    const copy: Quest = {
      ...q,
      id: uid('q_'),
      date: shiftDate(q.date, 1),
      status: 'pending',
      snoozedUntil: undefined,
      rescheduleCount: q.rescheduleCount + 1,
      reason: 'Moved from yesterday',
      createdAt: tx.now,
      updatedAt: tx.now,
    };
    await questRepository.bulkPut([moved, copy]);
    tx.inc({ [C.snoozes]: 1 });
    await settleDay(tx);
    return copy;
  });
}

export function rescheduleQuest(id: ID, time: TimeHM | undefined): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    const next: Quest = { ...q, scheduledTime: time, snoozedUntil: undefined, rescheduleCount: q.rescheduleCount + 1, updatedAt: tx.now };
    await questRepository.put(next);
    tx.inc({ [C.timelineEdits]: 1 });
    await tx.checkAchievements();
    return next;
  });
}

/** Correct the real completion time (feeds habit learning). */
export function setActualTime(id: ID, time: TimeHM): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    const next: Quest = {
      ...q,
      actualTime: time,
      completedAt: q.status === 'completed' ? dateTimeToTs(q.date, time, tx.settings.dayStartHour) : q.completedAt,
      updatedAt: tx.now,
    };
    await questRepository.put(next);
    tx.inc({ [C.timelineEdits]: 1 });
    await tx.checkAchievements();
    return next;
  });
}

/** Swap a side quest for a new one. Uses a Reroll token, or coins when none are left. */
export function rerollQuest(id: ID): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    if (q.kind !== 'side' || q.status !== 'pending') return q;
    if (tx.player.inventory.reroll > 0) tx.player.inventory.reroll -= 1;
    else if (!tx.spendCoins(tx.settings.rules.generator.rerollCost, 'Quest reroll', q.id)) {
      tx.events.push({ type: 'toast', text: 'Not enough coins to reroll.', icon: '🪙', tone: 'warn' });
      return q;
    }
    const { day, long } = await loadDay(tx.date);
    const [replacement] = await generateSideQuestsFor({
      ctx: { settings: tx.settings, level: tx.level, date: tx.date, now: tx.now },
      dayQuests: day,
      longQuests: long,
      budget: { count: 1, maxDuration: Math.max(15, q.durationMin), energyBudget: 999, challengeBoost: 0, challenge: false },
      state: tx.log.difficultyState,
      ownedBuildings: new Set(tx.buildings.filter((b) => b.level > 0).map((b) => b.id)),
      freeMinutes: 240,
      seed: `reroll:${tx.now}`,
      timeOfDay: currentTimeOfDay(),
      reason: 'Rerolled',
    });
    if (!replacement) {
      tx.events.push({ type: 'toast', text: 'No other side quest fits right now.', icon: '🎲', tone: 'info' });
      return q;
    }
    await questRepository.remove(q.id);
    await questRepository.put(replacement);
    tx.inc({ [C.rerolls]: 1 });
    await settleDay(tx);
    return replacement;
  });
}

/** Start any activity from the library as an extra quest for today. */
export function startActivityNow(activityId: ID): Promise<QuestResult> {
  return run(async (tx) => {
    const a = await activityRepository.get(activityId);
    if (!a) throw new Error('Activity not found');
    const quest = questFromActivity(a, { settings: tx.settings, level: tx.level, date: tx.date, now: tx.now }, { kind: 'manual', tier: 'optional', reason: 'Started from the library' });
    await questRepository.put(quest);
    await settleDay(tx);
    return quest;
  });
}

export function addManualQuest(input: {
  title: string;
  icon: string;
  category: Quest['category'];
  difficulty: Difficulty;
  durationMin: number;
  tier: QuestTier;
  scheduledTime?: TimeHM;
}): Promise<QuestResult> {
  return run(async (tx) => {
    const quest = { ...manualQuest({ settings: tx.settings, level: tx.level, date: tx.date, now: tx.now }, input), scheduledTime: input.scheduledTime };
    await questRepository.put(quest);
    await settleDay(tx);
    return quest;
  });
}

export function deleteQuest(id: ID): Promise<QuestResult> {
  return run(async (tx) => {
    const q = await mustGet(id);
    if (q.status === 'completed') return q;
    await questRepository.remove(id);
    await settleDay(tx);
  });
}

/** Re-evaluate today (after settings/metric edits). */
export function refreshToday(): Promise<QuestResult> {
  return run(async (tx) => {
    await settleDay(tx);
  });
}

export function nowHm(): TimeHM {
  return tsToHm(clock.now());
}
