import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ProgressBar } from '@/components/ui/progress';
import { Button, cx } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { derivedCounters, mergeCounters } from '@/domain/counters';
import { nextUnlocks, oneMoreThing } from '@/domain/homeFlow';
import { MAX_LEVEL } from '@/domain/level';
import { tierCount } from '@/domain/score';
import { useAsync, useLevel, useNow } from '@/hooks';
import { achievementRepository, activityRepository, metaRepository, statsRepository } from '@/repositories';
import { weeklyReview } from '@/services/insightsService';
import { loadSeason } from '@/services/progressService';
import { formatDate, shiftDate, weekStart } from '@/utils/date';
import { clock } from '@/services/clock';
import { resolveText } from '@/services/game/questFactory';
import { startActivityNow } from '@/services/game/questService';
import { useGame } from '@/store/gameStore';
import type { Quest } from '@/types';
import { buildingCost } from '@/domain/tycoon';
import { RoomScene } from '../world/RoomScene';
import { ScoreCard } from './ScoreCard';

/** One slim line of progress under RIGHT NOW: core done and today's score, tap for the full breakdown. */
export function ProgressStrip() {
  const today = useGame((s) => s.today);
  const threshold = useGame((s) => (s.settings ? s.settings.rules.difficultyPresets[s.settings.difficulty].streakThreshold : 70));
  const [open, setOpen] = useState(false);
  if (!today) return null;
  const core = tierCount(today.quests, 'core');
  const score = today.log?.score ?? 0;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-tour="score" className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-2xl bg-surface px-4 py-2.5 text-left shadow-card" aria-label={`Core ${core.done} of ${core.total}. Today score ${score}. Tap for why.`}>
        <span className="shrink-0 text-[12px] font-bold text-muted">
          Core <span className="num text-fg">{core.done}/{core.total}</span>
        </span>
        <ProgressBar value={score / 100} color={score >= threshold ? 'var(--lf-success)' : 'var(--lf-accent)'} height={6} className="min-w-0 flex-1" />
        <span className="num shrink-0 text-[15px] font-extrabold">{score}</span>
        <span className="shrink-0 text-[12px] font-semibold text-accent">Why?</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Today">
        <ScoreCard defaultOpen />
      </Sheet>
    </>
  );
}

/** NEXT UNLOCK: the closest level, room and achievement, with the real amount still missing. */
export function NextUnlockCard() {
  const navigate = useNavigate();
  const player = useGame((s) => s.player);
  const buildings = useGame((s) => s.buildings);
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const { level, into, needed } = useLevel();
  const { data } = useAsync(async () => ({ achievements: await achievementRepository.all(), counters: await statsRepository.counters() }), []);
  const unlocks = useMemo(() => {
    if (!player || !data) return [];
    return nextUnlocks({ level, xpInto: into, xpNeeded: needed, maxLevel: MAX_LEVEL, coins: player.coins, buildings, achievements: data.achievements, counters: mergeCounters(data.counters, derivedCounters(player, buildings, level)), text: (s) => resolveText(s, pet) });
  }, [player, data, buildings, level, into, needed, pet]);
  if (!unlocks.length) return null;
  return (
    <section aria-label="Next unlock" className="mt-3 rounded-[24px] bg-surface p-4 shadow-card">
      <div className="text-[12px] font-extrabold tracking-[0.16em] text-muted">NEXT UNLOCK</div>
      <ul className="mt-2 space-y-1">
        {unlocks.map((u) => (
          <li key={u.kind}>
            <button type="button" onClick={() => navigate(u.to)} className="flex min-h-11 w-full items-center gap-3 text-left">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[18px]" aria-hidden>
                {u.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[14px] font-semibold">{u.title}</span>
                  <span className={cx('num shrink-0 text-[12px] font-bold', u.remaining === 'ready to build' ? 'text-success' : 'text-muted')}>{u.remaining}</span>
                </span>
                <ProgressBar value={u.progress} height={4} className="mt-1" color={u.kind === 'level' ? 'var(--lf-xp)' : u.kind === 'building' ? 'var(--lf-coin)' : 'var(--lf-accent)'} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** ONE MORE THING? After the core is done: exactly one small optional thing. */
export function OneMoreThingCard({ onStart }: { onStart: (q: Quest) => void }) {
  const today = useGame((s) => s.today);
  const player = useGame((s) => s.player);
  const context = useGame((s) => s.context);
  const settings = useGame((s) => s.settings);
  const act = useGame((s) => s.act);
  const now = useNow(60000);
  const { data: activities } = useAsync(() => activityRepository.active(), [], { live: false });
  const [busy, setBusy] = useState(false);
  if (!today || !player || !settings || !activities || context?.openWork) return null;
  const core = tierCount(today.quests, 'core');
  const state = context?.view.state;
  if (core.total === 0 || core.done < core.total || state === 'SLEEP' || state === 'WIND_DOWN') return null;
  const pick = oneMoreThing({ quests: today.quests, activities, energy: player.energy, now, freeMinutes: context?.view.availableMin, seed: clock.today() });
  if (!pick) return null;
  const pet = settings.profile.petName;
  const title = pick.kind === 'quest' ? resolveText(pick.quest.title, pet) : resolveText(pick.activity.name, pet);
  const icon = pick.kind === 'quest' ? pick.quest.icon : pick.activity.icon;
  const minutes = pick.kind === 'quest' ? pick.quest.durationMin : pick.activity.durationMin;
  return (
    <section aria-label="One more thing" className="mt-3 rounded-[24px] border border-accent/25 bg-accent/8 p-4">
      <div className="text-[12px] font-extrabold tracking-[0.16em] text-accent">ONE MORE THING?</div>
      <div className="mt-2 flex items-center gap-3">
        <span className="text-[28px]" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] leading-snug font-bold [overflow-wrap:anywhere]">{title}</div>
          <div className="num text-[12px] text-muted">
            {minutes} min{pick.kind === 'quest' ? ` · +${pick.quest.xp} XP` : ' · bonus XP'}
          </div>
        </div>
        <Button
          size="sm"
          loading={busy}
          onClick={async () => {
            if (pick.kind === 'quest') return onStart(pick.quest);
            setBusy(true);
            try {
              await act(startActivityNow(pick.activity.id));
            } finally {
              setBusy(false);
            }
          }}
        >
          {pick.kind === 'quest' ? 'Do it' : 'Add'}
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-muted">Core done — this is a bonus, never required.</p>
    </section>
  );
}

/** A window onto the world: your best room, and "you can build" only when something is actually affordable. */
export function WorldPreview() {
  const navigate = useNavigate();
  const player = useGame((s) => s.player);
  const buildings = useGame((s) => s.buildings);
  const { level } = useLevel();
  const now = useNow(60000);
  if (!player || !buildings.length) return null;
  const built = buildings.filter((b) => b.level > 0).sort((a, b) => b.level - a.level);
  const best = built[0];
  const affordable = buildings
    .filter((b) => b.level < b.maxLevel && b.unlockLevel <= level)
    .map((b) => ({ b, cost: buildingCostOf(b) }))
    .filter((x) => x.cost <= player.coins)
    .sort((a, b) => a.cost - b.cost)[0];
  return (
    <button type="button" onClick={() => navigate(affordable ? `/world?room=${affordable.b.id}` : '/world')} className="mt-3 block w-full overflow-hidden rounded-[24px] bg-surface text-left shadow-card" aria-label={affordable ? `You can build: ${affordable.b.name}` : 'Open your world'}>
      <div className="flex items-stretch">
        <div className="relative w-[42%] shrink-0">{best ? <RoomScene building={best} decorations={[]} height={96} hour={new Date(now).getHours()} /> : <div className="flex h-24 items-center justify-center bg-surface-2 text-[34px]">🏗️</div>}</div>
        <div className="min-w-0 flex-1 p-3.5">
          <div className="text-[12px] font-extrabold tracking-[0.16em] text-muted">YOUR WORLD</div>
          <div className="mt-0.5 truncate text-[15px] font-bold">{best ? `${best.name} · Lv ${best.level}` : 'Nothing built yet'}</div>
          {affordable ? (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[12px] font-bold text-success">🔨 You can build: {affordable.b.name}</div>
          ) : (
            <div className="mt-1 text-[12px] text-muted">
              {built.length}/{buildings.length} rooms built
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function buildingCostOf(b: { baseCost: number; costGrowth: number; level: number }) {
  return buildingCost(b, b.level + 1);
}

/** SEASON: a 30-day arc with cosmetic badges; permanent progress is never affected. */
export function SeasonCard() {
  const { data: s } = useAsync(() => loadSeason(), []);
  if (!s) return null;
  const prevPts = s.reached.at(-1)?.points ?? 0;
  const target = s.next?.points ?? prevPts;
  return (
    <section aria-label={`Season ${s.n}`} className="mt-3 rounded-[24px] bg-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[12px] font-extrabold tracking-[0.16em] text-muted">
          SEASON {String(s.n).padStart(2, '0')} · {s.name.toUpperCase()}
        </div>
        <span className="num shrink-0 text-[12px] text-muted">{s.daysLeft > 0 ? `${s.daysLeft} days left` : 'last day'}</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex shrink-0 gap-0.5 text-[18px]" aria-label={`${s.reached.length} of 4 season badges`}>
          {['🥉', '🥈', '🥇', '🏆'].map((icon, i) => (
            <span key={icon} className={i < s.reached.length ? '' : 'opacity-25 grayscale'} aria-hidden>
              {icon}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <ProgressBar value={s.next ? (s.points - prevPts) / Math.max(1, target - prevPts) : 1} height={6} color="var(--lf-xp)" />
          <div className="num mt-1 text-[12px] text-muted">{s.next ? `${s.points} / ${s.next.points} season points → ${s.next.badge}` : `${s.points} season points · all badges earned`}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * DAY COMPLETE: shown once, the first time the core is done and the score crosses the streak
 * line. Short and satisfying: score, XP, coins, streak.
 */
export function DayCompleteMoment() {
  const today = useGame((s) => s.today);
  const player = useGame((s) => s.player);
  const threshold = useGame((s) => (s.settings ? s.settings.rules.difficultyPresets[s.settings.difficulty].streakThreshold : 70));
  const [open, setOpen] = useState(false);
  const date = today?.date;
  const core = today ? tierCount(today.quests, 'core') : { done: 0, total: 0 };
  const score = today?.log?.score ?? 0;
  const strong = !!today && core.total > 0 && core.done === core.total && score >= threshold;
  useEffect(() => {
    if (!strong || !date) return;
    let alive = true;
    void metaRepository.get<string>('dayCompleteShown').then((shown) => {
      if (alive && shown !== date) {
        setOpen(true);
        void metaRepository.set('dayCompleteShown', date);
      }
    });
    return () => {
      alive = false;
    };
  }, [strong, date]);
  if (!today || !player) return null;
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Day complete">
      <div className="text-center">
        <div className="text-[44px]" aria-hidden>
          🏁
        </div>
        <div className="text-[13px] font-extrabold tracking-[0.18em] text-accent">DAY COMPLETE</div>
        <div className="num mt-1 text-[48px] leading-none font-black">{score}</div>
        <div className="text-[12px] text-muted">score · core {core.done}/{core.total}</div>
        <div className="num mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-surface-2 py-2.5">
            <div className="text-[18px] font-extrabold text-xp">+{today.log?.xp ?? 0}</div>
            <div className="text-[11px] text-muted">XP today</div>
          </div>
          <div className="rounded-2xl bg-surface-2 py-2.5">
            <div className="text-[18px] font-extrabold text-coin">+{today.log?.coins ?? 0}</div>
            <div className="text-[11px] text-muted">coins today</div>
          </div>
          <div className="rounded-2xl bg-surface-2 py-2.5">
            <div className="text-[18px] font-extrabold">🔥 {player.streak.current + (today.log?.success ? 0 : 1)}</div>
            <div className="text-[11px] text-muted">streak tonight</div>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-muted">Everything else today is a bonus. Rest counts too.</p>
        <Button block className="mt-3" onClick={() => setOpen(false)}>
          Nice
        </Button>
      </div>
    </Sheet>
  );
}

/** WEEK COMPLETE: once at the start of a new week, if last week had real days in it. */
export function WeekCompleteMoment() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useAsync(async () => {
    const today = clock.today();
    const lastWeekDay = shiftDate(weekStart(today), -1);
    const key = weekStart(lastWeekDay);
    if ((await metaRepository.get<string>('weekCompleteShown')) === key) return undefined;
    const start = await metaRepository.get<string>('adventureStart');
    if (!start || start > lastWeekDay) return undefined;
    const w = await weeklyReview(lastWeekDay);
    if (w.logs.filter((l) => l.closed).length < 2) return undefined;
    const best = [...w.logs].filter((l) => l.closed).sort((a, b) => b.score - a.score)[0];
    return { key, w, best };
  }, [], { live: false });
  useEffect(() => {
    if (data) {
      setOpen(true);
      void metaRepository.set('weekCompleteShown', data.key);
    }
  }, [data]);
  if (!data) return null;
  const { w, best } = data;
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Week complete">
      <div className="text-center">
        <div className="text-[13px] font-extrabold tracking-[0.18em] text-accent">WEEK COMPLETE</div>
        <div className="mt-1 text-[13px] text-muted">
          {formatDate(w.from, 'd MMM')} – {formatDate(w.to, 'd MMM')}
        </div>
      </div>
      <div className="num mt-3 grid grid-cols-2 gap-2">
        {[
          ['⭐', 'Best day', best ? `${formatDate(best.date, 'EEE')} · ${best.score}` : '—'],
          ['✨', 'XP', `+${w.xp.toLocaleString('en-US')}`],
          ['🪙', 'Coins', `+${w.coins.toLocaleString('en-US')}`],
          ['🏋️', 'Workouts', String(w.workouts)],
          ['✅', 'Successful days', `${w.logs.filter((l) => l.success).length}/7`],
          ['🏅', 'Achievements', String(w.achievements.length)],
        ].map(([icon, label, value]) => (
          <div key={label} className="rounded-2xl bg-surface-2 px-3 py-2.5">
            <div className="text-[12px] text-muted">
              {icon} {label}
            </div>
            <div className="text-[17px] font-extrabold">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(false);
            navigate('/review/week');
          }}
        >
          Full review
        </Button>
        <Button onClick={() => setOpen(false)}>NEXT WEEK</Button>
      </div>
    </Sheet>
  );
}

