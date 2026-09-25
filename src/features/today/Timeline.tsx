import { Fragment, useMemo } from 'react';
import { cx } from '@/components/ui/primitives';
import { resolveText } from '@/services/game/questFactory';
import type { DayPlan, Quest } from '@/types';
import { gameMinutes, minuteOfDay, minutesToHm, tsToHm } from '@/utils/date';

type Item =
  | { kind: 'quest'; at: number; quest: Quest }
  | { kind: 'block'; at: number; end: number; label: string; icon: string }
  | { kind: 'now'; at: number };

/** The day as a timeline. Tap any quest to move, postpone, complete, skip or correct its time. */
export function Timeline({ quests, plan, now, dayStartHour, petName, onOpen }: { quests: Quest[]; plan: DayPlan; now: number; dayStartHour: number; petName: string; onOpen: (q: Quest) => void }) {
  const { items, anytime } = useMemo(() => {
    const list: Item[] = [];
    const g = (hm: string) => gameMinutes(hm, dayStartHour);
    list.push({ kind: 'block', at: g(plan.wake), end: g(plan.wake), label: plan.wakeEstimated ? 'Wake up (estimated)' : 'Wake up', icon: '⏰' });
    if (plan.work) list.push({ kind: 'block', at: g(plan.work.start), end: g(plan.work.end), label: plan.work.label ?? 'Work', icon: '💼' });
    else if (plan.workStart) list.push({ kind: 'block', at: g(plan.workStart), end: g(plan.workStart), label: 'Work starts · end not set', icon: '💼' });
    else if (plan.workEnd) list.push({ kind: 'block', at: g(plan.workEnd), end: g(plan.workEnd), label: 'Work ends', icon: '💼' });
    for (const b of plan.busy) list.push({ kind: 'block', at: g(b.start), end: g(b.end), label: b.label ?? 'Busy', icon: '📌' });
    list.push({ kind: 'block', at: g(plan.sleep), end: g(plan.sleep), label: plan.sleepEstimated ? 'Bedtime (estimated)' : 'Bedtime', icon: '🌙' });
    const anytime: Quest[] = [];
    for (const q of quests) {
      if (q.hidden && q.status !== 'completed') continue;
      const time = q.status === 'completed' ? q.actualTime : q.snoozedUntil ? tsToHm(q.snoozedUntil) : q.scheduledTime;
      if (time) list.push({ kind: 'quest', at: g(time), quest: q });
      else if (!q.goal) anytime.push(q);
    }
    const nowMin = minuteOfDay(now);
    list.push({ kind: 'now', at: nowMin < dayStartHour * 60 ? nowMin + 1440 : nowMin });
    list.sort((a, b) => a.at - b.at || (a.kind === 'now' ? -1 : 1));
    return { items: list, anytime };
  }, [quests, plan, now, dayStartHour]);

  return (
    <div className="rounded-3xl bg-surface p-4 shadow-card">
      <ol className="relative ml-[52px] border-l-2 border-line">
        {items.map((it, i) => (
          <Fragment key={i}>
            {it.kind === 'now' && (
              <li className="relative -ml-[54px] flex items-center py-1" aria-label="Now">
                <span className="num w-[44px] text-right text-[11px] font-bold text-danger">{minutesToHm(it.at)}</span>
                <span className="relative z-10 ml-[5px] h-3 w-3 rounded-full bg-danger ring-4 ring-danger/20" />
                <span className="ml-2 h-0.5 flex-1 bg-danger/40" />
              </li>
            )}
            {it.kind === 'block' && (
              <li className="relative -ml-[54px] flex items-center py-1.5">
                <span className="num w-[44px] text-right text-[11px] text-muted">{minutesToHm(it.at)}</span>
                <span className="relative z-10 ml-[6px] flex h-[10px] w-[10px] rounded-full bg-surface-3" />
                <span className="ml-3 text-[13px] font-medium text-muted">
                  {it.icon} {it.label}
                  {it.end !== it.at && <span className="num"> · until {minutesToHm(it.end)}</span>}
                </span>
              </li>
            )}
            {it.kind === 'quest' && (
              <li className="relative -ml-[54px] flex items-center py-1">
                <span className="num w-[44px] text-right text-[12px] font-semibold">{minutesToHm(it.at)}</span>
                <span
                  className={cx(
                    'relative z-10 ml-[4px] flex h-[14px] w-[14px] items-center justify-center rounded-full border-2',
                    it.quest.status === 'completed' ? 'border-success bg-success' : it.quest.status === 'pending' ? 'border-accent bg-surface' : 'border-faint bg-surface-2',
                  )}
                />
                <button
                  type="button"
                  onClick={() => onOpen(it.quest)}
                  className={cx('ml-2.5 flex min-h-11 flex-1 items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-left', it.quest.status !== 'pending' && 'opacity-55')}
                >
                  <span aria-hidden>{it.quest.icon}</span>
                  <span className={cx('flex-1 truncate text-[14px] font-semibold', it.quest.status === 'completed' && 'line-through')}>{resolveText(it.quest.title, petName)}</span>
                  {it.quest.snoozedUntil && it.quest.status === 'pending' && <span className="text-[11px] font-semibold text-warn">⏰</span>}
                  <span className="num text-[11px] text-muted">{it.quest.durationMin > 1 ? `${it.quest.durationMin}m` : ''}</span>
                </button>
              </li>
            )}
          </Fragment>
        ))}
      </ol>
      {anytime.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[12px] font-bold tracking-wide text-muted uppercase">Anytime</div>
          <div className="flex flex-wrap gap-2">
            {anytime.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onOpen(q)}
                className={cx('flex min-h-10 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-semibold', q.status !== 'pending' && 'opacity-50 line-through')}
              >
                {q.icon} {resolveText(q.title, petName)}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">Completion times feed habit learning: the app suggests better times and reminders from what you really do.</p>
    </div>
  );
}
