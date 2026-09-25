import type { Muscle, MuscleIntensity, MuscleTarget } from '@/types';

const LABELS: Record<Muscle, string> = {
  chest: 'Chest',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  traps: 'Traps',
  lats: 'Lats',
  upper_back: 'Upper back',
  lower_back: 'Lower back',
  abs: 'Abs',
  obliques: 'Obliques',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  adductors: 'Adductors',
  calves: 'Calves',
};

export function muscleLabel(m: Muscle): string {
  return LABELS[m];
}

const OPACITY: Record<MuscleIntensity, number> = { high: 1, medium: 0.55, low: 0.28 };

type Shape = { d?: string; e?: [number, number, number, number]; r?: [number, number, number, number, number] };

/** Left-side shapes (the right side is mirrored). */
const FRONT: Partial<Record<Muscle, Shape[]>> = {
  front_delts: [{ e: [30, 43, 6.5, 6] }],
  side_delts: [{ e: [24.5, 48, 3.8, 6.5] }],
  chest: [{ d: 'M35 45 Q42 42 49 44 L49 60 Q42 63 36 58 Q33 52 35 45Z' }],
  traps: [{ d: 'M41 35 L47 33 L47 38 L38 40Z' }],
  biceps: [{ e: [24.5, 62, 4.2, 10.5] }],
  forearms: [{ e: [20.5, 97, 3.8, 13] }],
  abs: [{ r: [43.5, 64, 6, 34, 2.5] }],
  obliques: [{ e: [38.5, 80, 3.2, 12] }],
  quads: [{ e: [40.5, 136, 6.6, 20] }],
  adductors: [{ e: [46.5, 124, 2.6, 9] }],
  calves: [{ e: [39.5, 176, 3.8, 12] }],
};

const BACK: Partial<Record<Muscle, Shape[]>> = {
  traps: [{ d: 'M50 32 L41 38 L44 46 L50 62Z' }],
  rear_delts: [{ e: [30, 44, 6.5, 6] }],
  side_delts: [{ e: [24.5, 48, 3.8, 6.5] }],
  triceps: [{ e: [24.5, 63, 4.3, 11] }],
  forearms: [{ e: [20.5, 97, 3.8, 13] }],
  lats: [{ d: 'M36 50 Q43 54 46 64 L44 84 Q38 78 35 66Z' }],
  upper_back: [{ d: 'M44 47 L50 45 L50 64 L46 62Z' }],
  lower_back: [{ e: [46.5, 90, 3.6, 7] }],
  glutes: [{ e: [43, 113, 7.2, 8] }],
  hamstrings: [{ e: [41, 139, 6, 18] }],
  calves: [{ e: [40, 172, 5.5, 12] }],
};

function Silhouette() {
  const fill = 'var(--mm-body)';
  return (
    <g fill={fill}>
      <circle cx={50} cy={17} r={10.5} />
      <rect x={45} y={26} width={10} height={9} rx={3} />
      <path d="M29 38 Q50 32 71 38 Q76 42 76 50 L70 96 Q68 108 66 112 L34 112 Q32 108 30 96 L24 50 Q24 42 29 38Z" />
      <path d="M26 42 Q20 46 20 56 L18 82 Q16 100 16 114 L22 116 Q25 98 28 84 L31 58Z" />
      <path d="M74 42 Q80 46 80 56 L82 82 Q84 100 84 114 L78 116 Q75 98 72 84 L69 58Z" />
      <circle cx={18.5} cy={119} r={4} />
      <circle cx={81.5} cy={119} r={4} />
      <path d="M33 110 L49 112 L47 160 L45 194 L36 194 L34 160 Q32 130 33 110Z" />
      <path d="M67 110 L51 112 L53 160 L55 194 L64 194 L66 160 Q68 130 67 110Z" />
    </g>
  );
}

function Regions({ shapes, targets }: { shapes: Partial<Record<Muscle, Shape[]>>; targets: Map<Muscle, MuscleIntensity> }) {
  const draw = (mirror: boolean) =>
    (Object.entries(shapes) as [Muscle, Shape[]][]).map(([m, list]) => {
      const level = targets.get(m);
      const fill = level ? 'var(--lf-accent)' : 'var(--mm-muscle)';
      const opacity = level ? OPACITY[level] : 1;
      return list.map((s, i) => {
        const key = `${m}${i}${mirror ? 'r' : 'l'}`;
        const common = { fill, opacity, key };
        if (s.e) return <ellipse {...common} cx={s.e[0]} cy={s.e[1]} rx={s.e[2]} ry={s.e[3]} />;
        if (s.r) return <rect {...common} x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={s.r[4]} />;
        return <path {...common} d={s.d} />;
      });
    });
  return (
    <>
      <g>{draw(false)}</g>
      <g transform="translate(100,0) scale(-1,1)">{draw(true)}</g>
    </>
  );
}

/** Simplified front + back body with the trained muscles highlighted by intensity. */
export function MuscleMap({ muscles, height = 220, showLegend = true }: { muscles: MuscleTarget[]; height?: number; showLegend?: boolean }) {
  const targets = new Map<Muscle, MuscleIntensity>();
  const rank = { high: 3, medium: 2, low: 1 };
  for (const m of muscles) {
    const cur = targets.get(m.muscle);
    if (!cur || rank[m.level] > rank[cur]) targets.set(m.muscle, m.level);
  }
  const style = { '--mm-body': 'var(--lf-surface-3)', '--mm-muscle': 'color-mix(in srgb, var(--lf-text) 10%, var(--lf-surface-3))' } as React.CSSProperties;
  const sorted = [...targets.entries()].sort((a, b) => rank[b[1]] - rank[a[1]]);
  return (
    <div style={style}>
      <div className="flex justify-center gap-4">
        {(['front', 'back'] as const).map((side) => (
          <figure key={side} className="flex flex-col items-center">
            <svg viewBox="0 0 100 200" height={height} width={height / 2} role="img" aria-label={`${side} muscles`}>
              <Silhouette />
              <Regions shapes={side === 'front' ? FRONT : BACK} targets={targets} />
            </svg>
            <figcaption className="mt-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{side}</figcaption>
          </figure>
        ))}
      </div>
      {showLegend && sorted.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {sorted.map(([m, level]) => (
            <span key={m} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-semibold">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" style={{ opacity: OPACITY[level] }} />
              {LABELS[m]} <span className="text-muted uppercase">{level}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
