import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/progress';
import { cx } from '@/components/ui/primitives';
import type { Quest, Routine } from '@/types';

/** A routine shown as one collapsible card instead of many small quests. */
export function RoutineCard({ routine, quests, done, children }: { routine: Routine; quests: Quest[]; done: boolean; children: ReactNode }) {
  const completed = quests.filter((q) => q.status === 'completed').length;
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
            <span className="mt-1.5 flex flex-wrap gap-1 text-[13px]" aria-hidden>
              {quests.map((q) => (
                <span key={q.id} className={q.status === 'completed' ? 'opacity-40' : ''}>
                  {q.icon}
                </span>
              ))}
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
