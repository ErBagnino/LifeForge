import { WorkStatsCard } from './WorkStatsCard';
import { useNavigate } from 'react-router';
import { ChartCard } from '@/components/charts/ChartCard';
import { Screen } from '@/components/layout/Screen';
import { List, Row } from '@/components/ui/forms';
import { Card, Kpi, SectionTitle } from '@/components/ui/primitives';
import { useAsync } from '@/hooks';
import { clock } from '@/services/clock';
import { dailySeries, getInsights } from '@/services/insightsService';
import { useGame } from '@/store/gameStore';
import { shiftDate } from '@/utils/date';
import { formatCompact, formatInt } from '@/utils/format';
import { mean } from '@/utils/math';

export default function StatsScreen() {
  const navigate = useNavigate();
  const player = useGame((s) => s.player);
  const today = clock.today();
  const { data: series } = useAsync(() => dailySeries(shiftDate(today, -13), today), [today]);
  const { data: insights } = useAsync(() => getInsights(), [today]);
  if (!player) return null;
  const week = series?.slice(-7) ?? [];
  const scored = week.filter((d) => d.score > 0);
  const avg = scored.length ? Math.round(mean(scored.map((d) => d.score))) : 0;
  const weekXp = week.reduce((s, d) => s + d.xp, 0);
  const steps = week.filter((d) => d.steps > 0);

  return (
    <Screen hud>
      <h1 className="mt-4 text-[30px] leading-tight font-extrabold tracking-tight">Stats</h1>
      <SectionTitle>This week</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Avg score" value={avg || '—'} icon="🎯" />
        <Kpi label="XP gained" value={formatCompact(weekXp)} icon="✨" color="var(--lf-xp)" />
        <Kpi label="Streak" value={`${player.streak.current} d`} sub={player.streak.current === 0 && player.streak.brokenValue ? `last run ${player.streak.brokenValue} · best ${player.streak.longest}` : `best ${player.streak.longest} · weekly ${player.streak.weekly.current}`} icon="🔥" />
        <Kpi label="Avg steps" value={steps.length ? formatInt(mean(steps.map((d) => d.steps))) : '—'} icon="👟" />
      </div>

      {!!insights?.length && (
        <>
          <SectionTitle>Coach</SectionTitle>
          <Card className="space-y-3">
            {insights.slice(0, 4).map((i) => (
              <div key={i.id} className="flex gap-3">
                <span className="text-[20px]" aria-hidden>
                  {i.icon}
                </span>
                <p className="text-[14px] leading-snug">{i.text}</p>
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Last 14 days</SectionTitle>
      <ChartCard title="Today Score" data={series ?? []} xKey="label" series={[{ key: 'score', label: 'Score', color: 'var(--lf-accent)' }]} kind="bar" reference={{ y: 70, label: 'streak line' }} />
      <ChartCard title="XP earned" data={series ?? []} xKey="label" series={[{ key: 'xp', label: 'XP', color: 'var(--lf-xp)' }]} kind="bar" />

      <WorkStatsCard />

      <List title="Dig deeper">
        <Row icon="📅" title="Calendar" subtitle="Every day, with history" onClick={() => navigate('/stats/calendar')} />
        <Row icon="📈" title="Advanced stats" subtitle="Weight, steps, nutrition, workouts, categories" onClick={() => navigate('/stats/advanced')} />
        <Row icon="🏆" title="Personal records" onClick={() => navigate('/stats/records')} />
        <Row icon="🗓️" title="Weekly review" subtitle="This week as a chapter" onClick={() => navigate('/review/week')} />
        <Row icon="📜" title="Daily recap" onClick={() => navigate('/review/day')} />
        <Row icon="🏅" title="Achievements" onClick={() => navigate('/achievements')} />
        <Row icon="🧙" title="Character" subtitle="Class & stats" onClick={() => navigate('/profile')} />
      </List>
    </Screen>
  );
}
