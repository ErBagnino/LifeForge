import type { AvatarConfig, Cosmetic, CosmeticType, RealReward, ShopItem } from '@/types';

type C = Omit<Cosmetic, 'owned' | 'equipped'> & { owned?: boolean; equipped?: boolean };
const c = (def: C): Cosmetic => ({ owned: def.price === 0 && !def.unlockLevel, equipped: false, ...def });

const colorItems = (type: CosmeticType, prefix: string, items: [string, string, string, number, number?][]) =>
  items.map(([id, name, value, price, unlockLevel]) => c({ id: `${prefix}_${id}`, name, type, icon: '●', value, price, unlockLevel }));

export const SEED_COSMETICS: Cosmetic[] = [
  // Hair
  c({ id: 'hair_short', name: 'Short', type: 'hair', icon: '💇', value: 'short', price: 0 }),
  c({ id: 'hair_buzz', name: 'Buzz cut', type: 'hair', icon: '💈', value: 'buzz', price: 0 }),
  c({ id: 'hair_bald', name: 'Bald & bold', type: 'hair', icon: '🥚', value: 'bald', price: 0 }),
  c({ id: 'hair_curly', name: 'Curly', type: 'hair', icon: '🌀', value: 'curly', price: 100 }),
  c({ id: 'hair_long', name: 'Long', type: 'hair', icon: '💁', value: 'long', price: 150 }),
  c({ id: 'hair_bun', name: 'Top bun', type: 'hair', icon: '🍙', value: 'bun', price: 200 }),
  c({ id: 'hair_spiky', name: 'Spiky', type: 'hair', icon: '⚡', value: 'spiky', price: 250 }),
  c({ id: 'hair_mohawk', name: 'Mohawk', type: 'hair', icon: '🦔', value: 'mohawk', price: 300, unlockLevel: 8 }),
  // Hair colours
  ...colorItems('hairColor', 'hc', [
    ['black', 'Black', '#2b2b2b', 0],
    ['brown', 'Brown', '#6b4226', 0],
    ['blonde', 'Blonde', '#e2b659', 0],
    ['red', 'Copper', '#c2502f', 80],
    ['silver', 'Silver', '#c9ccd6', 300],
    ['blue', 'Electric blue', '#2f7bff', 200],
    ['pink', 'Pink', '#ff6fb1', 200],
    ['green', 'Toxic green', '#35d07f', 250, 6],
  ]),
  // Skin
  ...colorItems('skin', 'skin', [
    ['1', 'Tone 1', '#ffdcc2', 0],
    ['2', 'Tone 2', '#f1c09a', 0],
    ['3', 'Tone 3', '#d49a6a', 0],
    ['4', 'Tone 4', '#a86b43', 0],
    ['5', 'Tone 5', '#6e4428', 0],
  ]),
  // Outfits
  c({ id: 'outfit_tee', name: 'T-shirt', type: 'outfit', icon: '👕', value: 'tee', price: 0 }),
  c({ id: 'outfit_tank', name: 'Tank top', type: 'outfit', icon: '🎽', value: 'tank', price: 100 }),
  c({ id: 'outfit_hoodie', name: 'Hoodie', type: 'outfit', icon: '🧥', value: 'hoodie', price: 150 }),
  c({ id: 'outfit_gi', name: 'Training gi', type: 'outfit', icon: '🥋', value: 'gi', price: 400, unlockLevel: 10 }),
  c({ id: 'outfit_suit', name: 'Sharp suit', type: 'outfit', icon: '🤵', value: 'suit', price: 500 }),
  c({ id: 'outfit_armor', name: 'Forge armor', type: 'outfit', icon: '🛡️', value: 'armor', price: 1500, unlockLevel: 20 }),
  // Outfit colours
  ...colorItems('outfitColor', 'oc', [
    ['ember', 'Ember', '#ff5a1f', 0],
    ['ocean', 'Ocean', '#0a84ff', 0],
    ['forest', 'Forest', '#30b35a', 60],
    ['grape', 'Grape', '#8e5cff', 60],
    ['midnight', 'Midnight', '#23233a', 80],
    ['rose', 'Rose', '#ff4f7b', 80],
    ['gold', 'Gold', '#e7b10a', 400, 12],
  ]),
  // Accessories
  c({ id: 'acc_none', name: 'None', type: 'accessory', icon: '🚫', value: 'none', price: 0 }),
  c({ id: 'acc_headband', name: 'Headband', type: 'accessory', icon: '🎗️', value: 'headband', price: 100 }),
  c({ id: 'acc_glasses', name: 'Glasses', type: 'accessory', icon: '👓', value: 'glasses', price: 120 }),
  c({ id: 'acc_sunglasses', name: 'Sunglasses', type: 'accessory', icon: '🕶️', value: 'sunglasses', price: 150 }),
  c({ id: 'acc_cap', name: 'Cap', type: 'accessory', icon: '🧢', value: 'cap', price: 150 }),
  c({ id: 'acc_headphones', name: 'Headphones', type: 'accessory', icon: '🎧', value: 'headphones', price: 250 }),
  c({ id: 'acc_crown', name: 'Crown', type: 'accessory', icon: '👑', value: 'crown', price: 2000, unlockLevel: 30 }),
  c({ id: 'acc_halo', name: 'Halo', type: 'accessory', icon: '😇', value: 'halo', price: 3000, unlockLevel: 50 }),
  // Backgrounds
  ...colorItems('background', 'bg', [
    ['peach', 'Peach', '#ffe3d3', 0],
    ['sky', 'Sky', '#d7ecff', 50],
    ['mint', 'Mint', '#d6f5e6', 50],
    ['lavender', 'Lavender', '#e8e0ff', 50],
    ['sunset', 'Sunset', 'linear-gradient(135deg,#ff9a62,#ff5f8f)', 150],
    ['night', 'Night', 'linear-gradient(135deg,#1d2b64,#3a1c71)', 200],
  ]),
  // App themes (accent colour)
  c({ id: 'theme_ember', name: 'Ember', type: 'theme', icon: '🔥', value: 'ember', price: 0 }),
  c({ id: 'theme_ocean', name: 'Ocean', type: 'theme', icon: '🌊', value: 'ocean', price: 200 }),
  c({ id: 'theme_forest', name: 'Forest', type: 'theme', icon: '🌲', value: 'forest', price: 200 }),
  c({ id: 'theme_grape', name: 'Grape', type: 'theme', icon: '🍇', value: 'grape', price: 250 }),
  c({ id: 'theme_rose', name: 'Rose', type: 'theme', icon: '🌹', value: 'rose', price: 250 }),
  c({ id: 'theme_mono', name: 'Mono', type: 'theme', icon: '⚫', value: 'mono', price: 300 }),
  c({ id: 'theme_gold', name: 'Gold', type: 'theme', icon: '🏆', value: 'gold', price: 800, unlockLevel: 15 }),
  // Decorations (placed in rooms)
  c({ id: 'deco_lamp', name: 'Cozy lamp', type: 'decoration', icon: '💡', value: '💡', price: 40, room: 'bedroom' }),
  c({ id: 'deco_plant', name: 'Monstera', type: 'decoration', icon: '🪴', value: '🪴', price: 60, room: 'bedroom' }),
  c({ id: 'deco_poster', name: 'Motivational poster', type: 'decoration', icon: '🖼️', value: '🖼️', price: 90, room: 'bedroom' }),
  c({ id: 'deco_guitar', name: 'Guitar', type: 'decoration', icon: '🎸', value: '🎸', price: 180, room: 'bedroom' }),
  c({ id: 'deco_pet_toy', name: 'Chew toy', type: 'decoration', icon: '🧶', value: '🧶', price: 50, room: 'pet_corner' }),
  c({ id: 'deco_pet_house', name: 'Deluxe hideout', type: 'decoration', icon: '🛖', value: '🛖', price: 150, room: 'pet_corner' }),
  c({ id: 'deco_candle', name: 'Candle', type: 'decoration', icon: '🕯️', value: '🕯️', price: 70, room: 'bathroom' }),
  c({ id: 'deco_duck', name: 'Rubber duck', type: 'decoration', icon: '🦆', value: '🦆', price: 90, room: 'bathroom' }),
  c({ id: 'deco_fruit', name: 'Fruit bowl', type: 'decoration', icon: '🍇', value: '🍇', price: 60, room: 'kitchen' }),
  c({ id: 'deco_coffee', name: 'Coffee machine', type: 'decoration', icon: '☕', value: '☕', price: 200, room: 'kitchen' }),
  c({ id: 'deco_rack', name: 'Dumbbell rack', type: 'decoration', icon: '🏋️‍♀️', value: '🏋️‍♀️', price: 250, room: 'gym' }),
  c({ id: 'deco_bag', name: 'Punching bag', type: 'decoration', icon: '🥊', value: '🥊', price: 400, room: 'gym' }),
  c({ id: 'deco_trophy', name: 'Trophy', type: 'decoration', icon: '🏆', value: '🏆', price: 600, room: 'gym' }),
  c({ id: 'deco_flowers', name: 'Flower bed', type: 'decoration', icon: '🌷', value: '🌷', price: 100, room: 'garden' }),
  c({ id: 'deco_bench', name: 'Garden bench', type: 'decoration', icon: '🪑', value: '🪑', price: 180, room: 'garden' }),
  c({ id: 'deco_fountain', name: 'Fountain', type: 'decoration', icon: '⛲', value: '⛲', price: 600, room: 'garden' }),
  c({ id: 'deco_monitor', name: 'Second monitor', type: 'decoration', icon: '🖥️', value: '🖥️', price: 350, room: 'office' }),
  c({ id: 'deco_office_plant', name: 'Desk cactus', type: 'decoration', icon: '🌵', value: '🌵', price: 90, room: 'office' }),
  c({ id: 'deco_globe', name: 'Globe', type: 'decoration', icon: '🌍', value: '🌍', price: 250, room: 'library' }),
  c({ id: 'deco_bookshelf', name: 'Tall bookshelf', type: 'decoration', icon: '📚', value: '📚', price: 300, room: 'library' }),
  c({ id: 'deco_toolboard', name: 'Tool board', type: 'decoration', icon: '🪛', value: '🪛', price: 200, room: 'workshop' }),
  c({ id: 'deco_console', name: 'Game console', type: 'decoration', icon: '🕹️', value: '🕹️', price: 300, room: 'recreation' }),
  c({ id: 'deco_aquarium', name: 'Aquarium', type: 'decoration', icon: '🐠', value: '🐠', price: 700, room: 'recreation' }),
  c({ id: 'deco_safe', name: 'Golden safe', type: 'decoration', icon: '💰', value: '💰', price: 900, room: 'storage' }),
];

export const DEFAULT_AVATAR: AvatarConfig = {
  skin: '#f1c09a',
  hairStyle: 'short',
  hairColor: '#2b2b2b',
  outfit: 'tee',
  outfitColor: '#ff5a1f',
  accessory: 'none',
  background: '#ffe3d3',
};

export const DEFAULT_EQUIPPED = ['hair_short', 'hc_black', 'skin_2', 'outfit_tee', 'oc_ember', 'acc_none', 'bg_peach', 'theme_ember'];

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'streakFreeze', name: 'Streak Freeze', icon: '🧊', description: 'Automatically protects your streak for one missed day.', price: 250, maxStack: 3 },
  { id: 'streakRevive', name: 'Streak Revive', icon: '❤️‍🔥', description: 'Bring back a broken streak within 3 days of the break.', price: 600, maxStack: 2 },
  { id: 'reroll', name: 'Quest Reroll', icon: '🎲', description: 'Swap a side quest for a new one.', price: 30, maxStack: 10 },
  { id: 'xpBoost', name: 'XP Booster', icon: '🚀', description: '+25% XP for 24 hours.', price: 300, maxStack: 1 },
  { id: 'coinBoost', name: 'Coin Magnet', icon: '🧲', description: '+25% coins for 24 hours.', price: 350, maxStack: 1 },
];

/** Suggestions only: every real reward must be approved (or created) by the user before it can be redeemed. */
export const SEED_REWARDS: Omit<RealReward, 'createdAt'>[] = [
  { id: 'rw_piggy', name: 'Put €5 in the piggy bank', icon: '🐷', kind: 'money', cost: 500, approved: false, cooldownDays: 0, redeemedCount: 0 },
  { id: 'rw_movie', name: 'Movie night', icon: '🎬', kind: 'leisure', cost: 400, approved: false, cooldownDays: 3, redeemedCount: 0 },
  { id: 'rw_order', name: 'Order something you like', icon: '🛍️', kind: 'item', cost: 1500, approved: false, cooldownDays: 14, redeemedCount: 0 },
  {
    id: 'rw_meal',
    name: 'Free-choice meal',
    icon: '🍕',
    kind: 'food',
    cost: 700,
    approved: false,
    cooldownDays: 7,
    redeemedCount: 0,
    description: 'A free choice you enjoy — not a compensation, not a "binge day". Optional, always.',
  },
  { id: 'rw_gaming', name: 'Gaming session (1h)', icon: '🎮', kind: 'leisure', cost: 300, approved: false, cooldownDays: 1, redeemedCount: 0 },
  { id: 'rw_book', name: 'Buy a new book', icon: '📘', kind: 'item', cost: 800, approved: false, cooldownDays: 7, redeemedCount: 0 },
];

export const ACCENTS: Record<string, { label: string; color: string; soft: string }> = {
  ember: { label: 'Ember', color: '#ff5a1f', soft: '#ff5a1f1f' },
  ocean: { label: 'Ocean', color: '#0a84ff', soft: '#0a84ff1f' },
  forest: { label: 'Forest', color: '#28b463', soft: '#28b4631f' },
  grape: { label: 'Grape', color: '#8e5cff', soft: '#8e5cff1f' },
  rose: { label: 'Rose', color: '#ff375f', soft: '#ff375f1f' },
  mono: { label: 'Mono', color: '#636366', soft: '#6363661f' },
  gold: { label: 'Gold', color: '#d4a008', soft: '#d4a0081f' },
};
