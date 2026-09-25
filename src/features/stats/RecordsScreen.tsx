import { Screen } from '@/components/layout/Screen';
import { Card, EmptyState, SectionTitle } from '@/components/ui/primitives';
import { useAsync } from '@/hooks';
import { statsRepository } from '@/repositories';
import { useGame } from '@/store/gameStore';
import type { PersonalRecord } from '@/types';
import { formatDate } from '@/utils/date';
import { formatInt } from '@/utils/format';

const GROUPS: { title: string; kinds: PersonalRecord['kind'][] }[] = [
  { title: 'Max weight', kinds: ['exercise_weight'] },
  { title: 'Max reps / longest hold', kinds: ['exercise_reps'] },
  { title: 'Session volume', kinds: ['exercise_volume'] },
  { title: 'Steps', kinds: ['steps_day', 'steps_week'] },
];

export default function RecordsScreen() {
  const player = useGame((s) => s.player);
  const { data } = useAsync(async () => ({ records: await statsRepository.records(), counters: await statsRepository.counters() }), []);
  if (!data || !player) return null;
  return (
    <Screen back title="Personal records" subtitle="Every PR can unlock achievements.">
      <SectionTitle>Consistency</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Card>
          <div className="text-[12px] text-muted">Longest streak</div>
          <div className="num text-[26px] font-extrabold">🔥 {player.streak.longest}</div>
        </Card>
        <Card>
          <div className="text-[12px] text-muted">Best Today Score</div>
          <div className="num text-[26px] font-extrabold">🎯 {data.counters['record.score'] ?? 0}</div>
        </Card>
        <Card>
          <div className="text-[12px] text-muted">Best core run</div>
          <div className="num text-[26px] font-extrabold">🧱 {data.counters['days.perfectCoreRunBest'] ?? 0}</div>
        </Card>
        <Card>
          <div className="text-[12px] text-muted">Longest weekly streak</div>
          <div className="num text-[26px] font-extrabold">📆 {player.streak.weekly.longest}</div>
        </Card>
      </div>
      {!data.records.length && <div className="mt-4"><EmptyState icon="🏆" title="No records yet" body="Finish workouts and log steps — the first ones set the baseline." /></div>}
      {GROUPS.map((g) => {
        const list = data.records.filter((r) => g.kinds.includes(r.kind)).sort((a, b) => b.updatedAt - a.updatedAt);
        if (!list.length) return null;
        return (
          <div key={g.title}>
            <SectionTitle>{g.title}</SectionTitle>
            <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
              {list.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{r.label.split(' · ')[0]}</div>
                    <div className="text-[12px] text-muted">
                      {formatDate(r.date, 'd MMM yyyy')}
                      {r.previous !== undefined ? ` · previous ${formatInt(r.previous)}` : ''}
                    </div>
                  </div>
                  <div className="num text-[18px] font-extrabold">
                    {formatInt(r.value)} <span className="text-[12px] text-muted">{r.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Screen>
  );
}
