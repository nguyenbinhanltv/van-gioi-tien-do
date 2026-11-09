import {
  CRASH_REPORT,
  crashFingerprint,
  scrubMessage,
  scrubStack,
  type CrashBatch,
  type CrashEvent,
  type CrashSource,
} from '@vgtd/shared';

/**
 * Crash reporter core (D110, engine-free): collects session markers and error reports, dedupes and rate limits them, and hands
 * ready JSON batches to an injected `send`. The Cocos client wires `send` to `sendBeacon` / `fetch` and the hooks to `window`
 * (see `installCrashHooks`). No PII: the batch holds a random per-page-load `sid`, the build id, scene and class path id,
 * and error text scrubbed of URLs' queries, e-mails, long ids and user names in paths. Chat text never enters (the reporter
 * has no access to it, and message text is never read from game state).
 *
 * Limits (`CRASH_REPORT`): the same fingerprint is sent once per session (repeats are counted and flushed with the end marker),
 * at most `CLIENT_MAX_REPORTS_PER_SESSION` distinct reports, batches at least `CLIENT_MIN_SEND_GAP_MS` apart (fatal errors and the
 * end marker bypass the gap so a dying page still reports).
 */
export interface CrashReporterOptions {
  build: string;
  /** random per-page-load id, 8..32 chars of [a-z0-9] */
  sid: string;
  getScene: () => string;
  getClass?: () => string | undefined;
  /** deliver one JSON body; `final` = the page is going away (use sendBeacon / keepalive) */
  send: (json: string, final: boolean) => void;
  /** ms clock; defaults to a monotonic-ish `Date.now`, only differences are reported (atMs = since start) */
  now?: () => number;
  /** called when a flush was postponed by the send gap, to retry after `ms` (default: none; the next report or `end` flushes) */
  schedule?: (fn: () => void, ms: number) => void;
}

export interface CrashReporterStats {
  reported: number;
  deduped: number;
  droppedOverCap: number;
  batchesSent: number;
}

export class CrashReporter {
  readonly stats: CrashReporterStats = { reported: 0, deduped: 0, droppedOverCap: 0, batchesSent: 0 };
  private readonly now: () => number;
  private readonly queue: CrashEvent[] = [];
  private readonly seen = new Map<string, { extra: number; source: CrashSource; message: string; fatal: boolean }>();
  private t0 = 0;
  private lastSend = -Infinity;
  private started = false;
  private ended = false;
  private pending = false;

  constructor(private readonly o: CrashReporterOptions) {
    this.now = o.now ?? Date.now;
  }

  /** Session start marker. Call once when the client boots (so a session that crashes right after is still counted). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.t0 = this.now();
    this.queue.push({ kind: 'session_start', atMs: 0 });
    this.flush(true);
  }

  get crashed(): boolean {
    return this.hadFatal;
  }
  private hadFatal = false;

  /** Record one error. Never throws (it runs inside error handlers). */
  report(source: CrashSource, message: unknown, stack: unknown, fatal: boolean): void {
    try {
      if (this.ended) return;
      const msg = scrubMessage(message instanceof Error ? message.message : String(message ?? ''));
      const stk = typeof stack === 'string' ? scrubStack(stack) : message instanceof Error && message.stack ? scrubStack(message.stack) : undefined;
      const fp = crashFingerprint(source, msg, stk);
      const prev = this.seen.get(fp);
      if (fatal) this.hadFatal = true;
      if (prev) {
        prev.extra++;
        prev.fatal ||= fatal;
        this.stats.deduped++;
        return;
      }
      if (this.seen.size >= CRASH_REPORT.CLIENT_MAX_REPORTS_PER_SESSION) {
        this.stats.droppedOverCap++;
        return;
      }
      this.seen.set(fp, { extra: 0, source, message: msg, fatal });
      this.stats.reported++;
      this.queue.push({ kind: 'error', atMs: this.elapsed(), source, message: msg, ...(stk ? { stack: stk } : {}), fatal });
      this.flush(fatal);
    } catch {
      /* a reporter must never break the page */
    }
  }

  /** Session end marker (page hide / unload). Also flushes the counts of deduped repeats. Idempotent. */
  end(): void {
    if (this.ended || !this.started) return;
    for (const [, s] of this.seen) {
      if (s.extra > 0)
        this.queue.push({ kind: 'error', atMs: this.elapsed(), source: s.source, message: s.message, fatal: s.fatal, count: s.extra });
    }
    this.queue.push({ kind: 'session_end', atMs: this.elapsed() });
    this.flush(true, true);
    this.ended = true;
  }

  /** Send what is queued (called by the hooks; safe to call from a timer). */
  flush(force = false, final = false): void {
    if (this.queue.length === 0) return;
    const t = this.now();
    if (!force && t - this.lastSend < CRASH_REPORT.CLIENT_MIN_SEND_GAP_MS) {
      if (!this.pending && this.o.schedule) {
        this.pending = true;
        this.o.schedule(() => {
          this.pending = false;
          this.flush();
        }, CRASH_REPORT.CLIENT_MIN_SEND_GAP_MS - (t - this.lastSend));
      }
      return;
    }
    this.lastSend = t;
    while (this.queue.length > 0) {
      const events = this.queue.splice(0, CRASH_REPORT.MAX_EVENTS_PER_BATCH);
      const cls = this.o.getClass?.();
      const batch: CrashBatch = {
        v: CRASH_REPORT.VERSION,
        sid: this.o.sid,
        build: this.o.build,
        scene: this.o.getScene(),
        ...(cls ? { class: cls } : {}),
        events,
      };
      this.stats.batchesSent++;
      try {
        this.o.send(JSON.stringify(batch), final);
      } catch {
        /* offline / blocked: reports are best effort */
      }
    }
  }

  private elapsed(): number {
    return Math.max(0, this.now() - this.t0);
  }
}

/** The bits of `window` the hooks need (structural, so tests can pass a fake). */
export interface CrashHookTarget {
  // `any`: DOM `Window` listeners are typed per event name; the handlers below read only optional fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, fn: (ev: any) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeEventListener(type: string, fn: (ev: any) => void): void;
}
export interface CrashHookConsole {
  error: (...args: unknown[]) => void;
}

/**
 * Wire the reporter to the page: uncaught `error` and `unhandledrejection` are fatal (they count against crash-free sessions);
 * `console.error` (where the Cocos engine logs its own errors) is a non-fatal `console` report; `pagehide` ends the session.
 * Returns an uninstall function.
 */
export function installCrashHooks(reporter: CrashReporter, win: CrashHookTarget, con: CrashHookConsole): () => void {
  let inside = false; // console.error -> report -> send -> console.error must not loop
  const guard = (fn: () => void): void => {
    if (inside) return;
    inside = true;
    try {
      fn();
    } finally {
      inside = false;
    }
  };
  const onError = (ev: { message?: unknown; error?: unknown }): void =>
    guard(() => {
      if (ev.message === undefined && ev.error === undefined) return; // resource load error events carry neither
      const e = ev.error;
      reporter.report('error', e instanceof Error ? e : ev.message, e instanceof Error ? e.stack : undefined, true);
    });
  const onRejection = (ev: { reason?: unknown }): void =>
    guard(() => {
      const r = ev.reason;
      reporter.report('unhandledrejection', r instanceof Error ? r : String(r), r instanceof Error ? r.stack : undefined, true);
    });
  const onHide = (): void => reporter.end();
  const origError = con.error;
  con.error = (...args: unknown[]): void => {
    origError.apply(con, args);
    guard(() => {
      const e = args.find((x) => x instanceof Error) as Error | undefined;
      const text = args.map((x) => (typeof x === 'string' ? x : x instanceof Error ? x.message : '[object]')).join(' ');
      reporter.report('console', e ?? text, e?.stack, false);
    });
  };
  win.addEventListener('error', onError as never);
  win.addEventListener('unhandledrejection', onRejection as never);
  win.addEventListener('pagehide', onHide as never);
  return () => {
    win.removeEventListener('error', onError as never);
    win.removeEventListener('unhandledrejection', onRejection as never);
    win.removeEventListener('pagehide', onHide as never);
    con.error = origError;
  };
}
