/**
 * Silhouette check on the rendered character: the number of disconnected opaque blobs ("islands") in a frame must not
 * exceed the rest pose's. A sleeve or robe panel that tears away from the body shows up as an extra island.
 */
import { evalPose } from '../pose.js';
import type { Clip } from '../clip.js';
import type { QaIssue } from '../qa.js';
import type { RigDocument } from '../schema.js';
import type { Image } from './image.js';
import { renderPose, type LoadedAtlas } from './render.js';

/** Count 8-connected components of pixels with alpha > `alpha`, ignoring components smaller than `minPixels`. */
export function countIslands(img: Image, minPixels = 8, alpha = 24): number {
  const { width, height, data } = img;
  const seen = new Uint8Array(width * height);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || data[start * 4 + 3]! <= alpha) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!seen[q] && data[q * 4 + 3]! > alpha) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (size >= minPixels) count++;
  }
  return count;
}

export interface SilhouetteOptions {
  /** Render scale (px per rig px). Default 1. */
  readonly scale?: number;
  /** Islands smaller than this many pixels are specks, not pieces. Default 8. */
  readonly minPixels?: number;
  /** Frames to sample (default: all). */
  readonly step?: number;
  /** Extra islands tolerated over the rest pose. Default 0. */
  readonly tolerance?: number;
  /** Slots left out of the silhouette: props that legitimately separate from the body (sword). Default weapon_R, sword_back. */
  readonly ignoreSlots?: readonly string[];
}

/** Report frames whose silhouette has more islands than the rest pose. Props (sword) are part of the silhouette. */
export function checkSilhouette(
  rig: RigDocument,
  clip: Clip,
  atlas: LoadedAtlas,
  opts: SilhouetteOptions = {},
): QaIssue[] {
  const render = (f: number | null) =>
    renderPose(rig, evalPose(rig, f === null ? null : clip, f ?? 0), atlas, {
      scale: opts.scale ?? 1,
      background: [0, 0, 0, 0],
      ground: false,
      hideSlots: opts.ignoreSlots ?? ['weapon_R', 'sword_back'],
    });
  const restCount = countIslands(render(null), opts.minPixels);
  const issues: QaIssue[] = [];
  let worst = { frame: -1, count: restCount };
  for (let f = 0; f <= clip.frames; f += opts.step ?? 1) {
    const c = countIslands(render(f), opts.minPixels);
    if (c > worst.count) worst = { frame: f, count: c };
  }
  if (worst.frame >= 0 && worst.count > restCount + (opts.tolerance ?? 0)) {
    issues.push({
      severity: 'error',
      check: 'islands',
      frame: worst.frame,
      value: worst.count - restCount,
      message: `silhouette splits into ${worst.count} pieces at frame ${worst.frame} (rest pose: ${restCount}): a piece has torn away from the body`,
    });
  }
  return issues;
}
