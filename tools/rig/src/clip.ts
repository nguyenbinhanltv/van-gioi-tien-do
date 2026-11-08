/**
 * Animation clip data model (format-neutral). Values are **deltas from the rest pose** (like Spine / DragonBones):
 * translate = offset in px (y up), rotate = degrees added to the rest rotation, scale = multiplier (1 = rest).
 * Keyed at 30 fps (SPINE_KEY_FPS); times are integer frame indices.
 */
import { SPINE_KEY_FPS, type SpineEventName } from '@vgtd/character';
import { cubicBezierEase, lerp, type Vec2 } from './math.js';

export const CLIP_FPS = SPINE_KEY_FPS;

/** Interpolation from a key to the next: linear, stepped (hold), or CSS-style bezier [x1, y1, x2, y2]. */
export type Curve = 'linear' | 'stepped' | readonly [number, number, number, number];

export interface Key<T> {
  readonly frame: number;
  readonly value: T;
  /** Applies between this key and the next. Default 'linear'. */
  readonly curve?: Curve;
}

export type RGBA = readonly [number, number, number, number];

export interface BoneTrack {
  readonly bone: string;
  readonly translate?: readonly Key<Vec2>[];
  readonly rotate?: readonly Key<number>[];
  readonly scale?: readonly Key<Vec2>[];
}

export interface SlotTrack {
  readonly slot: string;
  /** Attachment name or null (hidden); always stepped. */
  readonly attachment?: readonly Key<string | null>[];
  readonly color?: readonly Key<RGBA>[];
}

export interface IkTrack {
  readonly ik: string;
  readonly mix?: readonly Key<number>[];
}

export interface ClipEvent {
  readonly frame: number;
  readonly name: SpineEventName;
}

/** Ground motion metadata for locomotion clips. */
export interface ClipMotion {
  /** Authored ground speed, px/s along the facing; runtime timeScale = actual / authored. */
  readonly speed: number;
  /**
   * Stance flags per ankle bone and 30 fps frame 0..frames (true = planted). Screen-space iso projection cannot
   * separate "lift" from "travel" for front/back views, so the plan that produced the clip records it for QA.
   */
  readonly planted?: Readonly<Record<string, readonly boolean[]>>;
  /** Gait cycles (L+R step pairs) inside the clip; default 1. The footstep QA expects that many touchdowns per foot. */
  readonly cycles?: number;
}

export interface Clip {
  readonly name: string;
  /** Duration in frames at CLIP_FPS. Loops wrap at this frame (value at `frames` == value at 0). */
  readonly frames: number;
  readonly loop: boolean;
  readonly bones: readonly BoneTrack[];
  readonly slots: readonly SlotTrack[];
  readonly ik: readonly IkTrack[];
  readonly events: readonly ClipEvent[];
  /** Phase frames used to anchor events and for review: e.g. { hit_frame: 5 }. */
  readonly phases?: Readonly<Record<string, number>>;
  /** Ground speed of the character during the clip (px/s along its facing); drives the foot-slide QA check. */
  readonly motion?: ClipMotion;
}

export function evalCurve(curve: Curve | undefined, t: number): number {
  if (curve === undefined || curve === 'linear') return t;
  if (curve === 'stepped') return 0;
  return cubicBezierEase(curve[0], curve[1], curve[2], curve[3], t);
}

/** Sample a keyed scalar track at `frame`. Before the first key / after the last: hold. */
export function sampleScalar(keys: readonly Key<number>[], frame: number): number {
  return sampleKeys(keys, frame, (a, b, t) => lerp(a, b, t));
}

export function sampleVec(keys: readonly Key<Vec2>[], frame: number): Vec2 {
  return sampleKeys(keys, frame, (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }));
}

export function sampleStep<T>(keys: readonly Key<T>[], frame: number): T {
  return sampleKeys(keys, frame, (a) => a);
}

function sampleKeys<T>(keys: readonly Key<T>[], frame: number, mix: (a: T, b: T, t: number) => T): T {
  const first = keys[0];
  if (!first) throw new RangeError('empty key list');
  if (frame <= first.frame) return first.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (frame < b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame);
      return mix(a.value, b.value, evalCurve(a.curve, t));
    }
  }
  return keys[keys.length - 1]!.value;
}

/** Check a key list: sorted, strictly increasing integer frames within [0, frames]. Returns problems. */
export function checkKeys(keys: readonly Key<unknown>[], frames: number): string[] {
  const out: string[] = [];
  keys.forEach((k, i) => {
    if (!Number.isInteger(k.frame)) out.push(`key ${i}: frame ${k.frame} is not an integer`);
    if (k.frame < 0 || k.frame > frames) out.push(`key ${i}: frame ${k.frame} outside 0..${frames}`);
    if (i > 0 && k.frame <= keys[i - 1]!.frame) out.push(`key ${i}: frames must strictly increase`);
  });
  return out;
}
