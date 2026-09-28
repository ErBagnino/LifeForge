import { describe, expect, it } from 'vitest';
import { computeMastery, masteryLevel, MASTERY_TRACKS, perkById, pointsForLevel, trackOf } from '../mastery';
import { computeMomentum, momentumLabel } from '../momentum';
import { buildJourney, chapterDef, chapterForDay, chapterSummaries } from '../journey';
import type { ActivityCategory, Quest } from '@/types';

const q = (category: ActivityCategory, date: string, status: Quest['status'] = 'completed') => ({ category, date, status });

describe('mastery', () => {
  it('has ten tracks that cover every category except general, each exactly once', () => {
    expect(MASTERY_TRACKS).toHaveLength(10);
    const all = MASTERY_TRACKS.flatMap((t) => t.categories);
    expect(new Set(all).size).toBe(all.length);
    expect(trackOf('general')).toBeUndefined();
    expect(trackOf('cleaning')).toBe('home');
  });

  it('diminishing returns: many completions in one day are worth less than spreading them out', () => {
    const grind = computeMastery(Array.from({ length: 6 }, () => q('fitness', '2026-03-01')), '2026-03-10').find((t) => t.id === 'strength')!;
    const spread = computeMastery(Array.from({ length: 6 }, (_, i) => q('fitness', `2026-03-0${i + 1}`)), '2026-03-10').find((t) => t.id === 'strength')!;
    expect(grind.points).toBe(2.35); // 1 + .6 + .35 + .2 + .1 + .1
    expect(spread.points).toBe(6);
    expect(spread.activeDays).toBe(6);
    expect(grind.completions).toBe(6);
  });

  it('ignores skipped, pending and hidden quests', () => {
    const m = computeMastery([q('reading', '2026-03-01', 'skipped'), q('reading', '2026-03-01', 'pending'), { ...q('reading', '2026-03-01'), hidden: true }], '2026-03-02');
    expect(m.find((t) => t.id === 'mind')!.points).toBe(0);
  });

  it('level curve and perks', () => {
    expect(pointsForLevel(1)).toBe(10);
    expect(masteryLevel(9.9).level).toBe(0);
    expect(masteryLevel(10).level).toBe(1);
    expect(masteryLevel(29).level).toBe(1);
    expect(masteryLevel(30).level).toBe(2);
    expect(masteryLevel(1e9)).toMatchObject({ level: 20, progress: 1 });
    expect(perkById('mind:5')?.title).toBe('Curious Mind');
    expect(perkById('nope:5')).toBeUndefined();
    const m = computeMastery(Array.from({ length: 150 }, (_, i) => q('reading', dayN(i))), dayN(150)).find((t) => t.id === 'mind')!;
    expect(m.level).toBe(Math.max(...[...Array(21).keys()].filter((l) => pointsForLevel(l) <= 150)));
    expect(m.perks.filter((p) => p.unlocked).map((p) => p.level)).toEqual(m.level >= 5 ? [5] : []);
  });

  it('recent points only count the last 7 days', () => {
    const m = computeMastery([q('hydration', '2026-03-01'), q('hydration', '2026-03-09'), q('hydration', '2026-03-10')], '2026-03-10').find((t) => t.id === 'hydration')!;
    expect(m.recent).toBe(2);
    expect(m.lastDate).toBe('2026-03-10');
  });
});

function dayN(i: number) {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  return d.toISOString().slice(0, 10);
}

describe('momentum', () => {
  const t0 = Date.UTC(2026, 2, 1, 9, 0);
  const min = 60_000;
  it('counts a combo of completions close together and never goes negative', () => {
    expect(computeMomentum([], t0)).toEqual({ combo: 0, best: 0, minutesLeft: 0, done: 0 });
    const m = computeMomentum([t0, t0 + 10 * min, t0 + 30 * min], t0 + 40 * min);
    expect(m).toMatchObject({ combo: 3, best: 3, done: 3, minutesLeft: 35 });
    expect(momentumLabel(m)).toBe('On fire ×3');
  });
  it('a break simply ends the combo; the best of the day is kept', () => {
    const m = computeMomentum([t0, t0 + 10 * min, t0 + 20 * min, t0 + 200 * min], t0 + 210 * min);
    expect(m).toMatchObject({ combo: 1, best: 3 });
    expect(momentumLabel(m)).toBeUndefined();
    expect(computeMomentum([t0], t0 + 90 * min).combo).toBe(0);
  });
  it('ignores future and invalid timestamps', () => {
    expect(computeMomentum([t0 + 60 * min, NaN], t0).done).toBe(0);
  });
});

describe('journey', () => {
  const log = (date: string, over: Partial<Parameters<typeof chapterSummaries>[2][number]> = {}) => ({ date, success: true, score: 80, streak: 1, workouts: 0, closed: true, core: { done: 3, total: 3 }, levelUps: [] as number[], ...over });

  it('chapters: named first five, then yearly', () => {
    expect(chapterForDay(1).n).toBe(1);
    expect(chapterForDay(7).n).toBe(1);
    expect(chapterForDay(8)).toMatchObject({ n: 2, title: 'Forging Habits' });
    expect(chapterForDay(365).n).toBe(5);
    expect(chapterForDay(366)).toMatchObject({ n: 6, title: 'Year 2', from: 366, to: 730 });
    expect(chapterDef(7)).toMatchObject({ title: 'Year 3', from: 731 });
  });

  it('chapter summaries use real logs only', () => {
    const logs = [log('2026-01-01', { streak: 1 }), log('2026-01-02', { streak: 2, workouts: 1 }), log('2026-01-03', { success: false, score: 40, streak: 0, core: { done: 0, total: 3 } }), log('2026-01-09', { streak: 1, levelUps: [2, 3] })];
    const [c1, c2] = chapterSummaries('2026-01-01', '2026-01-10', logs);
    expect(c1).toMatchObject({ n: 1, status: 'done', successDays: 2, activeDays: 2, workouts: 1, bestStreak: 2, avgScore: 67, daysElapsed: 7 });
    expect(c2).toMatchObject({ n: 2, status: 'current', daysElapsed: 3, successDays: 1, levelsGained: 2 });
    expect(chapterSummaries('2026-01-01', '2026-01-01', [])[0]).toMatchObject({ avgScore: null, activeDays: 0 });
  });

  it('timeline: milestones only for things that happened, newest first', () => {
    const logs = [log('2026-01-01', { streak: 1, workouts: 1 }), log('2026-01-02', { streak: 2 }), log('2026-01-03', { streak: 3, levelUps: [2] }), log('2026-01-09', { streak: 1 })];
    const j = buildJourney({
      start: '2026-01-01',
      today: '2026-01-09',
      logs,
      achievements: [{ id: 'a', name: "{pet}'s Friend", icon: '🐾', tier: 'bronze', unlockedAt: Date.UTC(2026, 0, 2, 10) }, { id: 'b', name: 'Locked', icon: 'x', tier: 'gold' }],
      ledger: [
        { id: 'l1', ts: 1, date: '2026-01-03', type: 'coins', amount: -50, reason: 'Build: Gym' },
        { id: 'l2', ts: 2, date: '2026-01-03', type: 'coins', amount: -20, reason: 'Shop: Freeze' },
      ],
      records: [{ id: 'steps', label: 'Most steps', value: 12000, unit: 'steps', date: '2026-01-02', kind: 'steps_day' }],
      text: (s) => s.replace('{pet}', 'Sky'),
    });
    const titles = j.map((m) => m.title);
    expect(titles).toContain('The adventure began');
    expect(titles).toContain('Chapter 2: Forging Habits');
    expect(titles).toContain('Reached level 2');
    expect(titles).toContain('3-day streak');
    expect(titles).toContain('First workout logged');
    expect(titles).toContain("Sky's Friend");
    expect(titles).toContain('Built the Gym');
    expect(titles).toContain('Personal record: Most steps');
    expect(titles).not.toContain('Locked');
    expect(titles.some((t) => t.includes('Freeze'))).toBe(false);
    expect(j.find((m) => m.kind === 'comeback')?.detail).toBe('Back after 5 days away');
    expect(j[0].date >= j[j.length - 1].date).toBe(true);
    expect(j[j.length - 1].kind).toBe('start');
  });

  it('comeback after a real break', () => {
    const j = buildJourney({ start: '2026-01-01', today: '2026-01-20', logs: [log('2026-01-01'), log('2026-01-10')], achievements: [], ledger: [], records: [] });
    expect(j.find((m) => m.kind === 'comeback')?.detail).toBe('Back after 8 days away');
  });

  it('a new player has only the start', () => {
    expect(buildJourney({ start: '2026-01-01', today: '2026-01-01', logs: [], achievements: [], ledger: [], records: [] }).map((m) => m.kind)).toEqual(['start']);
  });
});

describe('achievement paths', () => {
  it('groups rising targets of the same counter, skipping hidden and single ones', async () => {
    const { achievementPaths } = await import('../achievements');
    const { SEED_ACHIEVEMENTS } = await import('@/data/achievements');
    const paths = achievementPaths(SEED_ACHIEVEMENTS);
    const iron = paths.find((p) => p.some((a) => a.id === 'first_rep'))!;
    expect(iron.map((a) => a.id).slice(0, 4)).toEqual(['first_rep', 'iron_beginner', 'iron_regular', 'iron_veteran']);
    for (const p of paths) {
      expect(p.length).toBeGreaterThanOrEqual(2);
      expect(p.every((a) => !a.hidden)).toBe(true);
    }
  });
});

describe('world events and collections', () => {
  const base = { date: '2026-03-04', weekday: 3, streak: 0, week: { workouts: 0, waterDays: 0, activeDays: 4, successDays: 3 }, categories: {}, buildings: [{ id: 'gym', level: 1 }] };
  it('events react to real behaviour, each with a reason', async () => {
    const { worldEvents } = await import('../world');
    expect(worldEvents(base)).toEqual([]);
    const ev = worldEvents({ ...base, streak: 9, week: { ...base.week, workouts: 3, waterDays: 5 } });
    expect(ev.map((e) => e.id)).toEqual(['lantern_festival', 'gym_buzz', 'garden_bloom']);
    expect(ev.every((e) => e.because.length > 0)).toBe(true);
    expect(worldEvents({ ...base, weekday: 6 }).map((e) => e.id)).toEqual(['weekend_market']);
    expect(worldEvents({ ...base, week: { ...base.week, activeDays: 0 } }).map((e) => e.id)).toEqual(['quiet_house']);
  });
  it('collections count only earned items and complete honestly', async () => {
    const { worldCollections } = await import('../world');
    const cols = worldCollections({
      buildings: [{ id: 'gym', name: 'Gym', icon: '🏋️', level: 5, maxLevel: 5 }, { id: 'garden', name: 'Garden', icon: '🌳', level: 0, maxLevel: 5 }],
      cosmetics: [{ id: 'free', name: 'Tee', icon: '👕', type: 'outfit', owned: true, value: 'x', price: 0 }, { id: 'jacket', name: 'Jacket', icon: '🧥', type: 'outfit', owned: true, value: 'y', price: 100 }],
      mastery: [{ id: 'mind', label: 'Mind', icon: '📚', level: 5 }],
    });
    const byId = Object.fromEntries(cols.map((c) => [c.id, c]));
    expect(byId.rooms).toMatchObject({ owned: 1, total: 2, complete: false });
    expect(byId.max_rooms).toMatchObject({ owned: 1, total: 2 });
    expect(byId.mastery_badges.complete).toBe(true);
    expect(byId.wardrobe).toMatchObject({ owned: 1, total: 1, complete: true }); // the free tee is not a collectible
    expect(byId.decor).toBeUndefined();
  });
});
