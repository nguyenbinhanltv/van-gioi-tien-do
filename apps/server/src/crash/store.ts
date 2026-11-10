/**
 * Crash event store (D110): one JSONL file per UTC day (`crash-YYYY-MM-DD.jsonl`) in `dir`, or a bounded ring in memory when `dir` is
 * undefined. A line is a flat record; no account id, no IP, no username: only the random per-page-load `sid`.
 *
 * Bounds (`CRASH_REPORT`): the ring keeps the newest `SERVER_MAX_MEM_RECORDS`; a day file takes at most `SERVER_MAX_BYTES_PER_DAY` (later
 * batches that day are dropped and counted in `dropped`, never partially written); files older than `SERVER_RETENTION_DAYS` are deleted when
 * a new day starts; `read` skips the oldest files once `SERVER_MAX_READ_BYTES` would be exceeded.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CRASH_REPORT, type CrashEvent } from '@vgtd/shared';

export interface CrashRecord extends CrashEvent {
  /** server receive time, ms since epoch */
  recvMs: number;
  sid: string;
  build: string;
  scene: string;
  class?: string;
  /** crash fingerprint (error events only) */
  fp?: string;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const FILE_RE = /^crash-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export class CrashStore {
  private mem: CrashRecord[] = [];
  private readonly dayBytes = new Map<string, number>();
  private lastDay = '';
  /** records refused by the daily byte budget or a failed write */
  dropped = 0;

  constructor(
    private readonly dir?: string,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {
    if (dir) mkdirSync(dir, { recursive: true });
  }

  append(recs: readonly CrashRecord[]): void {
    if (recs.length === 0) return;
    if (!this.dir) {
      this.mem.push(...recs);
      const over = this.mem.length - CRASH_REPORT.SERVER_MAX_MEM_RECORDS;
      if (over > 0) this.mem = this.mem.slice(over);
      return;
    }
    const byDay = new Map<string, { text: string; n: number }>();
    for (const r of recs) {
      const d = dayOf(r.recvMs);
      const g = byDay.get(d) ?? { text: '', n: 0 };
      g.text += JSON.stringify(r) + '\n';
      g.n++;
      byDay.set(d, g);
    }
    for (const [day, g] of byDay) {
      if (day !== this.lastDay) {
        this.lastDay = day;
        this.prune(day);
      }
      const file = join(this.dir, `crash-${day}.jsonl`);
      try {
        const used = this.dayBytes.get(day) ?? this.sizeOf(file);
        const add = Buffer.byteLength(g.text);
        if (used + add > CRASH_REPORT.SERVER_MAX_BYTES_PER_DAY) {
          this.dayBytes.set(day, used);
          this.dropped += g.n;
          continue;
        }
        appendFileSync(file, g.text, { mode: 0o600 });
        this.dayBytes.set(day, used + add);
      } catch (e) {
        this.dropped += g.n;
        this.onError(e); // a full disk must not break the game server
      }
    }
  }

  /** records received at or after `sinceMs` (unparseable lines are skipped: a torn last line after a crash is normal) */
  read(sinceMs: number): CrashRecord[] {
    if (!this.dir) return this.mem.filter((r) => r.recvMs >= sinceMs);
    const out: CrashRecord[] = [];
    const first = dayOf(sinceMs);
    let files: Array<{ name: string; size: number }> = [];
    try {
      files = readdirSync(this.dir)
        .filter((f) => (FILE_RE.exec(f)?.[1] ?? '') >= first && FILE_RE.test(f))
        .sort()
        .map((name) => ({ name, size: this.sizeOf(join(this.dir!, name)) }));
    } catch (e) {
      this.onError(e);
    }
    // newest files win when the byte cap is hit
    let total = 0;
    const keep: string[] = [];
    for (const f of files.reverse()) {
      if (total + f.size > CRASH_REPORT.SERVER_MAX_READ_BYTES && keep.length > 0) break;
      total += f.size;
      keep.push(f.name);
    }
    for (const name of keep.reverse()) {
      for (const line of readFileSync(join(this.dir, name), 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const r = JSON.parse(line) as CrashRecord;
          if (r.recvMs >= sinceMs) out.push(r);
        } catch {
          /* torn line */
        }
      }
    }
    return out;
  }

  /** delete day files older than the retention window (relative to `today`, a `YYYY-MM-DD`) */
  private prune(today: string): void {
    if (!this.dir) return;
    const cutoff = dayOf(Date.parse(today + 'T00:00:00Z') - CRASH_REPORT.SERVER_RETENTION_DAYS * 86_400_000);
    try {
      for (const f of readdirSync(this.dir)) {
        const d = FILE_RE.exec(f)?.[1];
        if (d && d < cutoff) {
          rmSync(join(this.dir, f), { force: true });
          this.dayBytes.delete(d);
        }
      }
    } catch (e) {
      this.onError(e);
    }
  }

  private sizeOf(file: string): number {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }
}
