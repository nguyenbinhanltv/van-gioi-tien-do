/**
 * Procedural secondary motion (hair, ribbon, sash, sleeve tips, cape): a damped spring per chain bone, driven by the
 * parent's angular and linear acceleration, simulated with fixed sub-steps (deterministic: no Math.random / Date.now)
 * and **baked to 30 fps rotate keys**. Output is plain keys, so DragonBones needs no physics runtime.
 */
import { CLIP_FPS, sampleScalar, type BoneTrack, type Clip, type Key } from './clip.js';
import { DEG, angleDelta } from './math.js';
import { periodicize } from './loop.js';
import { evalPose } from './pose.js';
import type { RigChain, RigDocument } from './schema.js';

export interface BakeOptions {
  /** Simulation sub-steps per 30 fps frame. Default 4. */
  readonly substeps?: number;
  /** Warm-up cycles for looping clips before recording. Default 4. */
  readonly warmupCycles?: number;
  /** Drop keys closer than this to the linear interpolation of neighbours (deg). Default 0.15. */
  readonly tolerance?: number;
  /** Global multiplier on all chains' response (0 disables). Default 1. */
  readonly gain?: number;
}

interface BoneState {
  theta: number;
  omega: number;
  /** Low-passed drive (deg/s²): raw second differences are noisy. */
  drive: number;
}

/** Limits keeping baked motion physically plausible (and under the QA spike threshold). */
const MAX_DRIVE = 9000;
const MAX_OMEGA = 1300;
const DRIVE_SMOOTH = 0.3;

/** Natural frequency (rad/s) and damping ratio from the authoring knobs. */
function springParams(c: RigChain): { w0: number; zeta: number } {
  return { w0: 2 * Math.PI * (0.5 + 8 * c.stiffness), zeta: 0.1 + 0.9 * c.damping };
}

/** Simulate every chain over `clip` and return the clip with rotate tracks merged in (summed with existing ones). */
export function bakeSecondaryMotion(rig: RigDocument, clip: Clip, opts: BakeOptions = {}): Clip {
  const chains = rig.chains ?? [];
  if (!chains.length || opts.gain === 0) return clip;
  const sub = opts.substeps ?? 4;
  const cycles = clip.loop ? (opts.warmupCycles ?? 4) + 1 : 1;
  const gain = opts.gain ?? 1;
  const h = 1 / (CLIP_FPS * sub);
  const N = clip.frames;

  const chainBones = chains.flatMap((c) => c.bones.map((b) => ({ chain: c, bone: b })));
  const state = new Map<string, BoneState>(chainBones.map(({ bone }) => [bone, { theta: 0, omega: 0, drive: 0 }]));
  const lenOf = new Map(rig.bones.map((b) => [b.name, Math.max(b.length, 1e-3)]));
  const parentOf = new Map(rig.bones.map((b) => [b.name, b.parent]));

  // history of (world pos, world rot) per bone at t-h and t-2h
  type Hist = { x: number; y: number; rot: number };
  const hist = new Map<string, Hist[]>();
  const samples = new Map<string, number[]>(chainBones.map(({ bone }) => [bone, []]));

  const totalSteps = cycles * N * sub;
  const t0 = clip.loop ? 0 : 0;
  for (let s = 0; s <= totalSteps; s++) {
    const frameF = clip.loop ? (s / sub) % N : Math.min(s / sub, N);
    const extra = new Map([...state].map(([b, st]) => [b, st.theta]));
    const pose = evalPose(rig, clip, frameF, { extraRotation: extra });

    // record at frame boundaries of the final cycle (or the only cycle)
    const lastCycleStart = (cycles - 1) * N * sub;
    if (s >= lastCycleStart && (s - lastCycleStart) % sub === 0) {
      for (const [b, st] of state) samples.get(b)!.push(st.theta);
    }
    if (s === totalSteps) break;

    // advance springs using accelerations measured from the history
    for (const { chain, bone } of chainBones) {
      const st = state.get(bone)!;
      const pb = pose.byName.get(bone)!;
      const parentName = parentOf.get(bone);
      const parentPose = parentName ? pose.byName.get(parentName) : undefined;
      const hs = hist.get(bone) ?? [];
      const hp = parentName ? (hist.get(parentName) ?? []) : [];
      let alphaParent = 0;
      let alphaLin = 0;
      if (hs.length >= 2 && parentPose) {
        const p1 = hs[hs.length - 1]!;
        const p2 = hs[hs.length - 2]!;
        const q1 = hp[hp.length - 1];
        const q2 = hp[hp.length - 2];
        if (q1 && q2) {
          const d1 = angleDelta(q1.rot, parentPose.rotation);
          const d0 = angleDelta(q2.rot, q1.rot);
          alphaParent = (d1 - d0) / (h * h);
        }
        const ax = (pb.pos.x - 2 * p1.x + p2.x) / (h * h);
        const ay = (pb.pos.y - 2 * p1.y + p2.y) / (h * h);
        const ux = Math.cos(pb.rotation * DEG);
        const uy = Math.sin(pb.rotation * DEG);
        alphaLin = (uy * ax - ux * ay) / lenOf.get(bone)! / DEG;
      }
      const { w0, zeta } = springParams(chain);
      const inertia = (chain.inertia ?? 1) * gain;
      const gravity = (chain.gravity ?? 0) * gain;
      const rawDrive = Math.max(-MAX_DRIVE, Math.min(MAX_DRIVE, inertia * (-alphaParent + alphaLin)));
      st.drive += (rawDrive - st.drive) * DRIVE_SMOOTH;
      const accel = -w0 * w0 * st.theta - 2 * zeta * w0 * st.omega + st.drive - gravity * Math.cos(pb.rotation * DEG);
      st.omega = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, st.omega + accel * h));
      st.theta += st.omega * h;
      st.theta = Math.max(-90, Math.min(90, st.theta));
    }
    for (const b of pose.bones) {
      const arr = hist.get(b.name) ?? [];
      arr.push({ x: b.pos.x, y: b.pos.y, rot: b.rotation });
      if (arr.length > 3) arr.shift();
      hist.set(b.name, arr);
    }
  }
  void t0;

  const tol = opts.tolerance ?? 0.15;
  const newTracks = new Map<string, Key<number>[]>();
  for (const { bone } of chainBones) {
    let vals = samples.get(bone)!;
    if (vals.length !== N + 1) vals = vals.slice(0, N + 1);
    if (clip.loop) vals = periodicize(vals, Math.max(2, Math.min(8, Math.floor(N / 4))));
    const existing = clip.bones.find((t) => t.bone === bone)?.rotate;
    const summed: Key<number>[] = vals.map((v, f) => ({
      frame: f,
      value: v + (existing?.length ? sampleScalar(existing, f) : 0),
    }));
    newTracks.set(bone, simplifyScalar(summed, tol));
  }

  const bones: BoneTrack[] = clip.bones.filter((t) => !newTracks.has(t.bone) || t.translate || t.scale);
  const merged: BoneTrack[] = [];
  for (const t of clip.bones) {
    const rot = newTracks.get(t.bone);
    if (rot) merged.push({ ...t, rotate: rot });
  }
  for (const [bone, rotate] of newTracks) if (!clip.bones.some((t) => t.bone === bone)) merged.push({ bone, rotate });
  const untouched = clip.bones.filter((t) => !newTracks.has(t.bone));
  void bones;
  return { ...clip, bones: [...untouched, ...merged] };
}

/** Ramer–Douglas–Peucker-style key reduction on a scalar track (linear interpolation assumed). */
export function simplifyScalar(keys: readonly Key<number>[], tolerance: number): Key<number>[] {
  if (keys.length <= 2) return [...keys];
  const keep = new Array<boolean>(keys.length).fill(false);
  keep[0] = true;
  keep[keys.length - 1] = true;
  const rec = (a: number, b: number) => {
    let worst = -1;
    let worstErr = tolerance;
    const ka = keys[a]!;
    const kb = keys[b]!;
    for (let i = a + 1; i < b; i++) {
      const k = keys[i]!;
      const t = (k.frame - ka.frame) / (kb.frame - ka.frame);
      const err = Math.abs(k.value - (ka.value + (kb.value - ka.value) * t));
      if (err > worstErr) {
        worstErr = err;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      rec(a, worst);
      rec(worst, b);
    }
  };
  rec(0, keys.length - 1);
  return keys.filter((_, i) => keep[i]);
}
