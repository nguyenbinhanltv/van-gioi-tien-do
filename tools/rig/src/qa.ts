/**
 * Automated QA: a headless sampler that evaluates a clip frame by frame on its rig and checks the things a human
 * animator would eyeball. Deterministic; no rendering. Every check returns `QaIssue`s with frame/bone context.
 */
import { SPINE_EVENT_NAMES } from '@vgtd/character';
import { screenAxis } from './locomotion.js';
import { CLIP_FPS, sampleScalar, type Clip } from './clip.js';
import { angleDelta, dist, type Vec2 } from './math.js';
import { evalPose, type Pose } from './pose.js';
import type { ClipSpec } from './animset.js';
import { EVENT_FRAME_TOLERANCE } from './animset.js';
import type { RigDocument } from './schema.js';

export type QaCheck =
  | 'loop-seam'
  | 'foot-slide'
  | 'bone-length'
  | 'angular-velocity'
  | 'jitter'
  | 'slot-order'
  | 'events'
  | 'duration'
  | 'keys'
  | 'ik-reach';

export interface QaIssue {
  readonly severity: 'error' | 'warning';
  readonly check: QaCheck;
  readonly message: string;
  readonly bone?: string;
  readonly frame?: number;
  readonly value?: number;
}

export interface QaThresholds {
  /** Loop seam: max world-position gap (px) between frame N and frame 0 for any bone. */
  readonly seamGapPx: number;
  /** Loop seam: max change of per-frame world speed (px/frame) across the seam. */
  readonly seamVelocityPx: number;
  /** Foot slide: max planted-foot drift in world space per frame (px/frame). */
  readonly footSlidePx: number;
  /** A foot counts as planted when its ankle is within this height of the rest ankle height. */
  readonly plantedHeightPx: number;
  /** Bone length: max deviation (px) of parent→child distance from rest. */
  readonly boneLengthPx: number;
  /** Max local rotation change per frame (deg). Faster = spike. */
  readonly maxDegPerFrame: number;
  /** Jitter: alternating-sign deltas of at least this size (deg), ≥ 4 in a row. */
  readonly jitterDeg: number;
}

export const DEFAULT_THRESHOLDS: QaThresholds = {
  seamGapPx: 0.05,
  seamVelocityPx: 2.5,
  footSlidePx: 0.35,
  plantedHeightPx: 0.75,
  boneLengthPx: 0.02,
  maxDegPerFrame: 80,
  jitterDeg: 0.6,
};

export interface QaOptions {
  readonly spec?: ClipSpec;
  readonly thresholds?: Partial<QaThresholds>;
  /** Travel axis (unit, y up) for the foot-slide check. Default: from `rig.direction`. */
  readonly axis?: Vec2;
  /** Bones allowed to change their distance to the parent (translated bones). Default: roles root/hips/ik_*. */
  readonly translatable?: readonly string[];
}

export interface QaReport {
  readonly clip: string;
  readonly frames: number;
  readonly issues: readonly QaIssue[];
  readonly errors: number;
  readonly warnings: number;
  /** Per-frame samples useful for rendering and debugging. */
  readonly stats: { readonly maxDegPerFrame: number; readonly maxFootSlidePx: number; readonly maxSeamGapPx: number };
}

function samplePoses(rig: RigDocument, clip: Clip): Pose[] {
  const poses: Pose[] = [];
  for (let f = 0; f <= clip.frames; f++) poses.push(evalPose(rig, clip, f));
  return poses;
}

export function runQa(rig: RigDocument, clip: Clip, opts: QaOptions = {}): QaReport {
  const th = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
  const issues: QaIssue[] = [];
  const add = (i: QaIssue) => issues.push(i);
  const poses = samplePoses(rig, clip);
  const N = clip.frames;
  let maxDeg = 0;
  let maxSlide = 0;
  let maxSeam = 0;

  // --- keys: shortest-path rotation assumption (DragonBones unwinds by the shortest arc)
  for (const t of clip.bones) {
    const ks = t.rotate ?? [];
    for (let i = 1; i < ks.length; i++) {
      if (Math.abs(ks[i]!.value - ks[i - 1]!.value) > 180 && ks[i - 1]!.curve !== 'stepped') {
        add({
          severity: 'error',
          check: 'keys',
          bone: t.bone,
          frame: ks[i]!.frame,
          message: `rotation key jumps ${Math.abs(ks[i]!.value - ks[i - 1]!.value).toFixed(0)}° (>180°): split it so the exported shortest-arc interpolation matches`,
        });
      }
    }
  }
  if (clip.loop) {
    for (const t of clip.bones) {
      const ks = (t.rotate ?? []).filter((k) => k.frame < clip.frames);
      const first = ks[0];
      const last = ks[ks.length - 1];
      if (first && last && Math.abs(first.value - last.value) > 180) {
        add({
          severity: 'error',
          check: 'keys',
          bone: t.bone,
          frame: clip.frames,
          message: `looping rotation wraps ${Math.abs(first.value - last.value).toFixed(0)}° across the seam (>180°): the runtime takes the short way round; add intermediate keys (a full spin cannot be one loop key)`,
        });
      }
    }
  }
  for (const e of clip.events) {
    if (e.frame >= clip.frames) {
      add({
        severity: 'error',
        check: 'events',
        frame: e.frame,
        message: `event '${e.name}' at frame ${e.frame} is never reached (clip has ${clip.frames} frames: valid 0..${clip.frames - 1})`,
      });
    }
  }
  for (const t of clip.slots) {
    for (const k of t.attachment ?? []) {
      if (k.value !== null && !rig.skins.some((s) => s.attachments[t.slot]?.[k.value!])) {
        add({
          severity: 'error',
          check: 'slot-order',
          frame: k.frame,
          message: `slot '${t.slot}' key shows unknown attachment '${k.value}'`,
        });
      }
    }
    if (!rig.slots.some((s) => s.name === t.slot)) {
      add({ severity: 'error', check: 'slot-order', message: `track for unknown slot '${t.slot}'` });
    }
  }

  // --- loop seam
  if (clip.loop) {
    const a = poses[0]!;
    const z = poses[N]!;
    const pre = poses[N - 1]!;
    const post = poses[1]!;
    for (const b of a.bones) {
      const gap = dist(b.pos, z.byName.get(b.name)!.pos);
      maxSeam = Math.max(maxSeam, gap);
      if (gap > th.seamGapPx) {
        add({
          severity: 'error',
          check: 'loop-seam',
          bone: b.name,
          frame: N,
          value: gap,
          message: `loop seam gap ${gap.toFixed(3)} px (frame ${N} vs 0)`,
        });
      }
      const before = dist(pre.byName.get(b.name)!.pos, z.byName.get(b.name)!.pos);
      const after = dist(b.pos, post.byName.get(b.name)!.pos);
      if (Math.abs(before - after) > th.seamVelocityPx) {
        add({
          severity: 'warning',
          check: 'loop-seam',
          bone: b.name,
          frame: N,
          value: Math.abs(before - after),
          message: `speed jumps ${before.toFixed(2)} → ${after.toFixed(2)} px/frame across the seam (hitch)`,
        });
      }
    }
  }

  // --- bone-length preservation (parent→child distance vs rest), local rotation spikes and jitter
  const rest = evalPose(rig, null, 0, { noIk: true });
  const translatable = new Set(
    opts.translatable ??
      (['root', 'hips', 'ik_foot_L', 'ik_foot_R', 'ik_hand_L', 'ik_hand_R'] as const)
        .map((r) => rig.roles[r])
        .filter((x): x is string => !!x),
  );
  const hasScale = new Set(clip.bones.filter((t) => t.scale?.length).map((t) => t.bone));
  const worstLen = new Map<string, { dev: number; frame: number }>();
  for (const b of rig.bones) {
    if (b.parent === null || translatable.has(b.name) || hasScale.has(b.name) || hasScale.has(b.parent)) continue;
    const restD = dist(rest.byName.get(b.name)!.pos, rest.byName.get(b.parent)!.pos);
    for (let f = 0; f <= N; f++) {
      const d = dist(poses[f]!.byName.get(b.name)!.pos, poses[f]!.byName.get(b.parent)!.pos);
      const dev = Math.abs(d - restD);
      if (dev > th.boneLengthPx && dev > (worstLen.get(b.name)?.dev ?? 0)) worstLen.set(b.name, { dev, frame: f });
    }
  }
  for (const [bone, w] of worstLen) {
    add({
      severity: 'error',
      check: 'bone-length',
      bone,
      frame: w.frame,
      value: w.dev,
      message: `bone '${bone}' length changes by ${w.dev.toFixed(3)} px (stretch)`,
    });
  }

  for (const b of rig.bones) {
    if (b.parent === null) continue;
    const series = poses.map((p) => p.byName.get(b.name)!.local.rotation);
    const deltas: number[] = [];
    for (let f = 1; f <= N; f++) deltas.push(angleDelta(series[f - 1]!, series[f]!));
    const worst = deltas.reduce((m, d, i) => (Math.abs(d) > Math.abs(m.d) ? { d, f: i + 1 } : m), { d: 0, f: 0 });
    maxDeg = Math.max(maxDeg, Math.abs(worst.d));
    if (Math.abs(worst.d) > th.maxDegPerFrame) {
      add({
        severity: 'error',
        check: 'angular-velocity',
        bone: b.name,
        frame: worst.f,
        value: Math.abs(worst.d),
        message: `rotates ${Math.abs(worst.d).toFixed(1)}°/frame (> ${th.maxDegPerFrame})`,
      });
    }
    let run = 0;
    for (let i = 1; i < deltas.length; i++) {
      const alt =
        deltas[i]! * deltas[i - 1]! < 0 &&
        Math.abs(deltas[i]!) >= th.jitterDeg &&
        Math.abs(deltas[i - 1]!) >= th.jitterDeg;
      run = alt ? run + 1 : 0;
      if (run === 4) {
        add({
          severity: 'warning',
          check: 'jitter',
          bone: b.name,
          frame: i + 1,
          message: `rotation oscillates every frame (≥ ${th.jitterDeg}°) — looks like jitter`,
        });
        break;
      }
    }
  }

  // --- foot slide (needs clip.motion + ik_foot roles)
  const footL = rig.roles.foot_L;
  const footR = rig.roles.foot_R;
  if (clip.motion && footL && footR) {
    const axis = opts.axis ?? screenAxis(rig.direction);
    const v = clip.motion.speed / CLIP_FPS; // px/frame the body travels
    const restAnkle = (name: string) => rest.byName.get(name)!.pos.y;
    for (const foot of [footL, footR]) {
      const h0 = restAnkle(foot);
      let worst = 0;
      let worstF = 0;
      for (let f = 0; f < N; f++) {
        const a = poses[f]!.byName.get(foot)!.pos;
        const b = poses[f + 1]!.byName.get(foot)!.pos;
        const flags = clip.motion.planted?.[foot];
        const planted = flags
          ? !!flags[f] && !!flags[f + 1]
          : Math.abs(axis.x) > 0.2 && a.y - h0 <= th.plantedHeightPx && b.y - h0 <= th.plantedHeightPx;
        if (!planted) continue;
        // relative to the body the foot should move by −v·axis per frame (so it stays fixed in the world)
        const dx = b.x - a.x + v * axis.x;
        const dy = b.y - a.y + v * axis.y;
        const slide = Math.hypot(dx, dy);
        if (slide > worst) {
          worst = slide;
          worstF = f;
        }
      }
      maxSlide = Math.max(maxSlide, worst);
      if (worst > th.footSlidePx) {
        add({
          severity: 'error',
          check: 'foot-slide',
          bone: foot,
          frame: worstF,
          value: worst,
          message: `planted foot slides ${worst.toFixed(2)} px/frame in world space`,
        });
      }
    }
  }

  // --- IK reach: a leg whose target is out of reach over-extends (looks like a floating foot)
  for (const ik of rig.ik ?? []) {
    if (ik.bones.length !== 2) continue;
    const [a, b] = ik.bones as [string, string];
    const reach = (rig.bones.find((x) => x.name === b)!.x ?? 0) + (rig.bones.find((x) => x.name === b)!.length ?? 0);
    let over = 0;
    let overF = 0;
    const mixKeys = clip.ik.find((x) => x.ik === ik.name)?.mix;
    for (let f = 0; f <= N; f++) {
      if ((mixKeys?.length ? sampleScalar(mixKeys, f) : (ik.mix ?? 1)) < 0.01) continue;
      const t = poses[f]!.byName.get(ik.target)!.pos;
      const d = dist(poses[f]!.byName.get(a)!.pos, t) - reach;
      if (d > over) {
        over = d;
        overF = f;
      }
    }
    if (over > 0.5 && (ik.mix ?? 1) > 0) {
      add({
        severity: 'warning',
        check: 'ik-reach',
        bone: ik.target,
        frame: overF,
        value: over,
        message: `IK '${ik.name}' target is ${over.toFixed(1)} px out of reach (limb over-extended)`,
      });
    }
  }

  // --- spec: duration, events
  if (opts.spec) {
    const s = opts.spec;
    if (Math.abs(clip.frames - s.frames) > EVENT_FRAME_TOLERANCE) {
      add({
        severity: 'error',
        check: 'duration',
        value: clip.frames,
        message: `${clip.frames} frames at ${CLIP_FPS} fps but the table says ${s.frames} (${s.seconds.toFixed(3)} s)`,
      });
    }
    if (clip.loop !== s.loop)
      add({
        severity: 'error',
        check: 'duration',
        message: `loop flag ${clip.loop} differs from the table (${s.loop})`,
      });
    for (const want of s.events) {
      const wantFrame = 'frame' in want.at ? want.at.frame : clip.phases?.[want.at.phase];
      if (wantFrame === undefined) {
        add({
          severity: 'error',
          check: 'events',
          message: `clip does not define phase '${'phase' in want.at ? want.at.phase : ''}' for event '${want.name}'`,
        });
        continue;
      }
      const got = clip.events.filter((e) => e.name === want.name);
      if (!got.some((e) => Math.abs(e.frame - wantFrame) <= EVENT_FRAME_TOLERANCE)) {
        add({
          severity: 'error',
          check: 'events',
          value: wantFrame,
          message: `event '${want.name}' expected at frame ${wantFrame} (±${EVENT_FRAME_TOLERANCE}); found ${got.map((e) => e.frame).join(', ') || 'none'}`,
        });
      }
    }
  }
  for (const e of clip.events) {
    if (!(SPINE_EVENT_NAMES as readonly string[]).includes(e.name)) {
      add({ severity: 'error', check: 'events', frame: e.frame, message: `unknown event '${e.name}'` });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  return {
    clip: clip.name,
    frames: N,
    issues,
    errors,
    warnings: issues.length - errors,
    stats: { maxDegPerFrame: maxDeg, maxFootSlidePx: maxSlide, maxSeamGapPx: maxSeam },
  };
}

/** Human/agent-readable summary of several reports. */
export function formatQaReports(reports: readonly QaReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`${r.errors ? 'FAIL' : 'ok  '} ${r.clip} (${r.frames}f): ${r.errors} errors, ${r.warnings} warnings`);
    for (const i of r.issues) {
      lines.push(
        `   ${i.severity === 'error' ? 'E' : 'w'} [${i.check}]${i.bone ? ` ${i.bone}` : ''}${i.frame !== undefined ? ` @${i.frame}` : ''}: ${i.message}`,
      );
    }
  }
  return lines.join('\n');
}
