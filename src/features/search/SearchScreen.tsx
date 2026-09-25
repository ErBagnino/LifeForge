import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { TextInput } from '@/components/ui/forms';
import { EmptyState } from '@/components/ui/primitives';
import { useAsync } from '@/hooks';
import { globalSearch, type SearchResult } from '@/services/searchService';

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  activity: 'Activities',
  exercise: 'Exercises',
  achievement: 'Achievements',
  building: 'World',
  stat: 'Stats',
  page: 'Pages',
};

export default function SearchScreen() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const { data } = useAsync(() => globalSearch(deferred), [deferred], { live: false });
  const grouped = new Map<SearchResult['kind'], SearchResult[]>();
  for (const r of data ?? []) grouped.set(r.kind, [...(grouped.get(r.kind) ?? []), r]);
  return (
    <Screen back title="Search">
      <TextInput value={q} onChange={setQ} placeholder="Activities, exercises, achievements, rooms…" type="search" autoFocus aria-label="Search" className="mt-2" />
      {deferred.length < 2 && <p className="mt-4 px-1 text-[14px] text-muted">Type at least 2 letters. Try “water”, “chest”, “streak”, “gym”…</p>}
      {deferred.length >= 2 && !data?.length && (
        <div className="mt-4">
          <EmptyState icon="🔍" title="Nothing found" />
        </div>
      )}
      {[...grouped.entries()].map(([kind, list]) => (
        <div key={kind} className="mt-5">
          <div className="mb-1.5 px-1 text-[13px] font-bold text-muted uppercase">{KIND_LABEL[kind]}</div>
          <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
            {list.map((r) => (
              <button key={`${r.kind}${r.id}`} type="button" onClick={() => navigate(r.route)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2">
                <span className="text-[22px]">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{r.title}</span>
                  <span className="block truncate text-[12px] text-muted">{r.subtitle}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Screen>
  );
}
