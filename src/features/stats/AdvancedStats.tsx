import { useState } from 'react';
import { ChartCard } from '@/components/charts/ChartCard';
import { Screen } from '@/components/layout/Screen';
import { Segmented } from '@/components/ui/forms';
import { ProgressBar } from '@/components/ui/progress';
import { Card, SectionTitle } from '@/components/ui/primitives';
import { CATEGORY_INFO } from '@/data/categories';
import { useAsync } from '@/hooks';
import { clock } from '@/services/clock';
import { categoryPerformance, dailySeries, workoutVolumeSeries } from '@/services/insightsService';
import { useGame } from '@/store/gameStore';
import { shiftDate } from '@/utils/date';

type Range = '14' | '30' | '90';

export default function AdvancedStats() {
  const [range, setRange] = useState<Range>('30');
  const settings = useGame((s) => s.settings);
  const today = clock.today();
  const days = Number(range);
  const { data: series } = useAsync(() => dailySeries(shiftDate(today, -(days - 1)), today), [today, days]);
  const { data: volume } = useAsync(() => workoutVolumeSeries(30), [today]);
  const { data: categories } = useAsync(() => categoryPerformance(days), [today, days]);
  if (!settings) return null;
  const s = series ?? [];
  const adherence = s.map((d) => ({
    label: d.label,
    protein: d.protein ? Math.round((d.protein / settings.nutrition.protein) * 100) : 0,
    calories: d.calories ? Math.round((d.calories / settings.nutrition.calories) * 100) : 0,
    completion: Math.round(d.completion * 100),
    weight: d.weight,
    water: d.water,
    steps: d.steps,
  }));

  return (
    <Screen back title="Advanced stats">
      <Segmented
        className="mt-2"
        value={range}
        onChange={setRange}
        options={[
          { value: '14', label: '14 days' },
          { value: '30', label: '30 days' },
          { value: '90', label: '90 days' },
        ]}
      />
      <SectionTitle>Progress</SectionTitle>
      <ChartCard title="XP over time" data={s} xKey="label" series={[{ key: 'xp', label: 'XP', color: 'var(--lf-xp)' }]} kind="bar" />
      <ChartCard title="Completion rate" subtitle="Share of the day's quests completed" data={adherence} xKey="label" series={[{ key: 'completion', label: 'Completion %', color: 'var(--lf-accent)' }]} format={(v) => `${v}%`} />
      <ChartCard title="Streak history" data={s} xKey="label" series={[{ key: 'streak', label: 'Streak', color: 'var(--lf-streak)' }]} />

      <SectionTitle>Body & movement</SectionTitle>
      <ChartCard title="Weight trend" subtitle="kg · trend matters, not single days" data={adherence.filter((d) => d.weight)} xKey="label" series={[{ key: 'weight', label: 'Weight', color: 'var(--lf-accent)' }]} format={(v) => v.toFixed(1)} empty="Log your weight a few times a week." />
      <ChartCard title="Steps" data={adherence} xKey="label" series={[{ key: 'steps', label: 'Steps', color: 'var(--lf-accent)' }]} kind="bar" reference={{ y: settings.steps.ideal, label: 'ideal' }} />
      <ChartCard title="Workout volume" subtitle="kg lifted per session" data={volume ?? []} xKey="label" series={[{ key: 'volume', label: 'Volume', color: 'var(--lf-accent)' }]} kind="bar" empty="Finish a workout to see volume." />

      <SectionTitle>Nutrition & hydration</SectionTitle>
      <ChartCard title="Protein adherence" data={adherence} xKey="label" series={[{ key: 'protein', label: 'Protein % of target', color: 'var(--lf-accent)' }]} kind="bar" reference={{ y: 100, label: 'target' }} format={(v) => `${v}%`} />
      <ChartCard title="Calorie adherence" subtitle="100% = on target" data={adherence} xKey="label" series={[{ key: 'calories', label: 'Calories % of target', color: 'var(--lf-accent)' }]} kind="bar" reference={{ y: 100, label: 'target' }} format={(v) => `${v}%`} />
      <ChartCard title="Hydration" data={adherence} xKey="label" series={[{ key: 'water', label: 'Water (ml)', color: 'var(--lf-energy)' }]} kind="bar" reference={{ y: settings.hydration.targetMl, label: 'target' }} />

      <SectionTitle>Category performance</SectionTitle>
      <Card className="space-y-2.5">
        {(categories ?? []).slice(0, 12).map((c) => (
          <div key={c.category}>
            <div className="flex justify-between text-[13px]">
              <span className="font-semibold">
                {CATEGORY_INFO[c.category].icon} {CATEGORY_INFO[c.category].label}
              </span>
              <span className="num text-muted">
                {c.done}/{c.total} · {Math.round(c.rate * 100)}%
              </span>
            </div>
            <ProgressBar value={c.rate} height={6} className="mt-1" />
          </div>
        ))}
        {!categories?.length && <div className="text-[13px] text-muted">No quest history yet.</div>}
      </Card>
    </Screen>
  );
}
