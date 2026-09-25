import type { HpRules, PenaltyRecord } from '@/types';
import { clamp } from '@/utils/math';

export const MAX_HP = 100;

export interface QuestHpInput {
  tier: 'core' | 'important' | 'optional';
  recovery: boolean;
  gainedToday: number;
  recoveryMode: boolean;
}

/** HP gained from completing a quest, respecting the daily gain cap. */
export function hpForQuest(input: QuestHpInput, rules: HpRules): number {
  let gain = 0;
  if (input.tier === 'core') gain += rules.coreComplete;
  if (input.recovery) gain += rules.recoveryActivity;
  if (input.recoveryMode) gain *= rules.recoveryGainMultiplier;
  const room = Math.max(0, rules.dailyGainCap * (input.recoveryMode ? rules.recoveryGainMultiplier : 1) - input.gainedToday);
  return Math.min(gain, room);
}

export interface DayCloseHpInput {
  coreMissed: number;
  importantMissed: number;
  perfectCore: boolean;
  restDayWellManaged: boolean;
  sick: boolean;
  /** 7-day success ratio, null when not enough history. */
  consistency7d: number | null;
  streakMilestone: boolean;
  recoveryMode: boolean;
  penaltyMultiplier: number;
  penaltiesEnabled: boolean;
}

export interface HpChange {
  delta: number;
  gains: PenaltyRecord[];
  losses: PenaltyRecord[];
}

/**
 * HP change at day close. Losses are capped per day and heavily softened in Recovery Mode
 * so one bad day can never snowball into an endless punishment spiral.
 */
export function dayCloseHp(input: DayCloseHpInput, rules: HpRules): HpChange {
  const gains: PenaltyRecord[] = [];
  const losses: PenaltyRecord[] = [];
  const gainMult = input.recoveryMode ? rules.recoveryGainMultiplier : 1;

  if (input.perfectCore) gains.push({ kind: 'hp', amount: rules.perfectCoreDay * gainMult, reason: 'All core quests done' });
  if (input.restDayWellManaged) gains.push({ kind: 'hp', amount: rules.restDay * gainMult, reason: 'Rest day well managed' });
  if (input.streakMilestone) gains.push({ kind: 'hp', amount: rules.streakMilestone, reason: 'Streak milestone' });

  if (input.penaltiesEnabled && !input.sick) {
    const lossMult = input.penaltyMultiplier * (input.recoveryMode ? 0.25 : 1);
    if (input.coreMissed > 0) {
      losses.push({ kind: 'hp', amount: -input.coreMissed * rules.missedCore * lossMult, reason: `${input.coreMissed} core quest(s) missed` });
    }
    if (input.importantMissed > 0) {
      losses.push({
        kind: 'hp',
        amount: -input.importantMissed * rules.missedImportant * lossMult,
        reason: `${input.importantMissed} important quest(s) ignored`,
      });
    }
    if (input.consistency7d !== null && input.consistency7d < 0.4) {
      losses.push({ kind: 'hp', amount: -rules.lowConsistencyPenalty * lossMult, reason: 'Consistency dropped this week' });
    }
  }

  const totalLoss = Math.max(-rules.dailyLossCap, losses.reduce((s, l) => s + l.amount, 0));
  const totalGain = gains.reduce((s, g) => s + g.amount, 0);
  return {
    delta: Math.round(totalGain + totalLoss),
    gains: gains.map((g) => ({ ...g, amount: Math.round(g.amount) })),
    losses: losses.map((l) => ({ ...l, amount: Math.round(l.amount) })),
  };
}

export interface RecoveryTransition {
  hp: number;
  recoveryMode: boolean;
  entered: boolean;
  exited: boolean;
  knockedOut: boolean;
}

/**
 * HP 0 is a "knock-out": progress is never deleted — the player enters Recovery Mode
 * with a small HP cushion, penalties softened and essentials-only days.
 */
export function resolveRecovery(hp: number, recoveryMode: boolean, rules: HpRules): RecoveryTransition {
  let next = clamp(Math.round(hp), 0, MAX_HP);
  let knockedOut = false;
  if (next <= 0) {
    knockedOut = true;
    next = rules.recoveryThreshold;
  }
  if (!recoveryMode && (knockedOut || next < rules.recoveryThreshold)) {
    return { hp: next, recoveryMode: true, entered: true, exited: false, knockedOut };
  }
  if (recoveryMode && next >= rules.recoveryExit) {
    return { hp: next, recoveryMode: false, entered: false, exited: true, knockedOut };
  }
  return { hp: next, recoveryMode, entered: false, exited: false, knockedOut };
}

export type HpBand = 'thriving' | 'steady' | 'struggling' | 'critical';

export function hpBand(hp: number): HpBand {
  if (hp >= 80) return 'thriving';
  if (hp >= 50) return 'steady';
  if (hp >= 25) return 'struggling';
  return 'critical';
}
