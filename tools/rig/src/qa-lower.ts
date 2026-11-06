/**
 * Lower-body QA for a long-robed character. A wide stride with deep knee bend makes the legs poke out of a skirt that
 * stays a rigid plank (owner review of the E run). Three measurements per frame on the skinned meshes and bones:
 *
 *  - THIGH VISIBLE: share of the thigh area (leg mesh triangles weighted mostly to a thigh bone) NOT covered by the skirt
 *    meshes (robe front / back / inner). A robe hides the thighs; the shins and boots may show.
 *  - STRIDE WIDTH: foot separation over leg length (thigh + shin): a squat / horse stance has a wide one.
 *  - SKIRT AREA: skirt mesh area against rest: a plank that collapses or balloons changes it a lot.
 */
import type { QaIssue } from './qa.js';
import { evalPose } from './pose.js';
import { pointToMesh, visibleAttachments } from './qa-mesh.js';
import { skinAttachment, type SkinnedMesh } from './skinning.js';
import type { Clip } from './clip.js';
import type { RigDocument } from './schema.js';

export const SKIRT_SLOTS = /^robe_(front|back|inner)$/;
export const LEG_SLOTS = /^leg_[LR]$/;

export interface LowerBodyThresholds {
  /** Largest share (0..1) of the thigh area outside the skirt. */
  readonly maxThighVisible: number;
  /** Largest foot separation as a fraction of the leg length. */
  readonly maxStrideRatio: number;
  /** Allowed skirt area / rest area range. */
  readonly areaMin: number;
  readonly areaMax: number;
}

export const DEFAULT_LOWER_THRESHOLDS: LowerBodyThresholds = {
  maxThighVisible: 0.55,
  maxStrideRatio: 0.7,
  areaMin: 0.6,
  areaMax: 1.5,
};

const area = (m: SkinnedMesh) => {
  let a = 0;
  for (let t = 0; t < m.tris.length; t += 3) {
    const p = m.verts[m.tris[t]!]!;
    const q = m.verts[m.tris[t + 1]!]!;
    const r = m.verts[m.tris[t + 2]!]!;
    a += Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2;
  }
  return a;
};

export interface LowerBodyMetrics {
  readonly thighVisible: number;
  readonly strideRatio: number;
  readonly areaMin: number;
  readonly areaMax: number;
}

/** Worst values over the clip (null when the rig has no skirt or no leg meshes). */
export function lowerBodyMetrics(rig: RigDocument, clip: Clip): LowerBodyMetrics | null {
  const rest = evalPose(rig, null, 0, { noIk: true });
  const items = visibleAttachments(rig, rest);
  const skirts = items.filter((it) => SKIRT_SLOTS.test(it.slot) && it.att.type === 'mesh');
  const legs = items.filter((it) => LEG_SLOTS.test(it.slot) && it.att.type === 'mesh');
  if (!skirts.length || !legs.length) return null;
  const thighs = new Set([rig.roles.thigh_L, rig.roles.thigh_R].filter((x): x is string => !!x));
  const skirtArea = (pose: typeof rest) =>
    items
      .filter((it) => /^robe_(front|back)$/.test(it.slot) && it.att.type === 'mesh')
      .reduce((a, it) => a + area(skinAttachment(it.att, it.bone, pose, rest)), 0);
  const restArea = skirtArea(rest) || 1;
  // thigh triangles: those whose vertices are weighted mostly to a thigh bone
  const thighTris = legs.map((it) => {
    const att = it.att;
    if (att.type !== 'mesh' || !att.weights) return [] as number[];
    const picked: number[] = [];
    for (let t = 0; t < att.triangles.length; t += 3) {
      let share = 0;
      for (let k = 0; k < 3; k++)
        for (const [b, w] of att.weights[att.triangles[t + k]!] ?? []) if (thighs.has(b)) share += w;
      if (share / 3 >= 0.5) picked.push(t);
    }
    return picked;
  });
  const legLen = (() => {
    const a = rig.roles.thigh_L ? rest.byName.get(rig.roles.thigh_L) : undefined;
    const b = rig.roles.shin_L ? rest.byName.get(rig.roles.shin_L) : undefined;
    return a && b
      ? Math.hypot(a.tip.x - a.pos.x, a.tip.y - a.pos.y) + Math.hypot(b.tip.x - b.pos.x, b.tip.y - b.pos.y)
      : 40;
  })();
  let thighVisible = 0;
  let stride = 0;
  let aMin = Infinity;
  let aMax = 0;
  for (let f = 0; f <= clip.frames; f++) {
    const pose = evalPose(rig, clip, f);
    const skirtMeshes = skirts.map((it) => skinAttachment(it.att, it.bone, pose, rest));
    let total = 0;
    let outside = 0;
    legs.forEach((it, i) => {
      const m = skinAttachment(it.att, it.bone, pose, rest);
      for (const t of thighTris[i]!) {
        const [a, b, c] = [m.verts[m.tris[t]!]!, m.verts[m.tris[t + 1]!]!, m.verts[m.tris[t + 2]!]!];
        const centre = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
        total++;
        if (!skirtMeshes.some((sm) => pointToMesh(centre, sm.verts, sm.tris) <= 0.5)) outside++;
      }
    });
    if (total) thighVisible = Math.max(thighVisible, outside / total);
    const fl = rig.roles.foot_L ? pose.byName.get(rig.roles.foot_L) : undefined;
    const fr = rig.roles.foot_R ? pose.byName.get(rig.roles.foot_R) : undefined;
    if (fl && fr) stride = Math.max(stride, Math.hypot(fl.pos.x - fr.pos.x, fl.pos.y - fr.pos.y) / legLen);
    const r = skirtArea(pose) / restArea;
    aMin = Math.min(aMin, r);
    aMax = Math.max(aMax, r);
  }
  return { thighVisible, strideRatio: stride, areaMin: aMin, areaMax: aMax };
}

export function lowerBodyQa(rig: RigDocument, clip: Clip, thresholds: Partial<LowerBodyThresholds> = {}): QaIssue[] {
  const th = { ...DEFAULT_LOWER_THRESHOLDS, ...thresholds };
  const m = lowerBodyMetrics(rig, clip);
  if (!m) return [];
  const out: QaIssue[] = [];
  const add = (message: string, value: number) => out.push({ severity: 'error', check: 'lower-body', message, value });
  if (m.thighVisible > th.maxThighVisible)
    add(
      `${(m.thighVisible * 100).toFixed(0)} % of the thigh area is outside the skirt (limit ${(th.maxThighVisible * 100).toFixed(0)} %)`,
      m.thighVisible,
    );
  if (m.strideRatio > th.maxStrideRatio)
    add(
      `the feet get ${m.strideRatio.toFixed(2)} leg lengths apart: a squat stride under a long robe (limit ${th.maxStrideRatio})`,
      m.strideRatio,
    );
  if (m.areaMin < th.areaMin || m.areaMax > th.areaMax)
    add(
      `the skirt area changes to ${m.areaMin.toFixed(2)}-${m.areaMax.toFixed(2)} of rest (allowed ${th.areaMin}-${th.areaMax}): a collapsing or ballooning plank`,
      Math.max(1 - m.areaMin, m.areaMax - 1),
    );
  return out;
}
