import { motion } from 'motion/react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { haptics } from '@/services/haptics';
import { Icon, type IconName } from './Icon';
import { cx } from './primitives';
import { VoiceMic } from './VoiceMic';

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptics.tap();
        onChange(!checked);
      }}
      className={cx('hit-44 relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', checked ? 'bg-success' : 'bg-surface-3', disabled && 'opacity-40')}
    >
      <motion.span
        className="absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow"
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 35 }}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  const id = useId();
  return (
    <div role="tablist" className={cx('flex rounded-2xl bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              haptics.tap();
              onChange(o.value);
            }}
            className={cx('hit-44 relative min-w-0 flex-1 rounded-xl font-semibold', size === 'sm' ? 'h-9 text-[13px]' : 'h-10 text-[14px]', active ? 'text-fg' : 'text-muted')}
          >
            {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-xl bg-surface shadow-card" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span className="relative z-10 flex items-center justify-center gap-1 px-1">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 100000,
  format = (v: number) => String(v),
  label,
  size = 'md',
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  label: string;
  size?: 'sm' | 'md';
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 1000) / 1000));
  const btn = size === 'sm' ? 'hit-44 h-9 w-9' : 'h-11 w-11';
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <motion.button type="button" whileTap={{ scale: 0.88 }} aria-label={`Decrease ${label}`} className={cx(btn, 'flex items-center justify-center rounded-full bg-surface-2')} onClick={() => { haptics.tap(); onChange(clamp(value - step)); }}>
        <Icon name="minus" size={18} />
      </motion.button>
      <span className={cx('num min-w-[64px] text-center font-bold', size === 'sm' ? 'text-[16px]' : 'text-[20px]')} aria-live="polite">
        {format(value)}
      </span>
      <motion.button type="button" whileTap={{ scale: 0.88 }} aria-label={`Increase ${label}`} className={cx(btn, 'flex items-center justify-center rounded-full bg-surface-2')} onClick={() => { haptics.tap(); onChange(clamp(value + step)); }}>
        <Icon name="plus" size={18} />
      </motion.button>
    </div>
  );
}

const inputBase = 'h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[16px] outline-none focus:border-accent';

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-[13px] font-semibold text-muted">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block px-1 text-[12px] text-muted">{hint}</span>}
      {error && <span className="mt-1 block px-1 text-[12px] text-danger">{error}</span>}
    </label>
  );
}

export function TextInput({ value, onChange, placeholder, type = 'text', inputMode, autoFocus, className, voice, ...rest }: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'search';
  autoFocus?: boolean;
  className?: string;
  'aria-label'?: string;
  maxLength?: number;
  /** Show a microphone that dictates into the field. */
  voice?: boolean;
}) {
  if (voice) {
    return (
      <div className={cx('relative', className)}>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} inputMode={inputMode} autoFocus={autoFocus} className={cx(inputBase, 'pr-12')} {...rest} />
        <VoiceMic className="absolute top-1/2 right-1.5 -translate-y-1/2" base={String(value)} onText={(t) => onChange(t)} />
      </div>
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      inputMode={inputMode}
      autoFocus={autoFocus}
      className={cx(inputBase, className)}
      {...rest}
    />
  );
}

const parseNum = (t: string): number => {
  const v = parseFloat(t.replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};
const formatNum = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '');

/**
 * Numeric field that behaves on iPhone: a text input with the decimal keypad (so "1,5" works
 * with an Italian keyboard — iOS reports an empty value for commas in type="number"), a local
 * draft so the field can be cleared or hold "1," while typing, and clamping on blur.
 */
export function NumberInput({ value, onChange, min, max, step = 1, className, placeholder, ...rest }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(() => formatNum(value));
  useEffect(() => {
    // Sync external changes (e.g. a preset fills the field) without fighting the user's typing.
    setDraft((d) => (parseNum(d) === value ? d : formatNum(value)));
  }, [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <input
      type="text"
      inputMode={step < 1 ? 'decimal' : min !== undefined && min >= 0 ? 'decimal' : 'text'}
      autoComplete="off"
      enterKeyHint="done"
      value={draft}
      placeholder={placeholder ?? '0'}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.,-]/g, '');
        setDraft(t);
        onChange(clamp(parseNum(t)));
      }}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => setDraft(formatNum(clamp(value)))}
      className={cx(inputBase, 'num', className)}
      {...rest}
    />
  );
}

export function TimeInput({ value, onChange, className, ...rest }: { value: string; onChange: (v: string) => void; className?: string; 'aria-label'?: string }) {
  return <input type="time" value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputBase, 'num', className)} {...rest} />;
}

export function Select<T extends string | number>({ value, onChange, options, className, ...rest }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div className="relative">
      <select
        value={String(value)}
        onChange={(e) => {
          const found = options.find((o) => String(o.value) === e.target.value);
          if (found) onChange(found.value);
        }}
        className={cx(inputBase, 'appearance-none pr-10', className)}
        {...rest}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted">
        <Icon name="chevronDown" size={18} />
      </span>
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 4, className, ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string; 'aria-label'?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={cx('w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] outline-none focus:border-accent', className)}
      {...rest}
    />
  );
}

/** iOS grouped list. */
export function List({ children, className, title, footer }: { children: ReactNode; className?: string; title?: ReactNode; footer?: ReactNode }) {
  return (
    <div className={cx('mt-5', className)}>
      {title && <div className="mb-1.5 px-4 text-[13px] font-semibold text-muted uppercase">{title}</div>}
      <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">{children}</div>
      {footer && <div className="mt-1.5 px-4 text-[12px] text-muted">{footer}</div>}
    </div>
  );
}

export function Row({
  icon,
  iconBg,
  title,
  subtitle,
  value,
  onClick,
  chevron,
  right,
  destructive,
  iconName,
}: {
  icon?: ReactNode;
  iconBg?: string;
  iconName?: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  right?: ReactNode;
  destructive?: boolean;
}) {
  const content = (
    <>
      {(icon || iconName) && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[18px]" style={{ background: iconBg ?? 'var(--lf-surface-2)' }} aria-hidden>
          {iconName ? <Icon name={iconName} size={18} /> : icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[16px]', destructive && 'text-danger')}>{title}</span>
        {subtitle && <span className="block truncate text-[13px] text-muted">{subtitle}</span>}
      </span>
      {value !== undefined && <span className="num shrink-0 text-[15px] text-muted">{value}</span>}
      {right}
      {(chevron ?? !!onClick) && !right && <Icon name="chevronRight" size={18} className="shrink-0 text-faint" />}
    </>
  );
  const cls = 'flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left';
  return onClick ? (
    <button
      type="button"
      className={cx(cls, 'active:bg-surface-2')}
      onClick={() => {
        haptics.tap();
        onClick();
      }}
    >
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}
