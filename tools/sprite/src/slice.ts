/**
 * Slicer: raw AI sheet (key-colour background, grid of cells) -> one keyed, defringed, fragment-free straight-alpha frame
 * per cell. Everything here is deterministic pixel math (no random, no clock).
 */
import type { Image } from '@vgtd/rig';
import { KEY_MAGENTA, type Rgb } from './types.js';
import { colorDistance, type Color3 } from './palette.js';
import { toPremultiplied, toStraight, type Straight } from './raster.js';

export interface KeyOptions {
  /** Key colour. Default magenta; `'auto'` takes the median colour of the four sheet corners. */
  readonly key?: Rgb | 'auto';
  /** RGB distance to the key under which a pixel is fully transparent. Default 60. */
  readonly inner?: number;
  /** RGB distance above which a pixel is fully opaque. Default 150. */
  readonly outer?: number;
}

const dist3 = (r: number, g: number, b: number, k: Rgb) => Math.hypot(r - k[0], g - k[1], b - k[2]);

/** Median colour of the four corner pixels (3x3 each). */
export function cornerKey(s: Straight): Rgb {
  const pts: [number, number][] = [
    [1, 1],
    [s.width - 2, 1],
    [1, s.height - 2],
    [s.width - 2, s.height - 2],
  ];
  const ch: number[][] = [[], [], []];
  for (const [cx, cy] of pts)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const o = ((cy + dy) * s.width + cx + dx) * 4;
        for (let k = 0; k < 3; k++) ch[k]!.push(s.data[o + k]!);
      }
  const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
  return [med(ch[0]!), med(ch[1]!), med(ch[2]!)];
}

/**
 * Chroma-key a straight-alpha image in place-free fashion: alpha from the distance to the key colour (soft between
 * `inner` and `outer`), colour un-mixed from the key so edge pixels carry no magenta.
 */
export function keyOut(src: Straight, opts: KeyOptions = {}): Straight {
  const key = opts.key === 'auto' ? cornerKey(src) : (opts.key ?? KEY_MAGENTA);
  const inner = opts.inner ?? 60;
  const outer = opts.outer ?? 150;
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const d = dist3(data[i]!, data[i + 1]!, data[i + 2]!, key);
    const a = Math.min(1, Math.max(0, (d - inner) / (outer - inner)));
    if (a >= 1) continue;
    if (a <= 0) {
      data[i + 3] = 0;
      data[i] = data[i + 1] = data[i + 2] = 0;
      continue;
    }
    for (let k = 0; k < 3; k++)
      data[i + k] = Math.round(Math.min(255, Math.max(0, (data[i + k]! - (1 - a) * key[k]!) / a)));
    data[i + 3] = Math.round(data[i + 3]! * a);
  }
  return { width: src.width, height: src.height, data };
}

export interface SpillOptions {
  /** `min(r, b) - g` above which a pixel counts as magenta tinted. Default 24. */
  readonly threshold?: number;
  /** How much of the tint is removed, 0..1. Default 1 (the pixel ends up with min(r, b) = g). */
  readonly strength?: number;
  /** Legitimate colours (the master palette): a pixel within `keepDistance` of one is never touched (pink / purple cloth). */
  readonly palette?: readonly Color3[];
  readonly keepDistance?: number;
}

/**
 * Interior spill cleanup: every opaque pixel (not only the silhouette edge) whose colour leans magenta (red AND blue above
 * green by `threshold`, red and blue about equal) loses that cast, unless it is close to a palette colour. This removes the
 * magenta strands the key colour leaves between hair strands, which the edge-only defringe cannot see.
 */
export function despillInterior(src: Straight, opts: SpillOptions = {}): { image: Straight; fixed: number } {
  const threshold = opts.threshold ?? 24;
  const strength = opts.strength ?? 1;
  const keep = opts.keepDistance ?? 36;
  const data = new Uint8ClampedArray(src.data);
  let fixed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const m = Math.min(r, b) - g;
    if (m <= threshold || Math.abs(r - b) > 0.6 * m + 20) continue;
    if (opts.palette?.some((p) => colorDistance([r, g, b], p) < keep)) continue;
    data[i] = Math.round(r - strength * m);
    data[i + 2] = Math.round(b - strength * m);
    fixed++;
  }
  return { image: { width: src.width, height: src.height, data }, fixed };
}

const N8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Defringe: pixels at the silhouette edge (an 8-neighbour is transparent) lose any key-colour cast (red and blue pulled
 * down to green where both exceed it) and take the colour of their opaque interior neighbours when they have some.
 */
export function defringe(src: Straight, edgeAlpha = 250): Straight {
  const { width: w, height: h } = src;
  const data = new Uint8ClampedArray(src.data);
  const alphaAt = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src.data[(y * w + x) * 4 + 3]!);
  const isEdge = (x: number, y: number) => {
    if (alphaAt(x, y) === 0) return false;
    if (alphaAt(x, y) < edgeAlpha) return true;
    return N8.some(([dx, dy]) => alphaAt(x + dx, y + dy) === 0);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isEdge(x, y)) continue;
      const o = (y * w + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (alphaAt(nx, ny) < edgeAlpha || isEdge(nx, ny)) continue;
        const p = (ny * w + nx) * 4;
        r += src.data[p]!;
        g += src.data[p + 1]!;
        b += src.data[p + 2]!;
        n++;
      }
      if (n > 0) {
        data[o] = Math.round(r / n);
        data[o + 1] = Math.round(g / n);
        data[o + 2] = Math.round(b / n);
      } else {
        const spill = Math.min(data[o]!, data[o + 2]!) - data[o + 1]!;
        if (spill > 0) {
          data[o] = data[o]! - spill;
          data[o + 2] = data[o + 2]! - spill;
        }
      }
    }
  return { width: w, height: h, data };
}

export interface FragmentOptions {
  /** Alpha at or above which a pixel belongs to a component. Default 32. */
  readonly alpha?: number;
  /** Components smaller than this many px are always removed. Default 24. */
  readonly minArea?: number;
  /** Components at least this fraction of the largest one are kept (a detached sword). Default 0.04. */
  readonly keepFraction?: number;
  /** Smaller components within this many px of the largest component are kept (finger, tassel). Default 6. */
  readonly gap?: number;
}

export interface Component {
  readonly area: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly pixels: readonly number[];
}

/** 8-connected components of the pixels with alpha >= `alpha`. */
export function components(s: Straight, alpha = 32): Component[] {
  const { width: w, height: h } = s;
  const seen = new Uint8Array(w * h);
  const out: Component[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || s.data[start * 4 + 3]! < alpha) continue;
    const stack = [start];
    seen[start] = 1;
    const pixels: number[] = [];
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (seen[q] || s.data[q * 4 + 3]! < alpha) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push({ area: pixels.length, x0, y0, x1, y1, pixels });
  }
  return out;
}

/** Remove specks and stray fragments (see `FragmentOptions`); returns the cleaned image and the removed count. */
export function removeFragments(src: Straight, opts: FragmentOptions = {}): { image: Straight; removed: number } {
  const comps = components(src, opts.alpha ?? 32);
  if (!comps.length) return { image: src, removed: 0 };
  const largest = comps.reduce((a, b) => (b.area > a.area ? b : a));
  const minArea = opts.minArea ?? 24;
  const keepFraction = opts.keepFraction ?? 0.04;
  const gap = opts.gap ?? 6;
  const data = new Uint8ClampedArray(src.data);
  let removed = 0;
  for (const c of comps) {
    if (c === largest) continue;
    const near =
      c.x1 + gap >= largest.x0 && c.x0 - gap <= largest.x1 && c.y1 + gap >= largest.y0 && c.y0 - gap <= largest.y1;
    const keep = c.area >= minArea && (c.area >= keepFraction * largest.area || near);
    if (keep) continue;
    for (const p of c.pixels) data[p * 4 + 3] = 0;
    removed++;
  }
  // zero the colour of fully transparent pixels so no stale key colour survives
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  return { image: { width: src.width, height: src.height, data }, removed };
}

export interface SliceOptions extends KeyOptions, FragmentOptions {
  /** Fraction of the cell edge cut off on every side before keying the cell (template border lines). Default 0.01. */
  readonly inset?: number;
  /** Run `defringe`. Default true. */
  readonly defringe?: boolean;
  /** Interior magenta spill cleanup (see `despillInterior`); off unless given. In `runProject` the master palette is added. */
  readonly spill?: SpillOptions;
}

export interface SlicedFrame {
  readonly index: number;
  /** Straight alpha, cell resolution of the raw sheet. */
  readonly image: Straight;
  readonly removedFragments: number;
}

/** Cell rectangle of frame `index` on a sheet of `cols` x `rows` (integer pixel boundaries, evenly divided). */
export function cellRect(width: number, height: number, cols: number, rows: number, index: number) {
  const cw = width / cols;
  const ch = height / rows;
  const cx = index % cols;
  const cy = Math.floor(index / cols);
  const x0 = Math.round(cx * cw);
  const y0 = Math.round(cy * ch);
  return { x: x0, y: y0, width: Math.round((cx + 1) * cw) - x0, height: Math.round((cy + 1) * ch) - y0 };
}

/** Crop a straight image. */
export function crop(s: Straight, x: number, y: number, width: number, height: number): Straight {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const sx = x + i;
      const sy = y + j;
      if (sx < 0 || sy < 0 || sx >= s.width || sy >= s.height) continue;
      const o = (sy * s.width + sx) * 4;
      data.set(s.data.subarray(o, o + 4), (j * width + i) * 4);
    }
  return { width, height, data };
}

/**
 * Slice a raw sheet into `frames` keyed frames in reading order. `sheet` is the decoded PNG (`decodePng`); the key is
 * removed per cell so a border line or a neighbour's overhang never shifts the median corner colour.
 */
export function sliceSheet(
  sheet: Image,
  grid: { readonly cols: number; readonly rows: number; readonly frames: number },
  opts: SliceOptions = {},
): SlicedFrame[] {
  const full = toStraight(sheet);
  const key =
    opts.key === 'auto' || opts.key === undefined ? (opts.key === 'auto' ? cornerKey(full) : KEY_MAGENTA) : opts.key;
  const frames: SlicedFrame[] = [];
  for (let i = 0; i < grid.frames; i++) {
    const r = cellRect(full.width, full.height, grid.cols, grid.rows, i);
    const inset = Math.round(Math.min(r.width, r.height) * (opts.inset ?? 0.01));
    let cell = crop(full, r.x + inset, r.y + inset, r.width - 2 * inset, r.height - 2 * inset);
    cell = keyOut(cell, { ...opts, key });
    if (opts.spill) cell = despillInterior(cell, opts.spill).image;
    if (opts.defringe !== false) cell = defringe(cell);
    const { image, removed } = removeFragments(cell, opts);
    frames.push({ index: i, image, removedFragments: removed });
  }
  return frames;
}

/** Premultiplied `Image` of a sliced frame (the type the rest of the toolchain uses). */
export function framePremultiplied(f: SlicedFrame): Image {
  return toPremultiplied(f.image);
}
