import { describe, expect, it } from 'vitest';
import { balanceLoad, type BalanceItem, type CapacitySample, computeCapacity, loadLevel, loadScore, rampLimits } from '../capacity';
import {
  activeSchedule,
  applyWorkToPlan,
  blankWeek,
  capacityAdjustment,
  describeWork,
  gymBlocked,
  loadModeFor,
  migrateWork,
  resolveEntry,
  resolveWork,
  scheduledPlan,
  summarizeSchedule,
} from '../schedule';
import { createDefaultSettings } from '@/data/defaultSettings';
import type { DayPlan, WorkDayEntry, WorkSettings } from '@/types';

const MON_FRI_8_18: WorkDayEntry[] = [
  { kind: 'off' },
  { kind: 'work', start: '08:00', end: '18:00' },
  { kind: 'work', start: '08:00', end: '18:00' },
  { kind: 'work', start: '08:00', end: '14:00' },
  { kind: 'work', start: '08:00', end: '18:00' },
  { kind: 'work', start: '08:00', end: '18:00' },
  { kind: 'off' },
];

describe('work schedule', () => {
  it('defaults to NOT SET and never assumes hours', () => {
    const s = createDefaultSettings();
    expect(s.work.status).toBe('not_set');
    expect(s.work.schedules).toHaveLength(0);
    const plan = scheduledPlan('2026-09-21', s); // a Monday
    expect(plan.workStatus).toBe('unknown');
    expect(plan.work).toBeUndefined();
    expect(plan.dayType).toBe('free');
    expect(plan.wakeEstimated).toBe(true);
  });

  it('derives times only from what was said', () => {
    expect(resolveEntry({ kind: 'work', start: '09:00', end: '18:00', breakMin: 60 })).toMatchObject({ status: 'set', minutes: 480 });
    expect(resolveEntry({ kind: 'work', start: '09:00', durationMin: 360 })).toMatchObject({ status: 'set', end: '15:00', minutes: 360 });
    // "Probably from 9": start known, end unknown — NOT 09:00–18:00.
    const partial = resolveEntry({ kind: 'work', start: '09:00', approximate: true });
    expect(partial).toMatchObject({ status: 'partial', start: '09:00', end: undefined, minutes: undefined, approximate: true });
    expect(describeWork(partial)).toBe('From ~09:00 · end not set');
    expect(resolveEntry({ kind: 'unknown' }).status).toBe('unknown');
    expect(resolveEntry({ kind: 'off' })).toMatchObject({ status: 'off', minutes: 0 });
  });

  it('uses the version in force on each date ("from Monday I work 8–18")', () => {
    const work: WorkSettings = {
      status: 'set',
      schedules: [
        { id: 'a', effectiveFrom: '2000-01-01', days: blankWeek({ kind: 'off' }), source: 'onboarding', createdAt: 0 },
        { id: 'b', effectiveFrom: '2026-09-28', days: MON_FRI_8_18, source: 'coach', createdAt: 1 },
      ],
    };
    expect(activeSchedule(work, '2026-09-25')?.id).toBe('a');
    expect(resolveWork('2026-09-25', work).status).toBe('off');
    expect(resolveWork('2026-09-28', work)).toMatchObject({ status: 'set', start: '08:00', end: '18:00', minutes: 600 });
    expect(resolveWork('2026-09-30', work)).toMatchObject({ end: '14:00' });
  });

  it('summarises a week compactly', () => {
    expect(summarizeSchedule(MON_FRI_8_18)).toEqual(['Mon–Tue 08:00–18:00', 'Wed 08:00–14:00', 'Thu–Fri 08:00–18:00', 'Weekend free']);
  });

  it('temporary plans override the day only', () => {
    const base: DayPlan = { date: '2026-09-22', dayType: 'free', busy: [], wake: '07:00', sleep: '23:00' };
    const p = applyWorkToPlan(base, { status: 'set', start: '10:00', end: '20:00', minutes: 600 });
    expect(p).toMatchObject({ dayType: 'work', workStatus: 'set', work: { start: '10:00', end: '20:00' } });
    const partial = applyWorkToPlan(base, { status: 'partial', start: '09:00' });
    expect(partial).toMatchObject({ dayType: 'work', workStatus: 'partial', workStart: '09:00', work: undefined });
  });

  it('migrates the old assumed Mon–Fri 09–19 default to NOT SET, keeps custom schedules', () => {
    const old = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      i === 0 || i === 6 ? { type: 'free' as const, busy: [], trainingAvailable: true } : { type: 'work' as const, work: { start: '09:00', end: '19:00' }, busy: [], trainingAvailable: true },
    );
    expect(migrateWork(old, 0).status).toBe('not_set');
    const custom = old.map((d, i) => (i === 3 ? { ...d, work: { start: '08:00', end: '14:00' } } : d));
    const migrated = migrateWork(custom, 0);
    expect(migrated.status).toBe('set');
    expect(migrated.schedules[0].days[3]).toEqual({ kind: 'work', start: '08:00', end: '14:00' });
  });

  it('exceptions: more/less time, push/keep modes, no gym', () => {
    const s = createDefaultSettings();
    s.exceptions = [
      { id: '1', kind: 'more_time', from: '2026-10-01', createdAt: 0 },
      { id: '2', kind: 'no_gym', from: '2026-09-21', to: '2026-09-27', createdAt: 0 },
      { id: '3', kind: 'push', from: '2026-09-21', to: '2026-09-27', createdAt: 0 },
    ];
    expect(capacityAdjustment(s.exceptions, '2026-09-30')).toBe(1);
    expect(capacityAdjustment(s.exceptions, '2026-10-05')).toBe(1.25);
    expect(gymBlocked(s, '2026-09-24')).toBe(true);
    expect(gymBlocked(s, '2026-09-28')).toBe(false);
    expect(loadModeFor(s, '2026-09-24')).toBe('push');
    expect(loadModeFor(s, '2026-09-28')).toBe('auto');
  });
});

const base = { awakeMin: 16 * 60, busyMin: 0, energy: 90, maxEnergy: 100, history: [] as CapacitySample[], adjustment: 1, dayIndex: 10 };

describe('daily capacity', () => {
  it('Day A (10h work) < Day C (6h work + workout) < Day B (no work)', () => {
    const a = computeCapacity({ ...base, kind: 'work', workMin: 600 });
    const c = computeCapacity({ ...base, kind: 'work', workMin: 360 });
    const b = computeCapacity({ ...base, kind: 'free' });
    expect(a.minutes).toBeLessThan(c.minutes);
    expect(c.minutes).toBeLessThan(b.minutes);
  });

  it('unknown work hours: moderate default, then learns from real days', () => {
    const fresh = computeCapacity({ ...base, kind: 'unknown' });
    expect(fresh.freeMin).toBeUndefined();
    expect(fresh.confidence).toBe('low');
    const history: CapacitySample[] = Array.from({ length: 6 }, (_, i) => ({ date: `2026-09-${10 + i}`, kind: 'unknown', plannedMin: 90, completedMin: 60 }));
    const learned = computeCapacity({ ...base, kind: 'unknown', history });
    expect(learned.learnedMin).toBe(69);
    expect(learned.minutes).toBeLessThan(fresh.minutes);
    expect(learned.reasons.join(' ')).toMatch(/usually finish/);
  });

  it('low energy and less-time periods shrink the day', () => {
    const normal = computeCapacity({ ...base, kind: 'free' });
    expect(computeCapacity({ ...base, kind: 'free', energy: 20 }).minutes).toBeLessThan(normal.minutes);
    expect(computeCapacity({ ...base, kind: 'free', adjustment: 0.75 }).minutes).toBeLessThan(normal.minutes);
  });

  it('load score maps planned minutes against capacity', () => {
    expect(loadLevel(loadScore(30, 200, 100, 100))).toBe('low');
    expect(loadLevel(loadScore(200, 200, 100, 100))).toBe('high');
  });
});

const item = (id: string, tier: BalanceItem['tier'], durationMin: number, extra: Partial<BalanceItem> = {}): BalanceItem => ({ id, tier, durationMin, importance: 3, ...extra });

describe('priority balancing', () => {
  const day = [item('c1', 'core', 30), item('c2', 'core', 20), item('c3', 'core', 3), item('i1', 'important', 40, { importance: 4 }), item('i2', 'important', 30), item('i3', 'important', 20)];

  it('keeps every core quest and trims important ones on a full day', () => {
    const r = balanceLoad(day, 100, 'auto');
    const tier = (id: string) => r.decisions.find((d) => d.id === id)!.tier;
    expect(['c1', 'c2', 'c3'].map(tier)).toEqual(['core', 'core', 'core']);
    expect(tier('i1')).toBe('important'); // highest importance fits first
    expect(tier('i2')).toBe('optional');
    expect(r.plannedMin).toBeLessThanOrEqual(100);
  });

  it('respects "keep this task" and the keep-all / push modes', () => {
    const kept = balanceLoad([...day.slice(0, 5), item('i3', 'important', 20, { kept: true })], 60, 'auto');
    expect(kept.decisions.find((d) => d.id === 'i3')!.tier).toBe('important');
    const all = balanceLoad(day, 40, 'keep_all');
    expect(all.decisions.every((d) => !d.lightened)).toBe(true);
    expect(balanceLoad(day, 40, 'push').leftoverMin).toBeGreaterThan(0);
  });

  it('only lightens core when core alone overflows a lot, and keeps at least 3 effortful core', () => {
    const heavy = [item('a', 'core', 60), item('b', 'core', 60), item('c', 'core', 60), item('d', 'core', 60), item('w', 'core', 60, { protected: true })];
    const r = balanceLoad(heavy, 100, 'auto');
    const lightened = r.decisions.filter((d) => d.lightened);
    expect(lightened.length).toBe(2);
    expect(lightened.some((d) => d.id === 'w')).toBe(false);
  });
});

describe('progressive complexity', () => {
  it('day 1 is small and the ramp ends after a week', () => {
    expect(rampLimits(0)).toMatchObject({ core: 4, important: 0 });
    expect(rampLimits(1)?.important).toBe(2);
    expect(rampLimits(7)).toBeUndefined();
  });
});
