import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { TextInput, Toggle } from '@/components/ui/forms';
import { Button, Chip, cx } from '@/components/ui/primitives';
import { CATEGORY_INFO, TIER_INFO } from '@/data/categories';
import { describeRecurrence } from '@/domain/recurrence';
import { useAsync } from '@/hooks';
import { activityRepository } from '@/repositories';
import { saveActivity } from '@/services/adminService';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { QuestTier } from '@/types';

export default function ActivitiesAdmin() {
  const navigate = useNavigate();
  const act = useGame((s) => s.act);
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<QuestTier | 'all' | 'paused' | 'custom'>('all');
  const { data, reload } = useAsync(() => activityRepository.all(), []);
  const list = useMemo(
    () =>
      (data ?? [])
        .filter((a) => {
          if (tier === 'paused') return !a.active;
          if (tier === 'custom') return a.userCreated;
          return tier === 'all' || a.tier === tier;
        })
        .filter((a) => resolveText(a.name, pet).toLowerCase().includes(q.toLowerCase()) || a.category.includes(q.toLowerCase()))
        .sort((a, b) => (a.tier === b.tier ? a.name.localeCompare(b.name) : ['core', 'important', 'optional'].indexOf(a.tier) - ['core', 'important', 'optional'].indexOf(b.tier))),
    [data, q, tier, pet],
  );
  return (
    <Screen back title="Activities" subtitle={`${data?.length ?? 0} total`} right={<Button size="sm" icon="plus" onClick={() => navigate('/admin/activities/new')}>New</Button>}>
      <TextInput value={q} onChange={setQ} placeholder="Search…" type="search" aria-label="Search activities" className="mt-2" />
      <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4">
        {(['all', 'core', 'important', 'optional', 'paused', 'custom'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTier(t)} className={cx('h-11 shrink-0 rounded-full px-3.5 text-[13px] font-semibold capitalize', tier === t ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}>
            {t === 'optional' ? 'side / pool' : t}
          </button>
        ))}
      </div>
      <div className="mt-3 divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
        {list.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-3 py-2.5">
            <button type="button" onClick={() => navigate(`/admin/activities/${a.id}`)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
              <span className={cx('text-[22px]', !a.active && 'opacity-40 grayscale')}>{a.icon}</span>
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate text-[15px] font-semibold', !a.active && 'text-muted line-through')}>{resolveText(a.name, pet)}</span>
                <span className="flex items-center gap-1.5 truncate text-[12px] text-muted">
                  <Chip color={TIER_INFO[a.tier].color}>{TIER_INFO[a.tier].label}</Chip>
                  {CATEGORY_INFO[a.category].label} · {describeRecurrence(a)}
                  {a.aiImported && ' · 🤖'}
                </span>
              </span>
            </button>
            <Toggle
              checked={a.active}
              label={`${a.name} active`}
              onChange={async (v) => {
                await act(saveActivity({ ...a, active: v }));
                reload();
              }}
            />
          </div>
        ))}
      </div>
    </Screen>
  );
}
