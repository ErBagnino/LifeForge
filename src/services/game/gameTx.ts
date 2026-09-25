import { findNewlyUnlocked, type Counters } from '@/domain/achievements';
import { derivedCounters, mergeCounters } from '@/domain/counters';
import { MAX_HP } from '@/domain/hp';
import { levelFromXp, levelPerks, levelsGained } from '@/domain/level';
import { worldBonuses, type WorldBonuses } from '@/domain/tycoon';
import {
  achievementRepository,
  playerRepository,
  settingsRepository,
  statsRepository,
  tycoonRepository,
} from '@/repositories';
import type { Achievement, Building, DayLog, LedgerEntry, Player, Settings, StatMap } from '@/types';
import { uid } from '@/utils/id';
import { clamp } from '@/utils/math';
import { clock } from '../clock';
import type { GameEvent } from '../events';

export function emptyLog(date: string, player: Player): DayLog {
  return {
    date,
    dayType: 'work',
    restDay: false,
    sick: false,
    score: 0,
    xp: 0,
    coins: 0,
    core: { done: 0, total: 0 },
    important: { done: 0, total: 0 },
    optional: { done: 0, total: 0 },
    workload: 0,
    workloadLevel: 'low',
    difficultyState: 'balanced',
    energyStart: player.energy,
    hpStart: player.hp,
    metrics: {},
    achievements: [],
    workouts: 0,
    levelUps: [],
    success: false,
    streak: player.streak.current,
    closed: false,
    penalties: [],
  };
}

/**
 * A unit of game work. Loads the mutable game state once, applies XP/coins/HP/stat
 * changes with all their consequences (levels, perks, achievements, counters, ledger)
 * and persists everything in `commit()`. Must run inside `withTransaction`.
 */
export class GameTx {
  events: GameEvent[] = [];
  ledger: LedgerEntry[] = [];
  counterInc: Counters = {};
  counterSet: Counters = {};
  unlockedFeatures: string[] = [];
  private achievements?: Achievement[];
  private persistedCounters: Counters = {};

  private constructor(
    public player: Player,
    public settings: Settings,
    public buildings: Building[],
    public log: DayLog,
    public date: string,
    public now: number,
  ) {}

  static async open(date: string = clock.today()): Promise<GameTx> {
    const [player, settings, buildings, log, counters] = await Promise.all([
      playerRepository.get(),
      settingsRepository.get(),
      tycoonRepository.buildings.all(),
      statsRepository.getLog(date),
      statsRepository.counters(),
    ]);
    if (!player || !settings) throw new Error('Game not initialised');
    const tx = new GameTx(structuredClone(player), settings, buildings, log ? structuredClone(log) : emptyLog(date, player), date, clock.now());
    tx.persistedCounters = counters;
    return tx;
  }

  get bonuses(): WorldBonuses {
    return worldBonuses(this.buildings);
  }

  get level(): number {
    return levelFromXp(this.player.xp, this.settings.rules.level).level;
  }

  get maxEnergy(): number {
    return this.settings.rules.energy.base + this.bonuses.maxEnergy;
  }

  counters(): Counters {
    const merged: Counters = { ...this.persistedCounters };
    for (const [k, v] of Object.entries(this.counterInc)) merged[k] = (merged[k] ?? 0) + v;
    for (const [k, v] of Object.entries(this.counterSet)) merged[k] = v;
    return mergeCounters(merged, derivedCounters(this.player, this.buildings, this.level));
  }

  inc(values: Counters) {
    for (const [k, v] of Object.entries(values)) this.counterInc[k] = (this.counterInc[k] ?? 0) + v;
  }

  set(values: Counters) {
    Object.assign(this.counterSet, values);
  }

  /** Raise a max-type counter only if the new value is higher. */
  setMax(key: string, value: number) {
    const current = this.counters()[key] ?? 0;
    if (value > current) this.counterSet[key] = value;
  }

  private addLedger(type: LedgerEntry['type'], amount: number, reason: string, refId?: string) {
    if (!amount) return;
    this.ledger.push({ id: uid('l_'), ts: this.now, date: this.date, type, amount, reason, refId });
  }

  addXp(amount: number, reason: string, refId?: string) {
    if (amount === 0) return;
    const prev = this.player.xp;
    this.player.xp = Math.max(0, prev + amount);
    if (amount > 0) this.player.lifetime.xpEarned += amount;
    this.log.xp += amount;
    this.addLedger('xp', amount, reason, refId);
    const gained = levelsGained(prev, this.player.xp, this.settings.rules.level);
    this.player.level = levelFromXp(this.player.xp, this.settings.rules.level).level;
    for (const level of gained) {
      const perks = levelPerks(level);
      for (const perk of perks) {
        if (perk.type === 'coins') this.addCoins(perk.amount, `Level ${level} reward`);
        if (perk.type === 'item') this.player.inventory[perk.item] += perk.amount;
        if (perk.type === 'feature') this.unlockedFeatures.push(perk.label);
      }
      this.log.levelUps.push(level);
      this.events.push({ type: 'levelUp', level, perks });
    }
  }

  addCoins(amount: number, reason: string, refId?: string) {
    if (amount === 0) return;
    const applied = amount < 0 ? -Math.min(-amount, this.player.coins) : amount;
    this.player.coins += applied;
    if (applied > 0) this.player.lifetime.coinsEarned += applied;
    this.log.coins += applied;
    this.addLedger('coins', applied, reason, refId);
  }

  spendCoins(amount: number, reason: string, refId?: string): boolean {
    if (amount > this.player.coins) return false;
    this.player.coins -= amount;
    this.player.lifetime.coinsSpent += amount;
    this.addLedger('coins', -amount, reason, refId);
    return true;
  }

  addHp(amount: number, reason: string, refId?: string): number {
    const before = this.player.hp;
    this.player.hp = clamp(Math.round(before + amount), 0, MAX_HP);
    const delta = this.player.hp - before;
    this.addLedger('hp', delta, reason, refId);
    return delta;
  }

  applyEnergy(cost: number, reason: string, refId?: string): number {
    const before = this.player.energy;
    this.player.energy = clamp(Math.round(before - cost), 0, this.maxEnergy);
    const delta = this.player.energy - before;
    this.addLedger('energy', delta, reason, refId);
    return delta;
  }

  addStats(stats: StatMap, sign = 1) {
    for (const [k, v] of Object.entries(stats)) {
      const key = k as keyof Player['stats'];
      this.player.stats[key] = Math.max(0, (this.player.stats[key] ?? 0) + sign * (v ?? 0));
    }
  }

  /** Unlock every achievement whose condition now holds (rewards can cascade into more unlocks). */
  async checkAchievements(): Promise<Achievement[]> {
    this.achievements ??= await achievementRepository.all();
    const unlocked: Achievement[] = [];
    for (let round = 0; round < 5; round++) {
      const fresh = findNewlyUnlocked(this.achievements, this.counters());
      if (!fresh.length) break;
      for (const a of fresh) {
        a.unlockedAt = this.now;
        a.seen = false;
        unlocked.push(a);
        this.log.achievements.push(a.id);
        this.events.push({ type: 'achievement', achievement: a });
        this.addXp(a.xp, `Achievement: ${a.name}`, a.id);
        this.addCoins(a.coins, `Achievement: ${a.name}`, a.id);
        this.addHp(this.settings.rules.hp.achievement, 'Achievement', a.id);
      }
    }
    if (unlocked.length) await achievementRepository.bulkPut(unlocked);
    return unlocked;
  }

  async commit(): Promise<void> {
    this.log.streak = this.player.streak.current;
    await playerRepository.save(this.player);
    await statsRepository.putLog(this.log);
    await statsRepository.incrementCounters(this.counterInc);
    await statsRepository.setCounters(this.counterSet);
    await statsRepository.addLedger(this.ledger);
  }
}
