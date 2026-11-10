/**
 * Where raw telemetry events are kept (D109, docs/17 §2 "Lưu trữ MVP"): an append-only JSON-lines log, one file per UTC day, raw files
 * older than `retentionDays` (90, docs/17 §7) deleted. Local only: nothing here talks to the network. A database adapter (PostgreSQL
 * `telemetry_events`, docs/17 §2) replaces this behind the same `EventLog` seam.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface EventLog {
  /** one serialised event (JSON, no newline) at server time `ms` */
  append(line: string, ms: number): void;
  /** write everything buffered now */
  flush(): void;
}

/** The last `max` events in memory (tests, STORE=memory). */
export class MemoryEventLog implements EventLog {
  readonly lines: string[] = [];
  constructor(private readonly max = 5000) {}
  append(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }
  flush(): void {
    /* nothing buffered */
  }
}

const FILE_RE = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface FileEventLogOptions {
  /** raw files older than this many days are deleted (default 90, docs/17 §7) */
  retentionDays?: number;
  onError?: (e: unknown) => void;
}

export class FileEventLog implements EventLog {
  private readonly buffer = new Map<string, string[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** completed flushes / failed flushes (test hook, ops) */
  flushes = 0;
  errors = 0;
  private readonly retentionDays: number;

  constructor(
    readonly dir: string,
    private readonly opts: FileEventLogOptions = {},
  ) {
    this.retentionDays = opts.retentionDays ?? 90;
    mkdirSync(dir, { recursive: true });
  }

  append(line: string, ms: number): void {
    const day = new Date(ms).toISOString().slice(0, 10);
    const b = this.buffer.get(day) ?? [];
    b.push(line);
    this.buffer.set(day, b);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, 1000);
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [day, lines] of [...this.buffer]) {
      try {
        appendFileSync(join(this.dir, `events-${day}.jsonl`), lines.join('\n') + '\n');
        this.buffer.delete(day);
        this.flushes++;
      } catch (e) {
        this.errors++; // stays buffered: the next flush tries again
        this.opts.onError?.(e);
      }
    }
  }

  /** Delete raw files older than the retention window relative to `nowMs`. Returns how many were removed. */
  prune(nowMs: number): number {
    if (!existsSync(this.dir)) return 0;
    const limit = new Date(nowMs - this.retentionDays * 86_400_000).toISOString().slice(0, 10);
    let n = 0;
    for (const f of readdirSync(this.dir)) {
      const m = FILE_RE.exec(f);
      if (m && m[1]! < limit) {
        try {
          unlinkSync(join(this.dir, f));
          n++;
        } catch (e) {
          this.opts.onError?.(e);
        }
      }
    }
    return n;
  }
}
