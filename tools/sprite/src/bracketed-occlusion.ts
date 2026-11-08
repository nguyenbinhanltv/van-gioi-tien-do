/** D60 is an explicit unmeasured bridge, never a projected anatomical landmark. */
import type { HeadPoint } from './head-evidence.js';
import { checkHeadEvidence, headLandmarkSize, validRearBreadthMaster } from './head-evidence.js';
import type { Finding, QaClip, QaOptions } from './qa.js';
import { similarityRegionsForPair } from './similarity-crops.js';
import { labPaletteDistance, HEAD_PALETTE_LAB_MAX, TORSO_PALETTE_LAB_MAX } from './palette-similarity.js';
import { measureTemporalSimilarity, TEMPORAL_REVIEW_MIN } from './temporal-similarity.js';

export type HiddenHeadEndpoint =
  | 'chin'
  | 'skullBase'
  | 'breadth.left'
  | 'breadth.right'
  | 'shoulderTop'
  | 'shoulderTop.left'
  | 'shoulderTop.right'
  | 'ornamentAnchor';
export interface BracketedOcclusionEvidence {
  readonly kind: 'bracketed-occlusion';
  readonly crown: HeadPoint;
  readonly occluder: string;
  readonly hiddenEndpoints: readonly HiddenHeadEndpoint[];
}
export interface BracketedMeasurement {
  readonly neighbours: readonly [number, number];
  readonly bracketedCount: number;
  readonly totalFrames: number;
  readonly lab: { readonly head: number; readonly torso: number };
  readonly temporal: readonly {
    readonly from: number;
    readonly to: number;
    readonly head: number;
    readonly torso: number;
  }[];
}
export const BRACKETED_MAX_CELLS = 2;
const endpoints: readonly string[] = [
  'chin',
  'skullBase',
  'breadth.left',
  'breadth.right',
  'shoulderTop',
  'shoulderTop.left',
  'shoulderTop.right',
  'ornamentAnchor',
];
const dynamic = new Set(['dash', 'run', 'attack', 'attack_2', 'attack_3', 'hit']);
const isBracketed = (clip: QaClip, frame: number) => clip.headEvidence?.[frame]?.kind === 'bracketed-occlusion';

/** Validate metadata and direct measured neighbours before any expensive image comparisons. */
export function bracketedPreconditions(
  clip: QaClip,
  options: QaOptions,
  frame: number,
  tolerance: number,
): { readonly neighbours: readonly [number, number]; readonly count: number } | Finding[] {
  const failure = (metric: string, message: string): Finding[] => [
    { gate: 'height', severity: 'fail', clip: clip.name, frame, metric, message },
  ];
  const e = clip.headEvidence?.[frame];
  if (!e || e.kind !== 'bracketed-occlusion')
    return failure('head_bracket_invalid', 'missing bracketed-occlusion declaration');
  if (!dynamic.has(clip.name))
    return failure('head_bracket_scope', 'bracketed evidence is restricted to dynamic dash/run/attack/hit clips');
  const image = clip.frames[frame]?.image;
  const p = e.crown;
  if (
    !image ||
    !p ||
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    p.x < 0 ||
    p.y < 0 ||
    Math.round(p.x) >= image.width ||
    Math.round(p.y) >= image.height ||
    image.data[(Math.round(p.y) * image.width + Math.round(p.x)) * 4 + 3]! < 128
  )
    return failure('head_bracket_crown', 'bracketed crown must be a reviewed visible alpha>=128 source point');
  if (
    typeof e.occluder !== 'string' ||
    !e.occluder.trim() ||
    /^(hidden|unknown|occluded|none|n\/a)$/i.test(e.occluder.trim()) ||
    !Array.isArray(e.hiddenEndpoints) ||
    !e.hiddenEndpoints.length ||
    new Set(e.hiddenEndpoints).size !== e.hiddenEndpoints.length ||
    e.hiddenEndpoints.some((key) => !endpoints.includes(key)) ||
    typeof e.note !== 'string' ||
    !e.note.trim() ||
    ['chin', 'skullBase', 'breadth', 'shoulderTop', 'ornamentAnchor'].some((key) => key in e)
  )
    return failure(
      'head_bracket_invalid',
      'declare a concrete occluder, hidden endpoint list and reviewed note, without fabricated span/breadth endpoints',
    );
  const total = clip.frames.length;
  if (!Number.isSafeInteger(clip.expectedFrames) || total !== clip.expectedFrames || total < 1)
    return failure('head_bracket_frames', 'bracketing requires the complete declared clip frame count');
  const count = clip.frames.filter((_, i) => isBracketed(clip, i)).length;
  if (count > BRACKETED_MAX_CELLS)
    return failure('head_bracket_budget', `bracketed ${count}/${total} exceeds the two-cell clip cap`);
  if (!clip.loop && (frame === 0 || frame === total - 1))
    return failure('head_bracket_neighbours', 'a nonloop edge has no pair of temporal neighbours');
  const neighbours = [(frame + total - 1) % total, (frame + 1) % total] as const;
  if (
    !options.masterHead ||
    (options.masterHead.kind === 'rear-breadth-only'
      ? !validRearBreadthMaster(options.masterHead, options.master)
      : headLandmarkSize(options.masterHead, options.master.width, options.master.height) === null)
  )
    return failure('head_bracket_master', 'a valid measured locked master is required; masters cannot be bracketed');
  for (const neighbour of neighbours) {
    const f = clip.frames[neighbour],
      evidence = clip.headEvidence?.[neighbour];
    if (!f || !evidence || evidence.kind === 'bracketed-occlusion')
      return failure(
        'head_bracket_neighbours',
        'both immediate neighbours need certified measured evidence; no bracketed chain',
      );
    const inBand = Math.abs(f.metrics.height - options.masterHeight) <= options.masterHeight * tolerance;
    const findings = checkHeadEvidence(clip, options, neighbour, inBand, tolerance);
    if (
      !findings ||
      findings.some((finding) => finding.severity === 'fail') ||
      !findings.some((finding) => finding.headEvidence && finding.severity === 'info')
    )
      return failure('head_bracket_neighbours', 'both immediate neighbours must actually pass the measured head band');
  }
  return { neighbours, count };
}

/** Full D60 eligibility: D41 exemptions cannot skip these mandatory image checks. */
export function checkBracketedOcclusion(clip: QaClip, options: QaOptions, frame: number, tolerance: number): Finding[] {
  const preconditions = bracketedPreconditions(clip, options, frame, tolerance);
  if (Array.isArray(preconditions)) return preconditions;
  const evidence = clip.headEvidence![frame]!;
  const image = clip.frames[frame]!.image;
  const failure = (metric: string, message: string): Finding[] => [
    { gate: 'height', severity: 'fail', clip: clip.name, frame, metric, message },
  ];
  try {
    const crops = similarityRegionsForPair(options.master, image, options.masterHeight, options.masterHead, evidence);
    const head = labPaletteDistance(options.master, image, crops.master.head, crops.frame.head).distance;
    const torso = labPaletteDistance(options.master, image, crops.master.torso, crops.frame.torso).distance;
    if (!Number.isFinite(head) || !Number.isFinite(torso)) throw new Error('nonfinite Lab quality');
    if (head > HEAD_PALETTE_LAB_MAX || torso > TORSO_PALETTE_LAB_MAX)
      return failure(
        'head_bracket_palette',
        `bracketed Lab identity fails: head ${head.toFixed(4)}/${HEAD_PALETTE_LAB_MAX}, torso ${torso.toFixed(4)}/${TORSO_PALETTE_LAB_MAX}`,
      );
    const temporal = preconditions.neighbours.map((neighbour, side) => {
      const from = side === 0 ? neighbour : frame,
        to = side === 0 ? frame : neighbour;
      const result = measureTemporalSimilarity(clip.frames[from]!.image, clip.frames[to]!.image, {
        master: options.master,
        masterHead: options.masterHead,
        masterHeight: options.masterHeight,
        firstHead: clip.headEvidence![from],
        secondHead: clip.headEvidence![to],
      });
      return { from, to, head: result.head, torso: result.torso };
    });
    if (
      temporal.some(
        (pair) =>
          !Number.isFinite(pair.head) ||
          !Number.isFinite(pair.torso) ||
          Math.min(pair.head, pair.torso) < TEMPORAL_REVIEW_MIN,
      )
    )
      return failure(
        'head_bracket_temporal',
        `bracketed requires both crown-anchored temporal pairs >=${TEMPORAL_REVIEW_MIN}: ${temporal.map((p) => `${p.from}->${p.to} ${p.head.toFixed(4)}/${p.torso.toFixed(4)}`).join('; ')}`,
      );
    return [
      {
        gate: 'height',
        severity: 'info',
        clip: clip.name,
        frame,
        metric: 'head_bracketed',
        measurement: 'unmeasured',
        message: `bracketed (unmeasured): certified neighbours ${preconditions.neighbours.join(',')}; ${preconditions.count}/${clip.frames.length} bracketed cells; Lab ${head.toFixed(4)}/${torso.toFixed(4)}; no inferred span/breadth`,
        headEvidence: {
          kind: 'bracketed-occlusion',
          direction: clip.direction,
          reason: 'bracketed',
          master: options.masterHead!,
          frame: evidence,
          masterBboxHeightPx: options.masterHeight,
          bboxHeightPx: clip.frames[frame]!.metrics.height,
          bracketed: {
            neighbours: preconditions.neighbours,
            bracketedCount: preconditions.count,
            totalFrames: clip.frames.length,
            lab: { head, torso },
            temporal,
          },
        },
      },
    ];
  } catch (error) {
    return failure(
      'head_bracket_quality_unmeasured',
      `bracketed quality is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
