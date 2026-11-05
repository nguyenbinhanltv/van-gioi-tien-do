/**
 * Kiếm tu (sword cultivator) animation set, authored against bone **roles** so it drives any humanoid rig that
 * provides them (the reference rig today, the concept-A rig from `tools/rig/kiem-tu.rig.json` when it lands).
 * Authored in profile terms (character faces +x, arms hang down at rest); amplitudes are scaled by the view for the
 * foreshortened directions. Angles are deltas from the rest pose, degrees CCW (positive = arm swings forward/up,
 * spine leans back). This is a first AI pass: the owner reviews it in the viewer (D36) and asks for changes.
 */
import type { Direction } from '@vgtd/shared';
import { clipSpec } from './animset.js';
import { sampleScalar, sampleVec, type BoneTrack, type Clip, type Key } from './clip.js';
import { ClipBuilder, EASE } from './dsl.js';
import { closeLoop } from './loop.js';
import { crouchFor, legReach, planFeet, screenAxis } from './locomotion.js';
import { angleDelta, type Vec2 } from './math.js';
import { evalPose } from './pose.js';
import { fitToSilhouette } from './fit.js';
import type { LoadedAtlas } from './render/render.js';
import { bakeSecondaryMotion, simplifyScalar } from './secondary.js';
import type { RigDocument } from './schema.js';

/** The first batch: idle, run, 3-hit combo, cast, hit, die. */
export const KIEMTU_CORE_CLIPS = ['idle', 'run', 'attack', 'attack_2', 'attack_3', 'cast', 'hit', 'die'] as const;
/** The rest of the 13-animation table (docs/03 §3). */
export const KIEMTU_EXTRA_CLIPS = ['walk', 'dash', 'meditate', 'channel', 'sword_fly', 'tribulation', 'emote'] as const;
/** All 13 table animations (attack has two more combo variants: 15 clips). */
export const KIEMTU_CLIPS = [...KIEMTU_CORE_CLIPS, ...KIEMTU_EXTRA_CLIPS] as const;
export type KiemTuClip = (typeof KIEMTU_CLIPS)[number];

/** Authored run speed (px/s along the facing). The runtime sets timeScale = actual / authored to avoid sliding. */
export const RUN_SPEED_PX_S = 150;
/** Authored walk speed (px/s). */
export const WALK_SPEED_PX_S = 80;
/** Knees stay bent while running: the hips ride this far below the straight-leg height. */
export const RUN_CROUCH_PX = 9;

/** How much of the profile swing survives in a view (E = 1 … S/N = mostly foreshortened). */
export function viewGain(direction: Direction): number {
  switch (direction) {
    case 'E':
    case 'W':
      return 1;
    case 'SE':
    case 'NE':
    case 'SW':
    case 'NW':
      return 0.8;
    default:
      return 0.5;
  }
}

/** A per-frame sampled sine (periodic over `frames` for integer `cycles`). */
export function sine(
  frames: number,
  amp: number,
  o: { cycles?: number; phase?: number; offset?: number } = {},
): Key<number>[] {
  const keys: Key<number>[] = [];
  for (let f = 0; f <= frames; f++) {
    keys.push({
      frame: f,
      value: (o.offset ?? 0) + amp * Math.sin(2 * Math.PI * ((o.cycles ?? 1) * (f / frames) + (o.phase ?? 0))),
    });
  }
  return keys;
}

export function authorIdle(rig: RigDocument): Clip {
  const spec = clipSpec('idle');
  const N = 30;
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'idle', frames: spec.frames === N ? N : spec.frames, loop: true });
  // slow breathing: chest rises, shoulders follow a few frames later (overlap), head settles last
  c.rotate('spine_mid', sine(N, 1.2 * g, { phase: 0 }));
  c.rotate('spine_upper', sine(N, 1.8 * g, { phase: -0.08 }));
  c.rotate('head', sine(N, 1.4, { phase: -0.16 }));
  c.translate('hips', [
    { frame: 0, value: { x: 0, y: 0 }, curve: EASE.inOut },
    { frame: 15, value: { x: 0, y: -0.9 }, curve: EASE.inOut },
    { frame: 30, value: { x: 0, y: 0 } },
  ]);
  c.rotate('upper_arm_L', sine(N, 1.6, { phase: -0.12 }));
  c.rotate('upper_arm_R', sine(N, 1.6, { phase: -0.12, offset: 0 }));
  c.rotate('lower_arm_R', sine(N, 1.2, { phase: -0.2, offset: 6 }));
  c.rotate('lower_arm_L', sine(N, 1.2, { phase: -0.2, offset: 6 }));
  return c.build();
}

export function authorRun(rig: RigDocument): Clip {
  const N = clipSpec('run').frames; // 15
  const g = viewGain(rig.direction);
  const axis = screenAxis(rig.direction);
  // foreshortened views move less on screen: scale the authored screen speed so the stride stays reachable
  const speed = RUN_SPEED_PX_S * g;
  const plan = planFeet(rig, {
    frames: N,
    speed,
    duty: 0.42,
    footLift: 9,
    axis,
    phase: -0.2,
    crouch: RUN_CROUCH_PX,
    bob: 2,
    sway: 1.2 * g,
  });
  const c = new ClipBuilder(rig, {
    name: 'run',
    frames: N,
    loop: true,
    motion: {
      speed,
      planted: { [rig.roles.foot_L!]: plan.planted.L, [rig.roles.foot_R!]: plan.planted.R },
    },
  });
  c.merge(plan.tracks);
  // L foot touches down at cycle 0.2, R at 0.7 (docs/03: footsteps at sprite frames 2 and 7 of 10)
  c.event(Math.round(0.2 * N), 'footstep_L');
  c.event(Math.round(0.7 * N), 'footstep_R');
  c.rotate('spine_mid', sine(N, 1.6 * g, { cycles: 2, phase: 0.1, offset: -7 * g }));
  c.rotate('spine_upper', sine(N, 3.2 * g, { cycles: 1, phase: 0.25, offset: -3 * g }));
  c.rotate('head', sine(N, 1.4, { cycles: 2, phase: 0.3, offset: 7 * g }));
  c.rotate('upper_arm_L', sine(N, 46 * g, { cycles: 1, phase: 0.25 }));
  c.rotate('upper_arm_R', sine(N, 46 * g, { cycles: 1, phase: -0.25 }));
  c.rotate('lower_arm_L', sine(N, 10 * g, { cycles: 1, phase: 0.05, offset: 70 * g }));
  c.rotate('lower_arm_R', sine(N, 10 * g, { cycles: 1, phase: -0.45, offset: 70 * g }));
  return closeLoop(c.build());
}

/** Common attack skeleton: phases + events + a lunge and recovery to the rest pose. */
function attackBase(
  rig: RigDocument,
  name: string,
  hitFrame: number,
  windupEnd: number,
  comboWindow: number,
): ClipBuilder {
  const spec = clipSpec('attack');
  return new ClipBuilder(rig, {
    name,
    frames: spec.frames,
    loop: false,
    phases: { windup_end: windupEnd, hit_frame: hitFrame, combo_window: comboWindow },
  })
    .event(hitFrame, 'hit')
    .event(comboWindow, 'cancel_window');
}

export function authorAttack1(rig: RigDocument): Clip {
  const g = viewGain(rig.direction);
  const N = clipSpec('attack').frames; // 13
  const c = attackBase(rig, 'attack', 6, 4, 9);
  // overhead chop: raise the blade behind (anticipation), whip down through the target, follow-through, recover
  c.rotate('upper_arm_R', [
    [0, 0, EASE.inOut],
    [1, -8, EASE.inOut],
    [4, 140 * g, EASE.inOut],
    [6, 85 * g, EASE.snapOut],
    [8, 62 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('lower_arm_R', [
    [0, 0],
    [4, -35, EASE.whip],
    [6, 0, EASE.out],
    [N, 0],
  ]);
  c.rotate('hand_R', [
    [0, 0],
    [4, 30, EASE.whip],
    [6, -14, EASE.out],
    [9, 0, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0],
    [4, 28 * g, EASE.inOut],
    [6, -18 * g, EASE.out],
    [N, 0],
  ]);
  c.rotate('spine_mid', [
    [0, 0],
    [4, 12 * g, EASE.whip],
    [6, -14 * g, EASE.snapOut],
    [9, -6 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('head', [
    [0, 0],
    [4, 4, EASE.inOut],
    [6, -8, EASE.out],
    [N, 0],
  ]);
  c.translate('hips', [
    [0, 0, 0],
    [4, -2 * g, -0.8, EASE.whip],
    [6, 6 * g, -3.5, EASE.snapOut],
    [N, 0, 0, EASE.inOut],
  ]);
  c.translate('ik_foot_L', [
    [0, 0, 0],
    [4, 0, 0],
    [6, 9 * g, 0, EASE.snapOut],
    [N, 0, 0, EASE.inOut],
  ]);
  return c.build();
}

export function authorAttack2(rig: RigDocument): Clip {
  const g = viewGain(rig.direction);
  const N = clipSpec('attack').frames;
  const c = attackBase(rig, 'attack_2', 5, 3, 9);
  // rising backhand sweep: blade drops behind, then arcs up through the target
  c.rotate('upper_arm_R', [
    [0, 0, EASE.inOut],
    [2, -45 * g, EASE.inOut],
    [5, 70 * g, EASE.snapOut],
    [7, 150 * g, EASE.out],
    [9, 140 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('lower_arm_R', [
    [0, 0],
    [3, 20, EASE.whip],
    [5, -5, EASE.out],
    [N, 0],
  ]);
  c.rotate('hand_R', [
    [0, 0],
    [3, -20, EASE.whip],
    [5, 25, EASE.out],
    [9, 5, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0],
    [3, 20 * g, EASE.inOut],
    [5, -30 * g, EASE.out],
    [N, 0],
  ]);
  c.rotate('spine_mid', [
    [0, 0],
    [3, 10 * g, EASE.whip],
    [5, -9 * g, EASE.snapOut],
    [8, 4 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('head', [
    [0, 0],
    [3, 5, EASE.inOut],
    [5, -3, EASE.out],
    [N, 0],
  ]);
  c.translate('hips', [
    [0, 0, 0],
    [3, -3 * g, -0.6, EASE.whip],
    [5, 5 * g, -3, EASE.snapOut],
    [N, 0, 0, EASE.inOut],
  ]);
  c.translate('ik_foot_L', [
    [0, 0, 0],
    [3, 0, 0],
    [5, 8 * g, 0, EASE.snapOut],
    [N, 0, 0, EASE.inOut],
  ]);
  return c.build();
}

export function authorAttack3(rig: RigDocument): Clip {
  const g = viewGain(rig.direction);
  const N = clipSpec('attack').frames;
  const c = attackBase(rig, 'attack_3', 6, 4, 9);
  // finisher: coil, then a deep lunge with a full-arm thrust
  c.rotate('upper_arm_R', [
    [0, 0, EASE.inOut],
    [4, 55 * g, EASE.whip],
    [6, 98 * g, EASE.snapOut],
    [8, 96 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('lower_arm_R', [
    [0, 0],
    [3, 105, EASE.inOut],
    [6, 0, EASE.snapOut],
    [8, 0, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('hand_R', [
    [0, 0],
    [4, 0],
    [6, 12, EASE.out],
    [N, 0],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0],
    [4, -35 * g, EASE.inOut],
    [6, -60 * g, EASE.out],
    [N, 0],
  ]);
  c.rotate('spine_mid', [
    [0, 0],
    [4, 10 * g, EASE.whip],
    [6, -20 * g, EASE.snapOut],
    [9, -12 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('spine_upper', [
    [0, 0],
    [4, 6 * g, EASE.inOut],
    [6, -8 * g, EASE.snapOut],
    [N, 0],
  ]);
  c.rotate('head', [
    [0, 0],
    [4, 6, EASE.inOut],
    [6, -6, EASE.out],
    [N, 0],
  ]);
  c.translate('hips', [
    [0, 0, 0],
    [4, -3 * g, -1, EASE.whip],
    [6, 9 * g, -5, EASE.snapOut],
    [9, 7 * g, -4, EASE.inOut],
    [N, 0, 0, EASE.inOut],
  ]);
  c.translate('ik_foot_L', [
    [0, 0, 0],
    [4, 0, 0],
    [6, 12 * g, 0, EASE.snapOut],
    [N, 0, 0, EASE.inOut],
  ]);
  c.translate('ik_foot_R', [
    [0, 0, 0],
    [4, -2 * g, 0],
    [6, -4 * g, 0, EASE.snapOut],
    [N, 0, 0, EASE.inOut],
  ]);
  return c.build();
}

export function authorCast(rig: RigDocument): Clip {
  const g = viewGain(rig.direction);
  const N = clipSpec('cast').frames; // 15
  const c = new ClipBuilder(rig, { name: 'cast', frames: N, loop: false, phases: { windup_end: 8 } });
  c.event(8, 'vfx_spawn');
  // both hands gather qi at the chest (0-8), then the right hand pushes the spell out (8-11), recover
  c.rotate('upper_arm_R', [
    [0, 0, EASE.inOut],
    [8, 105 * g, EASE.inOut],
    [11, 88 * g, EASE.snapOut],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('lower_arm_R', [
    [0, 0, EASE.inOut],
    [8, 80, EASE.inOut],
    [11, 0, EASE.snapOut],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('hand_R', [
    [0, 0],
    [8, 10, EASE.inOut],
    [11, -12, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0, EASE.inOut],
    [8, 98 * g, EASE.inOut],
    [11, 40 * g, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('lower_arm_L', [
    [0, 0, EASE.inOut],
    [8, 88, EASE.inOut],
    [11, 30, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('spine_mid', [
    [0, 0, EASE.inOut],
    [8, 5 * g, EASE.inOut],
    [11, -7 * g, EASE.snapOut],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('head', [
    [0, 0],
    [8, -5, EASE.inOut],
    [11, 3, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.translate('hips', [
    [0, 0, 0],
    [8, -1 * g, -1.5, EASE.inOut],
    [11, 2 * g, -1, EASE.snapOut],
    [N, 0, 0, EASE.inOut],
  ]);
  return c.build();
}

export function authorHit(rig: RigDocument): Clip {
  const g = viewGain(rig.direction);
  const N = clipSpec('hit').frames; // 6
  const c = new ClipBuilder(rig, { name: 'hit', frames: N, loop: false });
  c.rotate('spine_mid', [
    [0, 0, EASE.snapOut],
    [2, 15 * g, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('spine_upper', [
    [0, 0, EASE.snapOut],
    [2, 8 * g, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('head', [
    [0, 0, EASE.snapOut],
    [2, 16, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('upper_arm_R', [
    [0, 0, EASE.snapOut],
    [2, -28 * g, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0, EASE.snapOut],
    [2, -22 * g, EASE.out],
    [N, 0, EASE.inOut],
  ]);
  c.translate('hips', [
    [0, 0, 0, EASE.snapOut],
    [2, -3.5 * g, -2, EASE.out],
    [N, 0, 0, EASE.inOut],
  ]);
  return c.build();
}

/** Height of the hips above the ground at rest (px): poses on the ground are authored relative to it. */
export function restHipHeight(rig: RigDocument): number {
  const hips = rig.roles.hips;
  return evalPose(rig, null, 0, { noIk: true }).byName.get(hips!)!.pos.y;
}

export function authorDie(rig: RigDocument): Clip {
  const g = viewGain(rig.direction);
  const lying = Math.max(10, restHipHeight(rig) - 8); // hips come to rest 8 px above the ground
  const N = clipSpec('die').frames; // 24
  const c = new ClipBuilder(rig, { name: 'die', frames: N, loop: false });
  const legsIk = ikConstraintsFor(rig, ['ik_foot_L', 'ik_foot_R']).map((k) => k.name);
  for (const ik of legsIk)
    c.ikMix(ik, [
      [0, 1],
      [2, 1],
      [3, 0],
      [N, 0],
    ]);
  // hit recoil (0-3), buckle and fall backwards (3-16), settle lying down (16-24)
  c.translate('hips', [
    [0, 0, 0, EASE.snapOut],
    [3, -3 * g, -1, EASE.fall],
    [10, -8 * g, -0.6 * lying, EASE.fall],
    [16, -21 * g, -lying, EASE.out],
    [N, -22 * g, -lying],
  ]);
  c.rotate('hips', [
    [0, 0, EASE.snapOut],
    [3, 8 * g, EASE.fall],
    [10, 42, EASE.fall],
    [16, 88, EASE.out],
    [N, 90],
  ]);
  c.rotate('spine_mid', [
    [0, 0, EASE.snapOut],
    [3, 14 * g, EASE.inOut],
    [16, 6, EASE.out],
    [N, 4],
  ]);
  c.rotate('head', [
    [0, 0, EASE.snapOut],
    [3, 16, EASE.inOut],
    [12, 8, EASE.out],
    [N, 6],
  ]);
  for (const side of ['L', 'R'] as const) {
    c.rotate(`thigh_${side}`, [
      [0, 0],
      [3, 0, EASE.fall],
      [16, side === 'L' ? 8 : 3, EASE.out],
      [N, side === 'L' ? 8 : 3],
    ]);
    c.rotate(`shin_${side}`, [
      [0, 0],
      [3, 0, EASE.fall],
      [16, side === 'L' ? -14 : -8, EASE.out],
      [N, side === 'L' ? -14 : -8],
    ]);
  }
  c.rotate('upper_arm_R', [
    [0, 0],
    [3, -28 * g, EASE.inOut],
    [16, 14, EASE.out],
    [N, 12],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0],
    [3, -22 * g, EASE.inOut],
    [16, 24, EASE.out],
    [N, 22],
  ]);
  return c.build();
}

/** IK constraints driving the given target roles (rig-independent: constraint names are the rig author's choice). */
export function ikConstraintsFor(
  rig: RigDocument,
  roles: readonly ('ik_foot_L' | 'ik_foot_R' | 'ik_hand_L' | 'ik_hand_R')[],
) {
  const targets = new Set(roles.map((r) => rig.roles[r]).filter((x): x is string => !!x));
  return (rig.ik ?? []).filter((k) => targets.has(k.target));
}

/**
 * The clips are FK on the arms (rotations on upper/lower arm). A rig may ship hand IK enabled by default; switch it off
 * for the whole clip unless the clip animates that constraint itself, so the authored arm motion is what plays.
 */
export function armsFk(rig: RigDocument, clip: Clip): Clip {
  const extra = ikConstraintsFor(rig, ['ik_hand_L', 'ik_hand_R'])
    .filter((k) => (k.mix ?? 1) > 0 && !clip.ik.some((t) => t.ik === k.name))
    .map((k) => ({
      ik: k.name,
      mix: [
        { frame: 0, value: 0 },
        { frame: clip.frames, value: 0 },
      ],
    }));
  return extra.length ? { ...clip, ik: [...clip.ik, ...extra] } : clip;
}

export function authorWalk(rig: RigDocument): Clip {
  const N = clipSpec('walk').frames; // 20
  const g = viewGain(rig.direction);
  const speed = WALK_SPEED_PX_S * g;
  const axis = screenAxis(rig.direction);
  // knees stay bent enough that the vertical part of the stride (front/back views) is reachable
  const crouch = Math.max(6, crouchFor(legReach(rig), axis, (speed * 0.62 * (N / 30)) / 2));
  const plan = planFeet(rig, {
    frames: N,
    speed,
    duty: 0.62,
    footLift: 5,
    axis,
    phase: 0,
    crouch,
    bob: 1.2,
    sway: 0.8 * g,
  });
  const c = new ClipBuilder(rig, {
    name: 'walk',
    frames: N,
    loop: true,
    motion: { speed, planted: { [rig.roles.foot_L!]: plan.planted.L, [rig.roles.foot_R!]: plan.planted.R } },
  });
  c.merge(plan.tracks);
  c.rotate('spine_mid', sine(N, 1.2 * g, { cycles: 2, phase: 0.1, offset: -2 * g }));
  c.rotate('spine_upper', sine(N, 2.4 * g, { phase: 0.25 }));
  c.rotate('head', sine(N, 1, { cycles: 2, phase: 0.3, offset: 2 * g }));
  c.rotate('upper_arm_L', sine(N, 24 * g, { phase: 0.25 }));
  c.rotate('upper_arm_R', sine(N, 24 * g, { phase: -0.25 }));
  c.rotate('lower_arm_L', sine(N, 6 * g, { phase: 0.05, offset: 16 * g }));
  c.rotate('lower_arm_R', sine(N, 6 * g, { phase: -0.45, offset: 16 * g }));
  return closeLoop(c.build());
}

export function authorDash(rig: RigDocument): Clip {
  const N = clipSpec('dash').frames; // 8
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'dash', frames: N, loop: false });
  // khinh công: lean hard into the dash, arms swept back, front leg reaching, back leg trailing and lifted
  c.rotate('spine_mid', [
    [0, 0, EASE.out],
    [3, -20 * g, EASE.inOut],
    [6, -18 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('spine_upper', [
    [0, 0, EASE.out],
    [3, -8 * g, EASE.inOut],
    [6, -8 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('head', [
    [0, 0, EASE.out],
    [3, 12, EASE.inOut],
    [6, 12, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0, EASE.out],
    [3, -75 * g, EASE.inOut],
    [6, -70 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('upper_arm_R', [
    [0, 0, EASE.out],
    [3, -62 * g, EASE.inOut],
    [6, -58 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('lower_arm_L', [
    [0, 0],
    [3, 20, EASE.inOut],
    [6, 20, EASE.inOut],
    [N, 0],
  ]);
  c.translate('hips', [
    [0, 0, 0, EASE.out],
    [3, 3 * g, -9, EASE.inOut],
    [6, 3 * g, -9, EASE.inOut],
    [N, 0, 0, EASE.inOut],
  ]);
  c.translate('ik_foot_L', [
    [0, 0, 0, EASE.out],
    [3, 15 * g, 0, EASE.inOut],
    [6, 15 * g, 0, EASE.inOut],
    [N, 0, 0, EASE.inOut],
  ]);
  c.translate('ik_foot_R', [
    [0, 0, 0, EASE.out],
    [3, -14 * g, 7, EASE.inOut],
    [6, -14 * g, 7, EASE.inOut],
    [N, 0, 0, EASE.inOut],
  ]);
  return c.build();
}

/** FK-only seated pose helper (legs leave IK so the hips can sit on the ground). */
function legsFk(c: ClipBuilder, rig: RigDocument, frames: number): void {
  for (const ik of ikConstraintsFor(rig, ['ik_foot_L', 'ik_foot_R'])) {
    c.ikMix(ik.name, [
      [0, 0],
      [frames, 0],
    ]);
  }
}

export function authorMeditate(rig: RigDocument): Clip {
  const N = clipSpec('meditate').frames; // 30
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'meditate', frames: N, loop: true });
  legsFk(c, rig, N);
  const seat = Math.max(10, restHipHeight(rig) - 10); // seated hips 10 px above the ground
  // cross-legged on the ground: hips drop, thighs forward, shins folded back; slow breathing
  c.translate('hips', [
    [0, 0, -seat],
    [N, 0, -seat],
  ]);
  for (const side of ['L', 'R'] as const) {
    const th = side === 'L' ? 78 : 92;
    const sh = side === 'L' ? -150 : -135;
    c.rotate(`thigh_${side}`, [
      [0, th],
      [N, th],
    ]);
    c.rotate(`shin_${side}`, [
      [0, sh],
      [N, sh],
    ]);
  }
  c.rotate('spine_mid', sine(N, 1.1 * g));
  c.rotate('spine_upper', sine(N, 1.5 * g, { phase: -0.08 }));
  c.rotate('head', sine(N, 1.2, { phase: -0.16, offset: 2 }));
  c.rotate('upper_arm_L', sine(N, 1.4, { phase: -0.12, offset: 38 * g }));
  c.rotate('upper_arm_R', sine(N, 1.4, { phase: -0.12, offset: 38 * g }));
  c.rotate('lower_arm_L', sine(N, 1.2, { phase: -0.2, offset: 52 }));
  c.rotate('lower_arm_R', sine(N, 1.2, { phase: -0.2, offset: 52 }));
  return closeLoop(c.build());
}

export function authorChannel(rig: RigDocument): Clip {
  const N = clipSpec('channel').frames; // 12
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'channel', frames: N, loop: true });
  // sustained cast: both arms thrust forward and tremble with the flow of qi, body braced
  c.rotate('upper_arm_R', sine(N, 2.2, { cycles: 2, offset: 90 * g }));
  c.rotate('upper_arm_L', sine(N, 2.2, { cycles: 2, phase: 0.25, offset: 82 * g }));
  c.rotate('lower_arm_R', sine(N, 3, { cycles: 2, phase: 0.1, offset: 4 }));
  c.rotate('lower_arm_L', sine(N, 3, { cycles: 2, phase: 0.35, offset: 8 }));
  c.rotate('spine_mid', sine(N, 1, { offset: -6 * g }));
  c.rotate('head', sine(N, 1.2, { cycles: 2, phase: 0.2, offset: 2 }));
  c.translate('hips', [
    [0, 1 * g, -1.2],
    [N, 1 * g, -1.2],
  ]);
  return closeLoop(c.build());
}

export function authorSwordFly(rig: RigDocument): Clip {
  const N = clipSpec('sword_fly').frames; // 20
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'sword_fly', frames: N, loop: true });
  // standing on the flying sword: wide braced stance, arms out for balance; the up/down bob is a code-driven offset
  c.translate('hips', [
    [0, 0, -5],
    [N, 0, -5],
  ]);
  c.translate('ik_foot_L', [
    [0, 5 * g, 0],
    [N, 5 * g, 0],
  ]);
  c.translate('ik_foot_R', [
    [0, -5 * g, 0],
    [N, -5 * g, 0],
  ]);
  c.rotate('spine_mid', sine(N, 1.4 * g, { offset: -3 * g }));
  c.rotate('spine_upper', sine(N, 1.8 * g, { phase: -0.1 }));
  c.rotate('head', sine(N, 1.2, { phase: -0.2, offset: 3 }));
  c.rotate('upper_arm_R', sine(N, 3, { phase: 0.1, offset: 28 * g }));
  c.rotate('upper_arm_L', sine(N, 3, { phase: 0.6, offset: -24 * g }));
  c.rotate('lower_arm_R', sine(N, 2, { phase: 0.2, offset: 14 }));
  c.rotate('lower_arm_L', sine(N, 2, { phase: 0.7, offset: 10 }));
  return closeLoop(c.build());
}

export function authorTribulation(rig: RigDocument): Clip {
  const N = clipSpec('tribulation').frames; // 30
  const g = viewGain(rig.direction);
  // brace (0-6), endure with a shaking hold that loops per lightning strike (6-24), recover (24-30)
  const c = new ClipBuilder(rig, {
    name: 'tribulation',
    frames: N,
    loop: false,
    phases: { loop_start: 6, loop_end: 24 },
  });
  const hold = (v: number, amp: number): Key<number>[] => [
    { frame: 0, value: 0, curve: EASE.out },
    { frame: 6, value: v, curve: EASE.inOut },
    { frame: 9, value: v + amp, curve: EASE.inOut },
    { frame: 12, value: v - amp, curve: EASE.inOut },
    { frame: 15, value: v + amp, curve: EASE.inOut },
    { frame: 18, value: v - amp, curve: EASE.inOut },
    { frame: 21, value: v + amp, curve: EASE.inOut },
    { frame: 24, value: v, curve: EASE.inOut },
    { frame: N, value: 0 },
  ];
  c.rotate('upper_arm_R', hold(155 * g, 4));
  c.rotate('upper_arm_L', hold(150 * g, 4));
  c.rotate('lower_arm_R', hold(-35, 5));
  c.rotate('lower_arm_L', hold(-30, 5));
  c.rotate('spine_mid', hold(6 * g, 2));
  c.rotate('head', hold(14, 3));
  c.translate('hips', [
    [0, 0, 0, EASE.out],
    [6, 0, -9, EASE.inOut],
    [24, 0, -9, EASE.inOut],
    [N, 0, 0, EASE.inOut],
  ]);
  c.translate('ik_foot_L', [
    [0, 0, 0],
    [6, 7 * g, 0, EASE.inOut],
    [24, 7 * g, 0, EASE.inOut],
    [N, 0, 0],
  ]);
  c.translate('ik_foot_R', [
    [0, 0, 0],
    [6, -7 * g, 0, EASE.inOut],
    [24, -7 * g, 0, EASE.inOut],
    [N, 0, 0],
  ]);
  return c.build();
}

export function authorEmote(rig: RigDocument): Clip {
  const N = clipSpec('emote').frames; // 30
  const g = viewGain(rig.direction);
  const c = new ClipBuilder(rig, { name: 'emote', frames: N, loop: false });
  // bái (salute): fists together at the chest, a respectful bow, hold, rise
  c.rotate('upper_arm_R', [
    [0, 0, EASE.inOut],
    [8, 62 * g, EASE.inOut],
    [22, 62 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0, EASE.inOut],
    [8, 66 * g, EASE.inOut],
    [22, 66 * g, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('lower_arm_R', [
    [0, 0, EASE.inOut],
    [8, 100, EASE.inOut],
    [22, 100, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('lower_arm_L', [
    [0, 0, EASE.inOut],
    [8, 96, EASE.inOut],
    [22, 96, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('spine_mid', [
    [0, 0, EASE.inOut],
    [10, 0],
    [16, -24 * g, EASE.inOut],
    [20, -24 * g, EASE.inOut],
    [26, 0, EASE.inOut],
    [N, 0],
  ]);
  c.rotate('head', [
    [0, 0, EASE.inOut],
    [10, 0],
    [16, -8, EASE.inOut],
    [20, -8, EASE.inOut],
    [26, 0, EASE.inOut],
    [N, 0],
  ]);
  c.translate('hips', [
    [0, 0, 0, EASE.inOut],
    [16, 2 * g, -1.5, EASE.inOut],
    [20, 2 * g, -1.5, EASE.inOut],
    [26, 0, 0, EASE.inOut],
    [N, 0, 0],
  ]);
  return c.build();
}

/**
 * Keep planted feet flat. The IK solver places the ankle, but the foot bone is a child of the shin and pitches with
 * it, so toes dig into the floor. Bake a counter-rotation per frame so the foot's world angle stays at its rest angle
 * while the ankle is near the ground, fading out as the foot lifts (swing). Only where the leg IK is active.
 */
export function alignFeet(rig: RigDocument, clip: Clip): Clip {
  const legs = ikConstraintsFor(rig, ['ik_foot_L', 'ik_foot_R']);
  if (!legs.length) return clip;
  const rest = evalPose(rig, null, 0, { noIk: true });
  const bones = [...clip.bones];
  for (const leg of legs) {
    const foot = (rig.bones.find((b) => b.parent === leg.bones[leg.bones.length - 1]) ?? null)?.name;
    if (!foot) continue;
    const restWorld = rest.byName.get(foot)!.rotation;
    const restAnkle = rest.byName.get(foot)!.pos.y;
    const mixTrack = clip.ik.find((t) => t.ik === leg.name)?.mix;
    const keys: Key<number>[] = [];
    for (let f = 0; f <= clip.frames; f++) {
      const mix = mixTrack?.length ? sampleScalar(mixTrack, f) : (leg.mix ?? 1);
      const pose = evalPose(rig, clip, f);
      const p = pose.byName.get(foot)!;
      const flat = angleDelta(p.rotation, restWorld);
      const lift = Math.max(0, p.pos.y - restAnkle);
      const weight = mix * (1 - Math.min(1, Math.max(0, (lift - 1) / 7)));
      keys.push({ frame: f, value: flat * weight });
    }
    const existing = bones.findIndex((b) => b.bone === foot);
    const track = simplifyScalar(keys, 0.25);
    if (existing >= 0) bones[existing] = { ...bones[existing]!, rotate: track };
    else bones.push({ bone: foot, rotate: track });
  }
  return { ...clip, bones };
}

/**
 * For ground poses (lying, seated) the authored hip drop depends on the rig's proportions. Raise the hips per frame by
 * exactly the amount the lowest point of the body sinks below the floor, so the pose rests on the ground for any rig.
 * Correct only for FK poses (leg IK off), which is the case for `die` and `meditate`.
 */
/** Bones that make up the body (the roles minus IK helpers); props such as a sword may poke through the floor. */
export function bodyBones(rig: RigDocument): Set<string> {
  return new Set(
    Object.entries(rig.roles)
      .filter(([role]) => !role.startsWith('ik_'))
      .map(([, bone]) => bone as string),
  );
}

export function liftToGround(rig: RigDocument, clip: Clip): Clip {
  const hips = rig.roles.hips;
  if (!hips) return clip;
  const body = bodyBones(rig);
  const existing = clip.bones.find((b) => b.bone === hips)?.translate;
  const keys: Key<Vec2>[] = [];
  for (let f = 0; f <= clip.frames; f++) {
    const pose = evalPose(rig, clip, f);
    let minY = Infinity;
    for (const b of pose.bones) {
      if (!body.has(b.name)) continue;
      minY = Math.min(minY, b.pos.y, b.tip.y);
    }
    const base = existing?.length ? sampleVec(existing, f) : { x: 0, y: 0 };
    keys.push({ frame: f, value: { x: base.x, y: base.y + Math.max(0, -minY) } });
  }
  const track: BoneTrack = { bone: hips, translate: keys };
  return {
    ...clip,
    bones: [
      ...clip.bones.filter((b) => b.bone !== hips),
      ...(clip.bones.some((b) => b.bone === hips)
        ? [{ ...clip.bones.find((b) => b.bone === hips)!, ...track }]
        : [track]),
    ],
  };
}

/** Skirt / robe panels hanging from the hips (rig-specific names): they should swing with the legs, not stay rigid. */
const SKIRT_BONE = /^(robe|skirt|apron)/i;

/**
 * Make hip-hung robe panels follow the legs: the front panel lifts with the more-forward thigh, the back panel with the
 * more-backward one (half the angle, clamped, smoothed over 3 frames). Without this the legs swing out from under a
 * rigid skirt and read as detached limbs. Bakes plain rotate keys.
 */
export function skirtFollowsLegs(rig: RigDocument, clip: Clip, gain = 0.55, limit = 38): Clip {
  const hips = rig.roles.hips;
  const tL = rig.roles.thigh_L;
  const tR = rig.roles.thigh_R;
  if (!hips || !tL || !tR) return clip;
  const panels = rig.bones.filter((b) => b.parent === hips && SKIRT_BONE.test(b.name));
  if (!panels.length) return clip;
  const rest = evalPose(rig, null, 0, { noIk: true });
  const restRot = (n: string) => rest.byName.get(n)!.rotation;
  const delta: { fwd: number; back: number }[] = [];
  for (let f = 0; f <= clip.frames; f++) {
    const pose = evalPose(rig, clip, f);
    const a = angleDelta(restRot(tL), pose.byName.get(tL)!.rotation);
    const b = angleDelta(restRot(tR), pose.byName.get(tR)!.rotation);
    delta.push({ fwd: Math.max(a, b, 0), back: Math.min(a, b, 0) });
  }
  const smooth = (pick: (d: { fwd: number; back: number }) => number) =>
    delta.map((_, f) => {
      const n = [f - 1, f, f + 1].map((i) =>
        clip.loop ? ((i % clip.frames) + clip.frames) % clip.frames : Math.min(clip.frames, Math.max(0, i)),
      );
      return n.reduce((sum, i) => sum + pick(delta[i]!), 0) / n.length;
    });
  const fwd = smooth((d) => d.fwd);
  const back = smooth((d) => d.back);
  const bones = [...clip.bones];
  for (const panel of panels) {
    const isBack = /back/i.test(panel.name);
    const series = isBack ? back : fwd;
    const keys: Key<number>[] = series.map((v, f) => ({
      frame: f,
      value: Math.max(-limit, Math.min(limit, v * gain)),
    }));
    const existing = bones.findIndex((b) => b.bone === panel.name);
    const track = simplifyScalar(keys, 0.3);
    if (existing >= 0) bones[existing] = { ...bones[existing]!, rotate: track };
    else bones.push({ bone: panel.name, rotate: track });
  }
  return { ...clip, bones };
}

export interface KiemTuOptions {
  /**
   * Loaded atlas of the rig: when given, every clip is fitted so its silhouette stays whole (limb swings are limited to
   * what the rig's rigid mesh islands can carry); see `fitToSilhouette`.
   */
  readonly fitAtlas?: LoadedAtlas;
  /** Bake hair/sash secondary motion into the clips. Default true. */
  readonly secondary?: boolean;
  /** Restrict to some clips. Default: all of KIEMTU_CLIPS. */
  readonly only?: readonly KiemTuClip[];
}

/** Author the Kiếm tu set on `rig`. Throws if the rig lacks the roles the animations need. */
export function authorKiemTuSet(rig: RigDocument, opts: KiemTuOptions = {}): Clip[] {
  const makers: Record<KiemTuClip, (r: RigDocument) => Clip> = {
    idle: authorIdle,
    run: authorRun,
    attack: authorAttack1,
    attack_2: authorAttack2,
    attack_3: authorAttack3,
    cast: authorCast,
    hit: authorHit,
    die: authorDie,
    walk: authorWalk,
    dash: authorDash,
    meditate: authorMeditate,
    channel: authorChannel,
    sword_fly: authorSwordFly,
    tribulation: authorTribulation,
    emote: authorEmote,
  };
  const ids = opts.only ?? KIEMTU_CLIPS;
  return ids.map((id) => {
    const authored = armsFk(rig, makers[id](rig));
    const grounded = id === 'die' || id === 'meditate' ? liftToGround(rig, authored) : alignFeet(rig, authored);
    const base = skirtFollowsLegs(rig, grounded);
    const bake = (c: Clip) => (opts.secondary === false ? c : bakeSecondaryMotion(rig, c));
    if (opts.fitAtlas) return fitToSilhouette(rig, base, opts.fitAtlas, { finalize: bake }).clip;
    return bake(base);
  });
}

/** Roles the Kiếm tu set drives (use with `validateRig({ requireRoles })`). */
export const KIEMTU_REQUIRED_ROLES = [
  'root',
  'hips',
  'spine_mid',
  'spine_upper',
  'head',
  'upper_arm_L',
  'lower_arm_L',
  'hand_L',
  'upper_arm_R',
  'lower_arm_R',
  'hand_R',
  'thigh_L',
  'shin_L',
  'foot_L',
  'thigh_R',
  'shin_R',
  'foot_R',
  'ik_foot_L',
  'ik_foot_R',
] as const;
