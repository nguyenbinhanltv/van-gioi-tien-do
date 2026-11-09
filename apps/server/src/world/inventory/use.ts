/**
 * Item effects of `inv_cmd` op Use (D90): what drinking a pill does for the player who sent the command.
 *
 *  - `heal_pill`: heals through the combat core (`CombatSystem.usePill`: 18 % max HP, shared 8 s cooldown, refused when dead or at full
 *    HP). The result world replaces the node's world.
 *  - `breakthrough_pill`: a bonus for the NEXT breakthrough roll of this character (`ProgressionService.addBreakthroughPill`).
 *
 * `InventorySync` calls the returned function BEFORE it consumes the item and consumes only on `Ok`, so every refusal here leaves the bag
 * untouched. Pure plumbing: no clocks (the world's sim time is used), no randomness.
 */
import { InvReason } from '@vgtd/protocol';
import type { SimWorld } from '@vgtd/sim';
import type { CombatSystem } from '../combat/index.js';
import type { ProgressionService } from '../../progression/service.js';
import type { UseItemFn } from './sync.js';

export interface ItemUseDeps {
  combat: CombatSystem | null;
  progression: ProgressionService | undefined;
  /** the node's current world and a setter for the world a pill produced */
  getWorld(): SimWorld;
  setWorld(w: SimWorld): void;
}

/** The effect function for player entity `entityId` (the connection that sent the command). */
export function itemUseFor(deps: ItemUseDeps, entityId: number): UseItemFn {
  return (item) => {
    switch (item.key) {
      case 'heal_pill': {
        if (!deps.combat) return InvReason.NotUsable;
        const r = deps.combat.usePill(deps.getWorld(), entityId);
        if (r.result === 'unknown') return InvReason.NotReady;
        if (r.result === 'dead') return InvReason.Dead;
        if (r.result === 'cooldown') return InvReason.OnCooldown;
        if (r.result === 'full') return InvReason.NothingToHeal;
        deps.setWorld(r.world);
        return InvReason.Ok;
      }
      case 'breakthrough_pill': {
        if (!deps.progression) return InvReason.NotUsable;
        const r = deps.progression.addBreakthroughPill(entityId, item.quality);
        return r === 'ok' ? InvReason.Ok : r === 'active' ? InvReason.PillActive : InvReason.NotReady;
      }
      default:
        return InvReason.NotUsable;
    }
  };
}
