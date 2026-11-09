/**
 * One JSON document on disk, written back lazily: `markDirty()` schedules a write at most once per `flushMs` (default 250 ms), so a
 * burst of changes (a login storm, a drop) is ONE write, `flush()` writes now (shutdown, tests). The document is serialised when the
 * write happens, from live state, so a write always contains every change made before it.
 *
 * The write itself is synchronous (`writeFileAtomic`) and the documents are small (play-test scale); a database adapter replaces
 * this with real transactions (docs/08, D92). A failed write is counted and reported through `onError`, and retried by the next
 * `markDirty()`; it never throws into the game loop.
 */
import { writeFileAtomic } from './atomic.js';

export interface DocFileOptions {
  flushMs?: number;
  onError?: (e: unknown) => void;
}

export class DocFile {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
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
      this.flush();
    }, this.flushMs);
    this.timer.unref?.();
  }

  /** Write now if anything changed since the last write. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
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
