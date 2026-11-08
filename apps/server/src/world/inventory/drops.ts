/**
 * The adapter between the combat core and the inventory (D77 follow-up): combat resolves a kill's drops and calls
 * `onDrops({ killerId, mobId, rolls })`; `DropSink` turns that into `InventoryService.grantDrops`.
 *
 *  - `killerId` is a sim entity id: it is mapped to the owner (account id) of the connected player;
 *  - the kill key is `mobId@tick` (`dropKillKey`): a mob dies at most once per respawn, so it is stable and unique, and a
 *    repeated event for the same kill is a replay that grants nothing twice;
 *  - the drop source (field / elite / boss, which picks the faucet account) comes from the mob's combat stats. Combat calls
 *    `onDrops` BEFORE `MobPort.kill`, so the mob is still alive and readable here; a mob that cannot be read falls back to
 *    `field` (and is counted).
 *
 * Engine-free and deterministic (the tick comes from the world, never from a clock).
 */
import type { DropEvent, MobPort } from '../combat/types.js';
import type { GrantResult, InventoryService } from './service.js';

export interface DropSinkDeps {
  inventory: InventoryService;
  /** account id of the connected player with this entity id (undefined when that player is gone) */
  ownerOf(entityId: number): string | undefined;
  /** world tick of the kill: `onDrops` runs inside the tick that resolved it */
  tick(): number;
  /** reads the dropped mob's source while it is still alive; optional (everything is then `field`) */
  mobs?: Pick<MobPort, 'combatStats'>;
}

export interface DropSinkStats {
  grants: number;
  replays: number;
  /** the killer was not connected any more: nothing was granted */
  noOwner: number;
  /** the mob's source could not be read: `field` was used */
  sourceFallbacks: number;
}

/** `mobId@tick`: identifies one kill for idempotent granting. */
export const dropKillKey = (mobId: number, tick: number): string => `${mobId}@${tick}`;

export class DropSink {
  readonly stats: DropSinkStats = { grants: 0, replays: 0, noOwner: 0, sourceFallbacks: 0 };
  /** called after every applied (non-replayed) grant, for logging / metrics */
  onGranted: ((owner: string, e: DropEvent, result: GrantResult) => void) | null = null;

  constructor(private readonly deps: DropSinkDeps) {}

  /** The `CombatOptions.onDrops` callback. Returns the grant result, or undefined when nobody could receive it. */
  readonly handle = (e: DropEvent): GrantResult | undefined => {
    const owner = this.deps.ownerOf(e.killerId);
    if (owner === undefined) {
      this.stats.noOwner++;
      return undefined;
    }
    let source = this.deps.mobs?.combatStats(e.mobId)?.dropSource;
    if (source === undefined) {
      this.stats.sourceFallbacks++;
      source = 'field';
    }
    const result = this.deps.inventory.grantDrops(owner, e.rolls, source, dropKillKey(e.mobId, this.deps.tick()));
    if (result.replayed) this.stats.replays++;
    else {
      this.stats.grants++;
      this.onGranted?.(owner, e, result);
    }
    return result;
  };
}
