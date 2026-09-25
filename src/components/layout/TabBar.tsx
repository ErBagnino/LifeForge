import { motion } from 'motion/react';
import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router';
import { buildBlockers } from '@/domain/tycoon';
import { useLevel } from '@/hooks';
import { haptics } from '@/services/haptics';
import { useGame } from '@/store/gameStore';
import { Icon, type IconName } from '../ui/Icon';
import { cx } from '../ui/primitives';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Today', icon: 'today' },
  { to: '/quests', label: 'Quests', icon: 'quests' },
  { to: '/train', label: 'Train', icon: 'train' },
  { to: '/world', label: 'World', icon: 'world' },
  { to: '/stats', label: 'Stats', icon: 'stats' },
];

export function TabBar() {
  const location = useLocation();
  const buildings = useGame((s) => s.buildings);
  const coins = useGame((s) => s.player?.coins ?? 0);
  const { level } = useLevel();
  const canBuild = useMemo(() => buildings.some((b) => buildBlockers(b, level, coins, buildings).length === 0), [buildings, level, coins]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 glass border-t border-line" aria-label="Main">
      <div className="mx-auto flex max-w-[560px] px-1 pb-[var(--safe-bottom)]" style={{ height: 'calc(var(--tabbar-h) + var(--safe-bottom))' }}>
        {TABS.map((t) => {
          const active = t.to === '/' ? location.pathname === '/' : location.pathname.startsWith(t.to);
          return (
            <NavLink
              key={t.to}
              to={t.to}
              onClick={() => haptics.tap()}
              className={cx('relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1 text-[10.5px] font-semibold', active ? 'text-accent' : 'text-faint')}
              aria-current={active ? 'page' : undefined}
            >
              <motion.span animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} className="relative">
                <Icon name={t.icon} size={25} strokeWidth={active ? 2.3 : 1.9} />
                {t.to === '/world' && canBuild && <span className="absolute -top-0.5 -right-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--lf-tabbar)] bg-danger" aria-label="Upgrade available" />}
              </motion.span>
              {t.label}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
