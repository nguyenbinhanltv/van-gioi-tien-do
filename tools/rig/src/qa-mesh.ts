/**
 * Mesh-level QA: pieces must stay attached to the body and must not stretch. Both are invisible to bone-only checks
 * (a sleeve weighted to a flung chain bone, or a forearm mesh stretched by two bones rotating apart, passes
 * bone-length) but obvious in the picture, so they are measured on the skinned vertices.
 */
import type { QaIssue } from './qa.js';
import { dist, type Vec2 } from './math.js';
import { evalPose, type Pose } from './pose.js';
import { skinAttachment, type SkinnedMesh } from './skinning.js';
import type { Clip } from './clip.js';
import type { RigAttachment, RigDocument } from './schema.js';

export interface MeshQaThresholds {
  /**
   * Severity of an opening seam. 'warning' by default: on rigs that skin rigid mesh islands to single bones a joint
   * cannot bend without opening its seam, which is a rig fix (soft weights / overlap), not an animation one. Use
   * 'error' to gate a rig that is expected to hold its seams (see `softenSeams`).
   */
  readonly seamSeverity: 'error' | 'warning';
  /** Two pieces that touch (distance <= `touchPx`) at rest must not open a gap wider than this (px) in a pose. */
  readonly gapPx: number;
  /** Rest-pose distance (px) under which two pieces count as touching. */
  readonly touchPx: number;
  /** A piece may drift this far (px) from the body skeleton beyond its rest-pose distance before it counts as detached. */
  readonly detachPx: number;
  /** Max edge elongation vs the rest pose (1.4 = 40 % longer). */
  readonly strainMax: number;
  /** Ignore edges shorter than this at rest (px): tiny edges have noisy ratios. */
  readonly minEdgePx: number;
}

/** Pieces that make up the body and its clothes: their seams must stay closed. Props (sword, wing, cape, hair) may move apart. */
export const SEAM_SLOTS: ReadonlySet<string> = new Set([
  'body',
  'outfit_lower',
  'outfit_upper',
  'arm_L',
  'arm_R',
  'head',
]);

export const DEFAULT_MESH_THRESHOLDS: MeshQaThresholds = {
  seamSeverity: 'warning',
  gapPx: 3,
  touchPx: 1.5,
  detachPx: 8,
  strainMax: 1.4,
  minEdgePx: 3,
};

export function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Body skeleton segments (role bones minus IK helpers) of a pose. */
function bodySegments(rig: RigDocument, pose: Pose): [Vec2, Vec2][] {
  const names = new Set(
    Object.entries(rig.roles)
      .filter(([r]) => !r.startsWith('ik_'))
      .map(([, b]) => b as string),
  );
  const out: [Vec2, Vec2][] = [];
  for (const n of names) {
    const b = pose.byName.get(n);
    if (b) out.push([b.pos, b.tip]);
  }
  return out;
}

export function visibleAttachments(rig: RigDocument, pose: Pose): { slot: string; bone: string; att: RigAttachment }[] {
  const out: { slot: string; bone: string; att: RigAttachment }[] = [];
  for (const slot of rig.slots) {
    const name = pose.attachments.get(slot.name);
    if (!name) continue;
    const att =
      rig.skins.find((s) => s.name === 'default')?.attachments[slot.name]?.[name] ??
      rig.skins.flatMap((s) => (s.attachments[slot.name]?.[name] ? [s.attachments[slot.name]![name]!] : []))[0];
    if (att) out.push({ slot: slot.name, bone: slot.bone, att });
  }
  return out;
}

function pointInTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Distance from a point to a triangle set (0 when inside any triangle). */
export function pointToMesh(p: Vec2, verts: readonly Vec2[], tris: readonly number[]): number {
  let best = Infinity;
  for (let t = 0; t < tris.length; t += 3) {
    const a = verts[tris[t]!]!;
    const b = verts[tris[t + 1]!]!;
    const c = verts[tris[t + 2]!]!;
    if (pointInTri(p, a, b, c)) return 0;
    best = Math.min(best, segDist(p, a, b), segDist(p, b, c), segDist(p, c, a));
  }
  return best;
}

/** Split a mesh into connected components (islands of triangles sharing vertices). */
export function components(m: SkinnedMesh): SkinnedMesh[] {
  const parent = m.verts.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (let t = 0; t < m.tris.length; t += 3) {
    parent[find(m.tris[t]!)] = find(m.tris[t + 1]!);
    parent[find(m.tris[t + 1]!)] = find(m.tris[t + 2]!);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < m.tris.length; t += 3) {
    const root = find(m.tris[t]!);
    groups.set(root, [...(groups.get(root) ?? []), m.tris[t]!, m.tris[t + 1]!, m.tris[t + 2]!]);
  }
  return [...groups.values()].map((tris) => ({ verts: m.verts, uvs: m.uvs, tris }));
}

/** The bone a component follows: its vertices' strongest weight bone (the slot bone for unweighted geometry). */
export function dominantBone(att: RigAttachment, slotBone: string, comp: SkinnedMesh): string {
  if (att.type !== 'mesh' || !att.weights) return slotBone;
  const score = new Map<string, number>();
  for (const vi of new Set(comp.tris))
    for (const [b, w] of att.weights[vi] ?? []) score.set(b, (score.get(b) ?? 0) + w);
  return [...score.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? slotBone;
}

/** Detachment and stretch of every visible attachment over the clip. */
export function meshQa(rig: RigDocument, clip: Clip, thresholds: Partial<MeshQaThresholds> = {}): QaIssue[] {
  const th = { ...DEFAULT_MESH_THRESHOLDS, ...thresholds };
  const issues: QaIssue[] = [];
  const rest = evalPose(rig, null, 0, { noIk: true });
  const restSegs = bodySegments(rig, rest);
  const items = visibleAttachments(rig, rest);

  const restDist = new Map<string, number>();
  const restEdges = new Map<string, number[]>();
  for (const it of items) {
    const m = skinAttachment(it.att, it.bone, rest, rest);
    restDist.set(it.slot, Math.min(...m.verts.map((v) => Math.min(...restSegs.map(([a, b]) => segDist(v, a, b))))));
    if (it.att.type === 'mesh') {
      const e: number[] = [];
      for (let t = 0; t < m.tris.length; t += 3) {
        for (const [i, j] of [
          [0, 1],
          [1, 2],
          [2, 0],
        ] as const)
          e.push(dist(m.verts[m.tris[t + i]!]!, m.verts[m.tris[t + j]!]!));
      }
      restEdges.set(it.slot, e);
    }
  }

  // pieces (connected islands of the garment slots) that touch at rest: the seams that must stay closed
  const pieceIds = (slot: string, count: number) => Array.from({ length: count }, (_, k) => `${slot}#${k}`);
  const restPieces = new Map<string, SkinnedMesh>();
  const pieceBone = new Map<string, string>();
  const parentOf = new Map(rig.bones.map((b) => [b.name, b.parent]));
  const jointed = (a: string, b: string) => a !== b && (parentOf.get(a) === b || parentOf.get(b) === a);
  for (const it of items.filter((x) => SEAM_SLOTS.has(x.slot))) {
    const comps = components(skinAttachment(it.att, it.bone, rest, rest));
    pieceIds(it.slot, comps.length).forEach((id, k) => {
      restPieces.set(id, comps[k]!);
      pieceBone.set(id, dominantBone(it.att, it.bone, comps[k]!));
    });
  }
  // seams: for pieces on connected joints, the vertices that sit on the other piece at rest must stay on it
  const seams: { a: string; b: string; seedsA: number[]; seedsB: number[] }[] = [];
  const ids = [...restPieces.keys()];
  const seedsOn = (from: SkinnedMesh, onto: SkinnedMesh) =>
    [...new Set(from.tris)].filter((vi) => pointToMesh(from.verts[vi]!, onto.verts, onto.tris) <= th.touchPx);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!jointed(pieceBone.get(ids[i]!)!, pieceBone.get(ids[j]!)!)) continue; // only pieces on connected joints form a seam
      const pa = restPieces.get(ids[i]!)!;
      const pb = restPieces.get(ids[j]!)!;
      const seedsA = seedsOn(pa, pb);
      const seedsB = seedsOn(pb, pa);
      if (seedsA.length || seedsB.length) seams.push({ a: ids[i]!, b: ids[j]!, seedsA, seedsB });
    }
  }
  const worstGap = new Map<string, { gap: number; frame: number }>();
  const worstDetach = new Map<string, { excess: number; frame: number }>();
  const worstStrain = new Map<string, { ratio: number; frame: number }>();
  for (let f = 0; f <= clip.frames; f++) {
    const pose = evalPose(rig, clip, f);
    const segs = bodySegments(rig, pose);
    const vis = visibleAttachments(rig, pose);
    const poseMeshes = new Map<string, SkinnedMesh>();
    for (const it of vis.filter((x) => SEAM_SLOTS.has(x.slot))) {
      const comps = components(skinAttachment(it.att, it.bone, pose, rest));
      pieceIds(it.slot, comps.length).forEach((id, k) => poseMeshes.set(id, comps[k]!));
    }
    for (const sm of seams) {
      const ma = poseMeshes.get(sm.a);
      const mb = poseMeshes.get(sm.b);
      if (!ma || !mb) continue;
      let gap = 0;
      for (const vi of sm.seedsA) gap = Math.max(gap, pointToMesh(ma.verts[vi]!, mb.verts, mb.tris));
      for (const vi of sm.seedsB) gap = Math.max(gap, pointToMesh(mb.verts[vi]!, ma.verts, ma.tris));
      const key = `${sm.a}|${sm.b}`;
      if (gap > (worstGap.get(key)?.gap ?? th.gapPx)) worstGap.set(key, { gap, frame: f });
    }
    for (const it of vis) {
      const m = skinAttachment(it.att, it.bone, pose, rest);
      const d = Math.min(...m.verts.map((v) => Math.min(...segs.map(([a, b]) => segDist(v, a, b)))));
      const excess = d - (restDist.get(it.slot) ?? d);
      if (excess > (worstDetach.get(it.slot)?.excess ?? th.detachPx)) worstDetach.set(it.slot, { excess, frame: f });
      const base = restEdges.get(it.slot);
      if (base && it.att.type === 'mesh') {
        let k = 0;
        for (let t = 0; t < m.tris.length; t += 3) {
          for (const [i, j] of [
            [0, 1],
            [1, 2],
            [2, 0],
          ] as const) {
            const r0 = base[k++]!;
            if (r0 < th.minEdgePx) continue;
            const ratio = dist(m.verts[m.tris[t + i]!]!, m.verts[m.tris[t + j]!]!) / r0;
            if (ratio > (worstStrain.get(it.slot)?.ratio ?? th.strainMax))
              worstStrain.set(it.slot, { ratio, frame: f });
          }
        }
      }
    }
  }
  for (const [slot, w] of worstDetach) {
    issues.push({
      severity: 'error',
      check: 'detach',
      bone: slot,
      frame: w.frame,
      value: w.excess,
      message: `piece '${slot}' drifts ${w.excess.toFixed(1)} px away from the body (limit ${th.detachPx})`,
    });
  }
  for (const [key, w] of worstGap) {
    issues.push({
      severity: th.seamSeverity,
      check: 'detach',
      bone: key,
      frame: w.frame,
      value: w.gap,
      message: `pieces ${key.replace('|', ' / ')} come apart: a ${w.gap.toFixed(1)} px gap opens (limit ${th.gapPx})`,
    });
  }
  for (const [slot, w] of worstStrain) {
    issues.push({
      severity: 'error',
      check: 'mesh-strain',
      bone: slot,
      frame: w.frame,
      value: w.ratio,
      message: `mesh '${slot}' stretches to ${(w.ratio * 100).toFixed(0)} % of its rest edge length (limit ${(th.strainMax * 100).toFixed(0)} %)`,
    });
  }
  return issues;
}
