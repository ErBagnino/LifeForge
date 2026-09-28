import { motion } from 'motion/react';
import { Avatar } from '@/components/game/Avatar';
import { visibleFurniture } from '@/domain/tycoon';
import type { AvatarConfig, Building, Cosmetic } from '@/types';
import { clock } from '@/services/clock';

function skyFor(hour: number): string {
  if (hour >= 6 && hour < 17) return 'linear-gradient(#8fd3ff, #d9f1ff)';
  if (hour >= 17 && hour < 20) return 'linear-gradient(#ff9a62, #ffd29a)';
  return 'linear-gradient(#141a3a, #2c2f6b)';
}

/** A 2D room: wall, window, floor, level-based furniture and placed decorations. */
export function RoomScene({
  building,
  decorations,
  height = 112,
  showAvatar,
  avatar,
  hour = new Date().getHours(),
}: {
  building: Building;
  decorations: Cosmetic[];
  height?: number;
  showAvatar?: boolean;
  avatar?: AvatarConfig;
  hour?: number;
}) {
  const night = hour < 6 || hour >= 20;
  const outdoor = building.id === 'garden';
  const items = visibleFurniture(building);
  const decos = decorations.filter((d) => d.owned && d.equipped && d.room === building.id).map((d) => d.value);
  const all = [...items, ...decos];
  const floorH = Math.round(height * 0.28);

  return (
    <div className="relative w-full overflow-hidden" style={{ height, background: outdoor ? skyFor(hour) : building.palette.wall }}>
      {!outdoor && (
        <div className="absolute top-[14%] left-[10%] h-[34%] w-[22%] overflow-hidden rounded-md border-[3px] border-white/80" style={{ background: skyFor(hour) }}>
          <div className="absolute inset-x-0 top-1/2 h-[2px] bg-white/70" />
          <div className="absolute inset-y-0 left-1/2 w-[2px] bg-white/70" />
          {night && <span className="absolute top-0.5 right-1 text-[10px]">🌙</span>}
        </div>
      )}
      {outdoor && <div className="absolute top-2 right-3 text-[18px]">{night ? '🌙' : '☀️'}</div>}
      {!outdoor && building.level >= 3 && <div className="absolute top-[12%] right-[12%] h-[22%] w-[14%] rounded-sm border-2 border-black/10 bg-white/50" aria-hidden />}
      <div className="absolute inset-x-0 bottom-0" style={{ height: floorH, background: building.palette.floor }}>
        {!outdoor && <div className="absolute inset-x-0 top-0 h-[3px] bg-black/10" />}
      </div>
      <div className="absolute inset-x-2 flex items-end justify-around" style={{ bottom: floorH * 0.55 }}>
        {all.slice(0, 7).map((e, i) => (
          <motion.span
            key={`${e}${i}`}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: i * 0.05 }}
            className="leading-none drop-shadow-sm"
            style={{ fontSize: Math.round(height * (i === 0 ? 0.3 : 0.22)) }}
          >
            {e}
          </motion.span>
        ))}
      </div>
      {showAvatar && avatar && (
        <motion.div className="absolute" style={{ bottom: floorH * 0.35, right: '8%' }} animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}>
          <Avatar config={avatar} size={Math.round(height * 0.38)} />
        </motion.div>
      )}
      <Ambient building={building} night={night} outdoor={outdoor} height={height} />
      {night && !outdoor && <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,200,120,0.25),rgba(10,10,40,0.25))]" />}
      {night && outdoor && <div className="pointer-events-none absolute inset-0 bg-black/20" />}
    </div>
  );
}

const RECENT_MS = 24 * 3600_000;

/** Small ambient life per room (Motion honours the reduced-motion preference). */
function Ambient({ building, night, outdoor, height }: { building: Building; night: boolean; outdoor: boolean; height: number }) {
  const fresh = building.upgradedAt !== undefined && clock.now() - building.upgradedAt < RECENT_MS;
  const size = Math.round(height * 0.13);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {outdoor && !night && (
        <motion.span className="absolute" style={{ top: '30%', left: '20%', fontSize: size }} animate={{ x: [0, 40, 80, 40, 0], y: [0, -10, 4, -6, 0] }} transition={{ repeat: Infinity, duration: 9, ease: 'easeInOut' }}>
          🦋
        </motion.span>
      )}
      {outdoor &&
        night &&
        ['25% 35%', '60% 25%', '78% 45%'].map((p, i) => (
          <motion.span key={p} className="absolute text-yellow-200" style={{ left: p.split(' ')[0], top: p.split(' ')[1], fontSize: size * 0.8 }} animate={{ opacity: [0.1, 1, 0.1] }} transition={{ repeat: Infinity, duration: 2.2, delay: i * 0.7 }}>
            ✦
          </motion.span>
        ))}
      {building.id === 'kitchen' && (
        <motion.span className="absolute" style={{ bottom: '48%', left: '46%', fontSize: size }} animate={{ y: [0, -8], opacity: [0.8, 0] }} transition={{ repeat: Infinity, duration: 2.6, ease: 'easeOut' }}>
          ♨️
        </motion.span>
      )}
      {fresh && (
        <motion.span className="absolute top-1.5 right-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-on-accent" initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1] }} transition={{ duration: 0.6 }}>
          ✨ New
        </motion.span>
      )}
    </div>
  );
}
