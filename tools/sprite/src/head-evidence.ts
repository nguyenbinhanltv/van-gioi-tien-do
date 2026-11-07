/** Reviewed skull landmarks; no automatic detector or per-frame rescaling. */
import type { Finding, QaClip, QaOptions } from './qa.js';

export type HeightPolicy = 'head-size-v1';
export interface HeadLandmarks {
  readonly crown: { readonly x: number; readonly y: number };
  readonly chin: { readonly x: number; readonly y: number };
}
export interface HeadEvidence extends HeadLandmarks {
  readonly note: string;
}
export interface HeadMeasurement {
  readonly reason: string;
  readonly master: HeadLandmarks;
  readonly frame: HeadEvidence;
  readonly masterSizePx: number;
  readonly sizePx: number;
  readonly ratio: number;
  readonly masterBboxHeightPx: number;
  readonly bboxHeightPx: number;
}

export function headLandmarkSize(head: HeadLandmarks | undefined, width: number, height: number): number | null {
  if (!head) return null;
  for (const p of [head.crown, head.chin])
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > width || p.y > height)
      return null;
  const size = Math.hypot(head.crown.x - head.chin.x, head.crown.y - head.chin.y);
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
  const masterSize = headLandmarkSize(options.masterHead, options.master.width, options.master.height);
  const size = image ? headLandmarkSize(evidence, image.width, image.height) : null;
  if (masterSize === null || size === null || typeof evidence.note !== 'string' || !evidence.note.trim())
    return failure(
      'head_evidence_invalid',
      'head evidence needs valid master/frame skull crown/chin landmarks in cell coordinates and a reviewed note',
    );
  const low = masterSize * (1 - tolerance),
    high = masterSize * (1 + tolerance);
  if (size < low || size > high)
    return failure(
      'head_size_px',
      `skull crown-to-chin ${size.toFixed(2)} px outside ${low.toFixed(2)}..${high.toFixed(2)} (master ${masterSize.toFixed(2)}); ${evidence.note}`,
      size,
      size < low ? low : high,
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
      message: `${reason ?? 'in-band'}: skull ${size.toFixed(2)} px / master ${masterSize.toFixed(2)} px; bbox ${bboxHeight} px / master ${options.masterHeight} px; ${evidence.note}`,
      headEvidence: {
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
