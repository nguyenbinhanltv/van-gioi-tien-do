/**
 * Thin-strip QA: hem bands, sleeve cuffs, linings and edges are thin pieces that must ride on the garment they trim.
 * Their failure is obvious in the picture and invisible to bone checks and seam-gap metrics: a wide hem band bound to a
 * chain bone with a 2 px lever arm flips into an X under the feet in run (found by eye after the gate said 0/0/0).
 * Per frame, on the skinned vertices, three measurements:
 *
 *  - ORIENTATION: the strip's long axis must turn with the garment it sits on. The garment's own rotation near the strip
 *    is measured from its triangles (rest → pose); the strip may differ from it by at most `maxAxisDeg`.
 *  - LEAVES PARENT: no strip vertex may be more than `leavePx` further from the other garment meshes than it was at rest.
 *  - CROSSING / FOLD: a strip must not fold (triangle orientation flipped against rest) and two strips' axes must not
 *    cross each other.
 */
import type { QaIssue } from './qa.js';
import { evalPose } from './pose.js';
import { pointToMesh, visibleAttachments } from './qa-mesh.js';
import { skinAttachment, type SkinnedMesh } from './skinning.js';
import type { Vec2 } from './math.js';
import type { Clip } from './clip.js';
import type { RigDocument } from './schema.js';

/** Slots that are trim strips by name (hem, cuff, lining, edge, trim): the pieces this check judges. */
export const STRIP_SLOTS = /(hem|cuff|lining|edge|trim)/i;

export interface StripQaThresholds {
  /** Largest allowed difference (deg) between the strip's axis turn and the parent garment's turn (a seated skirt
   * legitimately differs by ~45 deg between hem and hip; the broken hem chain also failed leave/cross). */
  readonly maxAxisDeg: number;
  /** Largest allowed growth (px) of a strip vertex's distance to the parent garments over its rest distance. */
  readonly leavePx: number;
  /** A strip is a piece whose short side is at most this (px) and long/short ratio at least `minRatio`. */
  /** Largest share of a strip's triangles that may be flipped against rest (a corner of a deforming skirt). */
  readonly maxFlippedShare: number;
  /** Two strips only count as crossing when their axes differ by more than this (deg): an X, not a graze. */
  readonly minCrossDeg: number;
  readonly maxThicknessPx: number;
  readonly minRatio: number;
}

export const DEFAULT_STRIP_THRESHOLDS: StripQaThresholds = {
  maxAxisDeg: 50,
  leavePx: 6,
  maxFlippedShare: 0.3,
  minCrossDeg: 60,
  maxThicknessPx: 14,
  minRatio: 2.5,
};

/** Principal axis of a vertex cloud: angle (deg, mod 180), long and short extents (px). */
export function principalAxis(verts: readonly Vec2[]): { angle: number; length: number; width: number; centre: Vec2 } {
  const n = verts.length || 1;
  const cx = verts.reduce((a, v) => a + v.x, 0) / n;
  const cy = verts.reduce((a, v) => a + v.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const v of verts) {
    sxx += (v.x - cx) ** 2;
    syy += (v.y - cy) ** 2;
    sxy += (v.x - cx) * (v.y - cy);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  let lo = Infinity;
  let hi = -Infinity;
  let wlo = Infinity;
  let whi = -Infinity;
  for (const v of verts) {
    const a = (v.x - cx) * ux + (v.y - cy) * uy;
    const b = -(v.x - cx) * uy + (v.y - cy) * ux;
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
    wlo = Math.min(wlo, b);
    whi = Math.max(whi, b);
  }
  return { angle: (theta * 180) / Math.PI, length: hi - lo, width: whi - wlo, centre: { x: cx, y: cy } };
}

const angleDiff180 = (a: number, b: number) => {
  let d = (a - b) % 180;
  if (d > 90) d -= 180;
  if (d < -90) d += 180;
  return d;
};
const angleDiff360 = (a: number, b: number) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function segmentsCross(p: Vec2, q: Vec2, r: Vec2, s: Vec2): boolean {
  const d1 = cross(p, q, r);
  const d2 = cross(p, q, s);
  const d3 = cross(r, s, p);
  const d4 = cross(r, s, q);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Mean rotation (deg) of the triangles of `parent` whose rest centroid lies within `radius` of `at` (rest → pose). */
function parentTurn(rest: SkinnedMesh, pose: SkinnedMesh, at: Vec2, radius: number): number | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let t = 0; t < rest.tris.length; t += 3) {
    const [i, j, k] = [rest.tris[t]!, rest.tris[t + 1]!, rest.tris[t + 2]!];
    const c = {
      x: (rest.verts[i]!.x + rest.verts[j]!.x + rest.verts[k]!.x) / 3,
      y: (rest.verts[i]!.y + rest.verts[j]!.y + rest.verts[k]!.y) / 3,
    };
    if (Math.hypot(c.x - at.x, c.y - at.y) > radius) continue;
    // rotation of the triangle: angle between its rest and pose edge i→j (the unit vectors are summed, not the angles)
    const r = { x: rest.verts[j]!.x - rest.verts[i]!.x, y: rest.verts[j]!.y - rest.verts[i]!.y };
    const p = { x: pose.verts[j]!.x - pose.verts[i]!.x, y: pose.verts[j]!.y - pose.verts[i]!.y };
    const lr = Math.hypot(r.x, r.y);
    const lp = Math.hypot(p.x, p.y);
    if (lr < 1e-6 || lp < 1e-6) continue;
    const a = Math.atan2(p.y, p.x) - Math.atan2(r.y, r.x);
    sx += Math.cos(a);
    sy += Math.sin(a);
    n++;
  }
  return n ? (Math.atan2(sy, sx) * 180) / Math.PI : null;
}

const triSign = (m: SkinnedMesh, t: number) => {
  const a = m.verts[m.tris[t]!]!;
  const b = m.verts[m.tris[t + 1]!]!;
  const c = m.verts[m.tris[t + 2]!]!;
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
};

export function stripQa(rig: RigDocument, clip: Clip, thresholds: Partial<StripQaThresholds> = {}): QaIssue[] {
  const th = { ...DEFAULT_STRIP_THRESHOLDS, ...thresholds };
  const rest = evalPose(rig, null, 0, { noIk: true });
  const items = visibleAttachments(rig, rest);
  interface Strip {
    readonly slot: string;
    readonly restMesh: SkinnedMesh;
    readonly axisRest: number;
    readonly centreRest: Vec2;
    readonly restDist: number[];
  }
  const meshAt = (it: (typeof items)[number], pose: typeof rest) => skinAttachment(it.att, it.bone, pose, rest);
  const restMeshes = items.filter((it) => it.att.type === 'mesh').map((it) => ({ it, m: meshAt(it, rest) }));
  const isStrip = (slot: string, m: SkinnedMesh) => {
    if (!STRIP_SLOTS.test(slot)) return false;
    const ax = principalAxis(m.verts);
    return ax.width <= th.maxThicknessPx && ax.length / Math.max(1e-6, ax.width) >= th.minRatio;
  };
  const strips: Strip[] = [];
  const parents: { slot: string; rest: SkinnedMesh; it: (typeof items)[number] }[] = [];
  for (const { it, m } of restMeshes) {
    if (isStrip(it.slot, m)) {
      const ax = principalAxis(m.verts);
      strips.push({ slot: it.slot, restMesh: m, axisRest: ax.angle, centreRest: ax.centre, restDist: [] });
    } else if (!/(hair|ribbon|tail|pendant|tassel|shadow)/i.test(it.slot)) {
      parents.push({ slot: it.slot, rest: m, it });
    }
  }
  if (!strips.length || !parents.length) return [];
  // rest distance of every strip vertex to the parent garments (a strip touches its garment at rest)
  for (const s of strips)
    for (const v of s.restMesh.verts)
      s.restDist.push(Math.min(...parents.map((p) => pointToMesh(v, p.rest.verts, p.rest.tris))));

  const issues: QaIssue[] = [];
  const worst = new Map<string, { kind: string; value: number; frame: number }>();
  const note = (slot: string, kind: string, value: number, frame: number) => {
    const key = `${slot}|${kind}`;
    const w = worst.get(key);
    if (!w || value > w.value) worst.set(key, { kind, value, frame });
  };
  for (let f = 0; f <= clip.frames; f++) {
    const pose = evalPose(rig, clip, f);
    const poseParents = parents.map((p) => ({ ...p, pose: meshAt(p.it, pose) }));
    const axes: { slot: string; a: Vec2; b: Vec2 }[] = [];
    for (const s of strips) {
      const it = items.find((x) => x.slot === s.slot)!;
      const m = meshAt(it, pose);
      const ax = principalAxis(m.verts);
      // 1. orientation against the garment under the strip
      const turns: number[] = [];
      for (const p of poseParents) {
        const t = parentTurn(p.rest, p.pose, s.centreRest, Math.max(12, principalAxis(s.restMesh.verts).length));
        if (t !== null) turns.push(t);
      }
      if (turns.length) {
        const mean = Math.atan2(
          turns.reduce((a, t) => a + Math.sin((t * Math.PI) / 180), 0),
          turns.reduce((a, t) => a + Math.cos((t * Math.PI) / 180), 0),
        );
        const garment = (mean * 180) / Math.PI;
        const stripTurn = angleDiff180(ax.angle, s.axisRest);
        note(s.slot, 'axis', Math.abs(angleDiff180(stripTurn, angleDiff360(garment, 0))), f);
      }
      // 2. leaves the parent garment
      let leave = 0;
      m.verts.forEach((v, i) => {
        const d = Math.min(...poseParents.map((p) => pointToMesh(v, p.pose.verts, p.pose.tris)));
        leave = Math.max(leave, d - s.restDist[i]!);
      });
      note(s.slot, 'leave', leave, f);
      // 3. fold
      let flipped = 0;
      for (let t = 0; t < m.tris.length; t += 3) {
        const r = triSign(s.restMesh, t);
        if (r !== 0 && triSign(m, t) === -r) flipped++;
      }
      note(s.slot, 'fold', flipped / Math.max(1, m.tris.length / 3), f);
      const half = ax.length / 2;
      const u = { x: Math.cos((ax.angle * Math.PI) / 180), y: Math.sin((ax.angle * Math.PI) / 180) };
      axes.push({
        slot: s.slot,
        a: { x: ax.centre.x - u.x * half, y: ax.centre.y - u.y * half },
        b: { x: ax.centre.x + u.x * half, y: ax.centre.y + u.y * half },
      });
    }
    // 4. two strips crossing each other (the X)
    for (let i = 0; i < axes.length; i++)
      for (let j = i + 1; j < axes.length; j++)
        if (segmentsCross(axes[i]!.a, axes[i]!.b, axes[j]!.a, axes[j]!.b)) {
          // two near-parallel strips (front and back hem of a swinging skirt) may graze; an X is a large angle
          const ang = (q: { a: Vec2; b: Vec2 }) => Math.atan2(q.b.y - q.a.y, q.b.x - q.a.x);
          const between = Math.abs(angleDiff180((ang(axes[i]!) * 180) / Math.PI, (ang(axes[j]!) * 180) / Math.PI));
          if (between > th.minCrossDeg) note(`${axes[i]!.slot}+${axes[j]!.slot}`, 'cross', between, f);
        }
  }
  for (const [key, w] of worst) {
    const slot = key.split('|')[0]!;
    const bad =
      (w.kind === 'axis' && w.value > th.maxAxisDeg) ||
      (w.kind === 'leave' && w.value > th.leavePx) ||
      (w.kind === 'fold' && w.value > th.maxFlippedShare) ||
      w.kind === 'cross';
    if (!bad) continue;
    const text: Record<string, string> = {
      axis: `strip '${slot}' turns ${w.value.toFixed(0)} deg away from the garment it trims (limit ${th.maxAxisDeg})`,
      leave: `strip '${slot}' leaves its garment by ${w.value.toFixed(1)} px (limit ${th.leavePx})`,
      fold: `strip '${slot}' folds over itself (${(w.value * 100).toFixed(0)} % of its triangles flipped)`,
      cross: `strips '${slot}' cross each other`,
    };
    issues.push({
      severity: 'error',
      check: 'strip',
      bone: slot,
      frame: w.frame,
      value: w.value,
      message: text[w.kind]!,
    });
  }
  return issues;
}
