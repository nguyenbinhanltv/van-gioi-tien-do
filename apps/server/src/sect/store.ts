/**
 * Persistence seam of the sect module (D98). Membership and unlocked manuals are facts about ACCOUNTS (their ids, never display names).
 * The Cống hiến balance is NOT here: it lives in the ledger (docs/26), which has its own store (`ledger.json`, D92). Two lists:
 *   members  account ids that belong to Sơn Môn Đại Phái
 *   manuals  [account id, skill id] pairs the account bought in the library (kept when it leaves the sect)
 * Loaded once at construction, saved whole after every change; `FileSectStore` (persistence/) debounces the disk write. Synchronous
 * like `InventoryStore` / `FriendStore`.
 */
export interface SectSnapshot {
  members: string[];
  manuals: [string, string][];
}

export interface SectStore {
  load(): SectSnapshot | undefined;
  save(s: SectSnapshot): void;
}

/** Keeps JSON text, so what it holds is exactly what a file / database implementation would persist. */
export class InMemorySectStore implements SectStore {
  private text: string | undefined;
  /** test hook: number of saves */
  saves = 0;
  load(): SectSnapshot | undefined {
    return this.text === undefined ? undefined : (JSON.parse(this.text) as SectSnapshot);
  }
  save(s: SectSnapshot): void {
    this.text = JSON.stringify(s);
    this.saves++;
  }
}
