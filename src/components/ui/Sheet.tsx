import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { cx } from './primitives';

let openSheets = 0;

function useBodyLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openSheets++;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      openSheets--;
      if (openSheets <= 0) document.documentElement.style.overflow = '';
    };
  }, [open]);
}

/** iOS-style bottom sheet: drag down to dismiss, safe-area aware, focus-trapped enough for a PWA. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  full,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
  className?: string;
}) {
  const controls = useDragControls();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useBodyLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => panel.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" role="presentation">
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            className={cx(
              'absolute inset-x-0 bottom-0 mx-auto flex max-w-[560px] flex-col rounded-t-[28px] bg-bg shadow-float outline-none',
              full ? 'top-[max(12px,var(--safe-top))]' : 'max-h-[92dvh]',
              className,
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div className="shrink-0 touch-none px-4 pt-2 pb-1" onPointerDown={(e) => controls.start(e)}>
              <div className="mx-auto h-1.5 w-10 rounded-full bg-fg/15" />
              {title !== undefined && (
                <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
                  <h2 id={titleId} className="min-w-0 flex-1 truncate text-[20px] font-bold">
                    {title}
                  </h2>
                  <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-muted">
                    <Icon name="close" size={18} />
                  </button>
                </div>
              )}
            </div>
            <div className="scroll-touch min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
            {footer && <div className="shrink-0 border-t border-line px-4 pt-3 pb-[max(16px,var(--safe-bottom))]">{footer}</div>}
            {!footer && <div className="shrink-0 pb-[var(--safe-bottom)]" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Centered iOS-style alert for confirmations. */
export function Dialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useBodyLock(open);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-8" role="alertdialog" aria-modal="true" aria-label={title}>
          <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} />
          <motion.div
            className="relative w-full max-w-[300px] overflow-hidden rounded-[22px] bg-surface text-center shadow-float"
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="px-5 pt-5 pb-4">
              <div className="text-[17px] font-semibold">{title}</div>
              {message && <div className="mt-1 text-[14px] text-muted">{message}</div>}
            </div>
            <div className="grid grid-cols-2 border-t border-line">
              <button type="button" className="h-12 border-r border-line text-[17px] text-accent" onClick={onCancel}>
                {cancelLabel}
              </button>
              <button type="button" className={cx('h-12 text-[17px] font-semibold', destructive ? 'text-danger' : 'text-accent')} onClick={onConfirm}>
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
