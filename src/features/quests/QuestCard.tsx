import { motion } from 'motion/react';
import { memo } from 'react';
import { CategoryChip, RarityChip, TierChip } from '@/components/game/bits';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/progress';
import { cx } from '@/components/ui/primitives';
import { RARITY_INFO } from '@/data/categories';
import { resolveText } from '@/services/game/questFactory';
import { haptics } from '@/services/haptics';
import type { Quest } from '@/types';
import { formatInt } from '@/utils/format';
import { tsToHm } from '@/utils/date';

export function questProgressLabel(q: Quest): string | undefined {
  if (q.target === undefined) return undefined;
  const unit = q.unit === 'ml' ? ' ml' : q.unit ? ` ${q.unit}` : '';
  if (q.metric === 'sleep' || q.metric === 'weight') return undefined;
  return `${formatInt(q.progress)} / ${formatInt(q.target)}${unit}`;
}

function CheckButton({ q, onPress }: { q: Quest; onPress: () => void }) {
  const done = q.status === 'completed';
  const failed = q.status === 'failed' || q.status === 'skipped';
  const color = q.rarity !== 'common' ? RARITY_INFO[q.rarity].color : 'var(--lf-accent)';
  const icon = q.kind === 'workout' ? 'play' : q.metric ? 'plus' : 'check';
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.82 }}
      onClick={(e) => {
        e.stopPropagation();
        haptics.tap();
        onPress();
      }}
      disabled={done || failed || !!q.goal}
      aria-label={done ? `${q.title} completed` : `Complete ${q.title}`}
      className={cx(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        done && 'border-success bg-success text-white',
        failed && 'border-line bg-surface-2 text-faint',
        !done && !failed && 'bg-surface',
      )}
      style={!done && !failed ? { borderColor: color, color } : undefined}
    >
      {done ? (
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 15 }}>
          <Icon name="check" size={22} strokeWidth={3} />
        </motion.span>
      ) : failed ? (
        <Icon name="close" size={18} />
      ) : q.goal ? (
        <span className="text-[18px]">{q.icon}</span>
      ) : (
        <Icon name={icon} size={icon === 'check' ? 20 : 18} strokeWidth={2.6} className={icon === 'check' ? 'opacity-25' : ''} />
      )}
    </motion.button>
  );
}

export const QuestCard = memo(function QuestCard({
  quest: q,
  petName,
  streak,
  onPress,
  onOpen,
  now,
}: {
  quest: Quest;
  petName: string;
  streak?: number;
  onPress: () => void;
  onOpen: () => void;
  now: number;
}) {
  const done = q.status === 'completed';
  const inactive = done || q.status === 'failed' || q.status === 'skipped';
  const hiddenUnrevealed = q.hidden && !done;
  const title = hiddenUnrevealed ? '??? Hidden quest' : resolveText(q.title, petName);
  const snoozed = q.snoozedUntil && q.snoozedUntil > now;
  const progressLabel = questProgressLabel(q);
  const ratio = q.target ? (q.metricMode === 'atMost' ? q.progress / q.target : q.progress / q.target) : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cx('flex items-center gap-3 rounded-3xl bg-surface p-3 shadow-card', inactive && 'opacity-60')}
      style={q.rarity !== 'common' && !inactive ? { boxShadow: `inset 0 0 0 1.5px ${RARITY_INFO[q.rarity].color}55, var(--lf-shadow)` } : undefined}
    >
      <CheckButton q={q} onPress={onPress} />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen} aria-label={`Open ${title}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-[17px] leading-none" aria-hidden>
            {hiddenUnrevealed ? '❔' : q.icon}
          </span>
          <span className={cx('truncate text-[15.5px] font-semibold', done && 'line-through decoration-2')}>{title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          {q.kind !== 'scheduled' && q.kind !== 'first' ? <TierChip tier={q.tier} kind={q.kind} /> : q.tier !== 'optional' && <TierChip tier={q.tier} />}
          <RarityChip rarity={q.rarity} />
          {snoozed && <span className="font-semibold text-warn">⏰ {tsToHm(q.snoozedUntil!)}</span>}
          {!snoozed && q.scheduledTime && !done && <span className="num">🕐 {q.scheduledTime}</span>}
          {done && q.actualTime && <span className="num">✓ {q.actualTime}</span>}
          {q.durationMin > 1 && !q.goal && <span className="num">{q.durationMin} min</span>}
          {!!streak && streak > 1 && <span className="font-semibold text-streak">🔥 {streak}</span>}
          {q.lightened && <span className="font-semibold text-energy">🪶 lightened</span>}
          {q.status === 'skipped' && <span>skipped</span>}
          {q.status === 'failed' && <span>{q.metricMode === 'atMost' ? 'over budget' : 'missed'}</span>}
        </div>
        {hiddenUnrevealed && q.hint && <div className="mt-1 text-[12px] text-muted italic">“{q.hint}”</div>}
        {(progressLabel || q.goal) && !hiddenUnrevealed && q.target !== undefined && (
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar
              value={ratio}
              height={6}
              color={q.metricMode === 'atMost' ? (ratio > 1 ? 'var(--lf-danger)' : ratio > 0.8 ? 'var(--lf-warn)' : 'var(--lf-success)') : done ? 'var(--lf-success)' : 'var(--lf-accent)'}
            />
            <span className="num shrink-0 text-[11px] font-semibold text-muted">{progressLabel ?? `${q.progress}/${q.target}`}</span>
          </div>
        )}
      </button>
      <div className="num shrink-0 text-right">
        <div className={cx('text-[13px] font-bold', done ? 'text-success' : 'text-xp')}>{done && q.earned ? `+${q.earned.xp}` : `+${q.xp}`}</div>
        <div className="text-[11px] font-semibold text-coin">🪙 {done && q.earned ? q.earned.coins : q.coins}</div>
      </div>
    </motion.div>
  );
});

export { CategoryChip };
