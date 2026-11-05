/**
 * Piece surgery on weighted meshes: remove connected pieces (islands) from an attachment, keeping everything else
 * byte-identical. Used for art that does not belong in a pose of the rig (e.g. the empty-scabbard quad of the outfit when
 * the sword is drawn: the painted scabbard shows a second sword).
 */
import { components, dominantBone, visibleAttachments } from './qa-mesh.js';
import { evalPose } from './pose.js';
import { skinAttachment } from './skinning.js';
import type { MeshAttachment, RigAttachment, RigDocument, RigSkin } from './schema.js';

export interface RemoveOptions {
  /** Remove a piece when this returns true (slot id, the bone the piece follows). */
  readonly remove: (slot: string, bone: string) => boolean;
  /** Skin to edit. Default 'default'. */
  readonly skin?: string;
}

export function removePieces(rig: RigDocument, opts: RemoveOptions): { rig: RigDocument; removed: number } {
  const rest = evalPose(rig, null, 0, { noIk: true });
  const keep = new Map<string, { att: MeshAttachment; name: string; verts: number[] }>();
  let removed = 0;
  for (const it of visibleAttachments(rig, rest)) {
    if (it.att.type !== 'mesh' || !it.att.weights) continue;
    const att = it.att;
    const comps = components(skinAttachment(att, it.bone, rest, rest));
    const dropIdx = comps.filter((c) => opts.remove(it.slot, dominantBone(att, it.bone, c)));
    if (!dropIdx.length) continue;
    removed += dropIdx.length;
    const drop = new Set(dropIdx.flatMap((c) => [...new Set(c.tris)]));
    keep.set(it.slot, {
      att,
      name: rest.attachments.get(it.slot)!,
      verts: [...Array(att.vertices.length / 2).keys()].filter((v) => !drop.has(v)),
    });
  }
  const skins: RigSkin[] = rig.skins.map((sk) => {
    if (sk.name !== (opts.skin ?? 'default')) return sk;
    const attachments: Record<string, Record<string, RigAttachment>> = {};
    for (const [slot, atts] of Object.entries(sk.attachments)) {
      attachments[slot] = { ...atts };
      const k = keep.get(slot);
      if (!k || atts[k.name] === undefined) continue;
      const remap = new Map(k.verts.map((v, i) => [v, i]));
      const tris: number[] = [];
      for (let t = 0; t < k.att.triangles.length; t += 3) {
        const tri = k.att.triangles.slice(t, t + 3);
        if (tri.every((v) => remap.has(v))) tris.push(...tri.map((v) => remap.get(v)!));
      }
      attachments[slot]![k.name] = {
        ...k.att,
        vertices: k.verts.flatMap((v) => [k.att.vertices[v * 2]!, k.att.vertices[v * 2 + 1]!]),
        uvs: k.verts.flatMap((v) => [k.att.uvs[v * 2]!, k.att.uvs[v * 2 + 1]!]),
        triangles: tris,
        weights: k.verts.map((v) => k.att.weights![v]!),
      };
    }
    return { ...sk, attachments };
  });
  return { rig: { ...rig, skins }, removed };
}
