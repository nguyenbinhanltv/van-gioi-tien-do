/** D55 windows are measurement regions, never inferred anatomical evidence or frame edits. */
import type { Image } from '@vgtd/rig';
import { measureFigure } from './master.js';
import {
  headEvidenceKind,
  headLandmarkBreadth,
  headLandmarkEnd,
  headLandmarkSize,
  headLandmarkStart,
  type HeadLandmarks,
} from './head-evidence.js';

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
  readonly widthSource?: 'annotated-breadth' | 'head-length-window';
  readonly head: SimilarityBox;
  readonly torso: SimilarityBox;
}
export interface SimilarityCropMeasurement {
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

export function landmarkSimilarityRegions(image: Image, head: HeadLandmarks, masterHeight: number): SimilarityRegions {
  const length = headLandmarkSize(head, image.width, image.height);
  if (length === null || !Number.isFinite(masterHeight) || masterHeight <= 0)
    throw new Error('invalid annotated similarity landmarks/master height');
  const start = headLandmarkStart(head),
    end = headLandmarkEnd(head);
  const rear = head.kind !== undefined && head.kind !== 'crown-chin';
  const breadth = headLandmarkBreadth(head, image.width, image.height);
  if (rear && breadth === null) throw new Error('rear-head similarity requires annotated breadth');
  const width = breadth ?? length;
  const center = rear ? (head.breadth!.left.x + head.breadth!.right.x) / 2 : (start.x + end.x) / 2;
  const top = Math.min(start.y, end.y);
  const bottom =
    rear && head.kind !== 'rear-skull-base' && head.kind !== 'rear-base-ornament'
      ? Math.min(end.y, start.y + width)
      : Math.max(start.y, end.y);
  if (bottom <= top) throw new Error('annotated similarity head window has no vertical extent');
  const padX = (width * MARGIN) / 2,
    padY = ((bottom - top) * MARGIN) / 2;
  const headBox: SimilarityBox = {
    left: center - width / 2 - padX,
    top: top - padY,
    right: center + width / 2 + padX,
    bottom: bottom + padY,
  };
  const torsoX = rear ? center : end.x;
  return {
    method: 'landmarks',
    headKind: rear ? 'rear-head' : 'face',
    evidenceKind: headEvidenceKind(head),
    widthSource: breadth === null ? 'head-length-window' : 'annotated-breadth',
    head: headBox,
    torso: {
      left: torsoX - (masterHeight * TORSO_WIDTH) / 2,
      top: headBox.bottom,
      right: torsoX + (masterHeight * TORSO_WIDTH) / 2,
      bottom: headBox.bottom + masterHeight * TORSO_DEPTH,
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
  frameHead?: HeadLandmarks,
): SimilarityCropMeasurement {
  // Validate supplied points even if the other side is absent; never turn invalid evidence into a fallback.
  const m = masterHead ? landmarkSimilarityRegions(master, masterHead, masterHeight) : undefined;
  const f = frameHead ? landmarkSimilarityRegions(frame, frameHead, masterHeight) : undefined;
  if (m && f) {
    if (m.headKind !== f.headKind || m.evidenceKind !== f.evidenceKind)
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
