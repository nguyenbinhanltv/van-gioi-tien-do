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
import { armsFk } from './kiemtu.js';
import { angleDelta, cubicBezierEase, dist, type Vec2 } from './math.js';
import { simplifyScalar } from './secondary.js';
import { evalPose, type Pose } from './pose.js';
import type { CanvasView } from './limb.js';
import { landmarkToRig, type Landmarks } from './landmarks.js';
import type { RigDocument } from './schema.js';
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

/** Fit `rig` to one key pose. Throws when a landmark needed for the skeleton is missing. */
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
  const worldRot = new Map<string, number>(); // fitted world rotation (deg) per bone
  const rotations: Record<string, number> = {};
  const aim = (bone: string, from: Vec2, to: Vec2): void => {
    const parent = parentOf.get(bone);
    const parentRot = parent ? (worldRot.get(parent) ?? restWorld(parent).rotation) : 0;
    const target = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    const delta = wrap(target - parentRot - restLocal.get(bone)!);
    rotations[bone] = delta;
    worldRot.set(bone, parentRot + restLocal.get(bone)! + delta);
  };
  const keep = (bone: string): void => {
    const parent = parentOf.get(bone);
    const parentRot = parent ? (worldRot.get(parent) ?? restWorld(parent).rotation) : 0;
    rotations[bone] = 0;
    worldRot.set(bone, parentRot + restLocal.get(bone)!);
  };
  // propagate the rest world rotation of every bone not fitted below (children inherit the fitted parents)
  const fitted = new Set<string>();

  // hips: translation to the pelvis landmark, rotation kept (upright)
  const hipsBone = r.hips!;
  const pelvis = need('pelvis');
  const hipsRest = restWorld(hipsBone).pos;
  const hips = { x: pelvis.x - hipsRest.x, y: pelvis.y - hipsRest.y };
  keep(hipsBone);
  fitted.add(hipsBone);
  // spine: pelvis → chest → neck (positions follow from the bone lengths; the aim is what carries the lean)
  const hipTip = { x: restWorld(hipsBone).tip.x + hips.x, y: restWorld(hipsBone).tip.y + hips.y };
  aim(r.spine_mid!, hipTip, need('chest'));
  fitted.add(r.spine_mid!);
  aim(r.spine_upper!, need('chest'), need('neck'));
  fitted.add(r.spine_upper!);
  // neck bone (no role) → head landmark; head keeps the neck-relative upright
  const neckBone = rig.bones.find((b) => b.name === 'neck')?.name;
  if (neckBone) {
    aim(neckBone, need('neck'), need('head'));
    fitted.add(neckBone);
  }
  if (r.head) {
    keep(r.head);
    // the head stays upright in canvas space: cancel the parent's change
    const base = restWorld(r.head).rotation;
    const cur = worldRot.get(r.head)!;
    rotations[r.head] = wrap(base - cur);
    worldRot.set(r.head, base);
    fitted.add(r.head);
  }
  // arms: shoulder → elbow → wrist; hand follows the forearm
  for (const s of ['R', 'L'] as const) {
    const up = r[`upper_arm_${s}` as 'upper_arm_R']!;
    const lo = r[`lower_arm_${s}` as 'lower_arm_R']!;
    const hand = r[`hand_${s}` as 'hand_R'];
    aim(up, need(`shoulder_${s}`), need(`elbow_${s}`));
    aim(lo, need(`elbow_${s}`), need(`wrist_${s}`));
    fitted.add(up);
    fitted.add(lo);
    if (hand) {
      keep(hand);
      fitted.add(hand);
    }
  }
  // legs: IK foot targets (the knee comes from the IK bend); thigh / shin aims are kept for the foot rotation below
  const feet: Record<string, Vec2> = {};
  for (const s of ['R', 'L'] as const) {
    const ik = r[`ik_foot_${s}` as 'ik_foot_R']!;
    const ankle = need(`ankle_${s}`);
    const target = restWorld(ik).pos;
    feet[ik] = { x: ankle.x - target.x, y: ankle.y - target.y };
  }
  // skirt panels
  const panelLimit = opts.panelLimit ?? 38;
  for (const [panel, lmName] of Object.entries(opts.panels ?? DEFAULT_PANELS)) {
    if (!rig.bones.some((b) => b.name === panel)) continue;
    const target = get(lmName);
    if (!target) continue;
    const origin = { x: restWorld(panel).pos.x + hips.x, y: restWorld(panel).pos.y + hips.y };
    aim(panel, origin, target);
    rotations[panel] = Math.max(-panelLimit, Math.min(panelLimit, rotations[panel]!));
    fitted.add(panel);
  }
  // second pass: evaluate the pose, then rotate the feet and the sword against the IK-solved legs
  const draft: Clip = clipOf(rig, { rotations, hips, feet });
  const pose = evalPose(rig, draft, 0);
  for (const s of ['R', 'L'] as const) {
    const foot = r[`foot_${s}` as 'foot_R']!;
    const tip = get(`foot_tip_${s}`);
    const f = pose.byName.get(foot)!;
    if (tip && !inferred.has(`foot_tip_${s}`)) {
      const parentRot = pose.byName.get(parentOf.get(foot)!)!.rotation;
      const target = (Math.atan2(tip.y - f.pos.y, tip.x - f.pos.x) * 180) / Math.PI;
      rotations[foot] = wrap(target - parentRot - restLocal.get(foot)!);
    }
  }
  const sword = get('sword_tip');
  const weapon = rig.bones.find((b) => b.name === 'weapon')?.name;
  if (sword && weapon && r.hand_R && !inferred.has('sword_tip')) {
    const hp = pose.byName.get(r.hand_R)!;
    const target = (Math.atan2(sword.y - hp.pos.y, sword.x - hp.pos.x) * 180) / Math.PI;
    rotations[weapon] = wrap(target - hp.rotation - restLocal.get(weapon)!);
  }

  // error + length check against the final pose
  const final = evalPose(rig, clipOf(rig, { rotations, hips, feet }), 0);
  const error: Record<string, number> = {};
  const check = (name: string, p: Vec2) => {
    const ref = get(name);
    if (ref && !inferred.has(name)) error[name] = dist(ref, p);
  };
  for (const s of ['R', 'L'] as const) {
    check(`shoulder_${s}`, final.byName.get(r[`upper_arm_${s}` as 'upper_arm_R']!)!.pos);
    check(`elbow_${s}`, final.byName.get(r[`lower_arm_${s}` as 'lower_arm_R']!)!.pos);
    check(`wrist_${s}`, final.byName.get(r[`lower_arm_${s}` as 'lower_arm_R']!)!.tip);
    check(`hip_${s}`, final.byName.get(r[`thigh_${s}` as 'thigh_R']!)!.pos);
    check(`knee_${s}`, final.byName.get(r[`shin_${s}` as 'shin_R']!)!.pos);
    check(`ankle_${s}`, final.byName.get(r[`foot_${s}` as 'foot_R']!)!.pos);
    check(`foot_tip_${s}`, final.byName.get(r[`foot_${s}` as 'foot_R']!)!.tip);
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
  return {
    rotations,
    hips,
    feet,
    error,
    maxError: Math.max(0, ...Object.values(error)),
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
  const speed = speeds.length ? speeds[Math.floor(speeds.length / 2)]! : 0;
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

/** Intersection over union of the opaque areas of two images of the same size. */
export function maskIoU(a: Image, b: Image, alpha = 128): number {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError('maskIoU needs images of the same size');
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const x = a.data[i * 4 + 3]! >= alpha;
    const y = b.data[i * 4 + 3]! >= alpha;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni ? inter / uni : 1;
}

/** Render the rig at `frame` of `clip` on the reference canvas (transparent, no ground) and return its IoU with `reference`. */
export function silhouetteIoU(
  rig: RigDocument,
  clip: Clip,
  frame: number,
  atlas: LoadedAtlas,
  reference: Image,
  opts: IouOptions = {},
): number {
  const img = renderPose(rig, evalPose(rig, clip, frame), atlas, {
    scale: reference.width / rig.canvas.width,
    background: [0, 0, 0, 0],
    ground: false,
    hideSlots: opts.ignoreSlots ?? DEFAULT_IGNORED_SLOTS,
  });
  return maskIoU(img, reference, opts.alpha ?? 128);
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
    return evenKeyFrames(labels.length, frames).map((f) => (f + offset) % frames);
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

/** Author one clip from its fitted key poses (`fits` in label order). */
export function authorKeyPoseClip(
  rig: RigDocument,
  clip: string,
  fits: readonly PoseFit[],
  frames: number,
  loop: boolean,
  phases?: Readonly<Record<string, number>>,
  events?: readonly ClipEvent[],
): Clip {
  const at = keyPoseFrames(clip, frames, phases, events);
  if (fits.length !== at.length)
    throw new RangeError(`clip '${clip}' needs ${at.length} key poses, got ${fits.length}`);
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
  });
}
