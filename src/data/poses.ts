import type { FrontPose, Pose, SidePose, Vec } from '@/components/illustration/skeleton';

export type PropKind =
  | 'seat'
  | 'seat_back'
  | 'bench'
  | 'incline_bench'
  | 'mat'
  | 'cable'
  | 'dumbbells'
  | 'barbell'
  | 'bar'
  | 'rope'
  | 'handles'
  | 'shin_pad'
  | 'ankle_pad'
  | 'forearm_pads'
  | 'platform'
  | 'bike'
  | 'pullup_bar'
  | 'kettlebell';

export interface PropDef {
  kind: PropKind;
  /** For cables: the pulley position. */
  anchor?: Vec;
  /** For bars: width. For platforms: non-zero draws a sled rail to the floor. */
  width?: number;
  /** For platforms: surface angle. */
  angle?: number;
}

export interface IllustrationDef {
  poses: [Pose] | [Pose, Pose];
  props: PropDef[];
  scale?: number;
  caption?: [string, string];
}

const side = (p: Omit<SidePose, 'view'>): SidePose => ({ view: 'side', ...p });
const front = (p: Omit<FrontPose, 'view'>): FrontPose => ({ view: 'front', ...p });

const stand = (o: Partial<SidePose> = {}): SidePose =>
  side({ hip: [60, 55], torso: 90, armN: [-90, -90], armF: [-88, -92], legN: [-90, -90], legF: [-90, -90], ...o });

const seated = (o: Partial<SidePose> = {}): SidePose =>
  side({ hip: [46, 72], torso: 98, armN: [-80, -60], armF: [-80, -60], legN: [0, -90], legF: [2, -92], ground: false, ...o });

const seatedFront = (o: Partial<FrontPose> = {}): FrontPose =>
  front({
    hip: [60, 70],
    torso: 90,
    armL: [-100, -95],
    armR: [-80, -85],
    legL: [-100, -92, 0.35, 1],
    legR: [-80, -88, 0.35, 1],
    ground: false,
    ...o,
  });

const standFront = (o: Partial<FrontPose> = {}): FrontPose =>
  front({ hip: [60, 55], torso: 90, armL: [-100, -95], armR: [-80, -85], legL: [-93, -90], legR: [-87, -90], ...o });

const supine = (o: Partial<SidePose> = {}): SidePose =>
  side({ hip: [60, 86], torso: 180, facing: 1, armN: [0, 0], armF: [0, 0], legN: [55, -65], legF: [57, -63], footN: 0, footF: 0, ...o });

export const POSES: Record<string, IllustrationDef> = {
  chest_press: {
    poses: [seated({ armN: [-160, 15], armF: [-160, 15] }), seated({ armN: [2, 0], armF: [2, 0] })],
    props: [{ kind: 'seat' }, { kind: 'seat_back' }, { kind: 'handles' }],
  },
  lat_pulldown_wide: {
    poses: [seated({ torso: 100, armN: [80, 85], armF: [80, 85] }), seated({ torso: 100, armN: [-105, 75], armF: [-105, 75] })],
    props: [{ kind: 'seat' }, { kind: 'cable', anchor: [47, 2] }, { kind: 'bar', width: 30 }],
  },
  lat_pulldown: {
    poses: [seated({ torso: 100, armN: [80, 85], armF: [80, 85] }), seated({ torso: 100, armN: [-105, 75], armF: [-105, 75] })],
    props: [{ kind: 'seat' }, { kind: 'cable', anchor: [47, 2] }, { kind: 'bar', width: 16 }],
  },
  cable_row: {
    poses: [
      seated({ hip: [40, 72], torso: 92, legN: [12, -12], legF: [14, -10], footN: 80, footF: 80, armN: [-5, -5], armF: [-5, -5] }),
      seated({ hip: [40, 72], torso: 92, legN: [12, -12], legF: [14, -10], footN: 80, footF: 80, armN: [-150, 5], armF: [-150, 5] }),
    ],
    props: [{ kind: 'seat' }, { kind: 'cable', anchor: [108, 58] }, { kind: 'handles' }, { kind: 'platform', angle: 90 }],
  },
  pec_deck: {
    poses: [
      seatedFront({ armL: [180, 90], armR: [0, 90] }),
      seatedFront({ armL: [-15, 90, 0.6, 1], armR: [195, 90, 0.6, 1] }),
    ],
    props: [{ kind: 'seat' }, { kind: 'forearm_pads' }],
  },
  cable_curl: {
    poses: [stand({ armN: [-88, -92], armF: [-86, -94] }), stand({ armN: [-82, 75], armF: [-80, 77] })],
    props: [{ kind: 'cable', anchor: [92, 92] }, { kind: 'bar', width: 12 }],
  },
  db_curl: {
    poses: [stand({ armN: [-88, -92], armF: [-86, -94] }), stand({ armN: [-82, 75], armF: [-80, 77] })],
    props: [{ kind: 'dumbbells' }],
  },
  hammer_curl: {
    poses: [stand({ armN: [-88, -92], armF: [-86, -94] }), stand({ armN: [-84, 80], armF: [-82, 82] })],
    props: [{ kind: 'dumbbells' }],
  },
  rope_pushdown: {
    poses: [stand({ torso: 82, armN: [-100, 25], armF: [-100, 25] }), stand({ torso: 82, armN: [-95, -80], armF: [-95, -80] })],
    props: [{ kind: 'cable', anchor: [80, 3] }, { kind: 'rope' }],
  },
  lateral_raise: {
    poses: [standFront(), standFront({ armL: [175, 180], armR: [5, 0] })],
    props: [{ kind: 'dumbbells' }],
  },
  abs: {
    poses: [supine({ armN: [20, 160], armF: [20, 160] }), supine({ torso: 150, armN: [40, 180], armF: [40, 180] })],
    props: [{ kind: 'mat' }],
  },
  crunch: {
    poses: [supine({ armN: [20, 160], armF: [20, 160] }), supine({ torso: 150, armN: [40, 180], armF: [40, 180] })],
    props: [{ kind: 'mat' }],
  },
  leg_extension: {
    poses: [
      seated({ torso: 100, armN: [-80, -70], armF: [-80, -70], legN: [0, -90], legF: [2, -90] }),
      seated({ torso: 100, armN: [-80, -70], armF: [-80, -70], legN: [0, -5], legF: [2, -4], footN: 80, footF: 80 }),
    ],
    props: [{ kind: 'seat' }, { kind: 'seat_back' }, { kind: 'shin_pad' }],
  },
  leg_curl: {
    poses: [
      side({ hip: [62, 64], torso: 180, facing: -1, armN: [-120, 180], armF: [-120, 180], legN: [0, 0], legF: [0, 1], footN: -80, footF: -80, ground: false }),
      side({ hip: [62, 64], torso: 180, facing: -1, armN: [-120, 180], armF: [-120, 180], legN: [0, 100], legF: [0, 102], footN: 170, footF: 170, ground: false }),
    ],
    props: [{ kind: 'bench' }, { kind: 'ankle_pad' }],
  },
  goblet_squat: {
    poses: [
      stand({ armN: [-100, 70], armF: [-100, 70] }),
      side({ hip: [52, 70], torso: 68, armN: [-110, 60], armF: [-110, 60], legN: [8, -108], legF: [10, -106] }),
    ],
    props: [{ kind: 'kettlebell' }],
  },
  lunges: {
    poses: [
      stand({ armN: [-90, -90], armF: [-90, -90] }),
      side({ hip: [60, 55], torso: 90, armN: [-90, -90], armF: [-90, -90], legN: [-2, -90], legF: [-115, -175], footF: -70 }),
    ],
    props: [{ kind: 'dumbbells' }],
  },
  calf_raise: {
    poses: [stand(), stand({ footN: -55, footF: -55 })],
    props: [{ kind: 'dumbbells' }],
  },
  plank: {
    poses: [
      side({ hip: [60, 80], torso: 175, facing: -1, armN: [-90, 180], armF: [-88, 180], legN: [-3, -3], legF: [-3, -3], footN: -90, footF: -90 }),
      side({ hip: [60, 79], torso: 174, facing: -1, armN: [-90, 180], armF: [-88, 180], legN: [-4, -4], legF: [-4, -4], footN: -90, footF: -90 }),
    ],
    props: [{ kind: 'mat' }],
    caption: ['Hold', 'Breathe'],
  },
  shoulder_press: {
    poses: [seatedFront({ armL: [180, 90], armR: [0, 90] }), seatedFront({ armL: [100, 95], armR: [80, 85] })],
    props: [{ kind: 'seat' }, { kind: 'dumbbells' }],
  },
  incline_db_press: {
    poses: [
      side({ hip: [55, 76], torso: 140, facing: 1, armN: [-120, 75], armF: [-120, 75], legN: [5, -95], legF: [7, -93], ground: false }),
      side({ hip: [55, 76], torso: 140, facing: 1, armN: [50, 50], armF: [50, 50], legN: [5, -95], legF: [7, -93], ground: false }),
    ],
    props: [{ kind: 'incline_bench' }, { kind: 'dumbbells' }],
  },
  push_up: {
    poses: [
      side({ hip: [60, 60], torso: 157, facing: -1, armN: [-90, -90], armF: [-90, -90], legN: [-23, -23], legF: [-23, -23], footN: -60, footF: -60 }),
      side({ hip: [60, 70], torso: 170, facing: -1, armN: [-40, -146], armF: [-40, -146], legN: [-10, -10], legF: [-10, -10], footN: -60, footF: -60 }),
    ],
    props: [],
  },
  db_row: {
    poses: [
      side({ hip: [52, 55], torso: 35, armN: [-90, -90], armF: [-90, -90], legN: [-80, -95], legF: [-78, -97] }),
      side({ hip: [52, 55], torso: 35, armN: [180, -90], armF: [178, -92], legN: [-80, -95], legF: [-78, -97] }),
    ],
    props: [{ kind: 'dumbbells' }],
  },
  face_pull: {
    poses: [stand({ armN: [15, 5], armF: [15, 5] }), stand({ armN: [178, 55], armF: [178, 55] })],
    props: [{ kind: 'cable', anchor: [114, 20] }, { kind: 'rope' }],
  },
  rear_delt_fly: {
    poses: [
      seatedFront({ armL: [-20, -10, 0.4, 0.4], armR: [200, 190, 0.4, 0.4] }),
      seatedFront({ armL: [180, 180], armR: [0, 0] }),
    ],
    props: [{ kind: 'seat' }, { kind: 'handles' }],
  },
  overhead_tri_ext: {
    poses: [seated({ armN: [95, -120], armF: [95, -120] }), seated({ armN: [95, 90], armF: [95, 90] })],
    props: [{ kind: 'seat' }, { kind: 'dumbbells' }],
  },
  leg_press: {
    poses: [
      side({ hip: [55, 72], torso: 130, facing: 1, armN: [-70, -30], armF: [-70, -30], legN: [80, -20], legF: [82, -18], footN: 120, footF: 120, ground: false }),
      side({ hip: [55, 72], torso: 130, facing: 1, armN: [-70, -30], armF: [-70, -30], legN: [32, 28], legF: [33, 29], footN: 120, footF: 120, ground: false }),
    ],
    props: [{ kind: 'seat' }, { kind: 'seat_back' }, { kind: 'platform', angle: 120, width: 1 }],
  },
  rdl: {
    poses: [
      stand({ armN: [-90, -90], armF: [-90, -90] }),
      side({ hip: [42, 60], torso: 18, armN: [-90, -90], armF: [-90, -90], legN: [-66, -90], legF: [-68, -92] }),
    ],
    props: [{ kind: 'barbell' }],
  },
  glute_bridge: {
    poses: [supine({ hip: [55, 86] }), supine({ hip: [55, 80], torso: -160, legN: [20, -80], legF: [22, -78], armN: [-5, 0], armF: [-5, 0] })],
    props: [{ kind: 'mat' }],
  },
  dead_bug: {
    poses: [
      supine({ armN: [90, 90], armF: [92, 92], legN: [90, 0], legF: [92, 2] }),
      supine({ armN: [170, 172], armF: [92, 92], legN: [90, 0], legF: [8, 6] }),
    ],
    props: [{ kind: 'mat' }],
  },
  hanging_knee_raise: {
    poses: [
      side({ hip: [60, 62], torso: 90, armN: [88, 92], armF: [88, 92], legN: [-90, -90], legF: [-88, -92], ground: false }),
      side({ hip: [60, 62], torso: 95, armN: [86, 92], armF: [86, 92], legN: [0, -90], legF: [2, -88], ground: false }),
    ],
    props: [{ kind: 'pullup_bar' }],
    scale: 0.8,
  },
  bird_dog: {
    poses: [
      side({ hip: [65, 66], torso: 158, facing: -1, armN: [-90, -90], armF: [-92, -92], legN: [-90, 0], legF: [-92, 0], footN: 0, footF: 0 }),
      side({ hip: [65, 66], torso: 158, facing: -1, armN: [180, 180], armF: [-92, -92], legN: [-90, 0], legF: [2, 2], footN: 0, footF: 0 }),
    ],
    props: [{ kind: 'mat' }],
  },
  brisk_walk: {
    poses: [
      stand({ torso: 86, armN: [-115, -100], armF: [-65, -35], legN: [-70, -78], legF: [-110, -120], footF: -30 }),
      stand({ torso: 86, armN: [-65, -35], armF: [-115, -100], legN: [-110, -120], legF: [-70, -78], footN: -30 }),
    ],
    props: [],
    caption: ['Stride', 'Stride'],
  },
  light_jog: {
    poses: [
      stand({ torso: 82, armN: [-120, -20], armF: [-55, 35], legN: [-45, -110], legF: [-118, -155], footF: -60 }),
      stand({ torso: 82, armN: [-55, 35], armF: [-120, -20], legN: [-118, -155], legF: [-45, -110], footN: -60 }),
    ],
    props: [],
    caption: ['Stride', 'Stride'],
  },
  stationary_bike: {
    poses: [
      side({ hip: [50, 60], torso: 60, armN: [-40, -20], armF: [-40, -20], legN: [-45, -95], legF: [-10, -120], ground: false }),
      side({ hip: [50, 60], torso: 60, armN: [-40, -20], armF: [-40, -20], legN: [-10, -120], legF: [-45, -95], ground: false }),
    ],
    props: [{ kind: 'bike' }],
  },
  hamstring_stretch: {
    poses: [
      side({ hip: [40, 88], torso: 95, armN: [-60, -30], armF: [-60, -30], legN: [0, 0], legF: [1, 1], footN: 85, footF: 85 }),
      side({ hip: [40, 88], torso: 35, armN: [-15, -10], armF: [-15, -10], legN: [0, 0], legF: [1, 1], footN: 85, footF: 85 }),
    ],
    props: [{ kind: 'mat' }],
  },
  hip_flexor_stretch: {
    poses: [
      side({ hip: [58, 62], torso: 95, armN: [-75, -60], armF: [-75, -60], legN: [-5, -90], legF: [-100, -180], footF: 180 }),
      side({ hip: [62, 64], torso: 98, armN: [-75, -60], armF: [-75, -60], legN: [-15, -95], legF: [-110, -180], footF: 180 }),
    ],
    props: [{ kind: 'mat' }],
  },
  cobra_stretch: {
    poses: [
      side({ hip: [65, 88], torso: 180, facing: -1, armN: [70, -110], armF: [70, -110], legN: [0, 0], legF: [0, 0], footN: 0, footF: 0 }),
      side({ hip: [65, 88], torso: 155, facing: -1, armN: [-100, -170], armF: [-100, -170], legN: [0, 0], legF: [0, 0], footN: 0, footF: 0 }),
    ],
    props: [{ kind: 'mat' }],
  },
};

export const DEFAULT_POSE_KEY = 'db_curl';
