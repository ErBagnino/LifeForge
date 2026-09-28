import { useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Segmented } from '@/components/ui/forms';
import { ProgressBar } from '@/components/ui/progress';
import { Card, EmptyState, SectionTitle, Skeleton, cx } from '@/components/ui/primitives';
import type { MilestoneKind } from '@/domain/journey';
import { useAsync } from '@/hooks';
import { loadJourney } from '@/services/progressService';
import { formatDate } from '@/utils/date';

const FILTERS: { value: 'all' | 'progress' | 'achievements' | 'world'; label: string; kinds: MilestoneKind[] | null }[] = [
  { value: 'all', label: 'All', kinds: null },
  { value: 'progress', label: 'Progress', kinds: ['start', 'chapter', 'level', 'streak', 'workout', 'comeback', 'record'] },
  { value: 'achievements', label: 'Badges', kinds: ['achievement'] },
  { value: 'world', label: 'World', kinds: ['building'] },
];

/** The Journey: chapters of the run and a timeline of real milestones. */
export default function JourneyScreen() {
  const { data, loading } = useAsync(() => loadJourney(), []);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all');
  const [limit, setLimit] = useState(40);

  if (loading && !data) {
    return (
      <Screen back title="Journey">
        <Skeleton className="mt-3 h-28" />
        <Skeleton className="mt-2 h-40" />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen back title="Journey">
        <EmptyState icon="🧭" title="Your journey hasn’t started" body="Finish onboarding and your first day will appear here." />
      </Screen>
    );
  }
  const current = data.chapters[data.chapters.length - 1];
  const kinds = FILTERS.find((f) => f.value === filter)!.kinds;
  const milestones = data.milestones.filter((m) => !kinds || kinds.includes(m.kind));
  let lastMonth = '';

  return (
    <Screen back title="Journey" subtitle={`Day ${data.adventureDay} of your adventure`}>
      <Card className="mt-3">
        <div className="text-[12px] font-semibold text-muted uppercase">Chapter {current.n} · now</div>
        <div className="mt-0.5 text-[22px] font-extrabold">{current.title}</div>
        <ProgressBar value={current.daysElapsed / current.length} height={8} className="mt-2" label="Chapter progress" />
        <div className="num mt-1 text-[12px] text-muted">
          Day {current.daysElapsed} of {current.length} · {current.activeDays} active · {current.successDays} successful
        </div>
      </Card>

      {data.chapters.length > 1 && (
        <>
          <SectionTitle>Past chapters</SectionTitle>
          <div className="space-y-2">
            {[...data.chapters].reverse().slice(1).map((c) => (
              <Card key={c.n} className="!p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-bold">
                    {c.n}. {c.title}
                  </span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {formatDate(c.start, 'd MMM')} – {formatDate(c.end, 'd MMM')}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
                  <Mini label="Active" value={`${c.activeDays}/${c.length}`} />
                  <Mini label="Success" value={String(c.successDays)} />
                  <Mini label="Best streak" value={String(c.bestStreak)} />
                  <Mini label="Avg score" value={c.avgScore === null ? '—' : String(c.avgScore)} />
                </div>
                <div className="mt-1.5 text-[12px] text-muted">
                  {c.questsDone} quests · {c.workouts} workouts{c.levelsGained ? ` · +${c.levelsGained} levels` : ''}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Timeline</SectionTitle>
      <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
      {!milestones.length ? (
        <p className="mt-4 px-1 text-[14px] text-muted">Nothing here yet — it fills up with real milestones as you play.</p>
      ) : (
        <ol className="relative mt-3 ml-3 border-l-2 border-line pl-5">
          {milestones.slice(0, limit).map((m) => {
            const month = formatDate(m.date, 'MMMM yyyy');
            const header = month !== lastMonth;
            lastMonth = month;
            return (
              <li key={m.id} className="relative pb-4">
                {header && <div className="-ml-5 mb-2 pl-5 text-[12px] font-bold tracking-wide text-muted uppercase">{month}</div>}
                <span className={cx('absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full bg-surface text-[13px] shadow-card', header && 'top-7')} aria-hidden>
                  {m.icon}
                </span>
                <div className="text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">{m.title}</div>
                <div className="text-[12px] text-muted">
                  {formatDate(m.date)}
                  {m.detail ? ` · ${m.detail}` : ''}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {milestones.length > limit && (
        <button type="button" className="hit-44 mt-1 w-full rounded-2xl bg-surface-2 py-3 text-[14px] font-semibold" onClick={() => setLimit((l) => l + 40)}>
          Show older ({milestones.length - limit})
        </button>
      )}
    </Screen>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-1 py-1.5">
      <div className="num text-[14px] font-extrabold">{value}</div>
      <div className="text-[10px] leading-tight font-semibold text-muted">{label}</div>
    </div>
  );
}
