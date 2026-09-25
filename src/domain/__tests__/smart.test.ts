import { describe, expect, it } from 'vitest';
import { computeWorkload, dayCapacity, freeMinutesUntilNextBlock, activeBlock } from '../workload';
import { computeDifficultyState, coreCap, importantCap, selectDemotions, sideQuestBudget } from '../adaptive';
import { generateSideQuests, rollRarity, scaleActivity } from '../questGenerator';
import { pickNextAction } from '../nextAction';
import { evaluateRules } from '../rulesEngine';
import { governReminders, planReminders } from '../reminders';
import { snoozeOptions } from '../snooze';
import { learnTimes, suggestTimeChanges } from '../habits';
import { makeActivity, makeQuest, rules, settings } from '@/test/fixtures';
import { createRng } from '@/utils/math';

const workPlan = { wake: '07:00', sleep: '23:30', work: { start: '09:00', end: '19:00' }, busy: [] };
const freePlan = { wake: '08:00', sleep: '23:30', busy: [] };

describe('workload', () => {
  it('10h workday is medium, free day is low', () => {
    const work = computeWorkload({ capacity: dayCapacity(workPlan), questMinutes: 90, questEnergy: 60, workoutScheduled: false, energyStart: 90 });
    const free = computeWorkload({ capacity: dayCapacity(freePlan), questMinutes: 90, questEnergy: 60, workoutScheduled: false, energyStart: 90 });
    expect(work.level).toBe('medium');
    expect(free.level).toBe('low');
    expect(work.score).toBeGreaterThan(free.score);
  });

  it('workout + tired + workday is high', () => {
    const w = computeWorkload({ capacity: dayCapacity(workPlan), questMinutes: 200, questEnergy: 90, workoutScheduled: true, energyStart: 40 });
    expect(w.level).toBe('high');
  });

  it('knows free time until the next block', () => {
    expect(activeBlock(workPlan, 10 * 60)).toBeDefined();
    expect(freeMinutesUntilNextBlock(workPlan, 10 * 60)).toBe(0);
    expect(freeMinutesUntilNextBlock(workPlan, 8 * 60)).toBe(60);
    expect(freeMinutesUntilNextBlock(workPlan, 20 * 60)).toBe(210);
  });
});

describe('adaptive difficulty', () => {
  const r = rules.adaptive;
  it('classifies states', () => {
    expect(computeDifficultyState({ workload: 30, energy: 90, completion7d: 0.95, missedCore3d: 0, hp: 90, recoveryMode: false }, r)).toBe('too_easy');
    expect(computeDifficultyState({ workload: 50, energy: 80, completion7d: 0.75, missedCore3d: 1, hp: 90, recoveryMode: false }, r)).toBe('balanced');
    expect(computeDifficultyState({ workload: 75, energy: 80, completion7d: 0.75, missedCore3d: 0, hp: 90, recoveryMode: false }, r)).toBe('overloaded');
    expect(computeDifficultyState({ workload: 30, energy: 90, completion7d: 0.9, missedCore3d: 0, hp: 20, recoveryMode: false }, r)).toBe('critical');
    expect(computeDifficultyState({ workload: 10, energy: 90, completion7d: null, missedCore3d: 0, hp: 90, recoveryMode: true }, r)).toBe('critical');
  });

  it('budget shrinks with load and is zero when critical', () => {
    const b = (state: 'too_easy' | 'balanced' | 'overloaded' | 'critical', workloadLevel: 'low' | 'medium' | 'high') =>
      sideQuestBudget(
        { workloadLevel, state, preset: rules.difficultyPresets.hard, extraSlots: 0, energyAfterCore: 60, freeAfterQuestsMin: 240, dayType: 'free' },
        rules.generator,
      );
    expect(b('too_easy', 'low').count).toBeGreaterThan(b('balanced', 'low').count);
    expect(b('balanced', 'low').count).toBeGreaterThan(b('balanced', 'high').count);
    expect(b('overloaded', 'low').count).toBeLessThanOrEqual(1);
    expect(b('critical', 'low').count).toBe(0);
  });

  it('never proposes more side quests than time allows', () => {
    const b = sideQuestBudget(
      { workloadLevel: 'low', state: 'too_easy', preset: rules.difficultyPresets.insane, extraSlots: 2, energyAfterCore: 90, freeAfterQuestsMin: 20, dayType: 'free' },
      rules.generator,
    );
    expect(b.count).toBeLessThanOrEqual(1);
  });

  it('caps effortful core quests on heavy workdays by importance', () => {
    expect(coreCap('high', 'balanced', rules.generator)).toBe(4);
    expect(coreCap('high', 'critical', rules.generator)).toBeLessThanOrEqual(3);
    expect(importantCap('high', 'critical', rules.generator)).toBe(0);
    const quests = [5, 4, 3, 2, 1, 5, 4].map((importance, i) => ({ id: `q${i}`, tier: 'core' as const, importance: importance as 1 | 2 | 3 | 4 | 5, durationMin: 10 }));
    const demoted = selectDemotions(quests, 5);
    expect(demoted).toHaveLength(2);
    expect(demoted).toContain('q4');
    expect(demoted).toContain('q3');
  });

  it('never counts trivial quests and protects workouts', () => {
    const quests = [
      { id: 'brush', tier: 'core' as const, importance: 4 as const, durationMin: 3 },
      { id: 'pet', tier: 'core' as const, importance: 5 as const, durationMin: 3 },
      { id: 'workout', tier: 'core' as const, importance: 3 as const, durationMin: 60, protected: true },
      { id: 'walk', tier: 'core' as const, importance: 5 as const, durationMin: 30 },
    ];
    expect(selectDemotions(quests, 1)).toEqual(['walk']);
  });
});

describe('quest generator', () => {
  const candidates = [
    makeActivity({ id: 'walk', category: 'outdoor', durationMin: 15, scalable: { field: 'duration', min: 5, max: 30, step: 5 }, difficulty: 2 }),
    makeActivity({ id: 'read', category: 'reading', durationMin: 15, difficulty: 2 }),
    makeActivity({ id: 'tidy', category: 'order', durationMin: 5, difficulty: 1 }),
    makeActivity({ id: 'tidy2', category: 'order', durationMin: 10, difficulty: 1 }),
    makeActivity({ id: 'long', category: 'productivity', durationMin: 60, difficulty: 3 }),
    makeActivity({ id: 'hard', category: 'fitness', durationMin: 20, difficulty: 4 }),
    makeActivity({ id: 'inactive', active: false }),
  ];
  const base = {
    date: '2026-09-25',
    seed: 'test',
    candidates,
    excludeIds: new Set<string>(),
    budget: { count: 3, maxDuration: 20, energyBudget: 60, challengeBoost: 0, challenge: true },
    history: { lastGenerated: {}, completed14d: {}, skipped14d: {}, categoryCompleted7d: {} },
    focusCategories: [],
    level: 1,
    state: 'balanced' as const,
    timeOfDay: 'anytime' as const,
    ownedBuildings: new Set<string>(),
    rarityWeights: rules.generator.rarityWeights,
    recencyDays: 3,
    freeMinutes: 120,
  };

  it('respects count, duration, level gates and category diversity', () => {
    const out = generateSideQuests(base);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.length).toBeGreaterThan(0);
    for (const q of out) {
      expect(q.durationMin).toBeLessThanOrEqual(20);
      expect(['long', 'hard', 'inactive']).not.toContain(q.activity.id);
    }
    const cats = out.map((q) => q.activity.category);
    expect(new Set(cats).size).toBe(cats.length);
  });

  it('is deterministic per seed/date', () => {
    expect(generateSideQuests(base).map((q) => q.activity.id)).toEqual(generateSideQuests(base).map((q) => q.activity.id));
  });

  it('returns nothing when the budget is zero and excludes scheduled ones', () => {
    expect(generateSideQuests({ ...base, budget: { ...base.budget, count: 0 } })).toEqual([]);
    const out = generateSideQuests({ ...base, excludeIds: new Set(['walk', 'read', 'tidy', 'tidy2']) });
    expect(out).toEqual([]);
  });

  it('avoids repeating recently generated quests', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 60; i++) {
      const out = generateSideQuests({
        ...base,
        seed: `s${i}`,
        budget: { ...base.budget, count: 1 },
        history: { ...base.history, lastGenerated: { walk: '2026-09-24' } },
      });
      for (const q of out) counts[q.activity.id] = (counts[q.activity.id] ?? 0) + 1;
    }
    expect(counts.walk ?? 0).toBeLessThan(10);
  });

  it('scales quests to the time window', () => {
    const walk = candidates[0];
    expect(scaleActivity(walk, 10).durationMin).toBe(10);
    expect(scaleActivity(walk, 60).durationMin).toBe(30);
    expect(scaleActivity(walk, 3).durationMin).toBe(5);
  });

  it('rarity roll favours common', () => {
    const rand = createRng(42);
    const tally: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const r = rollRarity(rand, rules.generator.rarityWeights);
      tally[r] = (tally[r] ?? 0) + 1;
    }
    expect(tally.common).toBeGreaterThan(tally.uncommon);
    expect(tally.uncommon).toBeGreaterThan(tally.rare ?? 0);
  });
});

describe('next action', () => {
  it('prefers overdue core quests and tiny quests during work', () => {
    const quests = [
      makeQuest({ id: 'opt', tier: 'optional', durationMin: 10 }),
      makeQuest({ id: 'core', tier: 'core', scheduledTime: '08:00', durationMin: 10 }),
      makeQuest({ id: 'done', status: 'completed' }),
    ];
    const ctx = { now: 0, nowMin: 9 * 60, energy: 80, freeMinutes: 60, inBlock: false, dayType: 'work' as const, streakAtRisk: false, workloadLevel: 'medium' as const, dayStartHour: 4 };
    expect(pickNextAction(quests, ctx)?.quest.id).toBe('core');
    const inWork = [makeQuest({ id: 'big', durationMin: 45 }), makeQuest({ id: 'tiny', durationMin: 3, tier: 'important' })];
    expect(pickNextAction(inWork, { ...ctx, inBlock: true, freeMinutes: 0 })?.quest.id).toBe('tiny');
  });

  it('skips snoozed quests until they wake up', () => {
    const quests = [makeQuest({ id: 'snoozed', snoozedUntil: 5000 }), makeQuest({ id: 'other', tier: 'optional' })];
    const ctx = { now: 1000, nowMin: 12 * 60, energy: 80, freeMinutes: 60, inBlock: false, dayType: 'free' as const, streakAtRisk: false, workloadLevel: 'low' as const, dayStartHour: 4 };
    expect(pickNextAction(quests, ctx)?.quest.id).toBe('other');
    expect(pickNextAction(quests, { ...ctx, now: 6000 })?.quest.id).toBe('snoozed');
  });
});

describe('rules engine', () => {
  it('fires matching rules once per day', () => {
    const facts = { completionRate: 0.95, energy: 70, hour: 15 };
    const fired = evaluateRules(rules.smartRules, 'quest_completed', facts, new Set());
    expect(fired.map((r) => r.id)).toContain('momentum_side_quest');
    expect(evaluateRules(rules.smartRules, 'quest_completed', facts, new Set(['momentum_side_quest']))).toHaveLength(0);
    expect(evaluateRules(rules.smartRules, 'quest_completed', { ...facts, energy: 20 }, new Set())).toHaveLength(0);
  });

  it('deload guard after three failed sessions', () => {
    const fired = evaluateRules(rules.smartRules, 'workout_completed', { consecutiveFailedSessions: 3, allSetsCompleted: false, avgRpe: 3.5 }, new Set());
    expect(fired.map((r) => r.id)).toEqual(['deload_guard']);
  });
});

describe('reminders + governor', () => {
  const ns = { ...settings.notifications, enabled: true };
  it('respects cap, gap, quiet hours and dedupe', () => {
    const day = new Date('2026-09-25T00:00:00').getTime();
    const at = (h: number, m = 0) => day + (h * 60 + m) * 60000;
    const planned = [
      { type: 'workout' as const, at: at(18, 30), title: '', body: '', tag: 'a', priority: 90 },
      { type: 'hydration' as const, at: at(18, 40), title: '', body: '', tag: 'b', priority: 40 },
      { type: 'quest' as const, at: at(23, 30), title: '', body: '', tag: 'c', priority: 70 },
      { type: 'quest' as const, at: at(12), title: '', body: '', tag: 'd', priority: 70 },
      { type: 'quest' as const, at: at(14), title: '', body: '', tag: 'sent', priority: 70 },
    ];
    const out = governReminders(planned, [{ tag: 'sent', sentAt: at(9), status: 'sent' }], ns);
    const tags = out.map((o) => o.tag);
    expect(tags).toContain('a');
    expect(tags).not.toContain('b');
    expect(tags).not.toContain('c');
    expect(tags).not.toContain('sent');
    expect(out.length).toBeLessThanOrEqual(ns.maxPerDay - 1);
  });

  it('plans workout/snooze/recap reminders', () => {
    const now = new Date('2026-09-25T08:00:00').getTime();
    const planned = planReminders({
      date: '2026-09-25',
      now,
      dayStartHour: 4,
      settings: ns,
      wake: '07:00',
      sleep: '23:30',
      quests: [
        makeQuest({ kind: 'workout', title: 'Upper A', scheduledTime: '19:00' }),
        makeQuest({ id: 'sn', snoozedUntil: now + 3600000 }),
      ],
      learnedMinute: {},
      water: { current: 0, target: 2000 },
      streakAtRisk: true,
      streak: 5,
    });
    const types = planned.map((p) => p.type);
    expect(types).toContain('workout');
    expect(types).toContain('snooze');
    expect(types).toContain('recap');
    expect(types).toContain('streak');
  });
});

describe('snooze + habits', () => {
  it('offers smart snooze options', () => {
    const now = new Date('2026-09-25T10:00:00').getTime();
    const opts = snoozeOptions(now, 600, '2026-09-25', workPlan, { type: 'timesPerWeek', times: 2 }, 4);
    const kinds = opts.map((o) => o.kind);
    expect(kinds).toContain('30m');
    expect(kinds).toContain('after_work');
    expect(opts.length).toBeLessThanOrEqual(4);
    const daily = snoozeOptions(now, 600, '2026-09-25', workPlan, { type: 'daily' }, 4);
    expect(daily.map((o) => o.kind)).not.toContain('tomorrow');
  });

  it('learns habit times and suggests changes only for stable habits', () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({ activityId: 'gym', minute: 19 * 60 + (i % 3) * 5, weekend: false }));
    const learned = learnTimes(samples);
    expect(learned[0].median).toBeGreaterThanOrEqual(19 * 60);
    const sug = suggestTimeChanges([{ id: 'gym', name: 'Workout', preferredTime: '17:00' }], learned);
    expect(sug).toHaveLength(1);
    expect(sug[0].to).toBe('19:00');
    const none = suggestTimeChanges([{ id: 'gym', name: 'Workout', preferredTime: '19:00' }], learned);
    expect(none).toHaveLength(0);
  });

  it('handles habits around midnight', () => {
    const samples = [23 * 60 + 30, 23 * 60 + 50, 10, 20].map((minute) => ({ activityId: 'read', minute, weekend: false }));
    const learned = learnTimes(samples);
    const m = learned[0].median;
    expect(m >= 23 * 60 || m < 60).toBe(true);
  });
});
