/**
 * Palette lock: the master defines the character's palette (median cut over its opaque pixels); every frame pixel that is
 * close to a palette colour is pulled toward it, so a model that drifts a hue or a value between cells is brought back
 * without flattening the shading (the pull strength falls off with distance, far colours are left alone).
 */
import type { Image } from '@vgtd/rig';
import type { Straight } from './raster.js';
import { toStraight } from './raster.js';

export type Color3 = readonly [number, number, number];

export interface PaletteOptions {
  /** Palette size (a power of two works best for median cut). Default 32. */
  readonly size?: number;
  /** Alpha at or above which a master pixel counts. Default 200. */
  readonly alpha?: number;
}

/** Median-cut palette of the opaque pixels of `master` (premultiplied `Image`). Deterministic. */
export function paletteFromMaster(master: Image, opts: PaletteOptions = {}): Color3[] {
  const size = opts.size ?? 32;
  const alpha = opts.alpha ?? 200;
  const s = toStraight(master);
  const px: Color3[] = [];
  for (let i = 0; i < s.data.length; i += 4)
    if (s.data[i + 3]! >= alpha) px.push([s.data[i]!, s.data[i + 1]!, s.data[i + 2]!]);
  if (!px.length) throw new RangeError('paletteFromMaster: master has no opaque pixel');
  let boxes: Color3[][] = [px];
  while (boxes.length < size) {
    // split the box with the widest channel range (ties: the larger box, then the earlier one)
    let best = -1;
    let bestRange = 0;
    let bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255;
        let hi = 0;
        for (const c of b) {
          if (c[ch]! < lo) lo = c[ch]!;
          if (c[ch]! > hi) hi = c[ch]!;
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          best = i;
          bestCh = ch;
        }
      }
    });
    if (best < 0 || bestRange === 0) break;
    const b = boxes[best]!;
    const sorted = [...b].sort((p, q) => p[bestCh]! - q[bestCh]! || p[0]! - q[0]! || p[1]! - q[1]! || p[2]! - q[2]!);
    const mid = sorted.length >> 1;
    boxes = [...boxes.slice(0, best), sorted.slice(0, mid), sorted.slice(mid), ...boxes.slice(best + 1)];
  }
  return boxes.map((b) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const c of b) {
      r += c[0]!;
      g += c[1]!;
      bl += c[2]!;
    }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)] as Color3;
  });
}

/** Perceptual-ish RGB distance (redmean weights), 0..~765. */
export function colorDistance(a: Color3, b: Color3): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export interface LockOptions {
  /** Pull toward the nearest palette colour at distance 0 (0..1). Default 0.6. */
  readonly strength?: number;
  /** Colours farther than this from every palette entry are left untouched. Default 60. */
  readonly maxDistance?: number;
}

export interface LockStats {
  /** Opaque pixels examined. */
  readonly pixels: number;
  /** Pixels that moved by at least one level. */
  readonly moved: number;
  /** Mean distance of the examined pixels to their nearest palette colour BEFORE the lock. */
  readonly meanDistanceBefore: number;
  readonly meanDistanceAfter: number;
}

/** Lock a straight-alpha frame to the palette. Returns a new image and statistics. */
export function lockPalette(
  frame: Straight,
  palette: readonly Color3[],
  opts: LockOptions = {},
): { image: Straight; stats: LockStats } {
  const strength = opts.strength ?? 0.6;
  const maxD = opts.maxDistance ?? 60;
  const data = new Uint8ClampedArray(frame.data);
  let pixels = 0;
  let moved = 0;
  let before = 0;
  let after = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const c: Color3 = [data[i]!, data[i + 1]!, data[i + 2]!];
    let bi = 0;
    let bd = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const d = colorDistance(c, palette[k]!);
      if (d < bd) {
        bd = d;
        bi = k;
      }
    }
    pixels++;
    before += bd;
    if (bd >= maxD) {
      after += bd;
      continue;
    }
    const p = palette[bi]!;
    const w = strength * (1 - bd / maxD);
    let changed = false;
    for (let k = 0; k < 3; k++) {
      const v = Math.round(c[k]! + (p[k]! - c[k]!) * w);
      if (v !== c[k]) changed = true;
      data[i + k] = v;
    }
    if (changed) moved++;
    after += colorDistance([data[i]!, data[i + 1]!, data[i + 2]!], p);
  }
  return {
    image: { width: frame.width, height: frame.height, data },
    stats: {
      pixels,
      moved,
      meanDistanceBefore: pixels ? before / pixels : 0,
      meanDistanceAfter: pixels ? after / pixels : 0,
    },
  };
}
