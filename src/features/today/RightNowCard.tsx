import { motion } from 'motion/react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/primitives';
import { CATEGORY_INFO } from '@/data/categories';
import { formatDuration, STATE_INFO } from '@/domain/dailyContext';
import { pickNextAction } from '@/domain/nextAction';
import { activeBlock, freeMinutesUntilNextBlock } from '@/domain/workload';
import { useNow } from '@/hooks';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { Quest } from '@/types';
import { minuteOfDay } from '@/utils/date';
import { useQuestActions } from '../quests/useQuestActions';

/**
 * RIGHT NOW: the single most important thing to do, presented as a game objective —
 * what, how long, what it costs and what it gives, and one big button.
 * Context-aware (time of day, energy, work, priorities); quiet at night.
 */
export interface RightNowPick {
  quest: Quest;
  reason: string;
  alternative?: { label: string; durationMin: number };
}

/** The quest RIGHT NOW features (also used by Home to avoid listing it twice). */
export function useRightNow(override?: Quest): RightNowPick | undefined {
  const today = useGame((s) => s.today);
  const player = useGame((s) => s.player);
  const settings = useGame((s) => s.settings);
  const context = useGame((s) => s.context);
  const now = useNow(60000);
  return useMemo<RightNowPick | undefined>(() => {
    if (!today || !player || !settings) return undefined;
    if (override) return { quest: override, reason: 'Your first quest — do it for real, then tap DONE.', alternative: undefined };
    const focus = context && !context.openWork ? context.view.focus[0] : undefined;
    if (focus) return { quest: focus.quest, reason: focus.reason, alternative: focus.alternative };
    const nowMin = minuteOfDay(now);
    const threshold = settings.rules.difficultyPresets[settings.difficulty].streakThreshold;
    const next = pickNextAction(today.quests, {
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
    return next ? { quest: next.quest, reason: next.reason, alternative: undefined } : undefined;
  }, [today, player, settings, context, now, override]);

}

export function RightNowCard({ onStart, onOpen, pick, override }: { onStart: (q: Quest) => void; onOpen: (q: Quest) => void; pick: RightNowPick | undefined; override?: Quest }) {
  const today = useGame((s) => s.today);
  const player = useGame((s) => s.player);
  const settings = useGame((s) => s.settings);
  const context = useGame((s) => s.context);
  const actions = useQuestActions();
  const navigate = useNavigate();

  if (!today || !settings || !player) return null;
  const state = context?.view.state;

  if (!override && (state === 'SLEEP' || state === 'WIND_DOWN')) {
    const info = STATE_INFO[state];
    const done = today.quests.filter((q) => q.status === 'completed').length;
    return (
      <div className="mt-3 rounded-[28px] bg-surface p-5 shadow-card">
        <div className="text-[12px] font-extrabold tracking-[0.16em] text-muted">
          RIGHT NOW · {info.icon} {info.label.toUpperCase()}
        </div>
        <div className="mt-1 text-[20px] font-bold">Time to recharge.</div>
        <p className="mt-1 text-[14px] text-muted">
          {done} {done === 1 ? 'quest' : 'quests'} done · score {today.log?.score ?? 0}. Anything left can wait — rest counts.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => navigate('/review/day')}>
            Day summary
          </Button>
          <Button variant="secondary" onClick={() => navigate('/review/day#tomorrow')}>
            Tomorrow
          </Button>
        </div>
      </div>
    );
  }

  if (!pick) return null;
  const q = pick.quest;
  const pet = settings.profile.petName;
  const title = q.private ? 'Private check-in' : resolveText(q.title, pet);
  const cat = CATEGORY_INFO[q.category];
  const verb = q.kind === 'workout' ? 'START' : q.metric ? 'LOG' : 'DONE';
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Right now"
      className="relative mt-3 overflow-hidden rounded-[28px] p-5 text-white shadow-raised"
      style={{ background: 'radial-gradient(120% 90% at 100% 0%, var(--lf-accent-2), var(--lf-accent) 55%, color-mix(in srgb, var(--lf-accent) 70%, #000))' }}
    >
      <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-extrabold tracking-[0.18em] opacity-90">RIGHT NOW</span>
        {context && context.view.availableMin > 0 && <span className="num rounded-full bg-black/15 px-2 py-0.5 text-[11px] font-bold">{formatDuration(context.view.availableMin)} free today</span>}
      </div>
      <button type="button" className="mt-3 flex w-full items-center gap-3.5 text-left" onClick={() => onOpen(q)} aria-label={`${title}: details`}>
        <span className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[18px] bg-white/20 text-[30px] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_14px_-6px_rgba(0,0,0,0.35)]" aria-hidden>
          {q.private ? '🛡️' : q.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[21px] leading-tight font-extrabold [overflow-wrap:anywhere]">{title}</span>
          <span className="mt-0.5 block text-[13px] font-medium opacity-90">
            {q.durationMin > 1 ? `~${q.durationMin} min · ` : ''}
            {cat.label}
          </span>
        </span>
      </button>
      <p className="mt-2 text-[13px] leading-snug opacity-90">{pick.reason}</p>
      <div className="num mt-3 flex flex-wrap gap-1.5 text-[12px] font-bold">
        {q.energyCost > 0 && <span className="rounded-full bg-black/15 px-2.5 py-1">⚡ {q.energyCost} energy</span>}
        <span className="rounded-full bg-black/15 px-2.5 py-1">+{q.xp} XP</span>
        <span className="rounded-full bg-black/15 px-2.5 py-1">+{q.coins} 🪙</span>
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="lg" className="flex-1 !bg-white !text-[var(--lf-accent)] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.35)]" icon={q.kind === 'workout' ? 'play' : q.metric ? 'plus' : 'check'} onClick={() => onStart(q)}>
          {verb}
        </Button>
        {pick.alternative && (
          <Button size="lg" variant="secondary" className="!bg-white/15 !text-white" onClick={() => void actions.shorten(q, pick.alternative!.durationMin)}>
            {pick.alternative.label}
          </Button>
        )}
      </div>
    </motion.section>
  );
}
