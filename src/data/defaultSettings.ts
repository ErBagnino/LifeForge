import type { DaySchedule, SafetyBounds, Settings } from '@/types';
import { DEFAULT_RULES } from './defaultRules';

const workday = (trainingAvailable: boolean): DaySchedule => ({
  type: 'work',
  work: { start: '09:00', end: '19:00', label: 'Work' },
  busy: [],
  trainingAvailable,
});

const freeday = (): DaySchedule => ({ type: 'free', busy: [], trainingAvailable: true });

export const DEFAULT_SAFETY: SafetyBounds = {
  maxStepIncreasePct: 5,
  stepIncrement: 250,
  stepFloor: 3000,
  stepCeiling: 20000,
  maxCardioIncreasePct: 20,
  maxTrainingIncreasePct: 15,
  minRestDaysPerWeek: 1,
  calorieMin: 1500,
  calorieMax: 3200,
  calorieMaxAdjust: 150,
  proteinMinPerKg: 1.4,
  proteinMaxPerKg: 2.4,
  waterMinMl: 1500,
  waterMaxMl: 4000,
};

/**
 * Initial personal values from the spec. They are user settings, not medical truths:
 * everything is editable and adaptive changes are only ever proposed, never forced.
 */
export function createDefaultSettings(): Settings {
  return {
    id: 'settings',
    profile: {
      name: 'Player',
      nickname: 'Player',
      goals: ['fitness', 'routine', 'order'],
      fitnessGoals: ['strength', 'fat_loss'],
      petName: 'Sky',
      petEmoji: '🐾',
    },
    theme: 'system',
    accent: 'ember',
    difficulty: 'hard',
    tone: 'balanced',
    reducedMotion: 'system',
    haptics: true,
    dayStartHour: 4,
    schedule: {
      wake: '07:00',
      sleep: '23:30',
      days: [freeday(), workday(true), workday(false), workday(true), workday(false), workday(true), freeday()],
    },
    nutrition: { calories: 1800, protein: 150, fat: 55, carbs: 175 },
    body: { weightKg: 74, heightCm: 170, goal: 'lose' },
    steps: { min: 5500, ideal: 6500, stretch: 8500 },
    hydration: { targetMl: 2250, glassMl: 250 },
    cardio: { enabled: true, stageIndex: 0 },
    tracking: { nutrition: true, weight: true, sleep: true },
    notifications: {
      enabled: false,
      types: {
        workout: true,
        hydration: true,
        quest: true,
        snooze: true,
        recap: true,
        achievement: true,
        levelUp: true,
        streak: true,
        challenge: true,
      },
      maxPerDay: 6,
      minGapMin: 45,
      quietStart: '22:45',
      quietEnd: '07:30',
      hydrationIntervalMin: 150,
      recapTime: '21:30',
      learnTimes: true,
      pushSubscribed: false,
    },
    rules: structuredClone(DEFAULT_RULES),
    safety: { ...DEFAULT_SAFETY },
    onboarded: false,
    devMode: false,
    clockOffsetMs: 0,
    updatedAt: Date.now(),
  };
}
