import { useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Field, List, NumberInput, Row, Segmented, Select, TextInput, TimeInput, Toggle } from '@/components/ui/forms';
import { Button, Card, Chip, SectionTitle } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/Sheet';
import { ACCENTS } from '@/data/cosmetics';
import { useAsync, useLevel } from '@/hooks';
import { tycoonRepository } from '@/repositories';
import { saveSettings } from '@/services/adminService';
import { clock } from '@/services/clock';
import { exportToFile, importData, readFileAsJson, validateImport, wipeAllData, type ValidationResult } from '@/services/exportService';
import { rebuildDay } from '@/services/game/dayService';
import { devTestNotification } from '@/services/devService';
import { notificationService } from '@/services/notifications/NotificationService';
import { rescheduleReminders } from '@/services/notifications/reminderScheduler';
import { useGame } from '@/store/gameStore';
import { SchedulePanel } from './SchedulePanel';
import { AiPanel } from './AiPanel';
import { RoutinePanel } from './RoutinePanel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { goalLabel, profileFields } from '@/domain/profile';
import type { CoachTone, GameDifficulty, NotificationType, Settings, ThemeMode } from '@/types';

function useSettingsUpdater() {
  const settings = useGame((s) => s.settings)!;
  const refresh = useGame((s) => s.refresh);
  return {
    settings,
    update: async (patch: Partial<Settings>) => {
      await saveSettings({ ...settings, ...patch });
      await refresh();
    },
  };
}

function ToggleRow({ title, subtitle, checked, onChange }: { title: string; subtitle?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <Row title={title} subtitle={subtitle} right={<Toggle checked={checked} onChange={onChange} label={title} />} />;
}

const TITLES: Record<string, string> = {
  profile: 'Profile',
  appearance: 'Appearance',
  game: 'Game',
  schedule: 'Schedule',
  targets: 'Targets',
  safety: 'Safety bounds',
  notifications: 'Notifications',
  data: 'Data',
  coach: 'AI',
  ai: 'AI',
  routine: 'Daily Routine',
};

export default function SettingsSection() {
  const { section = '' } = useParams();
  const settings = useGame((s) => s.settings);
  if (!settings) return null;
  const panels: Record<string, ReactNode> = {
    profile: <ProfilePanel />,
    appearance: <AppearancePanel />,
    game: <GamePanel />,
    schedule: <SchedulePanel />,
    targets: <TargetsPanel />,
    safety: <SafetyPanel />,
    notifications: <NotificationsPanel />,
    data: <DataPanel />,
    coach: <AiPanel />,
    ai: <AiPanel />,
    routine: <RoutinePanel />,
  };
  return (
    <Screen back="/settings" title={TITLES[section] ?? 'Settings'}>
      {panels[section] ?? <p className="text-muted">Unknown section.</p>}
    </Screen>
  );
}

const GOAL_CHOICES = ['strength', 'fat_loss', 'muscle', 'endurance', 'routine', 'nofap', 'screen', 'sleep', 'nutrition', 'order', 'learning', 'mind', 'pet'];
const FITNESS_GOAL_IDS = new Set(['strength', 'fat_loss', 'muscle', 'endurance']);

function ProfilePanel() {
  const { settings, update } = useSettingsUpdater();
  const navigate = useNavigate();
  const [p, setP] = useState(settings.profile);
  const fields = profileFields(settings, clock.today());
  const toggleGoal = (g: string) => setP({ ...p, goals: p.goals.includes(g) ? p.goals.filter((x) => x !== g) : [...p.goals, g] });
  return (
    <div className="mt-3">
      <List title="Your info" footer="Not set is fine — the game works with what it knows. Add things when they become useful, here or by telling the Coach.">
        {fields.map((f) => (
          <Row
            key={f.key}
            icon={f.icon}
            title={f.label}
            subtitle={f.status === 'not_set' && f.hint ? `${f.value} · ${f.hint}` : f.value}
            right={<StatusBadge status={f.status} />}
            onClick={f.edit === 'profile' ? undefined : () => navigate(`/settings/${f.edit}`)}
          />
        ))}
      </List>

      <SectionTitle>Edit profile</SectionTitle>
      <div className="space-y-3">
        <Field label="Nickname">
          <TextInput value={p.nickname} onChange={(v) => setP({ ...p, nickname: v, name: v })} aria-label="Nickname" />
        </Field>
        <Field label="Main goals">
          <div className="flex flex-wrap gap-2">
            {GOAL_CHOICES.map((g) => (
              <button key={g} type="button" aria-pressed={p.goals.includes(g)} onClick={() => toggleGoal(g)} className={p.goals.includes(g) ? 'h-11 rounded-full bg-accent px-4 text-[14px] font-semibold text-on-accent' : 'h-11 rounded-full bg-surface px-4 text-[14px] font-semibold shadow-card'}>
                {goalLabel(g)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Future goals (optional)">
          <TextInput value={p.futureGoals ?? ''} onChange={(v) => setP({ ...p, futureGoals: v })} placeholder="e.g. run a 10k next spring" aria-label="Future goals" />
        </Field>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field label="Pet name">
            <TextInput value={p.petName} onChange={(v) => setP({ ...p, petName: v })} aria-label="Pet name" />
          </Field>
          <Field label="Pet icon">
            <TextInput value={p.petEmoji} onChange={(v) => setP({ ...p, petEmoji: v.slice(0, 4) })} aria-label="Pet emoji" />
          </Field>
        </div>
        <Button
          block
          size="lg"
          onClick={() =>
            void update({
              profile: { ...p, petName: p.petName.trim() || 'Sky', futureGoals: p.futureGoals?.trim() || undefined, fitnessGoals: p.goals.filter((g) => FITNESS_GOAL_IDS.has(g)) },
              known: { ...settings.known, goals: p.goals.length ? 'set' : 'not_set' },
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function AppearancePanel() {
  const { settings, update } = useSettingsUpdater();
  const { level } = useLevel();
  const { data: themes } = useAsync(async () => (await tycoonRepository.cosmetics.all()).filter((c) => c.type === 'theme'), []);
  return (
    <>
      <SectionTitle>Theme</SectionTitle>
      <Segmented<ThemeMode>
        value={settings.theme}
        onChange={(v) => void update({ theme: v })}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
      <SectionTitle>Accent</SectionTitle>
      <div className="grid grid-cols-4 gap-2">
        {(themes ?? []).map((t) => {
          const locked = !t.owned;
          return (
            <button
              key={t.id}
              type="button"
              disabled={locked}
              onClick={() => void update({ accent: t.value })}
              className={`flex flex-col items-center rounded-2xl bg-surface p-2 shadow-card ${settings.accent === t.value ? 'ring-2 ring-accent' : ''} ${locked ? 'opacity-40' : ''}`}
            >
              <span className="h-8 w-8 rounded-full" style={{ background: ACCENTS[t.value]?.color }} />
              <span className="mt-1 text-[11px] font-semibold">{t.name}</span>
              {locked && <span className="text-[10px] text-muted">{t.unlockLevel && level < t.unlockLevel ? `Lv ${t.unlockLevel}` : `${t.price} 🪙`}</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[12px] text-muted">More accents in the Shop.</p>
      <List>
        <Row
          title="Reduced motion"
          subtitle="Fewer animations"
          right={
            <Select
              value={settings.reducedMotion}
              onChange={(v) => void update({ reducedMotion: v })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              aria-label="Reduced motion"
              className="!h-11 w-[120px]"
            />
          }
        />
        <ToggleRow title="Haptics" subtitle="Vibration feedback where supported (no sounds, ever by default)" checked={settings.haptics} onChange={(v) => void update({ haptics: v })} />
      </List>
    </>
  );
}

const TONES: { value: CoachTone; label: string }[] = [
  { value: 'balanced', label: 'Balanced mix' },
  { value: 'serious', label: 'Serious' },
  { value: 'motivational', label: 'Motivational' },
  { value: 'ironic', label: 'Ironic' },
  { value: 'provocative', label: 'Slightly provocative' },
];

function GamePanel() {
  const { settings, update } = useSettingsUpdater();
  const act = useGame((s) => s.act);
  return (
    <>
      <SectionTitle>Difficulty</SectionTitle>
      <Segmented<GameDifficulty>
        value={settings.difficulty}
        onChange={async (v) => {
          await update({ difficulty: v });
          await act(rebuildDay(clock.today()));
        }}
        options={[
          { value: 'casual', label: 'Casual' },
          { value: 'normal', label: 'Normal' },
          { value: 'hard', label: 'Hard' },
          { value: 'insane', label: 'Insane' },
        ]}
      />
      <Card className="mt-2 text-[13px] text-muted">
        Rewards ×{settings.rules.difficultyPresets[settings.difficulty].rewardMultiplier} · penalties ×{settings.rules.difficultyPresets[settings.difficulty].penaltyMultiplier} · streak line {settings.rules.difficultyPresets[settings.difficulty].streakThreshold}. Always adaptive: heavy days are protected.
      </Card>
      <List title="Coach">
        <Row title="Tone" right={<Select value={settings.tone} onChange={(v) => void update({ tone: v })} options={TONES} aria-label="Coach tone" className="!h-11 w-[180px]" />} />
      </List>
      <List title="Day">
        <Row
          title="New day starts at"
          subtitle="Activities before this hour count for the previous day"
          right={
            <Select value={settings.dayStartHour} onChange={(v) => void update({ dayStartHour: v })} options={[2, 3, 4, 5, 6].map((h) => ({ value: h, label: `${h}:00` }))} aria-label="Day start hour" className="!h-11 w-[100px]" />
          }
        />
      </List>
    </>
  );
}

function Num({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <NumberInput value={value} onChange={onChange} step={step} aria-label={label} />
    </Field>
  );
}

function TargetsPanel() {
  const { settings, update } = useSettingsUpdater();
  const [s, setS] = useState(settings);
  return (
    <div className="mt-2">
      <p className="px-1 text-[13px] text-muted">Starting values are your settings, not medical truths. The system only ever proposes bounded changes — you approve them.</p>
      <SectionTitle>Nutrition</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Calories (kcal)" value={s.nutrition.calories} onChange={(v) => setS({ ...s, nutrition: { ...s.nutrition, calories: v } })} />
        <Num label="Protein (g)" value={s.nutrition.protein} onChange={(v) => setS({ ...s, nutrition: { ...s.nutrition, protein: v } })} />
        <Num label="Carbs (g)" value={s.nutrition.carbs} onChange={(v) => setS({ ...s, nutrition: { ...s.nutrition, carbs: v } })} />
        <Num label="Fat (g)" value={s.nutrition.fat} onChange={(v) => setS({ ...s, nutrition: { ...s.nutrition, fat: v } })} />
      </div>
      <SectionTitle>Body</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Weight (kg)" value={s.body.weightKg} step={0.1} onChange={(v) => setS({ ...s, body: { ...s.body, weightKg: v } })} />
        <Num label="Height (cm)" value={s.body.heightCm} onChange={(v) => setS({ ...s, body: { ...s.body, heightCm: v } })} />
      </div>
      <Field label="Goal">
        <Segmented
          value={s.body.goal}
          onChange={(v) => setS({ ...s, body: { ...s.body, goal: v } })}
          options={[
            { value: 'lose', label: 'Lose fat' },
            { value: 'maintain', label: 'Maintain' },
            { value: 'gain', label: 'Gain' },
          ]}
        />
      </Field>
      <SectionTitle>Steps</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Num label="Min" value={s.steps.min} step={250} onChange={(v) => setS({ ...s, steps: { ...s.steps, min: v } })} />
        <Num label="Ideal" value={s.steps.ideal} step={250} onChange={(v) => setS({ ...s, steps: { ...s.steps, ideal: v } })} />
        <Num label="Stretch" value={s.steps.stretch} step={250} onChange={(v) => setS({ ...s, steps: { ...s.steps, stretch: v } })} />
      </div>
      <SectionTitle>Hydration</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Daily target (ml)" value={s.hydration.targetMl} step={50} onChange={(v) => setS({ ...s, hydration: { ...s.hydration, targetMl: v } })} />
        <Num label="Glass size (ml)" value={s.hydration.glassMl} step={10} onChange={(v) => setS({ ...s, hydration: { ...s.hydration, glassMl: v } })} />
      </div>
      <SectionTitle>Play time budget</SectionTitle>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px]">Track play time (games, TikTok, reels…)</span>
          <Toggle checked={s.leisure.enabled} onChange={(v) => setS({ ...s, leisure: { ...s.leisure, enabled: v } })} label="Track play time" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Max per day (min)" value={s.leisure.dailyLimitMin} step={5} onChange={(v) => setS({ ...s, leisure: { ...s.leisure, dailyLimitMin: Math.max(5, Math.round(v)) } })} hint="Default 90 (1h30)" />
          <Num label="Warn at (%)" value={s.leisure.warnAtPct} step={5} onChange={(v) => setS({ ...s, leisure: { ...s.leisure, warnAtPct: Math.min(100, Math.max(10, Math.round(v))) } })} />
        </div>
        <p className="text-[12px] text-muted">Video calls with your partner never count — don’t start the timer for those.</p>
      </Card>
      <SectionTitle>Tracking & programs</SectionTitle>
      <List className="!mt-0">
        <ToggleRow title="Nutrition tracking" subtitle="Counts in the Today Score" checked={s.tracking.nutrition} onChange={(v) => setS({ ...s, tracking: { ...s.tracking, nutrition: v } })} />
        <ToggleRow title="Weight tracking" checked={s.tracking.weight} onChange={(v) => setS({ ...s, tracking: { ...s.tracking, weight: v } })} />
        <ToggleRow title="Sleep tracking" subtitle="Sets daily Energy" checked={s.tracking.sleep} onChange={(v) => setS({ ...s, tracking: { ...s.tracking, sleep: v } })} />
        <ToggleRow title="Cardio program" subtitle="Walk → run progression quests" checked={s.cardio.enabled} onChange={(v) => setS({ ...s, cardio: { ...s.cardio, enabled: v } })} />
      </List>
      <Button block size="lg" className="mt-4" onClick={() =>
          void update({
            nutrition: s.nutrition,
            body: s.body,
            steps: s.steps,
            hydration: s.hydration,
            leisure: s.leisure,
            tracking: s.tracking,
            cardio: s.cardio,
            known: {
              ...settings.known,
              height: s.body.heightCm !== settings.body.heightCm || settings.known.height === 'set' ? 'set' : settings.known.height,
              weight: s.body.weightKg !== settings.body.weightKg || settings.known.weight === 'set' ? 'set' : settings.known.weight,
              steps: s.steps.ideal !== settings.steps.ideal || settings.known.steps === 'set' ? 'set' : settings.known.steps,
            },
          })
        }>
        Save targets
      </Button>
    </div>
  );
}

function SafetyPanel() {
  const { settings, update } = useSettingsUpdater();
  const [b, setB] = useState(settings.safety);
  const f = (key: keyof typeof b, label: string, step = 1) => <Num key={key} label={label} value={b[key]} step={step} onChange={(v) => setB({ ...b, [key]: v })} />;
  return (
    <div className="mt-2">
      <p className="px-1 text-[13px] text-muted">Every adaptive suggestion respects these limits. Small steps only — never a dramatic jump because one week went well.</p>
      <SectionTitle>Steps</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {f('maxStepIncreasePct', 'Max increase %')}
        {f('stepIncrement', 'Increment', 50)}
        {f('stepFloor', 'Floor', 250)}
        {f('stepCeiling', 'Ceiling', 250)}
      </div>
      <SectionTitle>Training & cardio</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {f('maxTrainingIncreasePct', 'Max load increase %')}
        {f('maxCardioIncreasePct', 'Max cardio increase %')}
        {f('minRestDaysPerWeek', 'Min rest days / week')}
      </div>
      <SectionTitle>Nutrition</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {f('calorieMin', 'Calorie floor', 25)}
        {f('calorieMax', 'Calorie ceiling', 25)}
        {f('calorieMaxAdjust', 'Max change per step', 25)}
        {f('proteinMinPerKg', 'Protein min g/kg', 0.1)}
        {f('proteinMaxPerKg', 'Protein max g/kg', 0.1)}
      </div>
      <SectionTitle>Water</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {f('waterMinMl', 'Min ml', 50)}
        {f('waterMaxMl', 'Max ml', 50)}
      </div>
      <Button block size="lg" className="mt-4" onClick={() => void update({ safety: b })}>
        Save bounds
      </Button>
    </div>
  );
}

const NOTIF_LABELS: Record<NotificationType, string> = {
  workout: 'Workout reminder',
  hydration: 'Hydration',
  quest: 'Quest reminders',
  snooze: 'Snooze over',
  recap: 'Daily recap',
  achievement: 'Achievements',
  levelUp: 'Level up',
  streak: 'Streak warning',
  challenge: 'Daily challenge',
  leisure: 'Play-time budget',
};

function NotificationsPanel() {
  const { settings, update } = useSettingsUpdater();
  const [status, setStatus] = useState(notificationService.status());
  const [result, setResult] = useState<string>('');
  const { data: plan, reload } = useAsync(() => rescheduleReminders(), [settings.notifications]);
  const n = settings.notifications;
  const set = (patch: Partial<typeof n>) => update({ notifications: { ...n, ...patch } });
  return (
    <div className="mt-2">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[16px] font-bold">Reminders</div>
            <div className="text-[12px] text-muted">
              Permission: <Chip>{status.permission}</Chip> {status.standalone ? '· Home Screen app' : ''}
            </div>
          </div>
          <Toggle
            checked={n.enabled}
            label="Enable reminders"
            onChange={async (v) => {
              if (v && status.permission === 'default') await notificationService.requestPermission();
              setStatus(notificationService.status());
              await set({ enabled: v });
              reload();
            }}
          />
        </div>
        {status.isIos && !status.standalone && <p className="mt-2 text-[12px] text-muted">iPhone: add the app to your Home Screen (Share → Add to Home Screen) to allow system notifications.</p>}
        {status.permission === 'denied' && <p className="mt-2 text-[12px] text-danger">Notifications are blocked in system settings. In-app reminders still work while the app is open.</p>}
        <p className="mt-2 text-[12px] text-muted">
          {status.pushConfigured
            ? 'Web Push backend configured: reminders also arrive when the app is closed.'
            : 'No push backend configured: reminders fire while the app is open (see README → Push). Nothing is sent to any server.'}
        </p>
        <Button
          block
          variant="secondary"
          className="mt-3"
          onClick={async () => {
            const ch = await devTestNotification();
            setResult(ch === 'none' ? 'Could not deliver.' : `Delivered via ${ch}.`);
          }}
        >
          Send test notification
        </Button>
        {result && <p className="mt-1 text-center text-[12px] text-muted">{result}</p>}
      </Card>
      <List title="Types">
        {(Object.keys(NOTIF_LABELS) as NotificationType[]).map((t) => (
          <ToggleRow key={t} title={NOTIF_LABELS[t]} checked={n.types[t]} onChange={(v) => void set({ types: { ...n.types, [t]: v } })} />
        ))}
      </List>
      <SectionTitle>Frequency governor</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Max per day" value={n.maxPerDay} onChange={(v) => void set({ maxPerDay: Math.max(1, Math.round(v)) })} />
        <Num label="Min gap (min)" value={n.minGapMin} step={5} onChange={(v) => void set({ minGapMin: Math.max(5, Math.round(v)) })} />
        <Field label="Quiet from">
          <TimeInput value={n.quietStart} onChange={(v) => void set({ quietStart: v })} aria-label="Quiet hours start" />
        </Field>
        <Field label="Quiet until">
          <TimeInput value={n.quietEnd} onChange={(v) => void set({ quietEnd: v })} aria-label="Quiet hours end" />
        </Field>
        <Field label="Daily recap at">
          <TimeInput value={n.recapTime} onChange={(v) => void set({ recapTime: v })} aria-label="Recap time" />
        </Field>
        <Num label="Hydration every (min)" value={n.hydrationIntervalMin} step={15} onChange={(v) => void set({ hydrationIntervalMin: Math.max(60, Math.round(v)) })} />
      </div>
      <List>
        <ToggleRow title="Learn my times" subtitle="Remind around when you usually do things" checked={n.learnTimes} onChange={(v) => void set({ learnTimes: v })} />
      </List>
      {n.enabled && (
        <>
          <SectionTitle>Planned for today</SectionTitle>
          <Card className="space-y-1.5">
            {(plan ?? []).map((r) => (
              <div key={r.tag} className="flex justify-between gap-2 text-[13px]">
                <span className="truncate">{r.title}</span>
                <span className="num shrink-0 text-muted">{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
            {!plan?.length && <div className="text-[13px] text-muted">Nothing else planned today.</div>}
          </Card>
        </>
      )}
    </div>
  );
}

function DataPanel() {
  const boot = useGame((s) => s.boot);
  const fileRef = useRef<HTMLInputElement>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [done, setDone] = useState('');
  return (
    <div className="mt-2">
      <p className="px-1 text-[13px] text-muted">Everything lives in this browser (IndexedDB). Export a JSON backup now and then — it’s your safety net.</p>
      <Button block size="lg" className="mt-3" icon="download" onClick={() => void exportToFile().then(() => setDone('Backup downloaded.'))}>
        Export data (JSON)
      </Button>
      <Button block size="lg" variant="secondary" className="mt-2" icon="upload" onClick={() => fileRef.current?.click()}>
        Import backup…
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          setError('');
          setValidation(null);
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setValidation(validateImport(await readFileAsJson(f)));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not read file.');
          }
        }}
      />
      {done && <p className="mt-2 text-center text-[13px] text-success">{done}</p>}
      {error && <p className="mt-2 rounded-2xl bg-danger/10 p-3 text-[13px] text-danger">{error}</p>}
      {validation && (
        <Card className="mt-3">
          {validation.ok ? (
            <>
              <div className="text-[15px] font-bold text-success">✓ Valid backup</div>
              <div className="mt-1 text-[12px] text-muted">
                {Object.entries(validation.counts)
                  .filter(([, n]) => n)
                  .map(([t, n]) => `${t}: ${n}`)
                  .join(' · ')}
              </div>
              <p className="mt-2 text-[13px]">Importing replaces all current data on this device.</p>
              <Button
                block
                variant="danger"
                className="mt-2"
                onClick={async () => {
                  await importData(validation.file!);
                  setValidation(null);
                  setDone('Backup restored.');
                  await boot();
                }}
              >
                Replace my data with this backup
              </Button>
            </>
          ) : (
            <>
              <div className="text-[15px] font-bold text-danger">Invalid file</div>
              <ul className="mt-1 list-disc pl-5 text-[12px] text-muted">
                {validation.errors.slice(0, 6).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      <SectionTitle>Danger zone</SectionTitle>
      <Button block variant="danger" icon="trash" onClick={() => setConfirmWipe(true)}>
        Erase everything
      </Button>
      <Dialog
        open={confirmWipe}
        title="Erase all data?"
        message="This deletes your character, history and settings from this device. Export first if you want to keep anything."
        confirmLabel="Erase"
        destructive
        onCancel={() => setConfirmWipe(false)}
        onConfirm={async () => {
          await wipeAllData();
          setConfirmWipe(false);
          await boot();
        }}
      />
    </div>
  );
}
