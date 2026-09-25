import type {
  DayLog,
  GameDifficulty,
  GameRules,
  PenaltyRecord,
  Player,
  Quest,
  ScoreBreakdown,
  StatusEffect,
} from '@/types';
import { shiftDate } from '@/utils/date';
import { uid } from '@/utils/id';
import { dayCloseHp, type HpChange, MAX_HP, type RecoveryTransition, resolveRecovery } from './hp';
import { computeScore, countedQuests, type ScoreInput, tierCount } from './score';
import { applyDayToStreak, isDaySuccess, type StreakResult } from './streak';
import { worldIncome } from './tycoon';

export interface DayCloseInput {
  date: string;
  quests: Quest[];
  log: DayLog;
  player: Player;
  rules: GameRules;
  difficulty: GameDifficulty;
  score: Omit<ScoreInput, 'quests' | 'metrics' | 'restDay'>;
  worldDailyIncome: number;
}

export interface DayCloseResult {
  breakdown: ScoreBreakdown;
  success: boolean;
  perfectCore: boolean;
  allTiers: boolean;
  coreMissed: number;
  importantMissed: number;
  streak: StreakResult;
  hp: HpChange;
  recovery: RecoveryTransition;
  coinsDelta: number;
  penalties: PenaltyRecord[];
  effects: StatusEffect[];
  worldIncome: number;
  milestoneCoins: number;
  milestoneFreeze: number;
}

export function streakMilestoneCoins(milestone: number, base: number): number {
  return Math.round(base * Math.sqrt(milestone));
}

/**
 * Close a game day: final score, streak, HP, penalties and buffs.
 * Pure — the day service persists the result.
 */
export function closeDay(input: DayCloseInput): DayCloseResult {
  const { rules, log, player } = input;
  const preset = rules.difficultyPresets[input.difficulty];
  const penaltyMult = preset.penaltyMultiplier;
  const quests = countedQuests(input.quests);
  const breakdown = computeScore(
    { ...input.score, quests, metrics: log.metrics, restDay: log.restDay },
    rules.score,
  );
  const core = tierCount(quests, 'core');
  const important = tierCount(quests, 'important');
  const perfectCore = core.total > 0 && core.done === core.total;
  const allTiers = perfectCore && important.done === important.total;
  const coreMissed = core.total - core.done;
  const importantMissed = important.total - important.done;

  const success = isDaySuccess({
    score: breakdown.total,
    threshold: preset.streakThreshold,
    restDay: log.restDay,
    coreDone: core.done,
    coreTotal: core.total,
  });

  const streak = applyDayToStreak(
    player.streak,
    input.date,
    { success, sick: log.sick },
    player.inventory.streakFreeze,
    rules.streak,
  );

  const hp = dayCloseHp(
    {
      coreMissed,
      importantMissed,
      perfectCore,
      restDayWellManaged: log.restDay && perfectCore,
      sick: log.sick,
      consistency7d: input.score.consistency7d,
      streakMilestone: streak.milestone !== undefined,
      recoveryMode: player.recoveryMode,
      penaltyMultiplier: penaltyMult,
      penaltiesEnabled: rules.penalties.enabled,
    },
    rules.hp,
  );
  const recovery = resolveRecovery(Math.min(MAX_HP, player.hp + hp.delta), player.recoveryMode, rules.hp);

  const penalties: PenaltyRecord[] = [...hp.losses];
  const effects: StatusEffect[] = [];
  const tomorrow = shiftDate(input.date, 1);
  let coinsDelta = 0;

  const canPunish = rules.penalties.enabled && !log.sick && !player.recoveryMode;
  if (canPunish) {
    let loss = 0;
    if (coreMissed > 0) loss += coreMissed * rules.penalties.missedCoreCoins * penaltyMult;
    for (const q of quests) {
      if (q.tier === 'optional') continue;
      const extra = q.snoozeCount - rules.penalties.snoozeWarnAt;
      if (extra > 0) loss += extra * rules.penalties.procrastinationCoins * penaltyMult;
    }
    loss = Math.min(Math.round(loss), rules.penalties.coinLossCap, player.coins);
    if (loss > 0) {
      coinsDelta -= loss;
      penalties.push({ kind: 'coins', amount: -loss, reason: 'Missed / over-snoozed quests' });
    }
    if (!log.restDay && breakdown.total < rules.penalties.sluggishScoreThreshold && core.total > 0) {
      effects.push({
        id: uid('fx_'),
        kind: 'sluggish',
        label: 'Sluggish',
        icon: '🐌',
        description: `Low score yesterday: XP ×${rules.penalties.sluggishXpMultiplier} today. One good day clears it.`,
        xpMultiplier: rules.penalties.sluggishXpMultiplier,
        expiresOn: tomorrow,
      });
      penalties.push({ kind: 'debuff', amount: 0, reason: 'Sluggish debuff for tomorrow' });
    }
  }
  if (breakdown.total >= 90) {
    effects.push({
      id: uid('fx_'),
      kind: 'focused',
      label: 'Focused',
      icon: '🎯',
      description: 'Outstanding day: +5% XP tomorrow.',
      xpMultiplier: 1.05,
      expiresOn: tomorrow,
    });
  }
  if (recovery.exited) {
    effects.push({
      id: uid('fx_'),
      kind: 'comeback',
      label: 'Comeback',
      icon: '🦾',
      description: 'Back from Recovery Mode: +10% coins for 2 days.',
      coinMultiplier: 1.1,
      expiresOn: shiftDate(input.date, 2),
    });
  }
  if (streak.event === 'broken') {
    penalties.push({ kind: 'streak', amount: -(streak.streak.brokenValue ?? 0), reason: 'Streak broken (revive available for a few days)' });
  }

  const income = worldIncome(input.worldDailyIncome, breakdown.total);
  const milestoneCoins = streak.milestone ? streakMilestoneCoins(streak.milestone, rules.coins.streakMilestoneBase) : 0;
  const milestoneFreeze = streak.milestone && [7, 30, 100, 200, 365].includes(streak.milestone) ? 1 : 0;

  return {
    breakdown,
    success,
    perfectCore,
    allTiers,
    coreMissed,
    importantMissed,
    streak,
    hp,
    recovery,
    coinsDelta: coinsDelta + income + milestoneCoins,
    penalties,
    effects,
    worldIncome: income,
    milestoneCoins,
    milestoneFreeze,
  };
}

/** Successful days needed for the weekly streak. */
export function weeklyStreakTarget(difficulty: GameDifficulty): number {
  return difficulty === 'casual' || difficulty === 'normal' ? 4 : 5;
}
