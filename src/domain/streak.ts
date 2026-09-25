import type { ISODate, Quest, StreakRules, StreakState } from '@/types';
import { daysBetween } from '@/utils/date';

export function createStreak(): StreakState {
  return { current: 0, longest: 0, frozenDates: [], weekly: { current: 0, longest: 0 } };
}

export interface DaySuccessInput {
  score: number;
  threshold: number;
  restDay: boolean;
  coreDone: number;
  coreTotal: number;
}

/** A day keeps the streak alive when the score clears the difficulty threshold (or a rest day's essentials are done). */
export function isDaySuccess(input: DaySuccessInput): boolean {
  if (input.restDay) return input.coreTotal === 0 || input.coreDone >= input.coreTotal;
  return input.score >= input.threshold;
}

export type StreakEvent = 'extended' | 'frozen' | 'protected' | 'broken' | 'none';

export interface StreakResult {
  streak: StreakState;
  event: StreakEvent;
  usedFreeze: boolean;
  milestone?: number;
}

/**
 * Apply one closed day to the streak.
 * - success → +1 (milestones reported)
 * - fail with a Streak Freeze → streak preserved, freeze consumed
 * - sick day → preserved for free
 * - otherwise → broken (the old value is remembered for a Streak Revive)
 */
export function applyDayToStreak(
  state: StreakState,
  date: ISODate,
  outcome: { success: boolean; sick: boolean },
  freezesAvailable: number,
  rules: StreakRules,
): StreakResult {
  const streak: StreakState = { ...state, frozenDates: [...state.frozenDates], weekly: { ...state.weekly } };
  if (outcome.success) {
    streak.current += 1;
    streak.longest = Math.max(streak.longest, streak.current);
    streak.lastSuccessDate = date;
    const milestone = rules.milestones.includes(streak.current) ? streak.current : undefined;
    return { streak, event: 'extended', usedFreeze: false, milestone };
  }
  if (outcome.sick) {
    streak.frozenDates = [...streak.frozenDates.slice(-30), date];
    return { streak, event: 'protected', usedFreeze: false };
  }
  if (streak.current > 0 && freezesAvailable > 0) {
    streak.frozenDates = [...streak.frozenDates.slice(-30), date];
    return { streak, event: 'frozen', usedFreeze: true };
  }
  if (streak.current === 0) return { streak, event: 'none', usedFreeze: false };
  streak.brokenValue = streak.current;
  streak.brokenAt = date;
  streak.current = 0;
  return { streak, event: 'broken', usedFreeze: false };
}

export function canRevive(state: StreakState, today: ISODate, rules: StreakRules): boolean {
  if (!state.brokenAt || !state.brokenValue) return false;
  return daysBetween(state.brokenAt, today) <= rules.reviveWindowDays;
}

/** Restore the broken streak, keeping any days earned since the break. */
export function reviveStreak(state: StreakState): StreakState {
  if (!state.brokenValue) return state;
  const current = state.brokenValue + state.current;
  return {
    ...state,
    current,
    longest: Math.max(state.longest, current),
    brokenValue: undefined,
    brokenAt: undefined,
  };
}

/** Weekly streak: a week counts when enough days in it were successful. */
export function applyWeekToStreak(state: StreakState, weekKey: string, success: boolean): StreakState {
  if (state.weekly.lastWeekKey === weekKey) return state;
  const weekly = success
    ? { current: state.weekly.current + 1, longest: Math.max(state.weekly.longest, state.weekly.current + 1), lastWeekKey: weekKey }
    : { current: 0, longest: state.weekly.longest, lastWeekKey: weekKey };
  return { ...state, weekly };
}

/**
 * Consecutive completed occurrences of an activity, newest first.
 * Today's still-pending occurrence does not break the streak.
 */
export function activityStreak(quests: Quest[], today: ISODate): number {
  const sorted = [...quests].sort((a, b) => (a.date < b.date ? 1 : -1));
  let count = 0;
  for (const q of sorted) {
    if (q.status === 'moved') continue;
    if (q.status === 'completed') count++;
    else if (q.date === today && q.status === 'pending') continue;
    else if (q.skipReason === 'sick') continue;
    else break;
  }
  return count;
}

export const STREAK_BADGES = [3, 7, 14, 30, 50, 100, 150, 200, 365];

export function nextStreakMilestone(current: number, milestones: number[]): number | undefined {
  return milestones.find((m) => m > current);
}
