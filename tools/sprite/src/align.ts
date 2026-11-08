/**
 * Aligner. ONE scale per character (the calibration), identical for every clip; each frame only gets a translation:
 * pelvis x onto the guide axis, sole y onto the ground line (or the template ground line for airborne frames). No frame is
 * ever fitted to a height of its own: a die collapse or a raised sword keeps its anatomical size and is flagged instead.
 * Resampling is bilinear on premultiplied colour.
 */
import { createImage, type Image } from '@vgtd/rig';
import type { RegistrationEvidence } from './inherited-registration.js';
import { measureFigure } from './master.js';
import { toPremultiplied, type Straight } from './raster.js';
import { CELL_PX, type Guides, type MasterMetrics } from './types.js';
import { resampleAffine, validateResample, type ResampleMethod } from './resample.js';

/** Median of a list (lower median for even counts); NaN for empty. */
export function median(v: readonly number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

/** The character-global calibration: how raw frame px map to canvas px, for every clip. */
export interface Calibration {
  /** Raw px -> canvas px. */
  readonly scale: number;
  /** Figure height of the upright master in canvas px. */
  readonly targetHeight: number;
  /** Median raw height of the reference frames the scale came from. */
  readonly referenceHeight: number;
  /** Number of reference frames. */
  readonly referenceFrames: number;
}

/**
 * Calibrate: target figure height (the master's, canvas px) over the median raw height of the reference frames (the
 * upright locomotion frames, never die / hit). Calibrate ONCE per character and reuse the result for all clips.
 */
export function calibrate(targetHeight: number, referenceHeights: readonly number[]): Calibration {
  const good = referenceHeights.filter((h) => h > 0);
  const m = median(good);
  if (!(m > 0)) throw new RangeError('calibrate: no reference frame height');
  return { scale: targetHeight / m, targetHeight, referenceHeight: m, referenceFrames: good.length };
}

export interface AlignOptions {
  readonly resample?: ResampleMethod;
  /** Native cropped pixels -> logical cropped pixels; composes DPI and calibration in one pass. */
  readonly sourceTransform?: {
    readonly scaleX: number;
    readonly scaleY: number;
    readonly dx: number;
    readonly dy: number;
  };
  /** Verified reference: source anchor converted into this frame's raw pixel units. */
  readonly referenceOrigin?: { readonly x: number; readonly y: number };
  /** The character calibration (same object for every frame of every clip). */
  readonly calibration: Calibration;
  readonly guides: Guides;
  readonly cell?: number;
  /**
   * `sole` (default): the lowest opaque row lands on the ground line. `keep`: the template ground line of the raw frame
   * (`groundY`) lands on the ground line, so jumps and other airborne frames keep their height above ground.
   */
  readonly vertical?: 'sole' | 'keep';
  /** Row of the template ground line in the raw frame (needed for `keep`). */
  readonly groundY?: number;
  /** Alpha threshold of the measurements. Default 128. */
  readonly alpha?: number;
  /** Documented pose exception ('die-collapse', 'raised-sword', ...): recorded, never rescaled. */
  readonly exception?: string;
}

/** Per-frame measurements recorded in the pipeline contract (canvas px unless noted). */
export interface FrameRecord {
  readonly inheritedRegistration?: RegistrationEvidence;
  readonly pre: { readonly height: number; readonly pelvisX: number; readonly soleY: number };
  readonly post: { readonly height: number; readonly pelvisX: number; readonly soleY: number };
  readonly dx: number;
  readonly dy: number;
  readonly exception?: string;
}

export interface AlignedFrame {
  /** Premultiplied, cell x cell. */
  readonly image: Image;
  readonly source: MasterMetrics;
  readonly metrics: MasterMetrics;
  readonly record: FrameRecord;
}

/** Bilinear sample of a premultiplied image; outside = transparent. */
function sample(img: Image, x: number, y: number, out: number[]): void {
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const px = x0 + i;
      const py = y0 + j;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      const o = (py * img.width + px) * 4;
      for (let k = 0; k < 4; k++) out[k]! += img.data[o + k]! * w;
    }
}

/** Scale by `s` about the source point (px, py) and place that point at (qx, qy) of a `size` square canvas. */
export function placeScaled(
  src: Image,
  s: number,
  px: number,
  py: number,
  qx: number,
  qy: number,
  size: number,
  resample: ResampleMethod = 'bilinear',
): Image {
  validateResample(resample);
  if (resample !== 'bilinear')
    return resampleAffine(src, size, size, { scaleX: s, scaleY: s, dx: qx - px * s, dy: qy - py * s }, resample);
  const out = createImage(size, size);
  const v = [0, 0, 0, 0];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      sample(src, (x + 0.5 - qx) / s + px, (y + 0.5 - qy) / s + py, v);
      const o = (y * size + x) * 4;
      out.data[o] = Math.round(v[0]!);
      out.data[o + 1] = Math.round(v[1]!);
      out.data[o + 2] = Math.round(v[2]!);
      out.data[o + 3] = Math.round(v[3]!);
    }
  return out;
}

/** Align one keyed frame (straight alpha, raw resolution) to the character canvas. Null when the frame is empty. */
export function alignFrame(frame: Straight, opts: AlignOptions): AlignedFrame | null {
  const cell = opts.cell ?? CELL_PX;
  const alpha = opts.alpha ?? 128;
  const scale = opts.calibration.scale;
  const src = toPremultiplied(frame);
  const native = measureFigure(src, alpha);
  if (!native) return null;
  const t = opts.sourceTransform;
  const m = t
    ? {
        ...native,
        left: native.left * t.scaleX + t.dx,
        right: native.right * t.scaleX + t.dx,
        top: native.top * t.scaleY + t.dy,
        bottom: native.bottom * t.scaleY + t.dy,
        width: native.width * t.scaleX,
        height: native.height * t.scaleY,
        pelvisX: native.pelvisX * t.scaleX + t.dx,
      }
    : native;
  const vertical = opts.vertical ?? 'sole';
  const refX = opts.referenceOrigin?.x ?? m.pelvisX;
  const refY = opts.referenceOrigin?.y ?? (vertical === 'sole' ? m.bottom : (opts.groundY ?? m.bottom));
  if (t && (!opts.resample || opts.resample === 'bilinear'))
    throw new Error('sourceTransform requires lanczos3 or area');
  const image = t
    ? resampleAffine(
        src,
        cell,
        cell,
        {
          scaleX: scale * t.scaleX,
          scaleY: scale * t.scaleY,
          dx: opts.guides.centerX - (refX - t.dx) * scale,
          dy: opts.guides.ground - (refY - t.dy) * scale,
        },
        opts.resample as Exclude<ResampleMethod, 'bilinear'>,
      )
    : placeScaled(src, scale, refX, refY, opts.guides.centerX, opts.guides.ground, cell, opts.resample);
  const metrics = measureFigure(image, alpha)!;
  const record: FrameRecord = {
    pre: { height: m.height * scale, pelvisX: m.pelvisX * scale, soleY: m.bottom * scale },
    post: { height: metrics.height, pelvisX: metrics.pelvisX, soleY: metrics.bottom },
    dx: opts.guides.centerX - refX * scale,
    dy: opts.guides.ground - refY * scale,
    ...(opts.exception ? { exception: opts.exception } : {}),
  };
  return { image, source: m, metrics, record };
}
