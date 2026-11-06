import { createImage, type Image } from '@vgtd/rig';
import { solid, toPremultiplied, type Straight } from '../src/raster.js';
import type { Rgb } from '../src/types.js';

export const MAGENTA: Rgb = [255, 0, 255];

export interface FigureOptions {
  readonly height: number;
  /** Centre x of the torso. */
  readonly cx: number;
  /** Row of the sole (bottom). */
  readonly sole: number;
  readonly body?: Rgb;
  readonly head?: Rgb;
  /** Extra leg offset (px) to make frames differ. */
  readonly stride?: number;
}

/** Draw a blocky figure (head, torso, two legs) into a straight image at the given placement. */
export function drawFigure(img: Straight, o: FigureOptions): void {
  const body = o.body ?? [40, 80, 160];
  const head = o.head ?? [230, 190, 160];
  const top = o.sole - o.height;
  const rect = (x0: number, y0: number, x1: number, y1: number, c: Rgb) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.height, Math.round(y1)); y++)
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x1)); x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = 255;
      }
  };
  const w = o.height * 0.18;
  rect(o.cx - w * 0.6, top, o.cx + w * 0.6, top + o.height * 0.18, head); // head
  rect(o.cx - w, top + o.height * 0.18, o.cx + w, top + o.height * 0.58, body); // torso
  const s = o.stride ?? 0;
  rect(o.cx - w + s, top + o.height * 0.58, o.cx - w * 0.1 + s, o.sole, [60, 60, 70]); // leg
  rect(o.cx + w * 0.1 - s, top + o.height * 0.58, o.cx + w - s, o.sole, [60, 60, 70]); // leg
}

/** A sheet of `n` cells (cols x rows) of `cell` px, magenta background, one figure per cell. */
export function makeSheet(cols: number, rows: number, cell: number, figures: readonly FigureOptions[]): Straight {
  const s = solid(cols * cell, rows * cell, MAGENTA);
  figures.forEach((f, i) => {
    const sub = solid(cell, cell, MAGENTA);
    drawFigure(sub, f);
    const ox = (i % cols) * cell;
    const oy = Math.floor(i / cols) * cell;
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++)
        s.data.set(sub.data.subarray((y * cell + x) * 4, (y * cell + x) * 4 + 4), ((oy + y) * s.width + ox + x) * 4);
  });
  return s;
}

/** A transparent 256 cell (premultiplied) with one figure. */
export function figureImage(o: FigureOptions): Image {
  const s: Straight = { width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4) };
  drawFigure(s, o);
  return toPremultiplied(s);
}

/** A 256 master image with a figure of `height` px, transparent background (premultiplied). */
export function makeMaster(height = 208, cx = 128): Image {
  const s: Straight = { width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4) };
  drawFigure(s, { height, cx, sole: 232 });
  return toPremultiplied(s);
}

export { createImage };
