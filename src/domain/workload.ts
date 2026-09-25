import type { DayPlan, TimeBlock, WorkloadLevel } from '@/types';
import { blockMinutes, gameMinutes, hmToMinutes } from '@/utils/date';
import { clamp } from '@/utils/math';

export interface DayCapacity {
  awakeMin: number;
  workMin: number;
  busyMin: number;
  /** Awake minutes not taken by work or busy blocks. */
  freeMin: number;
}

export function dayCapacity(plan: Pick<DayPlan, 'wake' | 'sleep' | 'work' | 'busy'>): DayCapacity {
  const awakeMin = blockMinutes(plan.wake, plan.sleep);
  const workMin = plan.work ? blockMinutes(plan.work.start, plan.work.end) : 0;
  const busyMin = plan.busy.reduce((s, b) => s + blockMinutes(b.start, b.end), 0);
  return { awakeMin, workMin, busyMin, freeMin: Math.max(0, awakeMin - workMin - busyMin) };
}

export interface WorkloadInput {
  capacity: DayCapacity;
  questMinutes: number;
  questEnergy: number;
  workoutScheduled: boolean;
  energyStart: number;
}

export interface WorkloadResult {
  score: number;
  level: WorkloadLevel;
  freeAfterQuestsMin: number;
}

/**
 * Day load 0–100. A 10h workday alone lands around 55 ("medium"); adding a workout and a
 * long quest list pushes it into "high", which protects the core and trims side quests.
 */
export function computeWorkload(input: WorkloadInput): WorkloadResult {
  const { capacity } = input;
  const work = (capacity.workMin / 600) * 55;
  const busy = (capacity.busyMin / 60) * 6;
  const questShare = capacity.freeMin > 0 ? input.questMinutes / capacity.freeMin : 1;
  const quests = clamp(questShare, 0, 1.5) * 25;
  const workout = input.workoutScheduled ? 6 : 0;
  const fatigue = input.energyStart < 50 ? ((50 - input.energyStart) / 50) * 15 : 0;
  const score = Math.round(clamp(work + busy + quests + workout + fatigue, 0, 100));
  return {
    score,
    level: workloadLevel(score),
    freeAfterQuestsMin: Math.max(0, capacity.freeMin - input.questMinutes),
  };
}

export function workloadLevel(score: number): WorkloadLevel {
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function blocksOf(plan: Pick<DayPlan, 'work' | 'busy'>): TimeBlock[] {
  return [...(plan.work ? [plan.work] : []), ...plan.busy];
}

/** Is `nowMin` (minutes since midnight) inside work or a busy block? */
export function activeBlock(plan: Pick<DayPlan, 'work' | 'busy'>, nowMin: number): TimeBlock | undefined {
  return blocksOf(plan).find((b) => {
    const s = hmToMinutes(b.start);
    const e = hmToMinutes(b.end);
    return e >= s ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
  });
}

/** Free minutes from now until the next block starts or bedtime. */
export function freeMinutesUntilNextBlock(
  plan: Pick<DayPlan, 'work' | 'busy' | 'sleep'>,
  nowMin: number,
  dayStartHour = 4,
): number {
  if (activeBlock(plan, nowMin)) return 0;
  const toGame = (m: number) => (m < dayStartHour * 60 ? m + 1440 : m);
  const now = toGame(nowMin);
  let limit = gameMinutes(plan.sleep, dayStartHour);
  for (const b of blocksOf(plan)) {
    const s = gameMinutes(b.start, dayStartHour);
    if (s > now && s < limit) limit = s;
  }
  return Math.max(0, limit - now);
}

/** Minutes of free time left today from now (excluding blocks). */
export function freeMinutesLeftToday(plan: Pick<DayPlan, 'work' | 'busy' | 'sleep'>, nowMin: number, dayStartHour = 4): number {
  const toGame = (m: number) => (m < dayStartHour * 60 ? m + 1440 : m);
  const now = toGame(nowMin);
  const end = gameMinutes(plan.sleep, dayStartHour);
  if (end <= now) return 0;
  let busy = 0;
  for (const b of blocksOf(plan)) {
    const s = Math.max(now, gameMinutes(b.start, dayStartHour));
    const e = Math.min(end, gameMinutes(b.end, dayStartHour));
    if (e > s) busy += e - s;
  }
  return Math.max(0, end - now - busy);
}
