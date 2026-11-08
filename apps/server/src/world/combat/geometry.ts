/**
 * Skill shapes in tile space for target selection (docs/11 §2: circle, ring, cone, line, single). Deterministic: only + - * /, sqrt and the
 * sim's direction table (no Math.sin / cos / pow). Directions are tile-space unit vectors from the facing code (0..254 = angle / 256 * 2pi
 * from +i toward +j), so a cone's half angle is quantised to 360 / 256 degrees.
 */
import { DIR_CODES, DIR_COS, DIR_SIN, hypot } from '@vgtd/sim';
import type { SkillShape } from '@vgtd/shared';

export interface Point {
  i: number;
  j: number;
}

/** Unit vector of a facing code (255 = idle falls back to code 0 = +i). */
export function facingVector(facing: number): Point {
  const k = facing >= 0 && facing < DIR_CODES ? facing : 0;
  return { i: DIR_COS[k]!, j: DIR_SIN[k]! };
}

/** cos of an angle given in degrees, via the quantised direction table (deterministic). */
export function cosDeg(deg: number): number {
  const k = Math.round((deg / 360) * DIR_CODES) & (DIR_CODES - 1);
  return DIR_COS[k]!;
}

/**
 * Is `p` inside the shape? `caster` anchors cone / line, `anchor` the circle / ring (the caster, the target or the ground point,
 * decided by the caller). Distance is measured between points (entity footprints are ignored in this first cut).
 */
export function inShape(shape: SkillShape, caster: Point, facing: number, anchor: Point, p: Point): boolean {
  switch (shape.type) {
    case 'single':
      return false; // single-target skills never go through the shape test
    case 'circle':
      return hypot(p.i - anchor.i, p.j - anchor.j) <= (shape.radius ?? 0);
    case 'ring': {
      const d = hypot(p.i - anchor.i, p.j - anchor.j);
      return d <= (shape.radius ?? 0) && d >= (shape.inner_radius ?? 0);
    }
    case 'cone': {
      const di = p.i - caster.i;
      const dj = p.j - caster.j;
      const d = hypot(di, dj);
      if (d > (shape.radius ?? 0)) return false;
      if (d < 1e-9) return true;
      const f = facingVector(facing);
      return (di * f.i + dj * f.j) / d >= cosDeg((shape.angle_deg ?? 360) / 2) - 1e-9;
    }
    case 'line': {
      const f = facingVector(facing);
      const di = p.i - caster.i;
      const dj = p.j - caster.j;
      const along = di * f.i + dj * f.j;
      const across = di * f.j - dj * f.i;
      return along >= 0 && along <= (shape.length ?? 0) && (across < 0 ? -across : across) <= (shape.width ?? 1) / 2;
    }
  }
}
