import type { Bitmap } from './png.js';

export type Rgba = readonly [number, number, number, number];

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Source-over of `c` (straight alpha 0..255) with coverage 0..1 onto a premultiplied bitmap. */
function blend(bmp: Bitmap, x: number, y: number, c: Rgba, coverage: number): void {
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height || coverage <= 0) return;
  const a = (c[3] / 255) * Math.min(1, coverage);
  const i = (y * bmp.width + x) * 4;
  const inv = 1 - a;
  bmp.data[i] = Math.round(c[0] * a + bmp.data[i]! * inv);
  bmp.data[i + 1] = Math.round(c[1] * a + bmp.data[i + 1]! * inv);
  bmp.data[i + 2] = Math.round(c[2] * a + bmp.data[i + 2]! * inv);
  bmp.data[i + 3] = Math.round(255 * a + bmp.data[i + 3]! * inv);
}

export function fillRect(bmp: Bitmap, x: number, y: number, w: number, h: number, c: Rgba): void {
  for (let j = Math.floor(y); j < Math.ceil(y + h); j++)
    for (let i = Math.floor(x); i < Math.ceil(x + w); i++) blend(bmp, i, j, c, 1);
}

/** Axis-aligned ellipse with ~1px antialiased edge. */
export function fillEllipse(bmp: Bitmap, cx: number, cy: number, rx: number, ry: number, c: Rgba): void {
  for (let j = Math.floor(cy - ry - 1); j <= Math.ceil(cy + ry + 1); j++) {
    for (let i = Math.floor(cx - rx - 1); i <= Math.ceil(cx + rx + 1); i++) {
      const dx = (i + 0.5 - cx) / rx;
      const dy = (j + 0.5 - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      const edge = (1 - d) * Math.min(rx, ry);
      blend(bmp, i, j, c, Math.max(0, Math.min(1, edge + 0.5)));
    }
  }
}

/** Round-rect via rect + corner ellipses (cheap and good enough for placeholders). */
export function fillRoundRect(bmp: Bitmap, x: number, y: number, w: number, h: number, r: number, c: Rgba): void {
  const rr = Math.min(r, w / 2, h / 2);
  fillRect(bmp, x + rr, y, w - 2 * rr, h, c);
  fillRect(bmp, x, y + rr, w, h - 2 * rr, c);
  for (const [cx, cy] of [
    [x + rr, y + rr],
    [x + w - rr, y + rr],
    [x + rr, y + h - rr],
    [x + w - rr, y + h - rr],
  ] as const) {
    fillEllipse(bmp, cx, cy, rr, rr, c);
  }
}
