import type {
  DayType,
  Difficulty,
  GameDifficulty,
  Rarity,
  TimeBlock,
  TimeHM,
  WorkloadLevel,
} from './common';
import type { ScoreComponentKey } from './day';

export type ThemeMode = 'system' | 'light' | 'dark';
export type CoachTone = 'balanced' | 'serious' | 'motivational' | 'ironic' | 'provocative';
export type ReducedMotionPref = 'system' | 'on' | 'off';
export type BodyGoal = 'lose' | 'maintain' | 'gain';

export interface DaySchedule {
  type: Exclude<DayType, 'rest'>;
  work?: TimeBlock;
  busy: TimeBlock[];
  trainingAvailable: boolean;
}

export interface WeeklySchedule {
  wake: TimeHM;
  sleep: TimeHM;
  /** Index = JS weekday (0 = Sunday). */
  days: DaySchedule[];
}

export interface NutritionTargets {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface BodyProfile {
  weightKg: number;
  heightCm: number;
  goal: BodyGoal;
  targetWeightKg?: number;
}

export interface StepTargets {
  min: number;
  ideal: number;
  stretch: number;
}

export interface HydrationSettings {
  targetMl: number;
  glassMl: number;
}

export type LeisureKind = 'games' | 'short_video' | 'streaming' | 'social' | 'other';

export interface LeisureSettings {
  enabled: boolean;
  /** Daily budget in minutes. */
  dailyLimitMin: number;
  /** Warn when this share of the budget is used. */
  warnAtPct: number;
}

export interface CardioSettings {
  enabled: boolean;
  stageIndex: number;
  stageStartedOn?: string;
}

export type NotificationType =
  | 'workout'
  | 'hydration'
  | 'quest'
  | 'snooze'
  | 'recap'
  | 'achievement'
  | 'levelUp'
  | 'streak'
  | 'challenge'
  | 'leisure';

export interface NotificationSettings {
  enabled: boolean;
  types: Record<NotificationType, boolean>;
  maxPerDay: number;
  minGapMin: number;
  quietStart: TimeHM;
  quietEnd: TimeHM;
  hydrationIntervalMin: number;
  recapTime: TimeHM;
  learnTimes: boolean;
  pushSubscribed: boolean;
}

export interface ScoreRules {
  weights: Record<ScoreComponentKey, number>;
  /** How many optional quests count as "full marks" for the optional component. */
  optionalExpected: number;
  achievementBonusEach: number;
  achievementBonusMax: number;
  calorieTolerancePct: number;
}

export interface XpRules {
  baseByDifficulty: Record<Difficulty, number>;
  refDurationByDifficulty: Record<Difficulty, number>;
  levelScalingPerLevel: number;
  levelScalingMaxLevels: number;
  streakBonusPerDay: number;
  streakBonusMax: number;
  rarityMultiplier: Record<Rarity, number>;
}

export interface CoinRules {
  ratio: number;
  streakMilestoneBase: number;
  firstQuestBonus: number;
}

export interface LevelRules {
  base: number;
  exponent: number;
}

export interface EnergyRules {
  costByDifficulty: Record<Difficulty, number>;
  base: number;
  unknownSleepStart: number;
  sleepBase: number;
  sleepPerHour: number;
  restDayBonus: number;
  minStart: number;
}

export interface HpRules {
  coreComplete: number;
  dailyGainCap: number;
  perfectCoreDay: number;
  streakMilestone: number;
  restDay: number;
  achievement: number;
  recoveryActivity: number;
  missedCore: number;
  missedImportant: number;
  dailyLossCap: number;
  lowConsistencyPenalty: number;
  recoveryThreshold: number;
  recoveryExit: number;
  recoveryGainMultiplier: number;
}

export interface PenaltyRules {
  enabled: boolean;
  missedCoreCoins: number;
  coinLossCap: number;
  sluggishScoreThreshold: number;
  sluggishXpMultiplier: number;
  snoozeWarnAt: number;
  procrastinationCoins: number;
}

export interface GeneratorRules {
  sideQuestsByWorkload: Record<WorkloadLevel, number>;
  maxDurationByWorkload: Record<WorkloadLevel, number>;
  maxCoreByWorkload: Record<WorkloadLevel, number>;
  maxImportantByWorkload: Record<WorkloadLevel, number>;
  recencyDays: number;
  challengeEnabled: boolean;
  hiddenEnabled: boolean;
  weeklyCount: number;
  bossEnabled: boolean;
  rarityWeights: Record<Rarity, number>;
  rerollCost: number;
}

export interface AdaptiveRules {
  tooEasyCompletion: number;
  tooEasyMaxWorkload: number;
  tooEasyMinEnergy: number;
  overloadWorkload: number;
  overloadEnergy: number;
  overloadCompletion: number;
  criticalWorkload: number;
  criticalEnergy: number;
  criticalHp: number;
}

export interface StreakRules {
  reviveWindowDays: number;
  milestones: number[];
}

export interface DifficultyPreset {
  rewardMultiplier: number;
  penaltyMultiplier: number;
  streakThreshold: number;
  sideQuestDelta: number;
}

export type RuleTrigger = 'day_start' | 'quest_completed' | 'workout_completed' | 'day_end' | 'check';
export type RuleOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

export interface RuleCondition {
  fact: string;
  op: RuleOperator;
  value: number | string | boolean;
}

export type RuleActionType =
  | 'suggestSideQuest'
  | 'suggestProgression'
  | 'suggestDeload'
  | 'reduceSideQuests'
  | 'coachMessage'
  | 'grantHp'
  | 'suggestRest';

export interface RuleAction {
  type: RuleActionType;
  params?: Record<string, string | number | boolean>;
}

export interface RuleDef {
  id: string;
  name: string;
  description: string;
  trigger: RuleTrigger;
  enabled: boolean;
  conditions: RuleCondition[];
  action: RuleAction;
  /** Fire at most once per game day. */
  oncePerDay: boolean;
}

export interface GameRules {
  score: ScoreRules;
  xp: XpRules;
  coins: CoinRules;
  level: LevelRules;
  energy: EnergyRules;
  hp: HpRules;
  penalties: PenaltyRules;
  generator: GeneratorRules;
  adaptive: AdaptiveRules;
  streak: StreakRules;
  difficultyPresets: Record<GameDifficulty, DifficultyPreset>;
  smartRules: RuleDef[];
}

export interface SafetyBounds {
  maxStepIncreasePct: number;
  stepIncrement: number;
  stepFloor: number;
  stepCeiling: number;
  maxCardioIncreasePct: number;
  maxTrainingIncreasePct: number;
  minRestDaysPerWeek: number;
  calorieMin: number;
  calorieMax: number;
  calorieMaxAdjust: number;
  proteinMinPerKg: number;
  proteinMaxPerKg: number;
  waterMinMl: number;
  waterMaxMl: number;
}

export interface ProfileSettings {
  name: string;
  nickname: string;
  goals: string[];
  fitnessGoals: string[];
  petName: string;
  petEmoji: string;
}

export interface TrackingSettings {
  nutrition: boolean;
  weight: boolean;
  sleep: boolean;
}

export interface Settings {
  id: 'settings';
  profile: ProfileSettings;
  theme: ThemeMode;
  accent: string;
  difficulty: GameDifficulty;
  tone: CoachTone;
  reducedMotion: ReducedMotionPref;
  haptics: boolean;
  dayStartHour: number;
  schedule: WeeklySchedule;
  nutrition: NutritionTargets;
  body: BodyProfile;
  steps: StepTargets;
  hydration: HydrationSettings;
  cardio: CardioSettings;
  leisure: LeisureSettings;
  tracking: TrackingSettings;
  notifications: NotificationSettings;
  rules: GameRules;
  safety: SafetyBounds;
  onboarded: boolean;
  devMode: boolean;
  /** Dev time-travel offset. */
  clockOffsetMs: number;
  updatedAt: number;
}
