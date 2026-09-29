import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Button, Card, Kpi, SectionTitle, cx } from '@/components/ui/primitives';
import { CATEGORY_INFO } from '@/data/categories';
import { buildBlockers, buildingCost, homeLevel, homeTitle, nextHomeTitle, worldBonuses } from '@/domain/tycoon';
import { useAsync, useLevel, useNow } from '@/hooks';
import { questRepository, tycoonRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { shiftDate } from '@/utils/date';
import { useGame } from '@/store/gameStore';
import type { ActivityCategory, Building } from '@/types';
import { formatInt } from '@/utils/format';
import { loadWorldExtras } from '@/services/progressService';
import { ProgressBar } from '@/components/ui/progress';
import { BuildingSheet } from './BuildingSheet';
import { Diorama } from './Diorama';

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
  const { data: extras } = useAsync(() => loadWorldExtras(), []);
  const [openSet, setOpenSet] = useState<string | null>(null);
  const petEmoji = useGame((s) => s.settings?.profile.petEmoji);
  // Rooms light up when this week's real completions belong to their life area.
  const { data: activity } = useAsync(async () => {
    const today = clock.today();
    const quests = await questRepository.byRange(shiftDate(today, -6), today);
    const out: Record<string, number> = {};
    for (const b of buildings) out[b.id] = quests.filter((q) => q.status === 'completed' && b.categories.includes(q.category)).length;
    return out;
  }, [buildings]);

  useEffect(() => {
    const room = params.get('room');
    if (room) setSelected(buildings.find((b) => b.id === room) ?? null);
  }, [params, buildings]);

  if (!player) return null;
  const hl = homeLevel(buildings);
  const next = nextHomeTitle(hl);
  const bonus = worldBonuses(buildings);
  const deco = cosmetics ?? [];
  const cheapDeco = deco.find((c) => c.type === 'decoration' && !c.owned && c.price <= player.coins && buildings.find((b) => b.id === c.room)?.level);
  const sky = hour >= 6 && hour < 17 ? 'linear-gradient(#7cc8ff, #cdeeff)' : hour >= 17 && hour < 20 ? 'linear-gradient(#ff8a5b, #ffd29a)' : 'linear-gradient(#0f1330, #28295e)';
  const festival = extras?.events.some((e) => e.id === 'lantern_festival');

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

      {!!extras?.events.length && (
        <div className="mt-3 space-y-2" aria-label="World events">
          {extras.events.map((e) => (
            <Card key={e.id} className="!p-3">
              <div className="flex items-start gap-3">
                <span className="text-[26px]" aria-hidden>
                  {e.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-extrabold tracking-widest text-accent uppercase">World event</div>
                  <div className="text-[15px] font-bold">{e.title}</div>
                  <div className="text-[13px] text-muted">{e.text}</div>
                  <div className="mt-0.5 text-[11px] text-faint">Because: {e.because}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="relative mt-4 overflow-hidden rounded-[28px] px-2 pt-6 pb-2 shadow-card" style={{ background: sky }}>
        {hour >= 20 || hour < 6 ? (
          <div className="pointer-events-none absolute inset-0 text-[10px] text-white/70" aria-hidden>
            {['12% 8%', '30% 16%', '70% 6%', '85% 20%', '50% 10%'].map((p) => (
              <span key={p} className="absolute" style={{ left: p.split(' ')[0], top: p.split(' ')[1] }}>
                ✦
              </span>
            ))}
          </div>
        ) : (
          <div className="pointer-events-none absolute top-3 left-4 text-[24px]" aria-hidden>
            ☁️
          </div>
        )}
        {festival && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-around text-[16px]" aria-hidden>
            {['🏮', '🏮', '🏮', '🏮'].map((l, i) => (
              <motion.span key={i} animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 2.4, delay: i * 0.3 }}>
                {l}
              </motion.span>
            ))}
          </div>
        )}
        <Diorama buildings={buildings} hour={hour} avatar={player.avatar} activity={activity ?? {}} petEmoji={petEmoji} onSelect={setSelected} />
        <p className="px-2 pb-1 text-center text-[12px] font-semibold text-white/85 drop-shadow">Tap a room to step inside · rooms glow when your real-life quests feed them</p>
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

      {!!extras?.collections.length && (
        <>
          <SectionTitle>Collections</SectionTitle>
          <div className="space-y-2">
            {extras.collections.map((c) => (
              <Card key={c.id} className="!p-3" onClick={() => setOpenSet(openSet === c.id ? null : c.id)}>
                <div className="flex items-center gap-3">
                  <span className="text-[24px]" aria-hidden>
                    {c.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px] font-semibold">{c.title}</span>
                      <span className={cx('num shrink-0 text-[12px] font-bold', c.complete ? 'text-success' : 'text-muted')}>{c.complete ? 'Complete ✓' : `${c.owned}/${c.total}`}</span>
                    </div>
                    <ProgressBar value={c.total ? c.owned / c.total : 0} height={4} className="mt-1" />
                  </div>
                </div>
                {openSet === c.id && (
                  <>
                    <p className="mt-2 text-[12px] text-muted">{c.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.items.map((i) => (
                        <span key={i.id} className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold', i.owned ? 'bg-accent/12 text-fg' : 'bg-surface-2 text-muted opacity-70')}>
                          <span className={cx(!i.owned && 'grayscale')}>{i.icon}</span> {i.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            ))}
          </div>
        </>
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
