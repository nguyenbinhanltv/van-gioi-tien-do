import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CRASH_REPORT } from '@vgtd/shared';
import { CrashReporter } from '@vgtd/client-core/src/crash/CrashReporter.js'; // engine-free
import { CrashService, CrashStore, startServer, type CrashRecord, type RunningServer } from '../src/index.js';

const sid = (n: number): string => `sess${String(n).padStart(8, '0')}`;

describe('client reporter -> server', () => {
  it('the same error 3 times then end(): one top-crash group with occurrences = 3 (repeat counts keep the stack, so the fingerprint matches)', () => {
    const t = { n: 1_000_000 };
    const svc = new CrashService({ now: () => t.n });
    const r = new CrashReporter({
      build: 'b1',
      sid: sid(7),
      getScene: () => 'main',
      send: (json) => expect(svc.submit(JSON.parse(json), 'ip').status).toBe(202),
      now: () => t.n,
    });
    r.start();
    for (let i = 0; i < 3; i++) r.report('error', new Error('same'), 'Error: same\n    at a (http://h/m.js:1:1)', true);
    r.end();
    t.n += 1000;
    const top = svc.summary().top;
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ occurrences: 3, sessions: 1 });
  });

  it('every sent body fits the server cap even with long stacks (the server drops an oversized batch whole)', () => {
    const svc = new CrashService();
    const bodies: number[] = [];
    const r = new CrashReporter({
      build: 'b1',
      sid: sid(8),
      getScene: () => 'main',
      send: (json) => {
        bodies.push(new TextEncoder().encode(json).length);
        expect(svc.submit(JSON.parse(json), 'ip').status).toBe(202);
      },
    });
    r.start();
    for (let i = 0; i < 4; i++)
      r.report(
        'console',
        `error number ${i} `.repeat(20),
        `Error\n${'    at f (http://h/x.js:1:1)\n'.repeat(120)}`,
        false,
      );
    // 4-byte characters: a 3000-char stack is ~12 KB on the wire, so it has to be shrunk to fit
    r.report('error', 'fatal \u{1F4A5}', '\u{1F4A5}'.repeat(1500), true);
    r.end();
    expect(Math.max(...bodies)).toBeLessThanOrEqual(CRASH_REPORT.MAX_BODY_BYTES);
    expect(bodies.length).toBeGreaterThan(2); // really split
    expect(svc.summary().crashedSessions).toBe(1);
    expect(svc.store.read(0).some((e) => e.kind === 'session_end')).toBe(true);
  });
});

describe('crash store bounds', () => {
  const rec = (recvMs: number, message = ''): CrashRecord => ({
    kind: 'error',
    atMs: 0,
    recvMs,
    sid: sid(1),
    build: 'b',
    scene: 's',
    source: 'error',
    message,
  });

  it('memory mode keeps only the newest records', () => {
    const s = new CrashStore();
    s.append(Array.from({ length: CRASH_REPORT.SERVER_MAX_MEM_RECORDS + 5 }, (_, i) => rec(i)));
    const all = s.read(0);
    expect(all).toHaveLength(CRASH_REPORT.SERVER_MAX_MEM_RECORDS);
    expect(all[0]!.recvMs).toBe(5);
  });

  it('file mode: daily byte budget drops (and counts) whole batches, retention deletes old days, the summary is cached', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-crash-b-'));
    try {
      const day = (d: number): number => Date.UTC(2026, 10, d, 12);
      const big = 'x'.repeat(CRASH_REPORT.MAX_MESSAGE_CHARS);
      const s = new CrashStore(dir);
      s.append([rec(day(1), big)]);
      expect(readdirSync(dir)).toEqual(['crash-2026-11-01.jsonl']);
      s.append([rec(day(30), big)]); // 29 days later: the first file is past the 14-day retention
      expect(readdirSync(dir)).toEqual(['crash-2026-11-30.jsonl']);

      const per = JSON.stringify(rec(day(30), big)).length + 1;
      const fit = Math.floor(CRASH_REPORT.SERVER_MAX_BYTES_PER_DAY / per);
      for (let i = 0; i < fit + 100; i += 50)
        s.append(Array.from({ length: 50 }, (_, k) => rec(day(30), big + (i + k))));
      expect(s.dropped).toBeGreaterThan(0);
      const size = statSync(join(dir, 'crash-2026-11-30.jsonl')).size;
      expect(size).toBeLessThanOrEqual(CRASH_REPORT.SERVER_MAX_BYTES_PER_DAY);

      // a restarted store learns the day's size from the file: the budget survives a restart
      const s2 = new CrashStore(dir);
      s2.append(Array.from({ length: 50 }, (_, k) => rec(day(30), big + (999_000 + k))));
      expect(s2.dropped).toBe(50);

      let t = day(30);
      const svc = new CrashService({ dir, now: () => t });
      const a = svc.summary();
      expect(svc.summary()).toBe(a); // cached
      t += CRASH_REPORT.SERVER_SUMMARY_CACHE_MS + 1;
      expect(svc.summary()).not.toBe(a);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('operator page', () => {
  let srv: RunningServer;
  const url = (p: string): string => `http://127.0.0.1:${srv.port}${p}`;
  beforeAll(async () => {
    srv = await startServer({ port: 0, autoTick: false, world: { mapTiles: 64 } });
  });
  afterAll(async () => {
    await srv.stop();
  });

  it('the page asks for its data with an absolute path that resolves to the JSON endpoint (200)', async () => {
    srv.crash!.submit(
      { v: 1, sid: sid(3), build: 'b', scene: 'main', events: [{ kind: 'session_start', atMs: 0 }] },
      'ip',
    );
    const html = await (await fetch(url('/ops/crash'))).text();
    const m = /fetch\('([^']+)'/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]!.startsWith('/')).toBe(true);
    const data = await fetch(new URL(m![1]!, url('/ops/crash')));
    expect(data.status).toBe(200);
    expect(((await data.json()) as { sessions: number }).sessions).toBe(1);
  });
});
