import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { haptics } from '@/services/haptics';
import { Icon } from './Icon';
import { cx } from './primitives';

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`lf-sec-${id}`);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

/**
 * Progressive disclosure: a section header that expands on tap.
 * The open/closed state is remembered per section on this device.
 */
export function Collapsible({
  id,
  title,
  meta,
  defaultOpen = true,
  children,
  className,
  right,
}: {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const toggle = () => {
    haptics.tap();
    setOpen((v) => {
      try {
        localStorage.setItem(`lf-sec-${id}`, v ? '0' : '1');
      } catch {
        // storage unavailable: state stays in memory
      }
      return !v;
    });
  };
  return (
    <section className={cx('mt-5', className)}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`sec-${id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
          <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.18 }} className="flex shrink-0 text-muted">
            <Icon name="chevronDown" size={18} />
          </motion.span>
          <span className="truncate text-[13px] font-bold tracking-wide text-muted uppercase">{title}</span>
          {meta !== undefined && <span className="num shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-bold text-muted">{meta}</span>}
        </button>
        {right}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={`sec-${id}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
