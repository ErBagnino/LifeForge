import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Button, Card, Kpi, SectionTitle, cx } from '@/components/ui/primitives';
import { CATEGORY_INFO } from '@/data/categories';
import { buildBlockers, buildingCost, homeLevel, homeTitle, nextHomeTitle, worldBonuses } from '@/domain/tycoon';
import { useAsync, useLevel, useNow } from '@/hooks';
import { tycoonRepository } from '@/repositories';
import { useGame } from '@/store/gameStore';
import type { ActivityCategory, Building } from '@/types';
import { formatInt } from '@/utils/format';
import { BuildingSheet } from './BuildingSheet';
import { RoomScene } from './RoomScene';

function Blueprint({ b, level, coins, all, onClick }: { b: Building; level: number; coins: number; all: Building[]; onClick: () => void }) {
  const blockers = buildBlockers(b, level, coins, all);
  const lockedByLevel = blockers.find((x) => x.type === 'playerLevel');
  const affordable = blockers.length === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'relative flex h-full w-full flex-col items-center justify-center border-2 border-dashed text-center',
        affordable ? 'border-accent bg-accent/8' : 'border-fg/15 bg-[repeating-linear-gradient(45deg,transparent,transparent_8px,rgba(127,127,127,0.07)_8px,rgba(127,127,127,0.07)_16px)]',
      )}
      aria-label={`${b.name}: ${affordable ? 'ready to build' : 'locked'}`}
    >
      <span className={cx('text-[30px]', !affordable && 'opacity-40 grayscale')}>{b.icon}</span>
      <span className="text-[13px] font-bold">{b.name}</span>
      <span className={cx('num text-[12px] font-semibold', affordable ? 'text-accent' : 'text-muted')}>
        {lockedByLevel && lockedByLevel.type === 'playerLevel' ? `🔒 Level ${lockedByLevel.required}` : `${affordable ? '🔨' : '🔒'} ${formatInt(buildingCost(b, 1))} 🪙`}
      </span>
      {affordable && (
        <motion.span className="absolute top-1.5 right-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-on-accent" animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}>
          BUILD
        </motion.span>
      )}
    </button>
  );
}

export default function WorldScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const buildings = useGame((s) => s.buildings);
  const player = useGame((s) => s.player);
  const { level } = useLevel();
  const now = useNow(60000);
  const hour = new Date(now).getHours();
  const [selected, setSelected] = useState<Building | null>(null);
  const { data: cosmetics } = useAsync(() => tycoonRepository.cosmetics.all(), []);

  useEffect(() => {
    const room = params.get('room');
    if (room) setSelected(buildings.find((b) => b.id === room) ?? null);
  }, [params, buildings]);

  const floors = useMemo(() => {
    const map = new Map<number, Building[]>();
    for (const b of buildings) map.set(b.floor, [...(map.get(b.floor) ?? []), b]);
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [buildings]);

  if (!player) return null;
  const hl = homeLevel(buildings);
  const next = nextHomeTitle(hl);
  const bonus = worldBonuses(buildings);
  const deco = cosmetics ?? [];
  const cheapDeco = deco.find((c) => c.type === 'decoration' && !c.owned && c.price <= player.coins && buildings.find((b) => b.id === c.room)?.level);
  const sky = hour >= 6 && hour < 17 ? 'linear-gradient(#7cc8ff, #cdeeff)' : hour >= 17 && hour < 20 ? 'linear-gradient(#ff8a5b, #ffd29a)' : 'linear-gradient(#0f1330, #28295e)';
  const bestRoom = buildings.filter((b) => b.level > 0).sort((a, b) => b.level - a.level)[0];

  return (
    <Screen hud>
      <div className="mt-4">
        <div className="text-[13px] font-semibold text-muted">Home level {hl}</div>
        <h1 className="text-[30px] leading-tight font-extrabold tracking-tight">{homeTitle(hl)}</h1>
        {next && <div className="text-[12px] text-muted">Next: {next.title} at home level {next.at}</div>}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" icon="edit" onClick={() => navigate('/world/avatar')}>
            Avatar
          </Button>
          <Button size="sm" onClick={() => navigate('/world/shop')}>
            🛍️ Shop
          </Button>
        </div>
      </div>

      {cheapDeco && (
        <Card className="mt-3" onClick={() => setSelected(buildings.find((b) => b.id === cheapDeco.room) ?? null)}>
          <div className="flex items-center gap-3">
            <span className="text-[30px]">{cheapDeco.value}</span>
            <div className="flex-1">
              <div className="text-[12px] font-extrabold tracking-widest text-success">UPGRADE AVAILABLE</div>
              <div className="text-[14px] font-semibold">
                {cheapDeco.name} for your {buildings.find((b) => b.id === cheapDeco.room)?.name} · {cheapDeco.price} 🪙
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="relative mt-4 overflow-hidden rounded-[28px] shadow-card" style={{ background: sky }}>
        {hour >= 20 || hour < 6 ? (
          <div className="pointer-events-none absolute inset-0 text-[10px] text-white/70">
            {['12% 8%', '30% 20%', '70% 6%', '85% 25%', '50% 12%'].map((p) => (
              <span key={p} className="absolute" style={{ left: p.split(' ')[0], top: p.split(' ')[1] }}>
                ✦
              </span>
            ))}
          </div>
        ) : (
          <div className="pointer-events-none absolute top-3 left-4 text-[26px]">☁️</div>
        )}
        <div className="relative mx-auto flex w-[88%] flex-col items-center pt-6">
          <div className="text-[20px]">🚩</div>
          <div className="h-0 w-full border-x-[46px] border-b-[30px] border-x-transparent" style={{ borderBottomColor: 'color-mix(in srgb, var(--lf-accent) 80%, #000)' }} />
        </div>
        <div className="relative mx-auto w-[92%] overflow-hidden rounded-t-lg bg-[#8a7766] p-[5px] pb-0">
          {floors
            .filter(([f]) => f >= 0)
            .map(([floor, rooms]) => (
              <div key={floor} className="mb-[5px] grid grid-cols-2 gap-[5px]">
                {rooms
                  .sort((a, b) => (a.slot === 'left' ? -1 : b.slot === 'left' ? 1 : 0))
                  .map((b) => (
                    <div key={b.id} className={cx('h-[112px] overflow-hidden rounded-md bg-surface-2', b.slot === 'full' && 'col-span-2')}>
                      {b.level > 0 ? (
                        <button type="button" className="relative block h-full w-full text-left" onClick={() => setSelected(b)} aria-label={`${b.name} level ${b.level}`}>
                          <RoomScene building={b} decorations={deco} height={112} showAvatar={b.id === bestRoom?.id} avatar={player.avatar} hour={hour} />
                          <span className="absolute top-1.5 left-1.5 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur">
                            {b.name} · {b.level}
                          </span>
                        </button>
                      ) : (
                        <Blueprint b={b} level={level} coins={player.coins} all={buildings} onClick={() => setSelected(b)} />
                      )}
                    </div>
                  ))}
              </div>
            ))}
        </div>
        {floors
          .filter(([f]) => f < 0)
          .map(([floor, rooms]) => (
            <div key={floor} className="relative">
              {rooms.map((b) => (
                <div key={b.id} className="h-[120px] overflow-hidden">
                  {b.level > 0 ? (
                    <button type="button" className="relative block h-full w-full" onClick={() => setSelected(b)} aria-label={`${b.name} level ${b.level}`}>
                      <RoomScene building={b} decorations={deco} height={120} hour={hour} />
                      <span className="absolute top-1.5 left-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-bold text-white">
                        {b.name} · {b.level}
                      </span>
                    </button>
                  ) : (
                    <div className="h-full bg-[#7fcf6a]/60 p-2">
                      <Blueprint b={b} level={level} coins={player.coins} all={buildings} onClick={() => setSelected(b)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        <div className="h-3 bg-[#5aa04a]" />
      </div>

      <SectionTitle>World bonuses</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Income/day" value={`+${bonus.dailyIncome}`} icon="🪙" sub="× your score" />
        <Kpi label="Max energy" value={`+${bonus.maxEnergy}`} icon="⚡" />
        <Kpi label="Side slots" value={`+${bonus.sideQuestSlots}`} icon="🧩" />
      </div>
      {Object.keys(bonus.xpPctByCategory).length > 0 && (
        <Card className="mt-2">
          <div className="mb-2 text-[13px] font-semibold text-muted">XP bonuses</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(bonus.xpPctByCategory).map(([c, pct]) => (
              <span key={c} className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-semibold">
                {CATEGORY_INFO[c as ActivityCategory].icon} +{pct}% {CATEGORY_INFO[c as ActivityCategory].label}
              </span>
            ))}
          </div>
        </Card>
      )}

      <SectionTitle>All rooms</SectionTitle>
      <div className="space-y-2">
        {buildings.map((b) => {
          const blockers = buildBlockers(b, level, player.coins, buildings);
          return (
            <Card key={b.id} onClick={() => setSelected(b)} className="!p-3">
              <div className="flex items-center gap-3">
                <span className={cx('flex h-11 w-11 items-center justify-center rounded-2xl text-[24px]', b.level ? 'bg-surface-2' : 'bg-surface-2 opacity-50 grayscale')}>{b.level ? b.icon : '🔒'}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">
                    {b.icon} {b.name} {b.level > 0 && <span className="text-muted">· Lv {b.level}</span>}
                  </div>
                  <div className="truncate text-[12px] text-muted">{b.lifeArea}</div>
                </div>
                <span className={cx('num text-[13px] font-bold', blockers.length === 0 ? 'text-accent' : 'text-muted')}>
                  {b.level >= b.maxLevel ? 'MAX' : `${formatInt(buildingCost(b, b.level + 1))} 🪙`}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
      <BuildingSheet building={selected} onClose={() => setSelected(null)} />
    </Screen>
  );
}
