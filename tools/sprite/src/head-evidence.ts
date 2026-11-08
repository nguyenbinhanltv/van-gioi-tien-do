/** Reviewed skull landmarks; no automatic detector or per-frame rescaling. */
import type { Finding, QaClip, QaOptions } from './qa.js';
import type { Direction } from '@vgtd/shared';
import type { Image } from '@vgtd/rig';
import type { BracketedOcclusionEvidence, BracketedMeasurement } from './bracketed-occlusion.js';
import type { ClipRelativeProxyEvidence, ClipRelativeMeasurement } from './clip-relative-proxy.js';

export type HeightPolicy = 'head-size-v1';

/** D54: these reasons describe head measurements, never D41 similarity exemptions. */
export function isHeadEvidenceReason(reason: string): boolean {
  const canonical = reason.trim().toLowerCase();
  return (
    canonical === 'posture' ||
    canonical === 'secondary-overhang' ||
    canonical === 'bracketed' ||
    canonical === 'bracketed-occlusion' ||
    canonical === 'clip-relative' ||
    canonical === 'clip-relative-proxy' ||
    canonical.startsWith('rear-')
  );
}

export interface HeadPoint {
  readonly x: number;
  readonly y: number;
}
export interface SkullBreadth {
  readonly left: HeadPoint;
  readonly right: HeadPoint;
}
export type HeadEvidenceKind =
  | 'crown-chin'
  | 'rear-skull-base'
  | 'rear-crown-shoulder'
  | 'rear-base-ornament'
  | 'rear-crown-shoulder-single'
  | 'rear-span-only'
  | 'bracketed-occlusion'
  | 'clip-relative-proxy'
  | 'rear-breadth-only';
/** D59: a real occluder hides a skull-breadth endpoint on master and frame. */
export interface RearSpanOnlyLandmarks {
  readonly kind: 'rear-span-only';
  readonly breadth?: never;
  readonly crown: HeadPoint;
  readonly skullBase: HeadPoint;
  readonly occludedSide: 'left' | 'right';
  readonly occluder: string;
}
export interface FrontHeadLandmarks {
  readonly kind?: 'crown-chin';
  readonly crown: HeadPoint;
  readonly chin: HeadPoint;
  readonly breadth?: SkullBreadth;
}
export interface RearHeadLandmarks {
  readonly kind: 'rear-skull-base';
  readonly crown: HeadPoint;
  /** Visible occipital head/neck junction or nape hairline; never a projected chin. */
  readonly skullBase: HeadPoint;
  readonly breadth: SkullBreadth;
}
export interface RearShoulderLandmarks {
  readonly kind: 'rear-crown-shoulder';
  readonly crown: HeadPoint;
  /** Visible shoulder-top endpoints; never an inferred hidden skull-base point. */
  readonly shoulderTop: { readonly left: HeadPoint; readonly right: HeadPoint };
  readonly breadth: SkullBreadth;
}
export interface RearSingleShoulderLandmarks {
  readonly kind: 'rear-crown-shoulder-single';
  readonly crown: HeadPoint;
  /** The one visible shoulder top; never add a projected point for the occluded side. */
  readonly shoulderTop: HeadPoint;
  readonly breadth: SkullBreadth;
  readonly occludedSide: 'left' | 'right';
  /** Concrete approved-master occluder: fan, hair or ribbon; a generic hidden/unknown reason is invalid. */
  readonly occluder: string;
}
export interface RearOrnamentLandmarks {
  readonly kind: 'rear-base-ornament';
  /** Lowest visible point where a fixed rigid head ornament meets hair; never a projected crown. */
  readonly ornamentAnchor: HeadPoint;
  /** One reviewed anchor definition, copied unchanged from this direction's locked master. */
  readonly anchorDefinition: string;
  readonly skullBase: HeadPoint;
  readonly breadth: SkullBreadth;
}
export type HeadLandmarks =
  | FrontHeadLandmarks
  | RearHeadLandmarks
  | RearShoulderLandmarks
  | RearOrnamentLandmarks
  | RearSingleShoulderLandmarks
  | RearSpanOnlyLandmarks
  | RearBreadthMasterLandmarks;
/** D56-master: no visible nape or acromion on the approved NE/N master. */
export interface RearBreadthMasterLandmarks {
  readonly kind: 'rear-breadth-only';
  readonly crown: HeadPoint;
  readonly breadth: SkullBreadth;
  readonly occlusions: {
    readonly nape: string;
    readonly leftShoulder: string;
    readonly rightShoulder: string;
  };
}
/** D56 frame evidence; a D53 master still requires a declared dynamic lean. */
export interface RearBreadthOnlyLandmarks {
  readonly kind: 'rear-breadth-only';
  readonly crown: HeadPoint;
  readonly breadth: SkullBreadth;
  /** Mandatory for D53-based dynamic leans; optional with an occluded D56-master reference. */
  readonly occluder?: string;
}
export type HeadEvidence = (
  | Exclude<HeadLandmarks, RearBreadthMasterLandmarks>
  | RearBreadthOnlyLandmarks
  | BracketedOcclusionEvidence
  | ClipRelativeProxyEvidence
) & {
  readonly note: string;
};
export interface HeadMeasurement {
  readonly kind?: HeadEvidenceKind;
  readonly direction?: Direction;
  readonly masterBreadthPx?: number;
  readonly breadthPx?: number;
  readonly breadthRatio?: number;
  readonly bracketed?: BracketedMeasurement;
  readonly clipRelative?: ClipRelativeMeasurement;
  readonly reason: string;
  readonly master: HeadLandmarks;
  readonly frame: HeadEvidence;
  /** Absent for D56/D60: no vertical/span measurement was made. */
  readonly masterSizePx?: number;
  readonly sizePx?: number;
  readonly ratio?: number;
  readonly masterBboxHeightPx: number;
  readonly bboxHeightPx: number;
}

export const headEvidenceKind = (
  head: HeadLandmarks | RearBreadthOnlyLandmarks | BracketedOcclusionEvidence | ClipRelativeProxyEvidence,
): HeadEvidenceKind => head.kind ?? 'crown-chin';
export function headLandmarkStart(head: HeadLandmarks): HeadPoint {
  return head.kind === 'rear-base-ornament' ? head.ornamentAnchor : head.crown;
}
export function headLandmarkEnd(head: HeadLandmarks): HeadPoint {
  if (head.kind === 'rear-breadth-only') throw new Error('breadth-only evidence has no vertical endpoint');
  if (head.kind === 'rear-skull-base' || head.kind === 'rear-base-ornament' || head.kind === 'rear-span-only')
    return head.skullBase;
  if (head.kind === 'rear-crown-shoulder-single') return head.shoulderTop;
  if (head.kind === 'rear-crown-shoulder')
    return {
      x: (head.shoulderTop.left.x + head.shoulderTop.right.x) / 2,
      y: (head.shoulderTop.left.y + head.shoulderTop.right.y) / 2,
    };
  return head.chin;
}
const validPoint = (p: HeadPoint | undefined, width: number, height: number) =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
const concreteOccluder = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && !/^(hidden|unknown|occluded|none|n\/a)$/i.test(value.trim());
const opaque = (raster: Image, point: HeadPoint) =>
  validPoint(point, raster.width, raster.height) &&
  Math.round(point.x) < raster.width &&
  Math.round(point.y) < raster.height &&
  raster.data[(Math.round(point.y) * raster.width + Math.round(point.x)) * 4 + 3]! >= 128;

/** Pixel visibility is verified here; solid-cap colour/contour semantics require source review. */
export function validRearBreadthMaster(head: RearBreadthMasterLandmarks, image: Image): boolean {
  const occlusions = head.occlusions;
  return !!(
    occlusions &&
    concreteOccluder(occlusions.nape) &&
    concreteOccluder(occlusions.leftShoulder) &&
    concreteOccluder(occlusions.rightShoulder) &&
    !('skullBase' in head || 'chin' in head || 'shoulderTop' in head || 'ornamentAnchor' in head) &&
    headLandmarkBreadth(head, image.width, image.height) !== null &&
    head.breadth.left.x < head.breadth.right.x &&
    head.breadth.left.y === head.breadth.right.y &&
    opaque(image, head.crown) &&
    opaque(image, head.breadth.left) &&
    opaque(image, head.breadth.right)
  );
}
export function headLandmarkBreadth(
  head: HeadLandmarks | RearBreadthOnlyLandmarks,
  width: number,
  height: number,
): number | null {
  const b = 'breadth' in head ? head.breadth : undefined;
  if (!b || !validPoint(b.left, width, height) || !validPoint(b.right, width, height)) return null;
  const size = Math.hypot(b.left.x - b.right.x, b.left.y - b.right.y);
  return size > 0 ? size : null;
}
export function headLandmarkSize(head: HeadLandmarks | undefined, width: number, height: number): number | null {
  if (
    !head ||
    ![
      'crown-chin',
      'rear-skull-base',
      'rear-crown-shoulder',
      'rear-crown-shoulder-single',
      'rear-base-ornament',
      'rear-span-only',
    ].includes(headEvidenceKind(head))
  )
    return null;
  if (head.kind !== undefined && head.kind !== 'crown-chin' && 'chin' in head) return null;
  if (
    head.kind === 'rear-span-only' &&
    ('breadth' in head ||
      'shoulderTop' in head ||
      'ornamentAnchor' in head ||
      !['left', 'right'].includes(head.occludedSide) ||
      typeof head.occluder !== 'string' ||
      !head.occluder.trim() ||
      /^(hidden|unknown|occluded|none|n\/a)$/i.test(head.occluder.trim()))
  )
    return null;
  if (head.kind === 'rear-crown-shoulder-single') {
    if (
      'skullBase' in head ||
      'ornamentAnchor' in head ||
      !['left', 'right'].includes(head.occludedSide) ||
      typeof head.occluder !== 'string' ||
      !/\b(?:fan|hair|ribbon)\b/i.test(head.occluder) ||
      !validPoint(head.shoulderTop, width, height)
    )
      return null;
  }
  if (
    head.kind === 'rear-base-ornament' &&
    ('crown' in head ||
      'shoulderTop' in head ||
      typeof head.anchorDefinition !== 'string' ||
      !head.anchorDefinition.trim())
  )
    return null;
  if (head.kind === 'rear-crown-shoulder') {
    const line = head.shoulderTop;
    if (
      'skullBase' in head ||
      !line ||
      !validPoint(line.left, width, height) ||
      !validPoint(line.right, width, height) ||
      Math.hypot(line.left.x - line.right.x, line.left.y - line.right.y) === 0
    )
      return null;
  }
  const start = headLandmarkStart(head),
    end = headLandmarkEnd(head);
  if (!validPoint(start, width, height) || !validPoint(end, width, height)) return null;
  if (
    (head.kind === 'rear-skull-base' ||
      head.kind === 'rear-crown-shoulder' ||
      head.kind === 'rear-crown-shoulder-single' ||
      head.kind === 'rear-base-ornament' ||
      ('breadth' in head && head.breadth !== undefined)) &&
    headLandmarkBreadth(head, width, height) === null
  )
    return null;
  if (head.kind === 'rear-crown-shoulder-single') {
    const midlineX = (head.breadth.left.x + head.breadth.right.x) / 2;
    if (head.occludedSide === 'left' ? head.shoulderTop.x <= midlineX : head.shoulderTop.x >= midlineX) return null;
    const breadth = headLandmarkBreadth(head, width, height)!,
      offset = Math.abs(head.shoulderTop.x - midlineX);
    if (offset < breadth * 0.25 || offset > breadth * 1.25) return null;
  }
  const size =
    head.kind === 'rear-crown-shoulder-single' ? end.y - head.crown.y : Math.hypot(start.x - end.x, start.y - end.y);
  return size > 0 ? size : null;
}

/** null delegates to legacy bbox handling. Supplied evidence is checked even outside the opt-in upright policy. */
export function checkHeadEvidence(
  clip: QaClip,
  options: QaOptions,
  frame: number,
  inBand: boolean,
  tolerance: number,
): Finding[] | null {
  const governed = clip.heightPolicy === 'head-size-v1' && clip.kind === 'upright';
  const evidence = clip.headEvidence?.[frame];
  const supplied = Object.prototype.hasOwnProperty.call(clip.headEvidence ?? {}, frame);
  const reason = clip.exceptions?.[frame];
  if (!governed && !supplied) return null;
  const failure = (metric: string, message: string, value = 1, limit = 0): Finding[] => [
    { gate: 'height', severity: 'fail', clip: clip.name, frame, metric, value, limit, message },
  ];
  if (governed && reason !== undefined && !['posture', 'secondary-overhang'].includes(reason))
    return failure(
      'head_exception_invalid',
      `upright height exception '${reason}' is invalid; use posture or secondary-overhang with head-size evidence`,
    );
  if (supplied && !evidence) return failure('head_evidence_invalid', 'head evidence cannot be null');
  if (!evidence)
    return governed && (!inBand || reason !== undefined)
      ? failure(
          'head_evidence_missing',
          'upright height exception/out-of-band cell needs same-direction head landmarks and a reviewed note',
        )
      : [];
  const image = clip.frames[frame]?.image;
  if (evidence.kind === 'bracketed-occlusion')
    return failure(
      'head_bracket_unresolved',
      'bracketed evidence requires the full clip-level neighbour/budget/quality check',
    );
  if (evidence.kind === 'clip-relative-proxy')
    return failure(
      'head_proxy_unresolved',
      'clip-relative proxy evidence requires the full clip-level certified-cell check',
    );
  if (evidence.kind === 'rear-breadth-only') {
    if (!['NE', 'N'].includes(clip.direction ?? 'E'))
      return failure('head_evidence_direction', 'breadth-only evidence requires a same-direction NE/N master');
    const master = options.masterHead;
    const breadthMaster = master?.kind === 'rear-breadth-only';
    if (
      !breadthMaster &&
      (!['dash', 'run', 'attack', 'attack_2', 'attack_3'].includes(clip.name) || reason !== 'posture')
    )
      return failure(
        'head_evidence_scope',
        'breadth-only evidence requires a dynamic dash/run/attack lean declared posture',
      );
    const breadth = image ? headLandmarkBreadth(evidence, image.width, image.height) : null;
    const masterBreadth = master ? headLandmarkBreadth(master, options.master.width, options.master.height) : null;
    if (
      !image ||
      !master ||
      masterBreadth === null ||
      breadth === null ||
      (breadthMaster &&
        (evidence.breadth.left.x >= evidence.breadth.right.x ||
          evidence.breadth.left.y !== evidence.breadth.right.y)) ||
      (breadthMaster
        ? !validRearBreadthMaster(master, options.master)
        : master.kind !== 'rear-crown-shoulder-single' ||
          headLandmarkSize(master, options.master.width, options.master.height) === null) ||
      'shoulderTop' in evidence ||
      'chin' in evidence ||
      'skullBase' in evidence ||
      'ornamentAnchor' in evidence ||
      ((!breadthMaster || evidence.occluder !== undefined) && !concreteOccluder(evidence.occluder)) ||
      typeof evidence.note !== 'string' ||
      !evidence.note.trim() ||
      !opaque(image, evidence.crown) ||
      !opaque(image, evidence.breadth.left) ||
      !opaque(image, evidence.breadth.right) ||
      !opaque(options.master, master.breadth!.left) ||
      !opaque(options.master, master.breadth!.right)
    )
      return failure(
        'head_evidence_invalid',
        'breadth-only evidence needs visible alpha>=128 crown/skull endpoints, locked master breadth, concrete shoulder occluder and reviewed hair-only note; no hidden anchor',
      );
    if (governed && !inBand && !reason)
      return failure(
        'head_exception_missing',
        'out-of-band bbox needs an explicit posture or secondary-overhang reason',
      );
    const low = masterBreadth * (1 - tolerance),
      high = masterBreadth * (1 + tolerance);
    if (breadth < low || breadth > high)
      return failure(
        'skull_breadth_px',
        `skull breadth ${breadth.toFixed(2)} px differs from master ${masterBreadth.toFixed(2)} px; ${evidence.note}`,
        breadth,
        breadth < low ? low : high,
      );
    const bboxHeight = clip.frames[frame]!.metrics.height;
    return [
      {
        gate: 'height',
        severity: 'info',
        clip: clip.name,
        frame,
        metric: 'skull_breadth_px',
        value: breadth,
        limit: high,
        message: `${reason ?? 'in-band'}: rear-breadth-only skull breadth ${breadth.toFixed(2)} / master ${masterBreadth.toFixed(2)} px; crown visible; ${evidence.occluder ? `shoulder hidden by ${evidence.occluder}` : 'occluded D56-master breadth reference'}; no vertical span; ${evidence.note}`,
        headEvidence: {
          kind: 'rear-breadth-only',
          direction: clip.direction,
          reason: reason ?? 'in-band',
          master,
          frame: evidence,
          masterBreadthPx: masterBreadth,
          breadthPx: breadth,
          breadthRatio: breadth / masterBreadth,
          masterBboxHeightPx: options.masterHeight,
          bboxHeightPx: bboxHeight,
        },
      },
    ];
  }
  const mixedSpan = options.masterHead?.kind === 'rear-span-only' && evidence.kind === 'rear-skull-base';
  if (options.masterHead && headEvidenceKind(evidence) !== headEvidenceKind(options.masterHead) && !mixedSpan)
    return failure('head_evidence_kind', 'master/frame must use the same skull measurement kind');
  if (evidence.kind === 'rear-base-ornament' && clip.direction !== 'N')
    return failure('head_evidence_direction', 'rear ornament evidence is allowed only for N locked masters');
  if (
    evidence.kind === 'rear-crown-shoulder-single' &&
    options.masterHead?.kind === 'rear-crown-shoulder-single' &&
    evidence.occludedSide !== options.masterHead.occludedSide
  )
    return failure('head_evidence_occluded_side', 'master/frame must declare the same occluded shoulder side');
  if (
    (evidence.kind === 'rear-skull-base' ||
      evidence.kind === 'rear-span-only' ||
      evidence.kind === 'rear-crown-shoulder' ||
      evidence.kind === 'rear-crown-shoulder-single') &&
    !['NE', 'N'].includes(clip.direction ?? 'E')
  )
    return failure('head_evidence_direction', 'rear skull evidence is allowed only for NE/N locked masters');
  const masterSize = headLandmarkSize(options.masterHead, options.master.width, options.master.height);
  const size = image ? headLandmarkSize(evidence, image.width, image.height) : null;
  if (masterSize === null || size === null || typeof evidence.note !== 'string' || !evidence.note.trim())
    return failure(
      'head_evidence_invalid',
      'head evidence needs matching valid master/frame skull landmarks, required rear breadth and a reviewed note',
    );
  if (
    evidence.kind === 'rear-span-only' &&
    options.masterHead?.kind === 'rear-span-only' &&
    (evidence.occludedSide !== options.masterHead.occludedSide ||
      evidence.occluder.trim() !== options.masterHead.occluder.trim())
  )
    return failure(
      'head_evidence_occluder',
      'master/frame must retain the same hidden breadth side and concrete occluder',
    );
  if (
    evidence.kind === 'rear-base-ornament' &&
    options.masterHead?.kind === 'rear-base-ornament' &&
    evidence.anchorDefinition.trim() !== options.masterHead.anchorDefinition.trim()
  )
    return failure('head_anchor_definition', 'frame must retain the locked master rigid-ornament anchor definition');
  const low = masterSize * (1 - tolerance),
    high = masterSize * (1 + tolerance);
  if (size < low || size > high)
    return failure(
      'head_size_px',
      `skull ${headEvidenceKind(evidence)} ${size.toFixed(2)} px outside ${low.toFixed(2)}..${high.toFixed(2)} (master ${masterSize.toFixed(2)}); ${evidence.note}`,
      size,
      size < low ? low : high,
    );
  const masterBreadth = headLandmarkBreadth(options.masterHead!, options.master.width, options.master.height);
  const breadth = image ? headLandmarkBreadth(evidence, image.width, image.height) : null;
  if (mixedSpan && image && evidence.kind === 'rear-skull-base') {
    const top = Math.min(evidence.crown.y, evidence.skullBase.y),
      bottom = Math.max(evidence.crown.y, evidence.skullBase.y);
    const centerX = (evidence.crown.x + evidence.skullBase.x) / 2;
    const visibleInHead = (p: HeadPoint) => {
      const x = Math.round(p.x),
        y = Math.round(p.y);
      return (
        x >= 0 &&
        y >= 0 &&
        x < image.width &&
        y < image.height &&
        p.y >= top &&
        p.y <= bottom &&
        Math.abs(p.x - centerX) <= size &&
        image.data[(y * image.width + x) * 4 + 3]! >= 128
      );
    };
    if (!visibleInHead(evidence.breadth.left) || !visibleInHead(evidence.breadth.right))
      return failure(
        'head_breadth_invalid',
        'D48 frame paired with D59 master needs visible breadth endpoints within the reviewed head region',
      );
  }
  if (
    !mixedSpan &&
    (('breadth' in options.masterHead! && options.masterHead!.breadth !== undefined) ||
      ('breadth' in evidence && evidence.breadth !== undefined)) &&
    (masterBreadth === null || breadth === null)
  )
    return failure(
      'head_breadth_invalid',
      'skull breadth must be measured on both the same-direction master and frame',
    );
  if (
    masterBreadth !== null &&
    breadth !== null &&
    (breadth < masterBreadth * (1 - tolerance) || breadth > masterBreadth * (1 + tolerance))
  )
    return failure(
      'skull_breadth_px',
      `skull breadth ${breadth.toFixed(2)} px differs from master ${masterBreadth.toFixed(2)} px; ${evidence.note}`,
      breadth,
      breadth < masterBreadth ? masterBreadth * (1 - tolerance) : masterBreadth * (1 + tolerance),
    );
  if (governed && !inBand && !reason)
    return failure(
      'head_exception_missing',
      'out-of-band bbox with stable head size still needs an explicit posture or secondary-overhang reason',
    );
  const bboxHeight = clip.frames[frame]!.metrics.height;
  return [
    {
      gate: 'height',
      severity: 'info',
      clip: clip.name,
      frame,
      metric: 'head_size_px',
      value: size,
      limit: high,
      message: `${reason ?? 'in-band'}: ${headEvidenceKind(evidence)} skull ${size.toFixed(2)} px / master ${masterSize.toFixed(2)} px${breadth !== null ? (masterBreadth !== null ? `; breadth ${breadth.toFixed(2)} / master ${masterBreadth.toFixed(2)} px` : `; visible frame breadth ${breadth.toFixed(2)} px (master occluded; no ratio)`) : ''}; bbox ${bboxHeight} px / master ${options.masterHeight} px; ${evidence.note}`,
      headEvidence: {
        kind: headEvidenceKind(evidence),
        direction: clip.direction ?? 'E',
        ...(masterBreadth !== null && breadth !== null
          ? { masterBreadthPx: masterBreadth, breadthPx: breadth, breadthRatio: breadth / masterBreadth }
          : mixedSpan && breadth !== null
            ? { breadthPx: breadth }
            : {}),
        reason: reason ?? 'in-band',
        master: options.masterHead!,
        frame: evidence,
        masterSizePx: masterSize,
        sizePx: size,
        ratio: size / masterSize,
        masterBboxHeightPx: options.masterHeight,
        bboxHeightPx: bboxHeight,
      },
    },
  ];
}
