/**
 * Crash reporting contract (D110, docs/10 section 12 "crash-free session >= 99%", docs/17 `client.error` / `client.crash`).
 * Shared by the client reporter and the server endpoint so both agree on limits, shape, scrubbing and the fingerprint.
 *
 * A client POSTs a batch `{ v, sid, build, scene, class?, events[] }` to `POST /crash/report`. `sid` is a random per-page-load id
 * (not an account or player id), so a report cannot be linked to a person. Events are session markers and error reports; the
 * server derives "crash-free sessions %" from them: a session counts as crashed when it has a `fatal` error event.
 * No PII: no username, no chat text, no IP is stored; message and stack are scrubbed (`scrubText`) on both ends.
 */

export const CRASH_REPORT = {
  VERSION: 1,
  /** HTTP body cap of the endpoint (bytes) */
  MAX_BODY_BYTES: 8192,
  MAX_EVENTS_PER_BATCH: 10,
  MAX_MESSAGE_CHARS: 300,
  MAX_STACK_CHARS: 3000,
  MAX_FIELD_CHARS: 48,
  /** client side: same fingerprint is reported at most once per session (then only counted), and at most this many reports per session */
  CLIENT_MAX_REPORTS_PER_SESSION: 20,
  /** client side: minimum spacing between two sent batches (ms) */
  CLIENT_MIN_SEND_GAP_MS: 2000,
  /** server side: requests per IP per rolling minute, events per session, events per rolling minute for the whole server */
  SERVER_REQUESTS_PER_IP_PER_MIN: 30,
  SERVER_EVENTS_PER_SESSION: 60,
  SERVER_EVENTS_PER_MIN: 3000,
  /** store bounds: in-memory records, bytes written per UTC day (extra batches are dropped and counted), retention, bytes read per summary */
  SERVER_MAX_MEM_RECORDS: 20_000,
  SERVER_MAX_BYTES_PER_DAY: 16 * 1024 * 1024,
  SERVER_RETENTION_DAYS: 14,
  SERVER_MAX_READ_BYTES: 48 * 1024 * 1024,
  /** the rollup is cached this long (it reads the files synchronously) */
  SERVER_SUMMARY_CACHE_MS: 10_000,
  /** a session with no event for this long and no end marker is "abandoned" (closed tab), not crashed */
  SESSION_IDLE_MS: 30 * 60_000,
} as const;

export type CrashEventKind = 'session_start' | 'session_end' | 'error';
/** where an error came from: window `error`, `unhandledrejection`, `console.error` (engine logs go here), or an explicit engine hook */
export type CrashSource = 'error' | 'unhandledrejection' | 'console' | 'engine';
export const CRASH_SOURCES: readonly CrashSource[] = ['error', 'unhandledrejection', 'console', 'engine'];

export interface CrashEvent {
  kind: CrashEventKind;
  /** client clock, ms since the session start (never a wall-clock time: no timezone / clock fingerprinting) */
  atMs: number;
  source?: CrashSource;
  message?: string;
  stack?: string;
  /** an uncaught error that counts against crash-free sessions */
  fatal?: boolean;
  /** how many identical occurrences this event stands for (client dedupe) */
  count?: number;
}

export interface CrashBatch {
  v: number;
  sid: string;
  build: string;
  scene: string;
  class?: string;
  events: CrashEvent[];
}

const SID_RE = /^[a-z0-9]{8,32}$/;
const FIELD_RE = /^[A-Za-z0-9._:+@-]{1,48}$/;

/**
 * Remove what must not leave the browser: URLs lose their query and fragment (tokens live there), e-mail addresses, long hex / digit
 * runs (tokens, ids), and file-system user names in paths. Applied by the client before sending and again by the server.
 */
export function scrubText(s: string, max: number): string {
  let t = String(s);
  t = t.replace(/(https?:\/\/[^\s"'<>?#)]+)[?#][^\s"'<>)]*/g, '$1');
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  t = t.replace(/\b[0-9a-fA-F]{16,}\b/g, '<hex>');
  t = t.replace(/\b\d{9,}\b/g, '<num>');
  t = t.replace(/([A-Za-z]:)?[\\/](Users|home)[\\/][^\\/\s:)]+/gi, '$1/$2/<user>');
  // control characters (incl. newlines in a message) never travel; stack newlines are kept by the caller via `scrubStack`
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return t.length > max ? t.slice(0, max) : t;
}

/** `scrubText` for a stack trace: keeps its line breaks. */
export function scrubStack(s: string): string {
  return scrubText(s, CRASH_REPORT.MAX_STACK_CHARS);
}

/** one-line message: line breaks become spaces */
export function scrubMessage(s: string): string {
  return scrubText(String(s).replace(/\s*[\r\n]+\s*/g, ' '), CRASH_REPORT.MAX_MESSAGE_CHARS);
}

/** FNV-1a, 2 x 32 bit (deterministic, no crypto needed: the fingerprint only groups equal crashes) */
function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Group key of a crash: source + the message with numbers removed + the first three stack frames reduced to `function (file)` without
 * line / column numbers, so a rebuilt bundle or a different count still groups together. 16 hex chars.
 */
export function crashFingerprint(source: string, message: string, stack: string | undefined): string {
  const frames = (stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at\s|@/.test(l) || /:\d+:\d+/.test(l))
    .slice(0, 3)
    .map((l) =>
      l
        .replace(/https?:\/\/[^/\s)]+/g, '')
        .replace(/:\d+:\d+/g, '')
        .replace(/[?#][^\s)]*/g, ''),
    );
  const key = `${source}|${message.replace(/\d+/g, '#').trim()}|${frames.join('|')}`;
  return fnv(key, 0x811c9dc5).toString(16).padStart(8, '0') + fnv(key, 0x9747b28c).toString(16).padStart(8, '0');
}

export type CrashValidation = { ok: true; batch: CrashBatch } | { ok: false; reason: string };

/** Validate and normalise an untrusted request body. Unknown fields are dropped; text is scrubbed and clipped. */
export function validateCrashBatch(raw: unknown): CrashValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_object' };
  const o = raw as Record<string, unknown>;
  if (o.v !== CRASH_REPORT.VERSION) return { ok: false, reason: 'bad_version' };
  if (typeof o.sid !== 'string' || !SID_RE.test(o.sid)) return { ok: false, reason: 'bad_sid' };
  if (typeof o.build !== 'string' || !FIELD_RE.test(o.build)) return { ok: false, reason: 'bad_build' };
  if (typeof o.scene !== 'string' || !FIELD_RE.test(o.scene)) return { ok: false, reason: 'bad_scene' };
  if (o.class !== undefined && (typeof o.class !== 'string' || !FIELD_RE.test(o.class)))
    return { ok: false, reason: 'bad_class' };
  if (!Array.isArray(o.events) || o.events.length === 0 || o.events.length > CRASH_REPORT.MAX_EVENTS_PER_BATCH)
    return { ok: false, reason: 'bad_events' };
  const events: CrashEvent[] = [];
  for (const e of o.events as unknown[]) {
    if (!e || typeof e !== 'object') return { ok: false, reason: 'bad_event' };
    const r = e as Record<string, unknown>;
    if (r.kind !== 'session_start' && r.kind !== 'session_end' && r.kind !== 'error')
      return { ok: false, reason: 'bad_kind' };
    const atMs = typeof r.atMs === 'number' && Number.isFinite(r.atMs) ? Math.max(0, Math.min(r.atMs, 2 ** 40)) : NaN;
    if (Number.isNaN(atMs)) return { ok: false, reason: 'bad_time' };
    const ev: CrashEvent = { kind: r.kind, atMs: Math.round(atMs) };
    if (r.kind === 'error') {
      if (typeof r.source !== 'string' || !CRASH_SOURCES.includes(r.source as CrashSource))
        return { ok: false, reason: 'bad_source' };
      if (typeof r.message !== 'string') return { ok: false, reason: 'bad_message' };
      ev.source = r.source as CrashSource;
      ev.message = scrubMessage(r.message);
      if (typeof r.stack === 'string') ev.stack = scrubStack(r.stack);
      ev.fatal = r.fatal === true;
      const c = typeof r.count === 'number' && Number.isFinite(r.count) ? Math.floor(r.count) : 1;
      ev.count = Math.max(1, Math.min(c, 10_000));
    }
    events.push(ev);
  }
  const batch: CrashBatch = { v: CRASH_REPORT.VERSION, sid: o.sid, build: o.build, scene: o.scene, events };
  if (typeof o.class === 'string') batch.class = o.class;
  return { ok: true, batch };
}
