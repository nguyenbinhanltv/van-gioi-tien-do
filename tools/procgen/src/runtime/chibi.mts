/**
 * Chibi RUNTIME derivatives (D71): turns the exported DragonBones armatures of `<class>-chibi-v1` (source art, never
 * modified) into per-direction Asset Bundles with
 *   - two resolution tiers: `full` (exact pixels) and `1x` (half resolution, Lanczos3 on premultiplied RGBA),
 *   - two clip groups per tier: `loco` (idle/walk/run, loaded first) and `rest` (everything else, on demand).
 * Frames are cropped from the source pages and re-packed (shelf, padding + extrude) so the pixels of a frame are
 * unchanged at `full`. Deterministic: same input -> same output bytes. No external tools, no Math.random.
 *
 * `planChibi` is geometry only (no pixel work) and is what the CI budget gate uses; `buildChibi` writes the files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BUDGETS, CHIBI_RUNTIME } from '@vgtd/shared';

const require = createRequire(import.meta.url);
const { Image, decodePNG } = require('../lib/png.js') as {
  Image: new (w: number, h: number) => RgbaImage & { toPNG(): Buffer };
  decodePNG: (b: Buffer) => RgbaImage;
};

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export type Tier = 'full' | '1x';
export type ClipGroup = 'loco' | 'rest';
export const TIERS: readonly Tier[] = ['full', '1x'];
export const GROUPS: readonly ClipGroup[] = ['loco', 'rest'];

interface SubTexture {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PlacedFrame {
  name: string;
  /** Source rect (in the exported page). */
  src: { page: number; x: number; y: number; w: number; h: number };
  /** Destination rect in the packed page of its group. */
  dst: { page: number; x: number; y: number; w: number; h: number };
  /** Display scale compensation: source w / packed w, source h / packed h (1 at `full`). */
  kx: number;
  ky: number;
}
export interface PlannedPage {
  group: ClipGroup;
  /** Atlas asset name, e.g. `thetuchibi_SE_tex` (first loco page) or `thetuchibi_SE_rest1_tex`. */
  name: string;
  width: number;
  height: number;
  frames: PlacedFrame[];
}
export interface PlannedTier {
  tier: Tier;
  pages: PlannedPage[];
}
export interface PlannedBundle {
  bundle: string; // chibi-the-tu-se
  classId: string;
  folder: string;
  stem: string;
  dir: string;
  tiers: PlannedTier[];
}

export const bundleName = (classId: string, dir: string): string => `chibi-${classId}-${dir.toLowerCase()}`;

// ---- discovery ----------------------------------------------------------------------------------------------
export interface SourceDirection {
  classId: string;
  folder: string; // absolute
  stem: string;
  dir: string;
}
export function discoverSources(root: string): SourceDirection[] {
  const out: SourceDirection[] = [];
  if (!fs.existsSync(root)) return out;
  for (const d of fs.readdirSync(root).sort()) {
    const m = /^(.+)-chibi-v1$/.exec(d);
    if (!m || !fs.statSync(path.join(root, d)).isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(root, d)).sort()) {
      const k = /^(.+)_(E|SE|S|NE|N)_ske\.json$/.exec(f);
      if (k) out.push({ classId: m[1]!, folder: path.join(root, d), stem: k[1]!, dir: k[2]! });
    }
  }
  return out;
}

interface SourceAtlas {
  page: number;
  imagePath: string;
  width: number;
  height: number;
  subs: SubTexture[];
}
function readJson<T>(f: string): T {
  return JSON.parse(fs.readFileSync(f, 'utf8')) as T;
}
function readAtlases(s: SourceDirection): SourceAtlas[] {
  const base = `${s.stem}_${s.dir}`;
  const names = [`${base}_tex.json`];
  for (let i = 1; fs.existsSync(path.join(s.folder, `${base}_page${i}_tex.json`)); i++) names.push(`${base}_page${i}_tex.json`);
  return names.map((n, page) => {
    const j = readJson<{ imagePath: string; width: number; height: number; SubTexture: SubTexture[] }>(path.join(s.folder, n));
    return { page, imagePath: j.imagePath, width: j.width, height: j.height, subs: j.SubTexture };
  });
}

interface Ske {
  armature: Array<{
    slot: Array<{ name: string; displayIndex?: number }>;
    skin: Array<{ slot: Array<{ name: string; display: Array<{ name: string; transform?: { scX?: number; scY?: number } }> }> }>;
    animation: Array<{ name: string; slot?: Array<{ displayFrame?: Array<{ value: number }> }> }>;
  }>;
}

/** Display names used by the locomotion clips (anything a loco clip draws must ship in the loco group). */
export function locoFrameNames(ske: Ske): Set<string> {
  const arm = ske.armature[0]!;
  const display = arm.skin[0]!.slot[0]!.display;
  const used = new Set<string>();
  for (const an of arm.animation) {
    if (!(CHIBI_RUNTIME.LOCOMOTION_CLIPS as readonly string[]).includes(an.name)) continue;
    for (const sl of an.slot ?? []) for (const f of sl.displayFrame ?? []) used.add(display[f.value]!.name);
  }
  return used;
}

// ---- packing ------------------------------------------------------------------------------------------------
interface Rect {
  name: string;
  w: number;
  h: number;
}
interface Slot {
  name: string;
  x: number;
  y: number;
}
function shelf(rects: Rect[], W: number, H: number, pad: number): Slot[] | null {
  const out: Slot[] = [];
  let x = pad;
  let y = pad;
  let rowH = 0;
  for (const r of rects) {
    if (r.w + 2 * pad > W || r.h + 2 * pad > H) return null;
    if (x + r.w + pad > W) {
      x = pad;
      y += rowH + pad * 2;
      rowH = 0;
    }
    if (y + r.h + pad > H) return null;
    out.push({ name: r.name, x, y });
    x += r.w + pad * 2;
    rowH = Math.max(rowH, r.h);
  }
  return out;
}
/** Smallest power-of-two page (up to the platform cap) that holds all rects; several cap-sized pages otherwise. */
export function packPages(rects: Rect[], cap: number, pad: number): Array<{ width: number; height: number; slots: Slot[] }> {
  const sorted = [...rects].sort((a, b) => b.h - a.h || b.w - a.w || (a.name < b.name ? -1 : 1));
  const area = sorted.reduce((s, r) => s + (r.w + 2 * pad) * (r.h + 2 * pad), 0);
  const sizes: Array<[number, number]> = [];
  for (let w = 64; w <= cap; w *= 2) for (let h = 64; h <= cap; h *= 2) if (w * h >= area) sizes.push([w, h]);
  sizes.sort((a, b) => a[0] * a[1] - b[0] * b[1] || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]));
  for (const [w, h] of sizes) {
    const s = shelf(sorted, w, h, pad);
    if (s) return [{ width: w, height: h, slots: s }];
  }
  // does not fit one page: fill cap x cap pages in order, the last one shrinks to fit
  const pages: Array<{ width: number; height: number; slots: Slot[] }> = [];
  let rest = sorted;
  while (rest.length) {
    let n = rest.length;
    let s = shelf(rest.slice(0, n), cap, cap, pad);
    while (!s && n > 1) s = shelf(rest.slice(0, --n), cap, cap, pad);
    if (!s) throw new Error(`frame ${rest[0]!.name} does not fit a ${cap}px page`);
    const chunk = rest.slice(0, n);
    rest = rest.slice(n);
    pages.push(rest.length ? { width: cap, height: cap, slots: s } : packPages(chunk, cap, pad)[0]!);
  }
  return pages;
}

// ---- planning (geometry only) -----------------------------------------------------------------------------------
export function planBundle(s: SourceDirection): PlannedBundle {
  const ske = readJson<Ske>(path.join(s.folder, `${s.stem}_${s.dir}_ske.json`));
  const atlases = readAtlases(s);
  const loco = locoFrameNames(ske);
  const all = new Map<string, { page: number; sub: SubTexture }>();
  for (const a of atlases) for (const sub of a.subs) all.set(sub.name, { page: a.page, sub });
  for (const n of loco) if (!all.has(n)) throw new Error(`${s.classId}/${s.dir}: loco frame ${n} missing from atlas`);
  const tiers: PlannedTier[] = TIERS.map((tier) => {
    const f = tier === 'full' ? 1 : CHIBI_RUNTIME.HALF_SCALE;
    const pages: PlannedPage[] = [];
    for (const group of GROUPS) {
      const names = [...all.keys()].filter((n) => loco.has(n) === (group === 'loco')).sort();
      const dims = new Map(
        names.map((n) => {
          const sub = all.get(n)!.sub;
          return [n, { w: Math.max(1, Math.round(sub.width * f)), h: Math.max(1, Math.round(sub.height * f)) }];
        }),
      );
      const packed = packPages(
        names.map((n) => ({ name: n, ...dims.get(n)! })),
        BUDGETS.ATLAS_MAX_WEB_MOBILE,
        BUDGETS.ATLAS_PADDING_PX,
      );
      packed.forEach((pg, i) => {
        const base = `${s.stem}_${s.dir}`;
        const name = group === 'loco' ? (i === 0 ? `${base}_tex` : `${base}_loco${i}_tex`) : `${base}_rest${i + 1}_tex`;
        pages.push({
          group,
          name,
          width: pg.width,
          height: pg.height,
          frames: pg.slots.map((sl) => {
            const src = all.get(sl.name)!;
            const d = dims.get(sl.name)!;
            return {
              name: sl.name,
              src: { page: src.page, x: src.sub.x, y: src.sub.y, w: src.sub.width, h: src.sub.height },
              dst: { page: i, x: sl.x, y: sl.y, w: d.w, h: d.h },
              kx: src.sub.width / d.w,
              ky: src.sub.height / d.h,
            };
          }),
        });
      });
    }
    return { tier, pages };
  });
  return { bundle: bundleName(s.classId, s.dir), classId: s.classId, folder: s.folder, stem: s.stem, dir: s.dir, tiers };
}

// ---- pixels -------------------------------------------------------------------------------------------------
const lanczos = (x: number, a = 3): number => {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
};
function axisWeights(srcN: number, dstN: number): Array<{ start: number; w: Float64Array }> {
  const scale = srcN / dstN;
  const support = 3 * Math.max(1, scale);
  const out: Array<{ start: number; w: Float64Array }> = [];
  for (let i = 0; i < dstN; i++) {
    const c = (i + 0.5) * scale - 0.5;
    const lo = Math.max(0, Math.floor(c - support) + 1);
    const hi = Math.min(srcN - 1, Math.floor(c + support));
    const w = new Float64Array(hi - lo + 1);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += w[k - lo] = lanczos((k - c) / Math.max(1, scale));
    for (let k = 0; k < w.length; k++) w[k]! /= sum || 1;
    out.push({ start: lo, w });
  }
  return out;
}
/** Separable Lanczos3 on premultiplied RGBA (the atlases are premultiplied, so no alpha weighting is needed). */
export function lanczos3Resize(src: RgbaImage, dw: number, dh: number): RgbaImage {
  const wx = axisWeights(src.width, dw);
  const wy = axisWeights(src.height, dh);
  const tmp = new Float32Array(dw * src.height * 4);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < dw; x++) {
      const { start, w } = wx[x]!;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const i = (y * src.width + start + k) * 4;
        const q = w[k]!;
        r += src.data[i]! * q; g += src.data[i + 1]! * q; b += src.data[i + 2]! * q; a += src.data[i + 3]! * q;
      }
      const o = (y * dw + x) * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  const out = new Image(dw, dh);
  for (let y = 0; y < dh; y++) {
    const { start, w } = wy[y]!;
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const i = ((start + k) * dw + x) * 4;
        const q = w[k]!;
        r += tmp[i]! * q; g += tmp[i + 1]! * q; b += tmp[i + 2]! * q; a += tmp[i + 3]! * q;
      }
      const o = (y * dw + x) * 4;
      const A = Math.min(255, Math.max(0, Math.round(a)));
      // premultiplied: colour can never exceed alpha
      out.data[o] = Math.min(A, Math.max(0, Math.round(r)));
      out.data[o + 1] = Math.min(A, Math.max(0, Math.round(g)));
      out.data[o + 2] = Math.min(A, Math.max(0, Math.round(b)));
      out.data[o + 3] = A;
    }
  }
  return out;
}

function crop(src: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const out = new Image(w, h);
  for (let r = 0; r < h; r++) out.data.set(src.data.subarray(((y + r) * src.width + x) * 4, ((y + r) * src.width + x + w) * 4), r * w * 4);
  return out;
}
function blitExtrude(dst: RgbaImage, src: RgbaImage, dx: number, dy: number, ring: number): void {
  for (let y = -ring; y < src.height + ring; y++) {
    for (let x = -ring; x < src.width + ring; x++) {
      const sx = Math.min(src.width - 1, Math.max(0, x));
      const sy = Math.min(src.height - 1, Math.max(0, y));
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      const s = (sy * src.width + sx) * 4;
      const d = (ty * dst.width + tx) * 4;
      dst.data[d] = src.data[s]!; dst.data[d + 1] = src.data[s + 1]!; dst.data[d + 2] = src.data[s + 2]!; dst.data[d + 3] = src.data[s + 3]!;
    }
  }
}

export interface BuiltFile {
  file: string;
  bytes: number;
}
/** Writes `<outRoot>/<bundle>/<tier>/*` for one direction. Returns the written files (relative to the bundle). */
export function buildBundle(s: SourceDirection, plan: PlannedBundle, outRoot: string): BuiltFile[] {
  const ske = readJson<Ske>(path.join(s.folder, `${s.stem}_${s.dir}_ske.json`));
  const srcAtlases = readAtlases(s);
  const pages = srcAtlases.map((a) => decodePNG(fs.readFileSync(path.join(s.folder, a.imagePath))));
  const written: BuiltFile[] = [];
  const put = (rel: string, data: Buffer | string): void => {
    const f = path.join(outRoot, plan.bundle, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
    written.push({ file: rel.split('\\').join('/'), bytes: Buffer.byteLength(data) });
  };
  for (const t of plan.tiers) {
    const byName = new Map<string, PlacedFrame>();
    for (const pg of t.pages) {
      const img = new Image(pg.width, pg.height);
      for (const fr of pg.frames) {
        byName.set(fr.name, fr);
        let tile = crop(pages[fr.src.page]!, fr.src.x, fr.src.y, fr.src.w, fr.src.h);
        if (t.tier === '1x') tile = lanczos3Resize(tile, fr.dst.w, fr.dst.h);
        blitExtrude(img, tile, fr.dst.x, fr.dst.y, BUDGETS.ATLAS_PADDING_PX);
      }
      put(`${t.tier}/${pg.name}.png`, img.toPNG());
      put(
        `${t.tier}/${pg.name}.json`,
        JSON.stringify({
          name: pg.name,
          imagePath: `${pg.name}.png`,
          width: pg.width,
          height: pg.height,
          premultipliedAlpha: true,
          SubTexture: pg.frames.map((f) => ({ name: f.name, x: f.dst.x, y: f.dst.y, width: f.dst.w, height: f.dst.h })),
        }),
      );
    }
    // armature: compensate per-frame scale and start on a locomotion frame (the initial display may not be loaded yet)
    const sk = JSON.parse(JSON.stringify(ske)) as Ske;
    const arm = sk.armature[0]!;
    for (const d of arm.skin[0]!.slot[0]!.display) {
      const fr = byName.get(d.name);
      if (fr && d.transform) {
        d.transform.scX = round6((d.transform.scX ?? 1) * fr.kx);
        d.transform.scY = round6((d.transform.scY ?? 1) * fr.ky);
      }
    }
    const idle = arm.animation.find((a) => a.name === 'idle');
    const first = idle?.slot?.[0]?.displayFrame?.[0]?.value;
    if (first !== undefined && arm.slot[0]) arm.slot[0].displayIndex = first;
    put(`${t.tier}/${s.stem}_${s.dir}_ske.json`, JSON.stringify(sk));
    put(
      `${t.tier}/pages.json`,
      JSON.stringify({
        loco: t.pages.filter((p) => p.group === 'loco').map((p) => p.name),
        rest: t.pages.filter((p) => p.group === 'rest').map((p) => p.name),
      }),
    );
  }
  return written;
}
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
