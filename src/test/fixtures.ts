import type { Activity, DayLog, Quest } from '@/types';
import { createDefaultSettings } from '@/data/defaultSettings';
import { createStreak } from '@/domain/streak';
import type { Player } from '@/types';

export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: overrides.id ?? `a_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test activity',
    icon: '✅',
    category: 'general',
    tier: 'optional',
    importance: 3,
    difficulty: 2,
    recurrence: { type: 'daily' },
    timeOfDay: 'anytime',
    durationMin: 10,
    stats: { discipline: 1 },
    adaptive: false,
    active: true,
    streakEligible: true,
    generatorEligible: true,
    userCreated: false,
    aiImported: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function makeQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: overrides.id ?? `q_${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-09-25',
    kind: 'scheduled',
    tier: 'core',
    title: 'Quest',
    icon: '✅',
    category: 'general',
    difficulty: 2,
    rarity: 'common',
    xp: 40,
    coins: 12,
    energyCost: 5,
    stats: {},
    progress: 0,
    durationMin: 10,
    status: 'pending',
    snoozeCount: 0,
    rescheduleCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function makeLog(overrides: Partial<DayLog> = {}): DayLog {
  return {
    date: '2026-09-25',
    dayType: 'work',
    restDay: false,
    sick: false,
    score: 0,
    xp: 0,
    coins: 0,
    core: { done: 0, total: 0 },
    important: { done: 0, total: 0 },
    optional: { done: 0, total: 0 },
    workload: 50,
    workloadLevel: 'medium',
    difficultyState: 'balanced',
    energyStart: 100,
    hpStart: 100,
    metrics: {},
    achievements: [],
    workouts: 0,
    levelUps: [],
    success: false,
    streak: 0,
    closed: false,
    penalties: [],
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'me',
    name: 'Tester',
    level: 1,
    xp: 0,
    coins: 100,
    hp: 100,
    energy: 100,
    maxEnergy: 100,
    stats: { strength: 0, endurance: 0, discipline: 0, health: 0, order: 0, care: 0, consistency: 0, knowledge: 0 },
    streak: createStreak(),
    inventory: { streakFreeze: 0, streakRevive: 0, reroll: 0 },
    boosts: [],
    effects: [],
    avatar: { skin: 's2', hairStyle: 'short', hairColor: '#2b2b2b', outfit: 'tee', outfitColor: '#ff5a1f', accessory: 'none', background: '#ffe3d3' },
    recoveryMode: false,
    lifetime: { xpEarned: 0, coinsEarned: 0, coinsSpent: 0 },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export const settings = createDefaultSettings();
export const rules = settings.rules;
