import { useEffect, useState } from 'react';
import { Field, NumberInput, Segmented, Stepper, TimeInput } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/progress';
import { Button, Card } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { useAsync } from '@/hooks';
import { clock } from '@/services/clock';
import { deleteMetric, logMetric, METRIC_INPUT, metricEntries } from '@/services/metricsService';
import { useGame } from '@/store/gameStore';
import type { MetricType } from '@/types';
import { blockMinutes, tsToHm } from '@/utils/date';
import { formatInt, formatMl } from '@/utils/format';

export type QuickTab = 'water' | 'steps' | 'food' | 'weight' | 'sleep' | 'activity';

export function metricToTab(m?: MetricType): QuickTab {
  switch (m) {
    case 'steps':
      return 'steps';
    case 'calories':
    case 'protein':
    case 'carbs':
    case 'fat':
      return 'food';
    case 'weight':
      return 'weight';
    case 'sleep':
      return 'sleep';
    case 'distance':
    case 'activeCalories':
    case 'workoutMinutes':
      return 'activity';
    default:
      return 'water';
  }
}

export function QuickLogSheet({ open, tab: initialTab, onClose }: { open: boolean; tab: QuickTab; onClose: () => void }) {
  const [tab, setTab] = useState<QuickTab>(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  return (
    <Sheet open={open} onClose={onClose} title="Quick log">
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
        <Segmented
          size="sm"
          className="min-w-[520px]"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'water', label: '💧 Water' },
            { value: 'steps', label: '👟 Steps' },
            { value: 'food', label: '🍽️ Food' },
            { value: 'weight', label: '⚖️ Weight' },
            { value: 'sleep', label: '😴 Sleep' },
            { value: 'activity', label: '🏃 Activity' },
          ]}
        />
      </div>
      <div className="mt-4">
        {tab === 'water' && <WaterPanel />}
        {tab === 'steps' && <StepsPanel />}
        {tab === 'food' && <FoodPanel />}
        {tab === 'weight' && <WeightPanel />}
        {tab === 'sleep' && <SleepPanel />}
        {tab === 'activity' && <ActivityPanel />}
      </div>
      <TodayEntries />
    </Sheet>
  );
}

function useMetrics() {
  return useGame((s) => s.today?.log?.metrics ?? {});
}

function WaterPanel() {
  const act = useGame((s) => s.act);
  const target = useGame((s) => s.settings?.hydration.targetMl ?? 2000);
  const glass = useGame((s) => s.settings?.hydration.glassMl ?? 250);
  const water = useMetrics().water ?? 0;
  const [custom, setCustom] = useState(330);
  return (
    <div>
      <Card className="text-center">
        <div className="num text-[40px] font-extrabold text-energy">{formatMl(water)}</div>
        <div className="text-[14px] text-muted">of {formatMl(target)} today</div>
        <ProgressBar value={water / target} color="var(--lf-energy)" className="mt-3" height={10} />
      </Card>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[glass, 500, 750].map((ml) => (
          <Button key={ml} size="lg" variant="tinted" onClick={() => void act(logMetric('water', ml))}>
            +{ml} ml
          </Button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-surface p-3 shadow-card">
        <Stepper label="Custom amount" value={custom} onChange={setCustom} step={10} min={10} max={3000} format={(v) => `${v} ml`} size="sm" />
        <Button size="sm" onClick={() => void act(logMetric('water', custom))}>
          Add
        </Button>
      </div>
    </div>
  );
}

function StepsPanel() {
  const act = useGame((s) => s.act);
  const targets = useGame((s) => s.settings?.steps);
  const current = useMetrics().steps ?? 0;
  const [value, setValue] = useState(current || 5000);
  if (!targets) return null;
  return (
    <div>
      <Card>
        <div className="flex items-baseline justify-between">
          <span className="num text-[34px] font-extrabold">{formatInt(current)}</span>
          <span className="text-[13px] text-muted">ideal {formatInt(targets.ideal)}</span>
        </div>
        <ProgressBar value={current / targets.stretch} markers={[targets.min / targets.stretch, targets.ideal / targets.stretch]} className="mt-2" height={10} />
        <div className="num mt-1 flex justify-between text-[11px] text-muted">
          <span>min {formatInt(targets.min)}</span>
          <span>stretch {formatInt(targets.stretch)}</span>
        </div>
      </Card>
      <p className="mt-3 px-1 text-[13px] text-muted">Enter today’s total from your watch (Galaxy Watch, phone…). It replaces the previous value.</p>
      <div className="mt-2 flex items-center gap-2">
        <NumberInput value={value} onChange={setValue} min={0} max={100000} aria-label="Steps total" className="text-[22px] font-bold" />
        <Button size="lg" onClick={() => void act(logMetric('steps', Math.round(value)))}>
          Save
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {[-500, 500, 1000, 2000].map((d) => (
          <Button key={d} size="sm" variant="secondary" onClick={() => setValue((v) => Math.max(0, v + d))}>
            {d > 0 ? `+${d}` : d}
          </Button>
        ))}
      </div>
    </div>
  );
}

function FoodPanel() {
  const act = useGame((s) => s.act);
  const n = useGame((s) => s.settings?.nutrition);
  const m = useMetrics();
  const [meal, setMeal] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  if (!n) return null;
  const rows: { key: keyof typeof meal; label: string; unit: string; target: number; color: string }[] = [
    { key: 'calories', label: 'Calories', unit: 'kcal', target: n.calories, color: 'var(--lf-accent)' },
    { key: 'protein', label: 'Protein', unit: 'g', target: n.protein, color: '#ff5a5f' },
    { key: 'carbs', label: 'Carbs', unit: 'g', target: n.carbs, color: '#ffb020' },
    { key: 'fat', label: 'Fat', unit: 'g', target: n.fat, color: '#30b35a' },
  ];
  const save = async () => {
    for (const r of rows) if (meal[r.key] > 0) await act(logMetric(r.key, meal[r.key]));
    setMeal({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  };
  return (
    <div>
      <Card className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex justify-between text-[13px]">
              <span className="font-semibold">{r.label}</span>
              <span className="num text-muted">
                {formatInt(m[r.key] ?? 0)} / {formatInt(r.target)} {r.unit}
              </span>
            </div>
            <ProgressBar value={(m[r.key] ?? 0) / r.target} color={r.color} height={6} className="mt-1" />
          </div>
        ))}
      </Card>
      <div className="mt-3 text-[13px] font-semibold text-muted">Add a meal / snack</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {rows.map((r) => (
          <Field key={r.key} label={`${r.label} (${r.unit})`}>
            <NumberInput value={meal[r.key]} onChange={(v) => setMeal((x) => ({ ...x, [r.key]: Math.max(0, v) }))} min={0} aria-label={r.label} />
          </Field>
        ))}
      </div>
      <Button block size="lg" className="mt-3" icon="plus" disabled={!Object.values(meal).some((v) => v > 0)} onClick={() => void save()}>
        Add to today
      </Button>
      <p className="mt-2 px-1 text-[12px] text-muted">Targets are your settings, not medical advice. Awareness beats perfection.</p>
    </div>
  );
}

function WeightPanel() {
  const act = useGame((s) => s.act);
  const last = useGame((s) => s.settings?.body.weightKg ?? 70);
  const today = useMetrics().weight;
  const [kg, setKg] = useState(today ?? last);
  return (
    <div>
      <Card className="flex flex-col items-center">
        <Stepper label="Weight" value={kg} onChange={setKg} step={0.1} min={30} max={250} format={(v) => `${v.toFixed(1)} kg`} />
        <p className="mt-2 text-[12px] text-muted">Same time, same conditions. Trend matters, single days don’t.</p>
      </Card>
      <Button block size="lg" className="mt-3" onClick={() => void act(logMetric('weight', Math.round(kg * 10) / 10))}>
        Save weight
      </Button>
    </div>
  );
}

function SleepPanel() {
  const act = useGame((s) => s.act);
  const wake = useGame((s) => s.today?.plan.wake ?? '07:00');
  const sleepTime = useGame((s) => s.today?.plan.sleep ?? '23:30');
  const logged = useMetrics().sleep;
  const [bed, setBed] = useState(sleepTime);
  const [up, setUp] = useState(wake);
  const [hours, setHours] = useState(logged ?? 7.5);
  const fromTimes = Math.round((blockMinutes(bed, up) / 60) * 4) / 4;
  return (
    <div>
      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Went to bed">
            <TimeInput value={bed} onChange={(v) => { setBed(v); setHours(Math.round((blockMinutes(v, up) / 60) * 4) / 4); }} aria-label="Bed time" />
          </Field>
          <Field label="Woke up">
            <TimeInput value={up} onChange={(v) => { setUp(v); setHours(Math.round((blockMinutes(bed, v) / 60) * 4) / 4); }} aria-label="Wake time" />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-center">
          <Stepper label="Hours slept" value={hours || fromTimes} onChange={setHours} step={0.25} min={0} max={16} format={(v) => `${v.toFixed(2).replace(/\.?0+$/, '')} h`} />
        </div>
      </Card>
      <p className="mt-2 px-1 text-[12px] text-muted">Logged sleep sets today’s ⚡ Energy (a game resource, not a medical metric).</p>
      <Button block size="lg" className="mt-3" onClick={() => void act(logMetric('sleep', hours || fromTimes))}>
        Save sleep
      </Button>
    </div>
  );
}

function ActivityPanel() {
  const act = useGame((s) => s.act);
  const [distance, setDistance] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [kcal, setKcal] = useState(0);
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Distance (km)">
          <NumberInput value={distance} onChange={setDistance} min={0} step={0.1} aria-label="Distance" />
        </Field>
        <Field label="Duration (min)">
          <NumberInput value={minutes} onChange={setMinutes} min={0} aria-label="Duration" />
        </Field>
        <Field label="Active kcal">
          <NumberInput value={kcal} onChange={setKcal} min={0} aria-label="Active calories" />
        </Field>
      </div>
      <p className="mt-2 px-1 text-[12px] text-muted">For walks, runs or sports tracked on your watch. Strength workouts are logged in Train.</p>
      <Button
        block
        size="lg"
        className="mt-3"
        disabled={!distance && !minutes && !kcal}
        onClick={async () => {
          if (distance) await act(logMetric('distance', distance));
          if (minutes) await act(logMetric('workoutMinutes', minutes));
          if (kcal) await act(logMetric('activeCalories', kcal));
          setDistance(0);
          setMinutes(0);
          setKcal(0);
        }}
      >
        Log activity
      </Button>
    </div>
  );
}

function TodayEntries() {
  const act = useGame((s) => s.act);
  const { data } = useAsync(() => metricEntries(clock.today()), []);
  if (!data?.length) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 px-1 text-[13px] font-semibold text-muted uppercase">Logged today</div>
      <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
        {data.slice(0, 12).map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
            <span aria-hidden>{METRIC_INPUT[e.type].icon}</span>
            <span className="flex-1 text-[14px]">
              {METRIC_INPUT[e.type].label}{' '}
              <span className="num font-semibold">
                {e.value > 0 && METRIC_INPUT[e.type].mode === 'add' ? '+' : ''}
                {Math.round(e.value * 100) / 100} {METRIC_INPUT[e.type].unit}
              </span>
            </span>
            <span className="num text-[12px] text-muted">{tsToHm(e.ts)}</span>
            <button type="button" aria-label="Delete entry" className="flex h-9 w-9 items-center justify-center rounded-full text-muted" onClick={() => void act(deleteMetric(e))}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
