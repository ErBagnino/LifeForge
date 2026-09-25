import { describe, expect, it } from 'vitest';
import { consecutiveFailures, improvementStreak, suggestProgression, type ExerciseHistoryEntry } from '../progression';
import { evaluateCardioWeek } from '../cardio';
import { recommendCalories, recommendProtein, recommendStepTargets } from '../targets';
import { conditionProgress, evaluateCondition, findNewlyUnlocked } from '../achievements';
import { buildBlockers, buildingCost, worldBonuses, worldIncome } from '../tycoon';
import { computeClassAffinities } from '../classes';
import { detectRecords, exerciseRecordCandidates } from '../records';
import { goalProgressFixture } from './goalFixture';
import { evaluateGoal } from '../goals';
import { settings } from '@/test/fixtures';
import type { Achievement, Building, ProgressionRule, Rpe } from '@/types';
import { DEFAULT_CARDIO_STAGES } from '@/data/cardio';

const rule: ProgressionRule = {
  increment: 2.5,
  maxIncreasePct: 15,
  easyRpeMax: 2,
  requireAllSets: true,
  requireTopOfRange: true,
  failuresBeforeDeload: 3,
  deloadPct: 10,
  minWeight: 0,
};

const entry = (weight: number, reps: number[], rpe: Rpe, date = '2026-09-20', completed = true): ExerciseHistoryEntry => ({
  date,
  weight,
  repMin: 8,
  repMax: 12,
  targetSets: 3,
  sets: reps.map((r) => ({ weight, reps: r, completed, rpe })),
});

const input = (history: ExerciseHistoryEntry[], weight = 20) => ({
  measure: 'reps' as const,
  bodyweight: false,
  current: { weight, repMin: 8, repMax: 12 },
  history,
  rule,
  maxIncreasePct: 15,
});

describe('workout progression engine', () => {
  it('no data → no suggestion (never blind)', () => {
    expect(suggestProgression(input([])).action).toBe('none');
  });

  it('spec example: 20 kg × 10/10/10 easy → 22.5 kg, 8–10 reps', () => {
    const s = suggestProgression(input([entry(20, [10, 10, 10], 1)]));
    expect(s.action).toBe('increase');
    expect(s.nextWeight).toBe(22.5);
    expect(s.repMin).toBe(8);
    expect(s.repMax).toBe(10);
  });

  it('top of range at normal effort → increase; hard → maintain', () => {
    expect(suggestProgression(input([entry(20, [12, 12, 12], 2)])).action).toBe('increase');
    expect(suggestProgression(input([entry(20, [12, 12, 12], 3)])).action).toBe('maintain');
  });

  it('sets done but not top of range → add reps first', () => {
    expect(suggestProgression(input([entry(20, [9, 9, 8], 2)])).action).toBe('increase_reps');
  });

  it('failure learning: 1 fail stay, 2 fails step back, 3 fails deload', () => {
    const fail = (d: string) => entry(22.5, [8, 7, 6], 4, d);
    const ok = entry(20, [12, 12, 12], 2, '2026-09-10');
    expect(suggestProgression(input([fail('2026-09-20'), ok], 22.5)).action).toBe('maintain');
    const two = suggestProgression(input([fail('2026-09-20'), fail('2026-09-17'), ok], 22.5));
    expect(two.action).toBe('decrease');
    expect(two.nextWeight).toBe(20);
    expect(two.reason).toMatch(/Last 2 sessions/);
    const three = suggestProgression(input([fail('2026-09-20'), fail('2026-09-17'), fail('2026-09-14')], 22.5));
    expect(three.action).toBe('deload');
    expect(three.nextWeight).toBeLessThan(22.5);
    expect(consecutiveFailures([fail('a'), fail('b'), ok])).toBe(2);
  });

  it('respects the safety cap on light weights', () => {
    const s = suggestProgression(input([entry(5, [12, 12, 12], 1)], 5));
    expect(s.nextWeight - 5).toBeLessThanOrEqual(0.75 + 1e-9);
  });

  it('time-based exercises progress in seconds', () => {
    const plank = suggestProgression({
      measure: 'time',
      bodyweight: true,
      current: { weight: 0, repMin: 30, repMax: 60 },
      history: [{ date: 'x', weight: 0, repMin: 30, repMax: 60, targetSets: 3, sets: [60, 60, 60].map((r) => ({ weight: 0, reps: r, completed: true, rpe: 1 as Rpe })) }],
      rule: { ...rule, increment: 5 },
      maxIncreasePct: 15,
    });
    expect(plank.action).toBe('increase_reps');
    expect(plank.repMax).toBe(65);
  });

  it('tracks improvement streaks', () => {
    const h = [entry(25, [10, 10, 10], 2, 'd4'), entry(22.5, [10, 10, 10], 2, 'd3'), entry(20, [11, 11, 11], 2, 'd2'), entry(20, [10, 10, 10], 2, 'd1')];
    expect(improvementStreak(h)).toBe(3);
  });
});

describe('cardio progression', () => {
  it('advances only after a good, comfortable week', () => {
    const adv = evaluateCardioWeek(0, DEFAULT_CARDIO_STAGES, { planned: 3, completed: 3, avgDifficulty: 2, weeksAtStage: 1 }, 20);
    expect(adv.action).toBe('advance');
    expect(evaluateCardioWeek(0, DEFAULT_CARDIO_STAGES, { planned: 3, completed: 3, avgDifficulty: 3, weeksAtStage: 1 }, 20).action).toBe('hold');
    expect(evaluateCardioWeek(3, DEFAULT_CARDIO_STAGES, { planned: 3, completed: 3, avgDifficulty: 3.8, weeksAtStage: 1 }, 20).action).toBe('step_back');
    expect(evaluateCardioWeek(0, DEFAULT_CARDIO_STAGES, { planned: 3, completed: 1, avgDifficulty: 2, weeksAtStage: 3 }, 20).action).toBe('hold');
  });

  it('blocks jumps above the safety cap', () => {
    expect(evaluateCardioWeek(0, DEFAULT_CARDIO_STAGES, { planned: 3, completed: 3, avgDifficulty: 1.5, weeksAtStage: 1 }, 5).action).toBe('hold');
  });
});

describe('adaptive targets', () => {
  it('steps: gradual increments (6500 → 6750), never absurd', () => {
    const r = recommendStepTargets([7000, 7200, 6900, 7100, 6800, 7300, 7000], { min: 5500, ideal: 6500, stretch: 8500 }, settings.safety);
    expect(r.action).toBe('increase');
    expect(r.next.ideal).toBe(6750);
    const down = recommendStepTargets([2000, 2500, 3000, 1000, 4000, 3500, 2000], { min: 5500, ideal: 6500, stretch: 8500 }, settings.safety);
    expect(down.action).toBe('decrease');
    expect(down.next.ideal).toBe(6250);
    expect(recommendStepTargets([7000, 0, 0, 0, 0, 0, 0], { min: 5500, ideal: 6500, stretch: 8500 }, settings.safety).action).toBe('keep');
  });

  it('calories: small, bounded, data-driven suggestions', () => {
    const flat = Array.from({ length: 8 }, (_, i) => ({ day: i * 2, kg: 74 }));
    const r = recommendCalories({ weights: flat, loggedCalories: [1800, 1790], adherence: 0.9, goal: 'lose', currentTarget: 1800, bodyWeight: 74, safety: settings.safety });
    expect(r.action).toBe('decrease');
    expect(1800 - r.next).toBeLessThanOrEqual(settings.safety.calorieMaxAdjust);
    const atMin = recommendCalories({ weights: flat, loggedCalories: [1500], adherence: 0.9, goal: 'lose', currentTarget: settings.safety.calorieMin, bodyWeight: 74, safety: settings.safety });
    expect(atMin.next).toBeGreaterThanOrEqual(settings.safety.calorieMin);
    const lowAdh = recommendCalories({ weights: flat, loggedCalories: [], adherence: 0.3, goal: 'lose', currentTarget: 1800, bodyWeight: 74, safety: settings.safety });
    expect(lowAdh.action).toBe('keep');
    const fast = Array.from({ length: 8 }, (_, i) => ({ day: i * 2, kg: 74 - i * 0.3 }));
    expect(recommendCalories({ weights: fast, loggedCalories: [1800], adherence: 0.9, goal: 'lose', currentTarget: 1800, bodyWeight: 74, safety: settings.safety }).action).toBe('increase');
  });

  it('protein only changes outside bounds', () => {
    expect(recommendProtein(150, 74, settings.safety).action).toBe('keep');
    expect(recommendProtein(60, 74, settings.safety).action).toBe('increase');
  });
});

describe('achievement engine', () => {
  const ach = (id: string, key: string, gte: number): Achievement => ({
    id,
    name: id,
    description: '',
    category: 'first_steps',
    icon: '🏅',
    tier: 'bronze',
    hidden: false,
    condition: { type: 'counter', key, gte },
    xp: 10,
    coins: 5,
  });

  it('unlocks when counters reach thresholds, only once', () => {
    const list = [ach('first', 'quests.completed', 1), ach('ten', 'quests.completed', 10), { ...ach('done', 'quests.completed', 1), unlockedAt: 1 }];
    expect(findNewlyUnlocked(list, { 'quests.completed': 1 }).map((a) => a.id)).toEqual(['first']);
    expect(findNewlyUnlocked(list, { 'quests.completed': 12 }).map((a) => a.id)).toEqual(['first', 'ten']);
  });

  it('supports composite conditions and progress', () => {
    const cond = { type: 'all' as const, of: [{ type: 'counter' as const, key: 'a', gte: 2 }, { type: 'counter' as const, key: 'b', gte: 4 }] };
    expect(evaluateCondition(cond, { a: 2, b: 3 })).toBe(false);
    expect(evaluateCondition(cond, { a: 2, b: 4 })).toBe(true);
    expect(conditionProgress(cond, { a: 1, b: 4 }).ratio).toBeCloseTo(0.75);
    expect(evaluateCondition({ type: 'any', of: cond.of }, { a: 2 })).toBe(true);
  });
});

describe('tycoon economy', () => {
  const gym: Building = {
    id: 'gym',
    name: 'Gym',
    icon: '🏋️',
    description: '',
    lifeArea: 'Strength',
    stats: ['strength'],
    categories: ['fitness'],
    floor: 1,
    slot: 'left',
    maxLevel: 5,
    baseCost: 500,
    costGrowth: 3,
    unlockLevel: 3,
    requires: [],
    effects: [
      { type: 'categoryXpPct', categories: ['fitness'], pctPerLevel: 5 },
      { type: 'dailyIncome', perLevel: 10 },
    ],
    palette: { wall: '#000', floor: '#000', accent: '#000' },
    furniture: [['🏋️']],
    level: 0,
  };

  it('prices grow exponentially (500 → 1,500 → 4,500)', () => {
    expect(buildingCost(gym, 1)).toBe(500);
    expect(buildingCost(gym, 2)).toBe(1500);
    expect(buildingCost(gym, 3)).toBe(4500);
    expect(buildingCost(gym, 4)).toBeGreaterThan(buildingCost(gym, 3) * 2);
  });

  it('reports blockers', () => {
    const b = buildBlockers(gym, 1, 100, [gym]);
    expect(b.map((x) => x.type)).toEqual(['playerLevel', 'coins']);
    expect(buildBlockers(gym, 5, 1000, [gym])).toEqual([]);
    expect(buildBlockers({ ...gym, level: 5 }, 50, 1e9, [gym])).toEqual([{ type: 'maxLevel' }]);
  });

  it('aggregates bonuses and ties income to playing', () => {
    const bonus = worldBonuses([{ ...gym, level: 2 }]);
    expect(bonus.xpPctByCategory.fitness).toBe(10);
    expect(bonus.dailyIncome).toBe(20);
    expect(worldIncome(20, 80)).toBe(16);
    expect(worldIncome(20, 10)).toBe(0);
  });
});

describe('character class', () => {
  it('emerges from behaviour', () => {
    const athlete = computeClassAffinities({ stats: { strength: 50, endurance: 40, order: 5 }, categoryCounts: { fitness: 20 }, coreRate: 0.5, streak: 0, recoveryDays: 0, worldSpend: 0 });
    expect(athlete[0].classId).toBe('athlete');
    const creator = computeClassAffinities({ stats: { knowledge: 60, discipline: 5 }, categoryCounts: { reading: 20, productivity: 10 }, coreRate: 0.3, streak: 0, recoveryDays: 0, worldSpend: 0 });
    expect(creator[0].classId).toBe('creator');
    const sum = athlete.reduce((s, a) => s + a.affinity, 0);
    expect(sum).toBeCloseTo(1);
  });
});

describe('personal records', () => {
  it('detects only real improvements', () => {
    const cands = exerciseRecordCandidates(
      { exerciseId: 'chest_press', targetSets: 3, repMin: 8, repMax: 12, restSec: 90, targetWeight: 20, sets: [{ weight: 22.5, reps: 10, completed: true }, { weight: 22.5, reps: 9, completed: true }] },
      'Chest press',
      'reps',
      false,
    );
    const existing = new Map([['ex:chest_press:weight', { id: 'ex:chest_press:weight', kind: 'exercise_weight' as const, label: '', value: 25, unit: 'kg', date: 'x', updatedAt: 0 }]]);
    const prs = detectRecords(cands, existing, '2026-09-25', 1);
    expect(prs.map((p) => p.id)).not.toContain('ex:chest_press:weight');
    expect(prs.map((p) => p.id)).toContain('ex:chest_press:volume');
  });
});

describe('goals', () => {
  it('evaluates weekly-style goals', () => {
    const { ctx } = goalProgressFixture();
    expect(evaluateGoal({ type: 'workouts', count: 3 }, ctx)).toMatchObject({ progress: 2, done: false });
    expect(evaluateGoal({ type: 'metricSum', metric: 'steps', target: 10000 }, ctx)).toMatchObject({ progress: 10000, done: true });
    expect(evaluateGoal({ type: 'metricDays', metric: 'water', days: 2 }, ctx).progress).toBe(1);
    expect(evaluateGoal({ type: 'perfectCoreDays', days: 2 }, ctx).progress).toBe(1);
    expect(evaluateGoal({ type: 'categoriesTouched', count: 2 }, ctx).done).toBe(true);
  });
});
