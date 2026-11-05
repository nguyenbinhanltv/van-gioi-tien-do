import type { AnimationId } from '@vgtd/character';

/** Bone offsets from setup pose: rotation in degrees (CCW, Spine y-up), translation in px. */
export interface BonePose {
  rot?: number;
  tx?: number;
  ty?: number;
}
export type Pose = Partial<Record<BoneName, BonePose>>;

export const BONES = ['root', 'hip', 'torso', 'head', 'arm_L', 'arm_R', 'hand_R', 'wing', 'cape', 'sword'] as const;
export type BoneName = (typeof BONES)[number];

const TAU = Math.PI * 2;
const ease = (p: number) => p * p * (3 - 2 * p);
/** 0 -> 1 -> 0 envelope over p in [0,1]. */
const bump = (p: number) => Math.sin(Math.PI * p);
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/**
 * Procedural placeholder motion: pose of the rig at normalised time p in [0, 1] of animation `id`.
 * Looping animations are periodic (pose(0) == pose(1)); one-shots start and end near the setup pose
 * (except `die`, which holds the final pose). This is test-rig motion, not production animation.
 */
export function poseAt(id: AnimationId, p: number): Pose {
  const s = Math.sin(TAU * p);
  const c = Math.cos(TAU * p);
  switch (id) {
    case 'idle':
      return {
        hip: { ty: 1.5 * s },
        torso: { rot: 1 * s },
        head: { rot: -1.5 * s },
        arm_L: { rot: 3 * s },
        arm_R: { rot: -3 * s },
        cape: { rot: 4 * s },
        wing: { rot: 3 * c },
      };
    case 'meditate':
      return {
        hip: { ty: -16 + 1 * s },
        torso: { rot: 0.8 * s },
        arm_L: { rot: 52 },
        arm_R: { rot: -52 },
        head: { rot: -1 * s },
        wing: { rot: 3 * c },
      };
    case 'walk':
      return {
        hip: { ty: 3 * Math.abs(s) },
        torso: { rot: 2 * s },
        head: { rot: -2 * s },
        arm_L: { rot: 28 * s },
        arm_R: { rot: -28 * s },
        cape: { rot: 8 * s },
        wing: { rot: 5 * c },
      };
    case 'run':
      return {
        hip: { ty: 5 * Math.abs(s) },
        torso: { rot: -8 + 2 * s },
        head: { rot: 4 },
        arm_L: { rot: 58 * s },
        arm_R: { rot: -58 * s },
        cape: { rot: 16 * s - 10 },
        wing: { rot: 8 * c },
      };
    case 'dash':
      return {
        root: { tx: 26 * bump(p) },
        torso: { rot: -22 * bump(p) },
        head: { rot: 8 * bump(p) },
        arm_L: { rot: 70 * bump(p) },
        arm_R: { rot: 70 * bump(p) },
        cape: { rot: -30 * bump(p) },
      };
    case 'sword_fly':
      return {
        hip: { ty: 8 + 3 * s },
        torso: { rot: -10 },
        arm_L: { rot: 32 + 4 * c },
        arm_R: { rot: -32 - 4 * c },
        cape: { rot: 14 * s - 8 },
        wing: { rot: 6 * c },
      };
    case 'attack': {
      // windup 0-0.3 (arm back), swing 0.3-0.5 (fast), recover 0.5-1
      const arm =
        p < 0.3 ? 110 * ease(p / 0.3) : p < 0.5 ? 110 - 190 * ease((p - 0.3) / 0.2) : -80 * (1 - ease((p - 0.5) / 0.5));
      return {
        arm_R: { rot: arm },
        torso: { rot: arm * 0.12 },
        hip: { tx: p >= 0.3 && p < 0.55 ? 3 : 0 },
        head: { rot: -arm * 0.05 },
      };
    }
    case 'cast': {
      const up = p < 0.5 ? ease(clamp01(p / 0.4)) : 1 - ease(clamp01((p - 0.6) / 0.4));
      return {
        arm_L: { rot: 125 * up },
        arm_R: { rot: -125 * up },
        hip: { ty: 2 * up },
        head: { rot: 6 * up },
        wing: { rot: 10 * up },
      };
    }
    case 'channel':
      return {
        arm_L: { rot: 85 + 3 * Math.sin(TAU * 4 * p) },
        arm_R: { rot: -85 - 3 * Math.sin(TAU * 4 * p + 1) },
        hip: { ty: 1 * s },
        torso: { rot: 1.5 * Math.sin(TAU * 4 * p) },
        cape: { rot: 6 * s },
      };
    case 'hit':
      return {
        root: { tx: -9 * bump(p) },
        torso: { rot: 14 * bump(p) },
        head: { rot: -12 * bump(p) },
        arm_L: { rot: -20 * bump(p) },
        arm_R: { rot: 20 * bump(p) },
      };
    case 'die': {
      const e = ease(p);
      return {
        root: { rot: 85 * e, ty: -6 * e, tx: -18 * e },
        arm_L: { rot: 40 * e },
        arm_R: { rot: -40 * e },
        head: { rot: -10 * e },
      };
    }
    case 'tribulation': {
      const decay = 1 - 0.5 * p;
      return {
        root: { tx: 2.5 * decay * Math.sin(TAU * 10 * p) },
        hip: { ty: 1.5 * Math.sin(TAU * 13 * p) },
        arm_L: { rot: 100 * bump(clamp01(p * 1.2)) },
        arm_R: { rot: -100 * bump(clamp01(p * 1.2)) },
        head: { rot: 10 * bump(p) },
        cape: { rot: 12 * Math.sin(TAU * 7 * p) },
      };
    }
    case 'emote': {
      const env = Math.sqrt(bump(p));
      return {
        arm_R: { rot: -150 * env + 18 * env * Math.sin(TAU * 3 * p) },
        head: { rot: 6 * env },
        torso: { rot: -2 * env },
      };
    }
  }
}
