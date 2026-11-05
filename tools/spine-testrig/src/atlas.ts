import type { Bitmap } from './png.js';
import { createBitmap } from './raster.js';
import type { Part } from './parts.js';

export interface PackedRegion {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Atlas {
  readonly page: Bitmap;
  readonly regions: readonly PackedRegion[];
  /** Spine 4.2 text atlas. */
  readonly text: string;
}

/**
 * Atlas export settings the human animators must also use in Spine Editor 4.2
 * (see apps/client-cocos/docs/spine-export.md). Page size limit mirrors BUDGETS.ATLAS_MAX_WEB_MOBILE.
 */
export const ATLAS_SETTINGS = { padding: 2, maxSize: 2048, premultipliedAlpha: true, powerOfTwo: true } as const;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Shelf packer (tallest first), padding on every side, smallest pow2 square <= maxSize. */
export function packAtlas(pageName: string, parts: readonly Part[]): Atlas {
  const pad = ATLAS_SETTINGS.padding;
  const items = [...parts].sort((a, b) => b.bitmap.height - a.bitmap.height || a.name.localeCompare(b.name));
  for (let size = 64; size <= ATLAS_SETTINGS.maxSize; size = nextPow2(size + 1)) {
    const placed: PackedRegion[] = [];
    let x = pad;
    let y = pad;
    let rowH = 0;
    let ok = true;
    for (const p of items) {
      const { width: w, height: h } = p.bitmap;
      if (x + w + pad > size) {
        x = pad;
        y += rowH + pad;
        rowH = 0;
      }
      if (y + h + pad > size) {
        ok = false;
        break;
      }
      placed.push({ name: p.name, x, y, w, h });
      x += w + pad;
      rowH = Math.max(rowH, h);
    }
    if (!ok) continue;
    const page = createBitmap(size, size);
    for (const r of placed) {
      const src = parts.find((p) => p.name === r.name)!.bitmap;
      for (let j = 0; j < r.h; j++) {
        page.data.set(src.data.subarray(j * r.w * 4, (j + 1) * r.w * 4), ((r.y + j) * size + r.x) * 4);
      }
    }
    const lines = [pageName, `size:${size},${size}`, 'filter:Linear,Linear', 'pma:true'];
    for (const r of [...placed].sort((a, b) => a.name.localeCompare(b.name)))
      lines.push(r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`);
    return { page, regions: placed, text: lines.join('\n') + '\n' };
  }
  throw new Error(`parts do not fit in a ${ATLAS_SETTINGS.maxSize}px page`);
}
