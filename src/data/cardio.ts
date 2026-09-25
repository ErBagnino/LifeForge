import type { CardioStage } from '@/types';

/**
 * Gradual walk → run progression. Each same-intensity step stays within ~20% duration,
 * and the engine only advances after a well-completed, comfortable week.
 */
export const DEFAULT_CARDIO_STAGES: CardioStage[] = [
  { id: 'walk30', name: 'Brisk walk 30′', description: '30 minutes of brisk walking. You should be able to talk, not sing.', durationMin: 30, sessionsPerWeek: 3, intensity: 'walk' },
  { id: 'walk35', name: 'Brisk walk 35′', description: '35 minutes of brisk walking at a steady pace.', durationMin: 35, sessionsPerWeek: 3, intensity: 'walk' },
  { id: 'walk40', name: 'Brisk walk 40′', description: '40 minutes brisk. Add a gentle hill if you can.', durationMin: 40, sessionsPerWeek: 3, intensity: 'walk' },
  { id: 'int1', name: 'Walk/run intervals I', description: '5′ warm-up walk, then intervals, 5′ cool-down.', durationMin: 30, sessionsPerWeek: 3, structure: "6 × (1′ easy jog + 3′ walk)", intensity: 'intervals' },
  { id: 'int2', name: 'Walk/run intervals II', description: 'Longer jog blocks, same total time.', durationMin: 32, sessionsPerWeek: 3, structure: "6 × (2′ easy jog + 2′ walk)", intensity: 'intervals' },
  { id: 'int3', name: 'Walk/run intervals III', description: 'Jogging becomes the main part.', durationMin: 35, sessionsPerWeek: 3, structure: "5 × (4′ easy jog + 1′ walk)", intensity: 'intervals' },
  { id: 'run20', name: 'Light run 20′', description: '20 minutes of continuous easy running. Conversational pace.', durationMin: 20, sessionsPerWeek: 3, intensity: 'run' },
  { id: 'run24', name: 'Light run 24′', description: '24 minutes easy. Slow is smooth.', durationMin: 24, sessionsPerWeek: 3, intensity: 'run' },
  { id: 'run28', name: 'Light run 28′', description: '28 minutes easy running.', durationMin: 28, sessionsPerWeek: 3, intensity: 'run' },
];
