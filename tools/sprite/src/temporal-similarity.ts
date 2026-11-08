/** D55 diagnostic continuity; no per-pair threshold or pose exemption is invented here. */
import type { Image } from '@vgtd/rig';
import { registeredNativeSsim } from './native-similarity.js';
/** D55 diagnostic review threshold, never a hard failure. */
export const TEMPORAL_REVIEW_MIN = 0.45;
import {
  landmarkSimilarityRegions,
  legacySimilarityRegions,
  type SimilarityCropMeasurement,
  type SimilarityFrameHead,
} from './similarity-crops.js';

export function measureTemporalSimilarity(
  first: Image,
  second: Image,
  options: {
    masterHeight: number;
    firstHead?: SimilarityFrameHead;
    secondHead?: SimilarityFrameHead;
  },
) {
  const breadth = options.firstHead?.kind === 'rear-breadth-only' || options.secondHead?.kind === 'rear-breadth-only';
  if (
    breadth &&
    [options.firstHead, options.secondHead].some(
      (h) => h && h.kind !== 'rear-breadth-only' && h.kind !== 'rear-crown-shoulder-single',
    )
  )
    throw new Error('D56 temporal pair requires D53 or D56 on each annotated side');
  const a = options.firstHead
    ? landmarkSimilarityRegions(
        first,
        options.firstHead,
        options.masterHeight,
        breadth ? 'rear-breadth-window' : undefined,
      )
    : undefined;
  const b = options.secondHead
    ? landmarkSimilarityRegions(
        second,
        options.secondHead,
        options.masterHeight,
        breadth ? 'rear-breadth-window' : undefined,
      )
    : undefined;
  if (a && b && (a.headKind !== b.headKind || (!breadth && a.evidenceKind !== b.evidenceKind)))
    throw new Error('temporal comparison requires the same head convention');
  const m = a && b ? a : legacySimilarityRegions(first);
  const f = a && b ? b : legacySimilarityRegions(second);
  if (!m || !f) throw new Error('empty temporal figure');
  const head = registeredNativeSsim(first, second, m.head, f.head);
  const torso = registeredNativeSsim(first, second, m.torso, f.torso);
  const crops: SimilarityCropMeasurement = {
    method: a && b ? 'landmarks' : 'centroid-fallback',
    scorer: 'native-ssim',
    master: m,
    frame: f,
    ...(!a || !b ? { reason: 'one or both consecutive frame landmarks absent' } : {}),
    registration: { head: { dx: head.dx, dy: head.dy }, torso: { dx: torso.dx, dy: torso.dy } },
  };
  return { head: head.score, torso: torso.score, components: { head, torso }, crops };
}
