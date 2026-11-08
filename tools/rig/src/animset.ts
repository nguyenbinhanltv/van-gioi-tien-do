/**
 * Animation set definitions derived from `@vgtd/character` (docs/03 §3, 13 animations). Converts the sprite-sheet
 * table (frames @ fps) into 30 fps clip specs: duration, loop flag and event frames, so authored clips and the QA
 * checks share one source of truth.
 */
import {
  ANIMATIONS,
  getAnimation,
  type AnimationId,
  type AnimationSpec,
  type EventAnchor,
  type SpineEventName,
} from '@vgtd/character';
import { CLIP_FPS } from './clip.js';

export interface ClipSpecEvent {
  readonly name: SpineEventName;
  /** Literal 30 fps frame (spec frame converted), or a phase name the clip must define in `phases`. */
  readonly at: { readonly frame: number } | { readonly phase: 'hit_frame' | 'windup_end' | 'combo_window' };
}

export interface ClipSpec {
  readonly id: AnimationId;
  readonly name: string;
  readonly loop: boolean;
  /** Duration in 30 fps frames = round(frames / fps · 30). */
  readonly frames: number;
  /** Exact duration in seconds from the table (frames / fps). */
  readonly seconds: number;
  readonly events: readonly ClipSpecEvent[];
  /** Whether the spec draws this animation asymmetrically (docs/31 F-01): needs per-direction art. */
  readonly asymmetric: boolean;
}

/** Sprite-sheet frame index (at the table fps) → 30 fps frame index. */
export function specFrameTo30(frame: number, spec: Pick<AnimationSpec, 'fps'>): number {
  return Math.round((frame / spec.fps) * CLIP_FPS);
}

function anchor(a: EventAnchor, spec: AnimationSpec): ClipSpecEvent['at'] {
  return 'frame' in a ? { frame: specFrameTo30(a.frame, spec) } : { phase: a.phase };
}

export function clipSpec(id: AnimationId): ClipSpec {
  const a = getAnimation(id);
  return {
    id,
    name: id,
    loop: a.loop,
    frames: Math.round((a.frames / a.fps) * CLIP_FPS),
    seconds: a.frames / a.fps,
    events: a.events.map((e) => ({ name: e.name, at: anchor(e.at, a) })),
    asymmetric: a.asymmetric,
  };
}

/** All 13 specs in table order. */
export function allClipSpecs(): ClipSpec[] {
  return ANIMATIONS.map((a) => clipSpec(a.id));
}

/** Tolerance (± 30 fps frames) for event timing and duration checks (docs/29 A.0 #6a). */
export const EVENT_FRAME_TOLERANCE = 1;
