import { useNavigate } from 'react-router';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import { Avatar } from '@/components/game/Avatar';
import { Screen } from '@/components/layout/Screen';
import { List, Row } from '@/components/ui/forms';
import { ProgressBar } from '@/components/ui/progress';
import { Button, Card, Kpi, SectionTitle } from '@/components/ui/primitives';
import { STAT_INFO } from '@/data/categories';
import { classById, computeClassAffinities, statLevel } from '@/domain/classes';
import { useAsync, useLevel } from '@/hooks';
import { questRepository, statsRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { useGame } from '@/store/gameStore';
import type { ActivityCategory, StatKey, StatMap } from '@/types';
import { STAT_KEYS } from '@/types';
import { shiftDate } from '@/utils/date';
import { formatInt } from '@/utils/format';

export default function ProfileScreen() {
  const navigate = useNavigate();
  const player = useGame((s) => s.player);
  const settings = useGame((s) => s.settings);
  const { level, progress } = useLevel();
  const today = clock.today();
  const { data } = useAsync(async () => {
    const [quests, logs, counters] = await Promise.all([questRepository.byRange(shiftDate(today, -30), today), statsRepository.logs(shiftDate(today, -30), today), statsRepository.counters()]);
    const stats: StatMap = {};
    const cats: Partial<Record<ActivityCategory, number>> = {};
    for (const q of quests) {
      if (q.status !== 'completed') continue;
      for (const [k, v] of Object.entries(q.stats)) stats[k as StatKey] = (stats[k as StatKey] ?? 0) + (v ?? 0);
      cats[q.category] = (cats[q.category] ?? 0) + 1;
    }
    const core = logs.reduce((a, l) => ({ d: a.d + l.core.done, t: a.t + l.core.total }), { d: 0, t: 0 });
    return { stats, cats, coreRate: core.t ? core.d / core.t : 0, recoveryDays: logs.filter((l) => l.difficultyState === 'critical').length, counters };
  }, [today]);
  if (!player || !settings) return null;
  const affinities = data ? computeClassAffinities({ stats: data.stats, categoryCounts: data.cats, coreRate: data.coreRate, streak: player.streak.current, recoveryDays: data.recoveryDays + (data.counters['recovery.exits'] ?? 0) * 3, worldSpend: player.lifetime.coinsSpent }) : [];
  const top = affinities[0] ? classById(affinities[0].classId) : classById('balanced');
  const radar = STAT_KEYS.map((k) => ({ stat: STAT_INFO[k].short, value: player.stats[k] }));

  return (
    <Screen back title="Character">
      <Card className="mt-3 flex items-center gap-4">
        <Avatar config={player.avatar} size={84} ring="var(--lf-accent)" />
        <div className="min-w-0 flex-1">
          <div className="text-[22px] font-extrabold">{settings.profile.nickname || player.name}</div>
          <div className="text-[14px] text-muted">Level {level} · {formatInt(player.lifetime.xpEarned)} XP lifetime</div>
          <ProgressBar value={progress} color="var(--lf-xp)" className="mt-2" />
        </div>
      </Card>
      <Button block variant="secondary" className="mt-2" icon="edit" onClick={() => navigate('/world/avatar')}>
        Customize avatar
      </Button>

      <SectionTitle>Current class</SectionTitle>
      <Card>
        <div className="flex items-center gap-3">
          <span className="text-[44px]">{top.icon}</span>
          <div>
            <div className="text-[22px] font-extrabold uppercase">{top.name}</div>
            <div className="text-[13px] text-muted">{top.description}</div>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          {affinities.slice(0, 4).map((a) => {
            const c = classById(a.classId);
            return (
              <div key={a.classId} className="flex items-center gap-2 text-[13px]">
                <span className="w-28 shrink-0">
                  {c.icon} {c.name}
                </span>
                <ProgressBar value={a.affinity / (affinities[0]?.affinity || 1)} height={6} />
                <span className="num w-10 text-right font-semibold">{Math.round(a.affinity * 100)}%</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted">Your class emerges from the last 30 days of behaviour. It changes as you do.</p>
      </Card>

      <SectionTitle>Stats</SectionTitle>
      <Card>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radar} outerRadius="72%">
              <PolarGrid stroke="var(--lf-border)" />
              <PolarAngleAxis dataKey="stat" tick={{ fontSize: 11, fill: 'var(--lf-muted)', fontWeight: 700 }} />
              <Radar dataKey="value" stroke="var(--lf-accent)" fill="var(--lf-accent)" fillOpacity={0.25} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {STAT_KEYS.map((k) => {
            const sl = statLevel(player.stats[k]);
            return (
              <div key={k} className="rounded-2xl bg-surface-2 px-3 py-2">
                <div className="flex justify-between text-[12px] font-semibold">
                  <span>
                    {STAT_INFO[k].icon} {STAT_INFO[k].label}
                  </span>
                  <span className="num">Lv {sl.level}</span>
                </div>
                <ProgressBar value={sl.progress} color={STAT_INFO[k].color} height={4} className="mt-1" />
                <div className="num mt-0.5 text-[11px] text-muted">{formatInt(player.stats[k])} pts</div>
              </div>
            );
          })}
        </div>
      </Card>

      <SectionTitle>Inventory</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Freeze" value={player.inventory.streakFreeze} icon="🧊" />
        <Kpi label="Revive" value={player.inventory.streakRevive} icon="❤️‍🔥" />
        <Kpi label="Reroll" value={player.inventory.reroll} icon="🎲" />
      </div>
      {(player.effects.length > 0 || player.boosts.some((b) => b.expiresAt > clock.now())) && (
        <>
          <SectionTitle>Active effects</SectionTitle>
          <div className="space-y-2">
            {player.effects.filter((e) => e.expiresOn >= today).map((e) => (
              <Card key={e.id} className="!p-3 text-[14px]">
                {e.icon} <span className="font-bold">{e.label}</span> — {e.description}
              </Card>
            ))}
            {player.boosts.filter((b) => b.expiresAt > clock.now()).map((b) => (
              <Card key={b.id} className="!p-3 text-[14px]">
                🚀 <span className="font-bold">{b.type === 'xp' ? 'XP' : 'Coin'} boost ×{b.multiplier}</span> until {new Date(b.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Card>
            ))}
          </div>
        </>
      )}
      <List>
        <Row icon="🏅" title="Achievements" onClick={() => navigate('/achievements')} />
        <Row icon="🏆" title="Personal records" onClick={() => navigate('/stats/records')} />
        <Row icon="⚙️" title="Settings" onClick={() => navigate('/settings')} />
      </List>
    </Screen>
  );
}
