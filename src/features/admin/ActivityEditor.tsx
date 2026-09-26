import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Segmented, Select, Stepper, TextArea, TextInput, TimeInput, Toggle } from '@/components/ui/forms';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/Sheet';
import { CATEGORY_INFO, STAT_INFO } from '@/data/categories';
import { computeQuestValues, DIFFICULTY_LABELS } from '@/domain/rewards';
import { useLevel } from '@/hooks';
import { activityRepository } from '@/repositories';
import { deleteActivity, saveActivity } from '@/services/adminService';
import { useGame } from '@/store/gameStore';
import type { Activity, Difficulty, Importance, MetricType, Recurrence, TimeOfDay } from '@/types';
import { CATEGORIES, METRIC_TYPES, STAT_KEYS } from '@/types';
import { slugify, uid } from '@/utils/id';

function blank(): Activity {
  const now = Date.now();
  return {
    id: '',
    name: '',
    icon: '✨',
    category: 'general',
    tier: 'optional',
    importance: 3,
    difficulty: 2,
    recurrence: { type: 'daily' },
    timeOfDay: 'anytime',
    durationMin: 10,
    stats: { discipline: 1 },
    adaptive: false,
    active: true,
    streakEligible: true,
    generatorEligible: false,
    userCreated: true,
    aiImported: false,
    createdAt: now,
    updatedAt: now,
  };
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const TODS: TimeOfDay[] = ['anytime', 'morning', 'midday', 'afternoon', 'evening', 'night'];

export default function ActivityEditor() {
  const { id = 'new' } = useParams();
  const navigate = useNavigate();
  const act = useGame((s) => s.act);
  const settings = useGame((s) => s.settings);
  const { level } = useLevel();
  const [a, setA] = useState<Activity | null>(null);
  const [isNew, setIsNew] = useState(id === 'new');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id === 'new') {
      setA(blank());
      setIsNew(true);
    } else void activityRepository.get(id).then((x) => setA(x ? structuredClone(x) : null));
  }, [id]);

  if (!settings) return null;
  if (!a) return <Screen back title="Activity">{id !== 'new' && <p className="mt-4 text-muted">Loading…</p>}</Screen>;
  const set = (patch: Partial<Activity>) => setA({ ...a, ...patch });
  const values = computeQuestValues(
    { difficulty: a.difficulty, durationMin: a.durationMin, importance: a.importance, recurrence: a.recurrence, rarity: 'common', category: a.category, baseXp: a.baseXp, baseCoins: a.baseCoins, energyCost: a.energyCost },
    level,
    settings.rules,
  );
  const r = a.recurrence;
  const setRecurrence = (type: Recurrence['type']) => {
    const next: Recurrence =
      type === 'daily' ? { type } : type === 'weekdays' ? { type, days: [1, 3, 5] } : type === 'timesPerWeek' ? { type, times: 3 } : type === 'everyNDays' ? { type, n: 2 } : { type: 'pool' };
    set({ recurrence: next, generatorEligible: type === 'pool', streakEligible: type !== 'pool', tier: type === 'pool' ? 'optional' : a.tier });
  };

  const save = async () => {
    if (!a.name.trim()) return setError('Name is required.');
    if (a.durationMin < 1) return setError('Duration must be at least 1 minute.');
    if (a.recurrence.type === 'weekdays' && a.recurrence.days.length === 0) return setError('Pick at least one weekday.');
    const idToUse = a.id || `u_${slugify(a.name)}_${uid().slice(-4)}`;
    await act(saveActivity({ ...a, id: idToUse, name: a.name.trim() }, { isNew }));
    navigate(-1);
  };

  return (
    <Screen back title={isNew ? 'New activity' : 'Edit activity'}>
      <Card className="mt-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="num text-[20px] font-extrabold text-xp">+{values.xp}</div>
            <div className="text-[11px] text-muted">XP (level {level})</div>
          </div>
          <div>
            <div className="num text-[20px] font-extrabold text-coin">+{values.coins}</div>
            <div className="text-[11px] text-muted">Coins</div>
          </div>
          <div>
            <div className="num text-[20px] font-extrabold text-energy">{values.energyCost > 0 ? `−${values.energyCost}` : `+${-values.energyCost}`}</div>
            <div className="text-[11px] text-muted">Energy</div>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted">Computed by the central formulas (difficulty, duration, importance, frequency, effort, level). Override below if you want.</p>
      </Card>

      <SectionTitle>Basics</SectionTitle>
      <div className="space-y-3">
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <Field label="Icon">
            <TextInput value={a.icon} onChange={(v) => set({ icon: v.slice(0, 4) })} aria-label="Icon" />
          </Field>
          <Field label="Name" hint="Use {pet} for your pet's name">
            <TextInput value={a.name} onChange={(v) => set({ name: v })} aria-label="Name" maxLength={60} voice />
          </Field>
        </div>
        <Field label="Description">
          <TextArea value={a.description ?? ''} onChange={(v) => set({ description: v || undefined })} rows={2} aria-label="Description" />
        </Field>
        <Field label="Category">
          <Select value={a.category} onChange={(v) => set({ category: v, stats: { ...CATEGORY_INFO[v].stats } })} options={CATEGORIES.map((c) => ({ value: c, label: `${CATEGORY_INFO[c].icon} ${CATEGORY_INFO[c].label}` }))} aria-label="Category" />
        </Field>
        <Field label="Type">
          <Segmented
            value={a.tier}
            onChange={(v) => set({ tier: v, importance: v === 'core' ? 5 : v === 'important' ? 4 : 2 })}
            options={[
              { value: 'core', label: 'Core' },
              { value: 'important', label: 'Important' },
              { value: 'optional', label: 'Optional' },
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Difficulty: ${DIFFICULTY_LABELS[a.difficulty]}`}>
            <Stepper label="Difficulty" value={a.difficulty} onChange={(v) => set({ difficulty: v as Difficulty })} min={1} max={5} size="sm" />
          </Field>
          <Field label="Importance">
            <Stepper label="Importance" value={a.importance} onChange={(v) => set({ importance: v as Importance })} min={1} max={5} size="sm" />
          </Field>
        </div>
      </div>

      <SectionTitle>Frequency & schedule</SectionTitle>
      <div className="space-y-3">
        <Select
          value={r.type}
          onChange={setRecurrence}
          options={[
            { value: 'daily', label: 'Every day' },
            { value: 'weekdays', label: 'Specific weekdays' },
            { value: 'timesPerWeek', label: 'N times per week' },
            { value: 'everyNDays', label: 'Every N days' },
            { value: 'pool', label: 'On demand / side-quest pool' },
          ]}
          aria-label="Frequency"
        />
        {r.type === 'weekdays' && (
          <div className="flex gap-1.5">
            {DAYS.map((d, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={r.days.includes(i)}
                onClick={() => set({ recurrence: { type: 'weekdays', days: r.days.includes(i) ? r.days.filter((x) => x !== i) : [...r.days, i] } })}
                className={`h-11 flex-1 rounded-xl text-[14px] font-bold ${r.days.includes(i) ? 'bg-accent text-on-accent' : 'bg-surface shadow-card'}`}
              >
                {d}
              </button>
            ))}
          </div>
        )}
        {r.type === 'timesPerWeek' && <Stepper label="Times per week" value={r.times} onChange={(v) => set({ recurrence: { type: 'timesPerWeek', times: v } })} min={1} max={7} format={(v) => `${v}× / week`} />}
        {r.type === 'everyNDays' && <Stepper label="Every N days" value={r.n} onChange={(v) => set({ recurrence: { type: 'everyNDays', n: v } })} min={1} max={60} format={(v) => `every ${v} d`} />}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Time of day">
            <Select value={a.timeOfDay} onChange={(v) => set({ timeOfDay: v })} options={TODS.map((t) => ({ value: t, label: t }))} aria-label="Time of day" />
          </Field>
          <Field label="Preferred time">
            <TimeInput value={a.preferredTime ?? ''} onChange={(v) => set({ preferredTime: v || undefined })} aria-label="Preferred time" />
          </Field>
        </div>
        <Field label="Available on">
          <Segmented
            value={a.availableOn ?? 'any'}
            onChange={(v) => set({ availableOn: v })}
            options={[
              { value: 'any', label: 'Any day' },
              { value: 'workday', label: 'Workdays' },
              { value: 'freeday', label: 'Free days' },
            ]}
          />
        </Field>
      </div>

      <SectionTitle>Amount</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Minutes">
          <NumberInput value={a.durationMin} onChange={(v) => set({ durationMin: Math.max(1, Math.round(v)) })} aria-label="Duration" />
        </Field>
        <Field label="Quantity">
          <NumberInput value={a.quantity ?? 0} onChange={(v) => set({ quantity: v || undefined })} aria-label="Quantity" />
        </Field>
        <Field label="Unit">
          <TextInput value={a.unit ?? ''} onChange={(v) => set({ unit: v || undefined })} aria-label="Unit" />
        </Field>
      </div>
      <Field label="Auto-track from metric" hint="Quest progress follows logged data (water, steps, protein…)">
        <Select
          value={a.metric ?? 'none'}
          onChange={(v) => set({ metric: v === 'none' ? undefined : (v as MetricType) })}
          options={[{ value: 'none', label: 'None (manual completion)' }, ...METRIC_TYPES.map((m) => ({ value: m, label: m }))]}
          aria-label="Metric"
        />
      </Field>
      {a.metric && (
        <div className="mt-2">
          <Segmented
            value={a.metricMode ?? 'atLeast'}
            onChange={(v) => set({ metricMode: v })}
            options={[
              { value: 'atLeast', label: 'Reach at least' },
              { value: 'atMost', label: 'Stay under (budget)' },
            ]}
          />
        </div>
      )}

      <SectionTitle>Rewards (optional overrides)</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Base XP">
          <NumberInput value={a.baseXp ?? 0} onChange={(v) => set({ baseXp: v > 0 ? Math.round(v) : undefined })} aria-label="Base XP" />
        </Field>
        <Field label="Base coins">
          <NumberInput value={a.baseCoins ?? 0} onChange={(v) => set({ baseCoins: v > 0 ? Math.round(v) : undefined })} aria-label="Base coins" />
        </Field>
        <Field label="Energy cost">
          <NumberInput value={a.energyCost ?? 0} onChange={(v) => set({ energyCost: v === 0 ? undefined : Math.round(v) })} aria-label="Energy cost" />
        </Field>
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted">0 = use the formula. Negative energy = restores energy (recovery).</p>

      <SectionTitle>Stat gains</SectionTitle>
      <Card className="divide-y divide-line !py-1">
        {STAT_KEYS.map((k) => (
          <div key={k} className="flex min-h-12 items-center justify-between gap-2 py-1">
            <span className="min-w-0 truncate text-[14px] font-semibold">
              <span aria-hidden>{STAT_INFO[k].icon}</span> {STAT_INFO[k].label}
            </span>
            <Stepper size="sm" label={STAT_INFO[k].label} value={a.stats[k] ?? 0} onChange={(v) => set({ stats: { ...a.stats, [k]: v || undefined } })} min={0} max={5} />
          </div>
        ))}
      </Card>

      <SectionTitle>Behaviour</SectionTitle>
      <Card className="space-y-3">
        {(
          [
            ['active', 'Active'],
            ['streakEligible', 'Has its own streak'],
            ['generatorEligible', 'Can be generated as side quest'],
            ['adaptive', 'Adaptive target (bounded by safety limits)'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-[15px]">{label}</span>
            <Toggle checked={!!a[key]} onChange={(v) => set({ [key]: v })} label={label} />
          </div>
        ))}
      </Card>
      {a.adaptive && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Field label="Safety min">
            <NumberInput value={a.safety?.min ?? 0} onChange={(v) => set({ safety: { ...a.safety, min: v || undefined } })} aria-label="Safety min" />
          </Field>
          <Field label="Safety max">
            <NumberInput value={a.safety?.max ?? 0} onChange={(v) => set({ safety: { ...a.safety, max: v || undefined } })} aria-label="Safety max" />
          </Field>
          <Field label="Max +%/step">
            <NumberInput value={a.safety?.maxIncreasePct ?? 0} onChange={(v) => set({ safety: { ...a.safety, maxIncreasePct: v || undefined } })} aria-label="Max increase percent" />
          </Field>
        </div>
      )}
      {a.generatorEligible && (
        <div className="mt-2">
          <div className="mb-1 px-1 text-[13px] font-semibold text-muted">Scale to available time (side quests)</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Min min">
              <NumberInput value={a.scalable?.min ?? 0} onChange={(v) => set({ scalable: v ? { field: 'duration', min: v, max: a.scalable?.max ?? v * 3, step: a.scalable?.step ?? 5 } : undefined })} aria-label="Scale min" />
            </Field>
            <Field label="Max min">
              <NumberInput value={a.scalable?.max ?? 0} onChange={(v) => a.scalable && set({ scalable: { ...a.scalable, max: v } })} aria-label="Scale max" />
            </Field>
            <Field label="Step">
              <NumberInput value={a.scalable?.step ?? 0} onChange={(v) => a.scalable && set({ scalable: { ...a.scalable, step: Math.max(1, v) } })} aria-label="Scale step" />
            </Field>
          </div>
        </div>
      )}
      <Field label="Notes">
        <TextArea value={a.notes ?? ''} onChange={(v) => set({ notes: v || undefined })} rows={2} aria-label="Notes" />
      </Field>

      {error && <p className="mt-3 rounded-2xl bg-danger/10 p-3 text-[13px] text-danger">{error}</p>}
      <Button block size="lg" className="mt-4" onClick={() => void save()}>
        {isNew ? 'Create activity' : 'Save changes'}
      </Button>
      {!isNew && (
        <Button block variant="danger" className="mt-2" icon="trash" onClick={() => setConfirm(true)}>
          Delete activity
        </Button>
      )}
      <Dialog
        open={confirm}
        title="Delete activity?"
        message="Past quests stay in your history. Pausing (toggle Active) is usually better."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await deleteActivity(a.id);
          setConfirm(false);
          navigate(-1);
        }}
      />
    </Screen>
  );
}
