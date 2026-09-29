import { describe, expect, it } from 'vitest';
import { dayStages, nextUnlocks, oneMoreThing } from '../homeFlow';
import type { Activity, Building, Quest } from '@/types';

const base = { hour: 10, dayStartHour: 4, workPlanned: false, workDone: false, workoutToday: false, workoutDone: false };

describe('day journey', () => {
  it('builds the path from the real day and marks the current stage', () => {
    const s = dayStages({ ...base, workPlanned: true, workoutToday: true, state: 'WORK' });
    expect(s.map((x) => x.id)).toEqual(['wake', 'morning', 'work', 'train', 'evening', 'rest']);
    expect(s.map((x) => x.status)).toEqual(['done', 'done', 'now', 'next', 'next', 'next']);
  });
  it('free day without workout: afternoon instead of work; clock decides when state is generic', () => {
    expect(dayStages({ ...base, hour: 14, state: 'AFTERNOON' }).find((x) => x.status === 'now')?.id).toBe('afternoon');
    expect(dayStages({ ...base, hour: 20 }).find((x) => x.status === 'now')?.id).toBe('evening');
    expect(dayStages({ ...base, hour: 1 }).find((x) => x.status === 'now')?.id).toBe('rest'); // 01:00 is late in the game day
    expect(dayStages({ ...base, state: 'SLEEP' }).at(-1)?.status).toBe('now');
  });
  it('post-work goes to training only while the workout is still pending', () => {
    const pending = dayStages({ ...base, workPlanned: true, workDone: true, workoutToday: true, state: 'POST_WORK' });
    expect(pending.find((x) => x.status === 'now')?.id).toBe('train');
    const done = dayStages({ ...base, workPlanned: true, workDone: true, workoutToday: true, workoutDone: true, state: 'POST_WORK' });
    expect(done.find((x) => x.status === 'now')?.id).toBe('evening');
  });
});

describe('next unlocks', () => {
  const b = (id: string, level: number, baseCost: number, unlockLevel = 1) => ({ id, name: id, icon: '🏠', level, maxLevel: 5, baseCost, costGrowth: 2, unlockLevel, requires: [] }) as unknown as Building;
  it('real amounts for level, cheapest available room and the closest badge', () => {
    const u = nextUnlocks({
      level: 3, xpInto: 50, xpNeeded: 200, maxLevel: 200, coins: 120,
      buildings: [b('gym', 1, 500), b('lamp', 0, 150), b('vault', 0, 10, 15)],
      achievements: [
        { id: 'a', name: 'Close', icon: '🏅', hidden: false, condition: { type: 'counter', key: 'q', gte: 10 } },
        { id: 'b', name: 'Far', icon: '🏅', hidden: false, condition: { type: 'counter', key: 'q', gte: 100 } },
        { id: 'c', name: 'Done', icon: '🏅', hidden: false, unlockedAt: 1, condition: { type: 'counter', key: 'q', gte: 5 } },
      ] as never,
      counters: { q: 8 },
    });
    expect(u.map((x) => x.kind)).toEqual(['level', 'building', 'achievement']);
    expect(u[0]).toMatchObject({ title: 'Reach level 4', remaining: '150 XP' });
    expect(u[1]).toMatchObject({ title: 'lamp Lv.1', remaining: '30 🪙' }); // vault needs level 15
    expect(u[2]).toMatchObject({ title: 'Badge: Close', remaining: '8/10' });
  });
  it('follows the real build rules: per-level player level and prerequisite rooms', () => {
    const needsGym = { ...b('library', 0, 50), requires: [{ buildingId: 'gym', level: 2 }] } as unknown as Building;
    const u = nextUnlocks({ level: 3, xpInto: 0, xpNeeded: 100, maxLevel: 200, coins: 0, buildings: [b('gym', 1, 500), needsGym, b('lamp', 0, 150)], achievements: [], counters: {} });
    // gym Lv2 needs player level 4; library needs the gym at Lv2 → only the lamp qualifies
    expect(u.find((x) => x.kind === 'building')?.title).toBe('lamp Lv.1');
  });

  it('says "ready to build" when affordable, and skips badges with no progress', () => {
    const u = nextUnlocks({ level: 200, xpInto: 0, xpNeeded: 0, maxLevel: 200, coins: 1000, buildings: [b('lamp', 0, 150)], achievements: [{ id: 'a', name: 'X', icon: 'x', hidden: false, condition: { type: 'counter', key: 'q', gte: 10 } }] as never, counters: {} });
    expect(u.map((x) => x.kind)).toEqual(['building']);
    expect(u[0].remaining).toBe('ready to build');
  });
});

describe('one more thing', () => {
  const q = (id: string, over: Partial<Quest> = {}) => ({ id, status: 'pending', tier: 'optional', durationMin: 10, xp: 20, ...over }) as Quest;
  const a = (id: string, durationMin: number, over: Partial<Activity> = {}) => ({ id, durationMin, active: true, ...over }) as Activity;
  it('exactly one suggestion: a short pending optional quest first', () => {
    const r = oneMoreThing({ quests: [q('long', { durationMin: 45 }), q('short', { durationMin: 5 }), q('core', { tier: 'core' })], activities: [a('walk', 10)], energy: 80, now: 0, seed: 'x' });
    expect(r).toMatchObject({ kind: 'quest', quest: { id: 'short' } });
  });
  it('otherwise a 5–15 minute activity not already on the board, never private or metric', () => {
    const r = oneMoreThing({ quests: [q('w', { activityId: 'walk', status: 'completed' })], activities: [a('walk', 10), a('nofap', 5, { tags: ['private'] }), a('water', 5, { metric: 'water' }), a('run', 40), a('tidy', 5)], energy: 80, now: 0, seed: 'x' });
    expect(r).toMatchObject({ kind: 'activity', activity: { id: 'tidy' } });
  });
  it('nothing when there is no time or energy for it', () => {
    expect(oneMoreThing({ quests: [q('s', { durationMin: 5 })], activities: [], energy: 80, now: 0, freeMinutes: 3, seed: 'x' })).toBeUndefined();
    expect(oneMoreThing({ quests: [q('s', { durationMin: 20 })], activities: [], energy: 20, now: 0, seed: 'x' })).toBeUndefined();
  });
});
