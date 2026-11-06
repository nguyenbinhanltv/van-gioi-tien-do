/**
 * Animation re-targeting. Every class reuses the Kiếm tu clip set (locomotion, hit, die, dash, meditate, ... are
 * class-independent) and overrides only what the weapon changes: the 3-hit attack combo, cast, channel and the idle
 * stance. The overrides are **data** (pose tables per class below), turned into clips by a few generic builders, so a
 * new class is a table, not code. Angles are deltas from rest in degrees (positive = arm forward / up, spine leans back;
 * translations are px).
 */
import { clipSpec } from './animset.js';
import type { Clip, Key } from './clip.js';
import { ClipBuilder, EASE, type ClipOptions } from './dsl.js';
import { authorKiemTuSet, sine, viewGain, type KiemTuOptions } from './kiemtu.js';
import type { BoneRole, RigDocument } from './schema.js';
import type { CharacterId } from './classes.js';
import { ASSEMBLY_PROFILES } from './class-profile.js';
import type { Vec2 } from './math.js';

type Num = number;
type Move = readonly [x: Num, y: Num];

/** A pose: rotation deltas per role, plus hip / foot translations. Unlisted roles stay at rest. */
export interface PoseDelta {
  readonly upper_arm_R?: Num;
  readonly lower_arm_R?: Num;
  readonly hand_R?: Num;
  readonly upper_arm_L?: Num;
  readonly lower_arm_L?: Num;
  readonly hand_L?: Num;
  readonly spine_mid?: Num;
  readonly spine_upper?: Num;
  readonly head?: Num;
  readonly hips?: Move;
  readonly ik_foot_L?: Move;
  readonly ik_foot_R?: Move;
}

export interface StrikeSpec {
  readonly windup: PoseDelta;
  readonly hit: PoseDelta;
  /** Anticipation two frames before the windup end: weight loaded back, hip turned, the striking arm drawn back. */
  readonly load?: PoseDelta;
  /** Frames the impact pose is held after the hit frame (2-3 reads as contact). Default 0. Capped to leave one frame before `combo`. */
  readonly hold?: number;
  /** Frame of the combo window (the `cancel_window` event, the end of the hold / start of the recoil). Default 9. */
  readonly combo?: number;
  /** Pose of the combo window after the hold (recoil). Default: the impact pose scaled by 0.45. */
  readonly recoil?: PoseDelta;
}

export interface ClassClipSpec {
  /** Resting stance (weapon held): added to the idle breathing and the base of channel. */
  readonly stance: PoseDelta;
  readonly attack: StrikeSpec;
  readonly attack_2: StrikeSpec;
  readonly attack_3: StrikeSpec;
  readonly cast: { readonly gather: PoseDelta; readonly release: PoseDelta };
  /** Hit reaction (flinch): the pose at frame 2. Default: the shared Kiếm tu hit. */
  readonly hit?: PoseDelta;
  /**
   * Start and end the one-shot clips (strikes, hit) at the `stance` instead of the bare rest pose, so they join the
   * idle (guard stance) without a drop of the arms. Default false (the stance is only the idle).
   */
  readonly stanceBlend?: boolean;
  /** Looping hold with a tremor on these roles. */
  readonly channel: { readonly pose: PoseDelta; readonly tremor: readonly BoneRole[] };
}

const ROT_ROLES = [
  'upper_arm_R',
  'lower_arm_R',
  'hand_R',
  'upper_arm_L',
  'lower_arm_L',
  'hand_L',
  'spine_mid',
  'spine_upper',
  'head',
] as const;
const MOVE_ROLES = ['hips', 'ik_foot_L', 'ik_foot_R'] as const;

/** Roles a spec touches, so a track exists for each (and returns to rest at the end). */
function rolesOf(...poses: readonly PoseDelta[]): {
  rot: (typeof ROT_ROLES)[number][];
  move: (typeof MOVE_ROLES)[number][];
} {
  return {
    rot: ROT_ROLES.filter((r) => poses.some((p) => p[r] !== undefined)),
    move: MOVE_ROLES.filter((r) => poses.some((p) => p[r] !== undefined)),
  };
}

function addPoseTracks(
  c: ClipBuilder,
  g: number,
  frames: number,
  stops: readonly { readonly frame: number; readonly pose: PoseDelta; readonly curve: Key<number>['curve'] }[],
  rest: PoseDelta = {},
): void {
  const at = (r: (typeof ROT_ROLES)[number], p: PoseDelta) =>
    (p[r] ?? 0) * (r.startsWith('upper') || r.startsWith('spine') ? g : 1);
  const mv = (r: (typeof MOVE_ROLES)[number], p: PoseDelta): Vec2 => ({ x: (p[r]?.[0] ?? 0) * g, y: p[r]?.[1] ?? 0 });
  const { rot, move } = rolesOf(...stops.map((s) => s.pose), rest);
  for (const r of rot) {
    c.rotate(r, [
      { frame: 0, value: at(r, rest), curve: stops[0]!.curve },
      ...stops.map((s, i) => ({
        frame: s.frame,
        value: at(r, s.pose),
        curve: stops[i + 1]?.curve ?? EASE.inOut,
      })),
      { frame: frames, value: at(r, rest) },
    ]);
  }
  for (const r of move) {
    c.translate(r, [
      { frame: 0, value: mv(r, rest), curve: stops[0]!.curve },
      ...stops.map((s, i) => ({ frame: s.frame, value: mv(r, s.pose), curve: stops[i + 1]?.curve ?? EASE.inOut })),
      { frame: frames, value: mv(r, rest) },
    ]);
  }
}

function strike(
  rig: RigDocument,
  name: string,
  spec: StrikeSpec,
  phases: { windupEnd: number; hit: number; combo: number },
  rest: PoseDelta = {},
): Clip {
  const N = clipSpec('attack').frames;
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, {
    name,
    frames: N,
    loop: false,
    phases: { windup_end: phases.windupEnd, hit_frame: phases.hit, combo_window: phases.combo },
  });
  c.event(phases.hit, 'hit').event(phases.combo, 'cancel_window');
  const hold = Math.min(spec.hold ?? 0, phases.combo - phases.hit - 1);
  const loadAt = phases.windupEnd - 2;
  addPoseTracks(
    c,
    g,
    N,
    [
      ...(spec.load && loadAt >= 1 ? [{ frame: loadAt, pose: spec.load, curve: EASE.inOut }] : []),
      { frame: phases.windupEnd, pose: spec.windup, curve: EASE.whip },
      { frame: phases.hit, pose: spec.hit, curve: EASE.snapOut },
      // impact hold: the same pose for a few frames so the contact reads
      ...(hold > 0 ? [{ frame: phases.hit + hold, pose: spec.hit, curve: EASE.inOut }] : []),
      { frame: phases.combo, pose: spec.recoil ?? scalePose(spec.hit, 0.45), curve: EASE.inOut },
    ],
    rest,
  );
  return c.build();
}

function scalePose(p: PoseDelta, k: number): PoseDelta {
  const out: Record<string, Num | Move> = {};
  for (const [key, v] of Object.entries(p)) out[key] = Array.isArray(v) ? [v[0] * k, v[1] * k] : (v as Num) * k;
  return out as PoseDelta;
}

function cast(rig: RigDocument, spec: ClassClipSpec['cast']): Clip {
  const N = clipSpec('cast').frames;
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'cast', frames: N, loop: false, phases: { windup_end: 8 } });
  c.event(8, 'vfx_spawn');
  addPoseTracks(c, g, N, [
    { frame: 8, pose: spec.gather, curve: EASE.inOut },
    { frame: 11, pose: spec.release, curve: EASE.snapOut },
  ]);
  return c.build();
}

function channel(rig: RigDocument, spec: ClassClipSpec['channel']): Clip {
  const N = clipSpec('channel').frames;
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'channel', frames: N, loop: true });
  const { rot, move } = rolesOf(spec.pose);
  rot.forEach((r, i) => {
    const base = (spec.pose[r] ?? 0) * (r.startsWith('upper') || r.startsWith('spine') ? g : 1);
    const amp = spec.tremor.includes(r) ? 2.2 : 0;
    c.rotate(
      r,
      amp
        ? sine(N, amp, { cycles: 2, phase: 0.12 * i, offset: base })
        : [
            { frame: 0, value: base },
            { frame: N, value: base },
          ],
    );
  });
  for (const r of move) {
    const v = spec.pose[r]!;
    c.translate(r, [
      { frame: 0, value: { x: v[0] * g, y: v[1] } },
      { frame: N, value: { x: v[0] * g, y: v[1] } },
    ]);
  }
  return c.build();
}

/**
 * Hit reaction: a flinch pose at frame 2, back to the stance. The Thể tu table gives a tank's brace: the guard tightens and the
 * body gives a little; the head flinch of the shared Kiếm tu hit is left out on purpose (a tank takes the blow on its guard).
 */
function hitReaction(rig: RigDocument, pose: PoseDelta, rest: PoseDelta): Clip {
  const N = clipSpec('hit').frames;
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'hit', frames: N, loop: false });
  addPoseTracks(c, g, N, [{ frame: 2, pose, curve: EASE.snapOut }], rest);
  return c.build();
}

/** Idle: slow breathing around the class's weapon stance. */
function idle(rig: RigDocument, stance: PoseDelta): Clip {
  const N = 30;
  const g = viewGain(rig.direction);
  const opts: ClipOptions = { name: 'idle', frames: N, loop: true };
  const c = new ClipBuilder(rig, opts);
  const breathe: Record<string, readonly [Num, Num]> = {
    spine_mid: [1.2, 0],
    spine_upper: [1.8, -0.08],
    head: [1.4, -0.16],
    upper_arm_L: [1.6, -0.12],
    upper_arm_R: [1.6, -0.12],
    lower_arm_L: [1.2, -0.2],
    lower_arm_R: [1.2, -0.2],
  };
  for (const [role, [amp, phase]] of Object.entries(breathe)) {
    const base = ((stance as Record<string, Num | Move | undefined>)[role] as Num | undefined) ?? 0;
    const scale = role.startsWith('upper') || role.startsWith('spine') ? g : 1;
    c.rotate(role, sine(N, amp * (role.includes('arm') ? 1 : g), { phase, offset: base * scale }));
  }
  for (const role of ['hand_R', 'hand_L'] as const) {
    const base = stance[role];
    if (base !== undefined)
      c.rotate(role, [
        { frame: 0, value: base },
        { frame: N, value: base },
      ]);
  }
  const hips = stance.hips ?? [0, 0];
  c.translate('hips', [
    { frame: 0, value: { x: hips[0] * g, y: hips[1] }, curve: EASE.inOut },
    { frame: 15, value: { x: hips[0] * g, y: hips[1] - 0.9 }, curve: EASE.inOut },
    { frame: N, value: { x: hips[0] * g, y: hips[1] } },
  ]);
  for (const r of ['ik_foot_L', 'ik_foot_R'] as const) {
    const v = stance[r];
    if (v)
      c.translate(r, [
        { frame: 0, value: { x: v[0] * g, y: v[1] } },
        { frame: N, value: { x: v[0] * g, y: v[1] } },
      ]);
  }
  return c.build();
}

/** The per-class pose tables. Kiếm tu keeps its hand-authored clips (no entry needed). */
export const CLASS_CLIPS: Readonly<Partial<Record<CharacterId, ClassClipSpec>>> = {
  // Thể tu: quyền sáo (gauntlets): guard stance, jab / hook / double palm, ground-slam cast
  'the-tu': {
    stance: {
      upper_arm_R: 55,
      lower_arm_R: 95,
      upper_arm_L: 50,
      lower_arm_L: 100,
      spine_mid: -4,
      hips: [0, -1.5],
      ik_foot_L: [2, 0],
      ik_foot_R: [-2, 0],
    },
    stanceBlend: true,
    // CALIBRATED FOR DIRECTION E ONLY (docs/OPEN-ITEMS.md 11): this table is direction-independent, so on S / SE / NE / N and on
    // the nominal template rigs (vertical arm rest) the +115 / +69 strike deltas point above horizontal until they are
    // re-calibrated or derived from each direction's rest angles when those directions are assembled.
    // The Thể tu E arms rest slanted (R back -115 deg, L forward -69 deg from the x axis: upper_arm world rotation), not
    // straight down, so a straight horizontal punch is about +115 / -9 on R and +69 / +10 on L (upper / lower arm delta).
    // jab (R): load the weight back, coil, drive the shoulder into a straight arm, plant the front foot, hold, recoil
    attack: {
      load: {
        upper_arm_R: 48,
        lower_arm_R: 92,
        upper_arm_L: 55,
        lower_arm_L: 100,
        spine_mid: 2,
        spine_upper: 2,
        hips: [-3, -2.5],
        ik_foot_L: [1, 0],
        ik_foot_R: [-4, 0],
      },
      windup: {
        upper_arm_R: 38,
        lower_arm_R: 70,
        upper_arm_L: 60,
        lower_arm_L: 104,
        spine_mid: 7,
        spine_upper: 5,
        hips: [-4, -3],
        ik_foot_L: [0, 0],
        ik_foot_R: [-5, 0],
      },
      hit: {
        upper_arm_R: 115,
        lower_arm_R: -9,
        upper_arm_L: 62,
        lower_arm_L: 105,
        spine_mid: -15,
        spine_upper: -9,
        hips: [7, -3.5],
        ik_foot_L: [9, 0],
        ik_foot_R: [-4, 0],
      },
      hold: 2,
      recoil: {
        upper_arm_R: 85,
        lower_arm_R: 45,
        upper_arm_L: 55,
        lower_arm_L: 100,
        spine_mid: -8,
        spine_upper: -4,
        hips: [3, -2.5],
        ik_foot_L: [6, 0],
        ik_foot_R: [-3, 0],
      },
    },
    // cross (L): the rear hand with the hip turn, a bigger drive than the jab
    attack_2: {
      load: {
        upper_arm_L: 40,
        lower_arm_L: 98,
        upper_arm_R: 58,
        lower_arm_R: 98,
        spine_mid: 4,
        spine_upper: 3,
        hips: [-3, -2.5],
        ik_foot_R: [-4, 0],
      },
      windup: {
        upper_arm_L: 28,
        lower_arm_L: 70,
        upper_arm_R: 60,
        lower_arm_R: 100,
        spine_mid: 10,
        spine_upper: 7,
        hips: [-5, -3],
        ik_foot_R: [-6, 0],
        ik_foot_L: [0, 0],
      },
      hit: {
        upper_arm_L: 69,
        lower_arm_L: 10,
        upper_arm_R: 64,
        lower_arm_R: 102,
        spine_mid: -19,
        spine_upper: -11,
        hips: [8, -4],
        ik_foot_R: [-2, 0],
        ik_foot_L: [10, 0],
      },
      hold: 2,
      recoil: {
        upper_arm_L: 58,
        lower_arm_L: 55,
        upper_arm_R: 58,
        lower_arm_R: 98,
        spine_mid: -9,
        spine_upper: -5,
        hips: [3, -2.5],
        ik_foot_L: [6, 0],
        ik_foot_R: [-3, 0],
      },
    },
    // finisher: double palm strike, both arms drive together, the longest hold
    attack_3: {
      load: {
        upper_arm_R: 48,
        lower_arm_R: 92,
        upper_arm_L: 40,
        lower_arm_L: 98,
        spine_mid: 5,
        spine_upper: 3,
        hips: [-4, -3],
        ik_foot_R: [-4, 0],
      },
      windup: {
        upper_arm_R: 38,
        lower_arm_R: 70,
        upper_arm_L: 28,
        lower_arm_L: 70,
        spine_mid: 11,
        spine_upper: 7,
        hips: [-5, -4],
        ik_foot_R: [-6, 0],
        ik_foot_L: [0, 0],
      },
      hit: {
        upper_arm_R: 112,
        lower_arm_R: -9,
        upper_arm_L: 69,
        lower_arm_L: 10,
        spine_mid: -21,
        spine_upper: -12,
        hips: [9, -5],
        ik_foot_L: [12, 0],
        ik_foot_R: [-3, 0],
      },
      // the longest hold: 3 frames (6-8), so the combo window / recoil starts one frame later than the jab and cross (10)
      hold: 3,
      combo: 10,
      recoil: {
        upper_arm_R: 85,
        lower_arm_R: 45,
        upper_arm_L: 52,
        lower_arm_L: 55,
        spine_mid: -10,
        spine_upper: -5,
        hips: [4, -3],
        ik_foot_L: [7, 0],
        ik_foot_R: [-3, 0],
      },
    },
    // hit reaction of a tank: the guard tightens and the body gives a little, no big recoil
    hit: {
      upper_arm_R: 62,
      lower_arm_R: 105,
      upper_arm_L: 58,
      lower_arm_L: 108,
      spine_mid: 3,
      spine_upper: 4,
      hips: [-2.5, -2],
      ik_foot_L: [3, 0],
      ik_foot_R: [-4, 0],
    },
    cast: {
      gather: { upper_arm_R: 140, lower_arm_R: -15, upper_arm_L: 140, lower_arm_L: -15, spine_mid: 10, hips: [0, -2] },
      release: { upper_arm_R: 45, lower_arm_R: 0, upper_arm_L: 45, lower_arm_L: 0, spine_mid: -22, hips: [2, -7] },
    },
    channel: {
      pose: {
        upper_arm_R: 70,
        lower_arm_R: 80,
        upper_arm_L: 70,
        lower_arm_L: 80,
        spine_mid: -4,
        hips: [0, -4],
        ik_foot_L: [6, 0],
        ik_foot_R: [-6, 0],
      },
      tremor: ['upper_arm_R', 'upper_arm_L'],
    },
  },
  // Pháp tu: pháp trượng / quạt: staff flicks and thrust, two-hand raise to cast
  'phap-tu': {
    stance: { upper_arm_R: 20, lower_arm_R: 40, upper_arm_L: 8, lower_arm_L: 20 },
    attack: {
      windup: { upper_arm_R: 110, lower_arm_R: -20, spine_mid: 6 },
      hit: { upper_arm_R: 60, lower_arm_R: 10, spine_mid: -7, hips: [2, -1] },
    },
    attack_2: {
      windup: { upper_arm_R: 10, lower_arm_R: 20, spine_mid: 6 },
      hit: { upper_arm_R: 90, lower_arm_R: 0, spine_mid: -9, hips: [3, -1.5] },
    },
    attack_3: {
      windup: { upper_arm_R: 60, lower_arm_R: 65, upper_arm_L: 55, lower_arm_L: 60, spine_mid: 8 },
      hit: { upper_arm_R: 95, lower_arm_R: 8, upper_arm_L: 85, lower_arm_L: 18, spine_mid: -14, hips: [5, -3] },
    },
    cast: {
      gather: { upper_arm_R: 100, lower_arm_R: 90, upper_arm_L: 95, lower_arm_L: 90, spine_mid: 6 },
      release: { upper_arm_R: 75, lower_arm_R: 0, upper_arm_L: 30, lower_arm_L: 30, spine_mid: -10, hips: [2, -1] },
    },
    channel: {
      pose: { upper_arm_R: 105, lower_arm_R: 20, upper_arm_L: 100, lower_arm_L: 20, spine_mid: -3 },
      tremor: ['upper_arm_R', 'upper_arm_L'],
    },
  },
  // Đan/Phù tu: phất trần / bút phù, phù lục thrown with the free hand
  'dan-phu-tu': {
    stance: { upper_arm_R: 25, lower_arm_R: 55, upper_arm_L: 10, lower_arm_L: 35 },
    attack: {
      windup: { upper_arm_R: 80, lower_arm_R: -20, spine_mid: 5 },
      hit: { upper_arm_R: 20, lower_arm_R: 10, spine_mid: -5, hips: [1, -1] },
    },
    attack_2: {
      windup: { upper_arm_R: 60, lower_arm_R: 90, upper_arm_L: 20, lower_arm_L: 20, spine_mid: 4 },
      hit: { upper_arm_R: 80, lower_arm_R: 20, upper_arm_L: 20, lower_arm_L: 20, spine_mid: -7, hips: [2, -1] },
    },
    attack_3: {
      windup: { upper_arm_L: 95, lower_arm_L: -30, upper_arm_R: 30, lower_arm_R: 50, spine_mid: 8 },
      hit: { upper_arm_L: 50, lower_arm_L: 10, upper_arm_R: 40, lower_arm_R: 50, spine_mid: -10, hips: [3, -2] },
    },
    cast: {
      gather: { upper_arm_R: 85, lower_arm_R: 85, upper_arm_L: 80, lower_arm_L: 80, spine_mid: 4 },
      release: { upper_arm_R: 95, lower_arm_R: 0, upper_arm_L: 95, lower_arm_L: 0, spine_mid: -8, hips: [2, -1] },
    },
    channel: {
      pose: { upper_arm_R: 80, lower_arm_R: 100, upper_arm_L: 78, lower_arm_L: 98, spine_mid: -2 },
      tremor: ['lower_arm_R', 'upper_arm_L'],
    },
  },
};

/** Clip makers for a class (empty for a class that keeps the Kiếm tu hand-authored set). */
export function classOverrides(
  id: CharacterId,
): Partial<
  Record<'idle' | 'attack' | 'attack_2' | 'attack_3' | 'cast' | 'channel' | 'hit', (rig: RigDocument) => Clip>
> {
  const s = CLASS_CLIPS[id];
  if (!s) return {};
  const rest = s.stanceBlend ? s.stance : {};
  return {
    idle: (rig) => idle(rig, s.stance),
    attack: (rig) => strike(rig, 'attack', s.attack, { windupEnd: 4, hit: 6, combo: s.attack.combo ?? 9 }, rest),
    attack_2: (rig) =>
      strike(rig, 'attack_2', s.attack_2, { windupEnd: 3, hit: 5, combo: s.attack_2.combo ?? 9 }, rest),
    attack_3: (rig) =>
      strike(rig, 'attack_3', s.attack_3, { windupEnd: 4, hit: 6, combo: s.attack_3.combo ?? 9 }, rest),
    cast: (rig) => cast(rig, s.cast),
    channel: (rig) => channel(rig, s.channel),
    ...(s.hit ? { hit: (rig: RigDocument) => hitReaction(rig, s.hit!, rest) } : {}),
  };
}

/** The class's full clip set: Kiếm tu clips for everything the weapon does not change, overrides for the rest. */
export function authorClassSet(id: CharacterId, rig: RigDocument, opts: KiemTuOptions = {}): Clip[] {
  const profile = ASSEMBLY_PROFILES[id];
  return authorKiemTuSet(rig, {
    // the gait is NOT injected here: the committed / template rigs keep the shared locomotion (a class gait is for
    // assembled continuous-limb rigs, passed explicitly by `rig:assemble` / `rig:measure --assembled`)
    ...(profile ? { detailRules: profile.detail } : {}),
    ...opts,
    overrides: { ...classOverrides(id), ...opts.overrides },
  });
}
