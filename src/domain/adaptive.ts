import type {
  AdaptiveRules,
  DayType,
  DifficultyPreset,
  DifficultyState,
  GeneratorRules,
  Importance,
  QuestTier,
  WorkloadLevel,
} from '@/types';
import { clamp } from '@/utils/math';

export interface DifficultyStateInput {
  workload: number;
  energy: number;
  /** 7-day completion rate 0..1, null when there is no history yet. */
  completion7d: number | null;
  missedCore3d: number;
  hp: number;
  recoveryMode: boolean;
}

/**
 * "Ruthless but reasonable": the game pushes when things are too easy and backs off
 * when the day (or the week) is already heavy.
 */
export function computeDifficultyState(input: DifficultyStateInput, rules: AdaptiveRules): DifficultyState {
  if (
    input.recoveryMode ||
    input.hp < rules.criticalHp ||
    (input.workload >= rules.criticalWorkload && input.energy < rules.criticalEnergy + 15) ||
    input.energy < rules.criticalEnergy
  ) {
    return 'critical';
  }
  if (
    input.workload >= rules.overloadWorkload ||
    input.energy < rules.overloadEnergy ||
    (input.completion7d !== null && input.completion7d < rules.overloadCompletion) ||
    input.missedCore3d >= 4
  ) {
    return 'overloaded';
  }
  if (
    input.completion7d !== null &&
    input.completion7d >= rules.tooEasyCompletion &&
    input.workload < rules.tooEasyMaxWorkload &&
    input.energy >= rules.tooEasyMinEnergy
  ) {
    return 'too_easy';
  }
  return 'balanced';
}

export const DIFFICULTY_STATE_INFO: Record<DifficultyState, { label: string; icon: string; description: string }> = {
  too_easy: { label: 'Too easy', icon: '🌶️', description: 'You are cruising. Extra challenge unlocked.' },
  balanced: { label: 'Balanced', icon: '⚖️', description: 'Normal behaviour. Keep the rhythm.' },
  overloaded: { label: 'Overloaded', icon: '🧯', description: 'Side quests reduced. Protect the core.' },
  critical: { label: 'Critical', icon: '🛡️', description: 'Essentials only. Survive today, win tomorrow.' },
};

export interface SideQuestBudget {
  count: number;
  maxDuration: number;
  energyBudget: number;
  /** Rarity boost for the daily challenge (0 = none). */
  challengeBoost: number;
  challenge: boolean;
}

export interface BudgetInput {
  workloadLevel: WorkloadLevel;
  state: DifficultyState;
  preset: DifficultyPreset;
  extraSlots: number;
  energyAfterCore: number;
  freeAfterQuestsMin: number;
  dayType: DayType;
}

/** How many side quests the generator may propose, and how big they may be. */
export function sideQuestBudget(input: BudgetInput, rules: GeneratorRules): SideQuestBudget {
  let count = rules.sideQuestsByWorkload[input.workloadLevel] + input.preset.sideQuestDelta + input.extraSlots;
  let maxDuration = rules.maxDurationByWorkload[input.workloadLevel];
  let challengeBoost = 0;
  let challenge = rules.challengeEnabled;

  switch (input.state) {
    case 'too_easy':
      count += 2;
      maxDuration += 15;
      challengeBoost = 2;
      break;
    case 'overloaded':
      count = Math.min(count, 1);
      maxDuration = Math.min(maxDuration, 10);
      break;
    case 'critical':
      count = 0;
      challenge = false;
      break;
    case 'balanced':
      break;
  }
  if (input.dayType === 'rest') {
    count = Math.min(count, 1);
    maxDuration = Math.min(maxDuration, 15);
  }
  // Never suggest more than the free time can realistically hold.
  const byTime = Math.floor(input.freeAfterQuestsMin / Math.max(5, maxDuration * 0.6));
  count = clamp(Math.min(count, byTime), 0, 6);
  const energyBudget = Math.max(0, input.energyAfterCore - 10);
  if (energyBudget < 5) count = Math.min(count, input.state === 'too_easy' ? 1 : 0);
  return { count, maxDuration, energyBudget, challengeBoost, challenge };
}

/** Max number of effortful core quests for a day. A 10h workday keeps 3–5 realistic ones. */
export function coreCap(workloadLevel: WorkloadLevel, state: DifficultyState, rules: GeneratorRules): number {
  if (state === 'critical') return Math.min(3, rules.maxCoreByWorkload.high);
  return rules.maxCoreByWorkload[workloadLevel];
}

/** Max number of effortful important quests for a day. */
export function importantCap(workloadLevel: WorkloadLevel, state: DifficultyState, rules: GeneratorRules): number {
  if (state === 'critical') return 0;
  const cap = rules.maxImportantByWorkload[workloadLevel];
  return state === 'overloaded' ? Math.max(1, cap - 2) : cap;
}

export interface CappableQuest {
  id: string;
  tier: QuestTier;
  importance: Importance;
  durationMin: number;
  /** Planned workouts and auto-tracked quests are kept first. */
  protected?: boolean;
}

/** Quests this short never make a day heavier — they are exempt from caps. */
export const TRIVIAL_MINUTES = 5;

/**
 * Keep the most important quests of a tier; return the ids to demote so heavy days stay winnable.
 * Trivial quests (≤ 5 min) are exempt: the cap is about effort, not about brushing your teeth.
 */
export function selectDemotions(quests: CappableQuest[], cap: number, tier: QuestTier = 'core'): string[] {
  const list = quests.filter((q) => q.tier === tier && q.durationMin > TRIVIAL_MINUTES);
  if (list.length <= cap) return [];
  const ranked = [...list].sort((a, b) => Number(!!b.protected) - Number(!!a.protected) || b.importance - a.importance || a.durationMin - b.durationMin);
  return ranked.slice(cap).map((q) => q.id);
}
