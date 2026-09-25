import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfISOWeek,
  startOfMonth,
} from 'date-fns';
import type { ISODate, TimeHM } from '@/types';

/** Game date for a timestamp: before `dayStartHour` it still counts as the previous day. */
export function gameDate(ts: number, dayStartHour = 4): ISODate {
  const d = new Date(ts);
  if (d.getHours() < dayStartHour) d.setDate(d.getDate() - 1);
  return format(d, 'yyyy-MM-dd');
}

export function toISODate(d: Date): ISODate {
  return format(d, 'yyyy-MM-dd');
}

export function parseDate(date: ISODate): Date {
  return parseISO(date);
}

export function shiftDate(date: ISODate, days: number): ISODate {
  return toISODate(addDays(parseISO(date), days));
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

/** Inclusive list of dates between two game dates. */
export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(shiftDate(from, i));
  return out;
}

export function weekday(date: ISODate): number {
  return parseISO(date).getDay();
}

export function isWeekend(date: ISODate): boolean {
  const d = weekday(date);
  return d === 0 || d === 6;
}

/** ISO week key, e.g. `2026-W39`. Weeks start on Monday. */
export function weekKey(date: ISODate): string {
  const d = parseISO(date);
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, '0')}`;
}

export function weekStart(date: ISODate): ISODate {
  return toISODate(startOfISOWeek(parseISO(date)));
}

export function weekEnd(date: ISODate): ISODate {
  return shiftDate(weekStart(date), 6);
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function monthStart(date: ISODate): ISODate {
  return toISODate(startOfMonth(parseISO(date)));
}

export function monthEnd(date: ISODate): ISODate {
  return toISODate(endOfMonth(parseISO(date)));
}

export function formatDate(date: ISODate, pattern = 'EEE d MMM'): string {
  return format(parseISO(date), pattern);
}

/** Minutes since midnight for `HH:mm`. */
export function hmToMinutes(hm: TimeHM): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToHm(min: number): TimeHM {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function tsToHm(ts: number): TimeHM {
  return format(new Date(ts), 'HH:mm');
}

export function minuteOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Minutes of a block, handling blocks that cross midnight (e.g. sleep 23:30 → 07:00).
 */
export function blockMinutes(start: TimeHM, end: TimeHM): number {
  const s = hmToMinutes(start);
  const e = hmToMinutes(end);
  return e >= s ? e - s : 1440 - s + e;
}

/** Timestamp for an `HH:mm` on a given game date (times before dayStartHour roll to the next calendar day). */
export function dateTimeToTs(date: ISODate, hm: TimeHM, dayStartHour = 4): number {
  const d = parseISO(date);
  const min = hmToMinutes(hm);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  if (Math.floor(min / 60) < dayStartHour) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Minutes-of-day normalised onto the game-day axis (so 01:00 sorts after 23:00). */
export function gameMinutes(hm: TimeHM, dayStartHour = 4): number {
  const m = hmToMinutes(hm);
  return m < dayStartHour * 60 ? m + 1440 : m;
}

export function timeOfDayFromMinutes(min: number): 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' {
  const m = ((min % 1440) + 1440) % 1440;
  if (m >= 300 && m < 690) return 'morning';
  if (m >= 690 && m < 840) return 'midday';
  if (m >= 840 && m < 1080) return 'afternoon';
  if (m >= 1080 && m < 1320) return 'evening';
  return 'night';
}
