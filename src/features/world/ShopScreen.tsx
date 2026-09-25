import { useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Segmented, Select, TextInput } from '@/components/ui/forms';
import { Button, Card, Chip, EmptyState, SectionTitle, cx } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { ACCENTS, SHOP_ITEMS } from '@/data/cosmetics';
import { canRevive } from '@/domain/streak';
import { useAsync, useLevel } from '@/hooks';
import { tycoonRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { buyCosmetic, buyShopItem, deleteReward, equipCosmetic, redeemReward, saveReward, applyStreakRevive } from '@/services/tycoonService';
import { useGame } from '@/store/gameStore';
import type { Cosmetic, RealReward, RewardKind } from '@/types';
import { uid } from '@/utils/id';

type Tab = 'items' | 'cosmetics' | 'rewards';

export default function ShopScreen() {
  const [tab, setTab] = useState<Tab>('items');
  const player = useGame((s) => s.player);
  if (!player) return null;
  return (
    <Screen back title="Shop" subtitle={<span className="num">You have {player.coins.toLocaleString('en-US')} 🪙 · no real money, ever.</span>}>
      <Segmented
        className="mt-3"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'items', label: '🎒 Items' },
          { value: 'cosmetics', label: '🎨 Cosmetics' },
          { value: 'rewards', label: '🎁 Rewards' },
        ]}
      />
      {tab === 'items' && <ItemsTab />}
      {tab === 'cosmetics' && <CosmeticsTab />}
      {tab === 'rewards' && <RewardsTab />}
    </Screen>
  );
}

function ItemsTab() {
  const player = useGame((s) => s.player)!;
  const settings = useGame((s) => s.settings)!;
  const act = useGame((s) => s.act);
  const owned: Record<string, number> = { streakFreeze: player.inventory.streakFreeze, streakRevive: player.inventory.streakRevive, reroll: player.inventory.reroll };
  const reviveAvailable = canRevive(player.streak, clock.today(), settings.rules.streak);
  return (
    <div className="mt-4 space-y-2">
      {reviveAvailable && (
        <Card className="border-2 border-streak/40">
          <div className="text-[12px] font-extrabold tracking-widest text-streak">STREAK BROKEN</div>
          <div className="mt-1 text-[15px] font-semibold">Your {player.streak.brokenValue}-day streak can still be revived.</div>
          <Button block className="mt-3" disabled={player.inventory.streakRevive <= 0} onClick={() => void act(applyStreakRevive())}>
            ❤️‍🔥 Use Streak Revive ({player.inventory.streakRevive})
          </Button>
        </Card>
      )}
      {SHOP_ITEMS.map((item) => {
        const price = item.id === 'reroll' ? settings.rules.generator.rerollCost : item.price;
        const active = (item.id === 'xpBoost' || item.id === 'coinBoost') && player.boosts.some((b) => b.type === (item.id === 'xpBoost' ? 'xp' : 'coins') && b.expiresAt > clock.now());
        return (
          <Card key={item.id} className="flex items-center gap-3">
            <span className="text-[34px]">{item.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold">
                {item.name} {owned[item.id] !== undefined && <span className="text-muted">×{owned[item.id]}</span>}
              </div>
              <div className="text-[13px] text-muted">{item.description}</div>
              {active && <Chip color="#30d158">Active</Chip>}
            </div>
            <Button size="sm" disabled={player.coins < price || active} onClick={() => void act(buyShopItem(item.id))}>
              {price} 🪙
            </Button>
          </Card>
        );
      })}
      <p className="px-1 pt-2 text-[12px] text-muted">Items are also earned by playing: level milestones grant freezes, revives and rerolls.</p>
    </div>
  );
}

const COSMETIC_GROUPS: { type: Cosmetic['type']; label: string }[] = [
  { type: 'theme', label: 'App themes' },
  { type: 'hair', label: 'Hair' },
  { type: 'hairColor', label: 'Hair colour' },
  { type: 'outfit', label: 'Outfits' },
  { type: 'outfitColor', label: 'Outfit colour' },
  { type: 'accessory', label: 'Accessories' },
  { type: 'background', label: 'Backgrounds' },
  { type: 'decoration', label: 'Decorations' },
];

function CosmeticsTab() {
  const player = useGame((s) => s.player)!;
  const act = useGame((s) => s.act);
  const { level } = useLevel();
  const { data, reload } = useAsync(() => tycoonRepository.cosmetics.all(), []);
  if (!data) return null;
  const run = async (p: Promise<unknown>) => {
    await act(p as never);
    reload();
  };
  return (
    <div className="mt-2">
      {COSMETIC_GROUPS.map((g) => {
        const items = data.filter((c) => c.type === g.type && c.type !== 'skin');
        if (!items.length) return null;
        return (
          <div key={g.type}>
            <SectionTitle>{g.label}</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {items.map((c) => {
                const locked = !!c.unlockLevel && level < c.unlockLevel;
                const swatch = c.type === 'hairColor' || c.type === 'outfitColor' || c.type === 'background';
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={locked && !c.owned}
                    onClick={() => void run(c.owned ? equipCosmetic(c.id) : buyCosmetic(c.id))}
                    className={cx('flex flex-col items-center rounded-3xl bg-surface p-3 text-center shadow-card', c.equipped && 'ring-2 ring-accent', locked && !c.owned && 'opacity-50')}
                  >
                    {swatch ? (
                      <span className="h-9 w-9 rounded-full border border-line" style={{ background: c.value }} />
                    ) : c.type === 'theme' ? (
                      <span className="h-9 w-9 rounded-full" style={{ background: ACCENTS[c.value]?.color }} />
                    ) : (
                      <span className="text-[30px] leading-9">{c.type === 'decoration' ? c.value : c.icon}</span>
                    )}
                    <span className="mt-1 line-clamp-1 text-[12px] font-semibold">{c.name}</span>
                    <span className={cx('num text-[11px] font-bold', c.owned ? 'text-success' : player.coins >= c.price ? 'text-coin' : 'text-muted')}>
                      {c.owned ? (c.equipped ? 'Equipped' : 'Owned') : locked ? `🔒 Lv ${c.unlockLevel}` : `${c.price} 🪙`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const KINDS: { value: RewardKind; label: string }[] = [
  { value: 'money', label: '💶 Money / savings' },
  { value: 'leisure', label: '🎬 Leisure' },
  { value: 'food', label: '🍕 Food (free choice)' },
  { value: 'item', label: '🛍️ Something to buy' },
  { value: 'experience', label: '🎟️ Experience' },
  { value: 'other', label: '✨ Other' },
];

function RewardsTab() {
  const player = useGame((s) => s.player)!;
  const act = useGame((s) => s.act);
  const { data, reload } = useAsync(() => tycoonRepository.rewards.all(), []);
  const { data: history } = useAsync(() => tycoonRepository.redemptions(), []);
  const [edit, setEdit] = useState<RealReward | null>(null);
  const approved = data?.filter((r) => r.approved) ?? [];
  const pending = data?.filter((r) => !r.approved) ?? [];
  return (
    <div className="mt-3">
      <p className="px-1 text-[13px] text-muted">Real-world treats you define and approve. Coins buy the permission — the reward is yours. Food rewards are a free choice, never a “cheat day” or compensation.</p>
      <SectionTitle action={<button type="button" className="text-[14px] font-semibold text-accent" onClick={() => setEdit({ id: uid('rw_'), name: '', icon: '🎁', kind: 'leisure', cost: 300, approved: true, cooldownDays: 0, redeemedCount: 0, createdAt: Date.now() })}>+ New</button>}>
        Your rewards
      </SectionTitle>
      {!approved.length && <EmptyState icon="🎁" title="No approved rewards yet" body="Approve a suggestion below or create your own." />}
      <div className="space-y-2">
        {approved.map((r) => {
          const cooling = r.lastRedeemedAt && r.cooldownDays > 0 && Date.now() - r.lastRedeemedAt < r.cooldownDays * 86400000;
          return (
            <Card key={r.id} className="flex items-center gap-3">
              <span className="text-[30px]">{r.icon}</span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(r)}>
                <div className="text-[15px] font-bold">{r.name}</div>
                <div className="text-[12px] text-muted">
                  Redeemed {r.redeemedCount}× {r.cooldownDays ? `· cooldown ${r.cooldownDays}d` : ''}
                </div>
              </button>
              <Button size="sm" disabled={player.coins < r.cost || !!cooling} onClick={async () => { await act(redeemReward(r.id)); reload(); }}>
                {cooling ? '⏳' : `${r.cost} 🪙`}
              </Button>
            </Card>
          );
        })}
      </div>
      {pending.length > 0 && (
        <>
          <SectionTitle>Suggestions (need your approval)</SectionTitle>
          <div className="space-y-2">
            {pending.map((r) => (
              <Card key={r.id} className="flex items-center gap-3">
                <span className="text-[28px] opacity-70">{r.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{r.name}</div>
                  {r.description && <div className="text-[12px] text-muted">{r.description}</div>}
                </div>
                <Button size="sm" variant="tinted" onClick={async () => { await saveReward({ ...r, approved: true }); reload(); }}>
                  Approve
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
      {!!history?.length && (
        <>
          <SectionTitle>History</SectionTitle>
          <Card className="space-y-1.5">
            {history.slice(0, 10).map((h) => (
              <div key={h.id} className="flex justify-between text-[13px]">
                <span>{h.name}</span>
                <span className="num text-muted">
                  −{h.cost} 🪙 · {new Date(h.ts).toLocaleDateString()}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.name ? 'Edit reward' : 'New reward'}>
        {edit && (
          <div className="space-y-3">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <Field label="Icon">
                <TextInput value={edit.icon} onChange={(v) => setEdit({ ...edit, icon: v.slice(0, 4) })} aria-label="Icon" />
              </Field>
              <Field label="Reward">
                <TextInput value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} placeholder="Watch a movie" aria-label="Reward name" />
              </Field>
            </div>
            <Field label="Type">
              <Select value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={KINDS} aria-label="Reward type" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cost (coins)">
                <NumberInput value={edit.cost} onChange={(v) => setEdit({ ...edit, cost: Math.max(1, Math.round(v)) })} aria-label="Cost" />
              </Field>
              <Field label="Cooldown (days)">
                <NumberInput value={edit.cooldownDays} onChange={(v) => setEdit({ ...edit, cooldownDays: Math.max(0, Math.round(v)) })} aria-label="Cooldown" />
              </Field>
            </div>
            <div className="flex gap-2 pt-2">
              {data?.some((r) => r.id === edit.id) && (
                <Button variant="danger" icon="trash" onClick={async () => { await deleteReward(edit.id); setEdit(null); reload(); }}>
                  Delete
                </Button>
              )}
              <Button block disabled={!edit.name.trim()} onClick={async () => { await saveReward({ ...edit, approved: true }); setEdit(null); reload(); }}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
