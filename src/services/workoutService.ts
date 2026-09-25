import { DEFAULT_CARDIO_STAGES } from '@/data/cardio';
import { evaluateCardioWeek } from '@/domain/cardio';
import { C } from '@/domain/counters';
import { analyzeExercise, consecutiveFailures, type ExerciseHistoryEntry, suggestProgression } from '@/domain/progression';
import { detectRecords, exerciseRecordCandidates } from '@/domain/records';
import { computeQuestValues } from '@/domain/rewards';
import { evaluateRules } from '@/domain/rulesEngine';
import {
  questRepository,
  settingsRepository,
  statsRepository,
  suggestionRepository,
  withTransaction,
  workoutRepository,
} from '@/repositories';
import type { CardioLog, Exercise, ID, Rpe, SessionExercise, SetLog, WorkoutSession } from '@/types';
import { weekEnd, weekStart } from '@/utils/date';
import { uid } from '@/utils/id';
import { mean } from '@/utils/math';
import { clock } from './clock';
import { logMetric } from './metricsService';
import { GameTx } from './game/gameTx';
import { cardioStage } from './game/questFactory';
import { applyCompletion, type QuestResult, settleDay } from './game/questService';

export async function exerciseHistory(exerciseId: ID, limit = 12, excludeSessionId?: ID): Promise<ExerciseHistoryEntry[]> {
  const sessions = (await workoutRepository.allSessions())
    .filter((s) => s.status === 'completed' && s.id !== excludeSessionId)
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  const out: ExerciseHistoryEntry[] = [];
  for (const s of sessions) {
    const ex = s.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex || !ex.sets.some((set) => set.completed)) continue;
    const weights = ex.sets.filter((x) => x.completed).map((x) => x.weight);
    out.push({
      date: s.date,
      weight: weights.length ? Math.max(...weights) : ex.targetWeight,
      repMin: ex.repMin,
      repMax: ex.repMax,
      targetSets: ex.targetSets,
      sets: ex.sets,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function blankSets(n: number, weight: number, reps: number): SetLog[] {
  return Array.from({ length: n }, () => ({ weight, reps, completed: false }));
}

let starting: Promise<WorkoutSession> | null = null;

/** Start (or resume) a strength session from a plan template. Concurrent calls share one session. */
export function startSession(templateId?: ID, questId?: ID): Promise<WorkoutSession> {
  starting ??= doStartSession(templateId, questId).finally(() => {
    starting = null;
  });
  return starting;
}

async function doStartSession(templateId?: ID, questId?: ID): Promise<WorkoutSession> {
  const active = await workoutRepository.activeSession();
  if (active) return active;
  const plan = await workoutRepository.activePlan();
  const template = plan?.templates.find((t) => t.id === templateId);
  const states = new Map((await workoutRepository.states.all()).map((s) => [s.exerciseId, s]));
  const exercises: SessionExercise[] = (template?.exercises ?? []).map((te) => {
    const st = states.get(te.exerciseId);
    const weight = st?.workingWeight ?? 0;
    const repMin = st?.repMin ?? te.repMin;
    const repMax = st?.repMax ?? te.repMax;
    return { exerciseId: te.exerciseId, targetSets: te.sets, repMin, repMax, restSec: te.restSec, targetWeight: weight, sets: blankSets(te.sets, weight, repMax) };
  });
  const today = clock.today();
  const linkedQuest =
    questId ?? (await questRepository.byDate(today)).find((q) => q.kind === 'workout' && q.status === 'pending' && (!templateId || q.workoutTemplateId === templateId))?.id;
  const session: WorkoutSession = {
    id: uid('ws_'),
    date: today,
    planId: plan?.id,
    templateId: template?.id,
    name: template?.name ?? 'Free workout',
    kind: 'strength',
    startedAt: clock.now(),
    status: 'active',
    exercises,
    questId: linkedQuest,
  };
  await workoutRepository.putSession(session);
  return session;
}

export async function saveSession(session: WorkoutSession): Promise<void> {
  await workoutRepository.putSession(session);
}

export async function addExerciseToSession(session: WorkoutSession, exercise: Exercise): Promise<WorkoutSession> {
  const st = await workoutRepository.states.get(exercise.id);
  const weight = st?.workingWeight ?? 0;
  const next: WorkoutSession = {
    ...session,
    exercises: [
      ...session.exercises,
      {
        exerciseId: exercise.id,
        targetSets: exercise.defaultSets,
        repMin: st?.repMin ?? exercise.repMin,
        repMax: st?.repMax ?? exercise.repMax,
        restSec: exercise.restSec,
        targetWeight: weight,
        sets: blankSets(exercise.defaultSets, weight, exercise.repMax),
      },
    ],
  };
  await workoutRepository.putSession(next);
  return next;
}

export async function abandonSession(id: ID): Promise<void> {
  const s = await workoutRepository.getSession(id);
  if (s) await workoutRepository.putSession({ ...s, status: 'abandoned', endedAt: clock.now() });
}

export interface FinishSummary {
  session: WorkoutSession;
  completedSets: number;
  totalSets: number;
  volume: number;
  durationMin: number;
  avgRpe: number | null;
}

/** Finish a session: rewards, PRs, progression suggestions and smart rules. */
export async function finishSession(id: ID): Promise<QuestResult & { summary?: FinishSummary }> {
  const session = await workoutRepository.getSession(id);
  if (!session || session.status !== 'active') return { events: [], features: [] };
  const exercises = new Map((await workoutRepository.exercises.all()).map((e) => [e.id, e]));
  const settings = await settingsRepository.get();
  if (!settings) throw new Error('Game not initialised');

  // Build suggestions outside the write transaction (read-only history scan).
  const analyzed: SessionExercise[] = [];
  let worstFails = 0;
  for (const ex of session.exercises) {
    const def = exercises.get(ex.exerciseId);
    const history = await exerciseHistory(ex.exerciseId, 10, session.id);
    const doneSets = ex.sets.filter((s) => s.completed);
    if (!def || !doneSets.length) {
      analyzed.push(ex);
      continue;
    }
    const current: ExerciseHistoryEntry = {
      date: session.date,
      weight: Math.max(...doneSets.map((s) => s.weight)),
      repMin: ex.repMin,
      repMax: ex.repMax,
      targetSets: ex.targetSets,
      sets: ex.sets,
    };
    const full = [current, ...history];
    worstFails = Math.max(worstFails, consecutiveFailures(full));
    const suggestion = suggestProgression({
      measure: def.measure,
      bodyweight: !!def.bodyweight,
      current: { weight: current.weight || ex.targetWeight, repMin: ex.repMin, repMax: ex.repMax },
      history: full,
      rule: def.progression,
      maxIncreasePct: settings.safety.maxTrainingIncreasePct,
    });
    analyzed.push({ ...ex, suggestion });
  }

  return withTransaction(async () => {
    const tx = await GameTx.open(clock.today());
    const now = tx.now;
    const allSets = analyzed.flatMap((e) => e.sets);
    const completedSets = allSets.filter((s) => s.completed);
    const volume = Math.round(completedSets.reduce((s, x) => s + x.weight * x.reps, 0));
    const rpes = completedSets.map((s) => s.rpe).filter((r): r is Rpe => r !== undefined);
    const avgRpe = rpes.length ? mean(rpes) : null;
    const allDone = analyzed.every((e) => e.sets.filter((s) => s.completed).length >= e.targetSets);
    const durationMin = Math.max(1, Math.round((now - session.startedAt) / 60000));

    const finished: WorkoutSession = { ...session, exercises: analyzed, status: 'completed', endedAt: now };

    // Records
    const existing = new Map((await statsRepository.records()).map((r) => [r.id, r]));
    const candidates = analyzed.flatMap((e) => {
      const def = exercises.get(e.exerciseId);
      return def ? exerciseRecordCandidates(e, def.name, def.measure, !!def.bodyweight) : [];
    });
    const prs = detectRecords(candidates, existing, session.date, now).filter((r) => r.previous !== undefined);
    const firstTime = detectRecords(candidates, existing, session.date, now).filter((r) => r.previous === undefined);
    await statsRepository.putRecords([...prs, ...firstTime]);
    for (const record of prs) tx.events.push({ type: 'record', record });

    tx.inc({
      [C.workouts]: 1,
      [C.workoutSets]: completedSets.length,
      [C.workoutVolume]: volume,
      ...(allDone && completedSets.length ? { [C.workoutsPerfect]: 1 } : {}),
      ...(prs.length ? { [C.prsTotal]: prs.length, [C.prsWeight]: prs.filter((p) => p.kind === 'exercise_weight').length } : {}),
    });

    // Rewards through the linked quest, or directly for extra sessions
    const quest = session.questId ? await questRepository.get(session.questId) : undefined;
    if (quest && quest.status === 'pending') {
      await applyCompletion(tx, quest);
    } else if (completedSets.length) {
      const values = computeQuestValues({ difficulty: 3, durationMin, importance: 3, rarity: 'common', category: 'fitness' }, tx.level, tx.settings.rules);
      tx.addXp(values.xp, `Extra workout: ${session.name}`, session.id);
      tx.addCoins(values.coins, `Extra workout: ${session.name}`, session.id);
      tx.addStats({ strength: 2, discipline: 1 });
      tx.applyEnergy(values.energyCost, 'Workout', session.id);
      tx.events.push({ type: 'toast', text: `Extra workout logged: +${values.xp} XP`, icon: '🏋️', tone: 'success' });
      finished.xp = values.xp;
      finished.coins = values.coins;
    }
    await workoutRepository.putSession(finished);

    const fired = evaluateRules(
      tx.settings.rules.smartRules,
      'workout_completed',
      { workoutCompleted: true, allSetsCompleted: allDone, avgRpe: avgRpe ?? 2, consecutiveFailedSessions: worstFails },
      new Set(),
    );
    const increases = analyzed.filter((e) => e.suggestion?.action === 'increase').length;
    const deloads = analyzed.filter((e) => e.suggestion?.action === 'deload').length;
    for (const r of fired) {
      if (r.action.type === 'suggestProgression' && increases > 0) {
        tx.events.push({ type: 'coach', text: `Progression unlocked on ${increases} exercise${increases > 1 ? 's' : ''}. Review the suggestions.`, icon: '📈' });
      }
      if (r.action.type === 'suggestDeload' && deloads > 0) {
        tx.events.push({ type: 'coach', text: 'A few tough sessions in a row. A short deload is suggested — smart, not soft.', icon: '🧯' });
      }
    }

    await settleDay(tx);
    await tx.commit();
    return {
      events: tx.events,
      features: tx.unlockedFeatures,
      summary: { session: finished, completedSets: completedSets.length, totalSets: allSets.length, volume, durationMin, avgRpe },
    };
  });
}

/** Apply or decline a progression suggestion. Nothing changes without explicit consent. */
export async function decideSuggestion(sessionId: ID, exerciseId: ID, accept: boolean): Promise<WorkoutSession | undefined> {
  return withTransaction(async () => {
    const s = await workoutRepository.getSession(sessionId);
    if (!s) return undefined;
    const exercises = s.exercises.map((e) => {
      if (e.exerciseId !== exerciseId || !e.suggestion) return e;
      return { ...e, decision: accept ? ('accepted' as const) : ('declined' as const) };
    });
    const ex = exercises.find((e) => e.exerciseId === exerciseId);
    if (accept && ex?.suggestion && ex.suggestion.action !== 'none') {
      await workoutRepository.states.put({
        exerciseId,
        workingWeight: ex.suggestion.nextWeight,
        repMin: ex.suggestion.repMin,
        repMax: ex.suggestion.repMax,
        updatedAt: clock.now(),
      });
    }
    const next = { ...s, exercises };
    await workoutRepository.putSession(next);
    return next;
  });
}

export async function setWorkingWeight(exerciseId: ID, weight: number, repMin?: number, repMax?: number): Promise<void> {
  const current = await workoutRepository.states.get(exerciseId);
  const def = await workoutRepository.exercises.get(exerciseId);
  await workoutRepository.states.put({
    exerciseId,
    workingWeight: weight,
    repMin: repMin ?? current?.repMin ?? def?.repMin ?? 8,
    repMax: repMax ?? current?.repMax ?? def?.repMax ?? 12,
    updatedAt: clock.now(),
  });
}

/** Log a cardio program session and evaluate the weekly progression. */
export async function logCardio(input: CardioLog): Promise<QuestResult> {
  const settings = await settingsRepository.get();
  if (!settings) throw new Error('Game not initialised');
  const stage = cardioStage(settings);
  const today = clock.today();
  const result = await withTransaction(async () => {
    const tx = await GameTx.open(today);
    const session: WorkoutSession = {
      id: uid('ws_'),
      date: today,
      name: stage.name,
      kind: 'cardio',
      startedAt: tx.now - input.durationMin * 60000,
      endedAt: tx.now,
      status: 'completed',
      exercises: [],
      cardio: { ...input, stageId: stage.id },
    };
    const quest = (await questRepository.byDate(today)).find((q) => q.activityId === 'cardio_session' && q.status === 'pending');
    session.questId = quest?.id;
    await workoutRepository.putSession(session);
    if (input.completed) {
      tx.inc({ [C.cardioSessions]: 1, ...(stage.intensity === 'run' ? { [C.cardioRuns]: 1 } : {}) });
      if (quest) await applyCompletion(tx, quest);
    }
    await settleDay(tx);
    await tx.commit();
    return { events: tx.events, features: tx.unlockedFeatures };
  });
  if (input.distanceKm) {
    const r = await logMetric('distance', input.distanceKm);
    result.events.push(...r.events);
  }
  await evaluateCardioProgress();
  return result;
}

/** Offer a stage change once a week has enough data. */
export async function evaluateCardioProgress(): Promise<void> {
  const settings = await settingsRepository.get();
  if (!settings?.cardio.enabled) return;
  const today = clock.today();
  const sessions = (await workoutRepository.sessionsRange(weekStart(today), weekEnd(today))).filter((s) => s.kind === 'cardio' && s.cardio);
  const stage = cardioStage(settings);
  if (sessions.length < stage.sessionsPerWeek) return;
  const weeksAtStage = settings.cardio.stageStartedOn ? Math.floor((Date.parse(today) - Date.parse(settings.cardio.stageStartedOn)) / (7 * 86400000)) + 1 : 1;
  const done = sessions.filter((s) => s.cardio!.completed);
  const decision = evaluateCardioWeek(
    settings.cardio.stageIndex,
    DEFAULT_CARDIO_STAGES,
    {
      planned: stage.sessionsPerWeek,
      completed: done.length,
      avgDifficulty: done.length ? mean(done.map((s) => s.cardio!.difficulty)) : null,
      weeksAtStage,
    },
    settings.safety.maxCardioIncreasePct,
  );
  if (decision.action === 'hold') return;
  const next = DEFAULT_CARDIO_STAGES[decision.nextIndex];
  await suggestionRepository.offer({
    id: uid('sg_'),
    key: `cardio:${weekStart(today)}`,
    type: 'cardioStage',
    title: decision.action === 'advance' ? `Level up cardio: ${next.name}?` : `Step back to ${next.name}?`,
    body: decision.reason,
    payload: { stageIndex: decision.nextIndex },
    status: 'pending',
    createdAt: clock.now(),
  });
}

export function sessionStats(s: WorkoutSession): { sets: number; volume: number; durationMin: number } {
  const done = s.exercises.flatMap((e) => e.sets.filter((x) => x.completed));
  return {
    sets: done.length,
    volume: Math.round(done.reduce((sum, x) => sum + x.weight * x.reps, 0)),
    durationMin: s.endedAt ? Math.round((s.endedAt - s.startedAt) / 60000) : 0,
  };
}

export { analyzeExercise };
