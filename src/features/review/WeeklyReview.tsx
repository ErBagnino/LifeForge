import { useEffect, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/progress';
import { Card, Kpi, SectionTitle } from '@/components/ui/primitives';
import { CATEGORY_INFO } from '@/data/categories';
import { useAsync } from '@/hooks';
import { markReviewed } from '@/services/adminService';
import { clock } from '@/services/clock';
import { resolveText } from '@/services/game/questFactory';
import { weeklyReview } from '@/services/insightsService';
import { useGame } from '@/store/gameStore';
import type { ActivityCategory } from '@/types';
import { formatDate, shiftDate, weekStart } from '@/utils/date';
import { formatCompact, formatInt } from '@/utils/format';

export default function WeeklyReview() {
  const act = useGame((s) => s.act);
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const [anchor, setAnchor] = useState(clock.today());
  const { data } = useAsync(() => weeklyReview(anchor), [anchor]);
  useEffect(() => {
    void act(markReviewed('weekly'));
  }, [act]);
  if (!data) return null;
  const delta = data.avgScore !== null && data.prevAvgScore !== null ? data.avgScore - data.prevAvgScore : null;
  const recs: string[] = [];
  if (data.coreRate !== null && data.coreRate < 0.7) recs.push('Protect the core: fewer side quests until core completion is back above 70%.');
  if (data.weakest) recs.push(`Give ${CATEGORY_INFO[data.weakest].label.toLowerCase()} one small win early in the day.`);
  if (data.workouts < 2) recs.push('Schedule workouts at your learned best time — the reminder will follow.');
  if ((data.avgSteps ?? 0) > 0 && (data.avgSteps ?? 0) < 5000) recs.push('Add one 10-minute walk after lunch or dinner.');
  if (!recs.length) recs.push('Keep the rhythm. Small upgrades, same consistency.');

  return (
    <Screen back title="Weekly review" subtitle={`${formatDate(data.from, 'd MMM')} – ${formatDate(data.to, 'd MMM')} · a new chapter every Monday`}>
      <div className="mt-2 flex justify-between">
        <button type="button" onClick={() => setAnchor(shiftDate(anchor, -7))} className="flex h-11 items-center gap-1 rounded-full bg-surface px-3.5 text-[14px] font-semibold shadow-card">
          <Icon name="chevronLeft" size={16} /> Previous
        </button>
        {weekStart(shiftDate(anchor, 7)) <= clock.today() && (
          <button type="button" onClick={() => setAnchor(shiftDate(anchor, 7))} className="flex h-11 items-center gap-1 rounded-full bg-surface px-3.5 text-[14px] font-semibold shadow-card">
            Next <Icon name="chevronRight" size={16} />
          </button>
        )}
      </div>
      <SectionTitle>Numbers</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Average score" value={data.avgScore ?? '—'} sub={delta !== null ? `${delta >= 0 ? '+' : ''}${delta} vs last week` : undefined} icon="🎯" />
        <Kpi label="Consistency" value={`${Math.round(data.consistency * 7)}/7`} sub="successful days" icon="🔁" />
        <Kpi label="XP gained" value={formatCompact(data.xp)} icon="✨" color="var(--lf-xp)" />
        <Kpi label="Coins earned" value={formatCompact(data.coins)} icon="🪙" color="var(--lf-coin)" />
        <Kpi label="Workouts" value={data.workouts} icon="🏋️" />
        <Kpi label="Steps" value={formatCompact(data.steps)} sub={data.avgSteps ? `${formatInt(data.avgSteps)}/day` : undefined} icon="👟" />
      </div>
      {data.weightTrend !== undefined && (
        <Card className="mt-2 text-[14px]">
          ⚖️ Weight trend: <span className="num font-bold">{data.weightTrend > 0 ? '+' : ''}{data.weightTrend.toFixed(2)} kg/week</span>
        </Card>
      )}
      <SectionTitle>Categories</SectionTitle>
      <Card className="space-y-2">
        {data.strongest && (
          <div className="text-[14px]">
            💪 Strongest: <span className="font-bold">{CATEGORY_INFO[data.strongest].label}</span>
          </div>
        )}
        {data.weakest && (
          <div className="text-[14px]">
            🧭 Weakest: <span className="font-bold">{CATEGORY_INFO[data.weakest].label}</span>
          </div>
        )}
        {Object.entries(data.byCategory)
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, 8)
          .map(([c, v]) => (
            <div key={c}>
              <div className="flex justify-between text-[12px]">
                <span>
                  {CATEGORY_INFO[c as ActivityCategory].icon} {CATEGORY_INFO[c as ActivityCategory].label}
                </span>
                <span className="num text-muted">
                  {v.done}/{v.total}
                </span>
              </div>
              <ProgressBar value={v.done / v.total} height={5} className="mt-1" />
            </div>
          ))}
      </Card>
      {data.achievements.length > 0 && (
        <>
          <SectionTitle>Achievements</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {data.achievements.map((a) => (
              <span key={a.id} className="rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold shadow-card">
                {a.icon} {resolveText(a.name, pet)}
              </span>
            ))}
          </div>
        </>
      )}
      <SectionTitle>Coach insights</SectionTitle>
      <Card className="space-y-3">
        {data.insights.slice(0, 5).map((i) => (
          <div key={i.id} className="flex gap-3 text-[14px]">
            <span>{i.icon}</span>
            <span>{i.text}</span>
          </div>
        ))}
        {!data.insights.length && <div className="text-[13px] text-muted">Play a few more days for insights.</div>}
      </Card>
      <SectionTitle>Recommendations</SectionTitle>
      <Card className="space-y-2">
        {recs.map((r, i) => (
          <div key={i} className="flex gap-2 text-[14px]">
            <span>👉</span>
            <span>{r}</span>
          </div>
        ))}
      </Card>
    </Screen>
  );
}
