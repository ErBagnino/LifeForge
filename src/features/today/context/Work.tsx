import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button, Card, cx } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { expectedWork, formatDuration, type QuestDecision } from '@/domain/dailyContext';
import { clock } from '@/services/clock';
import { endWork, setNoWork, startWork } from '@/services/contextService';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import { tsToHm, weekday } from '@/utils/date';

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
  return (
    <Card className="mt-3">
      <div className="flex items-center gap-3">
        <span className="text-[28px]" aria-hidden>
          💼
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-extrabold tracking-wider text-muted">WORK</div>
          <div className="text-[14px] leading-snug">{exp?.start !== undefined ? `You usually leave around ${String(Math.floor(exp.start / 60) % 24).padStart(2, '0')}:${String(exp.start % 60).padStart(2, '0')}.` : 'Tap START when you leave home — the commute counts.'}</div>
        </div>
        <Button
          className="shrink-0"
          icon="play"
          loading={busy}
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
      <button
        type="button"
        className="mt-1 min-h-11 text-[13px] font-semibold text-muted"
        onClick={async () => {
          await setNoWork(true);
          await refresh();
        }}
      >
        Not working today
      </button>
    </Card>
  );
}

/**
 * WORK MODE: a deliberately minimal Home while at work. Quests are on hold (never
 * failed); the point is to put the phone down.
 */
export function WorkModeView({ onEnd, onShowAll }: { onEnd: () => void; onShowAll: () => void }) {
  const context = useGame((s) => s.context);
  const now = useTick(!!context?.openWork, 30_000);
  if (!context?.openWork) return null;
  const remaining = context.view.decisions.filter((d) => d.priority !== 'OPTIONAL').length;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
      <Card className="py-6 text-center">
        <div className="text-[12px] font-extrabold tracking-[0.18em] text-muted">WORK MODE</div>
        <div className="mt-2 text-[44px]" aria-hidden>
          💼
        </div>
        <div className="text-[20px] font-bold">Working</div>
        <dl className="num mx-auto mt-4 grid max-w-[300px] grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-2xl bg-surface-2 px-3 py-2">
            <dt className="text-muted">Started</dt>
            <dd className="text-[18px] font-bold">{tsToHm(context.openWork.start)}</dd>
          </div>
          <div className="rounded-2xl bg-surface-2 px-3 py-2">
            <dt className="text-muted">Duration</dt>
            <dd className="text-[18px] font-bold">{clockDuration(now - context.openWork.start)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[14px] text-muted">Today’s remaining objectives: {remaining}</p>
        <p className="mx-auto mt-2 max-w-[280px] text-[15px] font-semibold">Focus on work. LifeForge will handle the rest later.</p>
        <Button size="lg" variant="secondary" icon="stop" className="mt-5" onClick={onEnd}>
          END WORK
        </Button>
        <button type="button" onClick={onShowAll} className="mt-2 block min-h-11 w-full text-[13px] text-faint">
          Show everything anyway
        </button>
      </Card>
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
