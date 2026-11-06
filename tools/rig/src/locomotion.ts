/**
 * Locomotion with IK foot planting (no foot sliding). Each foot IK target follows a gait cycle: during stance it
 * moves backwards (relative to the body) at exactly the ground speed, so in world space it stays put; during swing it
 * travels forward along an arc. All values are exact per 30 fps frame, so the QA foot-slide check can verify them.
 */
import { DIRECTION_TILE_VECTORS, TILE_HEIGHT, TILE_WIDTH, type Direction } from '@vgtd/shared';
import { CLIP_FPS, type BoneTrack, type Key } from './clip.js';
import type { Vec2 } from './math.js';
import { evalPose } from './pose.js';
import type { RigDocument } from './schema.js';

/** Unit screen-space travel axis (y up) of a logical direction, using the iso tile projection from @vgtd/shared. */
export function screenAxis(direction: Direction): Vec2 {
  const [di, dj] = DIRECTION_TILE_VECTORS[direction];
  const x = (di - dj) * (TILE_WIDTH / 2);
  const y = -((di + dj) * (TILE_HEIGHT / 2)); // shared math is y-down; rig space is y-up
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

export interface GaitParams {
  /** Clip length in 30 fps frames. */
  readonly frames: number;
  /**
   * Gait cycles (L+R step pairs) inside the clip, default 1; an integer so the clip loops. More cycles = shorter stride
   * at the same ground speed: the cadence is baked into the clip, no runtime timeScale involved.
   */
  readonly cycles?: number;
  /** Ground speed in screen px/s along the travel axis. */
  readonly speed: number;
  /** Fraction of the cycle a foot is planted (walk ≈ 0.62, run ≈ 0.4). */
  readonly duty: number;
  /** Peak foot lift during swing, px. */
  readonly footLift: number;
  /** Travel axis (unit, y up). Default: +x (profile view facing right). */
  readonly axis?: Vec2;
  /** Cycle offset of the L foot 0..1 (R foot is +0.5). Default 0. */
  readonly phase?: number;
  /** Constant hips drop (px) so the knees stay bent and the stride is reachable. Default 0. */
  readonly crouch?: number;
  /** Hips vertical bob amplitude px (lowest at contact; 2 bobs per cycle). Default 0. */
  readonly bob?: number;
  /** Hips forward/back sway px along the axis over the cycle. Default 0. */
  readonly sway?: number;
}

export interface FootPlan {
  readonly tracks: BoneTrack[];
  /** Planted flag per foot per frame 0..frames (true while in stance). */
  readonly planted: { readonly L: readonly boolean[]; readonly R: readonly boolean[] };
  /** Stance length in px along the axis. */
  readonly stanceLength: number;
}

/** Foot offset (along-axis px, lift px) at cycle position u in [0,1). Stance first, then swing. */
export function footCycle(u: number, g: Pick<GaitParams, 'duty' | 'speed' | 'frames' | 'footLift'>) {
  const stanceLen = g.speed * ((g.duty * g.frames) / CLIP_FPS);
  if (u < g.duty) {
    const s = u / g.duty; // 0..1 through stance
    return { along: stanceLen * (0.5 - s), lift: 0, planted: true, stanceLen };
  }
  const s = (u - g.duty) / (1 - g.duty); // 0..1 through swing
  const e = swingEase(s);
  return { along: stanceLen * (-0.5 + e), lift: g.footLift * Math.sin(Math.PI * s), planted: false, stanceLen };
}

/** Smooth swing progression (smoothstep): velocity is continuous at lift-off and touchdown. */
function swingEase(s: number): number {
  return s * s * (3 - 2 * s);
}

/** Build IK foot-target tracks (+ optional hips bob/sway) for a gait. Requires roles `ik_foot_L`, `ik_foot_R`. */
export function planFeet(rig: RigDocument, g: GaitParams): FootPlan {
  const axis = g.axis ?? { x: 1, y: 0 };
  const L = rig.roles.ik_foot_L;
  const R = rig.roles.ik_foot_R;
  if (!L || !R) throw new RangeError("planFeet needs roles 'ik_foot_L' and 'ik_foot_R'");
  const phase = g.phase ?? 0;
  const N = g.frames;
  const cyc = g.cycles ?? 1;
  const cycle = { ...g, frames: N / cyc };
  const mk = (offset: number) => {
    const keys: Key<Vec2>[] = [];
    const planted: boolean[] = [];
    for (let f = 0; f <= N; f++) {
      const u = ((((f / N) * cyc + offset) % 1) + 1) % 1;
      const c = footCycle(u, cycle);
      keys.push({ frame: f, value: { x: axis.x * c.along, y: axis.y * c.along + c.lift } });
      planted.push(c.planted);
    }
    return { keys, planted };
  };
  const a = mk(phase);
  const b = mk(phase + 0.5);
  const tracks: BoneTrack[] = [
    { bone: L, translate: a.keys },
    { bone: R, translate: b.keys },
  ];
  const hips = rig.roles.hips;
  if (hips && (g.bob || g.sway || g.crouch)) {
    const keys: Key<Vec2>[] = [];
    for (let f = 0; f <= N; f++) {
      const u = (f / N) * cyc;
      const dip = -(g.crouch ?? 0) - (g.bob ?? 0) * (1 - Math.cos(4 * Math.PI * (u + phase))) * 0.5;
      const sw = (g.sway ?? 0) * Math.sin(2 * Math.PI * (u + phase));
      keys.push({ frame: f, value: { x: axis.x * sw, y: axis.y * sw + dip } });
    }
    tracks.push({ bone: hips, translate: keys });
  }
  return {
    tracks,
    planted: { L: a.planted, R: b.planted },
    stanceLength: g.speed * ((g.duty * N) / cyc / CLIP_FPS),
  };
}

/**
 * Smallest hip drop (px) that keeps a stride of half-length `halfStride` along `axis` reachable by a straight-ish leg
 * of length `legLength`, plus `margin`. Front/back views stride mostly vertically, diagonals both ways.
 */
export function crouchFor(legLength: number, axis: Vec2, halfStride: number, margin = 1): number {
  const dx = Math.abs(axis.x) * halfStride;
  const dy = Math.abs(axis.y) * halfStride;
  const horizontal = Math.sqrt(Math.max(0, legLength * legLength - dx * dx));
  return Math.max(0, legLength + dy - horizontal + margin);
}

/** Rest-pose straight-line reach (thigh origin to ankle target) of the first leg IK, in px; 34 px when there is none. */
export function legReach(rig: RigDocument): number {
  const leg = (rig.ik ?? []).find((k) => k.bones.length === 2 && k.target === rig.roles.ik_foot_L);
  if (!leg) return 34;
  const rest = evalPose(rig, null, 0, { noIk: true });
  const a = rest.byName.get(leg.bones[0]!);
  const b = rest.byName.get(leg.bones[1]!);
  if (!a || !b) return 34;
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) + Math.hypot(b.tip.x - b.pos.x, b.tip.y - b.pos.y);
}
