import { SHOP_ITEMS } from '@/data/cosmetics';
import { C } from '@/domain/counters';
import { canRevive, reviveStreak } from '@/domain/streak';
import { buildBlockers, buildingCost } from '@/domain/tycoon';
import { settingsRepository, tycoonRepository, withTransaction } from '@/repositories';
import type { AvatarConfig, Cosmetic, CosmeticType, ID, RealReward, ShopItemId } from '@/types';
import { uid } from '@/utils/id';
import { clock } from './clock';
import type { ServiceResult } from './events';
import { GameTx } from './game/gameTx';

export interface TycoonResult extends ServiceResult {
  ok: boolean;
  features: string[];
}

async function run(fn: (tx: GameTx) => Promise<boolean>): Promise<TycoonResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(clock.today());
    const ok = await fn(tx);
    if (ok) {
      await tx.checkAchievements();
      await tx.commit();
    }
    return { ok, events: tx.events, features: tx.unlockedFeatures };
  });
}

/** Build a new room or upgrade an existing one. */
export function buildOrUpgrade(buildingId: ID): Promise<TycoonResult> {
  return run(async (tx) => {
    const b = tx.buildings.find((x) => x.id === buildingId);
    if (!b) return false;
    const blockers = buildBlockers(b, tx.level, tx.player.coins, tx.buildings);
    if (blockers.length) {
      tx.events.push({ type: 'toast', text: 'Requirements not met yet.', icon: '🔒', tone: 'warn' });
      return false;
    }
    const cost = buildingCost(b, b.level + 1);
    if (!tx.spendCoins(cost, `${b.level === 0 ? 'Build' : 'Upgrade'}: ${b.name}`, b.id)) return false;
    const isNew = b.level === 0;
    b.level += 1;
    if (isNew) b.builtAt = tx.now;
    else b.upgradedAt = tx.now;
    await tycoonRepository.buildings.put(b);
    tx.inc(isNew ? { [C.buildingsBuilt]: 1 } : { [C.buildingUpgrades]: 1 });
    tx.player.maxEnergy = tx.maxEnergy;
    tx.events.push({ type: 'building', buildingId: b.id, name: b.name, icon: b.icon, level: b.level });
    return true;
  });
}

function avatarKey(type: CosmeticType): keyof AvatarConfig | undefined {
  const map: Partial<Record<CosmeticType, keyof AvatarConfig>> = {
    hair: 'hairStyle',
    hairColor: 'hairColor',
    outfit: 'outfit',
    outfitColor: 'outfitColor',
    accessory: 'accessory',
    skin: 'skin',
    background: 'background',
  };
  return map[type];
}

async function equipInTx(tx: GameTx, item: Cosmetic): Promise<void> {
  const all = await tycoonRepository.cosmetics.all();
  const updates: Cosmetic[] = [];
  if (item.type !== 'decoration') {
    for (const c of all) if (c.type === item.type && c.equipped && c.id !== item.id) updates.push({ ...c, equipped: false });
  }
  updates.push({ ...item, equipped: item.type === 'decoration' ? !item.equipped : true });
  await tycoonRepository.cosmetics.bulkPut(updates);
  const key = avatarKey(item.type);
  if (key) tx.player.avatar = { ...tx.player.avatar, [key]: item.value };
  if (item.type === 'theme') {
    const settings = await settingsRepository.get();
    if (settings) await settingsRepository.save({ ...settings, accent: item.value });
  }
}

export function buyCosmetic(id: ID): Promise<TycoonResult> {
  return run(async (tx) => {
    const item = await tycoonRepository.cosmetics.get(id);
    if (!item || item.owned) return false;
    if (item.unlockLevel && tx.level < item.unlockLevel) {
      tx.events.push({ type: 'toast', text: `Unlocks at level ${item.unlockLevel}.`, icon: '🔒', tone: 'warn' });
      return false;
    }
    if (!tx.spendCoins(item.price, `Cosmetic: ${item.name}`, item.id)) {
      tx.events.push({ type: 'toast', text: 'Not enough coins.', icon: '🪙', tone: 'warn' });
      return false;
    }
    const owned: Cosmetic = { ...item, owned: true, acquiredAt: tx.now };
    await tycoonRepository.cosmetics.put(owned);
    await equipInTx(tx, owned);
    tx.inc(item.type === 'decoration' ? { [C.decorations]: 1, [C.cosmetics]: 1 } : { [C.cosmetics]: 1 });
    tx.events.push({ type: 'purchase', name: item.name, icon: item.type === 'decoration' ? item.value : item.icon });
    return true;
  });
}

export function equipCosmetic(id: ID): Promise<TycoonResult> {
  return run(async (tx) => {
    const item = await tycoonRepository.cosmetics.get(id);
    if (!item?.owned) return false;
    await equipInTx(tx, item);
    return true;
  });
}

export function buyShopItem(id: ShopItemId): Promise<TycoonResult> {
  return run(async (tx) => {
    const item = SHOP_ITEMS.find((s) => s.id === id);
    if (!item) return false;
    const price = id === 'reroll' ? tx.settings.rules.generator.rerollCost : item.price;
    const inv = tx.player.inventory;
    if ((id === 'streakFreeze' && inv.streakFreeze >= item.maxStack) || (id === 'streakRevive' && inv.streakRevive >= item.maxStack) || (id === 'reroll' && inv.reroll >= item.maxStack)) {
      tx.events.push({ type: 'toast', text: `You can hold at most ${item.maxStack}.`, icon: '🎒', tone: 'info' });
      return false;
    }
    const boostType = id === 'xpBoost' ? 'xp' : id === 'coinBoost' ? 'coins' : undefined;
    if (boostType && tx.player.boosts.some((b) => b.type === boostType && b.expiresAt > tx.now)) {
      tx.events.push({ type: 'toast', text: 'That boost is already active.', icon: '⏳', tone: 'info' });
      return false;
    }
    if (!tx.spendCoins(price, `Shop: ${item.name}`, id)) {
      tx.events.push({ type: 'toast', text: 'Not enough coins.', icon: '🪙', tone: 'warn' });
      return false;
    }
    if (id === 'streakFreeze') inv.streakFreeze += 1;
    if (id === 'streakRevive') inv.streakRevive += 1;
    if (id === 'reroll') inv.reroll += 1;
    if (boostType) tx.player.boosts.push({ id: uid('b_'), type: boostType, multiplier: 1.25, expiresAt: tx.now + 24 * 3600000, source: 'shop' });
    tx.inc({ [C.shopPurchases]: 1 });
    tx.events.push({ type: 'purchase', name: item.name, icon: item.icon });
    return true;
  });
}

export function applyStreakRevive(): Promise<TycoonResult> {
  return run(async (tx) => {
    const s = tx.player.streak;
    if (tx.player.inventory.streakRevive <= 0 || !canRevive(s, tx.date, tx.settings.rules.streak)) return false;
    tx.player.inventory.streakRevive -= 1;
    tx.player.streak = reviveStreak(s);
    tx.inc({ [C.revivesUsed]: 1 });
    tx.events.push({ type: 'streak', value: tx.player.streak.current, kind: 'revived' });
    return true;
  });
}

export function redeemReward(id: ID): Promise<TycoonResult> {
  return run(async (tx) => {
    const r = await tycoonRepository.rewards.get(id);
    if (!r || !r.approved) return false;
    if (r.lastRedeemedAt && r.cooldownDays > 0 && tx.now - r.lastRedeemedAt < r.cooldownDays * 86400000) {
      tx.events.push({ type: 'toast', text: 'Still on cooldown.', icon: '⏳', tone: 'info' });
      return false;
    }
    if (!tx.spendCoins(r.cost, `Reward: ${r.name}`, r.id)) {
      tx.events.push({ type: 'toast', text: 'Not enough coins — keep playing!', icon: '🪙', tone: 'warn' });
      return false;
    }
    await tycoonRepository.rewards.put({ ...r, redeemedCount: r.redeemedCount + 1, lastRedeemedAt: tx.now });
    await tycoonRepository.addRedemption({ id: uid('rd_'), rewardId: r.id, name: r.name, cost: r.cost, ts: tx.now });
    tx.inc({ [C.rewardsRedeemed]: 1 });
    tx.events.push({ type: 'purchase', name: `${r.name} — enjoy it!`, icon: r.icon });
    return true;
  });
}

export async function saveReward(r: RealReward): Promise<void> {
  await tycoonRepository.rewards.put(r);
}

export async function deleteReward(id: ID): Promise<void> {
  await tycoonRepository.rewards.remove(id);
}
