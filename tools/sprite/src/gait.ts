/**
 * Ground-speed arithmetic shared by the template (foot ghosts) and the QA (foot-slide gate), so the template an artist
 * follows exactly and the gate that judges the result can never disagree.
 */
import { ANIMATIONS, type AnimationId } from '@vgtd/character';
import { RUN_SPEED_PX_S, WALK_SPEED_PX_S, viewGain } from '@vgtd/rig';
import type { Direction } from '@vgtd/shared';

/** Texture px per rig px (the canvas is drawn at 2x). */
export const TEXTURE_SCALE = 2;

/** Duration (s) of a table animation (frames / fps). */
export function tableDuration(id: AnimationId): number {
  const spec = ANIMATIONS.find((a) => a.id === id);
  if (!spec) throw new RangeError(`unknown animation id '${id}'`);
  return spec.frames / spec.fps;
}

/** Ground speed (px/s along the facing, screen space) of a locomotion clip in direction `dir`; null for other clips. */
export function groundSpeedPxS(id: AnimationId | undefined, dir: Direction): number | null {
  if (id === 'run') return RUN_SPEED_PX_S * viewGain(dir);
  if (id === 'walk') return WALK_SPEED_PX_S * viewGain(dir);
  return null;
}

/** How far a planted foot travels per sheet frame (texture px) when the character walks in place at `speedPxS`. */
export function groundPxPerFrame(speedPxS: number, durationSec: number, frames: number): number {
  return (speedPxS * TEXTURE_SCALE * durationSec) / frames;
}

/**
 * Half stride (texture px) of the template foot ghosts: a planted foot slides back by `2 * halfStride` during the stance half
 * of the cycle (one cycle = `durationSec`, two steps), so `halfStride = speed * durationSec * TEXTURE_SCALE / 4`.
 */
export function halfStrideFor(speedPxS: number, durationSec: number): number {
  return (speedPxS * durationSec * TEXTURE_SCALE) / 4;
}
