import { gymBlocked, scheduledPlan } from '@/domain/schedule';
import { statsRepository } from '@/repositories';
import type { DayPlan, ISODate, Settings } from '@/types';
import { weekday } from '@/utils/date';

export { scheduledPlan };

/** Day plan: a per-day override (temporary schedule or edited plan) when present, otherwise the regular week. */
export async function planFor(date: ISODate, settings: Settings): Promise<DayPlan> {
  return mergePlan(scheduledPlan(date, settings), await statsRepository.getPlan(date));
}

/**
 * A temporary schedule decides work for its date. Other saved plans only carry
 * per-day edits (busy blocks, wake/sleep, rest day): work always follows the
 * regular week, so a schedule change is picked up immediately.
 */
export function mergePlan(base: DayPlan, stored: DayPlan | undefined): DayPlan {
  if (!stored) return base;
  if (stored.temporary) return { ...stored, workStatus: stored.workStatus ?? (stored.work ? 'set' : stored.dayType === 'work' ? 'partial' : 'off') };
  return {
    ...base,
    busy: stored.busy ?? base.busy,
    wake: stored.wake ?? base.wake,
    sleep: stored.sleep ?? base.sleep,
    wakeEstimated: stored.wakeEstimated ?? base.wakeEstimated,
    sleepEstimated: stored.sleepEstimated ?? base.sleepEstimated,
    note: stored.note,
    dayType: stored.dayType === 'rest' ? 'rest' : base.dayType,
  };
}

export function trainingAvailable(date: ISODate, settings: Settings, plan: DayPlan): boolean {
  if (plan.dayType === 'rest' || gymBlocked(settings, date)) return false;
  return settings.schedule.days[weekday(date)]?.trainingAvailable ?? true;
}
