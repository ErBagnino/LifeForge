import { describe, expect, it } from 'vitest';
import type { DailyContext, Quest } from '@/types';
import { computeState, dailyOpening, evaluateDay, expectedWork, formatDuration, gameMinuteOf, learnSchedule, lowEnergyAlternative, typicalWake, workMinutesToday, type ContextInput } from '../dailyContext';

const at = (date: string, hm: string) => new Date(`${date}T${hm}:00`).getTime();
const WED = '2026-09-23';
const SAT = '2026-09-26';
let n = 0;
const q = (patch: Partial<Quest>): Quest => ({
  id: `q${++n}`, date: WED, kind: 'scheduled', tier: 'important', title: 'Quest', icon: '•', category: 'general', difficulty: 2, rarity: 'common',
  xp: 20, coins: 5, energyCost: 5, stats: {}, progress: 0, durationMin: 10, status: 'pending', snoozeCount: 0, rescheduleCount: 0, createdAt: 0, updatedAt: 0, ...patch,
});
const ctx = (date: string, patch: Partial<DailyContext> = {}): DailyContext => ({ date, work: [], updatedAt: at(date, '07:00'), ...patch });
const base = (patch: Partial<ContextInput>): ContextInput => ({ now: at(WED, '10:00'), date: WED, dayStartHour: 4, wake: '07:00', sleep: '23:30', energy: 80, maxEnergy: 100, quests: [], ...patch });

describe('context states', () => {
  it('follows the day: sleep → wake-up → morning → afternoon → evening → wind down → sleep', () => {
    const s = (hm: string, c?: DailyContext) => computeState(base({ now: at(WED, hm), ctx: c }));
    expect(s('05:00')).toBe('SLEEP');
    expect(s('07:10')).toBe('WAKE_UP');
    expect(s('07:10', ctx(WED, { wakeUpTime: at(WED, '06:00') }))).toBe('MORNING');
    expect(s('10:00', ctx(WED, { wakeUpTime: at(WED, '07:00') }))).toBe('MORNING');
    expect(s('14:00', ctx(WED, { wakeUpTime: at(WED, '07:00') }))).toBe('AFTERNOON');
    expect(s('20:00', ctx(WED, { wakeUpTime: at(WED, '07:00') }))).toBe('EVENING');
    expect(s('22:45', ctx(WED, { wakeUpTime: at(WED, '07:00') }))).toBe('WIND_DOWN');
    expect(computeState(base({ now: at('2026-09-24', '00:30'), ctx: ctx(WED, { wakeUpTime: at(WED, '07:00') }) }))).toBe('SLEEP'); // 00:30 belongs to Wednesday's game day
  });

  it('work session → WORK, end → POST_WORK for 90 min, training while a workout runs', () => {
    expect(computeState(base({ now: at(WED, '11:00'), openWork: { start: at(WED, '08:10') } }))).toBe('WORK');
    const done = ctx(WED, { wakeUpTime: at(WED, '07:00'), work: [{ start: at(WED, '08:10'), end: at(WED, '17:30'), minutes: 560 }] });
    expect(computeState(base({ now: at(WED, '18:00'), ctx: done }))).toBe('POST_WORK');
    expect(computeState(base({ now: at(WED, '19:30'), ctx: done }))).toBe('EVENING');
    expect(computeState(base({ now: at(WED, '18:00'), trainingActive: true }))).toBe('TRAINING');
  });

  it('weekend days are not a copy of workdays', () => {
    expect(computeState(base({ now: at(SAT, '11:00'), date: SAT, ctx: ctx(SAT, { wakeUpTime: at(SAT, '09:00') }) }))).toBe('WEEKEND');
    // Working on a Saturday is still possible: START WORK wins.
    expect(computeState(base({ now: at(SAT, '11:00'), date: SAT, openWork: { start: at(SAT, '10:00') } }))).toBe('WORK');
  });
});

describe('time budget, priorities and work mode', () => {
  it('estimates available time until bedtime and whether the plan fits', () => {
    const quests = [q({ title: 'Workout', category: 'fitness', kind: 'workout', durationMin: 50, tier: 'core' }), q({ title: 'Dinner', category: 'nutrition', durationMin: 45 }), q({ title: 'Sky', category: 'animal_care', durationMin: 10 }), q({ title: 'Skincare', category: 'skincare', durationMin: 10 })];
    const v = evaluateDay(base({ now: at(WED, '20:15'), quests, ctx: ctx(WED, { wakeUpTime: at(WED, '07:00') }) }));
    expect(v.minutesToBed).toBe(195); // 3h 15m
    expect(v.plannedMin).toBe(115); // 1h 55m
    expect(v.fits).toBe(true);
    expect(v.decisions.every((d) => d.realistic)).toBe(true);
  });

  it('too much for the time left → prioritizes and marks the rest as not realistic today', () => {
    const quests = [q({ title: 'Core', tier: 'core', durationMin: 30 }), q({ title: 'Long optional', tier: 'optional', durationMin: 120 }), q({ title: 'Important', tier: 'important', durationMin: 40 })];
    const v = evaluateDay(base({ now: at(WED, '22:00'), quests, ctx: ctx(WED, { wakeUpTime: at(WED, '07:00') }) }));
    expect(v.availableMin).toBe(90);
    const byTitle = Object.fromEntries(v.decisions.map((d) => [d.quest.title, d]));
    expect(byTitle.Core.realistic).toBe(true);
    expect(byTitle['Long optional'].realistic).toBe(false);
    expect(v.decisions[0].quest.title).toBe('Core');
  });

  it('WORK mode holds every quest (suspended, not failed) and shows nothing to do', () => {
    const quests = [q({ category: 'fitness', durationMin: 50 }), q({ category: 'reading' })];
    const v = evaluateDay(base({ now: at(WED, '11:00'), openWork: { start: at(WED, '08:10') }, quests }));
    expect(v.state).toBe('WORK');
    expect(v.decisions.every((d) => d.suspended && d.quest.status === 'pending')).toBe(true);
    expect(v.focus).toEqual([]);
  });

  it('while working, the learned remaining work time is subtracted from the evening budget', () => {
    const contexts = ['2026-09-09', '2026-09-16', '2026-09-02'].map((d) => ctx(d, { firstOpenAt: at(d, '07:30'), work: [{ start: at(d, '08:00'), end: at(d, '17:00'), minutes: 540 }] }));
    const learned = learnSchedule({ contexts, meals: [], workouts: [], dayStartHour: 4 });
    const v = evaluateDay(base({ now: at(WED, '12:00'), openWork: { start: at(WED, '08:00') }, learned }));
    expect(v.busyAhead).toBe(300); // 9 h typical − 4 h elapsed
    expect(v.availableMin).toBe(v.minutesToBed - 300);
  });

  it('post-work: the workout moves up (best window), streaks make core quests CRITICAL', () => {
    const workout = q({ title: 'Workout', category: 'fitness', kind: 'workout', durationMin: 50, tier: 'important' });
    const skincare = q({ title: 'Skincare', category: 'skincare', durationMin: 10, tier: 'important' });
    const nofap = q({ title: 'NoFap', tier: 'core', activityId: 'nofap', durationMin: 1 });
    const done = ctx(WED, { wakeUpTime: at(WED, '07:00'), work: [{ start: at(WED, '08:10'), end: at(WED, '18:30'), minutes: 620 }] });
    const v = evaluateDay(base({ now: at(WED, '18:45'), ctx: done, quests: [skincare, workout, nofap], streaks: { nofap: 12 } }));
    expect(v.state).toBe('POST_WORK');
    expect(v.decisions.find((d) => d.quest.title === 'NoFap')?.priority).toBe('CRITICAL');
    expect(v.decisions.findIndex((d) => d.quest.title === 'Workout')).toBeLessThan(v.decisions.findIndex((d) => d.quest.title === 'Skincare'));
    expect(v.decisions.find((d) => d.quest.title === 'Workout')?.reason).toBe('Best window after work');
  });

  it('low energy: offers a reduced session, never drops the quest by itself', () => {
    const w = q({ category: 'fitness', kind: 'workout', durationMin: 60 });
    expect(lowEnergyAlternative(w, 0.25)).toEqual({ label: 'Reduced session · 20 min', durationMin: 20 });
    expect(lowEnergyAlternative(q({ category: 'cardio', durationMin: 40 }), 0.2)?.label).toMatch(/Recovery walk/);
    expect(lowEnergyAlternative(w, 0.8)).toBeUndefined();
    const v = evaluateDay(base({ energy: 20, quests: [w] }));
    expect(v.decisions[0].alternative?.durationMin).toBe(20);
  });

  it('a work session crossing midnight counts once, on the day it started', () => {
    const c = ctx(WED, { work: [{ start: at(WED, '23:50'), end: at('2026-09-24', '00:20'), minutes: 30 }] });
    expect(workMinutesToday(c, undefined, at('2026-09-24', '01:00'))).toBe(30);
    expect(gameMinuteOf(at('2026-09-24', '00:20'), 4)).toBe(1460);
  });
});

describe('learning', () => {
  it('needs at least 3 observations; learns weekday and weekend wake-up separately', () => {
    const wake = (d: string, hmv: string) => ctx(d, { wakeUpTime: at(d, hmv), wakeSource: 'confirmed', firstOpenAt: at(d, hmv) });
    const two = learnSchedule({ contexts: [wake('2026-09-21', '07:42'), wake('2026-09-22', '07:51')], meals: [], workouts: [], dayStartHour: 4 });
    expect(two.wake.weekday).toBeUndefined();
    const l = learnSchedule({
      contexts: [wake('2026-09-14', '07:42'), wake('2026-09-15', '07:51'), wake('2026-09-16', '07:37'), wake('2026-09-17', '07:46'), wake('2026-09-18', '07:44'), wake('2026-09-12', '09:30'), wake('2026-09-13', '10:00'), wake('2026-09-19', '09:45')],
      meals: [],
      workouts: [],
      dayStartHour: 4,
    });
    expect(typicalWake(l, WED)).toEqual({ median: 7 * 60 + 44, count: 5 });
    expect(typicalWake(l, SAT)?.median).toBe(9 * 60 + 45);
  });

  it('learns workdays from START/END sessions and never from a single day', () => {
    const mon = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
    const contexts = [
      ...mon.map((d) => ctx(d, { firstOpenAt: at(d, '07:00'), work: [{ start: at(d, '08:12'), end: at(d, '16:33'), minutes: 501 }] })),
      ctx('2026-09-19', { firstOpenAt: at('2026-09-19', '09:00'), work: [{ start: at('2026-09-19', '10:00'), end: at('2026-09-19', '14:00'), minutes: 240 }] }), // one Saturday
    ];
    const l = learnSchedule({ contexts, meals: [], workouts: [], dayStartHour: 4 });
    expect(l.work.workdays).toEqual([1]);
    expect(l.work.byWeekday[1]).toMatchObject({ count: 4, start: 8 * 60 + 12, end: 16 * 60 + 33, minutes: 501 });
    expect(expectedWork(l, '2026-09-28')?.minutes).toBe(501);
    expect(expectedWork(l, SAT)).toBeUndefined();
  });

  it('"Reset learned schedule" = ignore everything before the reset time', () => {
    const contexts = ['2026-09-14', '2026-09-15', '2026-09-16'].map((d) => ctx(d, { wakeUpTime: at(d, '07:40'), wakeSource: 'confirmed' }));
    expect(learnSchedule({ contexts, meals: [], workouts: [], dayStartHour: 4, since: at('2026-09-20', '00:00') }).wake.all).toBeUndefined();
  });

  it('learns meal and workout times', () => {
    const days = ['2026-09-20', '2026-09-21', '2026-09-22'];
    const l = learnSchedule({ contexts: [], meals: days.flatMap((d) => [{ ts: at(d, '08:00') }, { ts: at(d, '13:00') }, { ts: at(d, '20:30') }]), workouts: days.map((d) => ({ ts: at(d, '19:10') })), dayStartHour: 4 });
    expect(l.meals.dinner?.median).toBe(20 * 60 + 30);
    expect(l.workout?.median).toBe(19 * 60 + 10);
  });
});

describe('daily opening', () => {
  const learned = learnSchedule({ contexts: ['2026-09-14', '2026-09-15', '2026-09-16'].map((d) => ctx(d, { wakeUpTime: at(d, '07:44'), wakeSource: 'confirmed' })), meals: [], workouts: [], dayStartHour: 4 });
  const open = (hmv: string, patch: Partial<Parameters<typeof dailyOpening>[0]> = {}) => dailyOpening({ now: at(WED, hmv), date: WED, dayStartHour: 4, adaptive: true, askWake: true, yesterday: '2026-09-22', lastVisit: '2026-09-22', ...patch });
  it('asks "did you just wake up?" without history; proposes the typical time once learned', () => {
    expect(open('07:30')?.wake).toEqual({ kind: 'ask' });
    expect(open('07:50', { learned })?.wake).toEqual({ kind: 'confirm', suggested: '07:45' });
    expect(open('11:30', { learned })?.wake).toEqual({ kind: 'ask' }); // far from the usual time → just ask
    expect(open('07:50', { learned, adaptive: false })?.wake).toEqual({ kind: 'ask' });
  });
  it('late opening, welcome back, and nothing once the day is started', () => {
    expect(open('16:30')).toMatchObject({ kind: 'afternoon', late: true, wake: { kind: 'none' } });
    expect(open('09:00', { lastVisit: '2026-09-19' })?.welcomeBack).toBe(true);
    expect(open('09:00', { ctx: ctx(WED, { dayStartedAt: at(WED, '08:00') }) })).toBeUndefined();
    expect(formatDuration(501)).toBe('8h 21m');
  });
});

describe('quiet reminders', () => {
  it('drops reminders inside work/training windows and keeps play-time budget warnings', async () => {
    const { applyQuietWindows } = await import('../reminders');
    const r = (type: 'quest' | 'leisure' | 'workout', atMin: number) => ({ type, at: atMin * 60_000, title: '', body: '', tag: `${type}${atMin}`, priority: 50 });
    const planned = [r('quest', 10), r('workout', 20), r('leisure', 30), r('quest', 200)];
    expect(applyQuietWindows(planned, [{ from: 0, to: 100 * 60_000, reason: 'work' }]).map((x) => x.tag)).toEqual(['quest200']);
    expect(applyQuietWindows(planned, [{ from: 0, to: 100 * 60_000, allow: ['leisure'], reason: 'play' }]).map((x) => x.tag)).toEqual(['leisure30', 'quest200']);
  });
});
