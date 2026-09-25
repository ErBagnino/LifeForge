import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { DEFAULT_POSE_KEY, POSES, type PropDef } from '@/data/poses';
import type { MuscleTarget } from '@/types';
import { BONES, FLOOR_Y, lerpSkeleton, polar, solvePose, type LimbJoints, type Skeleton, type Vec } from './skeleton';

type Segment = 'torso' | 'upperArm' | 'foreArm' | 'thigh' | 'shin' | 'shoulder';

const MUSCLE_SEGMENTS: Record<string, Segment[]> = {
  chest: ['torso'],
  abs: ['torso'],
  obliques: ['torso'],
  lats: ['torso'],
  upper_back: ['torso'],
  lower_back: ['torso'],
  traps: ['torso', 'shoulder'],
  front_delts: ['shoulder'],
  side_delts: ['shoulder'],
  rear_delts: ['shoulder'],
  biceps: ['upperArm'],
  triceps: ['upperArm'],
  forearms: ['foreArm'],
  glutes: ['thigh', 'torso'],
  quads: ['thigh'],
  hamstrings: ['thigh'],
  adductors: ['thigh'],
  calves: ['shin'],
};

function highlights(muscles: MuscleTarget[]): Set<Segment> {
  const out = new Set<Segment>();
  for (const m of muscles) if (m.level === 'high') for (const s of MUSCLE_SEGMENTS[m.muscle] ?? []) out.add(s);
  return out;
}

const W = 120;
const H = 100;

function Line({ a, b, w, color, opacity = 1 }: { a: Vec; b: Vec; w: number; color: string; opacity?: number }) {
  return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={w} strokeLinecap="round" opacity={opacity} />;
}

function Props({ props, sk, back }: { props: PropDef[]; sk: Skeleton; back: boolean }) {
  const hands = [sk.arms[0].end, sk.arms[1].end];
  const metal = 'var(--ill-metal)';
  const pad = 'var(--ill-pad)';
  const out: React.ReactNode[] = [];
  props.forEach((p, i) => {
    const k = `${p.kind}${i}`;
    switch (p.kind) {
      case 'seat': {
        if (!back) break;
        const [x, y] = sk.hip;
        const top = sk.view === 'front' ? y + 5 : y + 5;
        out.push(<rect key={k} x={x - 12} y={top} width={24} height={4.5} rx={2} fill={pad} />);
        out.push(<line key={`${k}l`} x1={x} y1={top + 4} x2={x} y2={FLOOR_Y} stroke={metal} strokeWidth={2.5} />);
        out.push(<line key={`${k}b`} x1={x - 9} y1={FLOOR_Y} x2={x + 9} y2={FLOOR_Y} stroke={metal} strokeWidth={2.5} strokeLinecap="round" />);
        break;
      }
      case 'seat_back': {
        if (!back || sk.view !== 'side') break;
        const dir = sk.hip[0] - sk.neck[0];
        const off = dir >= 0 ? -5 : 5;
        const a: Vec = [sk.hip[0] + off * -0.2 - 4, sk.hip[1] + 4];
        const b: Vec = [sk.neck[0] - 4.5, sk.neck[1] - 2];
        out.push(<Line key={k} a={a} b={b} w={5} color={pad} />);
        break;
      }
      case 'bench': {
        if (!back) break;
        const xs = [sk.hip[0], sk.neck[0]];
        const y = Math.max(sk.hip[1], sk.neck[1]) + 5;
        out.push(<rect key={k} x={Math.min(...xs) - 6} y={y} width={Math.abs(xs[0] - xs[1]) + 16} height={4.5} rx={2} fill={pad} />);
        out.push(<line key={`${k}a`} x1={Math.min(...xs) + 2} y1={y + 4} x2={Math.min(...xs) + 2} y2={FLOOR_Y} stroke={metal} strokeWidth={2.5} />);
        out.push(<line key={`${k}b`} x1={Math.max(...xs) + 4} y1={y + 4} x2={Math.max(...xs) + 4} y2={FLOOR_Y} stroke={metal} strokeWidth={2.5} />);
        break;
      }
      case 'incline_bench': {
        if (!back) break;
        const a: Vec = [sk.hip[0] + 2, sk.hip[1] + 5];
        const b = polar(a, 140, 30);
        out.push(<Line key={k} a={a} b={b} w={5} color={pad} />);
        out.push(<rect key={`${k}s`} x={a[0] - 4} y={a[1]} width={14} height={4} rx={2} fill={pad} />);
        out.push(<line key={`${k}l`} x1={a[0] + 2} y1={a[1] + 3} x2={a[0] + 2} y2={FLOOR_Y} stroke={metal} strokeWidth={2.5} />);
        break;
      }
      case 'mat':
        if (back) out.push(<rect key={k} x={8} y={FLOOR_Y - 1.2} width={W - 16} height={2.4} rx={1.2} fill="var(--ill-mat)" />);
        break;
      case 'cable':
        if (back && p.anchor) {
          out.push(<circle key={`${k}p`} cx={p.anchor[0]} cy={p.anchor[1]} r={2.6} fill={metal} />);
          const mid: Vec = [(hands[0][0] + hands[1][0]) / 2, (hands[0][1] + hands[1][1]) / 2];
          out.push(<line key={k} x1={p.anchor[0]} y1={p.anchor[1]} x2={mid[0]} y2={mid[1]} stroke="var(--ill-cable)" strokeWidth={1} strokeDasharray="2 1.5" />);
        }
        break;
      case 'dumbbells':
        if (!back)
          hands.forEach((h, j) => {
            out.push(<rect key={`${k}${j}`} x={h[0] - 4.5} y={h[1] - 1.6} width={9} height={3.2} rx={1.4} fill="var(--ill-weight)" opacity={j === 1 && sk.view === 'side' ? 0.55 : 1} />);
          });
        break;
      case 'kettlebell':
        if (!back) {
          const h = hands[0];
          out.push(<circle key={k} cx={h[0] + 1} cy={h[1] + 3.5} r={4} fill="var(--ill-weight)" />);
        }
        break;
      case 'barbell':
        if (!back) {
          const h = hands[0];
          out.push(<line key={k} x1={h[0] - 1} y1={h[1]} x2={h[0] + 1} y2={h[1]} stroke="var(--ill-weight)" strokeWidth={2} />);
          out.push(<circle key={`${k}p`} cx={h[0]} cy={h[1]} r={6} fill="none" stroke="var(--ill-weight)" strokeWidth={2.5} />);
        }
        break;
      case 'bar': {
        if (back) break;
        const mid: Vec = [(hands[0][0] + hands[1][0]) / 2, (hands[0][1] + hands[1][1]) / 2];
        const w = (p.width ?? 16) / 2;
        out.push(<line key={k} x1={mid[0] - w} y1={mid[1]} x2={mid[0] + w} y2={mid[1]} stroke={metal} strokeWidth={2.2} strokeLinecap="round" />);
        break;
      }
      case 'rope':
        if (!back) hands.forEach((h, j) => out.push(<circle key={`${k}${j}`} cx={h[0]} cy={h[1] + 1.5} r={1.8} fill="var(--ill-cable)" />));
        break;
      case 'handles':
        if (!back) hands.forEach((h, j) => out.push(<rect key={`${k}${j}`} x={h[0] - 1.6} y={h[1] - 3} width={3.2} height={6} rx={1.4} fill={metal} opacity={j ? 0.6 : 1} />));
        break;
      case 'shin_pad':
      case 'ankle_pad': {
        if (back) break;
        const leg = sk.legs[0];
        const t = p.kind === 'shin_pad' ? 0.85 : 0.9;
        const pt: Vec = [leg.mid[0] + (leg.end[0] - leg.mid[0]) * t, leg.mid[1] + (leg.end[1] - leg.mid[1]) * t];
        out.push(<circle key={k} cx={pt[0]} cy={pt[1] + (p.kind === 'ankle_pad' ? -3 : 3)} r={3.4} fill={pad} />);
        break;
      }
      case 'forearm_pads':
        if (!back) sk.arms.forEach((a, j) => out.push(<Line key={`${k}${j}`} a={a.mid} b={a.end} w={7} color={pad} opacity={0.55} />));
        break;
      case 'platform': {
        if (!back) break;
        const f = sk.feet[0];
        const ang = p.angle ?? 90;
        const a = polar(f, ang, 9);
        const b = polar(f, ang + 180, 9);
        out.push(<Line key={k} a={a} b={b} w={3} color={metal} />);
        // Sled machines (leg press): a rail from the plate down to the floor so it doesn't float.
        if (p.width) {
          const base = polar(f, ang + 90, 4);
          out.push(<line key={`${k}r`} x1={base[0]} y1={base[1]} x2={base[0] + 4} y2={FLOOR_Y} stroke={metal} strokeWidth={2.5} opacity={0.6} />);
          out.push(<line key={`${k}f`} x1={sk.hip[0] - 9} y1={FLOOR_Y} x2={base[0] + 10} y2={FLOOR_Y} stroke={metal} strokeWidth={2.5} strokeLinecap="round" opacity={0.6} />);
        }
        break;
      }
      case 'bike': {
        if (!back) break;
        const [x, y] = sk.hip;
        out.push(<rect key={`${k}s`} x={x - 7} y={y + 4} width={14} height={3.5} rx={1.7} fill={pad} />);
        out.push(<line key={`${k}p`} x1={x} y1={y + 7} x2={x + 10} y2={FLOOR_Y - 10} stroke={metal} strokeWidth={3} />);
        out.push(<line key={`${k}h`} x1={x + 10} y1={FLOOR_Y - 10} x2={hands[0][0] + 2} y2={hands[0][1] + 2} stroke={metal} strokeWidth={3} />);
        out.push(<circle key={`${k}c`} cx={x + 12} cy={FLOOR_Y - 12} r={7} fill="none" stroke={metal} strokeWidth={2} />);
        out.push(<line key={`${k}b`} x1={x - 6} y1={FLOOR_Y} x2={x + 30} y2={FLOOR_Y} stroke={metal} strokeWidth={3} strokeLinecap="round" />);
        break;
      }
      case 'pullup_bar':
        if (back) {
          const y = Math.min(hands[0][1], hands[1][1]);
          out.push(<line key={k} x1={20} y1={y} x2={100} y2={y} stroke={metal} strokeWidth={3} strokeLinecap="round" />);
        }
        break;
    }
  });
  return <>{out}</>;
}

function Figure({ sk, hi }: { sk: Skeleton; hi: Set<Segment> }) {
  const body = 'var(--ill-body)';
  const far = 'var(--ill-far)';
  const accent = 'var(--lf-accent)';
  const col = (seg: Segment, isFar: boolean) => (hi.has(seg) ? accent : isFar ? far : body);
  const limb = (j: LimbJoints, upper: Segment, lower: Segment, isFar: boolean, w: number, key: string) => (
    <g key={key} opacity={isFar && sk.view === 'side' ? 0.85 : 1}>
      <Line a={j.root} b={j.mid} w={w} color={col(upper, isFar)} />
      <Line a={j.mid} b={j.end} w={w - 0.6} color={col(lower, isFar)} />
    </g>
  );
  const side = sk.view === 'side';
  const torsoAngle = (Math.atan2(sk.hip[1] - sk.neck[1], sk.neck[0] - sk.hip[0]) * 180) / Math.PI;
  const eye = polar(sk.head, torsoAngle - 90 * sk.facing, 2.8);
  return (
    <g>
      {side && limb(sk.arms[1], 'upperArm', 'foreArm', true, 5, 'af')}
      {side && limb(sk.legs[1], 'thigh', 'shin', true, 6, 'lf')}
      {side && <Line a={sk.legs[1].end} b={sk.feet[1]} w={3.5} color={far} />}
      {!side && limb(sk.legs[0], 'thigh', 'shin', false, 6, 'l0')}
      {!side && limb(sk.legs[1], 'thigh', 'shin', false, 6, 'l1')}
      {!side && (
        <>
          <Line a={sk.legs[0].end} b={sk.feet[0]} w={3.5} color={body} />
          <Line a={sk.legs[1].end} b={sk.feet[1]} w={3.5} color={body} />
          <Line a={sk.arms[0].root} b={sk.arms[1].root} w={7} color={hi.has('shoulder') ? accent : body} />
          <Line a={sk.legs[0].root} b={sk.legs[1].root} w={7} color={body} />
        </>
      )}
      <Line a={sk.hip} b={sk.neck} w={side ? 9 : 11} color={col('torso', false)} />
      {side && <circle cx={sk.neck[0]} cy={sk.neck[1]} r={4} fill={hi.has('shoulder') ? accent : body} />}
      <circle cx={sk.head[0]} cy={sk.head[1]} r={BONES.head} fill={body} />
      <circle cx={eye[0]} cy={eye[1]} r={0.9} fill="var(--ill-bg)" opacity={side ? 1 : 0} />
      {!side && (
        <>
          <circle cx={sk.head[0] - 2.2} cy={sk.head[1] - 0.5} r={0.8} fill="var(--ill-bg)" />
          <circle cx={sk.head[0] + 2.2} cy={sk.head[1] - 0.5} r={0.8} fill="var(--ill-bg)" />
        </>
      )}
      {side && limb(sk.legs[0], 'thigh', 'shin', false, 6.5, 'ln')}
      {side && <Line a={sk.legs[0].end} b={sk.feet[0]} w={4} color={body} />}
      {side && limb(sk.arms[0], 'upperArm', 'foreArm', false, 5.5, 'an')}
      {!side && limb(sk.arms[0], 'upperArm', 'foreArm', false, 5.5, 'a0')}
      {!side && limb(sk.arms[1], 'upperArm', 'foreArm', false, 5.5, 'a1')}
    </g>
  );
}

function scaleSkeleton(sk: Skeleton, s: number): Skeleton {
  if (s === 1) return sk;
  const c: Vec = [W / 2, H / 2];
  const v = (p: Vec): Vec => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s];
  const l = (j: LimbJoints): LimbJoints => ({ root: v(j.root), mid: v(j.mid), end: v(j.end) });
  return { ...sk, hip: v(sk.hip), neck: v(sk.neck), head: v(sk.head), arms: [l(sk.arms[0]), l(sk.arms[1])], legs: [l(sk.legs[0]), l(sk.legs[1])], feet: [v(sk.feet[0]), v(sk.feet[1])] };
}

/**
 * Stylised exercise figure built from a tiny pose library. Animates between the start
 * and end positions (static when reduced motion is on) and highlights the primary muscles.
 */
export function ExerciseIllustration({
  illustration,
  muscles = [],
  size = 160,
  mode = 'animate',
  className,
  label,
}: {
  illustration: string;
  muscles?: MuscleTarget[];
  size?: number;
  mode?: 'animate' | 'start' | 'end' | 'pair';
  className?: string;
  label?: string;
}) {
  const def = POSES[illustration] ?? POSES[DEFAULT_POSE_KEY];
  const reduce = useReducedMotion();
  const skeletons = useMemo(() => def.poses.map((p) => scaleSkeleton(solvePose(p), def.scale ?? 1)), [def]);
  const hi = useMemo(() => highlights(muscles), [muscles]);
  const [t, setT] = useState(0);
  const animate = mode === 'animate' && !reduce && skeletons.length > 1;

  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const start = performance.now();
    const period = 2600;
    const loop = (now: number) => {
      const phase = ((now - start) % period) / period;
      const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      setT(tri < 0.5 ? 2 * tri * tri : 1 - Math.pow(-2 * tri + 2, 2) / 2);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const render = (sk: Skeleton, key: string, caption?: string) => (
    <svg key={key} viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} role="img" aria-label={label ?? `${illustration.replace(/_/g, ' ')} illustration`} className="block">
      <rect width={W} height={H} rx={14} fill="var(--ill-bg)" />
      <line x1={4} y1={FLOOR_Y + 1.5} x2={W - 4} y2={FLOOR_Y + 1.5} stroke="var(--ill-floor)" strokeWidth={1.2} />
      <Props props={def.props} sk={sk} back />
      <Figure sk={sk} hi={hi} />
      <Props props={def.props} sk={sk} back={false} />
      {caption && (
        <text x={8} y={12} fontSize={7} fontWeight={700} fill="var(--lf-muted)">
          {caption}
        </text>
      )}
    </svg>
  );

  const style = {
    '--ill-bg': 'var(--lf-surface-2)',
    '--ill-body': 'var(--lf-text)',
    '--ill-far': 'color-mix(in srgb, var(--lf-text) 45%, var(--lf-surface-2))',
    '--ill-metal': 'color-mix(in srgb, var(--lf-muted) 80%, transparent)',
    '--ill-pad': 'color-mix(in srgb, var(--lf-muted) 45%, transparent)',
    '--ill-weight': 'color-mix(in srgb, var(--lf-text) 70%, #7a7a85)',
    '--ill-cable': 'var(--lf-muted)',
    '--ill-mat': 'color-mix(in srgb, var(--lf-accent) 35%, transparent)',
    '--ill-floor': 'var(--lf-border)',
  } as React.CSSProperties;

  if (mode === 'pair' && skeletons.length > 1) {
    const [a, b] = def.caption ?? ['Start', 'Finish'];
    return (
      <div className={`flex gap-2 ${className ?? ''}`} style={style}>
        {render(skeletons[0], 's', a)}
        {render(skeletons[1], 'e', b)}
      </div>
    );
  }
  const sk = animate ? lerpSkeleton(skeletons[0], skeletons[1], t) : skeletons[mode === 'end' && skeletons[1] ? 1 : 0];
  return (
    <div className={className} style={style}>
      {render(sk, 'one')}
    </div>
  );
}
