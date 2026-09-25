import { Button, Card, Chip } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { CATEGORY_INFO, STAT_INFO } from '@/data/categories';
import { buildBlockers, buildingCost } from '@/domain/tycoon';
import { useAsync, useLevel } from '@/hooks';
import { tycoonRepository } from '@/repositories';
import { buildOrUpgrade, buyCosmetic, equipCosmetic } from '@/services/tycoonService';
import { useGame } from '@/store/gameStore';
import type { Building, BuildingEffect } from '@/types';
import { formatInt } from '@/utils/format';
import { RoomScene } from './RoomScene';

export function describeEffect(e: BuildingEffect, level: number): string {
  const cats = 'categories' in e ? e.categories.map((c) => CATEGORY_INFO[c].label).join(', ') : '';
  switch (e.type) {
    case 'categoryXpPct':
      return `+${e.pctPerLevel * level}% XP · ${cats}`;
    case 'categoryCoinPct':
      return `+${e.pctPerLevel * level}% coins · ${cats}`;
    case 'dailyIncome':
      return `+${e.perLevel * level} 🪙/day world income (scaled by your score)`;
    case 'maxEnergy':
      return `+${e.perLevel * level} max Energy`;
    case 'hpRegen':
      return `+${Math.round(e.perLevel * level * 10) / 10} HP/day regeneration`;
    case 'sideQuestSlots':
      return `+${Math.floor(e.perLevel * level)} side quest slot(s)`;
    case 'unlockCategories':
      return `Unlocks ${cats}`;
  }
}

export function BuildingSheet({ building, onClose }: { building: Building | null; onClose: () => void }) {
  return (
    <Sheet open={!!building} onClose={onClose} title={building ? `${building.icon} ${building.name}` : ''}>
      {building && <Body id={building.id} onClose={onClose} />}
    </Sheet>
  );
}

function Body({ id, onClose }: { id: string; onClose: () => void }) {
  const buildings = useGame((s) => s.buildings);
  const player = useGame((s) => s.player)!;
  const act = useGame((s) => s.act);
  const { level } = useLevel();
  const b = buildings.find((x) => x.id === id)!;
  const { data: decos, reload } = useAsync(async () => (await tycoonRepository.cosmetics.all()).filter((c) => c.type === 'decoration' && c.room === id), [id]);
  const blockers = buildBlockers(b, level, player.coins, buildings);
  const cost = b.level < b.maxLevel ? buildingCost(b, b.level + 1) : 0;
  const maxed = b.level >= b.maxLevel;

  return (
    <div>
      <div className="overflow-hidden rounded-3xl shadow-card">
        <RoomScene building={b.level ? b : { ...b, level: 1 }} decorations={decos ?? []} height={170} showAvatar={b.level > 0} avatar={player.avatar} />
      </div>
      <p className="mt-3 text-[15px]">{b.description}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip>{b.lifeArea}</Chip>
        {b.stats.map((s) => (
          <Chip key={s} color={STAT_INFO[s].color}>
            {STAT_INFO[s].icon} {STAT_INFO[s].label}
          </Chip>
        ))}
      </div>
      <Card className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold">Level {b.level} / {b.maxLevel}</span>
          <div className="flex gap-1">
            {Array.from({ length: b.maxLevel }, (_, i) => (
              <span key={i} className={`h-2.5 w-6 rounded-full ${i < b.level ? 'bg-accent' : 'bg-surface-3'}`} />
            ))}
          </div>
        </div>
        {b.level > 0 && (
          <ul className="mt-3 space-y-1 text-[14px]">
            {b.effects.map((e, i) => (
              <li key={i}>✅ {describeEffect(e, b.level)}</li>
            ))}
          </ul>
        )}
        {!maxed && (
          <>
            <div className="mt-3 text-[12px] font-bold tracking-wide text-muted uppercase">{b.level ? `At level ${b.level + 1}` : 'When built'}</div>
            <ul className="mt-1 space-y-1 text-[14px] text-muted">
              {b.effects.map((e, i) => (
                <li key={i}>➕ {describeEffect(e, b.level + 1)}</li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {!maxed && (
        <div className="mt-3">
          {blockers.filter((x) => x.type !== 'coins').map((x, i) => (
            <div key={i} className="mb-1 text-[13px] font-semibold text-warn">
              🔒 {x.type === 'playerLevel' ? `Requires player level ${x.required}` : x.type === 'requires' ? `Requires ${x.name} level ${x.level}` : ''}
            </div>
          ))}
          <Button
            block
            size="lg"
            disabled={blockers.length > 0}
            onClick={async () => {
              await act(buildOrUpgrade(b.id));
              onClose();
            }}
          >
            {b.level === 0 ? 'Build' : 'Upgrade'} · {formatInt(cost)} 🪙
          </Button>
          {blockers.some((x) => x.type === 'coins') && <p className="mt-1 text-center text-[12px] text-muted">{formatInt(cost - player.coins)} more coins needed — go complete some quests.</p>}
        </div>
      )}
      {maxed && <div className="mt-3 rounded-2xl bg-success/10 p-3 text-center text-[14px] font-semibold text-success">🏆 Maxed out</div>}

      {!!decos?.length && (
        <>
          <div className="mt-5 mb-2 px-1 text-[13px] font-semibold text-muted uppercase">Decorations</div>
          <div className="grid grid-cols-2 gap-2">
            {decos.map((d) => (
              <Card key={d.id} className="!p-3">
                <div className="text-[30px]">{d.value}</div>
                <div className="text-[14px] font-semibold">{d.name}</div>
                {d.owned ? (
                  <Button
                    size="sm"
                    variant={d.equipped ? 'tinted' : 'secondary'}
                    block
                    className="mt-2"
                    onClick={async () => {
                      await act(equipCosmetic(d.id));
                      reload();
                    }}
                  >
                    {d.equipped ? 'Placed ✓' : 'Place'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    block
                    className="mt-2"
                    disabled={b.level === 0 || player.coins < d.price}
                    onClick={async () => {
                      await act(buyCosmetic(d.id));
                      reload();
                    }}
                  >
                    {d.price} 🪙
                  </Button>
                )}
              </Card>
            ))}
          </div>
          {b.level === 0 && <p className="mt-2 text-[12px] text-muted">Build the room to place decorations.</p>}
        </>
      )}
    </div>
  );
}
