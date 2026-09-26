import { describe, expect, it } from 'vitest';
import { levelFromXp, levelsGained, totalXpForLevel, xpToNext } from '../level';
import { applyMultipliers, computeEnergyCost, computeQuestValues, rewardMultipliers } from '../rewards';
import { applyEnergyCost, startingEnergy } from '../energy';
import { dayCloseHp, hpForQuest, resolveRecovery } from '../hp';
import { makeActivity, rules } from '@/test/fixtures';

describe('level curve', () => {
  it('starts at level 1 with 0 XP', () => {
    expect(levelFromXp(0, rules.level)).toMatchObject({ level: 1, into: 0 });
  });

  it('is monotonic and super-linear', () => {
    for (let l = 1; l < 60; l++) expect(xpToNext(l + 1, rules.level)).toBeGreaterThan(xpToNext(l, rules.level));
    const early = xpToNext(2, rules.level) - xpToNext(1, rules.level);
    const late = xpToNext(41, rules.level) - xpToNext(40, rules.level);
    expect(late).toBeGreaterThan(early);
  });

  it('round-trips cumulative XP', () => {
    for (const l of [2, 5, 10, 25]) {
      expect(levelFromXp(totalXpForLevel(l, rules.level), rules.level).level).toBe(l);
      expect(levelFromXp(totalXpForLevel(l, rules.level) - 1, rules.level).level).toBe(l - 1);
    }
  });

  it('reports every level gained in one jump', () => {
    const to = totalXpForLevel(4, rules.level);
    expect(levelsGained(0, to, rules.level)).toEqual([2, 3, 4]);
  });

  it('a good first day reaches level 2-4 (hook), level 10 takes weeks', () => {
    const day = 700;
    expect(levelFromXp(day, rules.level).level).toBeGreaterThanOrEqual(2);
    expect(levelFromXp(day, rules.level).level).toBeLessThanOrEqual(4);
    const daysTo10 = totalXpForLevel(10, rules.level) / day;
    expect(daysTo10).toBeGreaterThan(10);
    expect(daysTo10).toBeLessThan(40);
  });
});

describe('XP / coins / energy', () => {
  const baseInput = { importance: 3 as const, rarity: 'common' as const, recurrence: { type: 'daily' as const } };

  it('maps difficulty to the spec XP ranges at level 1', () => {
    const xp = (difficulty: 1 | 2 | 3 | 4 | 5, durationMin: number) =>
      computeQuestValues({ ...baseInput, difficulty, durationMin }, 1, rules).xp;
    expect(xp(1, 3)).toBeGreaterThanOrEqual(10);
    expect(xp(1, 3)).toBeLessThanOrEqual(20);
    expect(xp(2, 15)).toBeGreaterThanOrEqual(20);
    expect(xp(2, 15)).toBeLessThanOrEqual(50);
    expect(xp(3, 25)).toBeGreaterThanOrEqual(50);
    expect(xp(3, 25)).toBeLessThanOrEqual(100);
    expect(xp(4, 45)).toBeGreaterThanOrEqual(100);
    expect(xp(4, 45)).toBeLessThanOrEqual(200);
    expect(xp(5, 60)).toBeGreaterThanOrEqual(250);
  });

  it('rewards rarity, longer duration and higher level', () => {
    const v = (o: object, level = 1) => computeQuestValues({ ...baseInput, difficulty: 3, durationMin: 25, ...o }, level, rules).xp;
    expect(v({ rarity: 'legendary' })).toBeGreaterThan(v({ rarity: 'rare' }));
    expect(v({ rarity: 'rare' })).toBeGreaterThan(v({}));
    expect(v({ durationMin: 60 })).toBeGreaterThan(v({ durationMin: 10 }));
    expect(v({}, 30)).toBeGreaterThan(v({}, 1));
  });

  it('honours explicit overrides', () => {
    const vals = computeQuestValues({ ...baseInput, difficulty: 2, durationMin: 10, baseXp: 100, baseCoins: 7, energyCost: 1 }, 1, rules);
    expect(vals.coins).toBe(7);
    expect(vals.energyCost).toBe(1);
    expect(vals.xp).toBeGreaterThanOrEqual(90);
  });

  it('coins follow the configured ratio (~0.3 of XP)', () => {
    const vals = computeQuestValues({ ...baseInput, difficulty: 3, durationMin: 25 }, 1, rules);
    expect(vals.coins).toBe(Math.round(vals.xp * rules.coins.ratio));
  });

  it('energy costs follow the spec and recovery activities restore', () => {
    expect(computeEnergyCost(1, 5, rules.energy)).toBe(3);
    expect(computeEnergyCost(2, 10, rules.energy)).toBe(5);
    expect(computeEnergyCost(3, 20, rules.energy)).toBe(10);
    expect(computeEnergyCost(4, 20, rules.energy)).toBe(20);
    const workout = computeEnergyCost(4, 60, rules.energy);
    expect(workout).toBeGreaterThanOrEqual(24);
    expect(workout).toBeLessThanOrEqual(35);
    expect(computeEnergyCost(2, 20, rules.energy, 'rest')).toBeLessThan(0);
  });

  it('applies completion multipliers with labels', () => {
    const multipliers = rewardMultipliers(
      {
        now: 1000,
        date: '2026-09-25',
        streak: 10,
        preset: rules.difficultyPresets.hard,
        boosts: [{ id: 'b', type: 'xp', multiplier: 1.5, expiresAt: 2000, source: 'shop' }],
        effects: [],
        categoryXpPct: 10,
        categoryCoinPct: 0,
        recoveryMode: false,
      },
      rules.xp,
    );
    const labels = multipliers.map((m) => m.label);
    expect(labels).toContain('Difficulty');
    expect(labels).toContain('XP boost');
    const out = applyMultipliers({ xp: 100, coins: 30 }, multipliers);
    expect(out.xp).toBe(Math.round(100 * 1.1 * 1.1 * 1.1 * 1.5));
    expect(out.coins).toBe(Math.round(30 * 1.1));
  });

  it('ignores expired boosts and effects', () => {
    const m = rewardMultipliers(
      {
        now: 5000,
        date: '2026-09-25',
        streak: 0,
        preset: rules.difficultyPresets.normal,
        boosts: [{ id: 'b', type: 'xp', multiplier: 2, expiresAt: 1000, source: 'x' }],
        effects: [{ id: 'e', kind: 'sluggish', label: 'Sluggish', icon: '🐌', description: '', xpMultiplier: 0.9, expiresOn: '2026-09-24' }],
        categoryXpPct: 0,
        categoryCoinPct: 0,
        recoveryMode: false,
      },
      rules.xp,
    );
    expect(m).toHaveLength(0);
  });
});

describe('energy', () => {
  it('uses logged sleep and bounds', () => {
    expect(startingEnergy({ sleepHours: 8, restDay: false, maxEnergy: 100, recoveryMode: false }, rules.energy)).toBe(100);
    const short = startingEnergy({ sleepHours: 5, restDay: false, maxEnergy: 100, recoveryMode: false }, rules.energy);
    expect(short).toBeLessThan(80);
    expect(short).toBeGreaterThanOrEqual(rules.energy.minStart);
    expect(startingEnergy({ restDay: false, maxEnergy: 100, recoveryMode: false }, rules.energy)).toBe(rules.energy.unknownSleepStart);
    expect(startingEnergy({ sleepHours: 0, restDay: false, maxEnergy: 100, recoveryMode: false }, rules.energy)).toBe(rules.energy.minStart);
  });

  it('never drops below 0 or exceeds max', () => {
    expect(applyEnergyCost(10, 30, 100)).toBe(0);
    expect(applyEnergyCost(95, -20, 100)).toBe(100);
  });
});

describe('HP', () => {
  it('respects the daily gain cap', () => {
    expect(hpForQuest({ tier: 'core', recovery: false, gainedToday: 0, recoveryMode: false }, rules.hp)).toBe(1);
    expect(hpForQuest({ tier: 'core', recovery: false, gainedToday: rules.hp.dailyGainCap, recoveryMode: false }, rules.hp)).toBe(0);
    expect(hpForQuest({ tier: 'optional', recovery: false, gainedToday: 0, recoveryMode: false }, rules.hp)).toBe(0);
  });

  it('caps daily loss so one bad day cannot spiral', () => {
    const r = dayCloseHp(
      {
        coreMissed: 10,
        importantMissed: 10,
        perfectCore: false,
        restDayWellManaged: false,
        sick: false,
        consistency7d: 0.1,
        streakMilestone: false,
        recoveryMode: false,
        penaltyMultiplier: 1.4,
        penaltiesEnabled: true,
      },
      rules.hp,
    );
    expect(r.delta).toBe(-rules.hp.dailyLossCap);
  });

  it('sick days are never punished', () => {
    const r = dayCloseHp(
      {
        coreMissed: 5,
        importantMissed: 2,
        perfectCore: false,
        restDayWellManaged: false,
        sick: true,
        consistency7d: 0.1,
        streakMilestone: false,
        recoveryMode: false,
        penaltyMultiplier: 1,
        penaltiesEnabled: true,
      },
      rules.hp,
    );
    expect(r.delta).toBe(0);
  });

  it('softens losses in recovery mode and rewards perfect days', () => {
    const base = {
      coreMissed: 2,
      importantMissed: 0,
      perfectCore: false,
      restDayWellManaged: false,
      sick: false,
      consistency7d: null,
      streakMilestone: false,
      penaltyMultiplier: 1,
      penaltiesEnabled: true,
    };
    const normal = dayCloseHp({ ...base, recoveryMode: false }, rules.hp);
    const recovery = dayCloseHp({ ...base, recoveryMode: true }, rules.hp);
    expect(Math.abs(recovery.delta)).toBeLessThan(Math.abs(normal.delta));
    const perfect = dayCloseHp({ ...base, coreMissed: 0, perfectCore: true, recoveryMode: false }, rules.hp);
    expect(perfect.delta).toBe(rules.hp.perfectCoreDay);
  });

  it('HP 0 is a knock-out into recovery mode, not a wipe', () => {
    const t = resolveRecovery(-5, false, rules.hp);
    expect(t.knockedOut).toBe(true);
    expect(t.recoveryMode).toBe(true);
    expect(t.hp).toBe(rules.hp.recoveryThreshold);
    const exit = resolveRecovery(rules.hp.recoveryExit, true, rules.hp);
    expect(exit.exited).toBe(true);
    expect(exit.recoveryMode).toBe(false);
  });

  it('fixtures stay valid', () => {
    expect(makeActivity().active).toBe(true);
  });
});

describe('meal windows and honest estimate ranges', () => {
  it('pre-selects the meal from the local time (configurable windows)', async () => {
    const { mealTypeAt } = await import('@/config/meals');
    const at = (hm: string) => mealTypeAt(new Date(`2026-09-23T${hm}:00`));
    expect([at('07:00'), at('10:29'), at('10:30'), at('12:00'), at('15:00'), at('18:29'), at('18:30'), at('22:30'), at('01:00')]).toEqual(['breakfast', 'breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'afternoon_snack', 'dinner', 'night_snack', 'night_snack']);
    expect(mealTypeAt(new Date('2026-09-23T09:00:00'), [{ type: 'breakfast', start: '05:00' }, { type: 'lunch', start: '08:30' }])).toBe('lunch');
  });

  it('shows photo estimates as ranges that widen with lower confidence', async () => {
    const { estimateRange, formatRange, portionRange } = await import('@/ai/shared/food');
    expect(estimateRange(400, 'high')).toEqual([350, 450]);
    expect(estimateRange(400, 'low')).toEqual([280, 520]);
    expect(formatRange(397, 'medium', 'kcal')).toBe('~320–480 kcal');
    expect(portionRange(175, 'g', 'medium')).toBe('~140–210 g');
    expect(portionRange(2, 'slice')).toBe('~2 slices');
    expect(formatRange(3, 'medium', 'g')).toBe('~3 g');
  });
});

