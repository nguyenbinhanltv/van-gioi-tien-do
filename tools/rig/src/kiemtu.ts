/**
 * Kiếm tu (sword cultivator) animation set, authored against bone **roles** so it drives any humanoid rig that
 * provides them (the reference rig today, the concept-A rig from `tools/rig/kiem-tu.rig.json` when it lands).
 * Authored in profile terms (character faces +x, arms hang down at rest); amplitudes are scaled by the view for the
 * foreshortened directions. Angles are deltas from the rest pose, degrees CCW (positive = arm swings forward/up,
 * spine leans back). This is a first AI pass: the owner reviews it in the viewer (D36) and asks for changes.
 */
import type { Direction } from '@vgtd/shared';
import { clipSpec } from './animset.js';
import { type Clip, type Key } from './clip.js';
import { ClipBuilder, EASE } from './dsl.js';
import { closeLoop } from './loop.js';
import { planFeet, screenAxis } from './locomotion.js';
import { bakeSecondaryMotion } from './secondary.js';
import type { RigDocument } from './schema.js';

export const KIEMTU_CLIPS = ['idle', 'run', 'attack', 'attack_2', 'attack_3', 'cast', 'hit', 'die'] as const;
export type KiemTuClip = (typeof KIEMTU_CLIPS)[number];

/** Authored run speed (px/s along the facing). The runtime sets timeScale = actual / authored to avoid sliding. */
export const RUN_SPEED_PX_S = 150;
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

export function authorDie(rig: RigDocument): Clip {
  const g = viewGain(rig.direction);
  const N = clipSpec('die').frames; // 24
  const c = new ClipBuilder(rig, { name: 'die', frames: N, loop: false });
  const legsIk = (rig.ik ?? []).filter((k) => k.name.startsWith('ik_leg')).map((k) => k.name);
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
    [10, -8 * g, -17, EASE.fall],
    [16, -21 * g, -28, EASE.out],
    [N, -22 * g, -28],
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
      [16, side === 'L' ? 28 : 18, EASE.out],
      [N, side === 'L' ? 28 : 18],
    ]);
    c.rotate(`shin_${side}`, [
      [0, 0],
      [3, 0, EASE.fall],
      [16, side === 'L' ? -34 : -26, EASE.out],
      [N, side === 'L' ? -34 : -26],
    ]);
  }
  c.rotate('upper_arm_R', [
    [0, 0],
    [3, -28 * g, EASE.inOut],
    [16, -64, EASE.out],
    [N, -66],
  ]);
  c.rotate('upper_arm_L', [
    [0, 0],
    [3, -22 * g, EASE.inOut],
    [16, -48, EASE.out],
    [N, -50],
  ]);
  return c.build();
}

export interface KiemTuOptions {
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
  };
  const ids = opts.only ?? KIEMTU_CLIPS;
  return ids.map((id) => {
    const clip = makers[id](rig);
    return opts.secondary === false ? clip : bakeSecondaryMotion(rig, clip);
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
