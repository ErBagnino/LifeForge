import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../ui/Icon';
import { cx } from '../ui/primitives';
import { GameHud } from './GameHud';

/** Page wrapper: iOS large-title header (or the game HUD on main tabs) + safe-area padding. */
export function Screen({
  title,
  subtitle,
  children,
  back,
  right,
  hud,
  className,
  noPad,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  back?: boolean | string;
  right?: ReactNode;
  hud?: boolean;
  className?: string;
  noPad?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className={cx('min-h-full pb-tabbar', className)}>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[var(--safe-top)] glass" />
      {hud ? (
        <GameHud />
      ) : (
        (back || right) && (
          <div className="sticky top-0 z-20 glass pt-safe">
            <div className="flex h-12 items-center gap-2 px-safe">
              {back && (
                <button
                  type="button"
                  onClick={() => (typeof back === 'string' ? navigate(back) : window.history.length > 1 ? navigate(-1) : navigate('/'))}
                  className="-ml-2 flex h-11 items-center gap-0.5 pr-2 text-[17px] text-accent"
                  aria-label="Back"
                >
                  <Icon name="chevronLeft" size={26} />
                  <span>Back</span>
                </button>
              )}
              <div className="flex-1" />
              {right}
            </div>
          </div>
        )
      )}
      <div className={cx(!noPad && 'px-safe', !hud && !back && !right && 'pt-safe')}>
        {title && (
          <header className="pt-3 pb-1">
            <h1 className="text-[32px] leading-tight font-extrabold tracking-tight text-balance">{title}</h1>
            {subtitle && <p className="mt-0.5 text-[15px] text-muted">{subtitle}</p>}
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
