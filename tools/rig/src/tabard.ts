/**
 * Tabard weights (Thể tu): a panel that hangs from the shoulders to mid-thigh. `buildSkirtMesh` weights everything above
 * the hip joint to the hip bone, which is right for a skirt but wrong for a tabard: its chest part must follow the spine
 * (like the torso strip) or it tears from the torso when the body twists in a punch. `spineWeights` keeps the skirt's
 * thigh blend below the hip and replaces the part above it with a smooth hip -> spine_mid -> spine_upper ramp.
 */
import { applyMat } from './math.js';
import { evalPose } from './pose.js';
import type { LimbMesh } from './limb.js';
import type { RigDocument } from './schema.js';

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * Rewrite the weights of the vertices above the hip joint. `ramp` is the half length (px @1x) of the blend around the
 * spine_mid and spine_upper origins (the torso strip uses the same value, so both surfaces bend together).
 */
export function spineWeights(rig: RigDocument, mesh: LimbMesh, slotBone: string, ramp = 6): LimbMesh {
  const { hips, spine_mid: mid, spine_upper: up } = rig.roles;
  if (!hips || !mid || !up || mesh.attachment.type !== 'mesh') return mesh;
  const rest = evalPose(rig, null, 0, { noIk: true });
  const pose = (n: string) => rest.byName.get(n)!;
  const hipY = pose(hips).pos.y;
  const yMid = pose(mid).pos.y;
  const yUp = pose(up).pos.y;
  const world = pose(slotBone).world;
  const r = Math.max(0.5, Math.min(ramp, (yUp - yMid) / 2.2, (yMid - hipY) / 2.2));
  const att = mesh.attachment;
  const weights = att.weights!.map((w, i) => {
    const p = applyMat(world, { x: att.vertices[i * 2]!, y: att.vertices[i * 2 + 1]! });
    if (p.y <= hipY) return w;
    const h1 = smooth((p.y - (yMid - r)) / (2 * r));
    const h2 = smooth((p.y - (yUp - r)) / (2 * r));
    const out: [string, number][] = [];
    // below the hip the skirt blend already includes the hip bone; at / above it the spine ramp takes over
    for (const [bone, v] of [
      [hips, 1 - h1],
      [mid, h1 - h2],
      [up, h2],
    ] as const)
      if (v > 1e-3) out.push([bone, v]);
    const sum = out.reduce((a, b) => a + b[1], 0);
    return out.map(([b, v]): [string, number] => [b, Math.round((v / sum) * 1e4) / 1e4]);
  });
  return { ...mesh, attachment: { ...att, weights } };
}
