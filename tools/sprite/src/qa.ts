/**
 * QA gates of the sprite pipeline (D41). Every gate returns plain findings; `ok` of a report is "no failing finding".
 *   height      figure height of the aligned frames vs the master (upright clips +-3 %; anatomical clips need a declared
 *               exception, never a silent relaxation)
 *   footSlide   a planted foot follows the ground speed (no slide) over its contact frames
 *   loopSeam    last -> first frame step of a looping clip is no bigger than a normal step
 *   similarity  face and torso of every frame still look like the master
 *   present     every expected frame exists and is not empty
 */
import type { OriginMeasurement } from './authored-origin.js';
import { checkBracketedOcclusion } from './bracketed-occlusion.js';
import { checkClipRelativeProxy, type HeadProxyConfig } from './clip-relative-proxy.js';
import type { Image } from '@vgtd/rig';
import type { Direction } from '@vgtd/shared';
import { registeredNativeSsim, type RegisteredSsim } from './native-similarity.js';
import { labPaletteDistance, HEAD_PALETTE_LAB_MAX, TORSO_PALETTE_LAB_MAX } from './palette-similarity.js';
import { measureTemporalSimilarity, TEMPORAL_REVIEW_MIN } from './temporal-similarity.js';
import { facingGroundVector } from './gait.js';
import {
  legacySimilarityRegions,
  similarityBlockMeans,
  similarityRegionsForPair,
  type SimilarityCropMeasurement,
  type SimilarityFrameHead,
} from './similarity-crops.js';
import type { AlignedFrame } from './align.js';
import type { CellSpec, Guides } from './types.js';
import {
  checkHeadEvidence,
  isHeadEvidenceReason,
  type HeadEvidence,
  type HeadLandmarks,
  type HeadMeasurement,
  type HeightPolicy,
} from './head-evidence.js';

export type Severity = 'fail' | 'warn' | 'info';

export interface Finding {
  readonly similarityCrop?: SimilarityCropMeasurement;
  readonly originEvidence?: OriginMeasurement;
  readonly headEvidence?: HeadMeasurement;
  readonly gate:
    | 'height'
    | 'footSlide'
    | 'loopSeam'
    | 'similarity'
    | 'present'
    | 'poseLock'
    | 'faceLock'
    | 'canvasLoss'
    | 'authoredOrigin'
    | 'weaponExtraction'
    | 'handAlignment';
  readonly severity: Severity;
  readonly clip: string;
  readonly frame?: number;
  readonly message: string;
  /** Measured quantity of the finding (soft findings are matched and tracked by it): name, value and the limit it broke. */
  readonly metric?: string;
  readonly value?: number;
  readonly limit?: number;
  /** No automatic comparison was made; absence must not resolve an old metric baseline. */
  readonly measurement?: 'unmeasured';
}

export interface QaClip {
  readonly heightPolicy?: HeightPolicy;
  readonly headEvidence?: Readonly<Record<number, HeadEvidence>>;
  /** D61: clip-local cell -> declared y of the headband top edge (cell pixels), for the clip-relative proxy. */
  readonly headbandTopRows?: Readonly<Record<number, number>>;
  readonly name: string;
  /** Facing of the ground travel, default E for existing API callers. */
  readonly direction?: Direction;
  readonly loop: boolean;
  /** `upright`: every frame within the height tolerance; `free`: bending / airborne poses, exceptions must be declared. */
  readonly kind: 'upright' | 'free';
  /** Frames the table / project expects (cells in use). */
  readonly expectedFrames: number;
  /** Aligned frames in order (null = missing or empty). */
  readonly frames: readonly (AlignedFrame | null)[];
  /** Head reasons never exempt similarity; documented D41 pose reasons retain the legacy exemption on any kind. */
  readonly exceptions?: Readonly<Record<number, string>>;
  /** Template cells (leading leg, foot ghosts) of this clip, for the foot-slide gate. */
  readonly cells?: readonly CellSpec[];
  /** Expected sole travel of a planted foot per sheet frame (canvas px, the character walks in place). */
  readonly groundPxPerFrame?: number;
  readonly footSlideUnmeasuredReason?: string;
}

export interface QaOptions {
  readonly masterHead?: HeadLandmarks;
  /** D61 proxy definition (hair colour, head authoring crop). */
  readonly headProxy?: HeadProxyConfig;
  readonly masterHeight: number;
  readonly master: Image;
  readonly guides: Guides;
  /** Height tolerance, fraction. Default 0.03. */
  readonly heightTolerance?: number;
  /** Planted-foot slide tolerance, canvas px per frame. Default 3. */
  readonly slideTolerance?: number;
  /** A planted foot farther than this (px) from its template ghost is not measured and warned about. Default 20. */
  readonly maxGhostOffset?: number;
  /** Loop seam: allowed ratio of the seam step to the mean step. Default 2.5 (the viewer's gate). */
  readonly seamRatio?: number;
  /** Historical L1 diagnostic threshold, 0..1; no longer controls hard similarity (D55). */
  readonly minSimilarity?: number;
}

// ---------------------------------------------------------------------------------------------------------------- height

export function checkHeights(clip: QaClip, o: QaOptions): Finding[] {
  const tol = o.heightTolerance ?? 0.03;
  const lo = o.masterHeight * (1 - tol);
  const hi = o.masterHeight * (1 + tol);
  const out: Finding[] = [];
  for (const key of Object.keys(clip.headEvidence ?? {}))
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= clip.frames.length)
      out.push({
        gate: 'height',
        severity: 'fail',
        clip: clip.name,
        metric: 'head_evidence_index',
        value: 1,
        limit: 0,
        message: `head evidence cell '${key}' is not a valid clip-local frame`,
      });
  clip.frames.forEach((f, i) => {
    if (!f) return;
    const h = f.metrics.height;
    const inBand = h >= lo && h <= hi;
    const head =
      clip.headEvidence?.[i]?.kind === 'bracketed-occlusion'
        ? checkBracketedOcclusion(clip, o, i, tol)
        : clip.headEvidence?.[i]?.kind === 'clip-relative-proxy'
          ? checkClipRelativeProxy(clip, o, i, tol)
          : checkHeadEvidence(clip, o, i, inBand, tol);
    if (head !== null) {
      out.push(...head);
      if (
        (clip.heightPolicy === 'head-size-v1' && clip.kind === 'upright') ||
        head.some((finding) => finding.severity === 'fail')
      )
        return;
    }
    const exception = clip.exceptions?.[i];
    if (inBand) return;
    if (exception && !isHeadEvidenceReason(exception))
      out.push({
        gate: 'height',
        severity: 'info',
        clip: clip.name,
        frame: i,
        metric: 'height_excess_px',
        value: Math.round((h < lo ? lo - h : h - hi) * 10) / 10,
        limit: 0,
        message: `${h} px outside ${lo.toFixed(1)}..${hi.toFixed(1)} (declared exception: ${exception})`,
      });
    else if (clip.kind === 'upright')
      out.push({
        gate: 'height',
        severity: 'fail',
        clip: clip.name,
        frame: i,
        metric: 'height_excess_px',
        value: Math.round((h < lo ? lo - h : h - hi) * 10) / 10,
        limit: 0,
        message: `height ${h} px outside ${lo.toFixed(1)}..${hi.toFixed(1)} (master ${o.masterHeight} px +-${(tol * 100).toFixed(0)} %)`,
      });
    else
      out.push({
        gate: 'height',
        severity: 'warn',
        clip: clip.name,
        frame: i,
        metric: 'height_excess_px',
        value: Math.round((h < lo ? lo - h : h - hi) * 10) / 10,
        limit: 0,
        message: `height ${h} px outside the upright band and no pose exception declared`,
      });
  });
  return out;
}

// ------------------------------------------------------------------------------------------------------------- foot slide

/** A separate sole in the bottom rows of a frame: its centroid x and pixel count. */
export interface SoleRun {
  readonly x: number;
  readonly n: number;
}

/**
 * The separate soles (columns of opaque pixels in the bottom `rows` rows around the ground line, split by gaps of 3 or more
 * empty columns) inside [x0, x1], each with its own centroid, so two feet close together are never averaged into one.
 */
export function soleRuns(img: Image, ground: number, x0: number, x1: number, rows = 6): SoleRun[] {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(img.width - 1, Math.ceil(x1));
  const colN: number[] = [];
  for (let x = xa; x <= xb; x++) {
    let n = 0;
    for (let y = Math.max(0, Math.floor(ground - rows)); y <= Math.min(img.height - 1, Math.ceil(ground)); y++)
      if (img.data[(y * img.width + x) * 4 + 3]! >= 128) n++;
    colN.push(n);
  }
  const runs: SoleRun[] = [];
  let sx = 0;
  let n = 0;
  let gap = 0;
  const close = () => {
    if (n >= 4) runs.push({ x: sx / n, n });
    sx = 0;
    n = 0;
  };
  colN.forEach((c, i) => {
    if (c > 0) {
      sx += (xa + i) * c;
      n += c;
      gap = 0;
    } else if (++gap === 3) close();
  });
  close();
  return runs;
}

/** The sole nearest to `ghostX` within `window` px, with its signed offset from the ghost; null when no foot is there. */
export function nearestSole(
  img: Image,
  ground: number,
  ghostX: number,
  window = 40,
): { x: number; offset: number } | null {
  const runs = soleRuns(img, ground, ghostX - window, ghostX + window);
  if (!runs.length) return null;
  const best = runs.reduce((a, b) => (Math.abs(b.x - ghostX) < Math.abs(a.x - ghostX) ? b : a));
  return { x: best.x, offset: best.x - ghostX };
}

/** x of the sole of the foot near `ghostX` (nearest separate sole within `window`); null when none or farther than `maxOffset`. */
export function soleX(img: Image, ground: number, ghostX: number, window = 28, maxOffset = 20): number | null {
  const s = nearestSole(img, ground, ghostX, window);
  return s && Math.abs(s.offset) <= maxOffset ? s.x : null;
}

/** Nearest horizontal sole-bottom run in a 2D ghost window; y is the row below the opaque sole. */
export function nearestSole2D(
  img: Image,
  ghost: { x: number; y: number },
  window = 40,
): { x: number; y: number; offset: number } | null {
  const opaque = (x: number, y: number) =>
    x >= 0 && x < img.width && y >= 0 && y < img.height && img.data[(y * img.width + x) * 4 + 3]! >= 128;
  let best: { x: number; y: number; offset: number } | null = null;
  for (
    let y = Math.max(0, Math.floor(ghost.y - window));
    y <= Math.min(img.height - 1, Math.ceil(ghost.y + window));
    y++
  ) {
    let sx = 0,
      n = 0;
    const close = () => {
      if (n >= 4) {
        const x = sx / n;
        const offset = Math.hypot(x - ghost.x, y + 1 - ghost.y);
        if (offset <= window && (!best || offset < best.offset)) best = { x, y: y + 1, offset };
      }
      sx = 0;
      n = 0;
    };
    for (
      let x = Math.max(0, Math.floor(ghost.x - window));
      x <= Math.min(img.width - 1, Math.ceil(ghost.x + window));
      x++
    ) {
      if (opaque(x, y) && !opaque(x, y + 1)) {
        sx += x;
        n++;
      } else close();
    }
    close();
  }
  return best;
}

export function checkFootSlide(clip: QaClip, o: QaOptions): Finding[] {
  if (clip.footSlideUnmeasuredReason !== undefined) {
    if (!clip.footSlideUnmeasuredReason.trim()) throw new Error('foot-slide opt-out needs a reason');
    return [
      {
        gate: 'footSlide',
        severity: 'info',
        clip: clip.name,
        measurement: 'unmeasured',
        message: `Foot slide UNMEASURED: ${clip.footSlideUnmeasuredReason}`,
      },
    ];
  }
  if (!clip.cells || clip.groundPxPerFrame === undefined) return [];
  const tol = o.slideTolerance ?? 3;
  const maxOffset = o.maxGhostOffset ?? 20;
  const direction = clip.direction ?? 'E';
  const axis = facingGroundVector(direction);
  const out: Finding[] = [];
  for (const side of ['R', 'L'] as const) {
    const key = side === 'R' ? 'nearFoot' : 'farFoot';
    // consecutive planted spans
    let span: { frame: number; x: number; y: number }[] = [];
    const flush = () => {
      for (let k = 1; k < span.length; k++) {
        const a = span[k - 1]!;
        const b = span[k]!;
        const steps = b.frame - a.frame;
        // The planted foot travels backward along the same ground axis as the template ghosts.
        const along = (b.x - a.x) * axis.x + (b.y - a.y) * axis.y;
        const slide = Math.abs(along + clip.groundPxPerFrame! * steps) / steps;
        if (slide > tol)
          out.push({
            gate: 'footSlide',
            severity: 'fail',
            clip: clip.name,
            frame: b.frame,
            metric: `${direction === 'E' ? 'slide_px_per_frame' : 'slide_ground_px_per_frame'}_${side}`,
            value: Math.round(slide * 100) / 100,
            limit: tol,
            message: `${side} foot slides ${slide.toFixed(1)} px/frame between frames ${a.frame}-${b.frame} (limit ${tol})`,
          });
      }
      span = [];
    };
    clip.cells.forEach((c, i) => {
      const ghost = c[key];
      const f = clip.frames[i];
      if (!ghost?.planted || !f) return flush();
      const legacy = direction === 'E' ? nearestSole(f.image, o.guides.ground, ghost.x) : null;
      const near = direction === 'E' ? legacy && { ...legacy, y: o.guides.ground } : nearestSole2D(f.image, ghost);
      if (!near || Math.abs(near.offset) > maxOffset) {
        // do not stay silent: the drawing's planted foot is not where the template put it, so it cannot be judged
        out.push({
          gate: 'footSlide',
          severity: 'warn',
          clip: clip.name,
          frame: i,
          metric: `${direction === 'E' ? 'ghost_offset_px' : 'ghost_distance_2d_px'}_${side}`,
          value: near ? Math.round(Math.abs(near.offset) * 10) / 10 : 999,
          limit: maxOffset,
          message: near
            ? `${side} planted foot: nearest sole is ${near.offset.toFixed(1)} px from its template ghost (${direction === 'E' ? `x ${near.x.toFixed(1)} vs ${ghost.x.toFixed(1)}` : `xy ${near.x.toFixed(1)},${near.y.toFixed(1)} vs ${ghost.x.toFixed(1)},${ghost.y.toFixed(1)}`}, limit ${maxOffset}); not measured (the foot is not on the template)`
            : `${side} planted foot: no sole found within 40 px of its template ghost; not measured (the foot is not on the template)`,
        });
        return flush();
      }
      span.push({ frame: i, x: near.x, y: near.y });
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

/** 1 - normalised L1 distance of two block-mean vectors (1 = identical). */
export function blockSimilarity(a: readonly number[], b: readonly number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
  return 1 - d / (a.length * 255);
}

/** Scores independently of pose exemptions, for the D55 old/new diagnostic audit. */
export function measureSimilarity(
  master: Image,
  frame: Image,
  options: {
    masterHeight: number;
    masterHead?: HeadLandmarks;
    frameHead?: SimilarityFrameHead;
    mode?: 'landmarks' | 'legacy';
  },
): {
  head: number;
  torso: number;
  crops: SimilarityCropMeasurement;
  components?: { head: RegisteredSsim; torso: RegisteredSsim };
} {
  const crops =
    options.mode === 'legacy'
      ? (() => {
          const m = legacySimilarityRegions(master),
            f = legacySimilarityRegions(frame);
          if (!m || !f) throw new Error('empty master/frame for legacy similarity');
          return { method: 'centroid-fallback' as const, reason: 'D54 legacy comparison', master: m, frame: f };
        })()
      : similarityRegionsForPair(master, frame, options.masterHeight, options.masterHead, options.frameHead);
  const score = (region: 'head' | 'torso') => {
    const a = similarityBlockMeans(master, crops.master[region]),
      b = similarityBlockMeans(frame, crops.frame[region]);
    if (
      crops.method === 'landmarks' &&
      (!a.some((v, i) => i % 4 === 3 && v > 0) || !b.some((v, i) => i % 4 === 3 && v > 0))
    )
      throw new Error(`empty annotated ${region} similarity window`);
    return blockSimilarity(a, b);
  };
  if (options.mode === 'legacy')
    return { head: score('head'), torso: score('torso'), crops: { ...crops, scorer: 'legacy-block-l1' } };
  // Validate nonempty annotated regions before structural comparison; no invalid-evidence fallback.
  if (crops.method === 'landmarks') {
    score('head');
    score('torso');
  }
  const h = registeredNativeSsim(master, frame, crops.master.head, crops.frame.head),
    t = registeredNativeSsim(master, frame, crops.master.torso, crops.frame.torso);
  return {
    head: h.score,
    torso: t.score,
    components: { head: h, torso: t },
    crops: {
      ...crops,
      scorer: 'native-ssim',
      registration: { head: { dx: h.dx, dy: h.dy }, torso: { dx: t.dx, dy: t.dy } },
    },
  };
}

/** D54 changes only head reasons; a documented D41 pose may exempt the crop on any clip kind. */
export function isSimilarityExemptReason(reason: string | undefined): boolean {
  return reason !== undefined && reason.length > 0 && !isHeadEvidenceReason(reason);
}

export const SPRITE_SIMILARITY_MIN = 0.7;

/** D55: Lab palette is hard; legacy L1 and temporal continuity are diagnostic. */
export function checkSimilarity(clip: QaClip, o: QaOptions): Finding[] {
  if (!legacySimilarityRegions(o.master))
    return [
      {
        gate: 'similarity',
        severity: 'fail',
        clip: clip.name,
        metric: 'palette_unmeasured',
        message: 'Master image is empty; Lab identity cannot be measured',
      },
    ];
  const out: Finding[] = [];
  clip.frames.forEach((f, i) => {
    if (!f || isSimilarityExemptReason(clip.exceptions?.[i])) return;
    try {
      const crops: SimilarityCropMeasurement = {
        ...similarityRegionsForPair(o.master, f.image, o.masterHeight, o.masterHead, clip.headEvidence?.[i]),
        scorer: 'lab-palette',
      };
      const legacy = measureSimilarity(o.master, f.image, { masterHeight: o.masterHeight, mode: 'legacy' });
      out.push({
        gate: 'similarity',
        severity: 'info',
        clip: clip.name,
        frame: i,
        metric: 'legacy_l1_diagnostic',
        value: Math.min(legacy.head, legacy.torso),
        limit: o.minSimilarity ?? SPRITE_SIMILARITY_MIN,
        similarityCrop: crops,
        message: `diagnostic only: legacy L1 head ${legacy.head.toFixed(4)}, torso ${legacy.torso.toFixed(4)}; ${crops.method}${crops.reason ? ': ' + crops.reason : ''}`,
      });
      for (const [part, limit] of [
        ['head', HEAD_PALETTE_LAB_MAX],
        ['torso', TORSO_PALETTE_LAB_MAX],
      ] as const) {
        const palette = labPaletteDistance(o.master, f.image, crops.master[part], crops.frame[part]);
        if (palette.distance > limit)
          out.push({
            gate: 'similarity',
            severity: 'fail',
            clip: clip.name,
            frame: i,
            metric: `palette_${part}_lab`,
            value: palette.distance,
            limit,
            similarityCrop: crops,
            message: `${part === 'head' ? crops.frame.headKind : 'torso'} Lab palette distance ${palette.distance.toFixed(4)} > ${limit}`,
          });
      }
    } catch (error) {
      out.push({
        gate: 'similarity',
        severity: 'fail',
        clip: clip.name,
        frame: i,
        metric: 'palette_unmeasured',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return out;
}

/** D55: every low continuity pair is review-by-eye INFO, including approved D41 pose pairs. */
export function checkTemporalContinuity(clip: QaClip, o: QaOptions): Finding[] {
  const pairs = clip.frames.slice(1).map((_, i) => ({ from: i, to: i + 1, seam: false }));
  if (clip.loop && clip.frames.length > 1) pairs.push({ from: clip.frames.length - 1, to: 0, seam: true });
  const out: Finding[] = [];
  for (const pair of pairs) {
    const a = clip.frames[pair.from],
      b = clip.frames[pair.to];
    if (!a || !b) continue;
    try {
      const result = measureTemporalSimilarity(a.image, b.image, {
        masterHeight: o.masterHeight,
        master: o.master,
        ...(o.masterHead ? { masterHead: o.masterHead } : {}),
        ...(clip.headEvidence?.[pair.from] ? { firstHead: clip.headEvidence[pair.from] } : {}),
        ...(clip.headEvidence?.[pair.to] ? { secondHead: clip.headEvidence[pair.to] } : {}),
      });
      const value = Math.min(result.head, result.torso);
      if (value < TEMPORAL_REVIEW_MIN)
        out.push({
          gate: 'similarity',
          severity: 'info',
          clip: clip.name,
          frame: pair.to,
          metric: 'temporal_review_by_eye',
          value,
          limit: TEMPORAL_REVIEW_MIN,
          message: `review-by-eye: temporal ${pair.from}->${pair.to}${pair.seam ? ' loop seam' : ''}; head ${result.head.toFixed(4)}, torso ${result.torso.toFixed(4)}; ${result.crops.method}${isSimilarityExemptReason(clip.exceptions?.[pair.from]) || isSimilarityExemptReason(clip.exceptions?.[pair.to]) ? '; D41 pose pair' : ''}`,
        });
    } catch (error) {
      out.push({
        gate: 'similarity',
        severity: 'info',
        clip: clip.name,
        frame: pair.to,
        metric: 'temporal_unmeasured',
        message: `review-by-eye: temporal ${pair.from}->${pair.to} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
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

/** Project the original opaque bounds; post-crop height alone can falsely look valid after content was discarded. */
export function checkCanvasLoss(clip: QaClip): Finding[] {
  return clip.frames.flatMap((f, i) => {
    if (!f) return [];
    const scale = f.record.pre.height / f.source.height;
    if (![scale, f.record.dx, f.record.dy].every(Number.isFinite) || scale <= 0)
      return [
        {
          gate: 'canvasLoss' as const,
          severity: 'fail' as const,
          clip: clip.name,
          frame: i,
          metric: 'canvas_transform_invalid',
          value: 1,
          limit: 0,
          message: 'canvas-loss QA requires a valid fixed calibration and source alignment record',
        },
      ];
    const left = Math.max(0, -(f.source.left * scale + f.record.dx));
    const top = Math.max(0, -(f.source.top * scale + f.record.dy));
    const right = Math.max(0, f.source.right * scale + f.record.dx - f.image.width);
    const bottom = Math.max(0, f.source.bottom * scale + f.record.dy - f.image.height);
    const loss = Math.max(left, top, right, bottom);
    return loss > 1e-9
      ? [
          {
            gate: 'canvasLoss' as const,
            severity: 'fail' as const,
            clip: clip.name,
            frame: i,
            metric: 'canvas_loss_px',
            value: loss,
            limit: 0,
            message: `opaque source bounds leave the output canvas (left ${left.toFixed(2)}, top ${top.toFixed(2)}, right ${right.toFixed(2)}, bottom ${bottom.toFixed(2)} px); no pose/head exception can waive clipping`,
          },
        ]
      : [];
  });
}

/** Run every gate on every clip. */
export function runQa(clips: readonly QaClip[], o: QaOptions): QaReport {
  const findings = clips.flatMap((c) => [
    ...checkPresent(c),
    ...checkCanvasLoss(c),
    ...checkHeights(c, o),
    ...checkFootSlide(c, o),
    ...checkLoopSeam(c, o),
    ...checkSimilarity(c, o),
    ...checkTemporalContinuity(c, o),
  ]);
  return { ok: !findings.some((f) => f.severity === 'fail'), findings };
}
