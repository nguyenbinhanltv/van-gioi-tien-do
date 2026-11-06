/**
 * Bones from art landmarks: the "draw for rig" workflow lets the art define where the joints are (`landmarks.json`,
 * px of the 256 canvas @2x, x right, y down) and the rig follows. Bones with a landmark pair get their rest position,
 * direction and length from it; every other bone (chains, sockets, IK targets) keeps its local transform, so it moves
 * with its parent.
 */
import { DEG, applyMat, composeLocal, invertMat, mulMat, type Mat, type Vec2 } from './math.js';
import type { CanvasView } from './limb.js';
import type { RigBone, RigDocument } from './schema.js';

export type Landmarks = Readonly<Record<string, readonly [number, number]>>;

/** Which landmarks drive which bone: origin landmark → tip landmark (the tip defines direction and length). */
export const LANDMARK_BONES: readonly { readonly role: string; readonly from: string; readonly to: string }[] = [
  { role: 'neck', from: 'neck', to: 'head' },
  { role: 'upper_arm_R', from: 'shoulder_R', to: 'elbow_R' },
  { role: 'lower_arm_R', from: 'elbow_R', to: 'wrist_R' },
  { role: 'upper_arm_L', from: 'shoulder_L', to: 'elbow_L' },
  { role: 'lower_arm_L', from: 'elbow_L', to: 'wrist_L' },
  { role: 'thigh_R', from: 'hip_R', to: 'knee_R' },
  { role: 'shin_R', from: 'knee_R', to: 'ankle_R' },
  { role: 'foot_R', from: 'ankle_R', to: 'foot_tip_R' },
  { role: 'thigh_L', from: 'hip_L', to: 'knee_L' },
  { role: 'shin_L', from: 'knee_L', to: 'ankle_L' },
  { role: 'foot_L', from: 'ankle_L', to: 'foot_tip_L' },
];

/** Landmarks → rig space (px @1x, y up). */
export function landmarkToRig(p: readonly [number, number], view: CanvasView): Vec2 {
  return { x: p[0] / view.scale - view.pivot[0], y: view.pivot[1] - p[1] / view.scale };
}

/** Rebuild the rest pose of `rig` from `landmarks`. Throws if a needed landmark is missing. */
export function applyLandmarks(rig: RigDocument, landmarks: Landmarks, view: CanvasView): RigDocument {
  // a role maps to its bone; `neck` has no role, so a bone of that name is used
  const boneOf = (role: string): string | undefined =>
    rig.roles[role as keyof typeof rig.roles] ?? rig.bones.find((b) => b.name === role)?.name;
  const target = new Map<string, { o: Vec2; t: Vec2; keepRotation?: boolean }>();
  for (const { role, from, to } of LANDMARK_BONES) {
    const name = boneOf(role);
    if (!name) continue;
    const a = landmarks[from];
    const b = landmarks[to];
    if (!a || !b) throw new RangeError(`landmarks: '${from}' and '${to}' are needed for bone '${name}'`);
    target.set(name, { o: landmarkToRig(a, view), t: landmarkToRig(b, view) });
  }
  // head and hands have no landmark of their own: their origin follows the parent's tip (neck → head landmark, forearm →
  // wrist) and they KEEP their world rotation, because the head/face and hand art is drawn upright in canvas space, not
  // along the neck / forearm axis
  for (const [bone, parentRole] of [
    ['head', 'neck'],
    ['hand_R', 'lower_arm_R'],
    ['hand_L', 'lower_arm_L'],
  ] as const) {
    const h = boneOf(bone);
    const pr = boneOf(parentRole);
    const t = pr ? target.get(pr) : undefined;
    if (h && t) target.set(h, { o: t.t, t: t.t, keepRotation: true });
  }
  const worlds = new Map<string, Mat>();
  const oldWorlds = new Map<string, Mat>();
  const out: RigBone[] = [];
  const identity: Mat = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const localMat = (b: RigBone) =>
    composeLocal({ x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX ?? 1, scaleY: b.scaleY ?? 1 });
  const rotOf = (m: Mat) => Math.atan2(m.b, m.a) / DEG;
  for (const bone of rig.bones) {
    const parentWorld: Mat = bone.parent ? worlds.get(bone.parent)! : identity;
    oldWorlds.set(bone.name, mulMat(bone.parent ? oldWorlds.get(bone.parent)! : identity, localMat(bone)));
    const tg = target.get(bone.name);
    let nb: RigBone = bone;
    if (tg) {
      const local = applyMat(invertMat(parentWorld), tg.o);
      const length = tg.keepRotation ? bone.length : Math.hypot(tg.t.x - tg.o.x, tg.t.y - tg.o.y);
      const worldRot = tg.keepRotation
        ? rotOf(oldWorlds.get(bone.name)!)
        : length > 1e-6
          ? Math.atan2(tg.t.y - tg.o.y, tg.t.x - tg.o.x) / DEG
          : undefined;
      const rotation = worldRot === undefined ? bone.rotation : ((worldRot - rotOf(parentWorld) + 540) % 360) - 180;
      nb = { ...bone, x: round(local.x), y: round(local.y), rotation: round(rotation), length: round(length) };
    }
    out.push(nb);
    worlds.set(nb.name, mulMat(parentWorld, localMat(nb)));
  }
  return { ...rig, bones: out };
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
