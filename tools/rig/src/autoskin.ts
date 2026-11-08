/**
 * Auto-skinning for rigs whose pieces are rigid quads cut from one painting (reusable for every class).
 *
 * Problem: a quad skinned 100 % to one bone cannot bend, and two neighbouring quads on a bending joint open a gap.
 * Fix, in three steps and without new art:
 *  1. Pieces that touch a joint band are subdivided into a grid (bilinear positions and UVs, so the painting maps
 *     through unchanged); pieces away from every joint stay as they are (4 vertices, rigid).
 *  2. Each vertex gets smooth weights from its distance to the **seams** it belongs to (the stretch of outline where
 *     its piece meets a piece on a connected joint): on the seam both bones share the vertex equally, a falloff band
 *     later it is pinned 100 % to its piece's own bone. Both pieces use the same seam line, so along the whole seam
 *     (not just at the joint point) their vertices get identical weights and move together: the seam is welded.
 *  3. Influences are capped (default 3, 4 where a joint star needs it) and renormalised.
 *
 * What it cannot do: invent paint. Where a bent joint reveals ground that no piece covers (no overlap under the joint)
 * a hole remains; `meshQa` / `checkSilhouette` report those and `underpaintNeeds` lists the pieces and the px.
 */
import { RIG_LIMITS } from '@vgtd/character';
import { applyMat, dist, invertMat, type Vec2 } from './math.js';
import { evalPose } from './pose.js';
import { components, connectedBones, dominantBone, outlineEdges, pointToMesh, visibleAttachments } from './qa-mesh.js';
import { skinAttachment, type SkinnedMesh } from './skinning.js';
import type { MeshAttachment, RigAttachment, RigDocument, RigSkin } from './schema.js';

export interface AutoSkinOptions {
  /** Radius (px, rig space) of the soft band around each joint. Default 10. */
  readonly band?: number;
  /** Target grid cell size (px) for subdivided pieces. Tried from this value up until the mesh budget holds. Default 6. */
  readonly cell?: number;
  /** Distance (px) under which two pieces count as touching at rest. Default 2. */
  readonly touchPx?: number;
  /** Max bone influences per vertex. Default 3. */
  readonly maxInfluences?: number;
  /** Skin to rewrite. Default 'default'. */
  readonly skin?: string;
  /** Pieces to remove from a mesh (e.g. an empty scabbard when the sword is drawn): return true to drop. */
  readonly dropPiece?: (slot: string, bone: string) => boolean;
  /** Vertex budget for all meshes of the skin. Default `RIG_LIMITS` for the rig kind. */
  readonly maxVertices?: number;
}

export interface AutoSkinReport {
  readonly vertices: number;
  readonly budget: number;
  readonly cell: number;
  readonly maxInfluences: number;
  readonly subdividedPieces: number;
  readonly rigidPieces: number;
  readonly droppedPieces: number;
  readonly perSlot: Readonly<Record<string, number>>;
}

interface Seam {
  /** The two bones whose pieces meet here. */
  readonly bones: readonly [string, string];
  /** Sample points along the shared outline at rest. */
  readonly pts: readonly Vec2[];
}

function sampleOutline(edges: readonly [Vec2, Vec2][], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (const [p, q] of edges) {
    const n = Math.max(1, Math.ceil(dist(p, q) / step));
    for (let i = 0; i <= n; i++) out.push(lerp2(p, q, i / n));
  }
  return out;
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Weights of a vertex of a piece on bone `own`: shares to the neighbour bones of every seam it lies near. */
function weightsAt(p: Vec2, own: string, seams: readonly Seam[], band: number): Map<string, number> {
  const share = new Map<string, number>();
  for (const seam of seams) {
    const [x, y] = seam.bones;
    if (own !== x && own !== y) continue;
    const other = own === x ? y : x;
    let d = Infinity;
    for (const q of seam.pts) d = Math.min(d, dist(p, q));
    const f = 0.5 * (1 - smooth(d / band));
    if (f > 0) share.set(other, Math.max(share.get(other) ?? 0, f));
  }
  const total = [...share.values()].reduce((a, b) => a + b, 0);
  const scale = total > 0.75 ? 0.75 / total : 1;
  const w = new Map<string, number>();
  let rest = 1;
  for (const [bone, f] of share) {
    w.set(bone, f * scale);
    rest -= f * scale;
  }
  w.set(own, rest);
  return w;
}

function capInfluences(w: Map<string, number>, max: number): [string, number][] {
  const list = [...w.entries()]
    .filter(([, x]) => x > 0.02)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
  const sum = list.reduce((s, [, x]) => s + x, 0);
  return list.map(([b, x]) => [b, Math.round((x / sum) * 1e4) / 1e4]);
}

interface Quad {
  readonly corners: readonly [Vec2, Vec2, Vec2, Vec2];
  readonly uvs: readonly [Vec2, Vec2, Vec2, Vec2];
}

/** Recover the 4 corners (in loop order) of a quad component from its two triangles. */
function quadOf(
  verts: readonly Vec2[],
  uvs: readonly Vec2[],
  tris: readonly number[],
): { idx: [number, number, number, number]; quad: Quad } | null {
  const ids = [...new Set(tris)];
  if (ids.length !== 4 || tris.length !== 6) return null;
  // the diagonal is the edge shared by both triangles
  const t1 = tris.slice(0, 3);
  const t2 = tris.slice(3, 6);
  const shared = t1.filter((v) => t2.includes(v));
  if (shared.length !== 2) return null;
  const a = t1.find((v) => !shared.includes(v))!;
  const c = t2.find((v) => !shared.includes(v))!;
  const idx: [number, number, number, number] = [a, shared[0]!, c, shared[1]!];
  return {
    idx,
    quad: {
      corners: idx.map((i) => verts[i]!) as unknown as Quad['corners'],
      uvs: idx.map((i) => uvs[i]!) as unknown as Quad['uvs'],
    },
  };
}

const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function autoSkin(rig: RigDocument, opts: AutoSkinOptions = {}): { rig: RigDocument; report: AutoSkinReport } {
  const band = opts.band ?? 10;
  const maxInf = opts.maxInfluences ?? 3;
  const skinName = opts.skin ?? 'default';
  const budget =
    opts.maxVertices ?? RIG_LIMITS[rig.kind === 'boss' ? 'boss' : rig.kind === 'pet' ? 'pet' : 'player'].meshVertices;
  const rest = evalPose(rig, null, 0, { noIk: true });
  const items = visibleAttachments(rig, rest).filter((it) => it.att.type === 'mesh' && it.att.weights);
  const jointed = connectedBones(rig);

  interface Piece {
    readonly slot: string;
    readonly slotBone: string;
    readonly bone: string;
    readonly quad: Quad | null;
    readonly verts: readonly Vec2[];
    readonly uvs: readonly Vec2[];
    readonly tris: readonly number[];
    readonly mesh: SkinnedMesh;
    nearJoint: boolean;
  }
  const pieces: Piece[] = [];
  let dropped = 0;
  for (const it of items) {
    const att = it.att as MeshAttachment;
    const world = skinAttachment(att, it.bone, rest, rest);
    for (const comp of components(world)) {
      const bone = dominantBone(att, it.bone, comp);
      if (opts.dropPiece?.(it.slot, bone)) {
        dropped++;
        continue;
      }
      const q = quadOf(world.verts, world.uvs, comp.tris);
      pieces.push({
        slot: it.slot,
        slotBone: it.bone,
        bone,
        quad: q?.quad ?? null,
        verts: world.verts,
        uvs: world.uvs,
        tris: comp.tris,
        mesh: comp,
        nearJoint: false,
      });
    }
  }

  // seams: pieces on connected joints that touch or overlap at rest share a stretch of outline
  const touch = opts.touchPx ?? 2;
  const seams: Seam[] = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const A = pieces[i]!;
      const B = pieces[j]!;
      if (!jointed(A.bone, B.bone)) continue;
      const near = (from: Piece, onto: Piece) =>
        sampleOutline(outlineEdges(from.mesh), 1.5).filter(
          (p) => pointToMesh(p, onto.mesh.verts, onto.mesh.tris) <= touch,
        );
      const pts = [...near(A, B), ...near(B, A)];
      if (!pts.length) continue;
      seams.push({ bones: [A.bone, B.bone], pts });
      A.nearJoint = true;
      B.nearJoint = true;
    }
  }
  const build = (cell: number) => {
    const bySlot = new Map<string, { verts: Vec2[]; uvs: Vec2[]; tris: number[]; weights: [string, number][][] }>();
    let sub = 0;
    let rigid = 0;
    for (const p of pieces) {
      const m = bySlot.get(p.slot) ?? bySlot.set(p.slot, { verts: [], uvs: [], tris: [], weights: [] }).get(p.slot)!;
      const base = m.verts.length;
      if (p.quad && p.nearJoint) {
        sub++;
        const [c0, c1, c2, c3] = p.quad.corners;
        const [u0, u1, u2, u3] = p.quad.uvs;
        const nx = Math.min(10, Math.max(1, Math.ceil(dist(c0, c1) / cell)));
        const ny = Math.min(10, Math.max(1, Math.ceil(dist(c1, c2) / cell)));
        for (let j = 0; j <= ny; j++) {
          for (let i = 0; i <= nx; i++) {
            const s = i / nx;
            const t = j / ny;
            const pos = lerp2(lerp2(c0, c1, s), lerp2(c3, c2, s), t);
            m.verts.push(pos);
            m.uvs.push(lerp2(lerp2(u0, u1, s), lerp2(u3, u2, s), t));
            m.weights.push(capInfluences(weightsAt(pos, p.bone, seams, band), maxInf));
          }
        }
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const a = base + j * (nx + 1) + i;
            const b = a + 1;
            const d = a + (nx + 1);
            m.tris.push(a, b, b + (nx + 1), a, b + (nx + 1), d);
          }
        }
      } else {
        rigid++;
        const map = new Map<number, number>();
        for (const vi of new Set(p.tris)) {
          map.set(vi, base + map.size);
          m.verts.push(p.verts[vi]!);
          m.uvs.push(p.uvs[vi]!);
          m.weights.push(
            p.nearJoint ? capInfluences(weightsAt(p.verts[vi]!, p.bone, seams, band), maxInf) : [[p.bone, 1]],
          );
        }
        for (const vi of p.tris) m.tris.push(map.get(vi)!);
      }
    }
    return { bySlot, sub, rigid };
  };

  let cell = opts.cell ?? 6;
  let built = build(cell);
  const count = (b: typeof built) => [...b.bySlot.values()].reduce((s, m) => s + m.verts.length, 0);
  while (count(built) > budget && cell < 40) {
    cell += 2;
    built = build(cell);
  }

  const skins: RigSkin[] = rig.skins.map((sk) => {
    if (sk.name !== skinName) return sk;
    const attachments: Record<string, Record<string, RigAttachment>> = {};
    for (const [slot, atts] of Object.entries(sk.attachments)) {
      attachments[slot] = {};
      for (const [name, att] of Object.entries(atts)) {
        const m = built.bySlot.get(slot);
        if (!m || att.type !== 'mesh' || name !== rest.attachments.get(slot)) {
          attachments[slot]![name] = att;
          continue;
        }
        const slotBone = rig.slots.find((s) => s.name === slot)!.bone;
        const inv = invertMat(rest.byName.get(slotBone)!.world);
        const local = m.verts.map((v) => applyMat(inv, v));
        const r4 = (v: number) => Math.round(v * 1e3) / 1e3;
        attachments[slot]![name] = {
          ...att,
          vertices: local.flatMap((v) => [r4(v.x), r4(v.y)]),
          uvs: m.uvs.flatMap((u) => [Math.round(u.x * 1e5) / 1e5, Math.round(u.y * 1e5) / 1e5]),
          triangles: m.tris,
          weights: m.weights,
        };
      }
    }
    return { ...sk, attachments };
  });

  const perSlot: Record<string, number> = {};
  for (const [slot, m] of built.bySlot) perSlot[slot] = m.verts.length;
  const influences = Math.max(...[...built.bySlot.values()].flatMap((m) => m.weights.map((w) => w.length)));
  return {
    rig: { ...rig, skins },
    report: {
      vertices: count(built),
      budget,
      cell,
      maxInfluences: influences,
      subdividedPieces: built.sub,
      rigidPieces: built.rigid,
      droppedPieces: dropped,
      perSlot,
    },
  };
}
