import { motion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar } from '@/components/game/Avatar';
import type { AvatarConfig, Building } from '@/types';

/**
 * The world as a miniature tabletop diorama: an isometric board where every room is a small
 * building on its own tile. Buildings visibly grow with their level (foundation → cube → roof →
 * lights → annex and plants → premium trim and flag), the light follows the time of day, rooms
 * glow when related real-life quests were done this week, and upgrades play a short build.
 * Pure SVG: no WebGL, cheap to render, crisp at any size.
 */

const W = 96; // tile width
const H = 48; // tile height (2:1 isometric)
const COLS = 4;
const ROWS = 3;
const OX = 144;
const OY = 104;
const PLATE = 16;
const VIEW_W = 336;
const VIEW_H = 290;

/** Board placement: related rooms sit next to each other; the last tile is the plaza. */
const LAYOUT: Record<string, [number, number]> = {
  bedroom: [0, 0],
  bathroom: [1, 0],
  kitchen: [2, 0],
  pet_corner: [3, 0],
  gym: [0, 1],
  garden: [1, 1],
  office: [2, 1],
  library: [3, 1],
  workshop: [0, 2],
  recreation: [1, 2],
  storage: [2, 2],
};
const PLAZA: [number, number] = [3, 2];

type Light = 'day' | 'evening' | 'night';

export function lightFor(hour: number): Light {
  if (hour >= 6 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
}

function center(col: number, row: number) {
  return { x: OX + (col - row) * (W / 2), y: OY + (col + row) * (H / 2) };
}

function shade(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const v = parseInt(n.length === 3 ? n.split('').map((c) => c + c).join('') : n, 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * (1 + amt))));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function diamond(x: number, y: number, a: number, b: number): [number, number][] {
  return [
    [x, y - b],
    [x + a, y],
    [x, y + b],
    [x - a, y],
  ];
}

/** An isometric box standing on (x, y): width 2a, height h. */
function Box({ x, y, a, h, wall, dim, trim }: { x: number; y: number; a: number; h: number; wall: string; dim: number; trim?: string }) {
  const b = a / 2;
  const L: [number, number] = [x - a, y];
  const B: [number, number] = [x, y + b];
  const R: [number, number] = [x + a, y];
  const up = (p: [number, number]): [number, number] => [p[0], p[1] - h];
  return (
    <g>
      <polygon points={pts([L, B, up(B), up(L)])} fill={shade(wall, -0.1 + dim)} />
      <polygon points={pts([B, R, up(R), up(B)])} fill={shade(wall, -0.24 + dim)} />
      <polygon points={pts(diamond(x, y - h, a, b))} fill={shade(wall, 0.04 + dim)} stroke={trim} strokeWidth={trim ? 1.4 : 0} />
    </g>
  );
}

function Roof({ x, y, a, h, rise, color, dim }: { x: number; y: number; a: number; h: number; rise: number; color: string; dim: number }) {
  const b = a / 2;
  const top = y - h;
  const apex: [number, number] = [x, top - rise];
  const L: [number, number] = [x - a - 2, top];
  const B: [number, number] = [x, top + b + 1];
  const R: [number, number] = [x + a + 2, top];
  return (
    <g>
      <polygon points={pts([L, B, apex])} fill={shade(color, -0.05 + dim)} />
      <polygon points={pts([B, R, apex])} fill={shade(color, -0.28 + dim)} />
    </g>
  );
}

/** Windows on both visible faces; lit at night. */
function Windows({ x, y, a, h, lit, rows }: { x: number; y: number; a: number; h: number; lit: boolean; rows: number }) {
  const b = a / 2;
  const glass = lit ? '#ffd76a' : '#a9d8f5';
  const out = [];
  for (let r = 0; r < rows; r++) {
    const wy = y - h + 8 + r * 11;
    // left face (slopes down to the right)
    const lx = x - a * 0.55;
    out.push(<polygon key={`l${r}`} points={pts([[lx - 5, wy - 2.5], [lx + 3, wy + 1.5], [lx + 3, wy + 7.5], [lx - 5, wy + 3.5]])} fill={glass} opacity={0.95} />);
    // right face (slopes up to the right)
    const rx = x + a * 0.5;
    out.push(<polygon key={`r${r}`} points={pts([[rx - 4, wy + 1.5], [rx + 4, wy - 2.5], [rx + 4, wy + 3.5], [rx - 4, wy + 7.5]])} fill={glass} opacity={0.95} />);
  }
  return (
    <g>
      {lit && <ellipse cx={x} cy={y - h / 2} rx={a * 1.2} ry={h * 0.6} fill="#ffcf5a" opacity={0.12} />}
      {out}
      {/* door on the right face */}
      <polygon points={pts([[x + 4, y + b - 2], [x + 11, y + b - 5.5], [x + 11, y + b - 16.5], [x + 4, y + b - 13]])} fill={shade('#6b4a2f', 0)} />
    </g>
  );
}

function Tile({ col, row, built, glow, dim }: { col: number; row: number; built: boolean; glow: boolean; dim: number }) {
  const { x, y } = center(col, row);
  const top = diamond(x, y, W / 2 - 3, H / 2 - 1.5);
  return (
    <g>
      <polygon points={pts(top)} fill={built ? shade('#8fcf74', dim) : shade('#9aa38f', dim - 0.05)} stroke={built ? shade('#6fae58', dim) : 'rgba(255,255,255,0.35)'} strokeWidth={built ? 1 : 1.2} strokeDasharray={built ? undefined : '4 3'} />
      {built && <polygon points={pts(diamond(x + W * 0.12, y + H * 0.12, W * 0.12, H * 0.07))} fill={shade('#d9c9a8', dim)} opacity={0.8} />}
      {glow && <ellipse cx={x} cy={y} rx={W * 0.36} ry={H * 0.3} fill="var(--lf-accent)" opacity={0.22} />}
    </g>
  );
}

function BuildingModel({ b, x, y, light, dim, building }: { b: Building; x: number; y: number; light: Light; dim: number; building: boolean }) {
  const lvl = b.level;
  const wall = b.palette.wall;
  const accent = b.palette.accent;
  const lit = light !== 'day' && lvl >= 1;
  if (lvl === 0) {
    return (
      <g opacity={0.9}>
        <polygon points={pts(diamond(x, y, 22, 11))} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1.2} strokeDasharray="3 3" />
        <text x={x} y={y + 5} textAnchor="middle" fontSize={16} opacity={0.75}>
          {b.icon}
        </text>
      </g>
    );
  }
  const a = lvl >= 3 ? 23 : 20;
  const h = [0, 20, 24, 30, 34, 40][lvl];
  return (
    <g>
      <ellipse cx={x + 4} cy={y + 4} rx={a + 10} ry={(a + 10) / 2.4} fill="#000" opacity={0.16} />
      {lvl >= 4 && <Box x={x - a - 6} y={y + 4} a={11} h={14} wall={wall} dim={dim - 0.06} />}
      <Box x={x} y={y} a={a} h={h} wall={wall} dim={dim} trim={lvl >= 5 ? '#e8b400' : undefined} />
      <Windows x={x} y={y} a={a} h={h} lit={lit} rows={lvl >= 3 ? 2 : 1} />
      {lvl >= 2 && <Roof x={x} y={y} a={a} h={h} rise={lvl >= 5 ? 20 : 15} color={accent} dim={dim} />}
      {lvl === 1 && <polygon points={pts(diamond(x, y - h - 1, a * 0.6, a * 0.3))} fill={shade(accent, dim)} opacity={0.9} />}
      {lvl >= 3 && (
        <g>
          <line x1={x + a + 10} y1={y + 8} x2={x + a + 10} y2={y - 14} stroke={shade('#3d3d44', dim)} strokeWidth={1.6} />
          <circle cx={x + a + 10} cy={y - 15} r={2.4} fill={light === 'day' ? '#f2f2f2' : '#ffd76a'} />
          {light !== 'day' && <circle cx={x + a + 10} cy={y - 15} r={9} fill="#ffd76a" opacity={0.25} />}
        </g>
      )}
      {lvl >= 4 && (
        <g>
          <ellipse cx={x - 20} cy={y + 14} rx={5} ry={4} fill={shade('#3f9b43', dim)} />
          <ellipse cx={x + 22} cy={y + 13} rx={4} ry={3.4} fill={shade('#4caf50', dim)} />
        </g>
      )}
      {lvl >= 5 && (
        <g>
          <line x1={x} y1={y - h - 20} x2={x} y2={y - h - 34} stroke="#444" strokeWidth={1.2} />
          <motion.polygon points={pts([[x, y - h - 34], [x + 10, y - h - 31], [x, y - h - 28]])} fill={accent} animate={{ skewY: [0, 4, 0] }} transition={{ repeat: Infinity, duration: 2.4 }} />
        </g>
      )}
      {lvl === 1 && (
        <text x={x} y={y - h - 6} textAnchor="middle" fontSize={11}>
          {b.icon}
        </text>
      )}
      {lvl >= 2 && (
        <g aria-hidden>
          <circle cx={x - a * 0.62} cy={y + 3} r={6.5} fill="#fff" opacity={0.92} />
          <text x={x - a * 0.62} y={y + 6} textAnchor="middle" fontSize={8}>
            {b.icon}
          </text>
        </g>
      )}
      {building && <Scaffold x={x} y={y} a={a} h={h} />}
    </g>
  );
}

function Scaffold({ x, y, a, h }: { x: number; y: number; a: number; h: number }) {
  return (
    <motion.g initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: 1.1, duration: 0.4 }}>
      {[-a - 4, a + 4].map((dx) => (
        <line key={dx} x1={x + dx} y1={y + 2} x2={x + dx} y2={y - h - 10} stroke="#c28a3a" strokeWidth={1.6} />
      ))}
      {[0.3, 0.65].map((f) => (
        <line key={f} x1={x - a - 4} y1={y - h * f} x2={x + a + 4} y2={y - h * f} stroke="#c28a3a" strokeWidth={1.4} />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.circle key={i} cx={x - 16 + i * 8} cy={y + 6} r={3} fill="#e8dcc6" initial={{ opacity: 0.9, scale: 0.5 }} animate={{ opacity: 0, scale: 2, y: -10 - i * 2 }} transition={{ duration: 1.2, delay: i * 0.08 }} />
      ))}
    </motion.g>
  );
}

export function Diorama({ buildings, hour, avatar, activity, petEmoji, onSelect }: { buildings: Building[]; hour: number; avatar?: AvatarConfig; activity: Record<string, number>; petEmoji?: string; onSelect: (b: Building) => void }) {
  const light = lightFor(hour);
  const dim = light === 'night' ? -0.32 : light === 'evening' ? -0.1 : 0;
  const [lifted, setLifted] = useState<string | null>(null);
  const [constructing, setConstructing] = useState<Record<string, boolean>>({});
  const prev = useRef<Record<string, number> | null>(null);

  // Play a short build when a room's level goes up while the world is on screen.
  useEffect(() => {
    const levels = Object.fromEntries(buildings.map((b) => [b.id, b.level]));
    const before = prev.current;
    prev.current = levels;
    if (!before) return;
    const up = buildings.filter((b) => b.level > (before[b.id] ?? b.level)).map((b) => b.id);
    if (!up.length) return;
    setConstructing((c) => ({ ...c, ...Object.fromEntries(up.map((id) => [id, true])) }));
    const t = setTimeout(() => setConstructing((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !up.includes(k)))), 1600);
    return () => clearTimeout(t);
  }, [buildings]);

  const placed = buildings
    .filter((b) => LAYOUT[b.id])
    .map((b) => ({ b, col: LAYOUT[b.id][0], row: LAYOUT[b.id][1] }))
    .sort((p, q) => p.col + p.row - (q.col + q.row) || p.col - q.col);

  const select = (b: Building) => {
    setLifted(b.id);
    setTimeout(() => {
      setLifted(null);
      onSelect(b);
    }, 160);
  };
  const onKey = (e: KeyboardEvent, b: Building) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(b);
    }
  };

  const gridTop: [number, number] = [OX, OY - H / 2];
  const gridRight: [number, number] = [OX + (COLS - 1) * (W / 2) + W / 2, OY + (COLS - 1) * (H / 2)];
  const gridBottom: [number, number] = [OX + (COLS - 1 - (ROWS - 1)) * (W / 2), OY + (COLS - 1 + ROWS - 1) * (H / 2) + H / 2];
  const gridLeft: [number, number] = [OX - (ROWS - 1) * (W / 2) - W / 2, OY + (ROWS - 1) * (H / 2)];
  const m = 8;
  const plateTop: [number, number] = [gridTop[0], gridTop[1] - m / 2];
  const plateRight: [number, number] = [gridRight[0] + m, gridRight[1]];
  const plateBottom: [number, number] = [gridBottom[0], gridBottom[1] + m / 2];
  const plateLeft: [number, number] = [gridLeft[0] - m, gridLeft[1]];
  const down = (p: [number, number]): [number, number] => [p[0], p[1] + PLATE];
  const plaza = center(...PLAZA);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-auto w-full" role="group" aria-label="Your world. Tap a room to open it.">
        {/* tabletop plate: wood edge + base */}
        <ellipse cx={VIEW_W / 2} cy={plateBottom[1] + PLATE + 6} rx={VIEW_W * 0.42} ry={12} fill="#000" opacity={0.12} />
        <polygon points={pts([plateLeft, plateBottom, down(plateBottom), down(plateLeft)])} fill={shade('#8a5f3c', dim)} />
        <polygon points={pts([plateBottom, plateRight, down(plateRight), down(plateBottom)])} fill={shade('#6e4a2e', dim)} />
        <polygon points={pts([plateTop, plateRight, plateBottom, plateLeft])} fill={shade('#b98b5f', dim)} />
        {/* plaza */}
        <polygon points={pts(diamond(plaza.x, plaza.y, W / 2 - 3, H / 2 - 1.5))} fill={shade('#d8cdb8', dim)} stroke={shade('#bfb39c', dim)} />
        <circle cx={plaza.x - 18} cy={plaza.y - 2} r={4} fill={shade('#4caf50', dim)} />
        {placed.map(({ b, col, row }) => {
          const { x, y } = center(col, row);
          const glow = (activity[b.id] ?? 0) > 0 && b.level > 0;
          return (
            <g
              key={b.id}
              role="button"
              tabIndex={0}
              aria-label={`${b.name}${b.level ? ` level ${b.level}` : ', not built'}${glow ? `, ${activity[b.id]} related quests this week` : ''}`}
              onClick={() => select(b)}
              onKeyDown={(e) => onKey(e, b)}
              className="cursor-pointer outline-none focus-visible:[&>g]:opacity-90"
              style={{ transform: lifted === b.id ? 'translateY(-6px)' : undefined, transition: 'transform 140ms cubic-bezier(0.22,1,0.36,1)' }}
            >
              <Tile col={col} row={row} built={b.level > 0} glow={glow} dim={dim} />
              <BuildingModel b={b} x={x} y={y + 2} light={light} dim={dim} building={!!constructing[b.id]} />
              {b.id === 'pet_corner' && b.level > 0 && petEmoji && (
                <text x={x - 24} y={y + 12} fontSize={12} className="lf-bob">
                  {petEmoji}
                </text>
              )}
              {b.level > 0 && (
                <g transform={`translate(${x - 11}, ${y + H / 2 - 9})`}>
                  {Array.from({ length: b.maxLevel }, (_, i) => (
                    <circle key={i} cx={i * 5.5} cy={0} r={1.8} fill={i < b.level ? '#fff' : 'rgba(255,255,255,0.35)'} />
                  ))}
                </g>
              )}
              {glow && (
                <g transform={`translate(${x + 18}, ${y - 34})`}>
                  <rect x={-8} y={-7} width={18} height={12} rx={6} fill="var(--lf-accent)" />
                  <text x={1} y={2} textAnchor="middle" fontSize={7.5} fontWeight={800} fill="#fff">
                    +{activity[b.id]}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {avatar && (
        <div className="lf-bob pointer-events-none absolute" style={{ left: `${((plaza.x - 4) / VIEW_W) * 100}%`, top: `${((plaza.y - 14) / VIEW_H) * 100}%`, transform: 'translateX(-50%)' }} aria-hidden>
          <Avatar config={avatar} size={30} />
        </div>
      )}
    </div>
  );
}

/** One building on its tile, for previews ("now → next level"). */
export function BuildingPreview({ building, level, hour, label }: { building: Building; level: number; hour: number; label?: string }) {
  const light = lightFor(hour);
  const dim = light === 'night' ? -0.32 : light === 'evening' ? -0.1 : 0;
  const b = { ...building, level };
  return (
    <svg viewBox="0 0 120 110" className="block h-auto w-full" role="img" aria-label={label ?? `${building.name} level ${level}`}>
      <polygon points={pts(diamond(60, 84, 50, 25))} fill={shade('#b98b5f', dim)} />
      <polygon points={pts([[10, 84], [60, 109], [60, 104], [14, 82]])} fill={shade('#8a5f3c', dim)} opacity={0.6} />
      <polygon points={pts(diamond(60, 82, W / 2 - 3, H / 2 - 1.5))} fill={level > 0 ? shade('#8fcf74', dim) : shade('#9aa38f', dim - 0.05)} />
      <BuildingModel b={b} x={60} y={84} light={light} dim={dim} building={false} />
    </svg>
  );
}
