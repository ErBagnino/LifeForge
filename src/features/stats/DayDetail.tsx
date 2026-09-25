import { Card, Chip, Kpi, SectionTitle } from '@/components/ui/primitives';
import { useAsync } from '@/hooks';
import { dailyRecap } from '@/services/insightsService';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { ISODate } from '@/types';
import { formatInt, formatMl } from '@/utils/format';

/** Full history of one day. */
export function DayDetail({ date }: { date: ISODate }) {
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const { data, loading } = useAsync(() => dailyRecap(date), [date]);
  if (loading && !data) return <div className="py-8 text-center text-muted">Loading…</div>;
  if (!data?.log && !data?.quests.length) return <div className="rounded-3xl bg-surface-2 p-6 text-center text-[14px] text-muted">No data for this day.</div>;
  const { log, quests, achievements, sessions } = data;
  const m = log?.metrics ?? {};
  const done = quests.filter((q) => q.status === 'completed');
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Score" value={log?.score ?? 0} icon="🎯" />
        <Kpi label="XP" value={`+${formatInt(log?.xp ?? 0)}`} color="var(--lf-xp)" />
        <Kpi label="Coins" value={`+${formatInt(log?.coins ?? 0)}`} color="var(--lf-coin)" />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip>
          {log?.core.done ?? 0}/{log?.core.total ?? 0} core
        </Chip>
        <Chip>
          {done.length}/{quests.filter((q) => q.status !== 'moved').length} quests
        </Chip>
        {log?.success && <Chip color="#30d158">streak day 🔥 {log.streak}</Chip>}
        {log?.restDay && <Chip>🛌 rest day</Chip>}
        {log?.sick && <Chip>🤒 sick</Chip>}
        {!!log?.worldIncome && <Chip color="#f5a400">🏰 +{log.worldIncome}</Chip>}
      </div>
      {(m.steps || m.water || m.calories || m.leisure || m.weight || m.sleep) && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {m.steps !== undefined && <Kpi label="Steps" value={formatInt(m.steps)} icon="👟" />}
          {m.water !== undefined && <Kpi label="Water" value={formatMl(m.water)} icon="💧" />}
          {m.calories !== undefined && <Kpi label="Calories" value={formatInt(m.calories)} icon="🔥" />}
          {m.protein !== undefined && <Kpi label="Protein" value={`${formatInt(m.protein)} g`} icon="🥩" />}
          {m.weight !== undefined && <Kpi label="Weight" value={`${m.weight} kg`} icon="⚖️" />}
          {m.sleep !== undefined && <Kpi label="Sleep" value={`${m.sleep} h`} icon="😴" />}
          {m.leisure !== undefined && <Kpi label="Play time" value={`${Math.round(m.leisure)} min`} icon="🎮" />}
        </div>
      )}
      {achievements.length > 0 && (
        <>
          <SectionTitle>Achievements</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {achievements.map((a) => (
              <Chip key={a.id} icon={a.icon}>
                {resolveText(a.name, pet)}
              </Chip>
            ))}
          </div>
        </>
      )}
      {sessions.length > 0 && (
        <>
          <SectionTitle>Training</SectionTitle>
          {sessions.map((s) => (
            <Card key={s.id} className="mb-2 !p-3 text-[14px]">
              {s.kind === 'cardio' ? '🏃' : '🏋️'} {s.name} · {s.kind === 'cardio' ? `${s.cardio?.durationMin} min` : `${s.exercises.flatMap((e) => e.sets.filter((x) => x.completed)).length} sets`}
            </Card>
          ))}
        </>
      )}
      <SectionTitle>Quests</SectionTitle>
      <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
        {quests
          .filter((q) => q.status !== 'moved' && !(q.hidden && q.status !== 'completed'))
          .map((q) => (
            <div key={q.id} className="flex items-center gap-2.5 px-4 py-2.5 text-[14px]">
              <span className="w-5 text-center">{q.status === 'completed' ? '✅' : q.status === 'skipped' ? '⏭️' : '❌'}</span>
              <span aria-hidden>{q.icon}</span>
              <span className="flex-1 truncate">{resolveText(q.title, pet)}</span>
              {q.status === 'completed' && <span className="num text-[12px] text-muted">{q.actualTime}</span>}
            </div>
          ))}
      </div>
      {!!log?.penalties.length && (
        <>
          <SectionTitle>Consequences</SectionTitle>
          <Card className="space-y-1 text-[13px]">
            {log.penalties.map((p, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted">{p.reason}</span>
                <span className="num font-semibold">{p.amount ? `${p.amount} ${p.kind === 'hp' ? 'HP' : p.kind === 'coins' ? '🪙' : ''}` : ''}</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
