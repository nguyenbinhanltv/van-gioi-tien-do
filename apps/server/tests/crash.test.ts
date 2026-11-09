import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CRASH_REPORT, type CrashBatch, type CrashEvent } from '@vgtd/shared';
import { CrashService, rollupCrashes, startServer, type RunningServer } from '../src/index.js';

const sid = (n: number): string => `sess${String(n).padStart(8, '0')}`;
const err = (message: string, o: Partial<CrashEvent> = {}): CrashEvent => ({
  kind: 'error',
  atMs: 1000,
  source: 'error',
  message,
  stack: `Error: ${message}\n    at tick (http://h/main.js:10:5)\n    at run (http://h/main.js:20:7)`,
  fatal: true,
  ...o,
});
const batch = (n: number, events: CrashEvent[], build = 'b1'): CrashBatch => ({
  v: CRASH_REPORT.VERSION,
  sid: sid(n),
  build,
  scene: 'main',
  events,
});
const start = (): CrashEvent => ({ kind: 'session_start', atMs: 0 });
const end = (): CrashEvent => ({ kind: 'session_end', atMs: 5000 });

describe('CrashService', () => {
  it('computes crash-free sessions % and the top crash list', () => {
    let t = 1_000_000;
    const svc = new CrashService({ now: () => t });
    // 10 sessions: 8 clean, 1 crashed (same fatal twice -> one group), 1 crashed with another error + a non-fatal console error
    for (let i = 0; i < 8; i++) svc.submit(batch(i, [start(), end()]), 'ip' + i);
    svc.submit(batch(8, [start(), err('boom 12')]), 'ip8');
    svc.submit(batch(9, [start(), err('other', { source: 'unhandledrejection' })]), 'ip9');
    svc.submit(batch(1, [err('console noise', { source: 'console', fatal: false })]), 'ip1');
    svc.submit(batch(3, [err('boom 99')]), 'ip3'); // same fingerprint as 'boom 12' (digits are normalised), fatal for session 3
    t += 1000;
    const r = svc.summary();
    expect(r.sessions).toBe(10);
    expect(r.crashedSessions).toBe(3);
    expect(r.crashFreePct).toBe(70);
    expect(r.top[0]!.message).toMatch(/^boom/);
    expect(r.top[0]!.sessions).toBe(2);
    expect(r.top.map((x) => x.source)).toContain('console');
    expect(r.byBuild).toEqual([{ build: 'b1', sessions: 10, crashed: 3, crashFreePct: 70 }]);
  });

  it('is 100% with no sessions and counts an idle session without an end marker as abandoned, not crashed', () => {
    let t = 5_000_000;
    const svc = new CrashService({ now: () => t });
    expect(svc.summary().crashFreePct).toBe(100);
    svc.submit(batch(1, [start()]), 'a');
    expect(svc.summary().liveSessions).toBe(1);
    t += CRASH_REPORT.SESSION_IDLE_MS + 1;
    const r = svc.summary();
    expect(r.abandonedSessions).toBe(1);
    expect(r.crashFreePct).toBe(100);
  });

  it('rejects invalid bodies and never stores unknown fields, usernames or query strings', () => {
    const svc = new CrashService();
    expect(svc.submit({ v: 2 }, 'x').status).toBe(400);
    expect(svc.submit(batch(1, []), 'x').status).toBe(400);
    expect(svc.submit({ ...batch(1, [start()]), sid: 'bad sid' }, 'x').status).toBe(400);
    const dirty = err('fail for bob@example.com at http://h/p?token=abcdef0123456789abcdef', {
      stack: 'Error\n    at f (C:\\Users\\bob\\game\\a.js:1:1)',
    });
    (dirty as unknown as Record<string, unknown>).chatText = 'hello';
    const bad = { ...batch(2, [start(), dirty]), username: 'bob' };
    expect(svc.submit(bad, 'x').status).toBe(202);
    const text = JSON.stringify(svc.store.read(0));
    expect(text).not.toMatch(/bob|token=|chatText|username|example\.com/);
    expect(text).toContain('<email>');
  });

  it('rate limits per IP, per session and globally, and counts the drops', () => {
    let t = 1_000_000;
    const svc = new CrashService({ now: () => t });
    let limited = 0;
    for (let i = 0; i < CRASH_REPORT.SERVER_REQUESTS_PER_IP_PER_MIN + 5; i++)
      if (svc.submit(batch(100 + i, [start()]), 'same-ip').status === 429) limited++;
    expect(limited).toBe(5);
    t += 61_000;
    expect(svc.submit(batch(500, [start()]), 'same-ip').status).toBe(202); // window rolled

    // per session cap
    let ok = 0;
    for (let i = 0; i < 30; i++) if (svc.submit(batch(600, [err('a'), err('b')]), 'ip' + i).status === 202) ok++;
    expect(ok).toBe(CRASH_REPORT.SERVER_EVENTS_PER_SESSION / 2);
    expect(svc.counters.rateLimited).toBe(5 + 30 - ok);
  });

  it('persists daily JSONL files and a restart reads them back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-crash-'));
    try {
      const t = Date.UTC(2026, 10, 9, 12);
      const a = new CrashService({ dir, now: () => t });
      a.submit(batch(1, [start(), err('x')]), 'ip');
      const files = readdirSync(dir);
      expect(files).toEqual(['crash-2026-11-09.jsonl']);
      const lines = readFileSync(join(dir, files[0]!), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).not.toMatch(/ip/);
      const b = new CrashService({ dir, now: () => t + 60_000 });
      expect(b.summary().crashedSessions).toBe(1);
      expect(rollupCrashes(b.store.read(0), t + 60_000, 86_400_000).top).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('POST /crash/report (HTTP)', () => {
  let srv: RunningServer;
  const url = (p: string): string => `http://127.0.0.1:${srv.port}${p}`;
  beforeAll(async () => {
    srv = await startServer({ port: 0, autoTick: false, world: { mapTiles: 64 } });
  });
  afterAll(async () => {
    await srv.stop();
  });

  it('accepts a batch (also as text/plain, the sendBeacon content type) and shows it on the operator view', async () => {
    const r = await fetch(url('/crash/report'), {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(batch(1, [start(), err('http boom')])),
    });
    expect(r.status).toBe(202);
    const s = (await (await fetch(url('/ops/crash/summary.json'))).json()) as { sessions: number; top: unknown[] };
    expect(s.sessions).toBe(1);
    expect(s.top).toHaveLength(1);
    const page = await fetch(url('/ops/crash'));
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('refuses oversized, malformed and non-operator requests', async () => {
    const big = await fetch(url('/crash/report'), {
      method: 'POST',
      body: JSON.stringify(batch(2, [err('x'.repeat(CRASH_REPORT.MAX_BODY_BYTES))])),
    });
    expect(big.status).toBe(413);
    const bad = await fetch(url('/crash/report'), { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    const proxied = await fetch(url('/ops/crash/summary.json'), { headers: { 'x-forwarded-for': '1.2.3.4' } });
    expect(proxied.status).toBe(403);
  });

  it('accepts the Bearer token for the operator view', async () => {
    const s2 = await startServer({
      port: 0,
      autoTick: false,
      world: { mapTiles: 64 },
      gateway: { dashboardToken: 'secret-token-1' },
    });
    try {
      const u = `http://127.0.0.1:${s2.port}/ops/crash/summary.json`;
      const h = { 'x-forwarded-for': '9.9.9.9' };
      expect((await fetch(u, { headers: h })).status).toBe(403);
      expect((await fetch(u, { headers: { ...h, authorization: 'Bearer wrong-token-xx' } })).status).toBe(403);
      expect((await fetch(u, { headers: { ...h, authorization: 'Bearer secret-token-1' } })).status).toBe(200);
    } finally {
      await s2.stop();
    }
  });
});
