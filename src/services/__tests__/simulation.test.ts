import { describe, expect, it } from 'vitest';
import { getDb, metaRepository, playerRepository, statsRepository } from '@/repositories';
import { clock } from '../clock';
import { exportData, importData } from '../exportService';
import { runReset } from '../resetService';
import { checkInvariants, freshWorld, rng, simulateDay, snapshot, type DayProfile } from './simulationHarness';

/**
 * Long-run simulations. A realistic month (good days, lazy days, missed days, workouts,
 * meals, double taps, purchases, a backup round-trip and a reset) and a year-long
 * economy run. Invariants are checked after every day.
 */
describe('long-run simulation', () => {
  it('30 game days of realistic use keep every total consistent', async () => {
    await freshWorld('2026-01-05T08:30:00');
    const rand = rng(42);
    const violations: string[] = [];
    for (let d = 0; d < 30; d++) {
      const missed = d === 9 || d === 10 || d === 21; // app not opened
      const lazy = d % 7 === 5;
      const p: DayProfile = missed
        ? { completion: 0, opened: false }
        : { completion: lazy ? 0.3 : 0.85, workout: true, water: true, meals: !lazy, skip: d % 4 === 0, snooze: d % 5 === 0, buy: d % 3 === 0, doubleTap: d % 6 === 0 };
      await simulateDay(p, rand);
      if (d === 14) {
        // Backup round-trip mid-month must restore exactly the same state.
        const before = await snapshot();
        const file = await exportData();
        await importData(JSON.parse(JSON.stringify(file)));
        expect(await snapshot()).toEqual(before);
      }
      if (d === 20) await runReset('nutrition');
      for (const v of await checkInvariants()) violations.push(`day ${d + 1}: ${v}`);
    }
    expect(violations).toEqual([]);
    const s = await snapshot();
    expect(s.level).toBeGreaterThanOrEqual(3);
    expect(s.rooms).toBeGreaterThanOrEqual(2);
    // Missed days: closed, no invented successes, no quests completed.
    const logs = await statsRepository.logs('2026-01-01', '2026-02-10');
    const missedLog = logs.find((l) => l.date === '2026-01-14');
    expect(missedLog?.closed).toBe(true);
    expect(missedLog?.success).toBe(false);
    expect((await getDb().quests.where('date').equals('2026-01-14').toArray()).filter((q) => q.status === 'completed')).toEqual([]);
  }, 240_000);

  it('the 04:00 boundary: 03:59 still belongs to yesterday, 04:00 starts the new game day', async () => {
    await freshWorld('2026-03-02T22:00:00');
    const day1 = clock.today();
    clock.setOffset(clock.getOffset() + (new Date('2026-03-03T03:59:00').getTime() - clock.now()));
    expect(clock.today()).toBe(day1);
    clock.setOffset(clock.getOffset() + 60_000);
    expect(clock.today()).toBe('2026-03-03');
    expect(await metaRepository.get('currentDate')).toBe(day1);
  });

  // The full year takes minutes; `SIM_YEAR=1 npx vitest run simulation` runs it, the default run covers 60 days.
  const year = !!(globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env.SIM_YEAR;
  it(`economy over ${year ? 'a year' : '60 days'}: steady progression, no runaway inflation`, async () => {
    await freshWorld('2026-01-05T08:30:00');
    const rand = rng(7);
    const marks: Record<number, Awaited<ReturnType<typeof snapshot>>> = {};
    const checkpoints = year ? [7, 30, 90, 180, 365] : [7, 30, 60];
    const last = checkpoints[checkpoints.length - 1];
    const violations: string[] = [];
    for (let d = 1; d <= last; d++) {
      const r = rand();
      // An engaged but imperfect player: ~1 missed day in 12, some lazy days.
      const p: DayProfile = r < 0.08 ? { completion: 0, opened: false } : { completion: r < 0.25 ? 0.4 : 0.8, workout: true, water: true, meals: rand() < 0.6, buy: true };
      await simulateDay(p, rand);
      if (checkpoints.includes(d)) {
        marks[d] = await snapshot();
        for (const v of await checkInvariants()) violations.push(`day ${d}: ${v}`);
      }
    }
    const lines = checkpoints.map((c) => `day ${c}: level ${marks[c].level} · xp ${marks[c].xp} · coins ${marks[c].coins} · room levels ${marks[c].rooms} · achievements ${marks[c].achievements} · streak ${marks[c].streak}`);
    console.info(lines.join('\n'));
    expect(violations).toEqual([]);
    const p = (await playerRepository.get())!;
    expect(p.coins).toBeLessThan(50_000); // coins keep a use: no pile of useless currency
    expect(marks[last].level).toBeGreaterThan(marks[30].level);
    expect(marks[30].rooms).toBeGreaterThan(marks[7].rooms - 1);
  }, 900_000);
});
