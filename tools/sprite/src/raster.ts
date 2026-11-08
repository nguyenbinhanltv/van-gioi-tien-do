/** Small pixel helpers on straight-alpha RGBA buffers (the keying stage works on straight colour). */
import { createImage, type Image } from '@vgtd/rig';
import type { Rgb } from './types.js';

export interface Straight {
  readonly width: number;
  readonly height: number;
  /** RGBA straight alpha. */
  readonly data: Uint8ClampedArray;
}

/** Opaque solid straight image. */
export function solid(width: number, height: number, c: Rgb): Straight {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Straight RGBA from the premultiplied `Image` of `@vgtd/rig`. */
export function toStraight(img: Image): Straight {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]!;
    data[i + 3] = a;
    if (a > 0) {
      const k = 255 / a;
      data[i] = Math.round(img.data[i]! * k);
      data[i + 1] = Math.round(img.data[i + 1]! * k);
      data[i + 2] = Math.round(img.data[i + 2]! * k);
    }
  }
  return { width: img.width, height: img.height, data };
}

/** Premultiplied `Image` of `@vgtd/rig` from straight RGBA. */
export function toPremultiplied(s: Straight): Image {
  const out = createImage(s.width, s.height);
  for (let i = 0; i < s.data.length; i += 4) {
    const a = s.data[i + 3]!;
    const k = a / 255;
    out.data[i] = Math.round(s.data[i]! * k);
    out.data[i + 1] = Math.round(s.data[i + 1]! * k);
    out.data[i + 2] = Math.round(s.data[i + 2]! * k);
    out.data[i + 3] = a;
  }
  return out;
}

/** Alpha-blend colour `c` with opacity `a` (0..1) onto pixel (x, y); out of range is ignored. */
export function blendPixel(img: Straight, x: number, y: number, c: Rgb, a: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(img.data[o + k]! * (1 - a) + c[k]! * a);
}

export function hLine(img: Straight, y: number, x0: number, x1: number, c: Rgb, a = 1, dash = 0): void {
  for (let x = Math.floor(x0); x < x1; x++) {
    if (dash && Math.floor((x - x0) / dash) % 2 === 1) continue;
    blendPixel(img, x, Math.round(y), c, a);
  }
}

export function vLine(img: Straight, x: number, y0: number, y1: number, c: Rgb, a = 1, dash = 0): void {
  for (let y = Math.floor(y0); y < y1; y++) {
    if (dash && Math.floor((y - y0) / dash) % 2 === 1) continue;
    blendPixel(img, Math.round(x), y, c, a);
  }
}

export function fillEllipse(img: Straight, cx: number, cy: number, rx: number, ry: number, c: Rgb, a = 1): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) blendPixel(img, x, y, c, a);
    }
}

/** Filled triangle by barycentric test. */
export function fillTriangle(
  img: Straight,
  p: readonly [number, number],
  q: readonly [number, number],
  r: readonly [number, number],
  c: Rgb,
  a = 1,
): void {
  const minX = Math.floor(Math.min(p[0], q[0], r[0]));
  const maxX = Math.ceil(Math.max(p[0], q[0], r[0]));
  const minY = Math.floor(Math.min(p[1], q[1], r[1]));
  const maxY = Math.ceil(Math.max(p[1], q[1], r[1]));
  const area = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0])) / area;
      const w1 = ((r[0] - q[0]) * (py - q[1]) - (r[1] - q[1]) * (px - q[0])) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) blendPixel(img, x, y, c, a);
    }
}
