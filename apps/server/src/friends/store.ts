/**
 * Persistence seam of the friends module (D96). Friendship is a fact about two ACCOUNTS (their ids, never display names, which are the
 * unique usernames today but are not what a relation should hang on), so the document is two lists of id pairs:
 *   friends   [a, b] with a < b      (symmetric: one entry is a whole friendship)
 *   requests  [from, to]             (pending, oldest first within a sender)
 * The service loads it once at construction and saves the whole snapshot after every change; `FileFriendStore` (persistence/) debounces the
 * disk write, a database adapter would map the same two lists onto two tables. Synchronous like `InventoryStore`.
 */
export interface FriendSnapshot {
  friends: [string, string][];
  requests: [string, string][];
}

export interface FriendStore {
  load(): FriendSnapshot | undefined;
  save(s: FriendSnapshot): void;
}

/** Keeps JSON text, so what it holds is exactly what a file / database implementation would persist (and a test proves the round trip). */
export class InMemoryFriendStore implements FriendStore {
  private text: string | undefined;
  /** test hook: number of saves */
  saves = 0;
  load(): FriendSnapshot | undefined {
    return this.text === undefined ? undefined : (JSON.parse(this.text) as FriendSnapshot);
  }
  save(s: FriendSnapshot): void {
    this.text = JSON.stringify(s);
    this.saves++;
  }
}
