import { motion } from 'motion/react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/primitives';
import { pickNextAction } from '@/domain/nextAction';
import { activeBlock, freeMinutesUntilNextBlock } from '@/domain/workload';
import { useNow } from '@/hooks';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { Quest } from '@/types';
import { minuteOfDay } from '@/utils/date';

export function NextActionCard({ onStart, onOpen }: { onStart: (q: Quest) => void; onOpen: (q: Quest) => void }) {
  const today = useGame((s) => s.today);
  const player = useGame((s) => s.player);
  const settings = useGame((s) => s.settings);
  const now = useNow(60000);

  const next = useMemo(() => {
    if (!today || !player || !settings) return undefined;
    const nowMin = minuteOfDay(now);
    const threshold = settings.rules.difficultyPresets[settings.difficulty].streakThreshold;
    return pickNextAction(today.quests, {
      now,
      nowMin,
      energy: player.energy,
      freeMinutes: freeMinutesUntilNextBlock(today.plan, nowMin, settings.dayStartHour),
      inBlock: !!activeBlock(today.plan, nowMin),
      dayType: today.plan.dayType,
      workKnown: today.plan.workStatus !== 'unknown',
      streakAtRisk: player.streak.current > 0 && (today.log?.score ?? 0) < threshold,
      workloadLevel: today.log?.workloadLevel ?? 'medium',
      dayStartHour: settings.dayStartHour,
    });
  }, [today, player, settings, now]);

  if (!today || !settings) return null;
  if (!next) {
    const allDone = today.quests.length > 0 && today.quests.every((q) => q.status !== 'pending' || q.hidden || q.goal);
    return (
      <div className="mt-3 rounded-3xl bg-gradient-to-br from-success/90 to-success p-5 text-white shadow-card">
        <div className="text-[12px] font-extrabold tracking-widest opacity-80">NEXT ACTION</div>
        <div className="mt-1 text-[20px] font-bold">{allDone ? 'Board cleared. Legend behaviour. 🏆' : 'Nothing actionable right now.'}</div>
        <div className="mt-1 text-[14px] opacity-85">{allDone ? 'Rest, or grab something from the library for bonus XP.' : 'Snoozed quests will come back on time.'}</div>
      </div>
    );
  }
  const q = next.quest;
  return (
    <motion.div layout className="relative mt-3 overflow-hidden rounded-3xl p-5 text-white shadow-card" style={{ background: 'linear-gradient(135deg, var(--lf-accent), var(--lf-accent-2))' }}>
      <div className="pointer-events-none absolute -top-6 -right-4 text-[110px] opacity-15" aria-hidden>
        {q.icon}
      </div>
      <div className="text-[12px] font-extrabold tracking-widest opacity-85">NEXT ACTION</div>
      <button type="button" className="mt-1 block text-left" onClick={() => onOpen(q)}>
        <div className="text-[22px] leading-tight font-extrabold">
          {q.icon} {resolveText(q.title, settings.profile.petName)}
        </div>
        <div className="mt-1 text-[14px] font-medium opacity-90">{next.reason}</div>
      </button>
      <div className="mt-4 flex items-center gap-3">
        <Button size="lg" className="!bg-white !text-[var(--lf-accent)] min-w-[118px] shrink-0" icon={q.kind === 'workout' ? 'play' : q.metric ? 'plus' : 'check'} onClick={() => onStart(q)}>
          {q.kind === 'workout' ? 'START' : q.metric ? 'LOG' : 'DONE'}
        </Button>
        <div className="num min-w-0 leading-tight">
          <div className="text-[14px] font-bold opacity-95">
            +{q.xp} XP · +{q.coins} 🪙
          </div>
          {q.durationMin > 1 && <div className="text-[12px] font-semibold opacity-80">{q.durationMin} min</div>}
        </div>
      </div>
    </motion.div>
  );
}
