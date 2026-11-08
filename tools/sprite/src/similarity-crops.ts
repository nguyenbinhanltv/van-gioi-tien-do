/** D55 windows are measurement regions, never inferred anatomical evidence or frame edits. */
import type { Image } from '@vgtd/rig';
import { measureFigure } from './master.js';
import type { BracketedOcclusionEvidence } from './bracketed-occlusion.js';
import type { ClipRelativeProxyEvidence } from './clip-relative-proxy.js';
import {
  headEvidenceKind,
  headLandmarkBreadth,
  headLandmarkEnd,
  headLandmarkSize,
  headLandmarkStart,
  validRearBreadthMaster,
  type HeadLandmarks,
  type RearBreadthOnlyLandmarks,
} from './head-evidence.js';
export type SimilarityFrameHead =
  HeadLandmarks | RearBreadthOnlyLandmarks | BracketedOcclusionEvidence | ClipRelativeProxyEvidence;
/** D60/D61: window-only crown-anchored comparison, no inferred anatomy. */
export const isCrownOnlyHead = (head: SimilarityFrameHead | undefined): boolean =>
  head?.kind === 'bracketed-occlusion' || head?.kind === 'clip-relative-proxy';

export interface SimilarityBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
export interface SimilarityRegions {
  readonly method: 'landmarks' | 'centroid-fallback';
  readonly headKind: 'face' | 'rear-head' | 'legacy-face';
  readonly evidenceKind?: string;
  readonly widthSource?: 'annotated-breadth' | 'head-length-window' | 'master-head-window';
  readonly cropRule?:
    'annotated-endpoints' | 'rear-breadth-window' | 'rear-span-window' | 'crown-anchored-master-window';
  readonly head: SimilarityBox;
  readonly torso: SimilarityBox;
}
export interface SimilarityCropMeasurement {
  readonly scorer?: 'legacy-block-l1' | 'native-ssim' | 'lab-palette';
  readonly registration?: {
    readonly head: { readonly dx: number; readonly dy: number };
    readonly torso: { readonly dx: number; readonly dy: number };
  };
  readonly method: SimilarityRegions['method'];
  readonly reason?: string;
  readonly master: SimilarityRegions;
  readonly frame: SimilarityRegions;
}
const MARGIN = 0.08; // Total expansion per dimension: 4% at each edge (owner-approved D55).
const TORSO_DEPTH = 0.25;
const TORSO_WIDTH = 0.44;

export function legacySimilarityRegions(image: Image): SimilarityRegions | null {
  const m = measureFigure(image);
  if (!m) return null;
  const half = m.height * 0.22;
  const box = (a: number, b: number): SimilarityBox => ({
    left: Math.round(m.pelvisX - half),
    top: Math.round(m.top + a * m.height),
    right: Math.round(m.pelvisX + half),
    bottom: Math.round(m.top + b * m.height),
  });
  return { method: 'centroid-fallback', headKind: 'legacy-face', head: box(0, 0.2), torso: box(0.3, 0.55) };
}

export function landmarkSimilarityRegions(
  image: Image,
  head: SimilarityFrameHead,
  masterHeight: number,
  rule?: 'rear-breadth-window' | 'rear-span-window' | 'rear-breadth-master-window',
): SimilarityRegions {
  if (head.kind === 'bracketed-occlusion' || head.kind === 'clip-relative-proxy')
    throw new Error('D60/D61 crown-only window requires the certified master window');
  const length =
    head.kind === 'rear-breadth-only'
      ? headLandmarkBreadth(head, image.width, image.height)
      : headLandmarkSize(head, image.width, image.height);
  if (length === null || !Number.isFinite(masterHeight) || masterHeight <= 0)
    throw new Error('invalid annotated similarity landmarks/master height');
  const start = head.kind === 'rear-breadth-only' ? head.crown : headLandmarkStart(head),
    end = head.kind === 'rear-breadth-only' ? undefined : headLandmarkEnd(head);
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    start.x < 0 ||
    start.y < 0 ||
    start.x > image.width ||
    start.y > image.height
  )
    throw new Error('invalid similarity top anchor');
  const breadthOnly =
    head.kind === 'rear-breadth-only' || rule === 'rear-breadth-window' || rule === 'rear-breadth-master-window';
  const spanOnly = head.kind === 'rear-span-only' || rule === 'rear-span-window';
  if (spanOnly && head.kind !== 'rear-span-only' && head.kind !== 'rear-skull-base')
    throw new Error('D59 window requires crown-to-nape evidence');
  const rear = head.kind !== undefined && head.kind !== 'crown-chin';
  const breadth = headLandmarkBreadth(head, image.width, image.height);
  if (rear && !spanOnly && breadth === null) throw new Error('rear-head similarity requires annotated breadth');
  const width = spanOnly ? length : (breadth ?? length);
  const center = rear && !spanOnly ? (head.breadth!.left.x + head.breadth!.right.x) / 2 : (start.x + end!.x) / 2;
  const top = spanOnly ? (start.y + end!.y - length) / 2 : breadthOnly ? start.y : Math.min(start.y, end!.y);
  const bottom = spanOnly
    ? top + length
    : breadthOnly
      ? start.y + width
      : rear && head.kind !== 'rear-skull-base' && head.kind !== 'rear-base-ornament'
        ? Math.min(end!.y, start.y + width)
        : Math.max(start.y, end!.y);
  if (bottom <= top) throw new Error('annotated similarity head window has no vertical extent');
  const padX = (width * MARGIN) / 2,
    padY = rule === 'rear-breadth-master-window' ? 0 : ((bottom - top) * MARGIN) / 2;
  const headBox: SimilarityBox = {
    left: center - width / 2 - padX,
    top: top - padY,
    right: center + width / 2 + padX,
    bottom: bottom + padY,
  };
  const torsoX = rear ? center : end!.x;
  return {
    method: 'landmarks',
    headKind: rear ? 'rear-head' : 'face',
    evidenceKind: headEvidenceKind(head),
    cropRule: spanOnly ? 'rear-span-window' : breadthOnly ? 'rear-breadth-window' : 'annotated-endpoints',
    widthSource: spanOnly || breadth === null ? 'head-length-window' : 'annotated-breadth',
    head: headBox,
    torso: {
      left: torsoX - (masterHeight * TORSO_WIDTH) / 2,
      top: headBox.bottom,
      right: torsoX + (masterHeight * TORSO_WIDTH) / 2,
      bottom: headBox.bottom + masterHeight * TORSO_DEPTH,
    },
  };
}

/** The certified master's own D55 window, including its kind-specific padding policy. */
export function certifiedMasterSimilarityRegions(
  master: Image,
  head: HeadLandmarks,
  masterHeight: number,
): SimilarityRegions {
  if (head.kind === 'rear-breadth-only' && !validRearBreadthMaster(head, master))
    throw new Error('invalid D56-master occlusions/visible cap landmarks');
  return landmarkSimilarityRegions(
    master,
    head,
    masterHeight,
    head.kind === 'rear-breadth-only' ? 'rear-breadth-master-window' : undefined,
  );
}

/** Window-only D60 rule; no inferred chin, nape, breadth or measured size is created. */
export function crownAnchoredSimilarityRegions(
  image: Image,
  evidence: SimilarityFrameHead,
  reference: SimilarityRegions,
  masterHeight: number,
): SimilarityRegions {
  if (!('crown' in evidence)) throw new Error('D60 comparison needs a visible crown, not an ornament substitute');
  const p = evidence.crown;
  if (
    !p ||
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    p.x < 0 ||
    p.y < 0 ||
    Math.round(p.x) >= image.width ||
    Math.round(p.y) >= image.height ||
    image.data[(Math.round(p.y) * image.width + Math.round(p.x)) * 4 + 3]! < 128
  )
    throw new Error('D60 comparison crown is not visible inside the image');
  const width = reference.head.right - reference.head.left,
    height = reference.head.bottom - reference.head.top;
  if (
    reference.method !== 'landmarks' ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(masterHeight) ||
    masterHeight <= 0
  )
    throw new Error('D60 requires a certified nonempty master head window');
  // D60 window-only offset: Hwindow*0.08/(2*1.08); never infer a frame head height.
  const top = p.y - ((height / (1 + MARGIN)) * MARGIN) / 2;
  const head = { left: p.x - width / 2, top, right: p.x + width / 2, bottom: top + height };
  return {
    method: 'landmarks',
    headKind: reference.headKind,
    evidenceKind: headEvidenceKind(evidence),
    widthSource: 'master-head-window',
    cropRule: 'crown-anchored-master-window',
    head,
    torso: {
      left: p.x - (masterHeight * TORSO_WIDTH) / 2,
      right: p.x + (masterHeight * TORSO_WIDTH) / 2,
      top: head.bottom,
      bottom: head.bottom + masterHeight * TORSO_DEPTH,
    },
  };
}

/** Same 8x8 premultiplied means as D41; only the D55 window coordinates change. */
export function similarityBlockMeans(img: Image, box: SimilarityBox): number[] {
  const out: number[] = [];
  const w = Math.max(1, box.right - box.left),
    h = Math.max(1, box.bottom - box.top);
  for (let gy = 0; gy < 8; gy++)
    for (let gx = 0; gx < 8; gx++) {
      const sums = [0, 0, 0, 0];
      let n = 0;
      for (let y = Math.floor(box.top + (gy * h) / 8); y < Math.floor(box.top + ((gy + 1) * h) / 8); y++)
        for (let x = Math.floor(box.left + (gx * w) / 8); x < Math.floor(box.left + ((gx + 1) * w) / 8); x++) {
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          const o = (y * img.width + x) * 4;
          for (let k = 0; k < 4; k++) sums[k]! += img.data[o + k]!;
          n++;
        }
      for (let k = 0; k < 4; k++) out.push(n ? sums[k]! / n : 0);
    }
  return out;
}

export function similarityRegionsForPair(
  master: Image,
  frame: Image,
  masterHeight: number,
  masterHead?: HeadLandmarks,
  frameHead?: SimilarityFrameHead,
): SimilarityCropMeasurement {
  if (frameHead?.kind === 'bracketed-occlusion' || frameHead?.kind === 'clip-relative-proxy') {
    if (!masterHead) throw new Error('D60 Lab comparison requires certified master evidence');
    const reference = certifiedMasterSimilarityRegions(master, masterHead, masterHeight);
    return {
      method: 'landmarks',
      reason: 'D60/D61 window-only crown anchors; certified master window dimensions',
      master: crownAnchoredSimilarityRegions(master, masterHead, reference, masterHeight),
      frame: crownAnchoredSimilarityRegions(frame, frameHead, reference, masterHeight),
    };
  }
  // Validate supplied points even if the other side is absent; never turn invalid evidence into a fallback.
  const breadthOnlyPair = frameHead?.kind === 'rear-breadth-only';
  const spanPair = masterHead?.kind === 'rear-span-only';
  const breadthMasterPair = masterHead?.kind === 'rear-breadth-only';
  if (spanPair && frameHead && frameHead.kind !== 'rear-span-only' && frameHead.kind !== 'rear-skull-base')
    throw new Error('D59 similarity requires a D59 or D48 frame');
  if (masterHead?.kind === 'rear-breadth-only' && !validRearBreadthMaster(masterHead, master))
    throw new Error('invalid D56-master occlusions/visible cap landmarks');
  if (masterHead?.kind === 'rear-breadth-only' && frameHead && !breadthOnlyPair)
    throw new Error('D56-master similarity requires a breadth-only frame');
  if (
    breadthOnlyPair &&
    masterHead &&
    masterHead.kind !== 'rear-crown-shoulder-single' &&
    masterHead.kind !== 'rear-breadth-only'
  )
    throw new Error('D56 similarity requires a locked D53 or D56-master');
  const m = masterHead
    ? landmarkSimilarityRegions(
        master,
        masterHead,
        masterHeight,
        spanPair
          ? 'rear-span-window'
          : breadthMasterPair
            ? 'rear-breadth-master-window'
            : breadthOnlyPair
              ? 'rear-breadth-window'
              : undefined,
      )
    : undefined;
  const f = frameHead
    ? landmarkSimilarityRegions(
        frame,
        frameHead,
        masterHeight,
        spanPair ? 'rear-span-window' : breadthMasterPair ? 'rear-breadth-master-window' : undefined,
      )
    : undefined;
  if (m && f) {
    if (
      m.headKind !== f.headKind ||
      (!breadthOnlyPair && !spanPair && m.evidenceKind !== f.evidenceKind) ||
      (breadthOnlyPair && m.cropRule !== f.cropRule)
    )
      throw new Error('similarity requires the same master/frame head kind');
    return { method: 'landmarks', master: m, frame: f };
  }
  const legacyMaster = legacySimilarityRegions(master),
    legacyFrame = legacySimilarityRegions(frame);
  if (!legacyMaster || !legacyFrame) throw new Error('empty master/frame for similarity');
  return {
    method: 'centroid-fallback',
    reason: !m && !f ? 'master and frame landmarks absent' : !m ? 'master landmarks absent' : 'frame landmarks absent',
    master: legacyMaster,
    frame: legacyFrame,
  };
}
