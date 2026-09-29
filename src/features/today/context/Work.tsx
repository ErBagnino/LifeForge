import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button, cx } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { expectedWork, formatDuration, type QuestDecision } from '@/domain/dailyContext';
import { clock } from '@/services/clock';
import { endWork, setNoWork, startWork } from '@/services/contextService';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import { dateTimeToTs, tsToHm, weekday } from '@/utils/date';

const PRIORITY_STYLE: Record<QuestDecision['priority'], string> = {
  CRITICAL: 'bg-danger/12 text-danger',
  IMPORTANT: 'bg-accent/12 text-accent',
  NORMAL: 'bg-surface-2 text-muted',
  OPTIONAL: 'bg-surface-2 text-faint',
};

export function PriorityChip({ p }: { p: QuestDecision['priority'] }) {
  return <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wider', PRIORITY_STYLE[p])}>{p}</span>;
}

function useTick(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(clock.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** "HH:MM" of a duration, e.g. 06h 43m for the live counter. */
function clockDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}h ${String(m % 60).padStart(2, '0')}m`;
}

/** WORK · START card, shown on days when work is plausible and no session was logged yet. */
export function WorkStartCard() {
  const context = useGame((s) => s.context);
  const today = useGame((s) => s.today);
  const refresh = useGame((s) => s.refresh);
  const act = useGame((s) => s.act);
  const [busy, setBusy] = useState(false);
  if (!context || !today || context.openWork) return null;
  const { view, ctx, learned } = context;
  if (ctx.noWork || ctx.work.length || !['WAKE_UP', 'MORNING', 'AFTERNOON', 'WEEKEND'].includes(view.state)) return null;
  const exp = expectedWork(learned, today.date);
  const planned = today.plan.workStatus === 'set' || today.plan.workStatus === 'partial';
  const wd = weekday(today.date);
  const weekend = wd === 0 || wd === 6;
  if (weekend && !exp && !planned) return null;
  const leave = exp?.start !== undefined ? `usually ~${String(Math.floor(exp.start / 60) % 24).padStart(2, '0')}:${String(exp.start % 60).padStart(2, '0')}` : 'the commute counts';
  return (
    <div className="mt-3 flex items-center gap-2 rounded-2xl bg-surface px-3 py-1.5 shadow-card">
      <span className="text-[20px]" aria-hidden>
        💼
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[14px] font-semibold">Leaving for work?</div>
        <div className="truncate text-[12px] text-muted">Tap when you leave · {leave}</div>
      </div>
      <button
        type="button"
        className="hit-44 shrink-0 px-1 text-[12px] font-semibold text-muted"
        onClick={async () => {
          await setNoWork(true);
          await refresh();
        }}
      >
        Not today
      </button>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        icon="play"
        loading={busy}
        aria-label="Start work"
        onClick={async () => {
          setBusy(true);
          // act() also reschedules reminders, so nothing nags during work.
          await act(startWork().then(() => ({ events: [] })));
          setBusy(false);
        }}
      >
        START
      </Button>
    </div>
  );
}

/**
 * WORK MODE: a deliberately minimal Home while at work. Quests are on hold (never
 * failed); the point is to put the phone down.
 */
export function WorkModeView({ onEnd, onShowAll }: { onEnd: () => void; onShowAll: () => void }) {
  const context = useGame((s) => s.context);
  const today = useGame((s) => s.today);
  const dayStartHour = useGame((s) => s.settings?.dayStartHour ?? 4);
  const now = useTick(!!context?.openWork, 30_000);
  if (!context?.openWork || !today) return null;
  const start = context.openWork.start;
  // Expected end: today's planned hours, else what the app has learned, else a plain 9 hours.
  const plannedEnd = today.plan.work?.end ? dateTimeToTs(today.date, today.plan.work.end, dayStartHour) : undefined;
  const learnedMin = expectedWork(context.learned, today.date)?.minutes ?? context.learned.work.avgMinutes;
  const end = plannedEnd && plannedEnd > start ? plannedEnd : start + (learnedMin ?? 9 * 60) * 60_000;
  const ratio = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
  const remaining = context.view.decisions.filter((d) => d.priority !== 'OPTIONAL').length;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
      <section aria-label="Work mode" className="rounded-[28px] bg-surface px-5 py-7 text-center shadow-card">
        <div className="text-[13px] font-extrabold tracking-[0.2em] text-muted">WORKING</div>
        <div className="num mt-3 text-[30px] font-extrabold tracking-tight">
          {tsToHm(start)} <span className="text-muted">→</span> {tsToHm(end)}
        </div>
        <div className="mx-auto mt-4 max-w-[300px]">
          <div className="h-3 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Workday progress">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${ratio * 100}%` }} />
          </div>
          <div className="num mt-1.5 flex justify-between text-[12px] text-muted">
            <span>{clockDuration(now - start)} in</span>
            <span>{plannedEnd ? 'planned end' : 'usual end'}</span>
          </div>
        </div>
        <Button size="lg" icon="stop" className="mt-6 min-w-[200px]" onClick={onEnd}>
          END WORK
        </Button>
        <p className="mt-4 text-[13px] text-muted">Quests are on hold · {remaining} left for later</p>
        <button type="button" onClick={onShowAll} className="mt-1 block min-h-11 w-full text-[13px] text-faint">
          Show everything anyway
        </button>
      </section>
    </motion.div>
  );
}

/** END WORK → WORK COMPLETE → YOUR EVENING (only what still fits). */
export function PostWorkSheet({ minutes, open, onClose }: { minutes: number; open: boolean; onClose: () => void }) {
  const context = useGame((s) => s.context);
  const settings = useGame((s) => s.settings);
  const [phase, setPhase] = useState<'done' | 'evening'>('done');
  useEffect(() => {
    if (!open) return;
    setPhase('done');
    const t = setTimeout(() => setPhase('evening'), 1400);
    return () => clearTimeout(t);
  }, [open]);
  const focus = context?.view.focus ?? [];
  return (
    <Sheet open={open} onClose={onClose} title={phase === 'done' ? 'WORK COMPLETE' : 'YOUR EVENING'}>
      <div className="pb-2 text-center">
        <div className="relative mx-auto h-16 w-16 text-[44px]" aria-hidden>
          <AnimatePresence mode="wait">
            <motion.span key={phase} className="absolute inset-0" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.25 }}>
              {phase === 'done' ? '💼' : '🏠'}
            </motion.span>
          </AnimatePresence>
        </div>
        {phase === 'done' ? (
          <p className="mt-2 text-[18px] font-bold">{formatDuration(minutes)} completed.</p>
        ) : (
          <>
            <p className="mt-2 text-[16px] font-semibold">Here’s what still matters today.</p>
            <p className="num text-[13px] text-muted">{formatDuration(context?.view.availableMin ?? 0)} before bed</p>
            <ul className="mt-3 space-y-2 text-left">
              {focus.map((d) => (
                <li key={d.quest.id} className="flex items-center gap-2 rounded-2xl bg-surface px-3 py-2.5 shadow-card">
                  <span className="text-[20px]" aria-hidden>
                    {d.quest.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{resolveText(d.quest.title, settings?.profile.petName ?? '')}</span>
                  {d.quest.durationMin > 0 && !d.quest.metric && <span className="num shrink-0 text-[12px] text-muted">{d.quest.durationMin} min</span>}
                  <PriorityChip p={d.priority} />
                </li>
              ))}
              {!focus.length && <li className="rounded-2xl bg-surface px-3 py-3 text-[14px]">Nothing urgent left — enjoy your evening. 🌙</li>}
            </ul>
          </>
        )}
        <Button block className="mt-4" onClick={onClose}>
          {phase === 'done' ? 'Continue' : 'Let’s go'}
        </Button>
      </div>
    </Sheet>
  );
}

/** Hook for the END WORK flow used by the Today screen. */
export function useEndWork() {
  const act = useGame((s) => s.act);
  const [post, setPost] = useState<{ open: boolean; minutes: number }>({ open: false, minutes: 0 });
  const end = async () => {
    const r = await act(endWork());
    setPost({ open: true, minutes: r.minutes });
  };
  return { post, end, close: () => setPost((p) => ({ ...p, open: false })) };
}
