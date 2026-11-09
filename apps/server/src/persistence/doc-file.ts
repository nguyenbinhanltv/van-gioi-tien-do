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
  /**
   * Runs before every write of this document; if it throws the write does not happen and the document stays dirty. The file store uses it to
   * finish a pending multi-document journal FIRST, so a newer version of a document can never be written while an older journal that covers
   * it is still waiting to be rolled forward (a later restart would otherwise re-apply the stale journal over the newer data).
   */
  beforeWrite?: () => void;
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

  /** The document's current text (what a write would put on disk): the journal records it before it applies a multi-document commit. */
  text(): string {
    return this.serialize();
  }

  /**
   * The journal wrote `text` as this document's content. The document is clean only if that IS its current content: if it changed since
   * (a later write is waiting), it stays dirty so that write still happens.
   */
  markWritten(text: string): void {
    this.writes++;
    if (this.serialize() !== text) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = false;
  }

  /** The document as it would be written right now (backups serialise every store in ONE synchronous turn, D99). */
  serializeNow(): string {
    return this.serialize();
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
      this.opts.beforeWrite?.();
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
