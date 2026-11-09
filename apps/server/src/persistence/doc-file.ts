/**
 * One JSON document on disk, written back lazily: `markDirty()` schedules a write at most once per `flushMs` (default 250 ms), so a
 * burst of changes (a login storm, a drop) is ONE write, `flush()` writes now (shutdown, tests). The document is serialised when the
 * write happens, from live state, so a write always contains every change made before it.
 *
 * The scheduled write is ASYNCHRONOUS (D106): the document is serialised on the loop (a point-in-time copy), then the slow part (write +
 * fsync) runs on the thread pool and only the commit renames touch the loop. A synchronous fsync inside the tick loop stalled it for
 * 30-370 ms per write under 200 players. At most one write is in flight per file; changes made meanwhile are written right after.
 * `flush()` stays synchronous (shutdown, tests) and supersedes any write still in flight. The whole document is still rewritten each
 * time (play-test scale); a database adapter replaces this with real transactions (docs/08, D92). A failed write is counted and reported through `onError`, and retried by the next
 * `markDirty()`; it never throws into the game loop.
 */
import { fileWriteStats, writeFileAtomic, writeFileAtomicAsync } from './atomic.js';

export interface DocFileOptions {
  flushMs?: number;
  /** false = the old behaviour: the scheduled write is synchronous on the loop (only to compare, `soak --sync-writes`); default true */
  background?: boolean;
  onError?: (e: unknown) => void;
}

export class DocFile {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private inflight = false;
  /** bumped by every write start: an async write commits only while it is still the newest */
  private gen = 0;
  /** completed writes (test hook) */
  writes = 0;
  /** failed writes (test hook / ops) */
  errors = 0;
  private readonly flushMs: number;
  constructor(
    readonly path: string,
    private readonly serialize: () => string,
    private readonly opts: DocFileOptions = {},
  ) {
    this.flushMs = opts.flushMs ?? 250;
  }

  markDirty(): void {
    this.dirty = true;
    if (this.timer || this.flushMs < 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.opts.background === false) this.flush();
      else void this.flushAsync();
    }, this.flushMs);
    this.timer.unref?.();
  }

  /** Write in the background if anything changed (see the class comment); never blocks on the disk. Resolves when that write is done. */
  async flushAsync(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || this.inflight) return; // an in-flight write re-checks `dirty` when it ends
    this.inflight = true;
    const gen = ++this.gen;
    try {
      const t0 = performance.now();
      const data = this.serialize();
      const ser = performance.now() - t0;
      fileWriteStats.serializeMs += ser;
      if (ser > fileWriteStats.serializeMaxMs) fileWriteStats.serializeMaxMs = ser;
      this.dirty = false; // changes from here on are a new write
      if (await writeFileAtomicAsync(this.path, data, () => this.gen === gen)) this.writes++;
      // else: a synchronous flush() superseded this write (it wrote newer state, or will)
    } catch (e) {
      this.errors++;
      this.dirty = true; // the next change (or flush) tries again
      this.opts.onError?.(e);
    } finally {
      this.inflight = false;
    }
    if (this.dirty && !this.timer) this.markDirty(); // changes arrived while writing
  }

  /** Resolves when no write is in flight and nothing is dirty (tests, orderly shutdown before `flush()`). */
  async drain(): Promise<void> {
    for (let k = 0; k < 100 && (this.dirty || this.inflight); k++) {
      if (this.inflight) await new Promise((r) => setTimeout(r, 1));
      else await this.flushAsync();
    }
  }

  /** Write now (synchronously) if anything changed since the last write; supersedes a write in flight. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty && !this.inflight) return; // an in-flight write is not on disk yet: write the current state now
    this.gen++; // an async write still in flight must not commit over this newer one
    try {
      writeFileAtomic(this.path, this.serialize());
      this.dirty = false;
      this.writes++;
    } catch (e) {
      this.errors++;
      this.opts.onError?.(e);
      // stays dirty: the next change (or flush) tries again
    }
  }
}
