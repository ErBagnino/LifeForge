import { useNavigate } from 'react-router';
import * as qs from '@/services/game/questService';
import { useGame } from '@/store/gameStore';
import type { Quest, SkipReason, TimeHM } from '@/types';

/** Quest actions wired to the store (feedback + refresh). */
export function useQuestActions() {
  const act = useGame((s) => s.act);
  const navigate = useNavigate();
  return {
    complete: (q: Quest, actualTime?: TimeHM) => act(qs.completeQuest(q.id, actualTime)),
    uncomplete: (q: Quest) => act(qs.uncompleteQuest(q.id)),
    skip: (q: Quest, reason: SkipReason) => act(qs.skipQuest(q.id, reason)),
    snooze: (q: Quest, until: number) => act(qs.snoozeQuest(q.id, until)),
    tomorrow: (q: Quest) => act(qs.moveQuestToTomorrow(q.id)),
    reschedule: (q: Quest, time: TimeHM | undefined) => act(qs.rescheduleQuest(q.id, time)),
    setActual: (q: Quest, time: TimeHM) => act(qs.setActualTime(q.id, time)),
    reroll: (q: Quest) => act(qs.rerollQuest(q.id)),
    remove: (q: Quest) => act(qs.deleteQuest(q.id)),
    keep: (q: Quest) => act(qs.keepQuest(q.id)),
    /** Primary action: complete, or open the right tool (logger, metric input, play timer). */
    start: (q: Quest, openMetric: (q: Quest) => void) => {
      if (q.kind === 'workout') {
        navigate(`/train/workout?template=${q.workoutTemplateId ?? ''}&quest=${q.id}`);
        return;
      }
      if (q.activityId === 'cardio_session') {
        navigate('/train/cardio');
        return;
      }
      if (q.metric === 'leisure') {
        navigate('/play');
        return;
      }
      if (q.metric) {
        openMetric(q);
        return;
      }
      if (q.goal) return;
      void act(qs.completeQuest(q.id));
    },
  };
}
