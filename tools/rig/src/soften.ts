/**
 * Seam softening. Rigs cut from one painting often skin each piece rigidly to a single bone, so any joint that bends
 * opens a gap between neighbouring pieces. Where two pieces on connected joints touch at rest, give the vertices along
 * that shared edge an equal share of both bones: both sides then move together at the seam and stay closed, while the
 * rest of each piece stays rigid (no new art, no change to UVs or the rest pose). Returns a new rig; the input is not
 * modified.
 */
import { evalPose } from './pose.js';
import { components, dominantBone, pointToMesh, visibleAttachments } from './qa-mesh.js';
import { skinAttachment, type SkinnedMesh } from './skinning.js';
import type { MeshAttachment, RigAttachment, RigDocument, RigSkin } from './schema.js';

export interface SoftenOptions {
  /** A vertex within this distance (px) of a jointed neighbour piece (at rest) is a seam vertex. Default 2. */
  readonly touchPx?: number;
  /** Skin to modify. Default 'default'. */
  readonly skin?: string;
}

interface Piece {
  readonly slot: string;
  readonly att: MeshAttachment;
  readonly mesh: SkinnedMesh;
  readonly bone: string;
}

export function softenSeams(rig: RigDocument, opts: SoftenOptions = {}): RigDocument {
  const touch = opts.touchPx ?? 2;
  const skinName = opts.skin ?? 'default';
  const rest = evalPose(rig, null, 0, { noIk: true });
  const parentOf = new Map(rig.bones.map((b) => [b.name, b.parent]));
  const jointed = (a: string, b: string) => a !== b && (parentOf.get(a) === b || parentOf.get(b) === a);

  const pieces: Piece[] = [];
  for (const it of visibleAttachments(rig, rest)) {
    if (it.att.type !== 'mesh' || !it.att.weights) continue;
    for (const mesh of components(skinAttachment(it.att, it.bone, rest, rest))) {
      pieces.push({ slot: it.slot, att: it.att, mesh, bone: dominantBone(it.att, it.bone, mesh) });
    }
  }

  // vertex (slot, index) -> bones sharing the seam it sits on
  const shared = new Map<string, Set<string>>();
  for (const a of pieces) {
    for (const vi of new Set(a.mesh.tris)) {
      for (const b of pieces) {
        if (a === b || !jointed(a.bone, b.bone)) continue;
        if (pointToMesh(a.mesh.verts[vi]!, b.mesh.verts, b.mesh.tris) <= touch) {
          const key = `${a.slot}:${vi}`;
          (shared.get(key) ?? shared.set(key, new Set([a.bone])).get(key)!).add(b.bone);
        }
      }
    }
  }

  const skins: RigSkin[] = rig.skins.map((sk) => {
    if (sk.name !== skinName) return sk;
    const attachments: Record<string, Record<string, RigAttachment>> = {};
    for (const [slot, atts] of Object.entries(sk.attachments)) {
      attachments[slot] = {};
      for (const [name, att] of Object.entries(atts)) {
        if (att.type !== 'mesh' || !att.weights || name !== rest.attachments.get(slot)) {
          attachments[slot]![name] = att;
          continue;
        }
        const weights = att.weights.map((w, vi) => {
          const bones = shared.get(`${slot}:${vi}`);
          if (!bones || bones.size < 2) return w;
          const share = 1 / bones.size;
          return [...bones].map((b) => [b, share] as const);
        });
        attachments[slot]![name] = { ...att, weights };
      }
    }
    return { ...sk, attachments };
  });
  return { ...rig, skins };
}
