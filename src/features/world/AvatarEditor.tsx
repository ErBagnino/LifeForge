import { useState } from 'react';
import { Avatar } from '@/components/game/Avatar';
import { Screen } from '@/components/layout/Screen';
import { Card, cx } from '@/components/ui/primitives';
import { useAsync, useLevel } from '@/hooks';
import { tycoonRepository } from '@/repositories';
import { buyCosmetic, equipCosmetic } from '@/services/tycoonService';
import { useGame } from '@/store/gameStore';
import type { AvatarConfig, CosmeticType } from '@/types';

const TABS: { value: CosmeticType; label: string; key: keyof AvatarConfig }[] = [
  { value: 'skin', label: 'Skin', key: 'skin' },
  { value: 'hair', label: 'Hair', key: 'hairStyle' },
  { value: 'hairColor', label: 'Colour', key: 'hairColor' },
  { value: 'outfit', label: 'Outfit', key: 'outfit' },
  { value: 'outfitColor', label: 'Tint', key: 'outfitColor' },
  { value: 'accessory', label: 'Extra', key: 'accessory' },
  { value: 'background', label: 'Backdrop', key: 'background' },
];

export default function AvatarEditor() {
  const player = useGame((s) => s.player);
  const act = useGame((s) => s.act);
  const { level } = useLevel();
  const [tab, setTab] = useState<CosmeticType>('hair');
  const [preview, setPreview] = useState<Partial<AvatarConfig>>({});
  const { data, reload } = useAsync(() => tycoonRepository.cosmetics.all(), []);
  if (!player) return null;
  const config = { ...player.avatar, ...preview };
  const current = TABS.find((t) => t.value === tab)!;
  const items = (data ?? []).filter((c) => c.type === tab);

  return (
    <Screen back title="Avatar">
      <Card className="mt-3 flex flex-col items-center py-6">
        <Avatar config={config} size={150} />
        <div className="mt-3 text-[13px] text-muted">Tap an item to try it. Owned items equip instantly.</div>
      </Card>
      {/* All seven parts visible at once (a scrolling tab bar hid "Extra" and "BG"). */}
      <div role="tablist" aria-label="Avatar part" className="mt-4 grid grid-cols-4 gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => {
              setTab(t.value);
              setPreview({});
            }}
            className={`h-11 rounded-xl text-[13px] font-semibold transition-colors ${tab === t.value ? 'bg-accent text-on-accent' : 'bg-surface-2 text-fg'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {items.map((c) => {
          const locked = !!c.unlockLevel && level < c.unlockLevel && !c.owned;
          const isColor = tab === 'skin' || tab === 'hairColor' || tab === 'outfitColor' || tab === 'background';
          return (
            <button
              key={c.id}
              type="button"
              disabled={locked}
              onClick={async () => {
                setPreview({ [current.key]: c.value });
                if (c.owned) {
                  await act(equipCosmetic(c.id));
                  setPreview({});
                  reload();
                }
              }}
              className={cx('flex flex-col items-center rounded-3xl bg-surface p-3 shadow-card', c.equipped && 'ring-2 ring-accent', locked && 'opacity-45')}
            >
              {isColor ? (
                <span className="h-10 w-10 rounded-full border border-line" style={{ background: c.value }} />
              ) : (
                <Avatar config={{ ...player.avatar, [current.key]: c.value }} size={48} />
              )}
              <span className="mt-1 text-[12px] font-semibold">{c.name}</span>
              <span className="num text-[11px] font-bold text-muted">{c.owned ? (c.equipped ? '✓' : 'Owned') : locked ? `🔒 Lv ${c.unlockLevel}` : `${c.price} 🪙`}</span>
            </button>
          );
        })}
      </div>
      {preview[current.key] !== undefined && (() => {
        const item = items.find((c) => c.value === preview[current.key]);
        if (!item || item.owned) return null;
        return (
          <div className="fixed inset-x-0 z-30 flex justify-center px-4" style={{ bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 12px)' }}>
            <button
              type="button"
              disabled={player.coins < item.price}
              onClick={async () => {
                await act(buyCosmetic(item.id));
                setPreview({});
                reload();
              }}
              className="h-14 w-full max-w-md rounded-2xl bg-accent text-[17px] font-bold text-on-accent shadow-float disabled:opacity-50"
            >
              Buy {item.name} · {item.price} 🪙
            </button>
          </div>
        );
      })()}
    </Screen>
  );
}
