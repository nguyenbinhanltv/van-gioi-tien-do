/**
 * Crash rollup (D110): pure function from stored records to the numbers the dashboard shows.
 *
 * Session = distinct `sid` with a `session_start`. Crashed = a session with a `fatal` error event; every other session is
 * crash-free. A session with no `session_end` and no event for
 * `SESSION_IDLE_MS` is "abandoned" (closed tab) and counts as crash-free; one that is still inside the idle window is "live".
 * crashFreePct = (sessions - crashed) / sessions * 100 over sessions that started inside the window (100 when there are none).
 */
import { CRASH_REPORT } from '@vgtd/shared';
import type { CrashRecord } from './store.js';

export interface TopCrash {
  fingerprint: string;
  source: string;
  message: string;
  /** stack of the most recent occurrence */
  stack: string;
  /** total occurrences (sum of event counts) */
  occurrences: number;
  /** distinct sessions hit */
  sessions: number;
  fatal: boolean;
  builds: string[];
  scenes: string[];
  lastSeenMs: number;
}

export interface CrashRollup {
  windowMs: number;
  generatedMs: number;
  sessions: number;
  crashedSessions: number;
  liveSessions: number;
  abandonedSessions: number;
  crashFreePct: number;
  /** the beta gate (docs/10 section 12) */
  target: number;
  byBuild: Array<{ build: string; sessions: number; crashed: number; crashFreePct: number }>;
  top: TopCrash[];
}

export const CRASH_FREE_TARGET_PCT = 99;
const pct = (sessions: number, crashed: number): number =>
  sessions === 0 ? 100 : Math.round(((sessions - crashed) / sessions) * 10_000) / 100;

export function rollupCrashes(
  records: readonly CrashRecord[],
  nowMs: number,
  windowMs: number,
  topN = 10,
): CrashRollup {
  const since = nowMs - windowMs;
  interface S {
    build: string;
    crashed: boolean;
    ended: boolean;
    lastMs: number;
  }
  const sessions = new Map<string, S>();
  for (const r of records) {
    if (r.recvMs < since || r.kind !== 'session_start') continue;
    if (!sessions.has(r.sid)) sessions.set(r.sid, { build: r.build, crashed: false, ended: false, lastMs: r.recvMs });
  }
  const groups = new Map<string, TopCrash & { sids: Set<string> }>();
  for (const r of records) {
    if (r.recvMs < since) continue;
    const s = sessions.get(r.sid);
    if (s) {
      s.lastMs = Math.max(s.lastMs, r.recvMs);
      if (r.kind === 'session_end') s.ended = true;
      if (r.kind === 'error' && r.fatal) s.crashed = true;
    }
    if (r.kind !== 'error' || !r.fp) continue;
    let g = groups.get(r.fp);
    if (!g) {
      g = {
        fingerprint: r.fp,
        source: r.source ?? 'error',
        message: r.message ?? '',
        stack: r.stack ?? '',
        occurrences: 0,
        sessions: 0,
        fatal: false,
        builds: [],
        scenes: [],
        lastSeenMs: 0,
        sids: new Set(),
      };
      groups.set(r.fp, g);
    }
    g.occurrences += r.count ?? 1;
    g.sids.add(r.sid);
    g.fatal ||= r.fatal === true;
    if (!g.builds.includes(r.build)) g.builds.push(r.build);
    if (!g.scenes.includes(r.scene)) g.scenes.push(r.scene);
    if (r.recvMs >= g.lastSeenMs) {
      g.lastSeenMs = r.recvMs;
      g.stack = r.stack ?? g.stack;
      g.message = r.message ?? g.message;
    }
  }
  let crashed = 0;
  let live = 0;
  let abandoned = 0;
  const builds = new Map<string, { sessions: number; crashed: number }>();
  for (const s of sessions.values()) {
    if (s.crashed) crashed++;
    else if (!s.ended) {
      if (nowMs - s.lastMs > CRASH_REPORT.SESSION_IDLE_MS) abandoned++;
      else live++;
    }
    const b = builds.get(s.build) ?? { sessions: 0, crashed: 0 };
    b.sessions++;
    if (s.crashed) b.crashed++;
    builds.set(s.build, b);
  }
  const top = [...groups.values()]
    .map(({ sids, ...g }) => ({ ...g, sessions: sids.size }))
    .sort(
      (a, b) => b.sessions - a.sessions || b.occurrences - a.occurrences || (a.fingerprint < b.fingerprint ? -1 : 1),
    )
    .slice(0, topN);
  return {
    windowMs,
    generatedMs: nowMs,
    sessions: sessions.size,
    crashedSessions: crashed,
    liveSessions: live,
    abandonedSessions: abandoned,
    crashFreePct: pct(sessions.size, crashed),
    target: CRASH_FREE_TARGET_PCT,
    byBuild: [...builds.entries()]
      .map(([build, v]) => ({ build, ...v, crashFreePct: pct(v.sessions, v.crashed) }))
      .sort((a, b) => (a.build < b.build ? -1 : 1)),
    top,
  };
}
