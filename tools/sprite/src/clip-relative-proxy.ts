/**
 * D61: clip-relative proxy head evidence for dynamic cells where no master-comparable head landmark is certifiable.
 * The proxy is the horizontal width of the solid hair cap on the row of the declared headband top edge. A cell passes
 * only if its proxy is within +-3 % of the mean proxy of the same clip's own certified cells. It is reported as INFO
 * "clip-relative", never as a measured master-band pass.
 */
import type { Image } from '@vgtd/rig';
import type { HeadPoint } from './head-evidence.js';
import { checkHeadEvidence, headLandmarkSize, validRearBreadthMaster } from './head-evidence.js';
import { DYNAMIC_HEAD_CLIPS, HIDDEN_HEAD_ENDPOINTS, type HiddenHeadEndpoint } from './bracketed-occlusion.js';
import type { Finding, QaClip, QaOptions } from './qa.js';
import { similarityRegionsForPair } from './similarity-crops.js';
import { labPaletteDistance, HEAD_PALETTE_LAB_MAX, TORSO_PALETTE_LAB_MAX } from './palette-similarity.js';
import { measureTemporalSimilarity, TEMPORAL_REVIEW_MIN } from './temporal-similarity.js';

export interface ClipRelativeProxyEvidence {
  readonly kind: 'clip-relative-proxy';
  readonly crown: HeadPoint;
  readonly occluder: string;
  readonly hiddenEndpoints: readonly HiddenHeadEndpoint[];
}
/** Per-project proxy definition. The crop is a fixed rectangle of cell pixels offset from the declared crown. */
export interface HeadProxyConfig {
  /** Hair colour, 0..255 per channel. */
  readonly hairRgb: readonly [number, number, number];
  /** Maximum Euclidean RGB distance from `hairRgb` for a hair pixel. */
  readonly hairTolerance: number;
  /** Head authoring crop: top-left at (crown.x + dx, crown.y + dy), integer size; must contain the crown and row. */
  readonly crop: { readonly dx: number; readonly dy: number; readonly width: number; readonly height: number };
}
export interface ClipRelativeMeasurement {
  readonly proxyPx: number;
  readonly certifiedMeanPx: number;
  readonly ratio: number;
  readonly certified: readonly { readonly cell: number; readonly proxyPx: number }[];
  readonly bracketed: boolean;
  readonly headbandTopY: number;
  readonly lab: { readonly head: number; readonly torso: number };
  readonly temporal: readonly {
    readonly from: number;
    readonly to: number;
    readonly head: number;
    readonly torso: number;
  }[];
}
export const CLIP_RELATIVE_TOLERANCE = 0.03;
export const CLIP_RELATIVE_MIN_CERTIFIED = 2;

const visible = (image: Image, p: HeadPoint | undefined): p is HeadPoint =>
  !!p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  p.x >= 0 &&
  p.y >= 0 &&
  Math.round(p.x) < image.width &&
  Math.round(p.y) < image.height &&
  image.data[(Math.round(p.y) * image.width + Math.round(p.x)) * 4 + 3]! >= 128;

/** 8-neighbour connected components in scan order; label 0 is background. */
function components(mask: Uint8Array, w: number, h: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(w * h);
  const sizes = [0];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const at = stack.pop()!;
      n++;
      const x = at % w,
        y = (at - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const to = ny * w + nx;
          if (mask[to] && !label[to]) {
            label[to] = id;
            stack.push(to);
          }
        }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

/**
 * Solid-cap width on the declared headband-top row. Deterministic: alpha>=128 hair-colour mask in the crop; the
 * component containing the crown BEFORE a radius-1 (3x3) opening; then the largest surviving component AFTER the
 * opening (ties: first in scan order). Width = horizontal extent of that component on the row. Throws on any
 * unmeasurable input; never guesses.
 */
export function measureHairCapWidth(
  image: Image,
  crown: HeadPoint,
  headbandTopY: number,
  config: HeadProxyConfig,
): number {
  const { dx, dy, width: w, height: h } = config.crop;
  if (![dx, dy, w, h].every(Number.isInteger) || w < 3 || h < 3) throw new Error('invalid proxy crop');
  if (!(config.hairTolerance >= 0) || config.hairRgb.length !== 3 || config.hairRgb.some((c) => !(c >= 0 && c <= 255)))
    throw new Error('invalid proxy hair colour');
  const cx = Math.round(crown.x),
    cy = Math.round(crown.y);
  const x0 = cx + dx,
    y0 = cy + dy;
  if (x0 < 0 || y0 < 0 || x0 + w > image.width || y0 + h > image.height)
    throw new Error('proxy head crop leaves the image');
  if (cx < x0 || cx >= x0 + w || cy < y0 || cy >= y0 + h) throw new Error('proxy head crop must contain the crown');
  if (!Number.isInteger(headbandTopY) || headbandTopY < y0 || headbandTopY >= y0 + h)
    throw new Error(`headband-top row ${headbandTopY} is outside the head crop rows ${y0}..${y0 + h - 1}`);
  const mask = new Uint8Array(w * h);
  const [hr, hg, hb] = config.hairRgb as readonly [number, number, number];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * image.width + x0 + x) * 4;
      if (image.data[i + 3]! < 128) continue;
      const d = Math.hypot(image.data[i]! - hr, image.data[i + 1]! - hg, image.data[i + 2]! - hb);
      if (d <= config.hairTolerance) mask[y * w + x] = 1;
    }
  const crownAt = (cy - y0) * w + (cx - x0);
  if (!mask[crownAt]) throw new Error('crown is not a hair-colour pixel inside the crop');
  const before = components(mask, w, h);
  const lineage = new Uint8Array(w * h);
  for (let i = 0; i < lineage.length; i++) lineage[i] = before.label[i] === before.label[crownAt] ? 1 : 0;
  // Opening, radius 1: erode (outside the crop counts as empty), then dilate.
  const at = (m: Uint8Array, x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x]! : 0);
  const eroded = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let j = -1; j <= 1 && all; j++) for (let i = -1; i <= 1; i++) if (!at(lineage, x + i, y + j)) all = 0;
      eroded[y * w + x] = all;
    }
  const opened = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let any = 0;
      for (let j = -1; j <= 1 && !any; j++) for (let i = -1; i <= 1; i++) if (at(eroded, x + i, y + j)) any = 1;
      opened[y * w + x] = any && lineage[y * w + x] ? 1 : 0;
    }
  const after = components(opened, w, h);
  let best = 0;
  for (let id = 1; id < after.sizes.length; id++) if (!best || after.sizes[id]! > after.sizes[best]!) best = id;
  if (!best) throw new Error('no solid hair cap survives the 3x3 opening');
  const row = headbandTopY - y0;
  let left = -1,
    right = -1;
  for (let x = 0; x < w; x++)
    if (after.label[row * w + x] === best) {
      if (left < 0) left = x;
      right = x;
    }
  if (left < 0) throw new Error('the solid hair cap does not reach the declared headband-top row');
  return right - left + 1;
}

/** Validate declarations before any image work. */
function preconditions(
  clip: QaClip,
  options: QaOptions,
  frame: number,
): { readonly neighbours: readonly [number, number] } | Finding[] {
  const failure = (metric: string, message: string): Finding[] => [
    { gate: 'height', severity: 'fail', clip: clip.name, frame, metric, message },
  ];
  const e = clip.headEvidence?.[frame];
  if (!e || e.kind !== 'clip-relative-proxy')
    return failure('head_proxy_invalid', 'missing clip-relative-proxy declaration');
  if (!DYNAMIC_HEAD_CLIPS.has(clip.name))
    return failure('head_proxy_scope', 'clip-relative proxy is restricted to dynamic dash/run/attack/hit clips');
  const image = clip.frames[frame]?.image;
  if (!image || !visible(image, e.crown))
    return failure('head_proxy_crown', 'proxy crown must be a reviewed visible alpha>=128 source point');
  if (
    typeof e.occluder !== 'string' ||
    !e.occluder.trim() ||
    /^(hidden|unknown|occluded|none|n\/a)$/i.test(e.occluder.trim()) ||
    !Array.isArray(e.hiddenEndpoints) ||
    !e.hiddenEndpoints.length ||
    new Set(e.hiddenEndpoints).size !== e.hiddenEndpoints.length ||
    e.hiddenEndpoints.some((key) => !HIDDEN_HEAD_ENDPOINTS.includes(key)) ||
    typeof e.note !== 'string' ||
    !e.note.trim() ||
    ['chin', 'skullBase', 'breadth', 'shoulderTop', 'ornamentAnchor'].some((key) => key in e)
  )
    return failure(
      'head_proxy_invalid',
      'declare a concrete occluder, hidden endpoint list and reviewed note, without fabricated landmarks',
    );
  if (!options.headProxy) return failure('head_proxy_config', 'the project declares no head proxy definition');
  if (clip.headbandTopRows?.[frame] === undefined)
    return failure('head_proxy_row', 'declare the headband-top row for this cell');
  const total = clip.frames.length;
  if (!Number.isSafeInteger(clip.expectedFrames) || total !== clip.expectedFrames || total < 1)
    return failure('head_proxy_frames', 'the proxy requires the complete declared clip frame count');
  if (!clip.loop && (frame === 0 || frame === total - 1))
    return failure('head_proxy_neighbours', 'a nonloop edge has no pair of temporal neighbours');
  if (
    !options.masterHead ||
    (options.masterHead.kind === 'rear-breadth-only'
      ? !validRearBreadthMaster(options.masterHead, options.master)
      : headLandmarkSize(options.masterHead, options.master.width, options.master.height) === null)
  )
    return failure('head_proxy_master', 'a valid measured locked master is required; masters cannot use the proxy');
  const neighbours = [(frame + total - 1) % total, (frame + 1) % total] as const;
  for (const n of neighbours) {
    const ne = clip.headEvidence?.[n];
    if (!clip.frames[n] || !ne || !('crown' in ne))
      return failure('head_proxy_neighbours', 'both immediate neighbours need a frame and a visible crown annotation');
  }
  return { neighbours };
}

/** Full D61 eligibility; D41 exemptions cannot skip these mandatory checks. */
export function checkClipRelativeProxy(clip: QaClip, options: QaOptions, frame: number, tolerance: number): Finding[] {
  const pre = preconditions(clip, options, frame);
  if (Array.isArray(pre)) return pre;
  const evidence = clip.headEvidence![frame]! as ClipRelativeProxyEvidence;
  const image = clip.frames[frame]!.image;
  const config = options.headProxy!;
  const failure = (metric: string, message: string): Finding[] => [
    { gate: 'height', severity: 'fail', clip: clip.name, frame, metric, message },
  ];
  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
  let proxyPx: number;
  try {
    proxyPx = measureHairCapWidth(image, evidence.crown, clip.headbandTopRows![frame]!, config);
  } catch (error) {
    return failure('head_proxy_unmeasured', `proxy unavailable: ${describe(error)}`);
  }
  // Certified cells: measured head evidence that passes the band against the master, with a declared proxy row.
  const certified: { cell: number; proxyPx: number }[] = [];
  clip.frames.forEach((f, cell) => {
    const e = clip.headEvidence?.[cell];
    const row = clip.headbandTopRows?.[cell];
    if (!f || cell === frame || !e || row === undefined || !('crown' in e)) return;
    if (e.kind === 'clip-relative-proxy' || e.kind === 'bracketed-occlusion') return;
    const inBand = Math.abs(f.metrics.height - options.masterHeight) <= options.masterHeight * tolerance;
    const findings = checkHeadEvidence(clip, options, cell, inBand, tolerance);
    if (
      !findings ||
      findings.some((x) => x.severity === 'fail') ||
      !findings.some((x) => x.headEvidence && x.severity === 'info')
    )
      return;
    try {
      certified.push({ cell, proxyPx: measureHairCapWidth(f.image, e.crown, row, config) });
    } catch {
      /* an unmeasurable certified cell does not count towards the reference */
    }
  });
  if (certified.length < CLIP_RELATIVE_MIN_CERTIFIED)
    return failure(
      'head_proxy_certified',
      `clip-relative proxy needs >=${CLIP_RELATIVE_MIN_CERTIFIED} certified cells with a measurable proxy in this clip, found ${certified.length}`,
    );
  const mean = certified.reduce((s, c) => s + c.proxyPx, 0) / certified.length;
  const ratio = proxyPx / mean;
  const bracketed = certified.some((c) => c.cell < frame) && certified.some((c) => c.cell > frame);
  let lab: { head: number; torso: number };
  try {
    const c = similarityRegionsForPair(options.master, image, options.masterHeight, options.masterHead, evidence);
    lab = {
      head: labPaletteDistance(options.master, image, c.master.head, c.frame.head).distance,
      torso: labPaletteDistance(options.master, image, c.master.torso, c.frame.torso).distance,
    };
    if (!Number.isFinite(lab.head) || !Number.isFinite(lab.torso)) throw new Error('nonfinite Lab quality');
  } catch (error) {
    return failure('head_proxy_quality_unmeasured', `proxy quality is unavailable: ${describe(error)}`);
  }
  if (lab.head > HEAD_PALETTE_LAB_MAX || lab.torso > TORSO_PALETTE_LAB_MAX)
    return failure(
      'head_proxy_palette',
      `clip-relative Lab identity fails: head ${lab.head.toFixed(4)}/${HEAD_PALETTE_LAB_MAX}, torso ${lab.torso.toFixed(4)}/${TORSO_PALETTE_LAB_MAX}`,
    );
  let temporal: { from: number; to: number; head: number; torso: number }[];
  try {
    temporal = pre.neighbours.map((neighbour, side) => {
      const from = side === 0 ? neighbour : frame,
        to = side === 0 ? frame : neighbour;
      const r = measureTemporalSimilarity(clip.frames[from]!.image, clip.frames[to]!.image, {
        master: options.master,
        masterHead: options.masterHead,
        masterHeight: options.masterHeight,
        firstHead: clip.headEvidence![from],
        secondHead: clip.headEvidence![to],
      });
      return { from, to, head: r.head, torso: r.torso };
    });
  } catch (error) {
    return failure('head_proxy_quality_unmeasured', `proxy temporal quality is unavailable: ${describe(error)}`);
  }
  if (
    temporal.some(
      (p) => !Number.isFinite(p.head) || !Number.isFinite(p.torso) || Math.min(p.head, p.torso) < TEMPORAL_REVIEW_MIN,
    )
  )
    return failure(
      'head_proxy_temporal',
      `clip-relative proxy requires both temporal pairs >=${TEMPORAL_REVIEW_MIN}: ${temporal.map((p) => `${p.from}->${p.to} ${p.head.toFixed(4)}/${p.torso.toFixed(4)}`).join('; ')}`,
    );
  if (Math.abs(ratio - 1) > CLIP_RELATIVE_TOLERANCE)
    return failure(
      'head_proxy_band',
      `hair-cap width ${proxyPx}px vs certified mean ${mean.toFixed(2)}px (ratio ${ratio.toFixed(4)}) is outside +-${CLIP_RELATIVE_TOLERANCE * 100}%`,
    );
  return [
    {
      gate: 'height',
      severity: 'info',
      clip: clip.name,
      frame,
      metric: 'head_clip_relative',
      measurement: 'unmeasured',
      message: `clip-relative (not a master-band pass): hair-cap width ${proxyPx}px vs mean ${mean.toFixed(2)}px of certified cells ${certified.map((c) => c.cell).join(',')} (ratio ${ratio.toFixed(4)}); ${bracketed ? 'bracketing' : 'non-bracketing'}; Lab ${lab.head.toFixed(4)}/${lab.torso.toFixed(4)}`,
      headEvidence: {
        kind: 'clip-relative-proxy',
        direction: clip.direction,
        reason: 'clip-relative',
        master: options.masterHead!,
        frame: evidence as never,
        masterBboxHeightPx: options.masterHeight,
        bboxHeightPx: clip.frames[frame]!.metrics.height,
        clipRelative: {
          proxyPx,
          certifiedMeanPx: mean,
          ratio,
          certified,
          bracketed,
          headbandTopY: clip.headbandTopRows![frame]!,
          lab,
          temporal,
        },
      },
    },
  ];
}
