/**
 * Server-authoritative combat core (P3, D75): public types.
 *
 * Division of labour:
 *  - `@vgtd/sim` `step()` decides whether a cast is ACCEPTED (cooldown, GCD, MP, control, range, LOS) and emits `cast_ok` with a
 *    deterministic `roll` drawn from the world's `combat` PRNG stream (docs/08 §6).
 *  - This module decides what an accepted cast DOES: skill ownership, cast time, target selection by shape, damage (Ngũ hành,
 *    crit, pen, suppress via `@vgtd/shared`), heal / shield, HP, death and respawn, mob kills and drops.
 */
import type { AnyElement, DropRoll, PathId, SkillDefinitions, Stats } from '@vgtd/shared';
import type { SimInput, SimWorld } from '@vgtd/sim';

/** `SkillHit.flags` bits on the wire (`skill_result.hits[]`): bit0 crit (protocol v1), bit1 the hit killed its target. Defined in `@vgtd/shared`. */
export { HIT_FLAG_CRIT, HIT_FLAG_KILL } from '@vgtd/shared';

/** A cast the node hands to `CombatSystem.preStep`: the sim's `CastInput` plus the aim point of the wire message (tile coordinates). */
export type AimedInput = SimInput & { aim?: { i: number; j: number } | null };

/** What the combat step needs to know about a living mob: defined by the mob module (`MobManager.combatStats`), re-exported here. */
export type { MobCombatStats } from '../mobs/index.js';
import type { MobCombatStats } from '../mobs/index.js';

/**
 * The seam to the mob module: `MobManager` (#204) satisfies it as is (`combatStats(id)`, `kill(world, id)`). Mobs are sim entities;
 * the combat step damages `entity.hp` itself and calls `kill()` when it reaches 0.
 */
export interface MobPort {
  /** Combat stats of a LIVING mob, or undefined when `id` is not a mob. */
  combatStats(id: number): MobCombatStats | undefined;
  /** The mob died: despawn it and schedule its respawn. Returns the new world (like `MobManager.kill`). */
  kill(world: SimWorld, id: number): SimWorld;
  /** Optional: `attackerId` damaged the living mob `id` for `amount` (threat / aggro, D83). Called once per hit. */
  onDamage?(id: number, attackerId: number, amount: number): void;
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
  /** Mobs in `chase` attack their target (D86, default on when the node has mobs). Set false for a node whose mobs should only walk. */
  mobAttacks?: boolean;
  /** Is this player meditating (progression)? Meditation raises out-of-combat MP regeneration (D88). Default: never. */
  isMeditating?: (id: number) => boolean;
  /**
   * The players who share the credit of a kill by `killerId` (D92): the killer's party members that are close enough, the killer included,
   * ascending. Each one gets a separate drop roll with `partySize` = the group size (docs/07 §6, personal loot x 1/sqrt(n)). Default: just the killer.
   */
  partyOf?: (killerId: number) => readonly number[];
}
