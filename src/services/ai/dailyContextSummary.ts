import { formatDuration, hm, STATE_INFO } from '@/domain/dailyContext';
import type { ContextSnapshot } from '../contextService';

const hmOf = (ts: number) => {
  const d = new Date(ts);
  return hm(d.getHours() * 60 + d.getMinutes());
};

/**
 * The Daily Context as the Coach sees it. Anything the player did not tell the app is
 * reported as "unknown" so the model asks instead of inventing (e.g. "Did you work today?").
 */
export function dailyContextSummary(snap: ContextSnapshot) {
  const { view, ctx, openWork, learned } = snap;
  const work = openWork
    ? `in progress since ${hmOf(openWork.start)} (${formatDuration(view.workMinutes)} so far; start = leaving home)`
    : ctx.work.some((w) => w.end)
      ? `done today: ${ctx.work
          .filter((w) => w.end)
          .map((w) => `${hmOf(w.start)}–${hmOf(w.end!)}`)
          .join(', ')} (${formatDuration(view.workMinutes)})`
      : ctx.noWork
        ? 'no work today (player said so)'
        : 'unknown — no work session logged today';
  return {
    state: STATE_INFO[view.state].label,
    wakeUp: ctx.wakeUpTime ? hmOf(ctx.wakeUpTime) : 'unknown',
    work,
    availableMinutes: view.availableMin,
    minutesToBed: view.minutesToBed,
    stillMattersMinutes: view.plannedMin,
    fits: view.fits,
    focus: view.focus.map((d) => ({ id: d.quest.id, title: d.quest.title, priority: d.priority, minutes: d.quest.durationMin, why: d.reason })),
    notRealisticToday: view.decisions.filter((d) => !d.realistic && d.priority !== 'OPTIONAL').map((d) => d.quest.title).slice(0, 5),
    typical: {
      wakeUp: learned.wake.all ? hm(learned.wake.all.median) : 'unknown',
      workdays: learned.work.workdays,
      workout: learned.workout ? hm(learned.workout.median) : 'unknown',
      dinner: learned.meals.dinner ? hm(learned.meals.dinner.median) : 'unknown',
    },
  };
}
