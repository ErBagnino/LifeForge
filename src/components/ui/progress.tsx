import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { cx } from './primitives';

export function ProgressBar({
  value,
  color = 'var(--lf-accent)',
  height = 8,
  className,
  track = 'var(--lf-surface-2)',
  label,
  markers = [],
}: {
  value: number;
  color?: string;
  height?: number;
  className?: string;
  track?: string;
  label?: string;
  markers?: number[];
}) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div
      className={cx('relative w-full overflow-hidden rounded-full', className)}
      style={{ height, background: track }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={false}
        animate={{ width: `${v * 100}%` }}
        transition={{ type: 'spring', stiffness: 140, damping: 22 }}
      />
      {markers.map((m) => (
        <span key={m} className="absolute top-0 h-full w-0.5 bg-fg/25" style={{ left: `${Math.min(100, m * 100)}%` }} />
      ))}
    </div>
  );
}

export function Ring({
  value,
  size = 120,
  stroke = 12,
  color = 'var(--lf-accent)',
  track = 'var(--lf-surface-2)',
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ type: 'spring', stiffness: 90, damping: 20 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/** Smoothly interpolated number (progress bars and counters feel alive). */
export function AnimatedNumber({ value, format = (n: number) => Math.round(n).toLocaleString('en-US'), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  const [display, setDisplay] = useState(format(value));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, reduce, mv]);
  useEffect(() => text.on('change', (v) => setDisplay(v)), [text]);
  useEffect(() => {
    if (reduce) setDisplay(format(value));
  }, [reduce, value, format]);
  return <span className={cx('num', className)}>{display}</span>;
}
