import type { CoachTone } from '@/types';
import { hashString } from '@/utils/math';

export type InsightKind = 'praise' | 'warning' | 'info' | 'tip';

export interface Insight {
  id: string;
  icon: string;
  kind: InsightKind;
  text: string;
  priority: number;
}

export interface CoachData {
  seed: string;
  tone: CoachTone;
  hour: number;
  week: { coreRate: number | null; avgScore: number | null; prevAvgScore: number | null; days: number };
  bestWeekday?: { weekday: number; rate: number };
  hydration: { thisWeek: number | null; lastWeek: number | null };
  steps: { thisWeekAvg: number | null; lastWeekAvg: number | null };
  weight?: { trendPerWeek: number; goal: 'lose' | 'maintain' | 'gain' };
  improvements: { name: string; sessions: number }[];
  timeShifts: { name: string; weekday: string; weekend: string; laterOnWeekend: boolean }[];
  tomorrow?: { workload: number; level: 'low' | 'medium' | 'high' };
  streak: number;
  hp: number;
  energy: number;
  recoveryMode: boolean;
  snoozeHeavy?: { name: string; count: number };
  strongestCategory?: string;
  weakestCategory?: string;
  pendingCore: number;
  totalCore: number;
}

type Voices = Partial<Record<Exclude<CoachTone, 'balanced'>, string>> & { serious: string };

/** Choose phrasing by tone. "Balanced" rotates deterministically between motivational and ironic. */
export function voice(tone: CoachTone, seed: string, v: Voices): string {
  if (tone === 'balanced') {
    const pick = hashString(seed) % 3;
    return (pick === 0 ? v.motivational : pick === 1 ? v.ironic : v.serious) ?? v.serious;
  }
  return v[tone] ?? v.serious;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pct = (r: number) => `${Math.round(r * 100)}%`;
const cat = (c: string) => c.replace(/_/g, ' ');

/** Rule-based insights. No AI: every line is traceable to a number. */
export function generateInsights(d: CoachData): Insight[] {
  const out: Insight[] = [];
  const t = d.tone;
  const s = (id: string) => `${d.seed}:${id}`;

  if (d.week.coreRate !== null && d.week.days >= 3) {
    const r = d.week.coreRate;
    if (r >= 0.9) {
      out.push({
        id: 'core_high',
        icon: '🎯',
        kind: 'praise',
        priority: 70,
        text: voice(t, s('core_high'), {
          serious: `You completed ${pct(r)} of core quests this week.`,
          motivational: `${pct(r)} of core quests done this week. That's what consistency looks like.`,
          ironic: `${pct(r)} core completion. Are you sure you're human?`,
          provocative: `${pct(r)} core this week. Good. Now do it again next week.`,
        }),
      });
    } else if (r < 0.6) {
      out.push({
        id: 'core_low',
        icon: '🧱',
        kind: 'warning',
        priority: 80,
        text: voice(t, s('core_low'), {
          serious: `Core completion is at ${pct(r)} this week. Focus on the essentials before side quests.`,
          motivational: `${pct(r)} of core quests so far. Pick the smallest one and restart the engine.`,
          ironic: `Core at ${pct(r)}. The side quests are having a great week, at least.`,
          provocative: `${pct(r)} core. You know exactly which quest you're avoiding.`,
        }),
      });
    }
  }

  if (d.week.avgScore !== null && d.week.prevAvgScore !== null) {
    const delta = d.week.avgScore - d.week.prevAvgScore;
    if (Math.abs(delta) >= 6) {
      out.push({
        id: 'score_trend',
        icon: delta > 0 ? '📈' : '📉',
        kind: delta > 0 ? 'praise' : 'warning',
        priority: 55,
        text:
          delta > 0
            ? voice(t, s('score_up'), {
                serious: `Average score up ${Math.round(delta)} points vs last week.`,
                motivational: `Score up ${Math.round(delta)} points on last week. The curve is bending your way.`,
                ironic: `+${Math.round(delta)} points on last week. Suspiciously competent.`,
              })
            : voice(t, s('score_down'), {
                serious: `Average score down ${Math.round(-delta)} points vs last week.`,
                motivational: `Score dipped ${Math.round(-delta)} points. One strong day resets the trend.`,
                provocative: `Down ${Math.round(-delta)} points on last week. Last week-you is winning.`,
              }),
      });
    }
  }

  if (d.bestWeekday && d.bestWeekday.rate > 0) {
    out.push({
      id: 'best_day',
      icon: '📅',
      kind: 'info',
      priority: 30,
      text: `You complete more quests on ${DAY_NAMES[d.bestWeekday.weekday]} (${pct(d.bestWeekday.rate)}).`,
    });
  }

  if (d.hydration.thisWeek !== null && d.hydration.lastWeek !== null) {
    const diff = d.hydration.thisWeek - d.hydration.lastWeek;
    if (diff <= -0.2) {
      out.push({
        id: 'hydration_drop',
        icon: '💧',
        kind: 'warning',
        priority: 50,
        text: voice(t, s('hydration'), {
          serious: 'Hydration consistency dropped this week.',
          ironic: 'Hydration consistency dropped this week. Plants are judging you.',
          motivational: 'Hydration slipped this week — keep a bottle in sight and it fixes itself.',
        }),
      });
    } else if (diff >= 0.2) {
      out.push({ id: 'hydration_up', icon: '💧', kind: 'praise', priority: 35, text: 'Hydration consistency improved this week.' });
    }
  }

  if (d.steps.thisWeekAvg !== null && d.steps.lastWeekAvg !== null && d.steps.lastWeekAvg > 0) {
    const r = d.steps.thisWeekAvg / d.steps.lastWeekAvg - 1;
    if (Math.abs(r) >= 0.12) {
      out.push({
        id: 'steps_trend',
        icon: '👟',
        kind: r > 0 ? 'praise' : 'info',
        priority: 40,
        text: `Average steps ${r > 0 ? 'up' : 'down'} ${pct(Math.abs(r))} vs last week (${Math.round(d.steps.thisWeekAvg).toLocaleString('en-US')}/day).`,
      });
    }
  }

  for (const imp of d.improvements.filter((i) => i.sessions >= 3).slice(0, 2)) {
    out.push({
      id: `improve_${imp.name}`,
      icon: '💪',
      kind: 'praise',
      priority: 60,
      text: voice(t, s(imp.name), {
        serious: `Your ${imp.name} improved for ${imp.sessions} consecutive sessions.`,
        motivational: `${imp.name}: ${imp.sessions} sessions in a row of progress. Keep stacking.`,
        ironic: `${imp.name} up ${imp.sessions} sessions straight. The machine is scared of you.`,
      }),
    });
  }

  for (const shift of d.timeShifts.slice(0, 1)) {
    out.push({
      id: `shift_${shift.name}`,
      icon: '🕰️',
      kind: 'info',
      priority: 20,
      text: `You tend to do ${shift.name.toLowerCase()} ${shift.laterOnWeekend ? 'later' : 'earlier'} on weekends (${shift.weekend} vs ${shift.weekday}).`,
    });
  }

  if (d.tomorrow && d.tomorrow.level === 'high') {
    out.push({
      id: 'tomorrow_heavy',
      icon: '🧯',
      kind: 'tip',
      priority: 65,
      text: 'Tomorrow is a high-workload day. Side quests have been reduced — prep tonight to make it easy.',
    });
  } else if (d.tomorrow && d.tomorrow.level === 'low') {
    out.push({ id: 'tomorrow_light', icon: '🌤️', kind: 'tip', priority: 25, text: 'Tomorrow looks light. Bonus quests incoming.' });
  }

  if (d.weight && Math.abs(d.weight.trendPerWeek) >= 0.1) {
    const good =
      (d.weight.goal === 'lose' && d.weight.trendPerWeek < 0) ||
      (d.weight.goal === 'gain' && d.weight.trendPerWeek > 0);
    out.push({
      id: 'weight_trend',
      icon: '⚖️',
      kind: good ? 'praise' : 'info',
      priority: 35,
      text: `Weight trend: ${d.weight.trendPerWeek > 0 ? '+' : ''}${d.weight.trendPerWeek.toFixed(2)} kg/week${good ? ' — in line with your goal.' : '.'}`,
    });
  }

  if (d.snoozeHeavy && d.snoozeHeavy.count >= 3) {
    out.push({
      id: 'snooze_heavy',
      icon: '⏰',
      kind: 'warning',
      priority: 58,
      text: voice(t, s('snooze'), {
        serious: `"${d.snoozeHeavy.name}" was postponed ${d.snoozeHeavy.count} times recently. Consider making it smaller.`,
        ironic: `"${d.snoozeHeavy.name}" has been snoozed ${d.snoozeHeavy.count} times. It's starting to feel personal.`,
        provocative: `${d.snoozeHeavy.count} snoozes on "${d.snoozeHeavy.name}". Do it or delete it.`,
      }),
    });
  }

  if (d.strongestCategory && d.weakestCategory && d.strongestCategory !== d.weakestCategory) {
    out.push({
      id: 'categories',
      icon: '🧭',
      kind: 'info',
      priority: 22,
      text: `Strongest area: ${cat(d.strongestCategory)}. Most neglected: ${cat(d.weakestCategory)}.`,
    });
  }

  if (d.recoveryMode) {
    out.push({
      id: 'recovery',
      icon: '🩹',
      kind: 'tip',
      priority: 90,
      text: 'Recovery Mode is on: essentials only, penalties softened, HP heals faster. Small wins rebuild everything.',
    });
  } else if (d.streak >= 7) {
    out.push({
      id: 'streak',
      icon: '🔥',
      kind: 'praise',
      priority: 28,
      text: voice(t, s('streak'), {
        serious: `${d.streak}-day streak active.`,
        motivational: `${d.streak} days in a row. You're becoming the person who shows up.`,
        ironic: `${d.streak}-day streak. At this point it's basically a personality.`,
      }),
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** One contextual line for the Today header area. */
export function coachLine(d: Pick<CoachData, 'tone' | 'hour' | 'pendingCore' | 'totalCore' | 'energy' | 'seed' | 'recoveryMode'>): string {
  const t = d.tone;
  const s = `${d.seed}:line`;
  if (d.recoveryMode) return 'Recovery Mode. Tiny steps count double today.';
  if (d.totalCore > 0 && d.pendingCore === 0) {
    return voice(t, s, {
      serious: 'Core complete. Anything else is bonus.',
      motivational: 'Core complete! Everything from here is pure bonus.',
      ironic: 'Core complete. You may now act smug.',
      provocative: 'Core done. Stopping here, or are you hungry?',
    });
  }
  if (d.energy < 20) return voice(t, s, { serious: 'Energy low. Prioritise core quests and rest.', ironic: 'Running on fumes. Rest is a valid move.' });
  if (d.hour < 11) {
    return voice(t, s, {
      serious: `${d.pendingCore} core quests on the board.`,
      motivational: `New run. ${d.pendingCore} core quests between you and a great day.`,
      ironic: `Good morning. ${d.pendingCore} core quests are already staring at you.`,
      provocative: `${d.pendingCore} core quests. The day won't win itself.`,
    });
  }
  if (d.hour >= 20) {
    return voice(t, s, {
      serious: `${d.pendingCore} core quests left today.`,
      motivational: `Final stretch: ${d.pendingCore} core quests left. Close it out.`,
      ironic: `${d.pendingCore} core quests left and the clock is not on your side.`,
      provocative: `${d.pendingCore} left. Bed can wait five minutes.`,
    });
  }
  return voice(t, s, {
    serious: `${d.pendingCore} of ${d.totalCore} core quests remaining.`,
    motivational: `${d.totalCore - d.pendingCore}/${d.totalCore} core done. Keep the momentum.`,
    ironic: `${d.pendingCore} core quests remaining. They won't complete themselves (we checked).`,
  });
}
