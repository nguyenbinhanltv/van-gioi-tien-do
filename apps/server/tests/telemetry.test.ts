import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import {
  SINK_SOURCE_RATIO_TARGET,
  TELEMETRY_EVENTS,
  TELEMETRY_FORBIDDEN_FIELDS,
  TUTORIAL_STEPS,
  validateTelemetryAttrs,
} from '@vgtd/shared';
import { ErrorCode, decode, encode, type Message } from '@vgtd/protocol';
import {
  FileEventLog,
  Ledger,
  MemoryEventLog,
  Rollups,
  TelemetryService,
  TutorialService,
  WorldNode,
  dashboardAllowed,
  dayOf,
  openTelemetryFiles,
  parseRollupDoc,
  pseudonymise,
  startServer,
  uuid7,
  type AccountKind,
  type ClientTransport,
  type TelemetryEnvelope,
} from '../src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0); // 2026-11-09 12:00 UTC
const KEY = 'k'.repeat(64);
/** deterministic "random": a counter spread over the bytes */
function counterRandom(): (n: number) => Uint8Array {
  let c = 1;
  return (n) => Uint8Array.from({ length: n }, (_, i) => (c++ * 37 + i * 11) & 0xff);
}
function rig(opts: { start?: number; ccuEveryMs?: number } = {}) {
  let now = opts.start ?? T0;
  const log = new MemoryEventLog();
  const t = new TelemetryService({
    key: KEY,
    now: () => now,
    random: counterRandom(),
    log,
    ccuEveryMs: opts.ccuEveryMs,
  });
  return {
    t,
    log,
    at: (ms: number) => (now = ms),
    advance: (ms: number) => (now += ms),
    events: () => log.lines.map((l) => JSON.parse(l) as TelemetryEnvelope),
  };
}

describe('pseudonyms and ids (docs/17 §3.2, §7)', () => {
  it('player_pid is a one-way keyed hash: stable, 64 hex, key-dependent, never the account id', () => {
    const a = pseudonymise(KEY, 'acc-1234');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pseudonymise(KEY, 'acc-1234')).toBe(a);
    expect(pseudonymise('x'.repeat(64), 'acc-1234')).not.toBe(a);
    expect(pseudonymise(KEY, 'acc-1235')).not.toBe(a);
    expect(a).not.toContain('acc-1234');
  });
  it('event ids are UUID v7: right shape, time-ordered, random part from the generator', () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const r = counterRandom();
    const a = uuid7(T0, r);
    const b = uuid7(T0 + 1, r);
    expect(a).toMatch(re);
    expect(b).toMatch(re);
    expect(a < b).toBe(true); // the first 48 bits are the timestamp
    expect(a.slice(0, 13)).not.toBe(b.slice(0, 13));
    expect(uuid7(T0, counterRandom())).toBe(uuid7(T0, counterRandom())); // reproducible
  });
});

describe('the event catalogue', () => {
  it('accepts a valid event and refuses unknown events, undeclared attributes, wrong types and missing attributes', () => {
    expect(validateTelemetryAttrs('session.end', { duration_s: 30, reason: 'quit' })).toBeNull();
    expect(validateTelemetryAttrs('nope.event', {})).toMatch(/unknown event/);
    expect(validateTelemetryAttrs('session.end', { duration_s: 30, reason: 'quit', extra: 1 })).toMatch(/not declared/);
    expect(validateTelemetryAttrs('session.end', { duration_s: 1.5, reason: 'quit' })).toMatch(/integer/);
    expect(validateTelemetryAttrs('session.end', { duration_s: 3, reason: 'lag' })).toMatch(/one of/);
    expect(validateTelemetryAttrs('session.end', { duration_s: 3 })).toMatch(/missing/);
    expect(validateTelemetryAttrs('economy.faucet', { currency: 'Lt Ha', amount: 1, channel: 'drop_mob' })).toMatch(
      /code/,
    );
    expect(validateTelemetryAttrs('breakthrough.attempt', { to_stage: 2, success: true, p_success: NaN })).toMatch(
      /finite/,
    );
  });
  it('no event can carry personal data: no declared attribute is on the forbidden list, and forbidden names are refused outright', () => {
    for (const [name, def] of Object.entries(TELEMETRY_EVENTS))
      for (const attr of Object.keys(def.attrs))
        expect(TELEMETRY_FORBIDDEN_FIELDS, `${name}.${attr}`).not.toContain(attr);
    for (const f of TELEMETRY_FORBIDDEN_FIELDS)
      expect(validateTelemetryAttrs('cultivate.start', { [f]: 'x' }), f).toMatch(/forbidden/);
  });
  it('every event names its question and its names follow <domain>.<action> in snake_case', () => {
    for (const [name, def] of Object.entries(TELEMETRY_EVENTS)) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect(def.question.length).toBeGreaterThan(10);
      for (const a of Object.keys(def.attrs)) expect(a).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
  it('the ftue.step enum is exactly the tutorial step list', () => {
    const t = TELEMETRY_EVENTS['ftue.step'].attrs.step;
    expect([...t.enum]).toEqual([...TUTORIAL_STEPS]);
  });
});

describe('TelemetryService: envelope, sessions, privacy', () => {
  it('wraps an event in the docs/17 envelope with a pseudonymous id and a per-session sequence', () => {
    const r = rig();
    r.t.sessionStart('acc-secret-123', 2);
    r.t.emitAccount('acc-secret-123', 'cultivate.start');
    r.advance(90_000);
    r.t.sessionEnd('acc-secret-123', 'quit');
    const ev = r.events();
    expect(ev.map((e) => e.event_name)).toEqual([
      'session.start',
      'character.create',
      'cultivate.start',
      'session.end',
    ]);
    const pid = pseudonymise(KEY, 'acc-secret-123');
    for (const e of ev) {
      expect(e).toMatchObject({ schema_version: '1.0.0', player_pid: pid, platform: 'web', ts_client_ms: null });
      expect(e.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(e.session_id).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(new Set(ev.map((e) => e.session_id)).size).toBe(1);
    expect(ev.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(ev.map((e) => e.source)).toEqual(['gateway', 'world', 'world', 'gateway']);
    expect(ev[1]!.attrs).toEqual({ class_id: 2 });
    expect(ev[3]!.attrs).toEqual({ duration_s: 90, reason: 'quit' });
    expect(ev[3]!.ts_server_ms).toBe(T0 + 90_000);
  });

  it('never writes the account id, a username, an address or any chat text anywhere in the log', () => {
    const r = rig();
    r.t.sessionStart('acc-secret-123', 1);
    r.t.emitAccount('acc-secret-123', 'account.login', { method: 'password' });
    expect(r.t.emitAccount('acc-secret-123', 'cultivate.start', { username: 'alice' } as never)).toBe(false);
    expect(r.t.emitAccount('acc-secret-123', 'cultivate.start', { text: 'hello' } as never)).toBe(false);
    r.t.sessionEnd('acc-secret-123', 'kick');
    const all = r.log.lines.join('\n');
    expect(all).not.toContain('acc-secret-123');
    expect(all).not.toContain('alice');
    expect(all).not.toContain('hello');
    expect(r.t.refusedHere).toBe(2);
    expect(r.t.rollups.doc.refused).toBe(2);
    expect(r.t.summary().health.refusedEvents).toBe(2);
  });

  it('a refused event is not logged and does not advance the sequence', () => {
    const r = rig();
    r.t.sessionStart('a', 1);
    r.t.emitAccount('a', 'ftue.step', { step: 'moon' } as never);
    r.t.emitAccount('a', 'cultivate.start');
    expect(r.events().map((e) => [e.event_name, e.seq])).toEqual([
      ['session.start', 0],
      ['character.create', 1],
      ['cultivate.start', 2],
    ]);
  });

  it('a second session start of the same account keeps the first session; ending twice is harmless', () => {
    const r = rig();
    r.t.sessionStart('a', 1);
    r.t.sessionStart('a', 1);
    r.t.sessionEnd('a', 'quit');
    r.t.sessionEnd('a', 'quit');
    expect(r.events().filter((e) => e.event_name === 'session.start')).toHaveLength(1);
    expect(r.events().filter((e) => e.event_name === 'session.end')).toHaveLength(1);
  });

  it('events with no session (login at the gateway, ledger) carry a placeholder session and a zero sequence', () => {
    const r = rig();
    r.t.emitAccount('a', 'account.register', { method: 'password' });
    expect(r.events()[0]).toMatchObject({ session_id: '00000000', seq: 0 });
  });
});

describe('rollups: DAU, new players, retention, CCU, FTUE funnel', () => {
  it('counts distinct active players per day and marks the first time a player is ever seen as a new player', () => {
    const r = rig();
    r.t.sessionStart('a', 1);
    r.t.sessionEnd('a', 'quit');
    r.t.sessionStart('a', 1); // the same player again the same day: still one DAU
    r.t.sessionStart('b', 1);
    r.t.sessionEnd('a', 'quit');
    r.t.sessionEnd('b', 'quit');
    r.at(T0 + DAY);
    r.t.sessionStart('a', 1);
    const s = r.t.summary();
    expect(s.days.map((d) => [d.day, d.dau, d.newPlayers])).toEqual([
      ['2026-11-09', 2, 2],
      ['2026-11-10', 1, 0],
    ]);
    expect(r.events().filter((e) => e.event_name === 'character.create')).toHaveLength(2);
  });

  it('retention D1 / D7 are exact over the cohort and flagged placeholder below the minimum cohort size', () => {
    const pidOf = (i: number): string => i.toString(16).padStart(16, '0');
    const roll = new Rollups();
    const N = 40;
    for (let i = 0; i < N; i++) roll.seen(pidOf(i), T0); // 40 players start on day 0
    for (let i = 0; i < 10; i++) roll.seen(pidOf(i), T0 + DAY); // 10 come back on day 1
    for (let i = 0; i < 4; i++) roll.seen(pidOf(i), T0 + 7 * DAY); // 4 on day 7
    roll.seen('q'.padEnd(16, '0'), T0 + 6 * DAY); // a newcomer on day 6: not in the day-0 cohort
    const today = dayOf(T0 + 8 * DAY);
    expect(roll.retention(1, today)).toEqual({ cohort: 41, retained: 10, rate: 10 / 41, insufficient: false });
    // D7: only players first seen at least 7 days ago are in the cohort (the day-6 newcomer is not)
    expect(roll.retention(7, today)).toEqual({ cohort: N, retained: 4, rate: 4 / N, insufficient: false });
    const small = new Rollups();
    small.seen('a'.padEnd(16, '0'), T0);
    expect(small.retention(1, dayOf(T0 + 2 * DAY))).toMatchObject({ cohort: 1, insufficient: true });
    expect(new Rollups().retention(1, dayOf(T0))).toEqual({ cohort: 0, retained: 0, rate: null, insufficient: true });
  });

  it('samples CCU once a period, keeps the daily peak and average', () => {
    const r = rig({ ccuEveryMs: 60_000 });
    r.t.tick(3);
    r.advance(10_000);
    r.t.tick(9); // inside the same period: not sampled
    r.advance(60_000);
    r.t.tick(5);
    const s = r.t.summary();
    expect(s.ccu.series).toEqual([
      [T0, 3],
      [T0 + 70_000, 5],
    ]);
    expect(s.ccu.peak24h).toBe(5);
    expect(s.days[0]).toMatchObject({ ccuPeak: 5, ccuAvg: 4 });
  });

  it('FTUE funnel: distinct players per step, completion and skip, elapsed time from the first time the player was seen', () => {
    const r = rig();
    r.t.sessionStart('a', 1);
    r.t.sessionStart('b', 1);
    r.advance(120_000);
    r.t.ftue('a', { kind: 'step', step: 'move' });
    r.t.ftue('a', { kind: 'step', step: 'move' }); // the same player again: still one
    r.t.ftue('b', { kind: 'step', step: 'move' });
    r.t.ftue('a', { kind: 'step', step: 'field' });
    r.t.ftue('a', { kind: 'complete' });
    r.t.ftue('b', { kind: 'skip', stepsDone: 1 });
    const f = r.t.summary().ftue;
    expect(f).toMatchObject({ started: 2, completed: 1, skipped: 1, completionRate: 0.5 });
    expect(f.steps.find((x) => x.step === 'move')).toEqual({ step: 'move', players: 2, rate: 1 });
    expect(f.steps.find((x) => x.step === 'field')).toEqual({ step: 'field', players: 1, rate: 0.5 });
    expect(f.steps.find((x) => x.step === 'party')).toEqual({ step: 'party', players: 0, rate: 0 });
    expect(f.steps.map((x) => x.step)).toEqual([...TUTORIAL_STEPS]);
    const complete = r.events().find((e) => e.event_name === 'ftue.complete')!;
    expect(complete.attrs).toEqual({ elapsed_s: 120 });
  });

  it('an FTUE feed from the real TutorialService lands in the funnel', () => {
    const r = rig();
    const tut = new TutorialService({ mapTiles: 256, onEvent: (acc, rep) => r.t.ftue(acc, rep) });
    r.t.sessionStart('acc', 1);
    tut.join(1, 'acc');
    tut.note(1, 'chat');
    tut.note(1, 'meditate');
    tut.skip(1);
    const f = r.t.summary().ftue;
    expect(f.steps.find((x) => x.step === 'chat')!.players).toBe(1);
    expect(f.steps.find((x) => x.step === 'meditate')!.players).toBe(1);
    expect(f).toMatchObject({ started: 1, skipped: 1, completed: 0 });
  });
});

describe('economy from the ledger (docs/17 §5.1)', () => {
  const wallet = (owner: string) => ({
    kind: 'PLAYER_WALLET' as AccountKind,
    ownerId: owner,
    currency: 'LT_HA' as const,
  });
  const faucet = { kind: 'SYSTEM_FAUCET_DROP_MOB' as AccountKind, ownerId: null, currency: 'LT_HA' as const };
  const sinkAcc = (k: string) => ({ kind: k as AccountKind, ownerId: null, currency: 'LT_HA' as const });

  it('turns faucet and sink entries into events and a sink / source ratio against the 0.9-1.0 target', () => {
    const r = rig();
    const ledger = new Ledger();
    r.t.attachLedger(ledger);
    ledger.post({
      reason: 'DROP',
      idempotencyKey: 'k1',
      entries: [
        { account: faucet, delta: -100n },
        { account: wallet('acc-1'), delta: 100n },
      ],
    });
    ledger.post({
      reason: 'DROP' as never,
      idempotencyKey: 'k2',
      entries: [
        { account: wallet('acc-1'), delta: -95n },
        { account: sinkAcc('SYSTEM_SINK_BREAKTHROUGH'), delta: 95n },
      ],
    });
    r.t.tick(0);
    const ev = r.events().filter((e) => e.event_name.startsWith('economy.'));
    expect(ev.map((e) => [e.event_name, e.attrs])).toEqual([
      ['economy.faucet', { currency: 'lt_ha', amount: 100, channel: 'drop_mob' }],
      ['economy.sink', { currency: 'lt_ha', amount: 95, channel: 'breakthrough' }],
    ]);
    expect(ev[0]!.player_pid).toBe(pseudonymise(KEY, 'acc-1')); // attributed to the wallet owner
    const c = r.t.summary().economy.currencies[0]!;
    expect(c).toMatchObject({ currency: 'lt_ha', faucet: 100, sink: 95, inTarget: true });
    expect(c.ratio).toBeCloseTo(0.95);
    expect(c.faucetChannels).toEqual({ drop_mob: 100 });
    expect(c.sinkChannels).toEqual({ breakthrough: 95 });
    expect(r.t.summary().economy.targetRatio).toEqual(SINK_SOURCE_RATIO_TARGET);
  });

  it('flags a ratio outside the target, ignores wallet-only entries and history from before the watch started, and never double counts', () => {
    const r = rig();
    const ledger = new Ledger();
    ledger.post({
      reason: 'DROP',
      idempotencyKey: 'old',
      entries: [
        { account: faucet, delta: -999n },
        { account: wallet('x'), delta: 999n },
      ],
    });
    r.t.attachLedger(ledger); // the old drop is history: not recounted
    ledger.post({
      reason: 'DROP',
      idempotencyKey: 'n1',
      entries: [
        { account: faucet, delta: -100n },
        { account: wallet('x'), delta: 100n },
      ],
    });
    r.t.tick(0);
    r.t.tick(0);
    r.t.pollLedger();
    const c = r.t.summary().economy.currencies[0]!;
    expect(c).toMatchObject({ faucet: 100, sink: 0, ratio: 0, inTarget: false });
  });

  it('the rollup window only covers the last N days', () => {
    const r = rig();
    const ledger = new Ledger();
    r.t.attachLedger(ledger);
    const drop = (k: string, n: bigint) =>
      ledger.post({
        reason: 'DROP',
        idempotencyKey: k,
        entries: [
          { account: faucet, delta: -n },
          { account: wallet('x'), delta: n },
        ],
      });
    drop('a', 10n);
    r.t.tick(0);
    r.at(T0 + 10 * DAY);
    drop('b', 5n);
    r.t.tick(0);
    expect(r.t.summary(7).economy.currencies[0]!.faucet).toBe(5);
    expect(r.t.summary(30).economy.currencies[0]!.faucet).toBe(15);
  });
});

// ------------------------------------------------------------------ files
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'vgtd-telemetry-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('local storage', () => {
  it('FileEventLog appends one JSON line per event to the file of the event day and prunes raw files older than 90 days', () => {
    const dir = tmp();
    const log = new FileEventLog(dir);
    log.append('{"a":1}', T0);
    log.append('{"a":2}', T0);
    log.append('{"a":3}', T0 + DAY);
    log.flush();
    expect(readFileSync(join(dir, 'events-2026-11-09.jsonl'), 'utf8')).toBe('{"a":1}\n{"a":2}\n');
    expect(readFileSync(join(dir, 'events-2026-11-10.jsonl'), 'utf8')).toBe('{"a":3}\n');
    log.append('{"a":4}', T0 - 100 * DAY);
    log.flush();
    writeFileSync(join(dir, 'notes.txt'), 'keep');
    expect(log.prune(T0)).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['events-2026-11-09.jsonl', 'events-2026-11-10.jsonl', 'notes.txt']);
    expect(log.prune(T0 + 200 * DAY)).toBe(2);
  });

  it('openTelemetryFiles keeps the key (so pids and retention survive a restart) and the rollups, and writes the key owner-only', () => {
    const dir = tmp();
    const a = openTelemetryFiles(dir, { flushMs: -1 });
    const pid1 = new TelemetryService({ key: a.key, log: a.log, rollups: a.rollups, now: () => T0 }).pidOf('acc');
    const t1 = new TelemetryService({ key: a.key, log: a.log, rollups: a.rollups, now: () => T0 });
    t1.sessionStart('acc', 1);
    a.flush();
    expect(a.key).toMatch(/^[0-9a-f]{64}$/);
    const b = openTelemetryFiles(dir, { flushMs: -1 });
    expect(b.key).toBe(a.key);
    const t2 = new TelemetryService({ key: b.key, log: b.log, rollups: b.rollups, now: () => T0 + DAY });
    expect(t2.pidOf('acc')).toBe(pid1);
    t2.sessionStart('acc', 1); // the same player the next day: retention D1 sees them
    expect(t2.summary().retention.d1).toMatchObject({ cohort: 1, retained: 1 });
    expect(t2.summary().days.map((d) => d.dau)).toEqual([1, 1]);
    if (process.platform !== 'win32')
      expect(readFileSync(join(dir, 'telemetry', 'pid.key')).length).toBeGreaterThan(60);
  });

  it('refuses to start over a damaged key or an unreadable rollups document (history is never silently dropped)', () => {
    const dir = tmp();
    openTelemetryFiles(dir);
    writeFileSync(join(dir, 'telemetry', 'pid.key'), 'short\n');
    expect(() => openTelemetryFiles(dir)).toThrow(/pid\.key/);
    const dir2 = tmp();
    openTelemetryFiles(dir2);
    writeFileSync(join(dir2, 'telemetry', 'rollups.json'), JSON.stringify({ v: 99, days: {}, players: {} }));
    expect(() => openTelemetryFiles(dir2)).toThrow(/unsupported version/);
    expect(() => parseRollupDoc({ v: 1, days: { 'not-a-day': {} }, players: {} })).toThrow(/malformed day/);
    expect(existsSync(join(dir2, 'telemetry', 'pid.key'))).toBe(true);
  });
});

// ------------------------------------------------------------------ the WorldNode
class Fake implements ClientTransport {
  msgs: Message[] = [];
  send(d: Uint8Array): void {
    try {
      this.msgs.push(decode(d));
    } catch {
      /* not looked at */
    }
  }
  close(_c: ErrorCode, _t: string): void {}
  buffered(): number {
    return 0;
  }
}

describe('events from the WorldNode', () => {
  it('records session start / end around a player, with the end reason', () => {
    const r = rig();
    const n = new WorldNode({ mapTiles: 160, spawn: { i0: 78, j0: 78, side: 4 }, telemetry: r.t });
    const a = new Fake();
    const id = n.addPlayer(a, 'acc-a');
    n.tick();
    r.advance(30_000);
    n.removePlayer(id, a);
    const b = new Fake();
    const id2 = n.addPlayer(b, 'acc-b');
    r.advance(5_000);
    n.removePlayer(id2, undefined, 'kick');
    const names = r.events().map((e) => `${e.event_name}${e.attrs.reason ? ':' + e.attrs.reason : ''}`);
    expect(names).toEqual([
      'session.start',
      'character.create',
      'session.end:quit',
      'session.start',
      'character.create',
      'session.end:kick',
    ]);
    expect(r.events()[2]!.attrs.duration_s).toBe(30);
    expect(r.t.summary().days[0]).toMatchObject({ dau: 2, newPlayers: 2, sessions: 2 });
  });

  it('a node without telemetry runs unchanged', () => {
    const n = new WorldNode({ mapTiles: 160, spawn: { i0: 78, j0: 78, side: 4 } });
    const a = new Fake();
    const id = n.addPlayer(a, 'acc-a');
    n.tick();
    n.receive(id, encode({ type: 'ping', clientTimeMs: 1 }), a);
    n.removePlayer(id, a);
    expect(n.clients.size).toBe(0);
  });
});

// ------------------------------------------------------------------ dashboard over real HTTP
function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
const FAST = { N: 1024, r: 8, p: 1 };

describe('the KPI dashboard (HTTP)', () => {
  it('serves the page and the summary to loopback, with a CSP, no caching, and no player ids in the data', async () => {
    const telemetry = new TelemetryService({ key: KEY });
    const srv = await startServer({
      port: 0,
      auth: { scrypt: FAST, registerPerIpPerDay: 0 },
      world: { mapTiles: 64, spawn: { i0: 30, j0: 30, side: 4 }, telemetry },
    });
    try {
      // a real registration through the gateway feeds account.register
      const reg = await new Promise<number>((resolve, reject) => {
        const body = JSON.stringify({ username: 'dash_alice', password: 'Correct-Horse-9' });
        const req = request(
          {
            host: '127.0.0.1',
            port: srv.port,
            path: '/auth/register',
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end(body);
      });
      expect(reg).toBe(201);
      const page = await get(srv.port, '/dashboard');
      expect(page.status).toBe(200);
      expect(String(page.headers['content-type'])).toContain('text/html');
      expect(String(page.headers['content-security-policy'])).toContain("default-src 'none'");
      expect(page.headers['cache-control']).toBe('no-store');
      expect(page.body).toContain('/dashboard/summary.json');
      expect(page.body).not.toContain('innerHTML'); // everything is drawn with textContent
      const sum = await get(srv.port, '/dashboard/summary.json');
      expect(sum.status).toBe(200);
      const json = JSON.parse(sum.body) as ReturnType<TelemetryService['summary']>;
      expect(json).toMatchObject({ localOnly: true, schemaVersion: '1.0.0' });
      expect(Object.keys(json.retention)).toEqual(['d1', 'd7', 'd30']);
      expect(json.ftue.steps.map((s) => s.step)).toEqual([...TUTORIAL_STEPS]);
      expect(sum.body).not.toMatch(/[0-9a-f]{64}/); // no pseudonymous id, let alone an account id
      expect(telemetry.log instanceof MemoryEventLog && (telemetry.log as MemoryEventLog).lines.join('')).toContain(
        'account.register',
      );
      expect((await get(srv.port, '/dashboard/nope')).status).toBe(404);
    } finally {
      await srv.stop();
    }
  });

  it('refuses a proxied request (X-Forwarded-For) without a token, and with a token requires it exactly', async () => {
    const telemetry = new TelemetryService({ key: KEY });
    const open = await startServer({ port: 0, auth: { scrypt: FAST }, world: { mapTiles: 64, telemetry } });
    const locked = await startServer({
      port: 0,
      auth: { scrypt: FAST },
      world: { mapTiles: 64, telemetry },
      dashboardToken: 'sesame-1234',
    });
    try {
      expect((await get(open.port, '/dashboard/summary.json', { 'x-forwarded-for': '203.0.113.9' })).status).toBe(403);
      expect((await get(locked.port, '/dashboard/summary.json')).status).toBe(403); // loopback alone is not enough with a token
      expect((await get(locked.port, '/dashboard/summary.json', { authorization: 'Bearer wrong' })).status).toBe(403);
      expect((await get(locked.port, '/dashboard/summary.json', { authorization: 'Bearer sesame-12345' })).status).toBe(
        403,
      );
      expect((await get(locked.port, '/dashboard/summary.json', { authorization: 'Bearer sesame-1234' })).status).toBe(
        200,
      );
      expect((await get(locked.port, '/dashboard', { authorization: 'Bearer sesame-1234' })).status).toBe(200);
    } finally {
      await open.stop();
      await locked.stop();
    }
  });

  it('a server started without telemetry has no dashboard', async () => {
    const srv = await startServer({ port: 0, auth: { scrypt: FAST }, world: { mapTiles: 64 }, telemetry: false });
    try {
      expect((await get(srv.port, '/dashboard')).status).toBe(404);
    } finally {
      await srv.stop();
    }
  });

  it('dashboardAllowed: loopback only without a token, ignoring proxies', () => {
    const req = (addr: string, headers: Record<string, string> = {}) =>
      ({ socket: { remoteAddress: addr }, headers }) as never;
    expect(dashboardAllowed(req('127.0.0.1'), undefined)).toBe(true);
    expect(dashboardAllowed(req('::1'), undefined)).toBe(true);
    expect(dashboardAllowed(req('::ffff:127.0.0.1'), undefined)).toBe(true);
    expect(dashboardAllowed(req('192.168.1.5'), undefined)).toBe(false);
    expect(dashboardAllowed(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' }), undefined)).toBe(false);
    expect(dashboardAllowed(req('192.168.1.5', { authorization: 'Bearer t' }), 't')).toBe(true);
  });
});
