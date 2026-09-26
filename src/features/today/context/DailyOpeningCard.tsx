import { motion } from 'motion/react';
import { useState } from 'react';
import { TimeInput } from '@/components/ui/forms';
import { Button, Card } from '@/components/ui/primitives';
import { DIFFICULTY_STATE_INFO } from '@/domain/adaptive';
import { formatDuration, hm } from '@/domain/dailyContext';
import { tierCount } from '@/domain/score';
import { clock } from '@/services/clock';
import { confirmWake, startDay, wakeNotYet } from '@/services/contextService';
import { useGame } from '@/store/gameStore';
import { dateTimeToTs, formatDate } from '@/utils/date';

const GREETING = { morning: 'GOOD MORNING', afternoon: 'GOOD AFTERNOON', evening: 'GOOD EVENING', night: 'HELLO' } as const;

/**
 * First open of the day: wake-up question (a web app can't know when you wake up,
 * so it asks), the day at a glance and START DAY. Late openings get an adapted plan;
 * after days away, "Welcome back" with only what is actually known.
 */
export function DailyOpeningCard() {
  const context = useGame((s) => s.context);
  const settings = useGame((s) => s.settings);
  const player = useGame((s) => s.player);
  const today = useGame((s) => s.today);
  const refresh = useGame((s) => s.refresh);
  const [manual, setManual] = useState(false);
  const [time, setTime] = useState(() => new Date(clock.now()).toTimeString().slice(0, 5));
  if (!context?.opening || !settings || !player || !today) return null;
  const { opening, view, ctx } = context;
  const run = async (p: Promise<unknown>) => {
    await p;
    await refresh();
  };
  const saveManual = () => run(confirmWake(dateTimeToTs(clock.today(), time, settings.dayStartHour), 'manual').then(() => setManual(false)));
  const core = tierCount(today.quests, 'core');
  const difficulty = DIFFICULTY_STATE_INFO[today.log?.difficultyState ?? 'balanced'];
  const name = (settings.profile.nickname || player.name || 'player').toUpperCase();

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
      <Card className="bg-gradient-to-br from-accent/10 to-xp/10">
        {opening.welcomeBack && opening.lastVisit && (
          <p className="mb-3 rounded-2xl bg-surface px-3 py-2 text-[13px]">
            <b>Welcome back.</b> Last visit: {formatDate(opening.lastVisit, 'EEE d MMM')}. Days without the app only affected your streak — nothing was marked as failed or invented.
          </p>
        )}
        <div className="text-[12px] font-extrabold tracking-[0.16em] text-accent">
          {GREETING[opening.kind]}, {name}
        </div>
        <div className="mt-1 text-[20px] leading-snug font-bold">{opening.late ? 'You’ve started late today.' : 'Ready?'}</div>
        {opening.late && <p className="mt-1 text-[14px] text-muted">The plan is adapted to the {formatDuration(view.availableMin)} left before bed.</p>}

        {opening.wake.kind === 'ask' && !manual && (
          <div className="mt-3 rounded-2xl bg-surface p-3">
            <div className="text-[15px] font-semibold">☀️ Did you just wake up?</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button onClick={() => void run(confirmWake(clock.now(), 'confirmed'))}>YES</Button>
              <Button variant="secondary" onClick={() => void run(wakeNotYet())}>
                NOT YET
              </Button>
            </div>
          </div>
        )}
        {opening.wake.kind === 'confirm' && !manual && (
          <div className="mt-3 rounded-2xl bg-surface p-3">
            <div className="text-[15px] font-semibold">Good morning. Wake-up around {opening.wake.suggested}?</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button onClick={() => void run(confirmWake(dateTimeToTs(clock.today(), (opening.wake as { suggested: string }).suggested, settings.dayStartHour), 'estimated'))}>CONFIRM</Button>
              <Button variant="secondary" onClick={() => setManual(true)}>
                CHANGE TIME
              </Button>
            </div>
          </div>
        )}
        {manual ? (
          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-surface p-3">
            <span className="shrink-0 text-[14px] font-semibold">Woke up at</span>
            <TimeInput value={time} onChange={setTime} aria-label="Wake-up time" className="min-w-0 flex-1" />
            <Button className="shrink-0" onClick={() => void saveManual()}>
              Save
            </Button>
          </div>
        ) : (
          <button type="button" className="mt-2 min-h-11 text-[13px] font-semibold text-accent" onClick={() => setManual(true)}>
            Set wake-up time manually
          </button>
        )}

        <dl className="num mt-2 grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-2xl bg-surface px-3 py-2">
            <dt className="text-muted">Wake-up</dt>
            <dd className="text-[16px] font-bold">{ctx.wakeUpTime ? hm(new Date(ctx.wakeUpTime).getHours() * 60 + new Date(ctx.wakeUpTime).getMinutes()) : '—'}</dd>
          </div>
          <div className="rounded-2xl bg-surface px-3 py-2">
            <dt className="text-muted">Energy</dt>
            <dd className="text-[16px] font-bold">{Math.round((player.energy / Math.max(1, player.maxEnergy)) * 100)}%</dd>
          </div>
          <div className="rounded-2xl bg-surface px-3 py-2">
            <dt className="text-muted">Today’s difficulty</dt>
            <dd className="text-[16px] font-bold">
              {difficulty.icon} {difficulty.label}
            </dd>
          </div>
          <div className="rounded-2xl bg-surface px-3 py-2">
            <dt className="text-muted">Main objective</dt>
            <dd className="text-[14px] leading-tight font-bold">{core.total ? `${core.total - core.done} core quests` : 'Your quests'}</dd>
          </div>
        </dl>
        <Button block size="lg" className="mt-3" icon="play" onClick={() => void run(startDay())}>
          START DAY
        </Button>
      </Card>
    </motion.div>
  );
}
