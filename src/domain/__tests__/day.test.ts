import { describe, expect, it } from 'vitest';
import { activityStreak, applyDayToStreak, applyWeekToStreak, canRevive, createStreak, isDaySuccess, reviveStreak } from '../streak';
import { calorieRatio, computeScore, stepsRatio } from '../score';
import { isDueOn } from '../recurrence';
import { closeDay } from '../dayClose';
import { makeActivity, makeLog, makePlayer, makeQuest, rules, settings } from '@/test/fixtures';
import type { Quest } from '@/types';

describe('streak engine', () => {
  it('extends and reports milestones', () => {
    let s = createStreak();
    const milestones: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const r = applyDayToStreak(s, `2026-09-${String(i).padStart(2, '0')}`, { success: true, sick: false }, 0, rules.streak);
      s = r.streak;
      if (r.milestone) milestones.push(r.milestone);
    }
    expect(s.current).toBe(7);
    expect(s.longest).toBe(7);
    expect(milestones).toEqual([3, 7]);
  });

  it('consumes a freeze instead of breaking', () => {
    const s = { ...createStreak(), current: 5, longest: 5 };
    const r = applyDayToStreak(s, '2026-09-10', { success: false, sick: false }, 1, rules.streak);
    expect(r.event).toBe('frozen');
    expect(r.usedFreeze).toBe(true);
    expect(r.streak.current).toBe(5);
  });

  it('protects sick days for free', () => {
    const s = { ...createStreak(), current: 5, longest: 5 };
    const r = applyDayToStreak(s, '2026-09-10', { success: false, sick: true }, 0, rules.streak);
    expect(r.event).toBe('protected');
    expect(r.streak.current).toBe(5);
  });

  it('breaks and can be revived within the window', () => {
    const s = { ...createStreak(), current: 12, longest: 12 };
    const broken = applyDayToStreak(s, '2026-09-10', { success: false, sick: false }, 0, rules.streak).streak;
    expect(broken.current).toBe(0);
    expect(broken.brokenValue).toBe(12);
    const next = applyDayToStreak(broken, '2026-09-11', { success: true, sick: false }, 0, rules.streak).streak;
    expect(canRevive(next, '2026-09-12', rules.streak)).toBe(true);
    expect(canRevive(next, '2026-09-20', rules.streak)).toBe(false);
    const revived = reviveStreak(next);
    expect(revived.current).toBe(13);
    expect(revived.brokenValue).toBeUndefined();
  });

  it('weekly streak counts each week once', () => {
    let s = createStreak();
    s = applyWeekToStreak(s, '2026-W38', true);
    s = applyWeekToStreak(s, '2026-W38', true);
    s = applyWeekToStreak(s, '2026-W39', true);
    expect(s.weekly.current).toBe(2);
    s = applyWeekToStreak(s, '2026-W40', false);
    expect(s.weekly.current).toBe(0);
    expect(s.weekly.longest).toBe(2);
  });

  it('day success respects threshold and rest days', () => {
    expect(isDaySuccess({ score: 71, threshold: 70, restDay: false, coreDone: 0, coreTotal: 5 })).toBe(true);
    expect(isDaySuccess({ score: 69, threshold: 70, restDay: false, coreDone: 5, coreTotal: 5 })).toBe(false);
    expect(isDaySuccess({ score: 20, threshold: 70, restDay: true, coreDone: 2, coreTotal: 2 })).toBe(true);
  });

  it('per-activity streak ignores today pending', () => {
    const qs: Quest[] = [
      makeQuest({ date: '2026-09-25', status: 'pending' }),
      makeQuest({ date: '2026-09-24', status: 'completed' }),
      makeQuest({ date: '2026-09-23', status: 'completed' }),
      makeQuest({ date: '2026-09-22', status: 'skipped' }),
      makeQuest({ date: '2026-09-21', status: 'completed' }),
    ];
    expect(activityStreak(qs, '2026-09-25')).toBe(2);
  });
});

describe('today score', () => {
  const base = {
    steps: settings.steps,
    waterTargetMl: 2000,
    nutrition: settings.nutrition,
    trackNutrition: true,
    restDay: false,
    routine: null,
    consistency7d: null,
    achievementsToday: 0,
  };

  it('is 0..100 and weights core heavily', () => {
    const coreOnly = computeScore(
      { ...base, quests: [makeQuest({ tier: 'core', status: 'completed' }), makeQuest({ tier: 'important' })], metrics: {} },
      rules.score,
    );
    const importantOnly = computeScore(
      { ...base, quests: [makeQuest({ tier: 'core' }), makeQuest({ tier: 'important', status: 'completed' })], metrics: {} },
      rules.score,
    );
    expect(coreOnly.total).toBeGreaterThan(importantOnly.total);
    expect(coreOnly.total).toBeLessThanOrEqual(100);
  });

  it('optional quests cannot ruin a good day', () => {
    const quests = [
      makeQuest({ tier: 'core', status: 'completed' }),
      makeQuest({ tier: 'core', status: 'completed' }),
      makeQuest({ tier: 'important', status: 'completed' }),
      ...Array.from({ length: 10 }, () => makeQuest({ tier: 'optional', kind: 'side' })),
    ];
    const s = computeScore(
      { ...base, quests, metrics: { steps: 7000, water: 2000, calories: 1800, protein: 150 } },
      rules.score,
    );
    expect(s.total).toBeGreaterThanOrEqual(90);
  });

  it('achievement bonus is capped and total never exceeds 100', () => {
    const s = computeScore(
      { ...base, achievementsToday: 10, quests: [makeQuest({ status: 'completed' })], metrics: { steps: 9000, water: 3000, calories: 1800, protein: 160 } },
      rules.score,
    );
    expect(s.bonus).toBe(rules.score.achievementBonusMax);
    expect(s.total).toBe(100);
  });

  it('redistributes weights for components that do not apply', () => {
    const s = computeScore({ ...base, trackNutrition: false, restDay: true, quests: [makeQuest({ status: 'completed' })], metrics: { water: 2000 } }, rules.score);
    expect(s.total).toBe(100);
  });

  it('steps and calories helpers', () => {
    expect(stepsRatio(0, settings.steps)).toBe(0);
    expect(stepsRatio(settings.steps.min, settings.steps)).toBeCloseTo(0.7);
    expect(stepsRatio(settings.steps.ideal, settings.steps)).toBe(1);
    expect(calorieRatio(1800, 1800, 10)).toBe(1);
    expect(calorieRatio(1950, 1800, 10)).toBe(1);
    expect(calorieRatio(3000, 1800, 10)).toBe(0);
  });
});

describe('recurrence', () => {
  const ctx = { date: '2026-09-23', dayType: 'work' as const, trainingAvailable: true, completedThisWeek: 0, daysLeftInWeek: 5 };

  it('daily and weekday schedules', () => {
    expect(isDueOn(makeActivity({ recurrence: { type: 'daily' } }), ctx)).toBe(true);
    expect(isDueOn(makeActivity({ recurrence: { type: 'weekdays', days: [3] } }), ctx)).toBe(true); // Wed
    expect(isDueOn(makeActivity({ recurrence: { type: 'weekdays', days: [1] } }), ctx)).toBe(false);
    expect(isDueOn(makeActivity({ recurrence: { type: 'pool' } }), ctx)).toBe(false);
    expect(isDueOn(makeActivity({ active: false }), ctx)).toBe(false);
  });

  it('times per week spaces occurrences and catches up at week end', () => {
    const shave = makeActivity({ recurrence: { type: 'timesPerWeek', times: 1 } });
    expect(isDueOn(shave, { ...ctx, completedThisWeek: 1 })).toBe(false);
    expect(isDueOn(shave, { ...ctx, lastCompletedDate: '2026-09-20' })).toBe(false);
    expect(isDueOn(shave, { ...ctx, lastCompletedDate: '2026-09-15' })).toBe(true);
    const thrice = makeActivity({ recurrence: { type: 'timesPerWeek', times: 3 } });
    expect(isDueOn(thrice, { ...ctx, completedThisWeek: 1, lastCompletedDate: '2026-09-22', daysLeftInWeek: 2 })).toBe(true);
  });

  it('every N days and rest-day filtering', () => {
    const a = makeActivity({ recurrence: { type: 'everyNDays', n: 3 } });
    expect(isDueOn(a, { ...ctx, lastCompletedDate: '2026-09-22' })).toBe(false);
    expect(isDueOn(a, { ...ctx, lastCompletedDate: '2026-09-20' })).toBe(true);
    const training = makeActivity({ category: 'fitness' });
    expect(isDueOn(training, { ...ctx, dayType: 'rest' })).toBe(false);
    expect(isDueOn(makeActivity({ availableOn: 'freeday' }), ctx)).toBe(false);
  });
});

describe('day close', () => {
  const scoreBase = {
    steps: settings.steps,
    waterTargetMl: 2000,
    nutrition: settings.nutrition,
    trackNutrition: false,
    routine: null,
    consistency7d: null,
    achievementsToday: 0,
  };

  it('perfect day extends streak, grants HP and focused buff', () => {
    const quests = [makeQuest({ status: 'completed' }), makeQuest({ status: 'completed' })];
    const r = closeDay({
      date: '2026-09-25',
      quests,
      log: makeLog({ metrics: { steps: 8000, water: 2500 } }),
      player: makePlayer({ hp: 80 }),
      rules,
      difficulty: 'hard',
      score: scoreBase,
      worldDailyIncome: 50,
    });
    expect(r.success).toBe(true);
    expect(r.perfectCore).toBe(true);
    expect(r.streak.event).toBe('extended');
    expect(r.hp.delta).toBeGreaterThan(0);
    expect(r.effects.some((e) => e.kind === 'focused')).toBe(true);
    expect(r.worldIncome).toBeGreaterThan(0);
  });

  it('bad day: bounded penalties and a debuff, never below 0 coins', () => {
    const quests = Array.from({ length: 6 }, () => makeQuest({ tier: 'core' }));
    const r = closeDay({
      date: '2026-09-25',
      quests,
      log: makeLog(),
      player: makePlayer({ coins: 7, streak: { ...createStreak(), current: 4, longest: 4 } }),
      rules,
      difficulty: 'insane',
      score: scoreBase,
      worldDailyIncome: 50,
    });
    expect(r.success).toBe(false);
    expect(r.streak.event).toBe('broken');
    expect(r.hp.delta).toBeGreaterThanOrEqual(-rules.hp.dailyLossCap);
    expect(r.coinsDelta).toBeGreaterThanOrEqual(-7);
    expect(r.worldIncome).toBe(0);
    expect(r.effects.some((e) => e.kind === 'sluggish')).toBe(true);
  });

  it('recovery mode disables coin penalties and debuffs', () => {
    const quests = Array.from({ length: 4 }, () => makeQuest({ tier: 'core' }));
    const r = closeDay({
      date: '2026-09-25',
      quests,
      log: makeLog(),
      player: makePlayer({ recoveryMode: true, hp: 20 }),
      rules,
      difficulty: 'hard',
      score: scoreBase,
      worldDailyIncome: 0,
    });
    expect(r.coinsDelta).toBe(0);
    expect(r.effects.some((e) => e.kind === 'sluggish')).toBe(false);
  });
});
