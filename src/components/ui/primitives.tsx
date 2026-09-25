import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef, type ReactNode } from 'react';
import { haptics } from '@/services/haptics';
import { Icon, type IconName } from './Icon';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  children,
  className,
  onClick,
  as: As = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  as?: 'div' | 'section' | 'article';
  'aria-label'?: string;
}) {
  if (onClick) {
    return (
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => {
          haptics.tap();
          onClick();
        }}
        className={cx('block w-full rounded-3xl bg-surface p-4 text-left shadow-card', className)}
        {...rest}
      >
        {children}
      </motion.button>
    );
  }
  return (
    <As className={cx('rounded-3xl bg-surface p-4 shadow-card', className)} {...rest}>
      {children}
    </As>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'tinted';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent',
  secondary: 'bg-surface-2 text-fg',
  ghost: 'bg-transparent text-accent',
  danger: 'bg-danger/10 text-danger',
  success: 'bg-success text-white',
  tinted: 'bg-accent/12 text-accent',
};
const SIZES: Record<ButtonSize, string> = {
  sm: 'hit-44 h-10 px-3.5 text-[14px] rounded-xl gap-1.5',
  md: 'h-11 px-4 text-[15px] rounded-2xl gap-2',
  lg: 'h-14 px-5 text-[17px] rounded-2xl gap-2',
};

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  block?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, block, loading, className, children, disabled, onClick, type = 'button', ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      disabled={disabled || loading}
      onClick={(e) => {
        haptics.tap();
        onClick?.(e);
      }}
      className={cx(
        'inline-flex select-none items-center justify-center font-semibold transition-opacity',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        (disabled || loading) && 'opacity-45',
        className,
      )}
      {...rest}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon && <Icon name={icon} size={size === 'sm' ? 16 : 19} />}
      {children}
    </motion.button>
  );
});

export function IconButton({
  icon,
  label,
  onClick,
  variant = 'secondary',
  size = 44,
  className,
  badge,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  variant?: 'secondary' | 'ghost' | 'primary' | 'glass';
  size?: number;
  className?: string;
  badge?: number | boolean;
}) {
  const v = { secondary: 'bg-surface-2 text-fg', ghost: 'text-fg', primary: 'bg-accent text-on-accent', glass: 'glass text-fg shadow-card' }[variant];
  return (
    <motion.button
      type="button"
      aria-label={label}
      whileTap={{ scale: 0.9 }}
      onClick={() => {
        haptics.tap();
        onClick?.();
      }}
      className={cx('relative inline-flex shrink-0 items-center justify-center rounded-full', v, className)}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={Math.round(size * 0.46)} />
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">
          {typeof badge === 'number' ? badge : ''}
        </span>
      ) : null}
    </motion.button>
  );
}

export function Chip({ children, color, className, icon }: { children: ReactNode; color?: string; className?: string; icon?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold', !color && 'bg-surface-2 text-muted', className)}
      style={color ? { color, background: `color-mix(in srgb, ${color} 14%, transparent)` } : undefined}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-2 mt-6 flex items-end justify-between px-1', className)}>
      <h2 className="text-[13px] font-bold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-surface px-6 py-10 text-center shadow-card">
      <div className="mb-3 text-5xl" aria-hidden>
        {icon}
      </div>
      <div className="text-[17px] font-semibold">{title}</div>
      {body && <p className="mt-1 max-w-xs text-[14px] text-muted text-balance">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('lf-skeleton rounded-2xl', className)} aria-hidden />;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px bg-line', className)} />;
}

export function Kpi({ label, value, sub, color, icon }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; icon?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-1 truncate text-[12px] font-medium text-muted">
        {icon && <span aria-hidden>{icon}</span>}
        {label}
      </div>
      <div className="num mt-0.5 truncate text-[20px] font-bold" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="truncate text-[12px] text-muted">{sub}</div>}
    </div>
  );
}
