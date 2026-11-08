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

export interface MotionState {
  t: number;
  phase: number;
  lastHp: number | null;
  lastScreenX: number | null;
  flash: number;
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
}

export const newMotion = (id: number): MotionState => ({
  t: 0,
  phase: (id * 0.7) % (Math.PI * 2),
  lastHp: null,
  lastScreenX: null,
  flash: 0,
  deadFor: -1,
  flipX: 1,
});

/** One frame: `pos` in tiles, `hp` absolute (a drop = a hit), `alive`. Mutates `s`. */
export function stepMotion(
  s: MotionState,
  dt: number,
  e: { pos: { i: number; j: number }; hp: number; alive: boolean },
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
    };
  }
  if (s.deadFor >= 0) {
    // respawned: the same entity is back
    s.deadFor = -1;
    s.lastHp = null;
  }
  // the art faces left; moving right on screen (screen x = (i - j) * 32) mirrors it
  const sx = e.pos.i - e.pos.j;
  if (s.lastScreenX !== null && Math.abs(sx - s.lastScreenX) > 0.004) s.flipX = sx > s.lastScreenX ? -1 : 1;
  s.lastScreenX = sx;
  if (s.lastHp !== null && e.hp < s.lastHp) s.flash = HIT_FLASH_S;
  s.lastHp = e.hp;
  s.flash = Math.max(0, s.flash - dt);
  return {
    scaleX: s.flipX,
    bobY: Math.sin(s.t * BOB_RATE + s.phase) * BOB_PX,
    flashing: s.flash > 0,
    alpha: 255,
    visible: true,
  };
}
