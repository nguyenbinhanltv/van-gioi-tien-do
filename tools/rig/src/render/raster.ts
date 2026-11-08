/** Software rasteriser: lines, discs, rects, text digits and textured triangles (bilinear, premultiplied). */
import type { Image } from './image.js';

export type Rgba = readonly [number, number, number, number];

function blendPixel(
  img: Image,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
  additive: boolean,
): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const d = img.data;
  if (additive) {
    d[i] = d[i]! + r;
    d[i + 1] = d[i + 1]! + g;
    d[i + 2] = d[i + 2]! + b;
    d[i + 3] = Math.max(d[i + 3]!, a);
    return;
  }
  const k = 1 - a / 255;
  d[i] = r + d[i]! * k;
  d[i + 1] = g + d[i + 1]! * k;
  d[i + 2] = b + d[i + 2]! * k;
  d[i + 3] = a + d[i + 3]! * k;
}

/** Plot a straight-alpha colour. */
export function plot(img: Image, x: number, y: number, c: Rgba): void {
  const a = c[3] / 255;
  blendPixel(img, Math.round(x), Math.round(y), c[0] * a, c[1] * a, c[2] * a, c[3], false);
}

export function fillRect(img: Image, x: number, y: number, w: number, h: number, c: Rgba): void {
  for (let j = Math.max(0, Math.floor(y)); j < Math.min(img.height, Math.ceil(y + h)); j++) {
    for (let i = Math.max(0, Math.floor(x)); i < Math.min(img.width, Math.ceil(x + w)); i++) plot(img, i, j, c);
  }
}

export function line(img: Image, x0: number, y0: number, x1: number, y1: number, c: Rgba, thickness = 1): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const r = thickness / 2;
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (thickness <= 1) plot(img, x, y, c);
    else disc(img, x, y, r, c);
  }
}

export function disc(img: Image, cx: number, cy: number, r: number, c: Rgba): void {
  for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
    for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) plot(img, i, j, c);
    }
  }
}

export function cross(img: Image, cx: number, cy: number, r: number, c: Rgba): void {
  line(img, cx - r, cy, cx + r, cy, c);
  line(img, cx, cy - r, cx, cy + r, c);
}

export interface TexVertex {
  readonly x: number;
  readonly y: number;
  readonly u: number;
  readonly v: number;
}

export interface TextureRegion {
  readonly image: Image;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function sample(tex: TextureRegion, u: number, v: number): [number, number, number, number] {
  const fx = Math.min(tex.width - 1, Math.max(0, u * tex.width - 0.5));
  const fy = Math.min(tex.height - 1, Math.max(0, v * tex.height - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(tex.width - 1, x0 + 1);
  const y1 = Math.min(tex.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  const w = tex.image.width;
  const d = tex.image.data;
  for (let ch = 0; ch < 4; ch++) {
    const p00 = d[((tex.y + y0) * w + tex.x + x0) * 4 + ch]!;
    const p10 = d[((tex.y + y0) * w + tex.x + x1) * 4 + ch]!;
    const p01 = d[((tex.y + y1) * w + tex.x + x0) * 4 + ch]!;
    const p11 = d[((tex.y + y1) * w + tex.x + x1) * 4 + ch]!;
    out[ch] = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
  }
  return out;
}

/** Rasterise one textured triangle (screen px, uv 0..1 across the region) with a premultiplied tint. */
export function texturedTriangle(
  img: Image,
  tex: TextureRegion,
  a: TexVertex,
  b: TexVertex,
  c: TexVertex,
  tint: Rgba = [255, 255, 255, 255],
  additive = false,
): void {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(img.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(img.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(den) < 1e-9) return;
  const tr = tint[0] / 255;
  const tg = tint[1] / 255;
  const tb = tint[2] / 255;
  const ta = tint[3] / 255;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / den;
      const w1 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / den;
      const w2 = 1 - w0 - w1;
      const eps = -1e-4;
      if (w0 < eps || w1 < eps || w2 < eps) continue;
      const s = sample(tex, w0 * a.u + w1 * b.u + w2 * c.u, w0 * a.v + w1 * b.v + w2 * c.v);
      if (s[3] <= 0) continue;
      blendPixel(img, x, y, s[0] * tr * ta, s[1] * tg * ta, s[2] * tb * ta, s[3] * ta, additive);
    }
  }
}

// ------------------------------------------------------------------ digits (3x5 font)
const DIGITS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001001001',
  '8': '111101111101111',
  '9': '111101111001111',
};

export function drawNumber(img: Image, text: string, x: number, y: number, scale: number, c: Rgba): void {
  let cx = x;
  for (const ch of text) {
    const g = DIGITS[ch];
    if (g) {
      for (let i = 0; i < 15; i++) {
        if (g[i] === '1') fillRect(img, cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, c);
      }
    }
    cx += 4 * scale;
  }
}

/** Copy `src` into `dst` at (x, y) (premultiplied over). */
export function blit(dst: Image, src: Image, x: number, y: number, mirror = false): void {
  for (let j = 0; j < src.height; j++) {
    for (let i = 0; i < src.width; i++) {
      const si = (j * src.width + (mirror ? src.width - 1 - i : i)) * 4;
      const a = src.data[si + 3]!;
      if (a === 0) continue;
      blendPixel(dst, x + i, y + j, src.data[si]!, src.data[si + 1]!, src.data[si + 2]!, a, false);
    }
  }
}
