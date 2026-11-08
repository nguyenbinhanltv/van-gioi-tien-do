/**
 * Pose evaluation: rest pose + clip deltas → local transforms → IK → world matrices. Headless and deterministic;
 * used by the QA sampler, the secondary-motion baker and the foot-planting solver.
 */
import {
  DEG,
  IDENTITY,
  angleDelta,
  applyMat,
  clamp,
  composeLocal,
  dist,
  matRotation,
  mulMat,
  type LocalTransform,
  type Mat,
  type Vec2,
} from './math.js';
import { sampleScalar, sampleStep, sampleVec, type Clip } from './clip.js';
import type { RigDocument } from './schema.js';

export interface PoseBone {
  readonly name: string;
  readonly local: LocalTransform;
  readonly world: Mat;
  /** World position of the bone origin. */
  readonly pos: Vec2;
  /** World position of the bone tip (origin + length along local x). */
  readonly tip: Vec2;
  /** World rotation of the local x axis, degrees. */
  readonly rotation: number;
}

export interface Pose {
  readonly bones: readonly PoseBone[];
  readonly byName: ReadonlyMap<string, PoseBone>;
  /** Visible attachment per slot (null = hidden) at this frame. */
  readonly attachments: ReadonlyMap<string, string | null>;
}

/** Rest local transform of bone `i`. */
function restLocal(rig: RigDocument, i: number): LocalTransform {
  const b = rig.bones[i]!;
  return { x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX ?? 1, scaleY: b.scaleY ?? 1 };
}

export interface EvalOptions {
  /** Extra local rotation deltas (deg) by bone name, added after the clip (used by secondary motion). */
  readonly extraRotation?: ReadonlyMap<string, number>;
  /** Skip IK (FK only). */
  readonly noIk?: boolean;
  /** Override IK target world position by bone (used by the foot-plant solver). */
  readonly overrides?: ReadonlyMap<string, Partial<LocalTransform>>;
}

export function buildWorlds(rig: RigDocument, locals: readonly LocalTransform[]): Mat[] {
  const index = new Map(rig.bones.map((b, i) => [b.name, i]));
  const worlds: Mat[] = [];
  rig.bones.forEach((b, i) => {
    const local = composeLocal(locals[i]!);
    if (b.parent === null) {
      worlds.push(local);
      return;
    }
    const pw = worlds[index.get(b.parent)!]!;
    if (b.inheritRotation === false) {
      // Keep the parent's translation + scale-free orientation only.
      worlds.push(mulMat({ ...IDENTITY, tx: pw.tx, ty: pw.ty }, local));
    } else {
      worlds.push(mulMat(pw, local));
    }
  });
  return worlds;
}

/** Evaluate the pose of `rig` playing `clip` at `frame` (fractional frames allowed). `clip` null = rest pose. */
export function evalPose(rig: RigDocument, clip: Clip | null, frame: number, opts: EvalOptions = {}): Pose {
  const index = new Map(rig.bones.map((b, i) => [b.name, i]));
  const locals: LocalTransform[] = rig.bones.map((_, i) => restLocal(rig, i));
  if (clip) {
    for (const t of clip.bones) {
      const i = index.get(t.bone);
      if (i === undefined) continue;
      let l = locals[i]!;
      if (t.translate?.length) {
        const d = sampleVec(t.translate, frame);
        l = { ...l, x: l.x + d.x, y: l.y + d.y };
      }
      if (t.rotate?.length) l = { ...l, rotation: l.rotation + sampleScalar(t.rotate, frame) };
      if (t.scale?.length) {
        const s = sampleVec(t.scale, frame);
        l = { ...l, scaleX: l.scaleX * s.x, scaleY: l.scaleY * s.y };
      }
      locals[i] = l;
    }
  }
  opts.extraRotation?.forEach((deg, name) => {
    const i = index.get(name);
    if (i !== undefined) locals[i] = { ...locals[i]!, rotation: locals[i]!.rotation + deg };
  });
  opts.overrides?.forEach((o, name) => {
    const i = index.get(name);
    if (i !== undefined) locals[i] = { ...locals[i]!, ...o };
  });

  let worlds = buildWorlds(rig, locals);
  if (!opts.noIk) {
    for (const ik of rig.ik ?? []) {
      const mixTrack = clip?.ik.find((t) => t.ik === ik.name)?.mix;
      const mix = mixTrack?.length ? sampleScalar(mixTrack, frame) : (ik.mix ?? 1);
      if (mix <= 0) continue;
      solveIk(rig, index, locals, worlds, ik.bones, ik.target, ik.bendPositive, mix);
      worlds = buildWorlds(rig, locals);
    }
  }

  const bones: PoseBone[] = rig.bones.map((b, i) => {
    const w = worlds[i]!;
    return {
      name: b.name,
      local: locals[i]!,
      world: w,
      pos: { x: w.tx, y: w.ty },
      tip: applyMat(w, { x: b.length, y: 0 }),
      rotation: matRotation(w),
    };
  });
  const attachments = new Map<string, string | null>();
  for (const s of rig.slots) attachments.set(s.name, s.attachment ?? null);
  if (clip) {
    for (const t of clip.slots) {
      if (t.attachment?.length) attachments.set(t.slot, sampleStep(t.attachment, frame));
    }
  }
  return { bones, byName: new Map(bones.map((b) => [b.name, b])), attachments };
}

/**
 * Solve a 1- or 2-bone IK chain in place by rewriting the chain bones' local rotations.
 * bendPositive: the middle joint lies on the CCW side of the line root→target (y up).
 */
function solveIk(
  rig: RigDocument,
  index: ReadonlyMap<string, number>,
  locals: LocalTransform[],
  worlds: readonly Mat[],
  chain: readonly string[],
  target: string,
  bendPositive: boolean,
  mix: number,
): void {
  const ti = index.get(target)!;
  const T: Vec2 = { x: worlds[ti]!.tx, y: worlds[ti]!.ty };
  const ai = index.get(chain[0]!)!;
  const parentRot = (i: number) => {
    const p = rig.bones[i]!.parent;
    return p === null ? 0 : matRotation(worlds[index.get(p)!]!);
  };
  const aPos: Vec2 = { x: worlds[ai]!.tx, y: worlds[ai]!.ty };

  if (chain.length === 1) {
    const want = Math.atan2(T.y - aPos.y, T.x - aPos.x) / DEG;
    const cur = locals[ai]!.rotation;
    const ikLocal = want - parentRot(ai);
    locals[ai] = { ...locals[ai]!, rotation: cur + angleDelta(cur, ikLocal) * mix };
    return;
  }

  const bi = index.get(chain[1]!)!;
  const bBone = rig.bones[bi]!;
  const l1 = Math.hypot(locals[bi]!.x, locals[bi]!.y) * Math.hypot(worlds[ai]!.a, worlds[ai]!.b);
  const l2 = bBone.length * Math.hypot(worlds[bi]!.a, worlds[bi]!.b);
  const phi = Math.atan2(locals[bi]!.y, locals[bi]!.x) / DEG;
  const d = clamp(dist(aPos, T), Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  const base = Math.atan2(T.y - aPos.y, T.x - aPos.x) / DEG;
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const offs = Math.acos(cosA) / DEG;
  const aDir = base + (bendPositive ? offs : -offs); // world direction A→B origin
  const bPos: Vec2 = { x: aPos.x + l1 * Math.cos(aDir * DEG), y: aPos.y + l1 * Math.sin(aDir * DEG) };
  const bWorldRot = Math.atan2(T.y - bPos.y, T.x - bPos.x) / DEG;

  const aWorldRot = aDir - phi;
  const aLocalIk = aWorldRot - parentRot(ai);
  const bLocalIk = bWorldRot - aWorldRot;
  const aCur = locals[ai]!.rotation;
  const bCur = locals[bi]!.rotation;
  locals[ai] = { ...locals[ai]!, rotation: aCur + angleDelta(aCur, aLocalIk) * mix };
  locals[bi] = { ...locals[bi]!, rotation: bCur + angleDelta(bCur, bLocalIk) * mix };
}

/** World position of a bone tip or origin in a pose (helper for authoring and QA). */
export function worldPoint(pose: Pose, bone: string, at: 'pos' | 'tip' = 'pos'): Vec2 {
  const b = pose.byName.get(bone);
  if (!b) throw new RangeError(`unknown bone '${bone}'`);
  return at === 'pos' ? b.pos : b.tip;
}
