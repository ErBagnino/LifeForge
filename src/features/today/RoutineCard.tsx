import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/progress';
import { cx } from '@/components/ui/primitives';
import type { Quest, Routine } from '@/types';

/** A routine as a mini mission: a chain of steps with the next one highlighted and a completion bonus. */
export function RoutineCard({ routine, quests, done, children }: { routine: Routine; quests: Quest[]; done: boolean; children: ReactNode }) {
  const completed = quests.filter((q) => q.status === 'completed').length;
  const next = quests.find((q) => q.status === 'pending');
  const [open, setOpen] = useState(false);
  return (
    <div className={cx('overflow-hidden rounded-3xl bg-surface shadow-card', done && 'opacity-70')}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={open}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[22px]">{done ? '✅' : routine.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold">
            {routine.name}
            {routine.startTime && <span className="num ml-1.5 text-[12px] font-medium text-muted">🕐 {routine.startTime}</span>}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <ProgressBar value={completed / quests.length} height={6} color={done ? 'var(--lf-success)' : undefined} />
            <span className="num shrink-0 text-[11px] font-semibold text-muted">
              {completed}/{quests.length}
            </span>
          </span>
          {!open && (
            <span className="mt-2 flex items-center" aria-hidden>
              {quests.map((q, i) => (
                <span key={q.id} className="flex items-center">
                  {i > 0 && <span className={cx('h-[2px] w-2.5 rounded-full', q.status === 'completed' || quests[i - 1].status === 'completed' ? 'bg-accent/60' : 'bg-surface-3')} />}
                  <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-[12px]', q.status === 'completed' ? 'bg-accent/20' : q === next ? 'bg-accent/15 ring-2 ring-accent/60' : 'bg-surface-2 opacity-60')}>
                    {q.status === 'completed' ? '✓' : q.icon}
                  </span>
                </span>
              ))}
            </span>
          )}
          {!open && next && !done && (
            <span className="mt-1.5 block truncate text-[12px] text-muted">
              Step {completed + 1} of {quests.length}: <span className="font-semibold text-fg">{next.title}</span>
            </span>
          )}
        </span>
        <span className="num shrink-0 text-right text-[11px] font-bold text-xp">
          +{routine.bonusXp}
          <span className="block text-muted">bonus</span>
        </span>
        <Icon name="chevronDown" size={18} className={cx('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="space-y-2 bg-surface-2/60 p-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
