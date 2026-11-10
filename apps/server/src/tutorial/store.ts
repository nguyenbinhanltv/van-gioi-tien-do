/**
 * Where tutorial progress lives (D105). One small record per account, behind a seam like the other stores so the file store (D92) and a
 * database adapter plug in the same way. Synchronous on purpose: a record is a few bytes and is only touched at join, on a step change
 * and at leave.
 */
export interface TutorialRecord {
  accountId: string;
  /** bitmask of finished steps (bit k = `TUTORIAL_STEPS[k]`) */
  done: number;
  /** kills counted toward the `kills` step, capped at the target */
  kills: number;
  skipped: boolean;
  complete: boolean;
  /** how many sessions this account has started (local counter, never leaves the box) */
  sessions: number;
}

export interface TutorialStore {
  load(accountId: string): TutorialRecord | undefined;
  save(record: TutorialRecord): void;
  /** every record (the local funnel report) */
  all(): TutorialRecord[];
}

export class InMemoryTutorialStore implements TutorialStore {
  private readonly rows = new Map<string, TutorialRecord>();
  load(accountId: string): TutorialRecord | undefined {
    const r = this.rows.get(accountId);
    return r ? { ...r } : undefined;
  }
  save(record: TutorialRecord): void {
    this.rows.set(record.accountId, { ...record });
  }
  all(): TutorialRecord[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}
