import type { ID, TimeHM } from '@/types';
import { hmToMinutes, minutesToHm } from '@/utils/date';
import { median, stdDev } from '@/utils/math';

export interface CompletionSample {
  activityId: ID;
  /** Minutes since midnight of the real completion (user-corrected when available). */
  minute: number;
  weekend: boolean;
}

export interface LearnedTime {
  activityId: ID;
  count: number;
  median: number;
  weekdayMedian?: number;
  weekendMedian?: number;
  /** Standard deviation in minutes — low values mean a stable habit. */
  spread: number;
}

/** Circular-safe minute normalisation: evening-to-after-midnight habits stay contiguous. */
function normalise(minutes: number[]): number[] {
  const late = minutes.filter((m) => m >= 20 * 60).length;
  const early = minutes.filter((m) => m < 4 * 60).length;
  return late > 0 && early > 0 ? minutes.map((m) => (m < 4 * 60 ? m + 1440 : m)) : minutes;
}

/** Learn when each activity is really done. */
export function learnTimes(samples: CompletionSample[], minSamples = 3): LearnedTime[] {
  const byActivity = new Map<ID, CompletionSample[]>();
  for (const s of samples) {
    const list = byActivity.get(s.activityId) ?? [];
    list.push(s);
    byActivity.set(s.activityId, list);
  }
  const out: LearnedTime[] = [];
  for (const [activityId, list] of byActivity) {
    if (list.length < minSamples) continue;
    const all = normalise(list.map((s) => s.minute));
    const wd = normalise(list.filter((s) => !s.weekend).map((s) => s.minute));
    const we = normalise(list.filter((s) => s.weekend).map((s) => s.minute));
    out.push({
      activityId,
      count: list.length,
      median: Math.round(median(all)) % 1440,
      weekdayMedian: wd.length >= 2 ? Math.round(median(wd)) % 1440 : undefined,
      weekendMedian: we.length >= 2 ? Math.round(median(we)) % 1440 : undefined,
      spread: Math.round(stdDev(all)),
    });
  }
  return out;
}

export interface TimeSuggestion {
  activityId: ID;
  from?: TimeHM;
  to: TimeHM;
  reason: string;
}

/**
 * Propose better preferred times when real behaviour consistently differs.
 * Never applied automatically.
 */
export function suggestTimeChanges(
  activities: { id: ID; name: string; preferredTime?: TimeHM }[],
  learned: LearnedTime[],
  opts = { minCount: 5, minShift: 45, maxSpread: 90 },
): TimeSuggestion[] {
  const out: TimeSuggestion[] = [];
  for (const l of learned) {
    if (l.count < opts.minCount || l.spread > opts.maxSpread) continue;
    const a = activities.find((x) => x.id === l.activityId);
    if (!a) continue;
    const to = minutesToHm(Math.round(l.median / 15) * 15);
    if (a.preferredTime) {
      const diff = Math.abs(hmToMinutes(a.preferredTime) - l.median);
      const circular = Math.min(diff, 1440 - diff);
      if (circular < opts.minShift) continue;
    }
    out.push({
      activityId: a.id,
      from: a.preferredTime,
      to,
      reason: `You usually do "${a.name}" around ${minutesToHm(l.median)} (${l.count} times).`,
    });
  }
  return out;
}

/** Reminder minute for an activity: learned time minus a lead. */
export function reminderMinute(learned: LearnedTime | undefined, preferred: TimeHM | undefined, leadMin: number): number | undefined {
  const base = learned && learned.count >= 3 ? learned.median : preferred ? hmToMinutes(preferred) : undefined;
  return base === undefined ? undefined : (base - leadMin + 1440) % 1440;
}
