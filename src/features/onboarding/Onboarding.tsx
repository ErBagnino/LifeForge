import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Avatar } from '@/components/game/Avatar';
import { Field, NumberInput, TextArea, TextInput, Toggle } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, cx } from '@/components/ui/primitives';
import { APP_CONFIG } from '@/config/app';
import { SEED_BUILDINGS } from '@/data/buildings';
import { DEFAULT_AVATAR } from '@/data/cosmetics';
import { blankWeek, summarizeSchedule, WEEK_ORDER, WEEKDAY_SHORT } from '@/domain/schedule';
import { activityRepository, playerRepository, settingsRepository, workoutRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { beginAdventure } from '@/services/game/dayService';
import { newSchedule } from '@/services/scheduleService';
import { useGame } from '@/store/gameStore';
import type { GameDifficulty, Knowledge, Settings, TimeHM, WorkDayEntry } from '@/types';
import { OptionalTime, WorkScheduleEditor, type WorkWeekValue } from '../settings/WorkScheduleEditor';
import { RoomScene } from '../world/RoomScene';

const GOALS = [
  ['strength', '💪 Get stronger'],
  ['fat_loss', '🔥 Lose fat'],
  ['muscle', '🏗️ Build muscle'],
  ['endurance', '🫀 Endurance'],
  ['routine', '🔁 Solid routines'],
  ['nofap', '🛡️ Quit porn / NoFap'],
  ['screen', '📵 Less screen time'],
  ['sleep', '😴 Better sleep'],
  ['nutrition', '🥗 Eat better'],
  ['order', '🧹 Tidy home'],
  ['learning', '📚 Learn & read'],
  ['mind', '🧘 Calmer mind'],
  ['pet', '🐾 Pet care'],
] as const;

const FITNESS_GOALS = new Set(['strength', 'fat_loss', 'muscle', 'endurance']);

const STEP_BANDS = [
  { id: 'low', label: 'Under 5k', ideal: 5000 },
  { id: 'mid', label: '5k – 8k', ideal: 6500 },
  { id: 'high', label: '8k – 10k', ideal: 8500 },
  { id: 'top', label: '10k+', ideal: 10000 },
] as const;

const HABITS = [
  { id: 'water', icon: '💧', label: 'Drink water', sub: '2.25 L a day, glass by glass', activities: ['drink_water'] },
  { id: 'nofap', icon: '🛡️', label: 'NoFap', sub: 'Daily check-in, private reminders', activities: ['nofap', 'urge_walk', 'urge_pushups', 'urge_cold'] },
  { id: 'play', icon: '🎮', label: 'Play time ≤ 1h30', sub: 'Games, TikTok, reels — calls with your partner never count', activities: [] },
  { id: 'teeth', icon: '🪥', label: 'Brush teeth', sub: 'Morning and night', activities: ['brush_am', 'brush_pm'] },
  { id: 'food', icon: '🥗', label: 'Log meals & protein', sub: 'Quick logging, photo optional', activities: ['log_meals', 'protein_target'] },
  { id: 'steps', icon: '👟', label: 'Daily steps', sub: 'A target that grows slowly', activities: ['hit_steps'] },
] as const;
type HabitId = (typeof HABITS)[number]['id'];

const DIFFICULTIES: { id: GameDifficulty; name: string; icon: string }[] = [
  { id: 'casual', name: 'Casual', icon: '🌱' },
  { id: 'normal', name: 'Normal', icon: '⚖️' },
  { id: 'hard', name: 'Hard', icon: '🔥' },
  { id: 'insane', name: 'Insane', icon: '💀' },
];

type WorkChoice = 'unknown' | 'add' | 'none';

interface Draft {
  nickname: string;
  petName: string;
  hasPet: boolean;
  height?: number;
  weight?: number;
  goals: string[];
  futureGoals: string;
  trainDays: number[];
  trainUnknown: boolean;
  wake?: TimeHM;
  sleep?: TimeHM;
  steps?: (typeof STEP_BANDS)[number]['id'];
  habits: Record<HabitId, boolean>;
  work?: WorkChoice;
  week: WorkWeekValue;
  difficulty: GameDifficulty;
}

function StepHeader({ icon, step, title, sub }: { icon: string; step: number; title: string; sub?: string }) {
  return (
    <div>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/12 text-[30px]" aria-hidden>
        {icon}
      </div>
      <div className="mt-4 text-[12px] font-extrabold tracking-[0.18em] text-accent">STEP {step} OF 7</div>
      <h2 className="mt-1 text-[26px] leading-tight font-extrabold tracking-tight text-balance">{title}</h2>
      {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
    </div>
  );
}

function BigNumber({ value, onChange, unit, step, min, max, label }: { value?: number; onChange: (v: number) => void; unit: string; step: number; min: number; max: number; label: string }) {
  const v = value ?? 0;
  const set = (x: number) => onChange(Math.min(max, Math.max(min, Math.round(x * 10) / 10)));
  return (
    <div className="mt-8 flex items-center justify-center gap-4">
      <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => set(v - step)} aria-label={`Decrease ${label}`} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface shadow-card">
        <Icon name="minus" size={22} />
      </motion.button>
      <div className="min-w-0 text-center">
        <NumberInput value={v} onChange={set} step={step} min={min} max={max} aria-label={label} className="!h-auto !border-0 !bg-transparent !p-0 text-center !text-[56px] leading-none font-extrabold" />
        <div className="text-[15px] font-semibold text-muted">{unit}</div>
      </div>
      <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => set(v + step)} aria-label={`Increase ${label}`} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface shadow-card">
        <Icon name="plus" size={22} />
      </motion.button>
    </div>
  );
}

function ChoiceCard({ icon, title, sub, active, onClick }: { icon: string; title: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      aria-pressed={active}
      className={cx('flex w-full items-center gap-3 rounded-3xl p-4 text-left', active ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}
    >
      <span className="text-[30px]" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[16px] font-extrabold tracking-wide uppercase">{title}</span>
        <span className={cx('block text-[13px]', active ? 'opacity-90' : 'text-muted')}>{sub}</span>
      </span>
    </motion.button>
  );
}

const StatusDot = ({ status }: { status: Knowledge | 'optional' }) => (
  <span
    className={cx(
      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide',
      status === 'set' ? 'bg-success/15 text-success' : status === 'optional' ? 'bg-surface-2 text-muted' : 'bg-warn/15 text-warn',
    )}
  >
    {status === 'set' ? 'SET' : status === 'optional' ? 'OPTIONAL' : 'NOT SET'}
  </span>
);

export default function Onboarding() {
  const initial = useGame((s) => s.settings)!;
  const boot = useGame((s) => s.boot);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<Draft>({
    nickname: initial.profile.nickname === 'Player' ? '' : initial.profile.nickname,
    petName: initial.profile.petName,
    hasPet: false,
    height: initial.body.heightCm,
    weight: initial.body.weightKg,
    goals: [],
    futureGoals: '',
    trainDays: [],
    trainUnknown: false,
    habits: { water: true, nofap: true, play: true, teeth: true, food: true, steps: true },
    week: { days: blankWeek({ kind: 'off' }), variable: false },
    difficulty: 'hard',
  });
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const TOTAL = 8;
  const next = () => setStep((s) => Math.min(TOTAL, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const workDays: WorkDayEntry[] = d.work === 'add' ? d.week.days : d.work === 'none' ? blankWeek({ kind: 'off' }) : blankWeek();
  const hasWorkInfo = d.work === 'none' || (d.work === 'add' && d.week.days.some((x) => x.kind !== 'off'));

  async function finish() {
    setBusy(true);
    const today = clock.today();
    const band = STEP_BANDS.find((b) => b.id === d.steps);
    const s: Settings = {
      ...initial,
      profile: {
        ...initial.profile,
        nickname: d.nickname.trim(),
        name: d.nickname.trim(),
        petName: d.hasPet ? d.petName.trim() || 'Sky' : initial.profile.petName,
        goals: d.goals,
        fitnessGoals: d.goals.filter((g) => FITNESS_GOALS.has(g)),
        futureGoals: d.futureGoals.trim() || undefined,
      },
      body: {
        ...initial.body,
        heightCm: d.height ?? initial.body.heightCm,
        weightKg: d.weight ?? initial.body.weightKg,
        goal: d.goals.includes('fat_loss') ? 'lose' : d.goals.includes('muscle') ? 'gain' : initial.body.goal,
      },
      steps: band ? { min: Math.round((band.ideal * 0.85) / 250) * 250, ideal: band.ideal, stretch: Math.round((band.ideal * 1.3) / 250) * 250 } : initial.steps,
      schedule: {
        ...initial.schedule,
        wake: d.wake ?? initial.schedule.wake,
        sleep: d.sleep ?? initial.schedule.sleep,
        days: initial.schedule.days.map((day, i) => ({ ...day, trainingAvailable: d.trainUnknown || !d.trainDays.length || d.trainDays.includes(i) })),
      },
      known: {
        ...initial.known,
        height: d.height ? 'set' : 'not_set',
        weight: d.weight ? 'set' : 'not_set',
        goals: d.goals.length ? 'set' : 'not_set',
        training: d.trainUnknown ? 'unknown' : d.trainDays.length ? 'set' : 'not_set',
        wake: d.wake ? 'set' : 'unknown',
        sleep: d.sleep ? 'set' : 'unknown',
        steps: band ? 'set' : 'unknown',
      },
      work:
        d.work === 'add' || d.work === 'none'
          ? { status: 'set', schedules: [newSchedule(workDays, today, 'onboarding', { variable: d.work === 'add' && d.week.variable })] }
          : { status: d.work === 'unknown' ? 'unknown' : 'not_set', schedules: [] },
      leisure: { ...initial.leisure, enabled: d.habits.play },
      tracking: { ...initial.tracking, nutrition: d.habits.food },
      difficulty: d.difficulty,
      onboarded: true,
    };
    await settingsRepository.save(s);
    const player = await playerRepository.get();
    if (player) await playerRepository.save({ ...player, name: s.profile.nickname });

    // Habits the player switched off are simply not tracked (they can be re-enabled in Admin).
    for (const h of HABITS) {
      for (const id of h.activities) {
        const a = await activityRepository.get(id);
        if (a && a.active !== d.habits[h.id]) await activityRepository.put({ ...a, active: d.habits[h.id], updatedAt: Date.now() });
      }
    }
    // No pet, no pet-care quests.
    for (const a of (await activityRepository.all()).filter((x) => x.category === 'animal_care')) {
      if (a.active !== d.hasPet) await activityRepository.put({ ...a, active: d.hasPet, updatedAt: Date.now() });
    }

    // Map the 3-day program onto the chosen days, or make it flexible.
    const plan = await workoutRepository.activePlan();
    if (plan) {
      const sorted = [...d.trainDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const templates = plan.templates.map((t, i) => ({ ...t, weekday: d.trainUnknown || !sorted.length ? null : i < sorted.length ? sorted[i] : null }));
      await workoutRepository.plans.put({ ...plan, templates });
    }
    await beginAdventure();
    await boot();
  }

  const canContinue = step !== 1 || !!d.nickname.trim();
  const footer: { primary: ReactNode; secondary?: ReactNode } = (() => {
    const cont = (label = 'Continue', disabled = !canContinue) => (
      <Button block size="lg" onClick={next} disabled={disabled}>
        {label}
      </Button>
    );
    const skip = (label: string, onClick: () => void) => (
      <Button block variant="ghost" onClick={onClick}>
        {label}
      </Button>
    );
    switch (step) {
      case 0:
        return { primary: cont('Start') };
      case 2:
        return { primary: cont(), secondary: skip('Skip for now', () => (patch({ height: undefined }), next())) };
      case 3:
        return { primary: cont(), secondary: skip('Skip for now', () => (patch({ weight: undefined }), next())) };
      case 4:
        return { primary: cont(d.goals.length ? 'Continue' : 'Decide later', false) };
      case 5:
        return { primary: cont('Continue', !d.trainDays.length && !d.trainUnknown), secondary: skip('Not sure yet', () => (patch({ trainUnknown: true, trainDays: [] }), next())) };
      case 7:
        return { primary: cont('Continue', !d.work) };
      case 8:
        return {
          primary: (
            <Button block size="lg" loading={busy} onClick={() => void finish()}>
              Start my first quest
            </Button>
          ),
        };
      default:
        return { primary: cont() };
    }
  })();

  const slides: ReactNode[] = [
    // 0 — welcome
    <div key="w" className="flex flex-1 flex-col items-center justify-center text-center">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-[12px] font-black tracking-[0.3em] text-accent">
        WELCOME TO {APP_CONFIG.name}
      </motion.div>
      <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }} className="mt-6">
        <Avatar config={DEFAULT_AVATAR} size={120} ring="var(--lf-accent)" />
      </motion.div>
      <h1 className="mt-6 text-[32px] leading-tight font-extrabold tracking-tight text-balance">Let’s build your character.</h1>
      <p className="mt-3 max-w-[300px] text-[15px] text-muted">Seven quick questions. Anything you don’t know yet can stay empty — the game adapts as it learns.</p>
    </div>,

    // 1 — name
    <div key="n">
      <StepHeader icon="🧍" step={1} title="What should the game call you?" />
      <div className="mt-6 space-y-4">
        <TextInput value={d.nickname} onChange={(v) => patch({ nickname: v })} placeholder="Your name or nickname" autoFocus aria-label="Nickname" maxLength={24} className="!h-14 !text-[20px] font-semibold" />
        <div className="flex items-center gap-3 rounded-3xl bg-surface p-4 shadow-card">
          <span className="text-[24px]">🐾</span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">I have a pet</div>
            <div className="text-[12px] text-muted">Optional · adds pet-care quests</div>
          </div>
          <Toggle checked={d.hasPet} onChange={(v) => patch({ hasPet: v })} label="I have a pet" />
        </div>
        {d.hasPet && (
          <Field label="Pet’s name">
            <TextInput value={d.petName} onChange={(v) => patch({ petName: v })} placeholder="Sky" aria-label="Pet name" maxLength={20} />
          </Field>
        )}
      </div>
    </div>,

    // 2 — height
    <div key="h">
      <StepHeader icon="📏" step={2} title="How tall are you?" sub="Used for nutrition targets. Skip it if you’d rather not say." />
      <BigNumber value={d.height} onChange={(v) => patch({ height: v })} unit="cm" step={1} min={120} max={230} label="Height" />
    </div>,

    // 3 — weight
    <div key="kg">
      <StepHeader icon="⚖️" step={3} title="And your weight?" sub="A starting point, not a judgement. Trends matter, single days don’t." />
      <BigNumber value={d.weight} onChange={(v) => patch({ weight: v })} unit="kg" step={0.5} min={35} max={250} label="Weight" />
    </div>,

    // 4 — goals
    <div key="g">
      <StepHeader icon="🎯" step={4} title="Main goals" sub="Pick what matters now. You can change it any time — or just tell the Coach." />
      <div className="mt-5 flex flex-wrap gap-2">
        {GOALS.map(([id, label]) => {
          const on = d.goals.includes(id);
          return (
            <motion.button
              key={id}
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => patch({ goals: toggle(d.goals, id) })}
              aria-pressed={on}
              className={cx('h-11 rounded-full px-4 text-[15px] font-semibold', on ? 'bg-accent text-on-accent' : 'bg-surface text-fg shadow-card')}
            >
              {label}
            </motion.button>
          );
        })}
      </div>
      <Field label="Something bigger on the horizon? (optional)">
        <TextArea value={d.futureGoals} onChange={(v) => patch({ futureGoals: v })} rows={2} placeholder="e.g. run a 10k next spring" aria-label="Future goals" />
      </Field>
    </div>,

    // 5 — workout availability
    <div key="t">
      <StepHeader icon="🏋️" step={5} title="When can you train?" sub="Your program: Upper A · Lower + Core · Upper B. Not sure? The plan goes flexible — train when a day allows it." />
      <div className="mt-6 grid grid-cols-7 gap-1.5">
        {WEEK_ORDER.map((i) => {
          const on = d.trainDays.includes(i);
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ trainDays: toggle(d.trainDays, i), trainUnknown: false })}
              className={cx('h-14 min-w-0 rounded-2xl text-[14px] font-bold', on ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}
            >
              {WEEKDAY_SHORT[i]}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-muted">
        {d.trainUnknown ? 'Flexible plan selected.' : d.trainDays.length ? `${d.trainDays.length} day${d.trainDays.length === 1 ? '' : 's'} · at least one rest day stays protected.` : 'Tap the days you can usually make it.'}
      </p>
    </div>,

    // 6 — daily habits
    <div key="dh">
      <StepHeader icon="🌅" step={6} title="Daily habits" sub="Your rhythm and what the game should track. Times are optional." />
      <div className="mt-5 space-y-2 rounded-3xl bg-surface p-3 shadow-card">
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-[15px] font-semibold">Wake up</span>
          <OptionalTime value={d.wake} onChange={(v) => patch({ wake: v })} label="Wake time" placeholder="Not sure yet" />
        </div>
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-[15px] font-semibold">Bedtime</span>
          <OptionalTime value={d.sleep} onChange={(v) => patch({ sleep: v })} label="Bed time" placeholder="Not sure yet" />
        </div>
      </div>
      <div className="mt-4 text-[13px] font-semibold text-muted">Steps on a normal day</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {[...STEP_BANDS.map((b) => [b.id, b.label] as const), ['unsure', 'Not sure'] as const].map(([id, label]) => {
          const on = (d.steps ?? 'unsure') === id;
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => patch({ steps: id === 'unsure' ? undefined : (id as Draft['steps']) })} className={cx('h-11 rounded-full px-4 text-[14px] font-semibold', on ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}>
              {label}
            </button>
          );
        })}
      </div>
      <div className="mt-4 divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
        {HABITS.map((h) => (
          <div key={h.id} className="flex items-center gap-3 px-4 py-3">
            <span className="text-[22px]" aria-hidden>
              {h.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{h.label}</div>
              <div className="text-[12px] text-muted">{h.sub}</div>
            </div>
            <Toggle checked={d.habits[h.id]} onChange={(v) => patch({ habits: { ...d.habits, [h.id]: v } })} label={h.label} />
          </div>
        ))}
      </div>
    </div>,

    // 7 — work schedule
    <div key="wk">
      <StepHeader icon="💼" step={7} title="Work schedule" sub="Only if you know it. Hours can be added later — in Settings or by telling the Coach." />
      <div className="mt-5 space-y-2">
        <ChoiceCard icon="🤷" title="I don’t know yet" sub="No problem. I’ll plan with what I know." active={d.work === 'unknown'} onClick={() => patch({ work: 'unknown' })} />
        <ChoiceCard icon="🗓️" title="I’ll add it" sub="Days and hours — leave anything you’re unsure about empty." active={d.work === 'add'} onClick={() => patch({ work: 'add' })} />
        <ChoiceCard icon="🌴" title="I don’t work right now" sub="Every day counts as free time." active={d.work === 'none'} onClick={() => patch({ work: 'none' })} />
      </div>
      {d.work === 'add' && (
        <div className="mt-4">
          <WorkScheduleEditor value={d.week} onChange={(week) => patch({ week })} />
        </div>
      )}
    </div>,

    // 8 — ready
    <div key="r" className="flex flex-1 flex-col items-center text-center">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-[12px] font-black tracking-[0.3em] text-accent">
        CHARACTER READY
      </motion.div>
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.15 }} className="mt-4">
        <Avatar config={DEFAULT_AVATAR} size={96} ring="var(--lf-accent)" />
      </motion.div>
      <div className="mt-2 text-[24px] font-extrabold">{d.nickname || 'Player'}</div>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mt-4 w-full overflow-hidden rounded-3xl shadow-card">
        <RoomScene building={{ ...SEED_BUILDINGS[0], level: 1 }} decorations={[]} height={112} showAvatar avatar={DEFAULT_AVATAR} />
      </motion.div>
      <div className="mt-4 w-full divide-y divide-line overflow-hidden rounded-3xl bg-surface text-left shadow-card">
        {(
          [
            ['Height', d.height ? `${d.height} cm` : '—', d.height ? 'set' : 'not_set'],
            ['Weight', d.weight ? `${d.weight} kg` : '—', d.weight ? 'set' : 'not_set'],
            ['Training', d.trainUnknown ? 'Flexible' : d.trainDays.length ? WEEK_ORDER.filter((i) => d.trainDays.includes(i)).map((i) => WEEKDAY_SHORT[i]).join(' ') : '—', d.trainUnknown ? 'unknown' : d.trainDays.length ? 'set' : 'not_set'],
            ['Work', hasWorkInfo ? (d.work === 'none' ? 'No work' : summarizeSchedule(workDays)[0]) : 'Add it any time', hasWorkInfo ? 'set' : 'not_set'],
          ] as const
        ).map(([k, v, st]) => (
          <div key={k} className="flex items-center gap-2 px-4 py-2.5">
            <span className="w-20 shrink-0 text-[14px] text-muted">{k}</span>
            <span className="num min-w-0 flex-1 truncate text-[15px] font-semibold">{v}</span>
            <StatusDot status={st as Knowledge} />
          </div>
        ))}
      </div>
      <div className="mt-4 w-full text-left">
        <div className="text-[13px] font-semibold text-muted">Difficulty</div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {DIFFICULTIES.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={d.difficulty === x.id}
              onClick={() => patch({ difficulty: x.id })}
              className={cx('flex h-16 min-w-0 flex-col items-center justify-center rounded-2xl text-[13px] font-bold', d.difficulty === x.id ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}
            >
              <span className="text-[20px]" aria-hidden>
                {x.icon}
              </span>
              {x.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">Hard is the default: demanding but fair, and always adaptive.</p>
      </div>
    </div>,
  ];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-safe pt-[calc(var(--safe-top)+12px)]">
      {step > 0 && (
        <div className="flex h-11 items-center gap-3">
          <button type="button" onClick={back} className="-ml-2 flex h-11 items-center gap-0.5 pr-2 text-[16px] text-accent" aria-label="Back">
            <Icon name="chevronLeft" size={24} /> Back
          </button>
          <div className="flex flex-1 gap-1" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className={cx('h-1.5 flex-1 rounded-full transition-colors', i < step ? 'bg-accent' : 'bg-surface-3')} />
            ))}
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={step} className="flex flex-1 flex-col pt-4 pb-6" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
          {slides[step]}
        </motion.div>
      </AnimatePresence>
      <div className="pb-kb sticky bottom-0 z-20 -mx-4 bg-gradient-to-t from-bg via-bg to-transparent px-4 pt-4">
        {footer.primary}
        {footer.secondary && <div className="mt-1">{footer.secondary}</div>}
      </div>
    </div>
  );
}
