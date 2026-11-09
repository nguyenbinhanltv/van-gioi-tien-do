/**
 * Engine-free behaviour of the INTERIM mob standees (see MobArt.ts): facing, idle bob, hit flash, death fade. Pure state machine so
 * it is unit-tested; MobStandee only copies the result onto nodes.
 */

/** Server mobs reach the combat backend as `Mob <wire id>` (OnlineSession); anything else keeps the placeholder sprite. */
export function mobDefIdOfName(name: string): number | null {
  const m = /^Mob (\d+)$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** Seconds of red flash after taking damage. */
export const HIT_FLASH_S = 0.14;
/** Seconds a dead mob takes to fade out. */
export const DEATH_FADE_S = 0.6;
/** Idle bob amplitude (design px) and angular speed (rad/s). */
export const BOB_PX = 1.6;
export const BOB_RATE = 2.4;
/** Death sink (design px). */
export const DEATH_SINK_PX = 6;
/** A mob that has not moved for this long turns to face the player. */
export const IDLE_FACE_AFTER_S = 0.25;
/** Dead zone (tiles of screen x, i - j) before an idle mob flips towards the player: no flicker when level with it. */
export const FACE_DEADZONE = 0.2;
/** Boss phase change: the skin swaps this far into the transform window (the window length comes from the server: MOB_TRANSFORM_MS). */
export const TRANSFORM_SWAP_AT = 0.5;
/** Pulses per second of the white / red flash during a transform. */
export const TRANSFORM_PULSE_HZ = 8;

export interface MotionState {
  t: number;
  phase: number;
  lastHp: number | null;
  lastScreenX: number | null;
  /** seconds since the last movement */
  idleFor: number;
  flash: number;
  /** a boss phase change in progress (seconds elapsed / window length in seconds / skin already swapped) */
  transform: { t: number; secs: number; swapped: boolean } | null;
  deadFor: number;
  /** -1 = art as drawn (faces LEFT), +1 = mirrored (faces right) */
  flipX: 1 | -1;
}

export interface MotionOut {
  /** body x scale: 1 = faces left, -1 = faces right */
  scaleX: 1 | -1;
  bobY: number;
  /** true = tint red */
  flashing: boolean;
  alpha: number;
  visible: boolean;
  /** true on the one frame the new skin must be applied (mid-transform) */
  swapNow: boolean;
  /** true on the frame a dead mob comes back: show the base skin again */
  respawned: boolean;
}

export const newMotion = (id: number): MotionState => ({
  t: 0,
  phase: (id * 0.7) % (Math.PI * 2),
  lastHp: null,
  lastScreenX: null,
  idleFor: 0,
  flash: 0,
  transform: null,
  deadFor: -1,
  flipX: 1,
});

/** Start a boss phase change lasting `ms` (server MOB_TRANSFORM_MS); `ms <= 0` swaps on the next frame without a pulse. */
export function beginTransform(s: MotionState, ms: number): void {
  s.transform = { t: 0, secs: Math.max(0, ms) / 1000, swapped: false };
}

/** One-shot flash (the hit flash mechanism) for `seconds`. */
export function flashMotion(s: MotionState, seconds: number): void {
  s.flash = Math.max(s.flash, seconds);
}

/**
 * One frame: `pos` in tiles, `hp` absolute (a drop = a hit), `alive`. `face` = the position to turn towards when idle (the player).
 * Moving mobs face their movement; idle mobs face `face` after IDLE_FACE_AFTER_S. Mutates `s`.
 */
export function stepMotion(
  s: MotionState,
  dt: number,
  e: { pos: { i: number; j: number }; hp: number; alive: boolean },
  face?: { i: number; j: number },
): MotionOut {
  s.t += dt;
  if (!e.alive) {
    if (s.deadFor < 0) s.deadFor = 0;
    s.deadFor += dt;
    const k = Math.min(1, s.deadFor / DEATH_FADE_S);
    s.lastHp = e.hp;
    return {
      scaleX: s.flipX,
      bobY: -DEATH_SINK_PX * k,
      flashing: false,
      alpha: Math.round(255 * (1 - k)),
      visible: k < 1,
      swapNow: false,
      respawned: false,
    };
  }
  let respawned = false;
  if (s.deadFor >= 0) {
    // respawned: the same entity is back (a boss goes back to its first phase)
    s.deadFor = -1;
    s.lastHp = null;
    s.transform = null;
    respawned = true;
  }
  // the art faces left; moving right on screen (screen x = (i - j) * 32) mirrors it
  const sx = e.pos.i - e.pos.j;
  if (s.lastScreenX !== null && Math.abs(sx - s.lastScreenX) > 0.004) {
    s.flipX = sx > s.lastScreenX ? -1 : 1;
    s.idleFor = 0;
  } else s.idleFor += dt;
  s.lastScreenX = sx;
  if (face && s.idleFor >= IDLE_FACE_AFTER_S) {
    const dx = face.i - face.j - sx; // > 0: the player is to the screen-right of the mob
    if (dx > FACE_DEADZONE) s.flipX = -1;
    else if (dx < -FACE_DEADZONE) s.flipX = 1;
  }
  if (s.lastHp !== null && e.hp < s.lastHp) s.flash = HIT_FLASH_S;
  s.lastHp = e.hp;
  s.flash = Math.max(0, s.flash - dt);
  let swapNow = false;
  let pulsing = false;
  const tr = s.transform;
  if (tr) {
    tr.t += dt;
    pulsing = tr.secs > 0 && Math.floor(tr.t * TRANSFORM_PULSE_HZ) % 2 === 0;
    if (!tr.swapped && tr.t >= tr.secs * TRANSFORM_SWAP_AT) {
      tr.swapped = true;
      swapNow = true;
    }
    if (tr.t >= tr.secs) s.transform = null;
  }
  return {
    scaleX: s.flipX,
    bobY: Math.sin(s.t * BOB_RATE + s.phase) * BOB_PX,
    flashing: s.flash > 0 || pulsing,
    alpha: 255,
    visible: true,
    swapNow,
    respawned,
  };
}
