import type { DayType, Quest, WorkloadLevel } from '@/types';
import { gameMinutes } from '@/utils/date';
import { isRecoveryCategory } from './rewards';

export interface NextActionContext {
  now: number;
  nowMin: number;
  energy: number;
  /** Free minutes until the next busy block or bedtime. */
  freeMinutes: number;
  inBlock: boolean;
  dayType: DayType;
  streakAtRisk: boolean;
  workloadLevel: WorkloadLevel;
  dayStartHour: number;
  /** False when today's work hours are unknown: no "free day" assumptions. */
  workKnown?: boolean;
}

export interface NextAction {
  quest: Quest;
  score: number;
  reason: string;
}

export function isActionable(q: Quest, now: number): boolean {
  return (
    q.status === 'pending' &&
    !q.hidden &&
    q.kind !== 'weekly' &&
    q.kind !== 'boss' &&
    (!q.snoozedUntil || q.snoozedUntil <= now)
  );
}

const NIGHT_CATEGORIES = new Set(['skincare', 'personal_care', 'sleep', 'rest', 'reading', 'mental_wellbeing']);

/** Score every actionable quest; the highest is the "NEXT ACTION". */
export function rankActions(quests: Quest[], ctx: NextActionContext): NextAction[] {
  const now = ctx.nowMin < ctx.dayStartHour * 60 ? ctx.nowMin + 1440 : ctx.nowMin;
  const lateNight = now >= 21 * 60 + 30;

  return quests
    .filter((q) => isActionable(q, ctx.now))
    .map((q) => {
      const reasons: { text: string; weight: number }[] = [];
      let score = q.tier === 'core' ? 30 : q.tier === 'important' ? 18 : 8;
      if (q.kind === 'challenge') score += 6;

      if (q.scheduledTime) {
        const diff = gameMinutes(q.scheduledTime, ctx.dayStartHour) - now;
        if (diff < 0) {
          const bonus = (20 + Math.min(20, -diff / 15)) * (q.tier === 'optional' ? 0.5 : 1);
          score += bonus;
          reasons.push({ text: `Planned for ${q.scheduledTime} — it's waiting`, weight: bonus });
        } else if (diff <= 60) {
          const bonus = 15 - diff / 6;
          score += bonus;
          reasons.push({ text: `Scheduled at ${q.scheduledTime}`, weight: bonus });
        } else if (diff > 120) score -= 10;
      }

      if (ctx.inBlock) {
        if (q.durationMin <= 5) {
          score += 15;
          reasons.push({ text: 'Tiny enough to do right now', weight: 15 });
        } else if (q.durationMin > 10) score -= 30;
      } else if (q.durationMin <= ctx.freeMinutes) {
        score += 10;
        reasons.push({ text: `Fits your ${ctx.freeMinutes} free minutes`, weight: 6 });
      } else score -= 25;

      if (q.energyCost > 0 && q.energyCost > ctx.energy && q.tier !== 'core') score -= 15;
      else if (q.energyCost <= ctx.energy) score += 5;

      if (ctx.workloadLevel === 'high' && q.durationMin <= 10) {
        score += 8;
        reasons.push({ text: 'Heavy day: quick win first', weight: 8 });
      }
      if (ctx.dayType === 'free' && ctx.workKnown !== false && q.kind === 'workout') {
        score += 10;
        reasons.push({ text: 'Free day — perfect time to train', weight: 10 });
      }
      if (lateNight) {
        if (NIGHT_CATEGORIES.has(q.category) || isRecoveryCategory(q.category)) {
          score += 12;
          reasons.push({ text: 'Evening routine time', weight: 12 });
        }
        if (q.difficulty >= 4) score -= 20;
      }
      if (ctx.streakAtRisk && q.tier === 'core') {
        score += 10;
        reasons.push({ text: 'Keeps your streak alive', weight: 11 });
      }
      if (q.target && q.progress > 0 && q.progress < q.target) score += 4;
      score -= Math.min(10, q.snoozeCount * 2);

      reasons.sort((a, b) => b.weight - a.weight);
      const reason =
        reasons[0]?.text ?? (q.tier === 'core' ? 'Core quest — the backbone of today' : 'Good next step');
      return { quest: q, score, reason };
    })
    .sort((a, b) => b.score - a.score);
}

export function pickNextAction(quests: Quest[], ctx: NextActionContext): NextAction | undefined {
  return rankActions(quests, ctx)[0];
}
