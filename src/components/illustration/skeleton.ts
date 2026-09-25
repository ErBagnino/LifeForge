/**
 * Tiny 2D forward-kinematics model for stylised exercise figures.
 * Angles are in degrees, math convention (0 = right, 90 = up). The SVG y-axis is flipped.
 */
export type Vec = [number, number];
/** [upper angle, lower angle, upper scale?, lower scale?] — scale < 1 simulates foreshortening. */
export type Limb = [number, number] | [number, number, number, number];

export interface SidePose {
  view: 'side';
  hip: Vec;
  torso: number;
  facing?: 1 | -1;
  armN: Limb;
  armF: Limb;
  legN: Limb;
  legF: Limb;
  footN?: number;
  footF?: number;
  /** Translate the figure so its lowest point rests on the floor (default true). */
  ground?: boolean;
}

export interface FrontPose {
  view: 'front';
  hip: Vec;
  torso: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  ground?: boolean;
}

export type Pose = SidePose | FrontPose;

export const FLOOR_Y = 94;
export const BONES = { torso: 26, neck: 4, head: 6.2, upperArm: 15, foreArm: 14, thigh: 19, shin: 19, foot: 6, shoulder: 8.5, hipWidth: 5.5 };

export interface LimbJoints {
  root: Vec;
  mid: Vec;
  end: Vec;
}

export interface Skeleton {
  view: 'side' | 'front';
  facing: 1 | -1;
  hip: Vec;
  neck: Vec;
  head: Vec;
  /** near/left = index 0, far/right = index 1 */
  arms: [LimbJoints, LimbJoints];
  legs: [LimbJoints, LimbJoints];
  feet: [Vec, Vec];
}

const rad = (d: number) => (d * Math.PI) / 180;
export function polar(from: Vec, angle: number, length: number): Vec {
  return [from[0] + Math.cos(rad(angle)) * length, from[1] - Math.sin(rad(angle)) * length];
}

function limb(root: Vec, l: Limb, upper: number, lower: number): LimbJoints {
  const mid = polar(root, l[0], upper * (l[2] ?? 1));
  const end = polar(mid, l[1], lower * (l[3] ?? 1));
  return { root, mid, end };
}

export function solvePose(pose: Pose): Skeleton {
  const hip = pose.hip;
  const neck = polar(hip, pose.torso, BONES.torso);
  const head = polar(neck, pose.torso, BONES.neck + BONES.head);
  let sk: Skeleton;
  if (pose.view === 'side') {
    const facing = pose.facing ?? 1;
    const shoulder = neck;
    const arms: [LimbJoints, LimbJoints] = [
      limb(shoulder, pose.armN, BONES.upperArm, BONES.foreArm),
      limb(shoulder, pose.armF, BONES.upperArm, BONES.foreArm),
    ];
    const legs: [LimbJoints, LimbJoints] = [
      limb(hip, pose.legN, BONES.thigh, BONES.shin),
      limb(hip, pose.legF, BONES.thigh, BONES.shin),
    ];
    const footBase = facing === 1 ? 0 : 180;
    const feet: [Vec, Vec] = [
      polar(legs[0].end, pose.footN ?? footBase, BONES.foot),
      polar(legs[1].end, pose.footF ?? footBase, BONES.foot),
    ];
    sk = { view: 'side', facing, hip, neck, head, arms, legs, feet };
  } else {
    const perp = pose.torso - 90;
    const shoulderL = polar(neck, perp + 180, BONES.shoulder);
    const shoulderR = polar(neck, perp, BONES.shoulder);
    const hipL = polar(hip, perp + 180, BONES.hipWidth);
    const hipR = polar(hip, perp, BONES.hipWidth);
    const arms: [LimbJoints, LimbJoints] = [
      limb(shoulderL, pose.armL, BONES.upperArm, BONES.foreArm),
      limb(shoulderR, pose.armR, BONES.upperArm, BONES.foreArm),
    ];
    const legs: [LimbJoints, LimbJoints] = [
      limb(hipL, pose.legL, BONES.thigh, BONES.shin),
      limb(hipR, pose.legR, BONES.thigh, BONES.shin),
    ];
    const feet: [Vec, Vec] = [polar(legs[0].end, 190, 4), polar(legs[1].end, -10, 4)];
    sk = { view: 'front', facing: 1, hip, neck, head, arms, legs, feet };
  }
  if (pose.ground !== false) {
    const limbPoints = [...sk.arms.flatMap((a) => [a.mid, a.end]), ...sk.legs.flatMap((l) => [l.mid, l.end]), ...sk.feet];
    const lowest = Math.max(
      ...limbPoints.map((p) => p[1] + 2.8),
      sk.hip[1] + 4.5,
      sk.neck[1] + 4.5,
      sk.head[1] + BONES.head,
    );
    const dy = FLOOR_Y - lowest;
    sk = translate(sk, 0, dy);
  }
  return sk;
}

function shift(v: Vec, dx: number, dy: number): Vec {
  return [v[0] + dx, v[1] + dy];
}

export function translate(sk: Skeleton, dx: number, dy: number): Skeleton {
  const l = (j: LimbJoints): LimbJoints => ({ root: shift(j.root, dx, dy), mid: shift(j.mid, dx, dy), end: shift(j.end, dx, dy) });
  return {
    ...sk,
    hip: shift(sk.hip, dx, dy),
    neck: shift(sk.neck, dx, dy),
    head: shift(sk.head, dx, dy),
    arms: [l(sk.arms[0]), l(sk.arms[1])],
    legs: [l(sk.legs[0]), l(sk.legs[1])],
    feet: [shift(sk.feet[0], dx, dy), shift(sk.feet[1], dx, dy)],
  };
}

/** Linear interpolation between two solved skeletons (used for the animated preview). */
export function lerpSkeleton(a: Skeleton, b: Skeleton, t: number): Skeleton {
  const v = (p: Vec, q: Vec): Vec => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const l = (p: LimbJoints, q: LimbJoints): LimbJoints => ({ root: v(p.root, q.root), mid: v(p.mid, q.mid), end: v(p.end, q.end) });
  return {
    ...a,
    hip: v(a.hip, b.hip),
    neck: v(a.neck, b.neck),
    head: v(a.head, b.head),
    arms: [l(a.arms[0], b.arms[0]), l(a.arms[1], b.arms[1])],
    legs: [l(a.legs[0], b.legs[0]), l(a.legs[1], b.legs[1])],
    feet: [v(a.feet[0], b.feet[0]), v(a.feet[1], b.feet[1])],
  };
}
