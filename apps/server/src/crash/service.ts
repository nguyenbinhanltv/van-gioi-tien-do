/**
 * Crash report intake (D110): validation, size and rate limits, fingerprinting, storage and the rollup the dashboard reads.
 *
 * Limits follow the shape of the WebSocket budgets (D101: per-source rate window, per-session cap, global cap, drops counted not
 * stored) but live in `CRASH_REPORT` (@vgtd/shared) because D101 (#256) is not in main yet; align them when it lands.
 * Nothing here trusts the client: every field is validated and the text is scrubbed again (`validateCrashBatch`).
 */
import { CRASH_REPORT, crashFingerprint, validateCrashBatch } from '@vgtd/shared';
import { rollupCrashes, type CrashRollup } from './rollup.js';
import { CrashStore, type CrashRecord } from './store.js';

export interface CrashOptions {
  /** directory of the daily JSONL files; default memory only */
  dir?: string;
  /** clock (ms); tests inject it */
  now?: () => number;
  onError?: (e: unknown) => void;
}

export interface CrashReply {
  status: 202 | 400 | 429;
  body: { ok: boolean; accepted?: number; error?: string };
  retryAfterS?: number;
}

export interface CrashCounters {
  accepted: number;
  rejectedInvalid: number;
  rateLimited: number;
}

export class CrashService {
  readonly store: CrashStore;
  readonly counters: CrashCounters = { accepted: 0, rejectedInvalid: 0, rateLimited: 0 };
  private readonly now: () => number;
  private readonly ipHits = new Map<string, number[]>();
  private readonly sessionEvents = new Map<string, number>();
  private minuteStart = 0;
  private minuteEvents = 0;

  constructor(opts: CrashOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.store = new CrashStore(opts.dir, opts.onError);
  }

  /** `ip` is used for the rate window only and is never stored. */
  submit(raw: unknown, ip: string): CrashReply {
    const t = this.now();
    if (!this.allowIp(ip, t)) return this.limited(5);
    const v = validateCrashBatch(raw);
    if (!v.ok) {
      this.counters.rejectedInvalid++;
      return { status: 400, body: { ok: false, error: v.reason } };
    }
    const b = v.batch;
    const n = b.events.length;
    if (t - this.minuteStart >= 60_000) {
      this.minuteStart = t;
      this.minuteEvents = 0;
    }
    const used = this.sessionEvents.get(b.sid) ?? 0;
    if (this.minuteEvents + n > CRASH_REPORT.SERVER_EVENTS_PER_MIN) return this.limited(30);
    // a session that spams is dropped; its first events were already stored, so it still counts once
    if (used + n > CRASH_REPORT.SERVER_EVENTS_PER_SESSION) return this.limited(60);
    this.sessionEvents.set(b.sid, used + n);
    if (this.sessionEvents.size > 50_000) this.sessionEvents.clear(); // bound memory; a reset only loosens the cap
    this.minuteEvents += n;
    const recs: CrashRecord[] = b.events.map((e) => {
      const r: CrashRecord = { ...e, recvMs: t, sid: b.sid, build: b.build, scene: b.scene };
      if (b.class) r.class = b.class;
      if (e.kind === 'error') r.fp = crashFingerprint(e.source ?? 'error', e.message ?? '', e.stack);
      return r;
    });
    this.store.append(recs);
    this.counters.accepted += n;
    return { status: 202, body: { ok: true, accepted: n } };
  }

  /** crash-free sessions % and the top crashes over the last `windowMs` (default 24 h) */
  summary(windowMs = 24 * 3_600_000, topN = 10): CrashRollup {
    const t = this.now();
    return rollupCrashes(this.store.read(t - windowMs), t, windowMs, topN);
  }

  private limited(retryAfterS: number): CrashReply {
    this.counters.rateLimited++;
    return { status: 429, body: { ok: false, error: 'rate_limited' }, retryAfterS };
  }

  private allowIp(ip: string, t: number): boolean {
    const hits = (this.ipHits.get(ip) ?? []).filter((x) => t - x < 60_000);
    if (hits.length >= CRASH_REPORT.SERVER_REQUESTS_PER_IP_PER_MIN) {
      this.ipHits.set(ip, hits);
      return false;
    }
    hits.push(t);
    this.ipHits.set(ip, hits);
    if (this.ipHits.size > 10_000) {
      for (const [k, v] of this.ipHits) if (v.every((x) => t - x >= 60_000)) this.ipHits.delete(k);
    }
    return true;
  }
}
