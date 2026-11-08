/** D55 deterministic negative controls, never production edits. Source pixels/landmarks remain unchanged. */
import type { Image } from '@vgtd/rig';
import type { SimilarityRegions } from '../src/index.js';
export const SIMILARITY_CONTROL_NAMES = ['other-class-head', 'wrong-torso', 'mirrored-head', 'head-scale-85'] as const;
export function makeSimilarityControls(
  master: Image,
  donor: Image,
  windows: SimilarityRegions,
  donorWindows: SimilarityRegions,
): {
  name: (typeof SIMILARITY_CONTROL_NAMES)[number];
  image: Image;
  headTransform?: { sx: number; sy: number; dx: number; dy: number };
}[] {
  const bounds = (b: { left: number; top: number; right: number; bottom: number }) => ({
    x: Math.floor(b.left),
    y: Math.floor(b.top),
    w: Math.ceil(b.right) - Math.floor(b.left),
    h: Math.ceil(b.bottom) - Math.floor(b.top),
  });
  return SIMILARITY_CONTROL_NAMES.map((name) => {
    const image = { ...master, data: new Uint8ClampedArray(master.data) },
      box = bounds(name === 'wrong-torso' ? windows.torso : windows.head),
      source = name === 'other-class-head' || name === 'wrong-torso' ? donor : master,
      sbox = bounds(
        name === 'wrong-torso' ? donorWindows.torso : name === 'other-class-head' ? donorWindows.head : windows.head,
      );
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.w > master.width ||
      box.y + box.h > master.height ||
      sbox.x < 0 ||
      sbox.y < 0 ||
      sbox.x + sbox.w > source.width ||
      sbox.y + sbox.h > source.height
    )
      throw new Error('control windows must fit inputs');
    const scale = name === 'head-scale-85' ? 0.85 : 1,
      nw = Math.round(box.w * scale),
      nh = Math.round(box.h * scale),
      ox = box.x + Math.floor((box.w - nw) / 2),
      oy = box.y + Math.floor((box.h - nh) / 2);
    for (let y = 0; y < box.h; y++)
      for (let x = 0; x < box.w; x++)
        image.data.fill(
          0,
          ((box.y + y) * image.width + box.x + x) * 4,
          ((box.y + y) * image.width + box.x + x) * 4 + 4,
        );
    // Nearest-neighbour patch fit is explicit and identical for test and report; no AI or source writes.
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        const sx =
            sbox.x + Math.min(sbox.w - 1, Math.floor(((name === 'mirrored-head' ? nw - 1 - x : x) * sbox.w) / nw)),
          sy = sbox.y + Math.min(sbox.h - 1, Math.floor((y * sbox.h) / nh));
        image.data.set(
          source.data.subarray((sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4),
          ((oy + y) * image.width + ox + x) * 4,
        );
      }
    return {
      name,
      image,
      ...(name === 'head-scale-85'
        ? {
            headTransform: {
              sx: nw / box.w,
              sy: nh / box.h,
              dx: ox - (box.x * nw) / box.w,
              dy: oy - (box.y * nh) / box.h,
            },
          }
        : {}),
    };
  });
}
