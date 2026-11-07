/** Reviewed skull landmarks; no automatic detector or per-frame rescaling. */
import type { Finding, QaClip, QaOptions } from './qa.js';
import type { Direction } from '@vgtd/shared';

export type HeightPolicy = 'head-size-v1';
export interface HeadPoint {
  readonly x: number;
  readonly y: number;
}
export interface SkullBreadth {
  readonly left: HeadPoint;
  readonly right: HeadPoint;
}
export type HeadEvidenceKind = 'crown-chin' | 'rear-skull-base' | 'rear-crown-shoulder';
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
export type HeadLandmarks = FrontHeadLandmarks | RearHeadLandmarks | RearShoulderLandmarks;
export type HeadEvidence = HeadLandmarks & { readonly note: string };
export interface HeadMeasurement {
  readonly kind?: HeadEvidenceKind;
  readonly direction?: Direction;
  readonly masterBreadthPx?: number;
  readonly breadthPx?: number;
  readonly breadthRatio?: number;
  readonly reason: string;
  readonly master: HeadLandmarks;
  readonly frame: HeadEvidence;
  readonly masterSizePx: number;
  readonly sizePx: number;
  readonly ratio: number;
  readonly masterBboxHeightPx: number;
  readonly bboxHeightPx: number;
}

export const headEvidenceKind = (head: HeadLandmarks): HeadEvidenceKind => head.kind ?? 'crown-chin';
export function headLandmarkEnd(head: HeadLandmarks): HeadPoint {
  if (head.kind === 'rear-skull-base') return head.skullBase;
  if (head.kind === 'rear-crown-shoulder')
    return {
      x: (head.shoulderTop.left.x + head.shoulderTop.right.x) / 2,
      y: (head.shoulderTop.left.y + head.shoulderTop.right.y) / 2,
    };
  return head.chin;
}
const validPoint = (p: HeadPoint | undefined, width: number, height: number) =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
export function headLandmarkBreadth(head: HeadLandmarks, width: number, height: number): number | null {
  const b = head.breadth;
  if (!b || !validPoint(b.left, width, height) || !validPoint(b.right, width, height)) return null;
  const size = Math.hypot(b.left.x - b.right.x, b.left.y - b.right.y);
  return size > 0 ? size : null;
}
export function headLandmarkSize(head: HeadLandmarks | undefined, width: number, height: number): number | null {
  if (!head || !['crown-chin', 'rear-skull-base', 'rear-crown-shoulder'].includes(headEvidenceKind(head))) return null;
  if (head.kind !== undefined && head.kind !== 'crown-chin' && 'chin' in head) return null;
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
  const end = headLandmarkEnd(head);
  if (!validPoint(head.crown, width, height) || !validPoint(end, width, height)) return null;
  if (
    (head.kind === 'rear-skull-base' || head.kind === 'rear-crown-shoulder' || head.breadth !== undefined) &&
    headLandmarkBreadth(head, width, height) === null
  )
    return null;
  const size = Math.hypot(head.crown.x - end.x, head.crown.y - end.y);
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
          'upright height exception/out-of-band cell needs crown/chin head evidence and a reviewed note',
        )
      : [];
  const image = clip.frames[frame]?.image;
  if (options.masterHead && headEvidenceKind(evidence) !== headEvidenceKind(options.masterHead))
    return failure('head_evidence_kind', 'master/frame must use the same skull measurement kind');
  if (
    (evidence.kind === 'rear-skull-base' || evidence.kind === 'rear-crown-shoulder') &&
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
  if (
    (options.masterHead!.breadth !== undefined || evidence.breadth !== undefined) &&
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
      message: `${reason ?? 'in-band'}: ${headEvidenceKind(evidence)} skull ${size.toFixed(2)} px / master ${masterSize.toFixed(2)} px${breadth !== null ? `; breadth ${breadth.toFixed(2)} / master ${masterBreadth!.toFixed(2)} px` : ''}; bbox ${bboxHeight} px / master ${options.masterHeight} px; ${evidence.note}`,
      headEvidence: {
        kind: headEvidenceKind(evidence),
        direction: clip.direction ?? 'E',
        ...(masterBreadth !== null && breadth !== null
          ? { masterBreadthPx: masterBreadth, breadthPx: breadth, breadthRatio: breadth / masterBreadth }
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
