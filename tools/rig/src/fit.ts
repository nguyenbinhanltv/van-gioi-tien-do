/**
 * Silhouette-aware fitting. On rigs made of rigid mesh islands (no soft weights) a limb swung past a certain angle opens
 * a gap at the joint and a piece tears away. Rather than ship such frames, scale the offending limb's animation down
 * (around its first key) until the silhouette is whole, trying the largest amplitude that works. The motion keeps its
 * timing and shape; only the extent is limited to what this rig's geometry can carry.
 */
import { amplify } from './principles.js';
import type { Clip } from './clip.js';
import { checkSilhouette, type SilhouetteOptions } from './render/silhouette.js';
import type { LoadedAtlas } from './render/render.js';
import type { RigDocument, BoneRole } from './schema.js';

/** Limb groups that can be tamed independently (rotation tracks of these roles are scaled together). */
const GROUPS: readonly (readonly BoneRole[])[] = [
  ['upper_arm_R', 'lower_arm_R', 'hand_R'],
  ['upper_arm_L', 'lower_arm_L', 'hand_L'],
  ['spine_mid', 'spine_upper'],
  ['thigh_L', 'shin_L', 'thigh_R', 'shin_R'],
];

function scaleGroup(rig: RigDocument, clip: Clip, roles: readonly BoneRole[], gain: number): Clip {
  const names = new Set(roles.map((r) => rig.roles[r]).filter((x): x is string => !!x));
  return {
    ...clip,
    bones: clip.bones.map((t) => (names.has(t.bone) && t.rotate ? { ...t, rotate: amplify(t.rotate, gain) } : t)),
  };
}

export interface FitResult {
  readonly clip: Clip;
  /** Gains applied per group (1 = untouched). */
  readonly gains: readonly number[];
  /** Silhouette is whole after fitting. */
  readonly ok: boolean;
}

export function fitToSilhouette(
  rig: RigDocument,
  clip: Clip,
  atlas: LoadedAtlas,
  opts: SilhouetteOptions & {
    readonly minGain?: number;
    /** Applied to every candidate before it is checked and returned (e.g. bake secondary motion). */
    readonly finalize?: (clip: Clip) => Clip;
  } = {},
): FitResult {
  const minGain = opts.minGain ?? 0.5;
  const gains = GROUPS.map(() => 1);
  let cur = clip;
  const finalize = opts.finalize ?? ((c: Clip) => c);
  const broken = (c: Clip) => checkSilhouette(rig, finalize(c), atlas, { minPixels: 20, ...opts }).length > 0;
  for (let round = 0; round < GROUPS.length * 2 && broken(cur); round++) {
    let improved = false;
    for (let g = 0; g < GROUPS.length && broken(cur); g++) {
      if (gains[g]! <= minGain) continue;
      // find the largest reduction step of this group that makes the clip whole; otherwise take a step anyway if it helps
      for (let step = 0.9; step >= 0.5 - 1e-9; step -= 0.1) {
        const next = scaleGroup(rig, cur, GROUPS[g]!, step);
        if (!broken(next)) {
          gains[g] = (gains[g] ?? 1) * step;
          cur = next;
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }
  return { clip: finalize(cur), gains, ok: !broken(cur) };
}
