import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Field, NumberInput, TextInput } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, cx } from '@/components/ui/primitives';
import { FOOD_PRESETS, sumItems } from '@/data/foods';
import { logMeal } from '@/services/metricsService';
import { useGame } from '@/store/gameStore';
import type { Meal, MealItem } from '@/types';

interface Line extends MealItem {
  key: string;
  icon?: string;
  portion?: string;
  qty: number;
}

const QTY = [0.5, 1, 1.5, 2];
const scale = (i: Line): MealItem => ({ name: i.name, grams: i.grams ? Math.round(i.grams * i.qty) : undefined, kcal: i.kcal * i.qty, protein: i.protein * i.qty, carbs: i.carbs * i.qty, fat: i.fat * i.qty });

export function defaultMealName(date = new Date()): string {
  const h = date.getHours();
  return h < 10 ? 'Breakfast' : h < 12 ? 'Snack' : h < 15 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner';
}

/** Build a meal from presets, custom foods or an estimate, then log it in one tap. */
export function MealBuilder({ initial = [], photo, source, name: initialName, onDone }: { initial?: MealItem[]; photo?: string; source: Meal['source']; name?: string; onDone?: () => void }) {
  const act = useGame((s) => s.act);
  const [name, setName] = useState(initialName ?? defaultMealName());
  const [lines, setLines] = useState<Line[]>(() => initial.map((i, k) => ({ ...i, key: `i${k}`, qty: 1 })));
  const [custom, setCustom] = useState({ name: '', kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const [busy, setBusy] = useState(false);
  const total = sumItems(lines.map(scale));
  const add = (l: Omit<Line, 'key' | 'qty'>) => setLines((x) => [...x, { ...l, key: `${Date.now()}${x.length}`, qty: 1 }]);

  const save = async () => {
    setBusy(true);
    try {
      const items = lines.map(scale);
      await act(logMeal({ name: name.trim() || defaultMealName(), items, ...sumItems(items), photo, source: lines.length && source === 'manual' && lines.every((l) => l.icon) ? 'preset' : source }));
      setLines([]);
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Field label="Meal">
        <TextInput value={name} onChange={setName} aria-label="Meal name" maxLength={40} />
      </Field>

      <AnimatePresence initial={false}>
        {lines.map((l) => (
          <motion.div key={l.key} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-2 rounded-2xl bg-surface p-3 shadow-card">
              <div className="flex items-start gap-2">
                {l.icon && (
                  <span className="text-[22px]" aria-hidden>
                    {l.icon}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{l.name}</div>
                  <div className="num text-[12px] text-muted">
                    {Math.round(l.kcal * l.qty)} kcal · {Math.round(l.protein * l.qty)} g protein{l.portion ? ` · ${l.portion}${l.qty !== 1 ? ` ×${l.qty}` : ''}` : ''}
                  </div>
                </div>
                <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} className="-mt-1 -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted">
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {QTY.map((q) => (
                  <button key={q} type="button" aria-pressed={l.qty === q} onClick={() => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, qty: q } : y)))} className={cx('h-10 rounded-xl text-[13px] font-bold', l.qty === q ? 'bg-accent text-on-accent' : 'bg-surface-2')}>
                    {q === 0.5 ? '½' : q === 1.5 ? '1½' : q}×
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="mt-4 text-[13px] font-semibold text-muted">Quick add</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {FOOD_PRESETS.map((f) => (
          <button key={f.id} type="button" onClick={() => add(f)} className="flex h-11 items-center gap-1.5 rounded-full bg-surface px-3 text-[14px] font-semibold shadow-card active:scale-95">
            <span aria-hidden>{f.icon}</span> {f.name}
          </button>
        ))}
      </div>

      <details className="mt-4 rounded-2xl bg-surface p-3 shadow-card">
        <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold">Something else (enter values)</summary>
        <div className="mt-2 space-y-2">
          <TextInput value={custom.name} onChange={(v) => setCustom({ ...custom, name: v })} placeholder="Food name" aria-label="Food name" />
          <div className="grid grid-cols-2 gap-2">
            {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
              <Field key={k} label={k === 'kcal' ? 'Calories (kcal)' : `${k[0].toUpperCase()}${k.slice(1)} (g)`}>
                <NumberInput value={custom[k]} onChange={(v) => setCustom({ ...custom, [k]: Math.max(0, v) })} min={0} aria-label={k} />
              </Field>
            ))}
          </div>
          <Button
            block
            variant="tinted"
            icon="plus"
            disabled={!custom.kcal && !custom.protein}
            onClick={() => {
              add({ name: custom.name.trim() || 'Food', kcal: custom.kcal, protein: custom.protein, carbs: custom.carbs, fat: custom.fat });
              setCustom({ name: '', kcal: 0, protein: 0, carbs: 0, fat: 0 });
            }}
          >
            Add to meal
          </Button>
        </div>
      </details>

      <Button block size="lg" className="mt-4" icon="check" disabled={!lines.length} loading={busy} onClick={() => void save()}>
        {lines.length ? `Log meal · ${Math.round(total.kcal)} kcal · ${Math.round(total.protein)} g` : 'Add something first'}
      </Button>
      <p className="mt-2 px-1 text-[12px] text-muted">Values are estimates. Awareness beats perfection — there are no “bad” meals here.</p>
    </div>
  );
}
