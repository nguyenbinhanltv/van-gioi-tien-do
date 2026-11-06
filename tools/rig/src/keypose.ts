/**
 * AI key-pose reference step (owner decision 2026-11-06): the lower body of the hand-authored gait looked crippled, so the
 * poses come from painted full-body reference images (one per key pose, same style / scale as the master) with measured
 * landmarks, and the skeletal rig is FITTED to them:
 *
 *  - `fitPose(rig, landmarks, view)` solves the bone rotations (FK aiming along the landmark segments), the hips offset,
 *    the IK foot targets and the skirt panel angles that reproduce one key pose, and reports the fit error per landmark;
 *  - `authorFromKeyPoses(rig, spec)` places the fitted keys at the clip timing, interpolates with easing, keeps the feet
 *    planted where the key labels say so, and returns a normal `Clip` (the detail layer, secondary springs, blink and
 *    hand / mouth swaps are applied by the caller exactly as for the hand-authored clips);
 *  - `silhouetteIoU` compares the rendered rig pose with the reference image (the acceptance number of the step).
 *
 * Landmarks are in the key-pose image space of docs/art/rig-continuous-parts.md: px @2x, x right, y DOWN, origin top-left
 * of the 256 canvas. Names follow the Kiếm tu landmark contract plus root, chest, pelvis, hand_L/R, sword_tip, hem_*.
 */
import { CLIP_FPS, type BoneTrack, type Clip, type ClipEvent, type Key } from './clip.js';
import { RUN_SPEED_PX_S, WALK_SPEED_PX_S, armsFk, viewGain } from './kiemtu.js';
import { screenAxis } from './locomotion.js';
import { angleDelta, cubicBezierEase, dist, type Vec2 } from './math.js';
import { simplifyScalar } from './secondary.js';
import { evalPose, type Pose } from './pose.js';
import type { CanvasView } from './limb.js';
import { landmarkToRig, type Landmarks } from './landmarks.js';
import { visibleAttachments } from './qa-mesh.js';
import type { RigDocument } from './schema.js';
import { skinAttachment } from './skinning.js';
import type { Image } from './render/image.js';
import { renderPose, type LoadedAtlas } from './render/render.js';
import { DEFAULT_IGNORED_SLOTS } from './render/silhouette.js';

export interface KeyPoseLandmarks {
  readonly [name: string]: readonly [number, number] | readonly string[] | undefined;
  /** Joints that were occluded in the reference image and only guessed: they get no weight in the fit. */
  readonly _inferred?: readonly string[];
}

/** One fitted key pose: deltas from the rest pose, ready to key into a clip. */
export interface PoseFit {
  /** Local rotation delta (deg) per bone, from the rest rotation. */
  readonly rotations: Readonly<Record<string, number>>;
  /** Hips translation delta (rig px, y up). */
  readonly hips: Vec2;
  /** IK foot target translation deltas (rig px, y up) per IK target bone. */
  readonly feet: Readonly<Record<string, Vec2>>;
  /** Landmark → distance (px @1x) between the fitted rig and the reference landmark. */
  readonly error: Readonly<Record<string, number>>;
  readonly maxError: number;
  /** Root-mean-square of the landmark errors (rig px): the per-key gate is RMS <= 2. */
  readonly rms: number;
  /** Body translation (rig px, y up) the fit added to reach the ankles: shift the reference by it before comparing. */
  readonly shift: Vec2;
  /** Bones whose reference segment length differs from the rig bone by more than 5 %. */
  readonly lengthMismatch: readonly string[];
}

export interface FitOptions {
  /** Panel bone → landmark it aims at (E view: front flap at the right hem, back flap at the left hem). */
  readonly panels?: Readonly<Record<string, string>>;
  /** Largest panel swing from rest (deg). Default 38 (same as `skirtFollowsLegs`). */
  readonly panelLimit?: number;
}

const DEFAULT_PANELS = { robe_front: 'hem_right', robe_back: 'hem_left' } as const;

const toRig = (l: KeyPoseLandmarks, name: string, view: CanvasView): Vec2 | null => {
  const v = l[name];
  return v && v.length === 2 && typeof v[0] === 'number' ? landmarkToRig(v as readonly [number, number], view) : null;
};

const wrap = (a: number) => angleDelta(0, a);

/** Where a 2-bone chain (lengths l1, l2) from `s` puts its middle joint so the tip reaches `w`; the solution nearer `hint`. */
export function twoBoneJoint(s: Vec2, w: Vec2, l1: number, l2: number, hint: Vec2, side?: 1 | -1): Vec2 {
  const dx = w.x - s.x;
  const dy = w.y - s.y;
  const raw = Math.hypot(dx, dy);
  const d = Math.min(Math.max(raw, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const ux = raw > 1e-9 ? dx / raw : 1;
  const uy = raw > 1e-9 ? dy / raw : 0;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mx = s.x + ux * a;
  const my = s.y + uy * a;
  const p1 = { x: mx - uy * h, y: my + ux * h };
  const p2 = { x: mx + uy * h, y: my - ux * h };
  if (side !== undefined) {
    // keep the bend on the rest-pose side of the shoulder-to-wrist line: consecutive keys never flip the elbow
    const sign = (p: Vec2) => Math.sign((w.x - s.x) * (p.y - s.y) - (w.y - s.y) * (p.x - s.x));
    const ok1 = sign(p1) === side;
    const ok2 = sign(p2) === side;
    if (ok1 !== ok2) return ok1 ? p1 : p2;
  }
  return dist(p1, hint) <= dist(p2, hint) ? p1 : p2;
}

/**
 * Fit `rig` to one key pose, solved in hierarchical order so every stage sees the fitted parents:
 *  1. pelvis: hips translation to the pelvis landmark, lowered if a leg could not reach its ankle landmark;
 *  2. spine / neck: aimed along the landmark directions (pelvis, chest, neck, head), the head stays upright;
 *  3. arms: the fitted torso gives the shoulder positions, then a 2-bone analytic IK puts each wrist ON its landmark, the
 *     elbow on the side of the elbow landmark (bone lengths stay the rig lengths);
 *  4. legs: IK foot targets on the ankle landmarks (the knee comes from the IK bend), then the foot aims at the toe;
 *  5. sword and skirt panels, after the legs: the sword along hand to sword tip, the front / back flap at the hem points.
 * The body is rigid: when the pelvis is lowered to make the legs reach, arm / head targets move with it (`shift`).
 * Throws when a landmark needed for the skeleton is missing.
 */
export function fitPose(rig: RigDocument, lm: KeyPoseLandmarks, view: CanvasView, opts: FitOptions = {}): PoseFit {
  const r = rig.roles;
  const get = (n: string) => toRig(lm, n, view);
  const need = (n: string) => {
    const p = get(n);
    if (!p) throw new RangeError(`key pose: landmark '${n}' is missing`);
    return p;
  };
  const inferred = new Set((lm._inferred as readonly string[] | undefined) ?? []);
  const rest = evalPose(rig, null, 0, { noIk: true });
  const restWorld = (b: string) => rest.byName.get(b)!;
  const parentOf = new Map(rig.bones.map((b) => [b.name, b.parent]));
  const restLocal = new Map(rig.bones.map((b) => [b.name, b.rotation]));
  const lengthOf = (b: string) => rig.bones.find((x) => x.name === b)!.length;
  const worldRot = new Map<string, number>(); // fitted world rotation (deg) of the bones solved so far
  const rotations: Record<string, number> = {};
  const parentRotOf = (bone: string) => {
    const parent = parentOf.get(bone);
    return parent ? (worldRot.get(parent) ?? restWorld(parent).rotation) : 0;
  };
  const deg = (v: Vec2) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
  const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
  /** Rotate `bone` so its axis points along `dir` (world), given the already fitted parent. */
  const aimDir = (bone: string, dir: Vec2): void => {
    const parentRot = parentRotOf(bone);
    const delta = wrap(deg(dir) - parentRot - restLocal.get(bone)!);
    rotations[bone] = delta;
    worldRot.set(bone, parentRot + restLocal.get(bone)! + delta);
  };
  const keep = (bone: string): void => {
    rotations[bone] = 0;
    worldRot.set(bone, parentRotOf(bone) + restLocal.get(bone)!);
  };
  const evalFit = (hips: Vec2, feet: Record<string, Vec2>) => evalPose(rig, clipOf(rig, { rotations, hips, feet }), 0);

  // 1. pelvis (hips translation) and leg reach
  const hipsBone = r.hips!;
  const pelvis = need('pelvis');
  const hipsRest = restWorld(hipsBone).pos;
  let hips = { x: pelvis.x - hipsRest.x, y: pelvis.y - hipsRest.y };
  const wanted = { ...hips };
  for (const s of ['R', 'L'] as const) {
    const thigh = r[`thigh_${s}` as 'thigh_R']!;
    const shin = r[`shin_${s}` as 'shin_R']!;
    const ankle = get(`ankle_${s}`);
    if (!ankle) continue;
    const reach = (lengthOf(thigh) + lengthOf(shin)) * 0.995;
    const hipPos = { x: restWorld(thigh).pos.x + hips.x, y: restWorld(thigh).pos.y + hips.y };
    const dx = hipPos.x - ankle.x;
    const d = Math.hypot(dx, hipPos.y - ankle.y);
    if (d > reach && Math.abs(dx) < reach) {
      // lower the pelvis until the leg is just straight
      const y = ankle.y + Math.sqrt(reach * reach - dx * dx);
      hips = { x: hips.x, y: hips.y - (hipPos.y - y) };
    }
  }
  const shift = { x: hips.x - wanted.x, y: hips.y - wanted.y };
  const moved = (p: Vec2): Vec2 => ({ x: p.x + shift.x, y: p.y + shift.y });
  keep(hipsBone);

  // 2. spine, neck, head: aimed along the landmark directions
  aimDir(r.spine_mid!, sub(need('chest'), pelvis));
  aimDir(r.spine_upper!, sub(need('neck'), need('chest')));
  const neckBone = rig.bones.find((b) => b.name === 'neck')?.name;
  if (neckBone) aimDir(neckBone, sub(need('head'), need('neck')));
  if (r.head) {
    // upright in canvas space: cancel whatever the parents turned
    const base = restWorld(r.head).rotation;
    rotations[r.head] = wrap(base - parentRotOf(r.head) - restLocal.get(r.head)!);
    worldRot.set(r.head, base);
  }
  const torso = evalFit(hips, {});

  // 3. arms: 2-bone IK to the wrist landmarks from the fitted shoulder positions
  for (const s of ['R', 'L'] as const) {
    const up = r[`upper_arm_${s}` as 'upper_arm_R']!;
    const lo = r[`lower_arm_${s}` as 'lower_arm_R']!;
    const hand = r[`hand_${s}` as 'hand_R'];
    const wrist = get(`wrist_${s}`);
    const shoulder = torso.byName.get(up)!.pos;
    if (wrist) {
      const elbowHint = get(`elbow_${s}`);
      const hint = elbowHint ? moved(elbowHint) : { x: shoulder.x, y: shoulder.y - lengthOf(up) };
      // bend side of the rest pose (cross of shoulder-to-wrist and shoulder-to-elbow)
      const rs = restWorld(up).pos;
      const rw = restWorld(lo).tip;
      const re = restWorld(lo).pos;
      const side = Math.sign((rw.x - rs.x) * (re.y - rs.y) - (rw.y - rs.y) * (re.x - rs.x));
      const elbow = twoBoneJoint(
        shoulder,
        moved(wrist),
        lengthOf(up),
        lengthOf(lo),
        hint,
        side === 0 ? undefined : (side as 1 | -1),
      );
      aimDir(up, sub(elbow, shoulder));
      aimDir(lo, sub(moved(wrist), elbow));
    } else {
      keep(up);
      keep(lo);
    }
    if (hand) keep(hand);
  }

  // 4. legs: IK targets on the ankles
  const feet: Record<string, Vec2> = {};
  for (const s of ['R', 'L'] as const) {
    const ik = r[`ik_foot_${s}` as 'ik_foot_R']!;
    const ankle = need(`ankle_${s}`);
    const target = restWorld(ik).pos;
    feet[ik] = { x: ankle.x - target.x, y: ankle.y - target.y };
  }
  // 5. skirt panels (after the legs): the flaps at the hem points
  const panelLimit = opts.panelLimit ?? 50;
  const restItems = visibleAttachments(rig, rest);
  /**
   * The hem landmarks are the OUTER EDGE of the robe, not the panel bone axis: measure where that edge sits on the rig at
   * rest (the lowest point of the panel's mesh on its outer side: front = right, back = left) and turn the panel by the
   * change of its direction from the pivot, not by the absolute direction of the landmark.
   */
  const restHem = (panel: string): Vec2 | null => {
    const it = restItems.find((x) => x.slot === panel && x.att.type === 'mesh');
    if (!it) return null;
    const m = skinAttachment(it.att, it.bone, rest, rest);
    const ys = m.verts.map((v) => v.y);
    const low = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.15;
    const bottom = m.verts.filter((v) => v.y <= low);
    if (!bottom.length) return null;
    return /back/i.test(panel)
      ? bottom.reduce((a, v) => (v.x < a.x ? v : a))
      : bottom.reduce((a, v) => (v.x > a.x ? v : a));
  };
  for (const [panel, lmName] of Object.entries(opts.panels ?? DEFAULT_PANELS)) {
    if (!rig.bones.some((b) => b.name === panel)) continue;
    const target = get(lmName);
    if (!target) continue;
    const origin = restWorld(panel).pos;
    const hem = restHem(panel);
    const pivot = { x: origin.x + hips.x, y: origin.y + hips.y };
    const now = deg(sub(moved(target), pivot));
    // without a measurable rest hem fall back to the panel axis (the landmark is then taken as its tip)
    const was = hem ? deg(sub(hem, origin)) : restWorld(panel).rotation;
    const delta = Math.max(-panelLimit, Math.min(panelLimit, wrap(now - was)));
    rotations[panel] = delta;
    worldRot.set(panel, parentRotOf(panel) + restLocal.get(panel)! + delta);
  }
  // the feet aim at the toes and the sword along the hand, against the IK-solved legs
  const draft = evalFit(hips, feet);
  for (const s of ['R', 'L'] as const) {
    const foot = r[`foot_${s}` as 'foot_R']!;
    const tip = get(`foot_tip_${s}`);
    const ankle = get(`ankle_${s}`);
    if (tip && ankle && !inferred.has(`foot_tip_${s}`)) {
      const parentRot = draft.byName.get(parentOf.get(foot)!)!.rotation;
      rotations[foot] = wrap(deg(sub(tip, ankle)) - parentRot - restLocal.get(foot)!);
    }
  }
  const weapon = rig.bones.find((b) => b.name === 'weapon')?.name;
  const sword = get('sword_tip');
  if (sword && weapon && r.hand_R && !inferred.has('sword_tip')) {
    const hp = draft.byName.get(r.hand_R)!;
    rotations[weapon] = wrap(deg(sub(moved(sword), hp.pos)) - hp.rotation - restLocal.get(weapon)!);
  }

  // error + length check against the final pose (body landmarks move with the pelvis shift, ankles / toes do not)
  const final = evalFit(hips, feet);
  const error: Record<string, number> = {};
  const check = (name: string, p: Vec2, body = true) => {
    const ref = get(name);
    if (ref && !inferred.has(name)) error[name] = dist(body ? moved(ref) : ref, p);
  };
  for (const s of ['R', 'L'] as const) {
    check(`wrist_${s}`, final.byName.get(r[`lower_arm_${s}` as 'lower_arm_R']!)!.tip);
    check(`elbow_${s}`, final.byName.get(r[`lower_arm_${s}` as 'lower_arm_R']!)!.pos);
    check(`shoulder_${s}`, final.byName.get(r[`upper_arm_${s}` as 'upper_arm_R']!)!.pos);
    check(`hip_${s}`, final.byName.get(r[`thigh_${s}` as 'thigh_R']!)!.pos);
    check(`knee_${s}`, final.byName.get(r[`shin_${s}` as 'shin_R']!)!.pos);
    check(`ankle_${s}`, final.byName.get(r[`foot_${s}` as 'foot_R']!)!.pos, false);
    check(`foot_tip_${s}`, final.byName.get(r[`foot_${s}` as 'foot_R']!)!.tip, false);
  }
  check('chest', final.byName.get(r.spine_upper!)!.pos);
  check('neck', final.byName.get(neckBone ?? r.spine_upper!)!.pos);
  check('head', final.byName.get(neckBone ?? r.spine_upper!)!.tip);
  const lengthMismatch: string[] = [];
  const seg = (bone: string, a: string, b: string) => {
    const pa = get(a);
    const pb = get(b);
    const rb = rig.bones.find((x) => x.name === bone);
    if (pa && pb && rb && rb.length > 1 && Math.abs(dist(pa, pb) - rb.length) / rb.length > 0.05)
      lengthMismatch.push(bone);
  };
  for (const s of ['R', 'L'] as const) {
    seg(r[`upper_arm_${s}` as 'upper_arm_R']!, `shoulder_${s}`, `elbow_${s}`);
    seg(r[`lower_arm_${s}` as 'lower_arm_R']!, `elbow_${s}`, `wrist_${s}`);
    seg(r[`thigh_${s}` as 'thigh_R']!, `hip_${s}`, `knee_${s}`);
    seg(r[`shin_${s}` as 'shin_R']!, `knee_${s}`, `ankle_${s}`);
  }
  const values = Object.values(error);
  return {
    rotations,
    hips,
    feet,
    shift,
    error,
    maxError: Math.max(0, ...values),
    rms: values.length ? Math.sqrt(values.reduce((a, v) => a + v * v, 0) / values.length) : 0,
    lengthMismatch,
  };
}

/** A one-frame clip holding a fit (used to evaluate it). */
function clipOf(rig: RigDocument, fit: Pick<PoseFit, 'rotations' | 'hips' | 'feet'>): Clip {
  const bones: BoneTrack[] = [];
  for (const [bone, v] of Object.entries(fit.rotations)) bones.push({ bone, rotate: [{ frame: 0, value: v }] });
  const add = (bone: string, v: Vec2) => {
    const i = bones.findIndex((t) => t.bone === bone);
    const track = { translate: [{ frame: 0, value: v }] };
    if (i >= 0) bones[i] = { ...bones[i]!, ...track };
    else bones.push({ bone, ...track });
  };
  if (rig.roles.hips) add(rig.roles.hips, fit.hips);
  for (const [bone, v] of Object.entries(fit.feet)) add(bone, v);
  // the fit is FK on the arms: the rig's default hand IK would override it
  return armsFk(rig, { name: 'fit', frames: 1, loop: false, bones, slots: [], ik: [], events: [] });
}

/** Landmarks of a rig pose (the inverse of `fitPose`: used by tests and by the QA of authored clips), image space @2x. */
export function landmarksFromPose(rig: RigDocument, pose: Pose, view: CanvasView): Landmarks {
  const r = rig.roles;
  const px = (p: Vec2): [number, number] => [(view.pivot[0] + p.x) * view.scale, (view.pivot[1] - p.y) * view.scale];
  const at = (bone: string, which: 'pos' | 'tip') => px(pose.byName.get(bone)![which]);
  const out: Record<string, [number, number]> = {
    pelvis: at(r.hips!, 'pos'),
    chest: at(r.spine_upper!, 'pos'),
    neck: at(rig.bones.find((b) => b.name === 'neck')?.name ?? r.spine_upper!, 'pos'),
    head: at(rig.bones.find((b) => b.name === 'neck')?.name ?? r.spine_upper!, 'tip'),
  };
  for (const s of ['R', 'L'] as const) {
    out[`shoulder_${s}`] = at(r[`upper_arm_${s}` as 'upper_arm_R']!, 'pos');
    out[`elbow_${s}`] = at(r[`lower_arm_${s}` as 'lower_arm_R']!, 'pos');
    out[`wrist_${s}`] = at(r[`lower_arm_${s}` as 'lower_arm_R']!, 'tip');
    out[`hip_${s}`] = at(r[`thigh_${s}` as 'thigh_R']!, 'pos');
    out[`knee_${s}`] = at(r[`shin_${s}` as 'shin_R']!, 'pos');
    out[`ankle_${s}`] = at(r[`foot_${s}` as 'foot_R']!, 'pos');
    out[`foot_tip_${s}`] = at(r[`foot_${s}` as 'foot_R']!, 'tip');
  }
  const weapon = rig.bones.find((b) => b.name === 'weapon');
  if (weapon) out.sword_tip = at('weapon', 'tip');
  for (const [panel, name] of [
    ['robe_front', 'hem_right'],
    ['robe_back', 'hem_left'],
  ] as const)
    if (rig.bones.some((b) => b.name === panel)) out[name] = at(panel, 'tip');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// clip authoring

export interface KeyPoseKey {
  readonly fit: PoseFit;
  /** Frame (30 fps) of this key in the clip. */
  readonly frame: number;
  /** Which feet are planted at this key (contact / down). */
  readonly planted?: { readonly L?: boolean; readonly R?: boolean };
}

export interface KeyPoseClipSpec {
  readonly name: string;
  /** Duration in frames: from the animation table of @vgtd/character (run 15, walk 20, ...). */
  readonly frames: number;
  readonly loop: boolean;
  readonly keys: readonly KeyPoseKey[];
  /** Ease between keys (CSS bezier). Default ease in-out. */
  readonly ease?: readonly [number, number, number, number];
  /** Authored ground speed (px/s): the table movement speed for locomotion clips. Default: from the planted feet. */
  readonly speed?: number;
  /** Events and phases of the animation table (footsteps, hit, cancel window). */
  readonly events?: readonly ClipEvent[];
  readonly phases?: Readonly<Record<string, number>>;
}

const EASE_IN_OUT = [0.42, 0, 0.58, 1] as const;

/** Place fitted key poses at their frames and interpolate: a normal `Clip` (loops close on the first key). */
export function authorFromKeyPoses(rig: RigDocument, spec: KeyPoseClipSpec): Clip {
  if (!spec.keys.length) throw new RangeError('authorFromKeyPoses needs at least one key pose');
  const ease = spec.ease ?? EASE_IN_OUT;
  const keys = [...spec.keys].sort((a, b) => a.frame - b.frame);
  const N = spec.frames;
  /** The two keys around frame `f` and the eased position between them (cyclic for loops, held at the ends otherwise). */
  const around = (f: number) => {
    let ia = -1;
    keys.forEach((k, i) => {
      if (k.frame <= f) ia = i;
    });
    if (spec.loop) {
      const a = ia >= 0 ? keys[ia]! : keys[keys.length - 1]!;
      const aFrame = ia >= 0 ? a.frame : a.frame - N;
      const b = ia + 1 < keys.length ? keys[ia + 1]! : keys[0]!;
      const bFrame = ia + 1 < keys.length ? b.frame : b.frame + N;
      const span = bFrame - aFrame || 1;
      const raw = (f - aFrame) / span;
      return { a, b, t: cubicBezierEase(ease[0], ease[1], ease[2], ease[3], raw), raw };
    }
    if (ia < 0) return { a: keys[0]!, b: keys[0]!, t: 0, raw: 0 };
    if (ia + 1 >= keys.length) return { a: keys[ia]!, b: keys[ia]!, t: 0, raw: 0 };
    const a = keys[ia]!;
    const b = keys[ia + 1]!;
    const raw = (f - a.frame) / (b.frame - a.frame || 1);
    return { a, b, t: cubicBezierEase(ease[0], ease[1], ease[2], ease[3], raw), raw };
  };
  const bones = new Set(keys.flatMap((k) => Object.keys(k.fit.rotations)));
  const tracks: BoneTrack[] = [];
  const rotation = (bone: string, f: number) => {
    const { a, b, t } = around(f);
    const va = a.fit.rotations[bone] ?? 0;
    const vb = b.fit.rotations[bone] ?? 0;
    return va + angleDelta(va, vb) * t; // shortest way round between neighbouring keys
  };
  for (const bone of bones) {
    const dense: Key<number>[] = Array.from({ length: N + 1 }, (_, f) => ({ frame: f, value: rotation(bone, f) }));
    tracks.push({ bone, rotate: simplifyScalar(dense, 0.05) });
  }
  /** Translation keys; `foot` makes the move linear while that foot is planted at both keys (constant ground speed). */
  const vec = (pick: (k: KeyPoseKey) => Vec2, foot?: 'L' | 'R'): Key<Vec2>[] =>
    Array.from({ length: N + 1 }, (_, f) => {
      const { a, b, t, raw } = around(f);
      const u = foot && a.planted?.[foot] && b.planted?.[foot] ? raw : t;
      const va = pick(a);
      const vb = pick(b);
      return { frame: f, value: { x: va.x + (vb.x - va.x) * u, y: va.y + (vb.y - va.y) * u } };
    });
  const merge = (bone: string, translate: Key<Vec2>[]) => {
    const i = tracks.findIndex((t) => t.bone === bone);
    if (i >= 0) tracks[i] = { ...tracks[i]!, translate };
    else tracks.push({ bone, translate });
  };
  if (rig.roles.hips)
    merge(
      rig.roles.hips,
      vec((k) => k.fit.hips),
    );
  const feet = Object.keys(keys[0]!.fit.feet);
  const footKeys = new Map<string, Key<Vec2>[]>();
  for (const ik of feet) {
    const k = vec((x) => x.fit.feet[ik]!, ik === rig.roles.ik_foot_L ? 'L' : 'R');
    footKeys.set(ik, k);
    merge(ik, k);
  }
  // a foot counts as planted from one key to the next only when it is planted at BOTH (the lift-off interval is a swing)
  const plant = (foot: 'L' | 'R') => {
    const out: boolean[] = [];
    for (let f = 0; f <= N; f++) {
      const { a, b } = around(f);
      out.push(!!(a.planted?.[foot] && b.planted?.[foot]));
    }
    return out;
  };
  const planted = { [rig.roles.foot_L!]: plant('L'), [rig.roles.foot_R!]: plant('R') };
  // authored ground speed: how fast a planted foot target travels (the foot-slide QA and the runtime timeScale use it)
  const speeds: number[] = [];
  for (const [bone, flags] of Object.entries(planted)) {
    const ik = bone === rig.roles.foot_L ? rig.roles.ik_foot_L! : rig.roles.ik_foot_R!;
    const k = footKeys.get(ik);
    if (!k) continue;
    for (let f = 0; f < N; f++)
      if (flags[f] && flags[f + 1])
        speeds.push(Math.hypot(k[f + 1]!.value.x - k[f]!.value.x, k[f + 1]!.value.y - k[f]!.value.y) * CLIP_FPS);
  }
  speeds.sort((x, y) => x - y);
  // the table speed when the caller gives it (locomotion clips), else the speed the planted feet travel at
  const speed = spec.speed ?? (speeds.length ? speeds[Math.floor(speeds.length / 2)]! : 0);
  return armsFk(rig, {
    name: spec.name,
    frames: N,
    loop: spec.loop,
    bones: tracks,
    slots: [],
    ik: [],
    events: spec.events ? [...spec.events] : [],
    ...(spec.phases ? { phases: spec.phases } : {}),
    motion: { speed, planted },
  });
}

/** Key frames of an N-key cycle spread evenly over `frames` (run: 8 keys over 15 frames). */
export function evenKeyFrames(count: number, frames: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((i * frames) / count));
}

// ---------------------------------------------------------------------------------------------------------------------
// acceptance: silhouette IoU against the reference image

export interface IouOptions {
  /** Alpha at or above which a pixel counts as body. Default 128. */
  readonly alpha?: number;
  /** Slots left out of the rendered side (sword trail, shadow). */
  readonly ignoreSlots?: readonly string[];
}

/**
 * Intersection over union of the opaque areas of two images of the same size; `b` is translated by (dx, dy) px first
 * (image space, y down). Optional `rows` limits the comparison to an image row range [y0, y1).
 */
export function maskIoU(a: Image, b: Image, alpha = 128, dx = 0, dy = 0, rows?: readonly [number, number]): number {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError('maskIoU needs images of the same size');
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  let inter = 0;
  let uni = 0;
  const y0 = rows ? Math.max(0, Math.floor(rows[0])) : 0;
  const y1 = rows ? Math.min(a.height, Math.ceil(rows[1])) : a.height;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < a.width; x++) {
      const sx = x - ox;
      const sy = y - oy;
      const inB = sx >= 0 && sy >= 0 && sx < b.width && sy < b.height && b.data[(sy * b.width + sx) * 4 + 3]! >= alpha;
      const inA = a.data[(y * a.width + x) * 4 + 3]! >= alpha;
      if (inA && inB) inter++;
      if (inA || inB) uni++;
    }
  return uni ? inter / uni : 1;
}

export interface IouOptions2 extends IouOptions {
  /** Body shift of the fit (rig px, y up): the reference is translated by it so both sides show the same pose. */
  readonly shift?: Vec2;
  /** Image-row bands (px @2x) to report separately (head / torso / skirt and legs). */
  readonly bands?: readonly (readonly [number, number])[];
}

/** The rig silhouette rendered on the reference canvas (transparent, no ground). */
export function renderSilhouette(
  rig: RigDocument,
  clip: Clip,
  frame: number,
  atlas: LoadedAtlas,
  size: number,
  ignore?: readonly string[],
): Image {
  return renderPose(rig, evalPose(rig, clip, frame), atlas, {
    scale: size / rig.canvas.width,
    background: [0, 0, 0, 0],
    ground: false,
    hideSlots: ignore ?? DEFAULT_IGNORED_SLOTS,
  });
}

/** Render the rig at `frame` of `clip` on the reference canvas and return its IoU with `reference` (and per band). */
export function silhouetteIoU(
  rig: RigDocument,
  clip: Clip,
  frame: number,
  atlas: LoadedAtlas,
  reference: Image,
  opts: IouOptions2 = {},
): number {
  return silhouetteIoUDetail(rig, clip, frame, atlas, reference, opts).iou;
}

export function silhouetteIoUDetail(
  rig: RigDocument,
  clip: Clip,
  frame: number,
  atlas: LoadedAtlas,
  reference: Image,
  opts: IouOptions2 = {},
): { iou: number; bands: number[] } {
  const img = renderSilhouette(rig, clip, frame, atlas, reference.width, opts.ignoreSlots);
  const scale = reference.width / rig.canvas.width;
  const dx = (opts.shift?.x ?? 0) * scale;
  const dy = -(opts.shift?.y ?? 0) * scale;
  const alpha = opts.alpha ?? 128;
  return {
    iou: maskIoU(img, reference, alpha, dx, dy),
    bands: (opts.bands ?? []).map((band) => maskIoU(img, reference, alpha, dx, dy, band)),
  };
}

/** Frames per second the key frames are expressed in. */
export const KEYPOSE_FPS = CLIP_FPS;

// ---------------------------------------------------------------------------------------------------------------------
// clip set from key poses

/** Clip name -> key-pose labels in cycle order (the naming of the reference files: `<clip>_<NN>_<label>`). */
export const KEYPOSE_LABELS: Readonly<Record<string, readonly string[]>> = {
  run: ['R_contact', 'R_down', 'R_passing', 'R_up', 'L_contact', 'L_down', 'L_passing', 'L_up'],
  walk: ['R_contact', 'R_down', 'R_passing', 'R_up', 'L_contact', 'L_down', 'L_passing', 'L_up'],
  dash: ['start', 'reach', 'end'],
  attack: ['anticipation', 'strike', 'follow'],
  attack_2: ['anticipation', 'strike', 'follow'],
  attack_3: ['anticipation', 'strike', 'follow'],
  cast: ['gather', 'release', 'hold'],
  idle: ['in', 'out'],
};

/** Planted feet per key of a cycle (contact and down keys plant the named foot; passing / up lift it). */
const PLANT: Readonly<Record<string, readonly { L?: boolean; R?: boolean }[]>> = {
  run: [{ R: true }, { R: true }, { R: true }, {}, { L: true }, { L: true }, { L: true }, {}],
  walk: [
    { R: true, L: true },
    { R: true },
    { R: true },
    { R: true },
    { R: true, L: true },
    { L: true },
    { L: true },
    { L: true },
  ],
};

/**
 * Key frames of a clip: cycles spread their keys evenly (run 8 over 15, walk 8 over 20); one-shot clips use the phases of
 * the animation table (attack: anticipation at windup_end, strike at hit_frame, follow at combo_window). One-shot clips
 * ease in from the rest pose at frame 0 and back to it at the end.
 */
export function keyPoseFrames(
  clip: string,
  frames: number,
  phases?: Readonly<Record<string, number>>,
  events?: readonly ClipEvent[],
): number[] {
  const labels = KEYPOSE_LABELS[clip];
  if (!labels) throw new RangeError(`no key-pose labels for clip '${clip}'`);
  if (clip === 'run' || clip === 'walk') {
    // the R contact key lands on the table's footstep_R frame, so the footstep events and the planted feet agree
    const offset = events?.find((e) => e.name === 'footstep_R')?.frame ?? 0;
    // even spacing, NOT rounded to whole frames: uneven spacing makes the wrap interval fast and hitches the loop seam
    return labels.map((_, i) => ((((i * frames) / labels.length + offset) % frames) + frames) % frames);
  }
  if (clip === 'idle') return evenKeyFrames(labels.length, frames);
  if (clip.startsWith('attack'))
    return [phases?.windup_end ?? 4, phases?.hit_frame ?? 6, phases?.combo_window ?? 9].map((f) =>
      Math.min(frames - 1, f),
    );
  if (clip === 'cast')
    return [Math.round(frames * 0.25), phases?.windup_end ?? Math.round(frames * 0.45), Math.round(frames * 0.8)];
  return [Math.round(frames * 0.1), Math.round(frames * 0.45), Math.round(frames * 0.8)]; // dash
}

/** The ground speed (px/s along the facing, screen space) of the clip in the animation table: what the runtime moves at. */
export function tableGroundSpeed(rig: RigDocument, clip: string): number | null {
  const g = viewGain(rig.direction);
  if (clip === 'run') return RUN_SPEED_PX_S * g;
  if (clip === 'walk') return WALK_SPEED_PX_S * g;
  return null;
}

/** Ground speed (px/s, positive) the drawings imply: the median speed at which the planted foot targets move back. */
export function impliedGroundSpeed(
  rig: RigDocument,
  clip: string,
  fits: readonly PoseFit[],
  at: readonly number[],
  frames: number,
): number | null {
  const plant = PLANT[clip];
  if (!plant) return null;
  const axis = screenAxis(rig.direction);
  const along = (p: Vec2) => p.x * axis.x + p.y * axis.y;
  const slopes: number[] = [];
  for (const [foot, ik] of [
    ['L', rig.roles.ik_foot_L!],
    ['R', rig.roles.ik_foot_R!],
  ] as const)
    for (let i = 0; i < fits.length; i++) {
      const j = (i + 1) % fits.length;
      if (!plant[i]?.[foot] || !plant[j]?.[foot]) continue;
      const dt = (((at[j]! - at[i]!) % frames) + frames) % frames;
      if (dt > 0) slopes.push(-(along(fits[j]!.feet[ik]!) - along(fits[i]!.feet[ik]!)) / dt);
    }
  if (!slopes.length) return null;
  slopes.sort((x, y) => x - y);
  return slopes[Math.floor(slopes.length / 2)]! * CLIP_FPS;
}

/**
 * Lock the planted feet to the ground at the TABLE ground speed `speedPxS` (what the runtime moves the character at, so
 * the character does not slide): while a foot is planted at consecutive keys its target moves back along the facing at
 * exactly that speed. The key poses (placed by hand in the reference images, never exactly on that line, and drawn with
 * whatever stride the AI chose) are shifted along the facing as a rigid body (hips and both feet) until the contact feet
 * lie on it, so the stride of the clip follows the movement speed, not the drawings. `shift` records the move so the
 * silhouette comparison translates the reference by the same amount.
 */
export function lockContacts(
  rig: RigDocument,
  clip: string,
  fits: readonly PoseFit[],
  at: readonly number[],
  frames: number,
  speedPxS: number,
): PoseFit[] {
  const plant = PLANT[clip];
  if (!plant) return [...fits];
  const axis = screenAxis(rig.direction);
  const along = (p: Vec2) => p.x * axis.x + p.y * axis.y;
  const out = fits.map((f) => ({ ...f }));
  const delta = fits.map(() => [] as number[]);
  const v = -speedPxS / CLIP_FPS; // target travel per frame along the facing while planted
  for (const [foot, ik] of [
    ['L', rig.roles.ik_foot_L!],
    ['R', rig.roles.ik_foot_R!],
  ] as const) {
    // consecutive planted keys form a stance; its time axis is unwrapped so it is increasing
    const idx = fits.map((_, i) => i).filter((i) => plant[i]?.[foot]);
    if (idx.length < 2) continue;
    let prev = at[idx[0]!]!;
    let offset = 0;
    const t = idx.map((i) => {
      if (at[i]! + offset < prev) offset += frames; // wrapped past the end of the loop
      prev = at[i]! + offset;
      return prev;
    });
    const c = idx.reduce((sum, i, k) => sum + along(fits[i]!.feet[ik]!) - v * t[k]!, 0) / idx.length;
    // delta = (target - x): the shift along the facing that puts the planted foot on the line
    idx.forEach((i, k) => delta[i]!.push(c + v * t[k]! - along(fits[i]!.feet[ik]!)));
  }
  fits.forEach((f, i) => {
    const d = delta[i]!.length ? delta[i]!.reduce((a, b) => a + b, 0) / delta[i]!.length : 0;
    if (!d) return;
    const dx = d * axis.x;
    const dy = d * axis.y;
    out[i] = {
      ...f,
      hips: { x: f.hips.x + dx, y: f.hips.y + dy },
      feet: Object.fromEntries(Object.entries(f.feet).map(([k, p]) => [k, { x: p.x + dx, y: p.y + dy }])),
      shift: { x: f.shift.x + dx, y: f.shift.y + dy },
    };
  });
  return out;
}

/** Author one clip from its fitted key poses (`fits` in label order). */
export function authorKeyPoseClip(
  rig: RigDocument,
  clip: string,
  fits: readonly PoseFit[],
  frames: number,
  loop: boolean,
  phases?: Readonly<Record<string, number>>,
  events?: readonly ClipEvent[],
  out?: { fits?: PoseFit[]; impliedSpeedPxS?: number | null; tableSpeedPxS?: number | null },
): Clip {
  const at = keyPoseFrames(clip, frames, phases, events);
  if (fits.length !== at.length)
    throw new RangeError(`clip '${clip}' needs ${at.length} key poses, got ${fits.length}`);
  // locomotion clips run at the TABLE ground speed (the speed the runtime moves the character at), never at the speed the
  // drawings happen to imply: the stride follows the movement speed
  const speed = tableGroundSpeed(rig, clip);
  if (out) {
    out.impliedSpeedPxS = impliedGroundSpeed(rig, clip, fits, at, frames);
    out.tableSpeedPxS = speed;
  }
  if (loop && speed !== null) fits = lockContacts(rig, clip, fits, at, frames, speed);
  if (out) out.fits = [...fits];
  const plant = PLANT[clip];
  const keys: KeyPoseKey[] = fits.map((fit, i) => ({
    fit,
    frame: at[i]!,
    ...(plant?.[i] ? { planted: plant[i]! } : {}),
  }));
  if (!loop) {
    const rest: PoseFit = {
      rotations: {},
      hips: { x: 0, y: 0 },
      feet: Object.fromEntries(Object.keys(fits[0]!.feet).map((k) => [k, { x: 0, y: 0 }])),
      error: {},
      maxError: 0,
      rms: 0,
      shift: { x: 0, y: 0 },
      lengthMismatch: [],
    };
    // ease in from the rest pose and back out; rotation keys of bones the fits drive start at 0 there
    const zero = { ...rest, rotations: Object.fromEntries(Object.keys(fits[0]!.rotations).map((b) => [b, 0])) };
    keys.unshift({ fit: zero, frame: 0, planted: { L: true, R: true } });
    keys.push({ fit: zero, frame: frames, planted: { L: true, R: true } });
  }
  return authorFromKeyPoses(rig, {
    name: clip,
    frames,
    loop,
    keys,
    ...(events ? { events } : {}),
    ...(phases ? { phases } : {}),
    ...(speed !== null ? { speed } : {}),
  });
}
