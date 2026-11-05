/**
 * Attachment skinning: world-space vertices of a region or (weighted) mesh attachment in a pose. Shared by the renderer
 * and the mesh QA checks so both see exactly the same geometry.
 */
import { applyMat, invertMat, mulMat, type Vec2 } from './math.js';
import type { Pose } from './pose.js';
import type { RigAttachment } from './schema.js';

export interface SkinnedMesh {
  readonly verts: Vec2[];
  readonly uvs: Vec2[];
  readonly tris: readonly number[];
}

export function skinAttachment(a: RigAttachment, slotBone: string, pose: Pose, rest: Pose): SkinnedMesh {
  const slotPose = pose.byName.get(slotBone)!.world;
  if (a.type === 'region') {
    const hw = (a.width / 2) * (a.scaleX ?? 1);
    const hh = (a.height / 2) * (a.scaleY ?? 1);
    const r = ((a.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const corner = (x: number, y: number): Vec2 =>
      applyMat(slotPose, { x: a.x + x * cos - y * sin, y: a.y + x * sin + y * cos });
    return {
      verts: [corner(-hw, hh), corner(hw, hh), corner(hw, -hh), corner(-hw, -hh)],
      uvs: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      tris: [0, 1, 2, 0, 2, 3],
    };
  }
  const verts: Vec2[] = [];
  const uvs: Vec2[] = [];
  const restSlot = rest.byName.get(slotBone)!.world;
  for (let i = 0; i < a.vertices.length / 2; i++) {
    const local = { x: a.vertices[i * 2]!, y: a.vertices[i * 2 + 1]! };
    uvs.push({ x: a.uvs[i * 2]!, y: a.uvs[i * 2 + 1]! });
    const w = a.weights?.[i];
    if (!w) {
      verts.push(applyMat(slotPose, local));
      continue;
    }
    const world0 = applyMat(restSlot, local);
    let x = 0;
    let y = 0;
    for (const [bone, weight] of w) {
      const rb = rest.byName.get(bone)!.world;
      const pb = pose.byName.get(bone)!.world;
      const p = applyMat(mulMat(pb, invertMat(rb)), world0);
      x += p.x * weight;
      y += p.y * weight;
    }
    verts.push({ x, y });
  }
  return { verts, uvs, tris: a.triangles };
}
