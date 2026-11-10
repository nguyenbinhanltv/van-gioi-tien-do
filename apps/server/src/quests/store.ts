/**
 * Persistence seam of the quest module (D107). One record per ACCOUNT (the same owner id the bag uses): the quests that are not in the
 * default state, as `{ s: status, p: progress per objective, e: reset epoch }`. `e` is the daily / weekly cycle number a repeatable quest
 * was accepted / completed in (0 for one-off quests): an entry from an older cycle is dropped when the account is loaded or a reset passes.
 * Synchronous like `InventoryStore`; `commit()` makes the last `save` durable NOW and says whether it worked (the file store flushes its
 * document, a database adapter would commit a transaction). A reward is only paid after its claim was committed (see `QuestService`).
 */
export interface QuestEntrySnapshot {
  s: number;
  p: number[];
  e: number;
}
export interface QuestSnapshot {
  v: 1;
  quests: Record<string, QuestEntrySnapshot>;
}

export interface QuestStore {
  load(owner: string): QuestSnapshot | undefined;
  save(owner: string, snap: QuestSnapshot): void;
  /** make everything saved so far durable now; false when that failed (the caller then does not pay) */
  commit?(): boolean;
}

/** Keeps JSON text per owner, so what it holds is exactly what a file / database implementation would persist. */
export class InMemoryQuestStore implements QuestStore {
  private readonly rows = new Map<string, string>();
  /** test hook: number of saves / commits, and a switch that makes `commit` fail */
  saves = 0;
  commits = 0;
  failCommit = false;
  load(owner: string): QuestSnapshot | undefined {
    const t = this.rows.get(owner);
    return t === undefined ? undefined : (JSON.parse(t) as QuestSnapshot);
  }
  save(owner: string, snap: QuestSnapshot): void {
    this.rows.set(owner, JSON.stringify(snap));
    this.saves++;
  }
  commit(): boolean {
    this.commits++;
    return !this.failCommit;
  }
}
