/**
 * Cell repair: take ONE cell from an edited sheet (an image model often redraws the whole image) and put it into the
 * original sheet; every other cell stays byte-identical (verified by per-cell hashes).
 */
import { createHash } from 'node:crypto';
import { createImage, type Image } from '@vgtd/rig';
import { cellRect } from './slice.js';

export interface GridLike {
  readonly cols: number;
  readonly rows: number;
}

/** sha1 of the RGBA bytes of every cell of `sheet`, in reading order. */
export function cellHashes(sheet: Image, grid: GridLike, frames = grid.cols * grid.rows): string[] {
  const out: string[] = [];
  for (let i = 0; i < frames; i++) {
    const r = cellRect(sheet.width, sheet.height, grid.cols, grid.rows, i);
    const h = createHash('sha1');
    for (let y = r.y; y < r.y + r.height; y++)
      h.update(Buffer.from(sheet.data.buffer, sheet.data.byteOffset + (y * sheet.width + r.x) * 4, r.width * 4));
    out.push(h.digest('hex'));
  }
  return out;
}

/** Bilinear resize of a premultiplied image (used only when the edited sheet has another size than the original). */
export function resizeImage(src: Image, width: number, height: number): Image {
  if (src.width === width && src.height === height) return src;
  const out = createImage(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = ((x + 0.5) * src.width) / width - 0.5;
      const sy = ((y + 0.5) * src.height) / height - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(sy)));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const y1 = Math.min(src.height - 1, y0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      const fy = Math.min(1, Math.max(0, sy - y0));
      for (let k = 0; k < 4; k++) {
        const a = src.data[(y0 * src.width + x0) * 4 + k]! * (1 - fx) + src.data[(y0 * src.width + x1) * 4 + k]! * fx;
        const b = src.data[(y1 * src.width + x0) * 4 + k]! * (1 - fx) + src.data[(y1 * src.width + x1) * 4 + k]! * fx;
        out.data[(y * width + x) * 4 + k] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  return out;
}

export interface RepairResult {
  readonly image: Image;
  /** Indices of the cells whose bytes differ from the original (must be exactly `[cell]` or empty). */
  readonly changed: number[];
}

/**
 * Replace cell `cell` of `original` with the same cell of `edited` (resized to the original sheet size first when the
 * sizes differ). Throws when a cell other than `cell` would change.
 */
export function repairCell(original: Image, edited: Image, grid: GridLike, cell: number): RepairResult {
  const total = grid.cols * grid.rows;
  if (cell < 0 || cell >= total) throw new RangeError(`cell ${cell} outside 0..${total - 1}`);
  const src = resizeImage(edited, original.width, original.height);
  const data = new Uint8ClampedArray(original.data);
  const r = cellRect(original.width, original.height, grid.cols, grid.rows, cell);
  for (let y = r.y; y < r.y + r.height; y++) {
    const o = (y * original.width + r.x) * 4;
    data.set(src.data.subarray(o, o + r.width * 4), o);
  }
  const image: Image = { width: original.width, height: original.height, data };
  const before = cellHashes(original, grid, total);
  const after = cellHashes(image, grid, total);
  const changed = after.flatMap((h, i) => (h !== before[i] ? [i] : []));
  if (changed.some((i) => i !== cell)) throw new Error(`repair changed cells other than ${cell}: ${changed.join(',')}`);
  return { image, changed };
}
