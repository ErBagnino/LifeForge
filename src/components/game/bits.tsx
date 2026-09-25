import type { ReactNode } from 'react';
import { CATEGORY_INFO, RARITY_INFO, TIER_INFO } from '@/data/categories';
import type { ActivityCategory, Quest, Rarity } from '@/types';
import { formatCompact } from '@/utils/format';
import { AnimatedNumber } from '../ui/progress';
import { Chip, cx } from '../ui/primitives';

export function RarityChip({ rarity }: { rarity: Rarity }) {
  if (rarity === 'common') return null;
  return <Chip color={RARITY_INFO[rarity].color}>{RARITY_INFO[rarity].label}</Chip>;
}

export function TierChip({ tier, kind }: { tier: Quest['tier']; kind?: Quest['kind'] }) {
  if (kind === 'challenge') return <Chip color="#ff9f0a">Challenge</Chip>;
  if (kind === 'hidden') return <Chip color="#8e8e93">Hidden</Chip>;
  if (kind === 'weekly') return <Chip color="#0a84ff">Weekly</Chip>;
  if (kind === 'boss') return <Chip color="#ff375f">Boss</Chip>;
  return <Chip color={TIER_INFO[tier].color}>{TIER_INFO[tier].label}</Chip>;
}

export function CategoryChip({ category }: { category: ActivityCategory }) {
  const c = CATEGORY_INFO[category];
  return (
    <Chip color={c.color} icon={c.icon}>
      {c.label}
    </Chip>
  );
}

export function Flame({ size = 18, dim }: { size?: number; dim?: boolean }) {
  return (
    <span className={cx(!dim && 'lf-flame', dim && 'opacity-40 grayscale')} style={{ fontSize: size, lineHeight: 1 }} aria-hidden>
      🔥
    </span>
  );
}

export function StatPill({ icon, value, color, label, compact }: { icon: ReactNode; value: number; color: string; label: string; compact?: boolean }) {
  return (
    <div className={cx('flex items-center gap-1 rounded-full bg-surface-2 font-bold', compact ? 'h-7 px-2 text-[13px]' : 'h-8 px-2.5 text-[14px]')} aria-label={`${label}: ${Math.round(value)}`}>
      <span aria-hidden className="text-[14px]">
        {icon}
      </span>
      <span style={{ color }}>
        <AnimatedNumber value={value} format={(n) => formatCompact(n)} className="leading-none" />
      </span>
    </div>
  );
}

export function RewardLine({ xp, coins, className }: { xp: number; coins: number; className?: string }) {
  return (
    <span className={cx('num inline-flex items-center gap-2 text-[13px] font-bold', className)}>
      <span className="text-xp">+{xp} XP</span>
      <span className="text-coin">+{coins} 🪙</span>
    </span>
  );
}
