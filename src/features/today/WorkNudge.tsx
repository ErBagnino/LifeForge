import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/primitives';
import { setTemporaryWork } from '@/services/scheduleService';
import { useGame } from '@/store/gameStore';
import type { ISODate } from '@/types';

const key = (date: ISODate) => `lf-worknudge-${date}`;

function dismissed(date: ISODate): boolean {
  try {
    return localStorage.getItem(key(date)) === '1';
  } catch {
    return false;
  }
}

/**
 * Asks about work only when it would actually change the plan: work hours are unknown
 * for today, it's still morning, and the player hasn't answered today. Never on day 1.
 */
export function WorkNudge({ date, workStatus, dayIndex, onSetup }: { date: ISODate; workStatus: string; dayIndex: number; onSetup: () => void }) {
  const navigate = useNavigate();
  const act = useGame((s) => s.act);
  const status = useGame((s) => s.settings?.work.status);
  const [hidden, setHidden] = useState(() => dismissed(date));
  const hour = new Date().getHours();
  const explicitUnknown = status === 'unknown';
  const relevant = workStatus === 'unknown' && dayIndex >= 1 && hour >= 5 && hour < 14 && (!explicitUnknown || dayIndex % 3 === 1);

  const dismiss = () => {
    try {
      localStorage.setItem(key(date), '1');
    } catch {
      // ignore
    }
    setHidden(true);
  };

  return (
    <AnimatePresence>
      {relevant && !hidden && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="mt-4 overflow-hidden rounded-3xl bg-surface p-4 shadow-card">
          <div className="flex items-start gap-3">
            <span className="text-[26px]" aria-hidden>
              💼
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-bold">Working today?</div>
              <p className="text-[13px] text-muted">Only if you know. Otherwise today’s plan stays provisional and adapts as you go.</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button
              size="sm"
              className="!h-11"
              onClick={() => {
                dismiss();
                onSetup();
              }}
            >
              Yes
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="!h-11"
              onClick={() => {
                dismiss();
                void act(setTemporaryWork(date, { kind: 'off' }));
              }}
            >
              Day off
            </Button>
            <Button size="sm" variant="secondary" className="!h-11" onClick={dismiss}>
              Not sure
            </Button>
          </div>
          <button type="button" className="mt-1 h-11 text-[13px] font-semibold text-accent" onClick={() => navigate('/settings/schedule')}>
            Set a regular schedule instead
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
