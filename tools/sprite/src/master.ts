/** Measuring the master image: bounds, height, pelvis axis; and deriving the template guides from them. */
import { pivotOf } from '@vgtd/character';
import { CELL_PX, type Guides, type MasterMetrics } from './types.js';

/** Rows of the torso band used for the pelvis axis, as fractions of the figure height from the top. */
export const TORSO_BAND: readonly [number, number] = [0.35, 0.62];

/** Fraction of the figure height (top to sole) at which the pelvis sits in an upright pose. */
export const PELVIS_FRACTION = 0.5;

/** Anything with RGBA data (`Image` or a straight buffer): only the alpha channel is read. */
export interface AlphaSource {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

/** Bounds and pelvis axis of the opaque part (alpha >= `alpha`) of `img`; null for an empty image. */
export function measureFigure(img: AlphaSource, alpha = 128): MasterMetrics | null {
  let left = img.width;
  let right = -1;
  let top = img.height;
  let bottom = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! >= alpha) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return null;
  const height = bottom + 1 - top;
  const y0 = Math.floor(top + TORSO_BAND[0] * height);
  const y1 = Math.ceil(top + TORSO_BAND[1] * height);
  let sx = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = left; x <= right; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! >= alpha) {
        sx += x;
        n++;
      }
  return {
    left,
    right: right + 1,
    top,
    bottom: bottom + 1,
    height,
    width: right + 1 - left,
    pelvisX: n ? sx / n : (left + right + 1) / 2,
  };
}

/**
 * Template guides of a cell: ground at the pivot row, head / pelvis from the master's true height, the pelvis axis at the
 * MEASURED pelvis x of the master (not the canvas centre) unless `centerX` overrides it. The rig root stays on the pivot.
 */
export function guidesFromMaster(m: MasterMetrics, cell = CELL_PX, centerX?: number): Guides {
  const pivot = pivotOf(cell / 2, cell / 2);
  const ground = pivot.y * 2;
  const head = ground - m.height;
  return { ground, head, pelvis: head + PELVIS_FRACTION * m.height, centerX: centerX ?? m.pelvisX };
}
