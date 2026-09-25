import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/progress';
import { Button, Card, cx } from '@/components/ui/primitives';
import { elapsedMinutes, LEISURE_KINDS, leisureStatus, remainingMinutes } from '@/domain/leisure';
import { clock } from '@/services/clock';
import { startLeisure, stopLeisure } from '@/services/metricsService';
import { useGame } from '@/store/gameStore';
import type { LeisureKind } from '@/types';

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function usePlayTime() {
  const timer = useGame((s) => s.leisureTimer);
  const settings = useGame((s) => s.settings?.leisure);
  const logged = useGame((s) => s.today?.log?.metrics.leisure ?? 0);
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(clock.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);
  const running = timer ? elapsedMinutes(timer, now) : 0;
  const limit = settings?.dailyLimitMin ?? 90;
  const used = logged + running;
  return {
    enabled: settings?.enabled ?? false,
    timer,
    runningSec: timer ? (now - timer.startedAt) / 1000 : 0,
    used,
    limit,
    remaining: remainingMinutes(used, limit),
    status: leisureStatus(used, limit, settings?.warnAtPct ?? 80),
  };
}

export function usePlayActions() {
  const act = useGame((s) => s.act);
  const refresh = useGame((s) => s.refresh);
  return {
    start: async (kind: LeisureKind) => {
      await startLeisure(kind);
      await refresh();
    },
    stop: () => act(stopLeisure()),
  };
}

/** Compact Today card: live play-time budget with a big Start/Stop. */
export function PlayTimeCard() {
  const navigate = useNavigate();
  const p = usePlayTime();
  const { start, stop } = usePlayActions();
  const [picking, setPicking] = useState(false);
  if (!p.enabled) return null;
  const color = p.status === 'over' ? 'var(--lf-danger)' : p.status === 'warn' ? 'var(--lf-warn)' : 'var(--lf-success)';

  return (
    <Card className="mt-3">
      <div className="flex items-center gap-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate('/play')} aria-label="Open play time">
          <div className="flex items-center gap-1.5 text-[13px] font-bold tracking-wide text-muted uppercase">
            🎮 Play time <span className="normal-case">· max {Math.floor(p.limit / 60)}h{p.limit % 60 ? String(p.limit % 60).padStart(2, '0') : ''}/day</span>
          </div>
          <div className="num mt-0.5 text-[22px] font-extrabold" style={{ color }}>
            {p.timer ? formatClock(p.runningSec) : `${Math.round(p.used)} min`}
            <span className="ml-1.5 text-[13px] font-semibold text-muted">
              {p.timer ? `· ${Math.round(p.used)}/${p.limit} min today` : p.status === 'over' ? `· ${Math.round(p.used - p.limit)} min over` : `· ${Math.round(p.remaining)} min left`}
            </span>
          </div>
        </button>
        {p.timer ? (
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => void stop()}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white shadow-float"
            aria-label="Stop play timer"
          >
            <Icon name="stop" size={22} />
          </motion.button>
        ) : (
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => setPicking((v) => !v)}
            className={cx('flex h-14 w-14 items-center justify-center rounded-full text-white shadow-float', p.status === 'over' ? 'bg-danger' : 'bg-success')}
            aria-label="Start play timer"
            aria-expanded={picking}
          >
            <Icon name="play" size={22} />
          </motion.button>
        )}
      </div>
      <ProgressBar value={p.used / p.limit} color={color} height={8} className="mt-3" label="Play time used" />
      {picking && !p.timer && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(Object.keys(LEISURE_KINDS) as LeisureKind[]).map((k) => (
            <Button
              key={k}
              variant="secondary"
              size="sm"
              onClick={() => {
                setPicking(false);
                void start(k);
              }}
            >
              {LEISURE_KINDS[k].icon} {LEISURE_KINDS[k].short}
            </Button>
          ))}
        </div>
      )}
      {p.timer && (
        <div className="mt-2 text-[12px] text-muted">
          {LEISURE_KINDS[p.timer.kind].icon} Timer running — it keeps counting even if you close the app. Tap stop when you’re done.
        </div>
      )}
    </Card>
  );
}
