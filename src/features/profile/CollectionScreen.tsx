import { useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Segmented } from '@/components/ui/forms';
import { EmptyState, Skeleton, cx } from '@/components/ui/primitives';
import { RARITY_INFO } from '@/data/categories';
import { pastSeasonBadges, seasonFor } from '@/domain/season';
import { priceRarity } from '@/domain/world';
import { useAsync } from '@/hooks';
import { achievementRepository, metaRepository, statsRepository, tycoonRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { resolveText } from '@/services/game/questFactory';
import { loadMastery } from '@/services/progressService';
import { useGame } from '@/store/gameStore';
import type { ISODate } from '@/types';

type Tab = 'badges' | 'style' | 'rooms' | 'titles' | 'seasons';

interface Item {
  id: string;
  icon: string;
  label: string;
  owned: boolean;
  /** Undiscovered items show only a silhouette. */
  secret?: boolean;
  sub?: string;
  color?: string;
}

/** Everything you've collected, with silhouettes for what's still undiscovered. Real counts only. */
export default function CollectionScreen() {
  const [tab, setTab] = useState<Tab>('badges');
  const buildings = useGame((s) => s.buildings);
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const { data } = useAsync(async () => {
    const [achievements, cosmetics, mastery, start] = await Promise.all([achievementRepository.all(), tycoonRepository.cosmetics.all(), loadMastery(), metaRepository.get<ISODate>('adventureStart')]);
    const today = clock.today();
    const logs = start ? await statsRepository.logs(start, today) : [];
    const seasons = start ? [...pastSeasonBadges(start, today, logs), (() => { const s = seasonFor(start, today, logs); const b = s.reached.at(-1); return { n: s.n, name: `${s.name} (now)`, badge: b?.badge, icon: b?.icon }; })()] : [];
    return { achievements, cosmetics, mastery, seasons };
  }, []);

  if (!data) {
    return (
      <Screen back title="Collection">
        <Skeleton className="mt-3 h-40" />
      </Screen>
    );
  }

  const lists: Record<Tab, Item[]> = {
    badges: data.achievements.map((a) => ({ id: a.id, icon: a.icon, label: resolveText(a.name, pet), owned: !!a.unlockedAt, secret: a.hidden && !a.unlockedAt, sub: a.tier })),
    style: data.cosmetics.filter((c) => c.price > 0 && c.type !== 'skin').map((c) => ({ id: c.id, icon: c.type === 'decoration' ? c.value : c.type === 'hairColor' || c.type === 'outfitColor' || c.type === 'background' ? '🎨' : c.icon, label: c.name, owned: c.owned, sub: RARITY_INFO[priceRarity(c.price)].label, color: RARITY_INFO[priceRarity(c.price)].color })),
    rooms: buildings.flatMap((b) => Array.from({ length: b.maxLevel }, (_, i) => ({ id: `${b.id}:${i + 1}`, icon: b.icon, label: `${b.name} Lv ${i + 1}`, owned: b.level > i }))),
    titles: data.mastery.flatMap((t) => t.perks.map((p) => ({ id: p.id, icon: t.icon, label: p.title, owned: p.unlocked, sub: `${t.label} ${p.level}` }))),
    seasons: data.seasons.map((s) => ({ id: `s${s.n}`, icon: s.icon ?? '🎖️', label: `Season ${s.n} · ${s.name}`, owned: !!s.badge, sub: s.badge ?? 'no badge' })),
  };
  const items = lists[tab];
  const owned = items.filter((i) => i.owned).length;

  return (
    <Screen back title="Collection" subtitle="Earned by playing — never by chance.">
      <Segmented
        className="mt-3"
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'badges', label: 'Badges' },
          { value: 'style', label: 'Style' },
          { value: 'rooms', label: 'Rooms' },
          { value: 'titles', label: 'Titles' },
          { value: 'seasons', label: 'Seasons' },
        ]}
      />
      <div className="num mt-3 px-1 text-[13px] font-semibold text-muted">
        {owned} of {items.length} collected
      </div>
      {!items.length ? (
        <EmptyState icon="🧭" title="Nothing here yet" body="Keep playing — this fills up with real milestones." />
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-2 min-[480px]:grid-cols-4">
          {items.map((i) => (
            <div key={i.id} className={cx('flex flex-col items-center rounded-3xl bg-surface p-3 text-center shadow-card', !i.owned && 'opacity-70')} style={i.owned && i.color ? { boxShadow: `inset 0 0 0 1.5px ${i.color}55, var(--lf-shadow)` } : undefined} aria-label={`${i.secret ? 'Undiscovered' : i.label}${i.owned ? ', collected' : ', not yet'}`}>
              <span className={cx('text-[28px] leading-9', !i.owned && 'brightness-0 opacity-30 dark:invert')} aria-hidden>
                {i.secret ? '❔' : i.icon}
              </span>
              <span className="mt-1 line-clamp-2 text-[11px] leading-tight font-semibold">{i.secret ? '???' : i.label}</span>
              {i.sub && !i.secret && (
                <span className="mt-0.5 text-[10px] font-bold uppercase" style={i.color ? { color: i.color } : undefined}>
                  <span className={i.color ? '' : 'text-muted'}>{i.sub}</span>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
