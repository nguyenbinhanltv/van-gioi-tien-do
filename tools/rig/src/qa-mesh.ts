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
  strainMax: 2,
  minEdgePx: 3,
};

/**
 * Bones whose pieces form a seam: parent / child, or siblings under one parent (torso vs arm both hang from the spine),
 * except left/right mirror pairs (two arms may overlap in profile without being joined).
 */
export function connectedBones(rig: RigDocument): (a: string, b: string) => boolean {
  const parentOf = new Map(rig.bones.map((b) => [b.name, b.parent]));
  const side = (n: string) => n.replace(/(^|_)[LR](?=_|\d|$)/, '$1');
  // secondary-motion chains (hair, sash, sleeve tips) are meant to swing away from the body: no seam to keep
  const chain = new Set((rig.chains ?? []).flatMap((c) => c.bones));
  return (a, b) => {
    if (a === b || chain.has(a) || chain.has(b)) return false;
    if (parentOf.get(a) === b || parentOf.get(b) === a) return true;
    const pa = parentOf.get(a);
    return pa !== null && pa === parentOf.get(b) && side(a) !== side(b);
  };
}

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
/** Boundary edges of a mesh: edges used by exactly one triangle. */
export function outlineEdges(m: SkinnedMesh): [Vec2, Vec2][] {
  const count = new Map<string, [number, number]>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const seen = new Map<string, number>();
  for (let t = 0; t < m.tris.length; t += 3) {
    for (const [i, j] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const a = m.tris[t + i]!;
      const b = m.tris[t + j]!;
      const k = key(a, b);
      seen.set(k, (seen.get(k) ?? 0) + 1);
      count.set(k, [a, b]);
    }
  }
  return [...count].filter(([k]) => seen.get(k) === 1).map(([, [a, b]]) => [m.verts[a]!, m.verts[b]!]);
}

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
  const jointed = connectedBones(rig);
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
  // seam seeds: vertices of `from` that sit on or within a hair of the *outline* of `onto` at rest (the shared edge).
  // Interior overlap vertices are not seeds: moving within the overlap is not a gap.
  const seedsOn = (from: SkinnedMesh, onto: SkinnedMesh) => {
    const edges = outlineEdges(onto);
    return [...new Set(from.tris)].filter((vi) => {
      const v = from.verts[vi]!;
      if (pointToMesh(v, onto.verts, onto.tris) > th.touchPx) return false;
      return edges.some(([a, b]) => segDist(v, a, b) <= th.touchPx * 2);
    });
  };
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

export interface PieceInfo {
  readonly id: string;
  readonly slot: string;
  /** The bone the piece follows. */
  readonly bone: string;
  /** Atlas region the piece is cut from (its attachment path). */
  readonly region: string;
  /** Rest-pose bounding box size in px (w × h). */
  readonly size: readonly [number, number];
}

/** Human-readable table of the garment pieces (`slot#k` ids used in QA messages). */
export function pieceTable(rig: RigDocument): Map<string, PieceInfo> {
  const rest = evalPose(rig, null, 0, { noIk: true });
  const out = new Map<string, PieceInfo>();
  for (const it of visibleAttachments(rig, rest)) {
    if (!SEAM_SLOTS.has(it.slot)) continue;
    const comps = components(skinAttachment(it.att, it.bone, rest, rest));
    comps.forEach((c, k) => {
      const xs = [...new Set(c.tris)].map((i) => c.verts[i]!.x);
      const ys = [...new Set(c.tris)].map((i) => c.verts[i]!.y);
      out.set(`${it.slot}#${k}`, {
        id: `${it.slot}#${k}`,
        slot: it.slot,
        bone: dominantBone(it.att, it.bone, c),
        region: it.att.path,
        size: [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))],
      });
    });
  }
  return out;
}

export interface UnderpaintNeed {
  /** The two pieces whose seam opens. */
  readonly pieces: readonly [PieceInfo, PieceInfo];
  /** Worst gap (px) over the clips: the paint that must extend under/over the joint to keep it covered. */
  readonly extendPx: number;
  readonly clip: string;
  readonly frame: number;
  /** In how many of the given clips the seam opens beyond the limit. */
  readonly clips: number;
}

/**
 * Where the art itself must change: seams that open in the given clips. A gap on a bent joint means no painted pixels
 * exist there; skinning cannot invent them, so the pieces need underpaint / extension by about `extendPx`.
 */
export function underpaintNeeds(
  rig: RigDocument,
  clips: readonly Clip[],
  thresholds: Partial<MeshQaThresholds> = {},
): UnderpaintNeed[] {
  const table = pieceTable(rig);
  const worst = new Map<string, { gap: number; clip: string; frame: number; clips: number }>();
  for (const clip of clips) {
    for (const i of meshQa(rig, clip, { seamSeverity: 'warning', ...thresholds })) {
      if (i.check !== 'detach' || !/come apart/.test(i.message) || !i.bone) continue;
      const w = worst.get(i.bone);
      const gap = i.value ?? 0;
      worst.set(i.bone, {
        gap: Math.max(gap, w?.gap ?? 0),
        clip: gap > (w?.gap ?? 0) ? clip.name : (w?.clip ?? clip.name),
        frame: gap > (w?.gap ?? 0) ? (i.frame ?? 0) : (w?.frame ?? 0),
        clips: (w?.clips ?? 0) + 1,
      });
    }
  }
  return [...worst]
    .flatMap(([key, w]) => {
      const [a, b] = key.split('|').map((id) => table.get(id!));
      return a && b
        ? [{ pieces: [a, b] as const, extendPx: Math.ceil(w.gap), clip: w.clip, frame: w.frame, clips: w.clips }]
        : [];
    })
    .sort((x, y) => y.extendPx - x.extendPx);
}
