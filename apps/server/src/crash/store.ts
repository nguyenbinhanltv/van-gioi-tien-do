/**
 * Crash event store (D110): one JSONL file per UTC day (`crash-YYYY-MM-DD.jsonl`) in `dir`, or memory only when `dir` is undefined.
 * A line is a flat record; no account id, no IP, no username: only the random per-page-load `sid`.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CrashEvent } from '@vgtd/shared';

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

export class CrashStore {
  private readonly mem: CrashRecord[] = [];
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
      return;
    }
    const byDay = new Map<string, string>();
    for (const r of recs) byDay.set(dayOf(r.recvMs), (byDay.get(dayOf(r.recvMs)) ?? '') + JSON.stringify(r) + '\n');
    try {
      for (const [day, text] of byDay) appendFileSync(join(this.dir, `crash-${day}.jsonl`), text, { mode: 0o600 });
    } catch (e) {
      this.onError(e); // a full disk must not break the game server
    }
  }

  /** records received at or after `sinceMs` (unparseable lines are skipped: a torn last line after a crash is normal) */
  read(sinceMs: number): CrashRecord[] {
    if (!this.dir) return this.mem.filter((r) => r.recvMs >= sinceMs);
    const out: CrashRecord[] = [];
    const first = dayOf(sinceMs);
    let files: string[] = [];
    try {
      files = readdirSync(this.dir)
        .filter((f) => /^crash-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(6, 16) >= first)
        .sort();
    } catch (e) {
      this.onError(e);
    }
    for (const f of files) {
      for (const line of readFileSync(join(this.dir, f), 'utf8').split('\n')) {
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
}
