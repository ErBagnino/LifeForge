import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChartCard } from '@/components/charts/ChartCard';
import { Screen } from '@/components/layout/Screen';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar, Ring } from '@/components/ui/progress';
import { Button, Card, EmptyState, SectionTitle } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { useAsync } from '@/hooks';
import { statsRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { dailySeries } from '@/services/insightsService';
import { deleteMeal, logMetric } from '@/services/metricsService';
import { useGame } from '@/store/gameStore';
import { shiftDate, tsToHm } from '@/utils/date';
import { formatInt } from '@/utils/format';
import { MealBuilder } from './MealBuilder';

/** Nutrition: today's intake vs targets, meals (with photos), quick logging and a 7-day view. */
export default function NutritionScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const metrics = useGame((s) => s.today?.log?.metrics);
  const version = useGame((s) => s.version);
  const act = useGame((s) => s.act);
  const [adding, setAdding] = useState(false);
  const today = clock.today();
  const { data: meals } = useAsync(() => statsRepository.mealsByDate(today), [today, version]);
  const { data: series } = useAsync(() => dailySeries(shiftDate(today, -6), today), [today, version]);
  if (!settings) return null;
  const n = settings.nutrition;
  const kcal = metrics?.calories ?? 0;
  const tol = settings.rules.score.calorieTolerancePct / 100;
  const inRange = kcal >= n.calories * (1 - tol) && kcal <= n.calories * (1 + tol);
  const water = metrics?.water ?? 0;
  const macro = [
    { key: 'protein', label: 'Protein', value: metrics?.protein ?? 0, target: n.protein, color: '#ff5a5f' },
    { key: 'carbs', label: 'Carbs', value: metrics?.carbs ?? 0, target: n.carbs, color: '#ffb020' },
    { key: 'fat', label: 'Fat', value: metrics?.fat ?? 0, target: n.fat, color: '#30b35a' },
  ];

  return (
    <Screen hud>
      <header className="flex items-end justify-between gap-2 pt-4 pb-1">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight">Nutrition</h1>
        <span className="pb-1 text-[12px] text-muted">Targets are settings, not rules.</span>
      </header>
      <Card className="mt-3">
        <div className="flex items-center gap-4">
          <Ring value={kcal / n.calories} size={112} stroke={11} color={inRange ? 'var(--lf-success)' : 'var(--lf-accent)'} label={`Calories ${Math.round(kcal)} of ${n.calories}`}>
            <span className="num text-[26px] leading-none font-extrabold">{formatInt(kcal)}</span>
            <span className="text-[11px] font-semibold text-muted">/ {formatInt(n.calories)} kcal</span>
          </Ring>
          <div className="min-w-0 flex-1 space-y-2">
            {macro.map((m) => (
              <div key={m.key}>
                <div className="flex justify-between gap-2 text-[13px]">
                  <span className="font-semibold">{m.label}</span>
                  <span className="num shrink-0 text-muted">
                    {formatInt(m.value)}/{formatInt(m.target)} g
                  </span>
                </div>
                <ProgressBar value={m.value / m.target} color={m.color} height={6} className="mt-1" label={m.label} />
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          {kcal === 0 ? 'Nothing logged yet today.' : inRange ? 'Right in your target range. 👌' : kcal < n.calories ? `About ${formatInt(n.calories - kcal)} kcal to your target.` : 'Above today’s target — no big deal, tomorrow is a new day.'}
        </p>
      </Card>

      <Button block size="lg" icon="camera" className="mt-3 !h-16 !text-[18px]" data-tour="scan-food" onClick={() => navigate('/nutrition/scan')}>
        SCAN FOOD
      </Button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="secondary" icon="plus" className="!px-3 whitespace-nowrap" onClick={() => setAdding(true)}>
          Add manually
        </Button>
        <Button variant="secondary" icon="chat" className="!px-3 whitespace-nowrap" onClick={() => navigate('/coach', { state: { draft: 'How is my nutrition today?' } })}>
          Ask Coach
        </Button>
      </div>

      <Card className="mt-3">
        <div className="flex items-center gap-3">
          <span className="text-[24px]" aria-hidden>
            💧
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-2 text-[14px]">
              <span className="font-semibold">Water</span>
              <span className="num shrink-0 text-muted">
                {(water / 1000).toFixed(1)} / {(settings.hydration.targetMl / 1000).toFixed(1)} L
              </span>
            </div>
            <ProgressBar value={water / settings.hydration.targetMl} color="var(--lf-energy)" height={6} className="mt-1" label="Water" />
          </div>
          <Button size="sm" variant="tinted" className="!h-11 shrink-0" onClick={() => void act(logMetric('water', settings.hydration.glassMl))}>
            +{settings.hydration.glassMl} ml
          </Button>
        </div>
      </Card>

      <SectionTitle>Today’s meals</SectionTitle>
      {!meals?.length ? (
        <EmptyState icon="🍽️" title="No meals yet" body="Scan your plate or add food in a few taps. Rough is fine." />
      ) : (
        <div className="space-y-2">
          {meals.map((m) => (
            <Card key={m.id} className="!p-3">
              <div className="flex items-center gap-3">
                {m.photo ? (
                  <img src={m.photo} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-[24px]" aria-hidden>
                    🍽️
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold">{m.name}</span>
                    {m.source === 'ai' && <span className="shrink-0 rounded-full bg-accent/12 px-1.5 py-0.5 text-[9px] font-extrabold tracking-[0.12em] text-accent">AI ESTIMATE</span>}
                  </div>
                  <div className="num text-[12px] text-muted">
                    {tsToHm(m.ts)} · {m.source === 'ai' ? '~' : ''}
                    {formatInt(m.kcal)} kcal · {formatInt(m.protein)} g P{m.estimate?.corrected || m.estimate?.edited ? ' · corrected' : ''}
                  </div>
                  <div className="truncate text-[12px] text-faint">{m.items.map((i) => i.name).join(', ')}</div>
                </div>
                <button type="button" aria-label={`Delete ${m.name}`} onClick={() => void act(deleteMeal(m))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted">
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>Last 7 days</SectionTitle>
      <div className="space-y-3">
        <ChartCard title="Calories" data={series ?? []} xKey="label" kind="bar" series={[{ key: 'calories', label: 'Calories', color: 'var(--lf-accent)' }]} reference={{ y: n.calories, label: 'Target' }} format={(v) => `${formatInt(v)} kcal`} height={150} />
        <ChartCard title="Protein" data={series ?? []} xKey="label" kind="bar" series={[{ key: 'protein', label: 'Protein', color: '#ff5a5f' }]} reference={{ y: n.protein, label: 'Target' }} format={(v) => `${formatInt(v)} g`} height={150} />
      </div>
      <button type="button" onClick={() => navigate('/settings/targets')} className="mt-3 flex min-h-11 w-full items-center justify-center gap-1 text-[14px] font-semibold text-accent">
        Edit targets <Icon name="chevronRight" size={16} />
      </button>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add food">
        <MealBuilder source="manual" onDone={() => setAdding(false)} />
      </Sheet>
    </Screen>
  );
}
