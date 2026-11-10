import { describe, expect, it } from 'vitest';
import { CRASH_REPORT, validateCrashBatch, type CrashBatch } from '@vgtd/shared';
import { CrashReporter, installCrashHooks, type CrashHookTarget } from '../src/index.js';

function setup(): { r: CrashReporter; sent: CrashBatch[]; finals: boolean[]; clock: { t: number } } {
  const sent: CrashBatch[] = [];
  const finals: boolean[] = [];
  const clock = { t: 10_000 };
  const r = new CrashReporter({
    build: 'test-build',
    sid: 'abcd1234efgh',
    getScene: () => 'main',
    getClass: () => 'kiem_tu',
    send: (json, final) => {
      const v = validateCrashBatch(JSON.parse(json)); // everything the client sends must pass the server validator
      expect(v.ok).toBe(true);
      sent.push((v as { batch: CrashBatch }).batch);
      finals.push(final);
    },
    now: () => clock.t,
  });
  return { r, sent, finals, clock };
}

describe('CrashReporter', () => {
  it('sends start and end markers and flags a fatal error', () => {
    const { r, sent, finals, clock } = setup();
    r.start();
    clock.t += 5000;
    r.report('error', new Error('kaboom'), 'Error: kaboom\n    at f (http://h/a.js:1:2)', true);
    clock.t += 5000;
    r.end();
    r.end(); // idempotent
    const kinds = sent.flatMap((b) => b.events.map((e) => e.kind));
    expect(kinds).toEqual(['session_start', 'error', 'session_end']);
    expect(sent[0]!.class).toBe('kiem_tu');
    expect(sent[1]!.events[0]).toMatchObject({ fatal: true, source: 'error', message: 'kaboom' });
    expect(finals).toEqual([false, false, true]); // only the end marker is "final"
    expect(r.crashed).toBe(true);
  });

  it('dedupes by fingerprint, flushes repeat counts with the end marker and caps distinct reports', () => {
    const { r, sent, clock } = setup();
    r.start();
    for (let i = 0; i < 50; i++) {
      clock.t += 10;
      r.report('console', `tick ${i} failed`, undefined, false); // digits are normalised: one fingerprint
    }
    r.end();
    const errors = sent.flatMap((b) => b.events).filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(2); // the first occurrence + one summary with the other 49
    expect(errors[1]!.count).toBe(49);

    const s2 = setup();
    s2.r.start();
    for (let i = 0; i < 100; i++) s2.r.report('console', `distinct error ${'x'.repeat(i)}`, undefined, false);
    expect(s2.r.stats.reported).toBe(CRASH_REPORT.CLIENT_MAX_REPORTS_PER_SESSION);
    expect(s2.r.stats.droppedOverCap).toBe(100 - CRASH_REPORT.CLIENT_MAX_REPORTS_PER_SESSION);
  });

  it('spaces non-fatal batches by the send gap but never delays a fatal error', () => {
    const { r, sent, clock } = setup();
    r.start();
    clock.t += 100;
    r.report('console', 'first', undefined, false); // within the gap: queued
    expect(sent).toHaveLength(1);
    r.report('error', 'fatal one', undefined, true); // bypasses the gap and carries the queued one too
    expect(sent).toHaveLength(2);
    expect(sent[1]!.events.map((e) => e.message)).toEqual(['first', 'fatal one']);
  });

  it('scrubs PII: query strings, e-mail, long ids, user names in paths', () => {
    const { r, sent } = setup();
    r.start();
    r.report(
      'error',
      'bad for me@x.io http://h/a?token=0123456789abcdef0123',
      'Error\n    at f (C:\\Users\\Alice\\p\\a.js:1:1)\n    at g (http://h/b.js?v=secret:2:2)',
      true,
    );
    const text = JSON.stringify(sent);
    expect(text).not.toMatch(/me@x\.io|token=|Alice|secret/);
  });

  it('hooks: window error / unhandledrejection are fatal, console.error is not, pagehide ends the session', () => {
    const { r, sent } = setup();
    const handlers = new Map<string, (ev: never) => void>();
    const win: CrashHookTarget = {
      addEventListener: (t, f) => void handlers.set(t, f),
      removeEventListener: (t) => void handlers.delete(t),
    };
    const logged: unknown[][] = [];
    const con = { error: (...a: unknown[]) => void logged.push(a) };
    const off = installCrashHooks(r, win, con);
    r.start();
    const fire = (t: string, ev: unknown): void => handlers.get(t)!(ev as never);
    con.error('engine says no', 42);
    expect(logged).toHaveLength(1); // original console.error still runs
    fire('error', {}); // resource load failure: ignored
    fire('error', { message: 'uncaught', error: new Error('uncaught') });
    fire('unhandledrejection', { reason: new Error('rejected') });
    fire('pagehide', {});
    const errs = sent.flatMap((b) => b.events).filter((e) => e.kind === 'error');
    expect(errs.map((e) => [e.source, e.fatal])).toEqual([
      ['console', false],
      ['error', true],
      ['unhandledrejection', true],
    ]);
    expect(sent.at(-1)!.events.at(-1)!.kind).toBe('session_end');
    off();
    expect(handlers.size).toBe(0);
  });

  it('a throwing sender never breaks the page', () => {
    const r = new CrashReporter({
      build: 'b',
      sid: 'abcd1234efgh',
      getScene: () => 'main',
      send: () => {
        throw new Error('offline');
      },
    });
    expect(() => {
      r.start();
      r.report('error', 'x', undefined, true);
      r.end();
    }).not.toThrow();
  });
});
