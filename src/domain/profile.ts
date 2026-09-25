import type { FieldStatus, ISODate, Settings } from '@/types';
import { formatDate } from '@/utils/date';
import { activeSchedule, summarizeSchedule, upcomingSchedules, WEEKDAY_SHORT } from './schedule';

export interface ProfileField {
  key: 'name' | 'height' | 'weight' | 'goals' | 'training' | 'wake' | 'sleep' | 'steps' | 'work' | 'future' | 'pet';
  label: string;
  icon: string;
  value: string;
  status: FieldStatus;
  /** Settings section (or route) where it can be edited. */
  edit: string;
  /** Shown under NOT SET fields: why it helps, never as an error. */
  hint?: string;
}

const GOAL_LABELS: Record<string, string> = {
  strength: 'Strength',
  fat_loss: 'Fat loss',
  muscle: 'Muscle',
  endurance: 'Endurance',
  routine: 'Routines',
  nofap: 'NoFap',
  screen: 'Less screen',
  sleep: 'Sleep',
  nutrition: 'Nutrition',
  order: 'Tidy home',
  learning: 'Learning',
  mind: 'Calm mind',
  pet: 'Pet care',
  fitness: 'Fitness',
  health: 'Health',
  mobility: 'Mobility',
};

export function goalLabel(id: string): string {
  return GOAL_LABELS[id] ?? id;
}

/**
 * What the player has told the game, as SET / NOT SET / OPTIONAL.
 * A missing value is information, not an error: the app keeps working without it.
 */
export function profileFields(s: Settings, today: ISODate): ProfileField[] {
  const k = s.known;
  const sch = activeSchedule(s.work, today);
  const next = upcomingSchedules(s.work, today)[0];
  const workValue =
    s.work.status === 'set' && sch
      ? summarizeSchedule(sch.days).join(' · ')
      : s.work.status === 'set' && next
        ? `From ${formatDate(next.effectiveFrom, 'EEE d MMM')}: ${summarizeSchedule(next.days).join(' · ')}`
        : s.work.status === 'unknown'
          ? 'Not sure yet'
          : 'Not set';
  const unknownOr = (status: string, value: string) => (status === 'unknown' ? 'Not sure yet' : status === 'set' ? value : 'Not set');
  return [
    { key: 'name', label: 'Name', icon: '🧍', value: s.profile.nickname || '—', status: s.profile.nickname ? 'set' : 'not_set', edit: 'profile' },
    { key: 'height', label: 'Height', icon: '📏', value: unknownOr(k.height, `${s.body.heightCm} cm`), status: k.height === 'set' ? 'set' : 'not_set', edit: 'targets', hint: 'Improves nutrition targets' },
    { key: 'weight', label: 'Weight', icon: '⚖️', value: unknownOr(k.weight, `${s.body.weightKg} kg`), status: k.weight === 'set' ? 'set' : 'not_set', edit: 'targets', hint: 'Improves nutrition targets' },
    {
      key: 'goals',
      label: 'Main goals',
      icon: '🎯',
      value: s.profile.goals.length ? s.profile.goals.map(goalLabel).join(', ') : 'Not set',
      status: s.profile.goals.length ? 'set' : 'not_set',
      edit: 'profile',
      hint: 'Tunes side quests and challenges',
    },
    {
      key: 'training',
      label: 'Workout availability',
      icon: '🏋️',
      value:
        k.training === 'unknown'
          ? 'Flexible (not sure yet)'
          : k.training === 'set'
            ? [1, 2, 3, 4, 5, 6, 0].filter((i) => s.schedule.days[i]?.trainingAvailable).map((i) => WEEKDAY_SHORT[i]).join(' ') || 'No days'
            : 'Not set',
      status: k.training === 'set' ? 'set' : 'not_set',
      edit: 'schedule',
      hint: 'Without it, workouts are flexible',
    },
    { key: 'wake', label: 'Wake-up', icon: '⏰', value: unknownOr(k.wake, s.schedule.wake), status: k.wake === 'set' ? 'set' : 'not_set', edit: 'schedule', hint: `Planning with ~${s.schedule.wake}` },
    { key: 'sleep', label: 'Bedtime', icon: '🌙', value: unknownOr(k.sleep, s.schedule.sleep), status: k.sleep === 'set' ? 'set' : 'not_set', edit: 'schedule', hint: `Planning with ~${s.schedule.sleep}` },
    { key: 'steps', label: 'Daily steps', icon: '👟', value: unknownOr(k.steps, `${s.steps.ideal.toLocaleString('en-US')} target`), status: k.steps === 'set' ? 'set' : 'not_set', edit: 'targets', hint: 'Calibrates from what you log' },
    { key: 'work', label: 'Work schedule', icon: '💼', value: workValue, status: s.work.status === 'set' ? 'set' : 'not_set', edit: 'schedule', hint: 'Add it when you know it' },
    { key: 'future', label: 'Future goals', icon: '🔭', value: s.profile.futureGoals || '—', status: s.profile.futureGoals ? 'set' : 'optional', edit: 'profile' },
  ];
}
