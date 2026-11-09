/**
 * Tâm Ma shadows as combat targets (D97). A shadow is an ordinary sim entity (id >= `SHADOW_ID_BASE`, so every "is this a mob" check
 * treats it as one) whose combat stats come from here instead of the `MobManager`. `ShadowRegistry` is the `MobPort` the `CombatSystem`
 * gets: it answers for shadows and forwards everything else to the real port, so player skills, damage and kills work on the shadow with
 * no change to the combat core.
 *
 * A shadow is never in the mob manager's slot table: it does not wander, aggro or respawn, and killing it removes the entity and marks it
 * defeated (`MajorBreakthroughs` reads that). Its kills drop nothing (the node filters `onDrops` through `owns`).
 */
import { MOB_ID_BASE } from '@vgtd/shared';
import type { SimWorld } from '@vgtd/sim';
import type { MobCombatStats, MobPort } from '../combat/types.js';

/** Shadow entity ids start here: above every `MobManager` slot (`MOB_ID_BASE + slot`), below nothing else in use. */
export const SHADOW_ID_BASE = MOB_ID_BASE + 1_000_000;
/** Wire `EnterEntity.defId` of a Tâm Ma shadow (above every `MOB_DEFS` id): the client draws a dark placeholder. */
export const SHADOW_DEF_ID = 200;

export interface Shadow {
  id: number;
  /** the player whose Tâm Ma this is */
  ownerId: number;
  stats: MobCombatStats;
  /** the shadow was killed (by the owner's skills) */
  defeated: boolean;
}

export class ShadowRegistry implements MobPort {
  private readonly shadows = new Map<number, Shadow>();
  constructor(private readonly base?: MobPort) {}

  add(s: Shadow): void {
    this.shadows.set(s.id, s);
  }
  get(id: number): Shadow | undefined {
    return this.shadows.get(id);
  }
  owns(id: number): boolean {
    return this.shadows.has(id);
  }
  /** May `casterId` hit / target this mob? Everything but a shadow: yes; a shadow: only its owner. */
  canTarget(casterId: number, id: number): boolean {
    const s = this.shadows.get(id);
    return !s || s.ownerId === casterId;
  }
  /** Is this entity invisible to `viewerId`? A shadow is seen by its owner only. */
  hiddenFor(id: number, viewerId: number): boolean {
    const s = this.shadows.get(id);
    return !!s && s.ownerId !== viewerId;
  }
  /** forget a shadow (the event ended) */
  drop(id: number): void {
    this.shadows.delete(id);
  }
  get size(): number {
    return this.shadows.size;
  }

  // ------------------------------------------------------------------ MobPort
  combatStats(id: number): MobCombatStats | undefined {
    const s = this.shadows.get(id);
    if (s) return s.defeated ? undefined : s.stats;
    return this.base?.combatStats(id);
  }

  kill(world: SimWorld, id: number): SimWorld {
    const s = this.shadows.get(id);
    if (!s) return this.base ? this.base.kill(world, id) : world;
    s.defeated = true;
    return { ...world, entities: world.entities.filter((e) => e.id !== id) };
  }

  onDamage(id: number, attackerId: number, amount: number): void {
    if (this.shadows.has(id)) return; // a shadow has no threat table
    this.base?.onDamage?.(id, attackerId, amount);
  }
}
