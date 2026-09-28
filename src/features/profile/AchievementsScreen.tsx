import { useMemo, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Segmented } from '@/components/ui/forms';
import { ProgressBar } from '@/components/ui/progress';
import { SectionTitle, cx } from '@/components/ui/primitives';
import { achievementPaths, conditionProgress } from '@/domain/achievements';
import { derivedCounters, mergeCounters } from '@/domain/counters';
import { useAsync, useLevel } from '@/hooks';
import { achievementRepository, statsRepository } from '@/repositories';
import { getShowcase, SHOWCASE_MAX, toggleShowcase } from '@/services/progressService';
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
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked' | 'paths'>('all');
  const { data, reload } = useAsync(async () => ({ list: await achievementRepository.all(), counters: await statsRepository.counters(), showcase: await getShowcase() }), []);
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
    <Screen back title="Achievements" subtitle={`${unlocked} / ${data.list.length} unlocked · pin up to ${SHOWCASE_MAX} to your showcase`}>
      <ProgressBar value={unlocked / data.list.length} className="mt-2" height={8} />
      <Segmented
        className="mt-3"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unlocked', label: 'Unlocked' },
          { value: 'locked', label: 'Locked' },
          { value: 'paths', label: 'Paths' },
        ]}
      />
      {filter === 'paths' && (
        <div className="mt-3 space-y-2">
          {achievementPaths(data.list).map((path) => {
            const done = path.filter((a) => a.unlockedAt).length;
            const next = path.find((a) => !a.unlockedAt);
            const p = next ? conditionProgress(next.condition, counters) : undefined;
            return (
              <div key={path[0].id} className="rounded-3xl bg-surface p-3 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-bold">{resolveText(path[path.length - 1].name, pet)} path</span>
                  <span className="num shrink-0 text-[12px] font-semibold text-muted">
                    {done}/{path.length}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1" aria-label={`${done} of ${path.length} steps unlocked`}>
                  {path.map((a, i) => (
                    <span key={a.id} className="flex items-center gap-1">
                      {i > 0 && <span className={cx('h-0.5 w-3 rounded-full', a.unlockedAt ? 'bg-accent' : 'bg-border')} aria-hidden />}
                      <span title={resolveText(a.name, pet)} className={cx('flex h-9 w-9 items-center justify-center rounded-xl text-[18px]', !a.unlockedAt && 'grayscale opacity-60')} style={{ background: a.unlockedAt ? `color-mix(in srgb, ${TIER_COLOR[a.tier]} 22%, transparent)` : 'var(--lf-surface-2)' }}>
                        {a.icon}
                      </span>
                    </span>
                  ))}
                </div>
                {next && p ? (
                  <div className="mt-2">
                    <div className="text-[12px] text-muted">
                      Next: <span className="font-semibold text-fg">{resolveText(next.name, pet)}</span> — {resolveText(next.description, pet)}
                    </div>
                    <ProgressBar value={p.ratio} height={4} className="mt-1" />
                  </div>
                ) : (
                  <div className="mt-2 text-[12px] font-semibold text-success">Path complete ✓</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {filter !== 'paths' && [...grouped.entries()].map(([cat, list]) => (
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
                  <div className="num mt-1.5 flex items-center justify-between gap-1 text-[11px] font-bold">
                    {a.unlockedAt ? (
                      <>
                        <span className="text-success">✓ {new Date(a.unlockedAt).toLocaleDateString()}</span>
                        <button
                          type="button"
                          aria-pressed={data.showcase.includes(a.id)}
                          aria-label={data.showcase.includes(a.id) ? 'Remove from showcase' : 'Pin to showcase'}
                          className={cx('hit-44 rounded-full px-2 py-0.5 text-[11px]', data.showcase.includes(a.id) ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted')}
                          onClick={async () => {
                            await toggleShowcase(a.id);
                            reload();
                          }}
                        >
                          {data.showcase.includes(a.id) ? '📌 Pinned' : 'Pin'}
                        </button>
                      </>
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
