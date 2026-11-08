/** D55 diagnostic continuity; no per-pair threshold or pose exemption is invented here. */
import type { Image } from '@vgtd/rig';
import type { HeadLandmarks } from './head-evidence.js';
import { registeredNativeSsim } from './native-similarity.js';
/** D55 diagnostic floor; D60 alone requires both neighbour pairs to meet it. */
export const TEMPORAL_REVIEW_MIN = 0.45;
import {
  landmarkSimilarityRegions,
  legacySimilarityRegions,
  crownAnchoredSimilarityRegions,
  certifiedMasterSimilarityRegions,
  type SimilarityCropMeasurement,
  type SimilarityFrameHead,
} from './similarity-crops.js';

export function measureTemporalSimilarity(
  first: Image,
  second: Image,
  options: {
    masterHeight: number;
    master?: Image;
    masterHead?: HeadLandmarks;
    firstHead?: SimilarityFrameHead;
    secondHead?: SimilarityFrameHead;
  },
) {
  if (options.firstHead?.kind === 'bracketed-occlusion' || options.secondHead?.kind === 'bracketed-occlusion') {
    if (!options.master || !options.masterHead || !options.firstHead || !options.secondHead)
      throw new Error('D60 temporal comparison requires the certified master and both visible crowns');
    const reference = certifiedMasterSimilarityRegions(options.master, options.masterHead, options.masterHeight);
    const m = crownAnchoredSimilarityRegions(first, options.firstHead, reference, options.masterHeight);
    const f = crownAnchoredSimilarityRegions(second, options.secondHead, reference, options.masterHeight);
    const head = registeredNativeSsim(first, second, m.head, f.head),
      torso = registeredNativeSsim(first, second, m.torso, f.torso);
    const crops: SimilarityCropMeasurement = {
      method: 'landmarks',
      scorer: 'native-ssim',
      reason: 'D60 identical window-only crown construction on both temporal sides',
      master: m,
      frame: f,
      registration: { head: { dx: head.dx, dy: head.dy }, torso: { dx: torso.dx, dy: torso.dy } },
    };
    return { head: head.score, torso: torso.score, components: { head, torso }, crops };
  }
  const breadth = options.firstHead?.kind === 'rear-breadth-only' || options.secondHead?.kind === 'rear-breadth-only';
  const breadthMaster = options.masterHead?.kind === 'rear-breadth-only';
  const span =
    options.masterHead?.kind === 'rear-span-only' ||
    options.firstHead?.kind === 'rear-span-only' ||
    options.secondHead?.kind === 'rear-span-only';
  if (
    span &&
    [options.firstHead, options.secondHead].some(
      (h) => h && h.kind !== 'rear-span-only' && h.kind !== 'rear-skull-base',
    )
  )
    throw new Error('D59 temporal pair requires D59 or D48 on each annotated side');
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
        span
          ? 'rear-span-window'
          : breadthMaster
            ? 'rear-breadth-master-window'
            : breadth
              ? 'rear-breadth-window'
              : undefined,
      )
    : undefined;
  const b = options.secondHead
    ? landmarkSimilarityRegions(
        second,
        options.secondHead,
        options.masterHeight,
        span
          ? 'rear-span-window'
          : breadthMaster
            ? 'rear-breadth-master-window'
            : breadth
              ? 'rear-breadth-window'
              : undefined,
      )
    : undefined;
  if (a && b && (a.headKind !== b.headKind || (!breadth && !span && a.evidenceKind !== b.evidenceKind)))
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
