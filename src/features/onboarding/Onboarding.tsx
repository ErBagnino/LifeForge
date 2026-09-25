import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Avatar } from '@/components/game/Avatar';
import { Field, NumberInput, TextInput, TimeInput, Toggle } from '@/components/ui/forms';
import { Button, Card, cx } from '@/components/ui/primitives';
import { APP_CONFIG } from '@/config/app';
import { playerRepository, settingsRepository, workoutRepository } from '@/repositories';
import { beginAdventure } from '@/services/game/dayService';
import { notificationService } from '@/services/notifications/NotificationService';
import { useGame } from '@/store/gameStore';
import type { GameDifficulty, Settings } from '@/types';
import { RoomScene } from '../world/RoomScene';
import { SEED_BUILDINGS } from '@/data/buildings';
import { DEFAULT_AVATAR } from '@/data/cosmetics';

const GOALS = [
  ['fitness', '🏋️ Get fit'],
  ['fat_loss', '🔥 Lose fat'],
  ['strength', '💪 Get stronger'],
  ['routine', '🔁 Solid routines'],
  ['order', '🧹 Tidy home'],
  ['learning', '📚 Learn & read'],
  ['pet', '🐾 Pet care'],
  ['sleep', '😴 Better sleep'],
  ['nutrition', '🥗 Eat better'],
  ['screen', '📵 Less screen time'],
  ['mind', '🧘 Calmer mind'],
] as const;

const FITNESS = [
  ['strength', '💪 Strength'],
  ['fat_loss', '🔥 Fat loss'],
  ['endurance', '🫀 Endurance'],
  ['mobility', '🤸 Mobility'],
  ['health', '🍏 General health'],
] as const;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DIFFICULTIES: { id: GameDifficulty; name: string; icon: string; text: string }[] = [
  { id: 'casual', name: 'Casual', icon: '🌱', text: 'Gentle penalties, lower streak line. Good for restarting.' },
  { id: 'normal', name: 'Normal', icon: '⚖️', text: 'Balanced rewards and consequences.' },
  { id: 'hard', name: 'Hard', icon: '🔥', text: 'Demanding but fair. Recommended — the point is to push you.' },
  { id: 'insane', name: 'Insane', icon: '💀', text: 'Big rewards, sharp consequences. Still never unsafe.' },
];

function Chips<T extends string>({ items, selected, onToggle }: { items: readonly (readonly [T, string])[]; selected: T[]; onToggle: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([id, label]) => {
        const on = selected.includes(id);
        return (
          <motion.button
            key={id}
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => onToggle(id)}
            aria-pressed={on}
            className={cx('h-11 rounded-full px-4 text-[15px] font-semibold', on ? 'bg-accent text-on-accent' : 'bg-surface text-fg shadow-card')}
          >
            {label}
          </motion.button>
        );
      })}
    </div>
  );
}

export default function Onboarding() {
  const initial = useGame((s) => s.settings)!;
  const boot = useGame((s) => s.boot);
  const [step, setStep] = useState(0);
  const [s, setS] = useState<Settings>(initial);
  const [workDays, setWorkDays] = useState<number[]>(initial.schedule.days.map((d, i) => (d.type === 'work' ? i : -1)).filter((i) => i >= 0));
  const [trainDays, setTrainDays] = useState<number[]>([1, 3, 5]);
  const [work, setWork] = useState({ start: '09:00', end: '19:00' });
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = 9;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const next = () => setStep((x) => x + 1);
  const back = () => setStep((x) => Math.max(0, x - 1));

  async function finish() {
    setBusy(true);
    const days = s.schedule.days.map((d, i) => ({
      ...d,
      type: workDays.includes(i) ? ('work' as const) : ('free' as const),
      work: workDays.includes(i) ? { ...work, label: 'Work' } : undefined,
      trainingAvailable: trainDays.includes(i) || !workDays.includes(i),
    }));
    const next: Settings = { ...s, schedule: { ...s.schedule, days }, notifications: { ...s.notifications, enabled: notify }, onboarded: true };
    await settingsRepository.save(next);
    const player = await playerRepository.get();
    if (player) await playerRepository.save({ ...player, name: s.profile.nickname || s.profile.name });
    // Map the 3-day plan onto the chosen training days.
    const plan = await workoutRepository.activePlan();
    if (plan && trainDays.length) {
      const sorted = [...trainDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const templates = plan.templates.map((t, i) => ({ ...t, weekday: sorted.length ? sorted[i % sorted.length] : t.weekday }));
      await workoutRepository.plans.put({ ...plan, templates: sorted.length >= plan.templates.length ? templates : plan.templates.map((t, i) => ({ ...t, weekday: i < sorted.length ? sorted[i] : null })) });
    }
    await beginAdventure();
    await boot();
  }

  const slides = [
    // 0 welcome
    <div key="w" className="flex flex-1 flex-col items-center justify-center text-center">
      <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 12 }} className="text-[92px]">
        ⚒️
      </motion.div>
      <h1 className="mt-4 text-[38px] font-black tracking-[0.12em]">{APP_CONFIG.name}</h1>
      <p className="mt-2 text-[18px] text-muted">{APP_CONFIG.tagline}</p>
      <p className="mt-6 max-w-xs text-[15px] text-muted">Real activities become quests. Quests become XP, coins and a world you build. Two minutes of setup and you’re in.</p>
    </div>,
    // 1 name
    <div key="n">
      <h2 className="text-[28px] font-extrabold">What should the game call you?</h2>
      <div className="mt-6 space-y-4">
        <Field label="Nickname">
          <TextInput value={s.profile.nickname} onChange={(v) => setS({ ...s, profile: { ...s.profile, nickname: v, name: v } })} placeholder="e.g. Ale" autoFocus aria-label="Nickname" maxLength={24} />
        </Field>
        <Field label="Your pet’s name (for care quests)" hint="Used in quests like “Change Sky’s water”. Change it any time.">
          <TextInput value={s.profile.petName} onChange={(v) => setS({ ...s, profile: { ...s.profile, petName: v || 'Sky' } })} placeholder="Sky" aria-label="Pet name" maxLength={20} />
        </Field>
      </div>
    </div>,
    // 2 goals
    <div key="g">
      <h2 className="text-[28px] font-extrabold">What are you playing for?</h2>
      <p className="mt-1 text-[15px] text-muted">Pick everything that matters. It tunes side quests and challenges.</p>
      <div className="mt-6">
        <Chips items={GOALS} selected={s.profile.goals as never[]} onToggle={(v) => setS({ ...s, profile: { ...s.profile, goals: toggle(s.profile.goals, v) } })} />
      </div>
    </div>,
    // 3 schedule
    <div key="s">
      <h2 className="text-[28px] font-extrabold">Your typical day</h2>
      <p className="mt-1 text-[15px] text-muted">The game only schedules quests when you’re actually awake and free.</p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Field label="Wake up">
          <TimeInput value={s.schedule.wake} onChange={(v) => setS({ ...s, schedule: { ...s.schedule, wake: v } })} aria-label="Wake up time" />
        </Field>
        <Field label="Go to bed">
          <TimeInput value={s.schedule.sleep} onChange={(v) => setS({ ...s, schedule: { ...s.schedule, sleep: v } })} aria-label="Bed time" />
        </Field>
      </div>
      <Field label="New day starts at" hint="Late-night activities before this hour still count for the previous day.">
        <div className="mt-1 flex gap-2">
          {[3, 4, 5, 6].map((h) => (
            <Button key={h} variant={s.dayStartHour === h ? 'primary' : 'secondary'} className="flex-1" onClick={() => setS({ ...s, dayStartHour: h })}>
              {h}:00
            </Button>
          ))}
        </div>
      </Field>
    </div>,
    // 4 work
    <div key="wk">
      <h2 className="text-[28px] font-extrabold">Work hours</h2>
      <p className="mt-1 text-[15px] text-muted">A 10-hour workday gets 3–5 realistic core quests — not a second job.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {DAYS.map((d, i) => (
          <button key={d} type="button" aria-pressed={workDays.includes(i)} onClick={() => setWorkDays(toggle(workDays, i))} className={cx('h-12 w-12 rounded-2xl text-[14px] font-bold', workDays.includes(i) ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}>
            {d}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Start">
          <TimeInput value={work.start} onChange={(v) => setWork({ ...work, start: v })} aria-label="Work start" />
        </Field>
        <Field label="End">
          <TimeInput value={work.end} onChange={(v) => setWork({ ...work, end: v })} aria-label="Work end" />
        </Field>
      </div>
    </div>,
    // 5 fitness
    <div key="f">
      <h2 className="text-[28px] font-extrabold">Fitness goals</h2>
      <div className="mt-6">
        <Chips items={FITNESS} selected={s.profile.fitnessGoals as never[]} onToggle={(v) => setS({ ...s, profile: { ...s.profile, fitnessGoals: toggle(s.profile.fitnessGoals, v) } })} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Field label="Weight (kg)">
          <NumberInput value={s.body.weightKg} onChange={(v) => setS({ ...s, body: { ...s.body, weightKg: v } })} step={0.1} aria-label="Weight" />
        </Field>
        <Field label="Height (cm)">
          <NumberInput value={s.body.heightCm} onChange={(v) => setS({ ...s, body: { ...s.body, heightCm: v } })} aria-label="Height" />
        </Field>
      </div>
      <p className="mt-3 text-[12px] text-muted">Starting targets (1800 kcal · 150 g protein · 2–2.5 L water) are editable settings, not medical advice.</p>
    </div>,
    // 6 available days
    <div key="d">
      <h2 className="text-[28px] font-extrabold">Training days</h2>
      <p className="mt-1 text-[15px] text-muted">Your program: Upper A · Lower + Core · Upper B. Pick the days you can train.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {DAYS.map((d, i) => (
          <button key={d} type="button" aria-pressed={trainDays.includes(i)} onClick={() => setTrainDays(toggle(trainDays, i))} className={cx('h-12 w-12 rounded-2xl text-[14px] font-bold', trainDays.includes(i) ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}>
            {d}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[13px] text-muted">{trainDays.length} day{trainDays.length === 1 ? '' : 's'} selected · at least 1 rest day per week is kept by the safety rules.</p>
    </div>,
    // 7 notifications
    <div key="nt">
      <h2 className="text-[28px] font-extrabold">Reminders</h2>
      <p className="mt-1 text-[15px] text-muted">Smart, rare, learned from your habits. A frequency governor keeps it to a few per day, never during quiet hours.</p>
      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-semibold">Enable reminders</span>
          <Toggle
            checked={notify}
            label="Enable reminders"
            onChange={async (v) => {
              setNotify(v);
              if (v) await notificationService.requestPermission();
            }}
          />
        </div>
        {notificationService.status().isIos && !notificationService.status().standalone && (
          <p className="mt-3 text-[13px] text-muted">On iPhone, system notifications work after adding the app to your Home Screen (Share → Add to Home Screen). In-app reminders work everywhere.</p>
        )}
      </Card>
    </div>,
    // 8 difficulty
    <div key="df">
      <h2 className="text-[28px] font-extrabold">Choose difficulty</h2>
      <p className="mt-1 text-[15px] text-muted">Adaptive either way: the game backs off on heavy days and pushes when it’s too easy.</p>
      <div className="mt-5 space-y-2">
        {DIFFICULTIES.map((d) => (
          <motion.button
            key={d.id}
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => setS({ ...s, difficulty: d.id })}
            aria-pressed={s.difficulty === d.id}
            className={cx('flex w-full items-center gap-3 rounded-3xl p-4 text-left', s.difficulty === d.id ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}
          >
            <span className="text-[30px]">{d.icon}</span>
            <span>
              <span className="block text-[17px] font-bold uppercase">
                {d.name}
                {d.id === 'hard' && <span className="ml-2 text-[11px] opacity-80">DEFAULT</span>}
              </span>
              <span className={cx('block text-[13px]', s.difficulty === d.id ? 'opacity-90' : 'text-muted')}>{d.text}</span>
            </span>
          </motion.button>
        ))}
      </div>
    </div>,
    // 9 reveal
    <div key="r" className="flex flex-1 flex-col items-center justify-center text-center">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-[13px] font-black tracking-[0.3em] text-accent">
        WELCOME TO {APP_CONFIG.name}
      </motion.div>
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }} className="mt-5">
        <Avatar config={DEFAULT_AVATAR} size={110} ring="var(--lf-accent)" />
      </motion.div>
      <div className="mt-3 text-[26px] font-extrabold">{s.profile.nickname || 'Player'}</div>
      <div className="mt-3 grid w-full max-w-xs grid-cols-4 gap-2">
        {[
          ['LV', '1'],
          ['❤️', '100'],
          ['⚡', '100'],
          ['🪙', '0'],
        ].map(([k, v], i) => (
          <motion.div key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.1 }} className="rounded-2xl bg-surface py-2 shadow-card">
            <div className="text-[12px] text-muted">{k}</div>
            <div className="num text-[18px] font-extrabold">{v}</div>
          </motion.div>
        ))}
      </div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="mt-5 w-full max-w-xs overflow-hidden rounded-3xl shadow-card">
        <RoomScene building={{ ...SEED_BUILDINGS[0], level: 1 }} decorations={[]} height={120} showAvatar avatar={DEFAULT_AVATAR} />
      </motion.div>
      <p className="mt-3 text-[14px] text-muted">Your first room. Everything else is built with real-life coins.</p>
    </div>,
  ];

  const isLast = step === total;
  return (
    <div className="flex min-h-full flex-col px-safe pt-[calc(var(--safe-top)+16px)] pb-[calc(var(--safe-bottom)+16px)]">
      {step > 0 && step < total && (
        <div className="mb-6 flex items-center gap-3">
          <button type="button" onClick={back} className="h-10 text-[16px] text-accent" aria-label="Back">
            ‹ Back
          </button>
          <div className="flex flex-1 gap-1">
            {Array.from({ length: total - 1 }, (_, i) => (
              <div key={i} className={cx('h-1.5 flex-1 rounded-full', i < step ? 'bg-accent' : 'bg-surface-3')} />
            ))}
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={step} className="flex flex-1 flex-col" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.22 }}>
          {slides[step]}
        </motion.div>
      </AnimatePresence>
      <div className="mt-6">
        {isLast ? (
          <Button block size="lg" loading={busy} onClick={() => void finish()}>
            Start my first quest
          </Button>
        ) : (
          <Button block size="lg" onClick={next} disabled={step === 1 && !s.profile.nickname.trim()}>
            {step === 0 ? 'Start' : 'Continue'}
          </Button>
        )}
      </div>
    </div>
  );
}
