import { useState } from 'react';
import { Field, NumberInput, TextInput, TimeInput } from '@/components/ui/forms';
import { Button, cx } from '@/components/ui/primitives';
import { MEAL_INFO, MEAL_TYPES, mealTypeAt, type MealType } from '@/config/meals';
import { FOOD_PRESETS } from '@/data/foods';
import { clock } from '@/services/clock';
import { logMeal } from '@/services/metricsService';
import { useAsync } from '@/hooks';
import { statsRepository } from '@/repositories';
import { shiftDate } from '@/utils/date';
import { useGame } from '@/store/gameStore';
import type { Meal } from '@/types';
import { dateTimeToTs, tsToHm } from '@/utils/date';

/** Default meal label for "now" (device local time). */
export function defaultMealName(date = new Date(clock.now())): string {
  return MEAL_INFO[mealTypeAt(date)].label;
}

/** Meal picker: six meals in two rows of three. */
export function MealPicker({ value, onChange }: { value: MealType; onChange: (t: MealType) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Meal">
      {MEAL_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={cx('flex h-[62px] flex-col items-center justify-center rounded-2xl px-1 text-[12px] leading-tight font-semibold transition-colors', value === t ? 'bg-accent text-on-accent' : 'bg-surface text-fg shadow-card')}
        >
          <span className="text-[17px] leading-none" aria-hidden>
            {MEAL_INFO[t].icon}
          </span>
          <span className="mt-0.5 text-center">{MEAL_INFO[t].label}</span>
        </button>
      ))}
    </div>
  );
}

const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
] as const;
type Macros = Record<(typeof NUTRIENTS)[number]['key'], number>;
const EMPTY: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/**
 * ADD FOOD: what did you eat → meal (pre-selected from the clock) → time → calories and macros
 * → ADD FOOD. No categories. Presets only fill the fields; everything stays editable.
 */
export function MealBuilder({ photo, source = 'manual', name: initialName = '', initial, onDone }: { photo?: string; source?: Meal['source']; name?: string; initial?: Partial<Macros>; onDone?: () => void }) {
  const act = useGame((s) => s.act);
  const dayStartHour = useGame((s) => s.settings?.dayStartHour ?? 4);
  const [name, setName] = useState(initialName);
  const [time, setTime] = useState(() => tsToHm(clock.now()));
  const [mealType, setMealType] = useState<MealType>(() => mealTypeAt(new Date(clock.now())));
  const [pickedMeal, setPickedMeal] = useState(false);
  const [macros, setMacros] = useState<Macros>(() => ({ ...EMPTY, ...initial }));
  const [preset, setPreset] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && Object.values(macros).some((v) => v > 0);
  // Recent foods (last 3 weeks, one per name, newest first): one tap refills a meal you eat often.
  const { data: recent } = useAsync(async () => {
    const today = clock.today();
    const meals = (await statsRepository.mealsRange(shiftDate(today, -21), today)).sort((a, b) => b.ts - a.ts);
    const seen = new Set<string>();
    return meals.filter((m) => m.kcal > 0 && !seen.has(m.name.toLowerCase()) && seen.add(m.name.toLowerCase())).slice(0, 8);
  }, [], { live: false });

  const onTime = (hm: string) => {
    setTime(hm);
    // Follow the clock until the player picks a meal themselves.
    if (!pickedMeal && hm) setMealType(mealTypeAt(new Date(dateTimeToTs(clock.today(), hm, dayStartHour))));
  };

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const food = name.trim().slice(0, 60);
      const item = { name: food, kcal: macros.kcal, protein: macros.protein, carbs: macros.carbs, fat: macros.fat, grams: preset ? FOOD_PRESETS.find((p) => p.id === preset)?.grams : undefined };
      const ts = time ? dateTimeToTs(clock.today(), time, dayStartHour) : clock.now();
      await act(logMeal({ name: food, mealType, ts, items: [item], kcal: macros.kcal, protein: macros.protein, carbs: macros.carbs, fat: macros.fat, photo, source: preset && source === 'manual' ? 'preset' : source }));
      onDone?.();
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
      <Field label="What did you eat?">
        <TextInput
          voice
          value={name}
          onChange={(v) => {
            setName(v);
            if (preset) setPreset(null);
          }}
          placeholder="e.g. Pasta al pomodoro"
          aria-label="What did you eat?"
          maxLength={60}
        />
      </Field>

      {!!recent?.length && (
        <>
          <div className="mt-3 px-1 text-[12px] font-semibold text-muted">Recent</div>
          <div className="mt-1 -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scroll-touch" aria-label="Recent foods">
            {recent.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setPreset(null);
                  setName(m.name);
                  setMacros({ kcal: Math.round(m.kcal), protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat) });
                }}
                className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-surface px-3 text-[13px] font-semibold whitespace-nowrap shadow-card"
              >
                {m.name} <span className="num font-medium text-muted">{Math.round(m.kcal)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-3 px-1 text-[12px] font-semibold text-muted">Quick fill</div>
      <div className="mt-1 -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scroll-touch" aria-label="Quick fill">
        {FOOD_PRESETS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={preset === f.id}
            onClick={() => {
              setPreset(f.id);
              setName(f.name);
              setMacros({ kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat });
            }}
            className={cx('flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap', preset === f.id ? 'bg-accent text-on-accent' : 'bg-surface-2 text-fg')}
          >
            <span aria-hidden>{f.icon}</span> {f.name}
          </button>
        ))}
      </div>
      {preset && <p className="mt-1 px-1 text-[12px] text-muted">Typical portion: {FOOD_PRESETS.find((p) => p.id === preset)?.portion}. Adjust the numbers if yours was different.</p>}

      <div className="mt-4 mb-2 flex items-center justify-between gap-2 pl-1">
        <span className="text-[13px] font-semibold text-muted">Meal</span>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">
          Time
          <TimeInput value={time} onChange={onTime} aria-label="Time" className="!h-10 !w-[144px] !px-3 !text-[15px]" />
        </label>
      </div>
      <MealPicker
        value={mealType}
        onChange={(t) => {
          setMealType(t);
          setPickedMeal(true);
        }}
      />

      <div className="mt-4 grid grid-cols-2 gap-2">
        {NUTRIENTS.map((n) => (
          <Field key={n.key} label={`${n.label} (${n.unit})`}>
            <NumberInput value={macros[n.key]} min={0} max={n.key === 'kcal' ? 10000 : 1000} onChange={(v) => setMacros((m) => ({ ...m, [n.key]: v }))} aria-label={n.label} />
          </Field>
        ))}
      </div>

      <Button type="submit" block size="lg" className="mt-4" icon="plus" disabled={!ready} loading={busy}>
        {ready ? `ADD FOOD · ${Math.round(macros.kcal)} kcal` : name.trim() ? 'Add calories or macros' : 'ADD FOOD'}
      </Button>
      <p className="mt-2 px-1 text-[12px] text-muted">Rough numbers are fine — awareness beats perfection.</p>
    </form>
  );
}
