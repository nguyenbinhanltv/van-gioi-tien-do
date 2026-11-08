/**
 * Persistence seam for inventories (D77, docs/23 §4.3). The World Node never talks to a database: it loads a snapshot when
 * a player joins and saves it when the last connection of the account leaves. `InMemoryInventoryStore` keeps JSON text, so
 * what it holds is exactly what a PostgreSQL / file implementation would persist (and a test proves the round trip).
 * The ledger is its own persistent store (docs/23 §4.4) and is NOT part of this snapshot.
 */
import type { BagSnapshot } from './bag.js';

export interface PendingLoot {
  defId: number;
  quality: number;
  qty: number;
}

export interface InventorySnapshot {
  /** bump on any layout change */
  v: 1;
  bag: BagSnapshot;
  /** loot that did not fit in the bag, oldest first */
  pending: PendingLoot[];
  /** next per-owner instance sequence number */
  nextSeq: number;
}

export interface InventoryStore {
  load(owner: string): InventorySnapshot | undefined;
  save(owner: string, snap: InventorySnapshot): void;
}

export class InMemoryInventoryStore implements InventoryStore {
  private readonly rows = new Map<string, string>();
  load(owner: string): InventorySnapshot | undefined {
    const s = this.rows.get(owner);
    return s === undefined ? undefined : (JSON.parse(s) as InventorySnapshot);
  }
  save(owner: string, snap: InventorySnapshot): void {
    this.rows.set(owner, JSON.stringify(snap));
  }
  has(owner: string): boolean {
    return this.rows.has(owner);
  }
}
