import type { QuestTemplate } from '@/domain/questGenerator';
import { roundTo } from '@/utils/math';

const busy = (ctx: { dayType: string }) => ctx.dayType === 'work';

/** Daily challenges: one special quest per day, bigger reward, harder condition. */
export const CHALLENGE_TEMPLATES: QuestTemplate[] = [
  {
    id: 'ch_early_bird',
    title: 'Early Bird',
    icon: '🐦',
    category: 'general',
    difficulty: 3,
    minLevel: 1,
    weight: () => 1,
    build: () => ({ goal: { type: 'completeBefore', count: 3, hour: 10 }, description: 'Complete 3 quests before 10:00.' }),
  },
  {
    id: 'ch_clean_sweep',
    title: 'Clean Sweep',
    icon: '🧹',
    category: 'general',
    difficulty: 3,
    minLevel: 1,
    weight: (c) => (c.state === 'overloaded' ? 0.4 : 1.2),
    build: () => ({ goal: { type: 'allCore' }, description: 'Complete every core quest today.' }),
  },
  {
    id: 'ch_full_clear',
    title: 'Full Clear',
    icon: '💎',
    category: 'general',
    difficulty: 4,
    minLevel: 4,
    weight: (c) => (c.state === 'too_easy' ? 1.6 : c.state === 'balanced' ? 0.8 : 0),
    build: () => ({ goal: { type: 'allTiers' }, description: 'Complete every core AND important quest today.' }),
  },
  {
    id: 'ch_step_surge',
    title: 'Step Surge',
    icon: '👟',
    category: 'cardio',
    difficulty: 4,
    minLevel: 2,
    weight: (c) => (busy(c) && c.state !== 'too_easy' ? 0.3 : 1.2),
    build: (c) => ({
      goal: { type: 'metricAtLeast', metric: 'steps', value: c.stepsStretch },
      description: `Reach your stretch target: ${c.stepsStretch.toLocaleString('en-US')} steps.`,
    }),
  },
  {
    id: 'ch_hydro',
    title: 'Hydro Homie',
    icon: '💧',
    category: 'hydration',
    difficulty: 2,
    minLevel: 1,
    weight: () => 1,
    build: (c) => ({
      goal: { type: 'metricAtLeast', metric: 'water', value: c.waterTargetMl },
      description: `Drink your full ${(c.waterTargetMl / 1000).toFixed(1)} L today.`,
    }),
  },
  {
    id: 'ch_protein',
    title: 'Protein Pro',
    icon: '🥚',
    category: 'nutrition',
    difficulty: 3,
    minLevel: 1,
    weight: (c) => (c.trackNutrition ? 1 : 0),
    build: (c) => ({ goal: { type: 'metricAtLeast', metric: 'protein', value: c.proteinTarget }, description: `Hit ${c.proteinTarget} g of protein.` }),
  },
  {
    id: 'ch_variety',
    title: 'Variety Pack',
    icon: '🎨',
    category: 'general',
    difficulty: 3,
    minLevel: 3,
    weight: (c) => (busy(c) ? 0.5 : 1.2),
    build: () => ({ goal: { type: 'categoriesTouched', count: 5 }, description: 'Complete quests in 5 different categories.' }),
  },
  {
    id: 'ch_side_hustle',
    title: 'Side Hustle',
    icon: '🧩',
    category: 'general',
    difficulty: 3,
    minLevel: 2,
    weight: (c) => (c.state === 'too_easy' ? 1.5 : c.state === 'balanced' && !busy(c) ? 1 : 0),
    build: () => ({ goal: { type: 'completeCount', count: 2, kinds: ['side'] }, description: 'Complete 2 side quests.' }),
  },
  {
    id: 'ch_order_blitz',
    title: 'Order Blitz',
    icon: '🗂️',
    category: 'order',
    difficulty: 2,
    minLevel: 2,
    weight: () => 0.8,
    build: () => ({ goal: { type: 'completeCount', count: 2, category: 'order' }, description: 'Complete 2 order quests.' }),
  },
  {
    id: 'ch_pet_day',
    title: 'Best Companion',
    icon: '🐾',
    category: 'animal_care',
    difficulty: 2,
    minLevel: 1,
    weight: () => 0.7,
    build: (c) => ({ goal: { type: 'completeCount', count: 3, category: 'animal_care' }, description: `Complete 3 care quests for ${c.petName}.` }),
  },
];

/** Hidden quests: shown as "???" with a hint. Revealed only when completed. */
export const HIDDEN_TEMPLATES: QuestTemplate[] = [
  {
    id: 'hd_dawn',
    title: 'Dawn Patrol',
    icon: '🌄',
    category: 'general',
    difficulty: 2,
    minLevel: 1,
    weight: () => 1,
    build: () => ({ goal: { type: 'completeBefore', count: 1, hour: 8 }, description: 'Complete a quest before 8:00.', hint: 'The early bird gets the XP.' }),
  },
  {
    id: 'hd_perfectionist',
    title: 'Perfectionist',
    icon: '💯',
    category: 'general',
    difficulty: 3,
    minLevel: 1,
    weight: () => 1,
    build: () => ({ goal: { type: 'allCore' }, description: 'Complete every core quest.', hint: 'Leave nothing important behind.' }),
  },
  {
    id: 'hd_explorer',
    title: 'Renaissance Day',
    icon: '🧭',
    category: 'general',
    difficulty: 3,
    minLevel: 1,
    weight: () => 1,
    build: () => ({ goal: { type: 'categoriesTouched', count: 4 }, description: 'Complete quests in 4 categories.', hint: 'Variety is the spice of life.' }),
  },
  {
    id: 'hd_overachiever',
    title: 'Overachiever',
    icon: '🚀',
    category: 'general',
    difficulty: 4,
    minLevel: 3,
    weight: (c) => (busy(c) ? 0.4 : 1),
    build: () => ({ goal: { type: 'completeCount', count: 12 }, description: 'Complete 12 quests in a day.', hint: 'Just keep going…' }),
  },
  {
    id: 'hd_quick_draw',
    title: 'Quick Draw',
    icon: '🤠',
    category: 'general',
    difficulty: 3,
    minLevel: 2,
    weight: () => 0.8,
    build: () => ({ goal: { type: 'completeBefore', count: 5, hour: 12 }, description: 'Complete 5 quests before noon.', hint: 'Mornings are for winners.' }),
  },
  {
    id: 'hd_hydrated',
    title: 'Well Watered',
    icon: '🌊',
    category: 'hydration',
    difficulty: 2,
    minLevel: 1,
    weight: () => 0.8,
    build: (c) => ({ goal: { type: 'metricAtLeast', metric: 'water', value: c.waterTargetMl }, description: 'Hit your water target.', hint: 'Stay wet, my friend.' }),
  },
  {
    id: 'hd_side_addict',
    title: 'Side Quest Addict',
    icon: '🎒',
    category: 'general',
    difficulty: 3,
    minLevel: 2,
    weight: () => 0.6,
    build: () => ({ goal: { type: 'completeCount', count: 2, kinds: ['side'] }, description: 'Complete 2 side quests.', hint: 'The main story can wait.' }),
  },
];

/** Weekly quests: each week is a chapter. */
export const WEEKLY_TEMPLATES: QuestTemplate[] = [
  {
    id: 'wk_iron',
    title: 'Iron Week',
    icon: '🏋️',
    category: 'fitness',
    difficulty: 4,
    minLevel: 1,
    weight: (c) => (c.plannedWorkoutsPerWeek > 0 ? 1.5 : 0),
    build: (c) => ({
      goal: { type: 'workouts', count: Math.max(2, c.plannedWorkoutsPerWeek) },
      description: `Complete ${Math.max(2, c.plannedWorkoutsPerWeek)} workouts this week.`,
    }),
  },
  {
    id: 'wk_steps',
    title: 'Step Collector',
    icon: '👣',
    category: 'cardio',
    difficulty: 4,
    minLevel: 1,
    weight: () => 1.2,
    build: (c) => {
      const target = roundTo(c.stepsIdeal * 6, 1000);
      return { goal: { type: 'metricSum', metric: 'steps', target }, description: `Walk ${target.toLocaleString('en-US')} steps this week.` };
    },
  },
  {
    id: 'wk_hydration',
    title: 'Hydration Week',
    icon: '💧',
    category: 'hydration',
    difficulty: 3,
    minLevel: 1,
    weight: () => 1,
    build: () => ({ goal: { type: 'metricDays', metric: 'water', days: 5 }, description: 'Hit your water target on 5 days.' }),
  },
  {
    id: 'wk_core',
    title: 'Core Keeper',
    icon: '🎯',
    category: 'general',
    difficulty: 4,
    minLevel: 1,
    weight: () => 1.2,
    build: (c) => {
      const days = c.state === 'too_easy' ? 6 : c.state === 'overloaded' || c.state === 'critical' ? 3 : 4;
      return { goal: { type: 'perfectCoreDays', days }, description: `Complete every core quest on ${days} days.` };
    },
  },
  {
    id: 'wk_side',
    title: 'Side Quester',
    icon: '🧩',
    category: 'general',
    difficulty: 3,
    minLevel: 2,
    weight: () => 0.9,
    build: () => ({ goal: { type: 'completeCount', count: 6, kinds: ['side'] }, description: 'Complete 6 side quests this week.' }),
  },
  {
    id: 'wk_protein',
    title: 'Protein Week',
    icon: '🍗',
    category: 'nutrition',
    difficulty: 3,
    minLevel: 1,
    weight: (c) => (c.trackNutrition ? 1 : 0),
    build: () => ({ goal: { type: 'metricDays', metric: 'protein', days: 4 }, description: 'Hit your protein target on 4 days.' }),
  },
  {
    id: 'wk_scores',
    title: 'High Scorer',
    icon: '📈',
    category: 'general',
    difficulty: 4,
    minLevel: 3,
    weight: () => 0.9,
    build: () => ({ goal: { type: 'scoreDays', minScore: 80, days: 4 }, description: 'Score 80+ on 4 days.' }),
  },
  {
    id: 'wk_tidy',
    title: 'Tidy Week',
    icon: '🧽',
    category: 'cleaning',
    difficulty: 3,
    minLevel: 1,
    weight: () => 0.8,
    build: () => ({ goal: { type: 'completeCount', count: 5, category: 'cleaning' }, description: 'Complete 5 cleaning quests.' }),
  },
  {
    id: 'wk_pet',
    title: 'Companion Week',
    icon: '🐾',
    category: 'animal_care',
    difficulty: 3,
    minLevel: 1,
    weight: () => 0.8,
    build: (c) => ({ goal: { type: 'completeCount', count: 12, category: 'animal_care' }, description: `Complete 12 care quests for ${c.petName}.` }),
  },
  {
    id: 'wk_reader',
    title: 'Reading Week',
    icon: '📚',
    category: 'reading',
    difficulty: 3,
    minLevel: 1,
    weight: () => 0.8,
    build: () => ({ goal: { type: 'completeCount', count: 5, category: 'reading' }, description: 'Complete 5 reading quests.' }),
  },
];

/** Boss quests: monthly milestones with big rewards. */
export const BOSS_TEMPLATES: QuestTemplate[] = [
  {
    id: 'boss_iron_titan',
    title: 'The Iron Titan',
    icon: '🗿',
    category: 'fitness',
    difficulty: 5,
    minLevel: 1,
    weight: (c) => (c.plannedWorkoutsPerWeek > 0 ? 1.4 : 0),
    build: (c) => {
      const count = Math.max(6, Math.round(c.plannedWorkoutsPerWeek * (c.daysInMonth / 7) * 0.85));
      return { goal: { type: 'workouts', count }, description: `Complete ${count} workouts this month.` };
    },
  },
  {
    id: 'boss_walker',
    title: 'Walker of Worlds',
    icon: '🌍',
    category: 'cardio',
    difficulty: 5,
    minLevel: 1,
    weight: () => 1,
    build: (c) => {
      const target = roundTo(c.stepsIdeal * c.daysInMonth * 0.9, 5000);
      return { goal: { type: 'metricSum', metric: 'steps', target }, description: `Walk ${target.toLocaleString('en-US')} steps this month.` };
    },
  },
  {
    id: 'boss_hydra',
    title: 'The Hydra of Hydration',
    icon: '🐉',
    category: 'hydration',
    difficulty: 5,
    minLevel: 1,
    weight: () => 0.9,
    build: (c) => {
      const days = Math.round(c.daysInMonth * 0.75);
      return { goal: { type: 'metricDays', metric: 'water', days }, description: `Hit your water target on ${days} days this month.` };
    },
  },
  {
    id: 'boss_colossus',
    title: 'The Consistency Colossus',
    icon: '🏛️',
    category: 'general',
    difficulty: 5,
    minLevel: 1,
    weight: () => 1.1,
    build: (c) => {
      const days = Math.round(c.daysInMonth * 0.65);
      return { goal: { type: 'scoreDays', minScore: c.streakThreshold, days }, description: `Score ${c.streakThreshold}+ on ${days} days this month.` };
    },
  },
  {
    id: 'boss_order_lord',
    title: 'Lord of Order',
    icon: '👑',
    category: 'order',
    difficulty: 5,
    minLevel: 1,
    weight: () => 0.7,
    build: () => ({ goal: { type: 'completeCount', count: 25, category: 'order' }, description: 'Complete 25 order quests this month.' }),
  },
];
