/**
 * Keyframe DSL. Authors write against **roles** (`hips`, `hand_R`, ...) or raw bone names; the builder resolves them
 * through the rig and emits a `Clip`. Times are 30 fps frame indices.
 *
 *   const c = new ClipBuilder(rig, { name: 'idle', frames: 30, loop: true });
 *   c.rotate('spine_mid', [[0, 0], [15, 2, EASE.inOut], [30, 0]]);
 *   c.translate('hips', [[0, 0, 0], [15, 0, -1.5, EASE.inOut], [30, 0, 0]]);
 *   const clip = c.build();
 */
import type { SpineEventName } from '@vgtd/character';
import {
  CLIP_FPS,
  checkKeys,
  type BoneTrack,
  type Clip,
  type ClipEvent,
  type ClipMotion,
  type Curve,
  type IkTrack,
  type Key,
  type RGBA,
  type SlotTrack,
} from './clip.js';
import type { Vec2 } from './math.js';
import type { RigDocument } from './schema.js';

/** Easing presets as CSS-style bezier control points. */
export const EASE = {
  linear: 'linear',
  step: 'stepped',
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  inOut: [0.42, 0, 0.58, 1],
  /** Fast start, soft landing: for snappy strikes. */
  snapOut: [0.1, 0.6, 0.25, 1],
  /** Slow wind-up then explosive release: anticipation into strike. */
  whip: [0.7, 0, 0.9, 0.4],
  /** Overshoot and settle (follow-through). */
  back: [0.34, 1.56, 0.64, 1],
  /** Gravity-like acceleration (fall, collapse). */
  fall: [0.55, 0, 1, 0.45],
} as const satisfies Record<string, Curve>;

/** `[frame, value, curve?]` for scalar tracks. */
export type ScalarKeySpec = readonly [frame: number, value: number, curve?: Curve];
/** `[frame, x, y, curve?]` for vector tracks. */
export type VecKeySpec = readonly [frame: number, x: number, y: number, curve?: Curve];

export interface ClipOptions {
  readonly name: string;
  readonly frames: number;
  readonly loop: boolean;
  readonly phases?: Readonly<Record<string, number>>;
  readonly motion?: ClipMotion;
}

export function scalarKeys(specs: readonly ScalarKeySpec[]): Key<number>[] {
  return specs.map(([frame, value, curve]) => ({ frame, value, ...(curve ? { curve } : {}) }));
}

export function vecKeys(specs: readonly VecKeySpec[]): Key<Vec2>[] {
  return specs.map(([frame, x, y, curve]) => ({ frame, value: { x, y }, ...(curve ? { curve } : {}) }));
}

export class ClipBuilder {
  private readonly bones = new Map<string, { translate?: Key<Vec2>[]; rotate?: Key<number>[]; scale?: Key<Vec2>[] }>();
  private readonly slotTracks = new Map<string, { attachment?: Key<string | null>[]; color?: Key<RGBA>[] }>();
  private readonly ikTracks = new Map<string, Key<number>[]>();
  private readonly events: ClipEvent[] = [];
  private readonly phases: Record<string, number>;

  constructor(
    readonly rig: RigDocument,
    readonly options: ClipOptions,
  ) {
    this.phases = { ...(options.phases ?? {}) };
  }

  /** Resolve a role or bone name to a bone name; throws on unknown names (typos must not silently no-op). */
  bone(nameOrRole: string): string {
    const viaRole = (this.rig.roles as Readonly<Record<string, string | undefined>>)[nameOrRole];
    const name = viaRole ?? nameOrRole;
    if (!this.rig.bones.some((b) => b.name === name)) {
      throw new RangeError(`rig '${this.rig.id}' has no bone or role '${nameOrRole}'`);
    }
    return name;
  }

  hasRole(role: string): boolean {
    return (this.rig.roles as Readonly<Record<string, string | undefined>>)[role] !== undefined;
  }

  private track(nameOrRole: string) {
    const bone = this.bone(nameOrRole);
    let t = this.bones.get(bone);
    if (!t) this.bones.set(bone, (t = {}));
    return t;
  }

  rotate(boneOrRole: string, keys: readonly ScalarKeySpec[] | readonly Key<number>[]): this {
    this.track(boneOrRole).rotate = normalizeScalar(keys);
    return this;
  }

  translate(boneOrRole: string, keys: readonly VecKeySpec[] | readonly Key<Vec2>[]): this {
    this.track(boneOrRole).translate = normalizeVec(keys);
    return this;
  }

  scale(boneOrRole: string, keys: readonly VecKeySpec[] | readonly Key<Vec2>[]): this {
    this.track(boneOrRole).scale = normalizeVec(keys);
    return this;
  }

  attachment(slot: string, keys: readonly (readonly [number, string | null])[]): this {
    const t = this.slotTracks.get(slot) ?? {};
    t.attachment = keys.map(([frame, value]) => ({ frame, value, curve: 'stepped' as const }));
    this.slotTracks.set(slot, t);
    return this;
  }

  color(slot: string, keys: readonly Key<RGBA>[]): this {
    const t = this.slotTracks.get(slot) ?? {};
    t.color = [...keys];
    this.slotTracks.set(slot, t);
    return this;
  }

  /** Animate an IK constraint's mix (0 = FK, 1 = IK). */
  ikMix(ik: string, keys: readonly ScalarKeySpec[]): this {
    this.ikTracks.set(ik, scalarKeys(keys));
    return this;
  }

  event(frame: number, name: SpineEventName): this {
    this.events.push({ frame, name });
    return this;
  }

  phase(name: string, frame: number): this {
    this.phases[name] = frame;
    return this;
  }

  /** Merge pre-built tracks (from principles / secondary motion / locomotion). */
  merge(tracks: readonly BoneTrack[]): this {
    for (const t of tracks) {
      const dst = this.track(t.bone);
      if (t.translate) dst.translate = [...t.translate];
      if (t.rotate) dst.rotate = [...t.rotate];
      if (t.scale) dst.scale = [...t.scale];
    }
    return this;
  }

  build(): Clip {
    const { frames, loop, name } = this.options;
    const problems: string[] = [];
    const bones: BoneTrack[] = [...this.bones].map(([bone, t]) => {
      for (const [kind, keys] of Object.entries(t)) {
        for (const p of checkKeys(keys as Key<unknown>[], frames)) problems.push(`${name}/${bone}/${kind}: ${p}`);
      }
      return { bone, ...t };
    });
    const slots: SlotTrack[] = [...this.slotTracks].map(([slot, t]) => ({ slot, ...t }));
    const ik: IkTrack[] = [...this.ikTracks].map(([ik, mix]) => ({ ik, mix }));
    for (const e of this.events) {
      if (!Number.isInteger(e.frame) || e.frame < 0 || e.frame > frames) {
        problems.push(`${name}: event '${e.name}' at frame ${e.frame} outside 0..${frames}`);
      }
    }
    if (problems.length) throw new Error(`invalid clip:\n  ${problems.join('\n  ')}`);
    return {
      name,
      frames,
      loop,
      bones,
      slots,
      ik,
      events: [...this.events].sort((a, b) => a.frame - b.frame),
      ...(Object.keys(this.phases).length ? { phases: this.phases } : {}),
      ...(this.options.motion ? { motion: this.options.motion } : {}),
    };
  }
}

function isKey<T>(k: unknown): k is Key<T> {
  return typeof k === 'object' && k !== null && !Array.isArray(k);
}

function normalizeScalar(keys: readonly ScalarKeySpec[] | readonly Key<number>[]): Key<number>[] {
  const first = keys[0];
  if (first === undefined) return [];
  return isKey<number>(first) ? [...(keys as readonly Key<number>[])] : scalarKeys(keys as readonly ScalarKeySpec[]);
}

function normalizeVec(keys: readonly VecKeySpec[] | readonly Key<Vec2>[]): Key<Vec2>[] {
  const first = keys[0];
  if (first === undefined) return [];
  return isKey<Vec2>(first) ? [...(keys as readonly Key<Vec2>[])] : vecKeys(keys as readonly VecKeySpec[]);
}

/** Convert seconds to a 30 fps frame index. */
export function secToFrame(sec: number): number {
  return Math.round(sec * CLIP_FPS);
}
