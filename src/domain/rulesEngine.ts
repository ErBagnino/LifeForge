import type { RuleCondition, RuleDef, RuleTrigger } from '@/types';

export type FactValue = number | string | boolean | undefined;
export type Facts = Record<string, FactValue>;

/** Facts the engine understands, with human descriptions for the Game Rules editor. */
export const FACT_CATALOG: Record<string, { label: string; type: 'number' | 'boolean' | 'string' }> = {
  completionRate: { label: 'Today completion rate (0–1)', type: 'number' },
  coreCompletion: { label: 'Core completion (0–1)', type: 'number' },
  pendingCore: { label: 'Core quests still open', type: 'number' },
  energy: { label: 'Energy', type: 'number' },
  hp: { label: 'HP', type: 'number' },
  workload: { label: 'Workload (0–100)', type: 'number' },
  hour: { label: 'Hour of day', type: 'number' },
  score: { label: 'Today score', type: 'number' },
  streak: { label: 'Streak days', type: 'number' },
  streakAtRisk: { label: 'Streak at risk', type: 'boolean' },
  recoveryMode: { label: 'Recovery mode', type: 'boolean' },
  dayType: { label: 'Day type (work/free/rest)', type: 'string' },
  workoutCompleted: { label: 'Workout completed', type: 'boolean' },
  allSetsCompleted: { label: 'All sets completed', type: 'boolean' },
  avgRpe: { label: 'Average RPE (1 easy – 4 max)', type: 'number' },
  consecutiveFailedSessions: { label: 'Consecutive failed sessions (worst lift)', type: 'number' },
  completion7d: { label: '7-day completion rate', type: 'number' },
};

export function checkCondition(cond: RuleCondition, facts: Facts): boolean {
  const v = facts[cond.fact];
  if (v === undefined) return false;
  switch (cond.op) {
    case 'eq':
      return v === cond.value;
    case 'neq':
      return v !== cond.value;
    case 'gt':
      return typeof v === 'number' && typeof cond.value === 'number' && v > cond.value;
    case 'gte':
      return typeof v === 'number' && typeof cond.value === 'number' && v >= cond.value;
    case 'lt':
      return typeof v === 'number' && typeof cond.value === 'number' && v < cond.value;
    case 'lte':
      return typeof v === 'number' && typeof cond.value === 'number' && v <= cond.value;
  }
}

/**
 * Evaluate the centralized smart rules for a trigger.
 * Returns the rules whose conditions all hold (and that have not already fired today, when once-per-day).
 */
export function evaluateRules(rules: RuleDef[], trigger: RuleTrigger, facts: Facts, firedToday: Set<string>): RuleDef[] {
  return rules.filter(
    (r) =>
      r.enabled &&
      r.trigger === trigger &&
      !(r.oncePerDay && firedToday.has(r.id)) &&
      r.conditions.every((c) => checkCondition(c, facts)),
  );
}

export const OPERATOR_LABELS: Record<RuleCondition['op'], string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
};

export function describeRule(rule: RuleDef): string {
  const when = rule.conditions
    .map((c) => `${FACT_CATALOG[c.fact]?.label ?? c.fact} ${OPERATOR_LABELS[c.op]} ${String(c.value)}`)
    .join(' AND ');
  return `IF ${when || 'always'} THEN ${rule.action.type}`;
}
