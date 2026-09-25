import { statsRepository } from '@/repositories';
import type { DayPlan, ISODate, Settings } from '@/types';
import { weekday } from '@/utils/date';

/** The weekly schedule applied to a date (without overrides). */
export function scheduledPlan(date: ISODate, settings: Settings): DayPlan {
  const day = settings.schedule.days[weekday(date)];
  return {
    date,
    dayType: day.type,
    work: day.type === 'work' ? day.work : undefined,
    busy: day.busy ?? [],
    wake: settings.schedule.wake,
    sleep: settings.schedule.sleep,
  };
}

/** Day plan: a per-day override when present, otherwise the weekly schedule. */
export async function planFor(date: ISODate, settings: Settings): Promise<DayPlan> {
  return (await statsRepository.getPlan(date)) ?? scheduledPlan(date, settings);
}

export function trainingAvailable(date: ISODate, settings: Settings, plan: DayPlan): boolean {
  if (plan.dayType === 'rest') return false;
  return settings.schedule.days[weekday(date)].trainingAvailable;
}
