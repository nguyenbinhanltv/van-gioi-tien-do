/**
 * QA gates of the sprite pipeline (D41). Every gate returns plain findings; `ok` of a report is "no failing finding".
 *   height      figure height of the aligned frames vs the master (upright clips +-3 %; anatomical clips need a declared
 *               exception, never a silent relaxation)
 *   footSlide   a planted foot follows the ground speed (no slide) over its contact frames
 *   loopSeam    last -> first frame step of a looping clip is no bigger than a normal step
 *   similarity  face and torso of every frame still look like the master
 *   present     every expected frame exists and is not empty
 */
import type { Image } from '@vgtd/rig';
import { measureFigure } from './master.js';
import type { AlignedFrame } from './align.js';
import type { CellSpec, Guides } from './types.js';

export type Severity = 'fail' | 'warn' | 'info';

export interface Finding {
  readonly gate: 'height' | 'footSlide' | 'loopSeam' | 'similarity' | 'present';
  readonly severity: Severity;
  readonly clip: string;
  readonly frame?: number;
  readonly message: string;
}

export interface QaClip {
  readonly name: string;
  readonly loop: boolean;
  /** `upright`: every frame within the height tolerance; `free`: bending / airborne poses, exceptions must be declared. */
  readonly kind: 'upright' | 'free';
  /** Frames the table / project expects (cells in use). */
  readonly expectedFrames: number;
  /** Aligned frames in order (null = missing or empty). */
  readonly frames: readonly (AlignedFrame | null)[];
  /** Per-frame documented pose exceptions (frame index -> reason). */
  readonly exceptions?: Readonly<Record<number, string>>;
  /** Template cells (leading leg, foot ghosts) of this clip, for the foot-slide gate. */
  readonly cells?: readonly CellSpec[];
  /** Expected sole travel of a planted foot per sheet frame (canvas px, the character walks in place). */
  readonly groundPxPerFrame?: number;
}

export interface QaOptions {
  readonly masterHeight: number;
  readonly master: Image;
  readonly guides: Guides;
  /** Height tolerance, fraction. Default 0.03. */
  readonly heightTolerance?: number;
  /** Planted-foot slide tolerance, canvas px per frame. Default 3. */
  readonly slideTolerance?: number;
  /** Loop seam: allowed ratio of the seam step to the mean step. Default 2.5 (the viewer's gate). */
  readonly seamRatio?: number;
  /** Minimum region similarity to the master, 0..1. Default 0.7. */
  readonly minSimilarity?: number;
}

// ---------------------------------------------------------------------------------------------------------------- height

export function checkHeights(clip: QaClip, o: QaOptions): Finding[] {
  const tol = o.heightTolerance ?? 0.03;
  const lo = o.masterHeight * (1 - tol);
  const hi = o.masterHeight * (1 + tol);
  const out: Finding[] = [];
  clip.frames.forEach((f, i) => {
    if (!f) return;
    const h = f.metrics.height;
    const inBand = h >= lo && h <= hi;
    const exception = clip.exceptions?.[i];
    if (inBand) return;
    if (exception)
      out.push({
        gate: 'height',
        severity: 'info',
        clip: clip.name,
        frame: i,
        message: `${h} px outside ${lo.toFixed(1)}..${hi.toFixed(1)} (declared exception: ${exception})`,
      });
    else if (clip.kind === 'upright')
      out.push({
        gate: 'height',
        severity: 'fail',
        clip: clip.name,
        frame: i,
        message: `height ${h} px outside ${lo.toFixed(1)}..${hi.toFixed(1)} (master ${o.masterHeight} px +-${(tol * 100).toFixed(0)} %)`,
      });
    else
      out.push({
        gate: 'height',
        severity: 'warn',
        clip: clip.name,
        frame: i,
        message: `height ${h} px outside the upright band and no pose exception declared`,
      });
  });
  return out;
}

// ------------------------------------------------------------------------------------------------------------- foot slide

/** x of the sole of the foot near `ghostX`: centroid of the opaque pixels in the bottom rows within `window` px. */
export function soleX(img: Image, ground: number, ghostX: number, window = 28, rows = 6): number | null {
  let sx = 0;
  let n = 0;
  for (let y = Math.max(0, Math.floor(ground - rows)); y <= Math.min(img.height - 1, Math.ceil(ground)); y++)
    for (
      let x = Math.max(0, Math.floor(ghostX - window));
      x <= Math.min(img.width - 1, Math.ceil(ghostX + window));
      x++
    )
      if (img.data[(y * img.width + x) * 4 + 3]! >= 128) {
        sx += x;
        n++;
      }
  return n >= 4 ? sx / n : null;
}

export function checkFootSlide(clip: QaClip, o: QaOptions): Finding[] {
  if (!clip.cells || clip.groundPxPerFrame === undefined) return [];
  const tol = o.slideTolerance ?? 3;
  const out: Finding[] = [];
  for (const side of ['R', 'L'] as const) {
    const key = side === 'R' ? 'nearFoot' : 'farFoot';
    // consecutive planted spans
    let span: { frame: number; x: number }[] = [];
    const flush = () => {
      for (let k = 1; k < span.length; k++) {
        const a = span[k - 1]!;
        const b = span[k]!;
        const steps = b.frame - a.frame;
        // the planted foot travels BACKWARD relative to the in-place body: dx = -speed per frame (facing +x)
        const slide = Math.abs(b.x - a.x + clip.groundPxPerFrame! * steps) / steps;
        if (slide > tol)
          out.push({
            gate: 'footSlide',
            severity: 'fail',
            clip: clip.name,
            frame: b.frame,
            message: `${side} foot slides ${slide.toFixed(1)} px/frame between frames ${a.frame}-${b.frame} (limit ${tol})`,
          });
      }
      span = [];
    };
    clip.cells.forEach((c, i) => {
      const ghost = c[key];
      const f = clip.frames[i];
      if (!ghost?.planted || !f) return flush();
      const x = soleX(f.image, o.guides.ground, ghost.x);
      if (x === null) return flush();
      span.push({ frame: i, x });
    });
    flush();
  }
  return out;
}

// -------------------------------------------------------------------------------------------------------------- loop seam

/** Mean absolute RGBA difference between two premultiplied images of the same size. */
export function imageDiff(a: Image, b: Image): number {
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i]! - b.data[i]!);
  return s / a.data.length;
}

export function checkLoopSeam(clip: QaClip, o: QaOptions): Finding[] {
  if (!clip.loop) return [];
  const imgs = clip.frames.map((f) => f?.image);
  if (imgs.length < 3 || imgs.some((i) => !i)) return [];
  const steps: number[] = [];
  for (let i = 1; i < imgs.length; i++) steps.push(imageDiff(imgs[i - 1]!, imgs[i]!));
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  const seam = imageDiff(imgs[imgs.length - 1]!, imgs[0]!);
  const ratio = mean > 0 ? seam / mean : 0;
  const limit = o.seamRatio ?? 2.5;
  return ratio > limit
    ? [
        {
          gate: 'loopSeam',
          severity: 'fail',
          clip: clip.name,
          message: `loop seam step is ${ratio.toFixed(2)}x the mean step (limit ${limit})`,
        },
      ]
    : [];
}

// ------------------------------------------------------------------------------------------------------------ similarity

const GRID = 8;

/** GRIDxGRID block means of the premultiplied crop [x0,x1) x [y0,y1) of an image. */
function blockMeans(img: Image, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  for (let gy = 0; gy < GRID; gy++)
    for (let gx = 0; gx < GRID; gx++) {
      const sums = [0, 0, 0, 0];
      let n = 0;
      for (let y = Math.floor(y0 + (gy * h) / GRID); y < Math.floor(y0 + ((gy + 1) * h) / GRID); y++)
        for (let x = Math.floor(x0 + (gx * w) / GRID); x < Math.floor(x0 + ((gx + 1) * w) / GRID); x++) {
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          const o = (y * img.width + x) * 4;
          for (let k = 0; k < 4; k++) sums[k]! += img.data[o + k]!;
          n++;
        }
      for (let k = 0; k < 4; k++) out.push(n ? sums[k]! / n : 0);
    }
  return out;
}

/** 1 - normalised L1 distance of two block-mean vectors (1 = identical). */
export function blockSimilarity(a: readonly number[], b: readonly number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
  return 1 - d / (a.length * 255);
}

/** Face (top 20 % of the figure) and torso (30..55 %) crops of a figure, around its pelvis axis. */
function figureCrops(img: Image): { face: number[]; torso: number[] } | null {
  const m = measureFigure(img);
  if (!m) return null;
  const half = m.height * 0.22;
  const crop = (a: number, b: number) =>
    blockMeans(
      img,
      Math.round(m.pelvisX - half),
      Math.round(m.top + a * m.height),
      Math.round(m.pelvisX + half),
      Math.round(m.top + b * m.height),
    );
  return { face: crop(0, 0.2), torso: crop(0.3, 0.55) };
}

export function checkSimilarity(clip: QaClip, o: QaOptions): Finding[] {
  const ref = figureCrops(o.master);
  if (!ref) return [];
  const min = o.minSimilarity ?? 0.7;
  const out: Finding[] = [];
  clip.frames.forEach((f, i) => {
    if (!f || clip.exceptions?.[i]) return;
    const c = figureCrops(f.image);
    if (!c) return;
    const face = blockSimilarity(ref.face, c.face);
    const torso = blockSimilarity(ref.torso, c.torso);
    if (face < min)
      out.push({
        gate: 'similarity',
        severity: 'fail',
        clip: clip.name,
        frame: i,
        message: `face similarity ${face.toFixed(2)} < ${min}`,
      });
    if (torso < min)
      out.push({
        gate: 'similarity',
        severity: 'fail',
        clip: clip.name,
        frame: i,
        message: `torso similarity ${torso.toFixed(2)} < ${min}`,
      });
  });
  return out;
}

// ----------------------------------------------------------------------------------------------------------------- present

export function checkPresent(clip: QaClip): Finding[] {
  const out: Finding[] = [];
  if (clip.frames.length !== clip.expectedFrames)
    out.push({
      gate: 'present',
      severity: 'fail',
      clip: clip.name,
      message: `${clip.frames.length} frames, expected ${clip.expectedFrames}`,
    });
  clip.frames.forEach((f, i) => {
    if (!f)
      out.push({ gate: 'present', severity: 'fail', clip: clip.name, frame: i, message: 'frame is missing or empty' });
  });
  return out;
}

export interface QaReport {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

/** Run every gate on every clip. */
export function runQa(clips: readonly QaClip[], o: QaOptions): QaReport {
  const findings = clips.flatMap((c) => [
    ...checkPresent(c),
    ...checkHeights(c, o),
    ...checkFootSlide(c, o),
    ...checkLoopSeam(c, o),
    ...checkSimilarity(c, o),
  ]);
  return { ok: !findings.some((f) => f.severity === 'fail'), findings };
}
