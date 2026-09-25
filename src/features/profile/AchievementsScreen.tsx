import { useMemo, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Segmented } from '@/components/ui/forms';
import { ProgressBar } from '@/components/ui/progress';
import { SectionTitle, cx } from '@/components/ui/primitives';
import { conditionProgress } from '@/domain/achievements';
import { derivedCounters, mergeCounters } from '@/domain/counters';
import { useAsync, useLevel } from '@/hooks';
import { achievementRepository, statsRepository } from '@/repositories';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { AchievementCategory } from '@/types';

const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  first_steps: 'First steps',
  training: 'Training',
  nutrition: 'Nutrition',
  hydration: 'Hydration',
  walking: 'Walking',
  running: 'Running',
  home: 'Home',
  pet: 'Pet',
  routine: 'Routine',
  consistency: 'Consistency',
  tycoon: 'Tycoon',
  level: 'Level',
  coins: 'Coins',
  xp: 'XP',
  hidden: 'Hidden',
  long_term: 'Long-term',
  records: 'Records',
};

const TIER_COLOR = { bronze: '#cd7f32', silver: '#aab4c0', gold: '#e8b400', platinum: '#5ad1f5' };

export default function AchievementsScreen() {
  const player = useGame((s) => s.player);
  const buildings = useGame((s) => s.buildings);
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const { level } = useLevel();
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');
  const { data } = useAsync(async () => ({ list: await achievementRepository.all(), counters: await statsRepository.counters() }), []);
  const counters = useMemo(() => (data && player ? mergeCounters(data.counters, derivedCounters(player, buildings, level)) : {}), [data, player, buildings, level]);
  if (!data || !player) return null;
  const unlocked = data.list.filter((a) => a.unlockedAt).length;
  const grouped = new Map<AchievementCategory, typeof data.list>();
  for (const a of data.list) {
    if (filter === 'unlocked' && !a.unlockedAt) continue;
    if (filter === 'locked' && a.unlockedAt) continue;
    grouped.set(a.category, [...(grouped.get(a.category) ?? []), a]);
  }

  return (
    <Screen back title="Achievements" subtitle={`${unlocked} / ${data.list.length} unlocked`}>
      <ProgressBar value={unlocked / data.list.length} className="mt-2" height={8} />
      <Segmented
        className="mt-3"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unlocked', label: 'Unlocked' },
          { value: 'locked', label: 'Locked' },
        ]}
      />
      {[...grouped.entries()].map(([cat, list]) => (
        <div key={cat}>
          <SectionTitle>
            {CATEGORY_LABEL[cat]} · {list.filter((a) => a.unlockedAt).length}/{list.length}
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {list.map((a) => {
              const secret = a.hidden && !a.unlockedAt;
              const p = conditionProgress(a.condition, counters);
              return (
                <div key={a.id} className={cx('rounded-3xl bg-surface p-3 shadow-card', !a.unlockedAt && 'opacity-80')}>
                  <div className="flex items-start justify-between">
                    <span className={cx('flex h-12 w-12 items-center justify-center rounded-2xl text-[26px]', !a.unlockedAt && 'grayscale')} style={{ background: a.unlockedAt ? `color-mix(in srgb, ${TIER_COLOR[a.tier]} 22%, transparent)` : 'var(--lf-surface-2)' }}>
                      {secret ? '❔' : a.icon}
                    </span>
                    <span className="text-[10px] font-extrabold uppercase" style={{ color: TIER_COLOR[a.tier] }}>
                      {a.tier}
                    </span>
                  </div>
                  <div className="mt-2 text-[14px] leading-tight font-bold uppercase">{secret ? 'Hidden' : resolveText(a.name, pet)}</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-muted">{secret ? 'Keep playing to discover it.' : resolveText(a.description, pet)}</div>
                  {!a.unlockedAt && !secret && (
                    <div className="mt-2">
                      <ProgressBar value={p.ratio} height={4} />
                      <div className="num mt-0.5 text-[10px] text-muted">
                        {Math.floor(p.current).toLocaleString('en-US')}/{p.target.toLocaleString('en-US')}
                      </div>
                    </div>
                  )}
                  <div className="num mt-1.5 text-[11px] font-bold">
                    {a.unlockedAt ? (
                      <span className="text-success">✓ {new Date(a.unlockedAt).toLocaleDateString()}</span>
                    ) : (
                      <span className="text-muted">
                        +{a.xp} XP · +{a.coins} 🪙
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Screen>
  );
}
