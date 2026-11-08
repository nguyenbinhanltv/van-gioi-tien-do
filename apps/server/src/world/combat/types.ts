/**
 * Server-authoritative combat core (P3, D75): public types.
 *
 * Division of labour:
 *  - `@vgtd/sim` `step()` decides whether a cast is ACCEPTED (cooldown, GCD, MP, control, range, LOS) and emits `cast_ok` with a
 *    deterministic `roll` drawn from the world's `combat` PRNG stream (docs/08 §6).
 *  - This module decides what an accepted cast DOES: skill ownership, cast time, target selection by shape, damage (Ngũ hành,
 *    crit, pen, suppress via `@vgtd/shared`), heal / shield, HP, death and respawn, mob kills and drops.
 */
import type { AnyElement, DropRoll, DropSource, PathId, SkillDefinitions, Stats } from '@vgtd/shared';
import type { SimWorld } from '@vgtd/sim';

/** `SkillHit.flags` bits on the wire (`skill_result.hits[]`): bit0 crit (protocol v1), bit1 the hit killed its target. Defined in `@vgtd/shared`. */
export { HIT_FLAG_CRIT, HIT_FLAG_KILL } from '@vgtd/shared';

/** What the combat step needs to know about a mob entity (it is an ordinary sim entity, ids >= MOB_ID_BASE). */
export interface MobCombatStats {
  /** DEF of the mob (docs/07 §1 curve x tier multiplier). */
  defense: number;
  /** Realm r >= 1 (suppress + stone quantity). */
  realm: number;
  /** Main element, or null when it has none. */
  element: AnyElement | null;
  /** Drop table row: normal -> 'field', elite -> 'elite', boss -> 'boss'. */
  dropSource: DropSource;
  /** Max HP (the sim entity only holds the current HP). */
  hpMax: number;
}

/**
 * The seam to worker 39's `MobManager` (#204). Mobs are sim entities; the combat step damages `entity.hp` itself and calls
 * `kill()` when it reaches 0. Adapter once #204 lands: `combatStats(id)` from `manager.info(id)` + `mobStats`, `kill` = `manager.kill`.
 */
export interface MobPort {
  /** Combat stats of a LIVING mob, or undefined when `id` is not a mob. */
  combatStats(id: number): MobCombatStats | undefined;
  /** The mob died: despawn it and schedule its respawn. Returns the new world (like `MobManager.kill`). */
  kill(world: SimWorld, id: number): SimWorld;
}

/** One kill's loot, resolved with `resolveDrops` from `@vgtd/shared` (no inventory exists yet: the sink decides what to do). */
export interface DropEvent {
  killerId: number;
  mobId: number;
  rolls: readonly DropRoll[];
}

/** Derived combat attributes of a player (realm stats + class + passives). */
export interface CombatProfile {
  path: PathId;
  realm: number;
  substage: number;
  /** Class main element (`root_main` skills use it). */
  element: AnyElement;
  stats: Stats;
  /** Base 5% + passive `crit_chance`, capped at `COMBAT_RULES.CRIT_CHANCE_CAP`. */
  critChance: number;
  /** Passive armour penetration, added to a skill's own `pen`. */
  pen: number;
}

/** A skill result for one caster, ready to be turned into a `skill_result` packet. */
export interface CombatResult {
  entityId: number;
  seq: number;
  /** wire skill id */
  skillId: number;
  /** `CastReason` (0 = ok) */
  reason: number;
  readyAtMs: number;
  hits: CombatHit[];
}

export interface CombatHit {
  targetId: number;
  damage: number;
  flags: number;
}

/** Everything that happened to entities during one `CombatSystem.postStep`, for logs / metrics / tests. */
export type CombatEvent =
  | { type: 'damage'; sourceId: number; targetId: number; amount: number; crit: boolean; killed: boolean }
  | { type: 'heal'; targetId: number; amount: number }
  | { type: 'shield'; targetId: number; amount: number }
  | { type: 'death'; id: number; killerId: number }
  | { type: 'respawn'; id: number }
  | { type: 'drops'; killerId: number; mobId: number; rolls: readonly DropRoll[] }
  | { type: 'cast_cancelled'; entityId: number; seq: number }
  | { type: 'unsupported_effect'; skillKey: string; effect: string };

export interface CombatOptions {
  /** Seed of the `drop` stream (the cast rolls come from the sim world's `combat` stream). */
  seed?: number;
  mobs?: MobPort;
  onDrops?: (e: DropEvent) => void;
  defs?: SkillDefinitions;
  /** Where a dead player respawns (docs/01 §12.2: nearest spawn point). Default: where they died. */
  respawnPoint?: (id: number) => { i: number; j: number };
  /** Respawn delay override in ms (default `COMBAT_RULES.RESPAWN_PVE_MS`). */
  respawnDelayMs?: number;
}
