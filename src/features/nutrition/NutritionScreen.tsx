import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChartCard } from '@/components/charts/ChartCard';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, TextInput, TimeInput } from '@/components/ui/forms';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ProgressBar, Ring } from '@/components/ui/progress';
import { Button, Card, EmptyState, SectionTitle } from '@/components/ui/primitives';
import { Dialog, Sheet } from '@/components/ui/Sheet';
import { MEAL_INFO, MEAL_TYPES, mealTypeOf, type MealType } from '@/config/meals';
import { useAsync } from '@/hooks';
import { statsRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { dailySeries } from '@/services/insightsService';
import { deleteMeal, logMetric, updateMeal } from '@/services/metricsService';
import { useGame } from '@/store/gameStore';
import type { Meal } from '@/types';
import { dateTimeToTs, shiftDate, tsToHm } from '@/utils/date';
import { formatInt } from '@/utils/format';
import { MealBuilder, MealPicker } from './MealBuilder';

const MACRO_COLORS = { protein: '#ff5a5f', carbs: '#f5a524', fat: '#30b35a' } as const;
const pct = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : 0);

function MacroRow({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const left = Math.max(0, target - value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="num shrink-0">
          <b>{formatInt(value)}</b>
          <span className="text-muted"> / {formatInt(target)} g</span>
        </span>
      </div>
      <ProgressBar value={target ? value / target : 0} color={color} height={6} className="mt-1" label={`${label} ${pct(value, target)}%`} />
      <div className="num mt-0.5 flex justify-between text-[11px] text-muted">
        <span>{pct(value, target)}%</span>
        <span>{left > 0 ? `${formatInt(left)} g left` : 'target reached'}</span>
      </div>
    </div>
  );
}

function ActionTile({ icon, emoji, label, sub, onClick, primary, tour }: { icon?: IconName; emoji?: string; label: string; sub?: string; onClick: () => void; primary?: boolean; tour?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={tour}
      className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-3xl px-2 py-2 text-center shadow-card transition-transform active:scale-95 ${primary ? 'bg-accent text-on-accent' : 'bg-surface text-fg'}`}
    >
      <span className="flex h-7 items-center justify-center text-[22px] leading-none" aria-hidden>
        {icon ? <Icon name={icon} size={24} /> : emoji}
      </span>
      <span className="text-[14px] leading-tight font-bold">{label}</span>
      {sub && <span className={`num text-[11px] leading-tight ${primary ? 'text-on-accent/80' : 'text-muted'}`}>{sub}</span>}
    </button>
  );
}

/** Edit a logged meal: name, meal, time and values. */
function MealEditor({ meal, onDone }: { meal: Meal; onDone: () => void }) {
  const act = useGame((s) => s.act);
  const dayStartHour = useGame((s) => s.settings?.dayStartHour ?? 4);
  const [name, setName] = useState(meal.name);
  const [mealType, setMealType] = useState<MealType>(mealTypeOf(meal));
  const [time, setTime] = useState(tsToHm(meal.ts));
  const [v, setV] = useState({ kcal: Math.round(meal.kcal), protein: Math.round(meal.protein), carbs: Math.round(meal.carbs), fat: Math.round(meal.fat) });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await act(updateMeal(meal, { name: name.trim() || meal.name, mealType, ts: time ? dateTimeToTs(meal.date, time, dayStartHour) : meal.ts, ...v }));
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {meal.photo && <img src={meal.photo} alt="" className="mb-3 h-36 w-full rounded-3xl object-cover" />}
      <Field label="Food">
        <TextInput value={name} onChange={setName} aria-label="Food" maxLength={60} />
      </Field>
      {meal.items.length > 1 && <p className="mt-1 px-1 text-[12px] text-muted">{meal.items.map((i) => i.name).join(', ')}</p>}
      <div className="mt-4 mb-2 flex items-center justify-between gap-2 pl-1">
        <span className="text-[13px] font-semibold text-muted">Meal</span>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">
          Time
          <TimeInput value={time} onChange={setTime} aria-label="Time" className="!h-10 !w-[144px] !px-3 !text-[15px]" />
        </label>
      </div>
      <MealPicker value={mealType} onChange={setMealType} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(
          [
            ['kcal', 'Calories (kcal)'],
            ['protein', 'Protein (g)'],
            ['carbs', 'Carbs (g)'],
            ['fat', 'Fat (g)'],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label}>
            <NumberInput value={v[k]} min={0} onChange={(x) => setV((o) => ({ ...o, [k]: x }))} aria-label={label} />
          </Field>
        ))}
      </div>
      <Button type="submit" block size="lg" className="mt-4" icon="check" loading={busy}>
        Save changes
      </Button>
      <Button block variant="secondary" className="mt-2 !text-danger" icon="trash" onClick={() => setConfirmDelete(true)}>
        Delete meal
      </Button>
      <Dialog
        open={confirmDelete}
        title={`Delete “${meal.name}”?`}
        message="Its calories and macros are removed from today."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await act(deleteMeal(meal));
          onDone();
        }}
      />
    </form>
  );
}

/** Nutrition: today's intake vs targets, quick actions, meals by meal and a 7-day view. */
export default function NutritionScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const metrics = useGame((s) => s.today?.log?.metrics);
  const version = useGame((s) => s.version);
  const act = useGame((s) => s.act);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Meal | null>(null);
  const today = clock.today();
  const { data: meals, loading } = useAsync(() => statsRepository.mealsByDate(today), [today, version]);
  const { data: series } = useAsync(() => dailySeries(shiftDate(today, -6), today), [today, version]);
  if (!settings) return null;
  const n = settings.nutrition;
  const kcal = metrics?.calories ?? 0;
  const tol = settings.rules.score.calorieTolerancePct / 100;
  const inRange = kcal >= n.calories * (1 - tol) && kcal <= n.calories * (1 + tol);
  const kcalLeft = Math.round(n.calories - kcal);
  const water = metrics?.water ?? 0;
  const waterTarget = settings.hydration.targetMl;
  const grouped = MEAL_TYPES.map((t) => ({ type: t, meals: (meals ?? []).filter((m) => mealTypeOf(m) === t).sort((a, b) => a.ts - b.ts) })).filter((g) => g.meals.length);

  return (
    <Screen hud>
      <header className="flex items-end justify-between gap-2 pt-4 pb-1">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight">Nutrition</h1>
        <button type="button" onClick={() => navigate('/settings/targets')} className="flex min-h-11 items-center gap-0.5 text-[14px] font-semibold text-accent">
          Targets <Icon name="chevronRight" size={16} />
        </button>
      </header>

      <Card className="mt-2">
        <div className="flex items-center gap-4">
          <Ring value={n.calories ? kcal / n.calories : 0} size={116} stroke={11} color={inRange ? 'var(--lf-success)' : 'var(--lf-accent)'} label={`Calories ${Math.round(kcal)} of ${n.calories}, ${pct(kcal, n.calories)}%`}>
            <span className="num text-[26px] leading-none font-extrabold">{formatInt(kcal)}</span>
            <span className="num mt-0.5 text-[11px] font-semibold text-muted">/ {formatInt(n.calories)} kcal</span>
            <span className="num mt-0.5 text-[12px] font-bold">{pct(kcal, n.calories)}%</span>
          </Ring>
          <div className="min-w-0 flex-1 space-y-2.5">
            <MacroRow label="Protein" value={metrics?.protein ?? 0} target={n.protein} color={MACRO_COLORS.protein} />
            <MacroRow label="Carbs" value={metrics?.carbs ?? 0} target={n.carbs} color={MACRO_COLORS.carbs} />
            <MacroRow label="Fat" value={metrics?.fat ?? 0} target={n.fat} color={MACRO_COLORS.fat} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
          <span className="w-[116px] shrink-0 text-center text-[20px]" aria-hidden>
            💧
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="font-semibold">Water</span>
              <span className="num shrink-0">
                <b>{(water / 1000).toFixed(1)}</b>
                <span className="text-muted"> / {(waterTarget / 1000).toFixed(1)} L</span>
              </span>
            </div>
            <ProgressBar value={waterTarget ? water / waterTarget : 0} color="var(--lf-energy)" height={6} className="mt-1" label={`Water ${pct(water, waterTarget)}%`} />
            <div className="num mt-0.5 flex justify-between text-[11px] text-muted">
              <span>{pct(water, waterTarget)}%</span>
              <span>{water < waterTarget ? `${((waterTarget - water) / 1000).toFixed(1)} L left` : 'target reached'}</span>
            </div>
          </div>
        </div>
        <div className="num mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px]">
          {kcal === 0 ? (
            <span className="text-muted">Nothing logged yet today · {formatInt(n.calories)} kcal to go.</span>
          ) : kcalLeft > 0 ? (
            <span>
              <b>{formatInt(kcalLeft)} kcal</b> <span className="text-muted">left today{inRange ? ' · already in range 👌' : ''}</span>
            </span>
          ) : (
            <span>
              <b>{formatInt(-kcalLeft)} kcal</b> <span className="text-muted">over target{inRange ? ' · still in range 👌' : ' — no big deal, tomorrow is a new day.'}</span>
            </span>
          )}
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <ActionTile icon="plus" label="Add Food" onClick={() => setAdding(true)} />
        <ActionTile icon="camera" label="Scan Food" primary tour="scan-food" onClick={() => navigate('/nutrition/scan')} />
        <ActionTile emoji="💧" label="Add Water" sub={`+${settings.hydration.glassMl} ml`} onClick={() => void act(logMetric('water', settings.hydration.glassMl))} />
      </div>

      <button type="button" onClick={() => navigate('/coach', { state: { draft: 'How is my nutrition today?' } })} className="mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 text-[14px] font-semibold text-accent">
        <Icon name="chat" size={16} /> Ask the Coach about today
      </button>

      <SectionTitle>Today’s meals</SectionTitle>
      {loading && !meals ? (
        <div className="lf-skeleton h-20 rounded-3xl" />
      ) : !grouped.length ? (
        <EmptyState icon="🍽️" title="No meals yet" body="Scan your plate or add food in a few taps. Rough is fine." />
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => {
            const sum = g.meals.reduce((s, m) => s + m.kcal, 0);
            return (
              <div key={g.type}>
                <div className="mb-1.5 flex items-center justify-between px-1 text-[13px]">
                  <span className="font-bold">
                    <span aria-hidden>{MEAL_INFO[g.type].icon}</span> {MEAL_INFO[g.type].label}
                  </span>
                  <span className="num text-muted">{formatInt(sum)} kcal</span>
                </div>
                <div className="overflow-hidden rounded-3xl bg-surface shadow-card">
                  {g.meals.map((m, i) => (
                    <button key={m.id} type="button" onClick={() => setEditing(m)} className={`flex min-h-[60px] w-full items-center gap-3 px-3 py-2 text-left ${i ? 'border-t border-line' : ''}`} aria-label={`Edit ${m.name}`}>
                      {m.photo ? (
                        <img src={m.photo} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[20px]" aria-hidden>
                          {m.source === 'ai' ? '📷' : '🍴'}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[15px] font-semibold">{m.name}</span>
                          {m.source === 'ai' && <span className="shrink-0 rounded-full bg-accent/12 px-1.5 py-0.5 text-[9px] font-extrabold tracking-[0.12em] text-accent">AI</span>}
                        </span>
                        <span className="num block truncate text-[12px] text-muted">
                          {tsToHm(m.ts)} · P {formatInt(m.protein)} · C {formatInt(m.carbs)} · F {formatInt(m.fat)}
                        </span>
                      </span>
                      <span className="num shrink-0 text-right text-[15px] font-bold">
                        {m.source === 'ai' ? '~' : ''}
                        {formatInt(m.kcal)}
                        <span className="block text-[11px] font-medium text-muted">kcal</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SectionTitle>Last 7 days</SectionTitle>
      <div className="space-y-3">
        <ChartCard title="Calories" data={series ?? []} xKey="label" kind="bar" series={[{ key: 'calories', label: 'Calories', color: 'var(--lf-accent)' }]} reference={{ y: n.calories, label: 'Target' }} format={(v) => `${formatInt(v)} kcal`} height={150} />
        <ChartCard title="Protein" data={series ?? []} xKey="label" kind="bar" series={[{ key: 'protein', label: 'Protein', color: MACRO_COLORS.protein }]} reference={{ y: n.protein, label: 'Target' }} format={(v) => `${formatInt(v)} g`} height={150} />
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add food">
        <MealBuilder source="manual" onDone={() => setAdding(false)} />
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit meal">
        {editing && <MealEditor key={editing.id} meal={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </Screen>
  );
}
