import { gameDate } from '@/utils/date';
import { minuteOfDay } from '@/utils/date';

let offsetMs = 0;
let dayStartHour = 4;

/**
 * Single source of "now". The dev toolbox can time-travel by setting an offset,
 * so every engine sees the same simulated clock.
 */
export const clock = {
  now: (): number => Date.now() + offsetMs,
  today: (): string => gameDate(Date.now() + offsetMs, dayStartHour),
  minute: (): number => minuteOfDay(Date.now() + offsetMs),
  hour: (): number => new Date(Date.now() + offsetMs).getHours(),
  setOffset(ms: number) {
    offsetMs = ms;
  },
  getOffset: (): number => offsetMs,
  setDayStartHour(h: number) {
    dayStartHour = h;
  },
  dayStartHour: (): number => dayStartHour,
};
