import type { Difficulty, ID, ISODate, Timestamp } from './common';

export const MUSCLES = [
  'chest',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'traps',
  'lats',
  'upper_back',
  'lower_back',
  'abs',
  'obliques',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'calves',
] as const;
export type Muscle = (typeof MUSCLES)[number];
export type MuscleIntensity = 'high' | 'medium' | 'low';

export interface MuscleTarget {
  muscle: Muscle;
  level: MuscleIntensity;
}

export type ExerciseCategory = 'strength' | 'core' | 'cardio' | 'mobility';
export type ExerciseMeasure = 'reps' | 'time';

/** 1 easy 😎 · 2 normal 🙂 · 3 hard 😰 · 4 almost impossible 💀 */
export type Rpe = 1 | 2 | 3 | 4;

export interface ProgressionRule {
  /** Weight step in kg (or seconds for time-based exercises). */
  increment: number;
  /** Safety cap for a single increase, in percent. */
  maxIncreasePct: number;
  /** Increase only when average RPE is at or below this value. */
  easyRpeMax: Rpe;
  requireAllSets: boolean;
  requireTopOfRange: boolean;
  /** Failed sessions in a row before a deload is proposed. */
  failuresBeforeDeload: number;
  deloadPct: number;
  minWeight: number;
}

export interface Exercise {
  id: ID;
  name: string;
  category: ExerciseCategory;
  measure: ExerciseMeasure;
  muscles: MuscleTarget[];
  equipment: string;
  instructions: string[];
  defaultSets: number;
  repMin: number;
  repMax: number;
  restSec: number;
  difficulty: Difficulty;
  progression: ProgressionRule;
  /** Key into the pose library used by ExerciseIllustration. */
  illustration: string;
  unilateral?: boolean;
  bodyweight?: boolean;
  notes?: string;
  userCreated: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TemplateExercise {
  exerciseId: ID;
  sets: number;
  repMin: number;
  repMax: number;
  restSec: number;
  note?: string;
}

export interface WorkoutTemplate {
  id: ID;
  name: string;
  /** JS weekday 0..6, or null for unscheduled templates. */
  weekday: number | null;
  exercises: TemplateExercise[];
  estimatedMin: number;
}

export interface WorkoutPlan {
  id: ID;
  name: string;
  active: boolean;
  templates: WorkoutTemplate[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SetLog {
  weight: number;
  reps: number;
  completed: boolean;
  rpe?: Rpe;
  note?: string;
}

export type SuggestionAction = 'increase' | 'increase_reps' | 'maintain' | 'decrease' | 'deload' | 'none';

export interface ProgressionSuggestion {
  action: SuggestionAction;
  currentWeight: number;
  nextWeight: number;
  repMin: number;
  repMax: number;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface SessionExercise {
  exerciseId: ID;
  targetSets: number;
  repMin: number;
  repMax: number;
  restSec: number;
  targetWeight: number;
  sets: SetLog[];
  suggestion?: ProgressionSuggestion;
  decision?: 'accepted' | 'declined';
}

export type SessionStatus = 'active' | 'completed' | 'abandoned';

export interface WorkoutSession {
  id: ID;
  date: ISODate;
  planId?: ID;
  templateId?: ID;
  name: string;
  kind: 'strength' | 'cardio';
  startedAt: Timestamp;
  endedAt?: Timestamp;
  status: SessionStatus;
  exercises: SessionExercise[];
  /** Cardio sessions */
  cardio?: CardioLog;
  questId?: ID;
  xp?: number;
  coins?: number;
  notes?: string;
}

/** Current working load per exercise, shared across templates. */
export interface ExerciseState {
  exerciseId: ID;
  workingWeight: number;
  repMin: number;
  repMax: number;
  updatedAt: Timestamp;
}

export interface CardioStage {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  sessionsPerWeek: number;
  /** e.g. "5 × (1' jog + 3' walk)" */
  structure?: string;
  intensity: 'walk' | 'intervals' | 'run';
}

export interface CardioLog {
  stageId: string;
  durationMin: number;
  distanceKm?: number;
  difficulty: Rpe;
  completed: boolean;
}
