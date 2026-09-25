import type { CardioStage } from '@/types';

export interface CardioWeekSummary {
  planned: number;
  completed: number;
  /** Average perceived difficulty 1..4, null without data. */
  avgDifficulty: number | null;
  weeksAtStage: number;
  /** Completion ratio of the previous week, if known. */
  previousCompletion?: number;
}

export interface CardioDecision {
  action: 'advance' | 'hold' | 'step_back';
  nextIndex: number;
  reason: string;
}

/**
 * Gradual cardio progression. Advances at most one stage per week, only after a
 * well-completed and comfortable week, and never beyond the configured increase cap.
 */
export function evaluateCardioWeek(
  stageIndex: number,
  stages: CardioStage[],
  summary: CardioWeekSummary,
  maxIncreasePct: number,
): CardioDecision {
  const completion = summary.planned > 0 ? summary.completed / summary.planned : 0;
  const diff = summary.avgDifficulty ?? 2.5;
  const current = stages[stageIndex];

  if (completion < 0.5 && (summary.previousCompletion ?? 1) < 0.5 && stageIndex > 0) {
    return {
      action: 'step_back',
      nextIndex: stageIndex - 1,
      reason: 'Two light weeks in a row. Step back one stage and rebuild the habit first.',
    };
  }
  if (diff >= 3.5 && stageIndex > 0) {
    return {
      action: 'step_back',
      nextIndex: stageIndex - 1,
      reason: 'Sessions felt close to max. Go one stage easier — consistency beats heroics.',
    };
  }
  if (completion >= 0.8 && diff <= 2.3 && summary.weeksAtStage >= 1 && stageIndex < stages.length - 1) {
    const next = stages[stageIndex + 1];
    const sameKind = next.intensity === current.intensity;
    const increase = current.durationMin > 0 ? ((next.durationMin - current.durationMin) / current.durationMin) * 100 : 0;
    if (sameKind && increase > maxIncreasePct) {
      return {
        action: 'hold',
        nextIndex: stageIndex,
        reason: `Next stage would add ${Math.round(increase)}% — above your ${maxIncreasePct}% safety cap. Adjust the plan or the cap.`,
      };
    }
    return {
      action: 'advance',
      nextIndex: stageIndex + 1,
      reason: `${summary.completed}/${summary.planned} sessions done and they felt manageable. Ready for "${next.name}".`,
    };
  }
  if (completion >= 0.8) {
    return { action: 'hold', nextIndex: stageIndex, reason: 'Great consistency. Stay here until it feels comfortable.' };
  }
  return { action: 'hold', nextIndex: stageIndex, reason: 'Repeat this stage. Complete the planned sessions to move up.' };
}
