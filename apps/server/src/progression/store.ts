/**
 * Persistence ports of the progression module (docs/23 §4.2, §4.7). The in-memory implementations are the MVP;
 * a PostgreSQL implementation maps `ProgressRecord` onto `characters` + `character_state` and `RollLogEntry` onto `roll_log`.
 * Both ports are async so a database can back them; the service never blocks the 20 Hz tick on them.
 */
import type { ProgressRecord } from './state.js';

export interface ProgressionStore {
  load(characterId: string): Promise<ProgressRecord | undefined>;
  /**
   * Insert or update with optimistic concurrency: succeeds only when the stored version equals `expectedVersion`
   * (0 for a record that does not exist yet). Returns false on a version conflict.
   */
  save(record: ProgressRecord, expectedVersion: number): Promise<boolean>;
}

/** docs/23 `roll_log`: every economy-relevant roll, so operators can audit a complaint. */
export interface RollLogEntry {
  readonly stream: 'breakthrough';
  /** world tick at the time of the roll */
  readonly tick: number;
  readonly characterId: string;
  readonly kind: 'minor' | 'major';
  readonly fromStage: number;
  readonly chance: number;
  /** the uniform [0,1) draw; success iff draw < chance */
  readonly draw: number;
  readonly success: boolean;
  readonly nFailBefore: number;
}
export interface RollLog {
  append(entry: RollLogEntry): void;
}

export class InMemoryProgressionStore implements ProgressionStore {
  private readonly rows = new Map<string, ProgressRecord>();
  /** test hook: number of successful writes */
  writes = 0;
  async load(characterId: string): Promise<ProgressRecord | undefined> {
    const r = this.rows.get(characterId);
    return r ? structuredClone(r) : undefined;
  }
  async save(record: ProgressRecord, expectedVersion: number): Promise<boolean> {
    const current = this.rows.get(record.characterId);
    if ((current?.version ?? 0) !== expectedVersion) return false;
    this.rows.set(record.characterId, structuredClone(record));
    this.writes++;
    return true;
  }
  /** test hook */
  peek(characterId: string): ProgressRecord | undefined {
    return this.rows.get(characterId);
  }
}

export class InMemoryRollLog implements RollLog {
  readonly entries: RollLogEntry[] = [];
  append(entry: RollLogEntry): void {
    this.entries.push(entry);
  }
}
