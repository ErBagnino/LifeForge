import type { DayLog, ISODate, LedgerEntry, PersonalRecord } from '@/types';
import { daysBetween, shiftDate } from '@/utils/date';

/**
 * The Journey: long-term chapters and a timeline of real milestones. Everything here is
 * derived from stored history (day logs, ledger, achievements, records). If something did
 * not happen, it does not appear — no placeholder milestones.
 */

export interface ChapterDef {
  n: number;
  title: string;
  /** First and last adventure day (1-based, inclusive). */
  from: number;
  to: number;
}

const NAMED: Omit<ChapterDef, 'n'>[] = [
  { title: 'The Awakening', from: 1, to: 7 },
  { title: 'Forging Habits', from: 8, to: 30 },
  { title: 'The Long Road', from: 31, to: 90 },
  { title: 'Seasons of Mastery', from: 91, to: 180 },
  { title: 'The Legend Grows', from: 181, to: 365 },
];

export function chapterDef(n: number): ChapterDef {
  if (n <= NAMED.length) return { n, ...NAMED[n - 1] };
  const year = n - NAMED.length + 1;
  return { n, title: `Year ${year}`, from: 365 * (year - 1) + 1, to: 365 * year };
}

export function chapterForDay(adventureDay: number): ChapterDef {
  let n = 1;
  while (chapterDef(n).to < adventureDay) n++;
  return chapterDef(n);
}

type JourneyLog = Pick<DayLog, 'date' | 'success' | 'score' | 'streak' | 'workouts' | 'closed' | 'core' | 'levelUps'> & Partial<Pick<DayLog, 'important' | 'optional'>>;

export interface ChapterSummary extends ChapterDef {
  start: ISODate;
  end: ISODate;
  status: 'done' | 'current' | 'future';
  /** Adventure days of this chapter that have already begun. */
  daysElapsed: number;
  length: number;
  activeDays: number;
  successDays: number;
  bestStreak: number;
  workouts: number;
  questsDone: number;
  avgScore: number | null;
  levelsGained: number;
}

/** Chapters from the adventure start up to the current one, oldest first. */
export function chapterSummaries(start: ISODate, today: ISODate, logs: JourneyLog[]): ChapterSummary[] {
  const day = Math.max(1, daysBetween(start, today) + 1);
  const current = chapterForDay(day).n;
  const out: ChapterSummary[] = [];
  for (let n = 1; n <= current; n++) {
    const c = chapterDef(n);
    const cStart = shiftDate(start, c.from - 1);
    const cEnd = shiftDate(start, c.to - 1);
    const inRange = logs.filter((l) => l.date >= cStart && l.date <= cEnd && l.date <= today);
    const closed = inRange.filter((l) => l.closed);
    const active = inRange.filter((l) => l.core.done + (l.important?.done ?? 0) + (l.optional?.done ?? 0) > 0 || l.workouts > 0);
    out.push({
      ...c,
      start: cStart,
      end: cEnd,
      status: n < current ? 'done' : 'current',
      daysElapsed: Math.min(c.to, day) - c.from + 1,
      length: c.to - c.from + 1,
      activeDays: active.length,
      successDays: closed.filter((l) => l.success).length,
      bestStreak: inRange.reduce((m, l) => Math.max(m, l.streak), 0),
      workouts: inRange.reduce((s, l) => s + l.workouts, 0),
      questsDone: inRange.reduce((s, l) => s + l.core.done + (l.important?.done ?? 0) + (l.optional?.done ?? 0), 0),
      avgScore: closed.length ? Math.round(closed.reduce((s, l) => s + l.score, 0) / closed.length) : null,
      levelsGained: inRange.reduce((s, l) => s + (l.levelUps?.length ?? 0), 0),
    });
  }
  return out;
}

export type MilestoneKind = 'start' | 'chapter' | 'level' | 'achievement' | 'building' | 'record' | 'streak' | 'workout' | 'comeback';

export interface Milestone {
  id: string;
  date: ISODate;
  ts?: number;
  kind: MilestoneKind;
  icon: string;
  title: string;
  detail?: string;
}

export interface JourneyInput {
  start: ISODate;
  today: ISODate;
  logs: JourneyLog[];
  achievements: { id: string; name: string; icon: string; tier: string; unlockedAt?: number }[];
  ledger: Pick<LedgerEntry, 'id' | 'ts' | 'date' | 'type' | 'amount' | 'reason' | 'refId'>[];
  records: Pick<PersonalRecord, 'id' | 'label' | 'value' | 'unit' | 'date' | 'kind'>[];
  /** Resolves `{pet}` and similar placeholders in achievement names. */
  text?: (s: string) => string;
  toDate?: (ts: number) => ISODate;
}

const LEVEL_MARKS = new Set([2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 175, 200]);
const STREAK_MARKS = [3, 7, 14, 30, 60, 100, 180, 365];

/** Real milestones, newest first. */
export function buildJourney(input: JourneyInput): Milestone[] {
  const text = input.text ?? ((s: string) => s);
  const toDate = input.toDate ?? ((ts: number) => new Date(ts).toISOString().slice(0, 10));
  const out: Milestone[] = [{ id: 'start', date: input.start, kind: 'start', icon: '🌅', title: 'The adventure began', detail: 'Day 1 of your run' }];
  const logs = [...input.logs].filter((l) => l.date >= input.start && l.date <= input.today).sort((a, b) => a.date.localeCompare(b.date));

  // Chapters reached (the first one is the start itself).
  const day = Math.max(1, daysBetween(input.start, input.today) + 1);
  for (let n = 2; n <= chapterForDay(day).n; n++) {
    const c = chapterDef(n);
    out.push({ id: `chapter:${n}`, date: shiftDate(input.start, c.from - 1), kind: 'chapter', icon: '📖', title: `Chapter ${n}: ${c.title}`, detail: `Day ${c.from}` });
  }

  // Level milestones, from the level-ups recorded on each day.
  for (const l of logs) for (const lv of l.levelUps ?? []) if (LEVEL_MARKS.has(lv)) out.push({ id: `level:${lv}:${l.date}`, date: l.date, kind: 'level', icon: '⭐', title: `Reached level ${lv}` });

  // Streak milestones: the first day each mark was reached in a run.
  let prevStreak = 0;
  for (const l of logs) {
    for (const m of STREAK_MARKS) if (l.streak >= m && prevStreak < m) out.push({ id: `streak:${m}:${l.date}`, date: l.date, kind: 'streak', icon: '🔥', title: `${m}-day streak`, detail: m >= 30 ? 'Consistency is a superpower' : undefined });
    prevStreak = l.streak;
  }

  // First workout, then every 25th.
  let workouts = 0;
  for (const l of logs) {
    const before = workouts;
    workouts += l.workouts;
    if (before === 0 && workouts > 0) out.push({ id: `workout:first`, date: l.date, kind: 'workout', icon: '🏋️', title: 'First workout logged' });
    else if (Math.floor(workouts / 25) > Math.floor(before / 25)) out.push({ id: `workout:${Math.floor(workouts / 25) * 25}`, date: l.date, kind: 'workout', icon: '🏋️', title: `${Math.floor(workouts / 25) * 25} workouts` });
  }

  // Comebacks: a successful day after 3+ days away.
  let lastActive: ISODate | undefined;
  for (const l of logs) {
    const active = l.core.done + (l.important?.done ?? 0) + (l.optional?.done ?? 0) > 0 || l.workouts > 0;
    if (!active) continue;
    if (lastActive && daysBetween(lastActive, l.date) >= 4 && l.success) out.push({ id: `comeback:${l.date}`, date: l.date, kind: 'comeback', icon: '🌱', title: 'Comeback', detail: `Back after ${daysBetween(lastActive, l.date) - 1} days away` });
    lastActive = l.date;
  }

  for (const a of input.achievements) {
    if (!a.unlockedAt) continue;
    out.push({ id: `ach:${a.id}`, date: toDate(a.unlockedAt), ts: a.unlockedAt, kind: 'achievement', icon: a.icon, title: text(a.name), detail: `${a.tier[0].toUpperCase()}${a.tier.slice(1)} achievement` });
  }

  for (const e of input.ledger) {
    if (e.type !== 'coins' || e.amount >= 0) continue;
    const m = /^(Build|Upgrade): (.+)$/.exec(e.reason);
    if (m) out.push({ id: `building:${e.id}`, date: e.date, ts: e.ts, kind: 'building', icon: '🏗️', title: m[1] === 'Build' ? `Built the ${m[2]}` : `Upgraded the ${m[2]}` });
  }

  for (const r of input.records) {
    if (r.kind === 'streak' || r.value <= 0) continue;
    out.push({ id: `record:${r.id}`, date: r.date, kind: 'record', icon: '🏆', title: `Personal record: ${r.label}`, detail: `${Math.round(r.value * 10) / 10} ${r.unit}`.trim() });
  }

  return out.filter((m) => m.date >= input.start && m.date <= input.today).sort((a, b) => b.date.localeCompare(a.date) || (b.ts ?? 0) - (a.ts ?? 0) || order(b.kind) - order(a.kind));
}

const ORDER: MilestoneKind[] = ['start', 'chapter', 'comeback', 'workout', 'streak', 'record', 'building', 'achievement', 'level'];
function order(k: MilestoneKind) {
  return ORDER.indexOf(k);
}
