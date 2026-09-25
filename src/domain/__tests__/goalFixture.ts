import { makeQuest } from '@/test/fixtures';
import type { GoalContext } from '../goals';

export function goalProgressFixture(): { ctx: GoalContext } {
  const quests = [
    makeQuest({ date: '2026-09-21', kind: 'workout', category: 'fitness', status: 'completed' }),
    makeQuest({ date: '2026-09-21', tier: 'core', category: 'hydration', status: 'completed' }),
    makeQuest({ date: '2026-09-22', kind: 'workout', category: 'fitness', status: 'completed' }),
    makeQuest({ date: '2026-09-22', tier: 'core', category: 'hydration', status: 'pending' }),
  ];
  return {
    ctx: {
      quests,
      dayLogs: [],
      metricsByDate: {
        '2026-09-21': { steps: 6000, water: 2500 },
        '2026-09-22': { steps: 4000, water: 1000 },
      },
      targets: { stepsIdeal: 6500, waterMl: 2250, protein: 150, calories: 1800 },
    },
  };
}
