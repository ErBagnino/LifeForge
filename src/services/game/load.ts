import { importantCap } from '@/domain/adaptive';
import {
  balanceLoad,
  type BalanceItem,
  type CapacityResult,
  type CapacitySample,
  computeCapacity,
  type DayKind,
  loadLevel,
  loadScore,
} from '@/domain/capacity';
import { capacityAdjustment, loadModeFor } from '@/domain/schedule';
import { metaRepository, questRepository, statsRepository } from '@/repositories';
import type { Activity, DayLog, DayPlan, DifficultyState, ISODate, LoadMode, Player, Quest, QuestTier, Settings, WorkloadLevel } from '@/types';
import { blockMinutes, daysBetween, gameDate, shiftDate } from '@/utils/date';

export function dayKind(plan: DayPlan): DayKind {
  if (plan.dayType === 'rest') return 'rest';
  const status = plan.workStatus ?? (plan.dayType === 'work' ? 'set' : 'off');
  if (status === 'off') return 'free';
  if (status === 'unknown') return 'unknown';
  return 'work';
}

/** Net work minutes the player actually told us about (never assumed). */
export function knownWorkMinutes(plan: DayPlan): number | undefined {
  if (plan.workMinutes !== undefined) return plan.workMinutes;
  if (plan.work) return Math.max(0, blockMinutes(plan.work.start, plan.work.end) - (plan.breakMin ?? 0));
  return undefined;
}

const COUNTS_AS_PLANNED = (q: Quest) => q.status !== 'moved' && (q.tier === 'core' || q.tier === 'important') && !q.goal;

/** Past days as capacity samples (newest first). Uses stored figures, or rebuilds them from quests for old logs. */
export async function capacityHistory(date: ISODate, days = 28): Promise<CapacitySample[]> {
  const from = shiftDate(date, -days);
  const to = shiftDate(date, -1);
  const [logs, quests] = await Promise.all([statsRepository.logs(from, to), questRepository.byRange(from, to)]);
  return logs
    .filter((l) => l.closed)
    .map((l): CapacitySample => {
      const mine = quests.filter((q) => q.date === l.date && !q.endDate);
      return {
        date: l.date,
        kind: sampleKind(l),
        plannedMin: l.plannedMin ?? mine.filter(COUNTS_AS_PLANNED).reduce((s, q) => s + q.durationMin, 0),
        completedMin: l.completedMin ?? mine.filter((q) => q.status === 'completed').reduce((s, q) => s + q.durationMin, 0),
        freeMin: l.freeMin,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function sampleKind(l: DayLog): DayKind {
  if (l.restDay) return 'rest';
  if (l.workStatus === 'unknown') return 'unknown';
  if (l.workStatus === 'off') return 'free';
  if (l.workStatus === 'set' || l.workStatus === 'partial') return 'work';
  return l.dayType === 'work' ? 'work' : 'free';
}

/** Day number since the adventure started (0 = day 1). */
export async function adventureDay(date: ISODate, player: Player, settings: Settings): Promise<number> {
  const start = (await metaRepository.get<string>('adventureStart')) ?? gameDate(player.createdAt, settings.dayStartHour);
  return Math.max(0, daysBetween(start, date));
}

export interface DayLoadInput {
  settings: Settings;
  plan: DayPlan;
  date: ISODate;
  energy: number;
  maxEnergy: number;
  history: CapacitySample[];
  dayIndex: number;
  /** Every day-scoped quest of the date (any status). */
  quests: Quest[];
  activities: Activity[];
  state?: DifficultyState;
}

export interface DayLoad {
  capacity: CapacityResult;
  mode: LoadMode;
  /** Balancing decisions for pending scheduled/workout quests. */
  decisions: Map<string, { tier: QuestTier; lightened: boolean; reason?: string }>;
  plannedMin: number;
  leftoverMin: number;
  score: number;
  level: WorkloadLevel;
}

const balanceable = (q: Quest) => q.status === 'pending' && (q.kind === 'scheduled' || q.kind === 'workout') && !q.goal;

/** Capacity + priority balancing for a day. Pure given its inputs. */
export function computeDayLoad(input: DayLoadInput): DayLoad {
  const { settings, plan, date } = input;
  const awakeMin = blockMinutes(plan.wake, plan.sleep);
  const capacity = computeCapacity({
    kind: dayKind(plan),
    awakeMin,
    workMin: knownWorkMinutes(plan),
    busyMin: plan.busy.reduce((s, b) => s + blockMinutes(b.start, b.end), 0),
    energy: input.energy,
    maxEnergy: input.maxEnergy,
    history: input.history,
    adjustment: capacityAdjustment(settings.exceptions, date),
    dayIndex: input.dayIndex,
  });
  const mode = loadModeFor(settings, date);
  const importance = (q: Quest) => input.activities.find((a) => a.id === q.activityId)?.importance ?? (q.kind === 'workout' ? 5 : 3);
  const items: BalanceItem[] = input.quests.filter(balanceable).map((q) => ({
    id: q.id,
    tier: q.baseTier ?? q.tier,
    importance: importance(q),
    durationMin: q.durationMin,
    protected: q.kind === 'workout' || !!q.metric || !!q.private,
    kept: q.kept,
  }));
  // Completed/skipped quests already used (or freed) part of the day.
  const doneMin = input.quests.filter((q) => q.status === 'completed' && COUNTS_AS_PLANNED(q)).reduce((s, q) => s + q.durationMin, 0);
  const firstPass = balanceLoad(items, Math.max(0, capacity.minutes - doneMin), mode);
  const provisional = loadScore(firstPass.plannedMin + doneMin, capacity.minutes, input.energy, input.maxEnergy);
  const cap = input.state ? importantCap(loadLevel(provisional), input.state, settings.rules.generator) : undefined;
  const result = cap !== undefined && mode === 'auto' ? balanceLoad(items, Math.max(0, capacity.minutes - doneMin), mode, { importantCap: cap }) : firstPass;
  const plannedMin = result.plannedMin + doneMin;
  const score = loadScore(plannedMin, capacity.minutes, input.energy, input.maxEnergy);
  return {
    capacity,
    mode,
    decisions: new Map(result.decisions.map((d) => [d.id, d])),
    plannedMin,
    leftoverMin: result.leftoverMin,
    score,
    level: loadLevel(score),
  };
}

/** Apply balancing decisions to quests (in place), remembering their original tier. */
export function applyDecisions(quests: Quest[], load: DayLoad): Quest[] {
  const changed: Quest[] = [];
  for (const q of quests) {
    const d = load.decisions.get(q.id);
    if (!d) continue;
    const baseTier = q.baseTier ?? q.tier;
    const lightened = d.lightened && !q.kept;
    const tier = lightened ? d.tier : baseTier;
    const reason = lightened ? d.reason : q.lightened ? undefined : q.reason;
    if (q.tier !== tier || !!q.lightened !== lightened || q.baseTier !== baseTier) {
      Object.assign(q, { tier, lightened, baseTier, reason });
      changed.push(q);
    }
  }
  return changed;
}
