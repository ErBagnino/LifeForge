import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { formatDuration, STATE_INFO } from '@/domain/dailyContext';
import { useGame } from '@/store/gameStore';

/** ☀️ Morning · 💼 Working · 🏠 Post-work · 🏋️ Training · 🌙 Evening — and why the Home looks the way it does. */
export function ContextChip() {
  const context = useGame((s) => s.context);
  const [open, setOpen] = useState(false);
  if (!context) return null;
  const { view } = context;
  const info = STATE_INFO[view.state];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hit-44 mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-[13px] font-semibold shadow-card" aria-label={`Current context: ${info.label}. Why?`} data-tour="context">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={view.state} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} className="inline-flex items-center gap-1.5">
            <span aria-hidden>{info.icon}</span>
            <span className="truncate">{info.label}</span>
          </motion.span>
        </AnimatePresence>
        {view.state !== 'WORK' && view.state !== 'SLEEP' && <span className="num shrink-0 text-muted">· {formatDuration(view.availableMin)} left</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`${info.icon} ${info.label}`}>
        <div className="space-y-2 pb-2 text-[15px]">
          <p>{explain(view.state)}</p>
          {view.state !== 'SLEEP' && (
            <ul className="num space-y-1 rounded-2xl bg-surface-2 px-4 py-3 text-[14px]">
              <li>Time before bed: {formatDuration(view.minutesToBed)}</li>
              {view.busyAhead > 0 && <li>Still busy (work): ~{formatDuration(view.busyAhead)}</li>}
              <li>Available: {formatDuration(view.availableMin)}</li>
              <li>What still matters: {formatDuration(view.plannedMin)} {view.fits ? '✓ fits' : '— more than the time left, so LifeForge prioritizes'}</li>
              {view.workMinutes > 0 && <li>Work today: {formatDuration(view.workMinutes)}</li>}
            </ul>
          )}
          <p className="text-[12px] text-muted">Based only on what you tell LifeForge (wake-up, START/END WORK), the clock and your habits. No location, no background tracking.</p>
        </div>
      </Sheet>
    </>
  );
}

function explain(state: keyof typeof STATE_INFO): string {
  switch (state) {
    case 'WORK':
      return 'You’re at work. Quests are on hold — none of them fail because of it. They come back after END WORK if they still fit.';
    case 'POST_WORK':
      return 'You just got back. The Home shows only what still matters and fits before bed.';
    case 'TRAINING':
      return 'A workout is in progress. Everything else waits; no reminders.';
    case 'WAKE_UP':
    case 'MORNING':
      return 'Morning: routine first, then today’s objectives.';
    case 'WEEKEND':
      return 'Weekend: no work session, so the day is yours — the plan uses the free time.';
    case 'EVENING':
      return 'Evening: remaining objectives and your evening routine.';
    case 'WIND_DOWN':
      return 'Close to bedtime: only light, evening things. Heavy tasks can wait.';
    case 'SLEEP':
      return 'Outside your waking hours. See the summary and tomorrow’s preview.';
    default:
      return 'The Home adapts to the time left today and what matters most.';
  }
}
