import { Fragment } from 'react';
import { cx } from '@/components/ui/primitives';
import { dayStages } from '@/domain/homeFlow';
import { useNow } from '@/hooks';
import { useGame } from '@/store/gameStore';

/**
 * The day as a small board path: Wake → Morning → Work → Train → Evening → Rest.
 * Done stages shrink into filled dots, the current one is a lit tile, future ones stay quiet.
 */
export function DayJourney() {
  const today = useGame((s) => s.today);
  const context = useGame((s) => s.context);
  const settings = useGame((s) => s.settings);
  const now = useNow(60000);
  if (!today || !settings) return null;
  const workout = today.quests.find((q) => q.kind === 'workout' && q.status !== 'moved');
  const stages = dayStages({
    state: context?.view.state,
    hour: new Date(now).getHours(),
    dayStartHour: settings.dayStartHour,
    workPlanned: today.plan.workStatus === 'set' || today.plan.workStatus === 'partial',
    workDone: !!context?.view.workedToday && !context.openWork,
    workoutToday: !!workout,
    workoutDone: workout?.status === 'completed',
  });
  const current = stages.find((s) => s.status === 'now');
  return (
    <nav aria-label={`Your day: now ${current?.label ?? ''}`} className="mt-3">
      <ol className="flex items-center">
        {stages.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && <li aria-hidden className={cx('mx-1 h-[3px] min-w-2 flex-1 rounded-full', s.status === 'next' ? 'bg-surface-3' : 'bg-accent/60')} />}
            <li aria-current={s.status === 'now' ? 'step' : undefined} className="shrink-0">
              {s.status === 'now' ? (
                <span className="flex h-9 items-center gap-1.5 rounded-full bg-accent/15 px-3 text-[13px] font-bold text-accent shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--lf-accent)_45%,transparent)]">
                  <span aria-hidden>{s.icon}</span>
                  {s.label}
                </span>
              ) : s.status === 'done' ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/70 text-[10px] font-black text-on-accent" title={`${s.label} · done`} aria-label={`${s.label}, done`}>
                  ✓
                </span>
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-[13px] opacity-70 grayscale" title={s.label} aria-label={`${s.label}, later`}>
                  {s.icon}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
