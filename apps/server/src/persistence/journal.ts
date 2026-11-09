/**
 * Write-ahead journal for COMMITS THAT SPAN SEVERAL DOCUMENTS (D102; reusable, e.g. a sect purchase = ledger + sect, an item use = bag + ledger).
 *
 * D92 makes each document's write atomic, but an operation that changes two documents (a trade: both bags live in `inventories.json`, the
 * stones in `ledger.json`) would be torn by a crash between the two writes: one side already paid, the other not = duplicated or lost value.
 * The journal closes that window with the classic recipe:
 *
 *   1. write ONE journal record, `journal.json`, with the full NEW text of every document the commit touches (write-temp + fsync + rename, so
 *      the record either exists complete or not at all);                                     <- the commit point
 *   2. write each document (each one atomic, as always);
 *   3. delete the journal.
 *
 * Recovery (`recoverJournal`, run by `openFileStores` BEFORE any document is loaded):
 *   - no journal            -> nothing to do (a crash before step 1 left every document at its old state: the commit never happened);
 *   - a stray `journal.json.tmp` (crash while writing step 1) -> deleted, the commit never happened;
 *   - a complete journal    -> ROLL FORWARD: write every document from it (idempotent: full contents, so a document that step 2 already
 *     wrote is just written again with the same bytes), then delete it. Either all of the commit is visible after a restart, or none of it;
 *   - an unreadable journal  -> refuse to start (media corruption: guessing could duplicate value).
 *
 * `commit` is synchronous, so no debounced write of the same documents can interleave with it and replace newer data with the journal's.
 * Journal contents are validated (known file names only, no paths, every text must be a JSON object with a version) before anything is applied.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writeFileAtomic } from './atomic.js';
import type { DocFile } from './doc-file.js';

export const JOURNAL_FILE = 'journal.json';

/** The stages `commit` reports to its optional crash hook (tests make the hook throw to simulate a kill at that exact point). */
export type JournalStage = 'before-journal' | 'journal-written' | `applied-${number}` | 'done';

export interface JournalOptions {
  /** called at every stage; throwing from it stops the commit right there, exactly like a process kill would (tests) */
  crash?: (stage: JournalStage) => void;
}

interface JournalRecord {
  v: 1;
  tx: string;
  docs: { file: string; data: string }[];
}

const SAFE_NAME = /^[a-z][a-z0-9_-]*\.json$/;

export class TxJournal {
  /** commits finished since start (test hook) */
  commits = 0;
  /** a commit whose journal is on disk but whose document writes / journal delete did not all finish (an error, not a crash) */
  private inFlight: { rec: JournalRecord; docs: readonly DocFile[] } | null = null;
  constructor(
    readonly dir: string,
    private readonly opts: JournalOptions = {},
  ) {}

  /**
   * Make the CURRENT state of `docs` durable as one unit. Call it right after the in-memory change. `label` is only for people reading
   * the journal after a crash. Throws on a disk error (the documents stay dirty and the normal debounced flush retries them).
   */
  commit(label: string, docs: readonly DocFile[]): void {
    this.settle(); // a previous commit that failed half way is finished first: journals never pile up or get applied out of order
    this.opts.crash?.('before-journal');
    const rec: JournalRecord = { v: 1, tx: label, docs: docs.map((d) => ({ file: basename(d.path), data: d.text() })) };
    for (const d of rec.docs) if (!SAFE_NAME.test(d.file)) throw new Error(`journal: unsafe document name "${d.file}"`);
    writeFileAtomic(join(this.dir, JOURNAL_FILE), JSON.stringify(rec));
    // from here the commit is decided. If anything below throws (a disk error) the journal STAYS on disk and `inFlight` remembers it:
    // `settle()` finishes it before any other write of these documents, so a stale journal can never be rolled forward over newer data.
    this.inFlight = { rec, docs };
    this.opts.crash?.('journal-written');
    this.apply();
    this.opts.crash?.('done');
  }

  /** Write every document of the in-flight commit, then delete its journal. Idempotent (full contents). */
  private apply(): void {
    const f = this.inFlight;
    if (!f) return;
    f.docs.forEach((d, i) => {
      writeFileAtomic(d.path, f.rec.docs[i]!.data);
      d.markWritten(f.rec.docs[i]!.data);
      this.opts.crash?.(`applied-${i + 1}`);
    });
    rmSync(join(this.dir, JOURNAL_FILE), { force: true });
    this.inFlight = null;
    this.commits++;
  }

  /**
   * Finish a commit whose journal is still pending after an error. Called before every commit and before every ordinary write of a document
   * (`DocFileOptions.beforeWrite`); throws when it cannot (the caller's write then does not happen and stays dirty).
   */
  settle(): void {
    if (this.inFlight) this.apply();
  }

  /** Is a commit's journal still waiting to be finished? (ops / tests) */
  get pending(): boolean {
    return this.inFlight !== null;
  }
}

/**
 * Finish (roll forward) a commit that a crash interrupted. Returns the label of the recovered commit, or null when there was nothing to do.
 * Throws when a journal exists but cannot be trusted.
 */
export function recoverJournal(dir: string): string | null {
  rmSync(join(dir, `${JOURNAL_FILE}.tmp`), { force: true }); // a crash while writing the journal: the commit never happened
  const path = join(dir, JOURNAL_FILE);
  if (!existsSync(path)) return null;
  let rec: JournalRecord;
  try {
    rec = JSON.parse(readFileSync(path, 'utf8')) as JournalRecord;
  } catch (e) {
    throw new Error(
      `${path} exists but cannot be parsed (${(e as Error).message}): refusing to start over player data`,
    );
  }
  if (rec?.v !== 1 || typeof rec.tx !== 'string' || !Array.isArray(rec.docs) || rec.docs.length === 0)
    throw new Error(`${path} is not a valid journal: refusing to start`);
  // validate EVERYTHING before applying anything
  for (const d of rec.docs) {
    if (typeof d?.file !== 'string' || !SAFE_NAME.test(d.file) || typeof d.data !== 'string')
      throw new Error(`${path} names a document that is not allowed: refusing to start`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(d.data);
    } catch {
      throw new Error(`${path}: the text of ${d.file} is not valid JSON: refusing to start`);
    }
    if (typeof parsed !== 'object' || parsed === null || (parsed as { v?: unknown }).v === undefined)
      throw new Error(`${path}: ${d.file} is not a versioned document: refusing to start`);
  }
  for (const d of rec.docs) writeFileAtomic(join(dir, d.file), d.data);
  rmSync(path, { force: true });
  return rec.tx;
}
