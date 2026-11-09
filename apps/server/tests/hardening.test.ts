/**
 * Input hardening (D101): per-class message budgets, strike windows, the security log, and what an honest (laggy) client is allowed.
 * The WorldNode is driven directly with an injected packet clock so no test depends on real time.
 */
import { describe, expect, it } from 'vitest';
import { ErrorCode, decode, encode, type Message } from '@vgtd/protocol';
import {
  ConnectionGuard,
  SECURITY_CONFIG,
  WorldNode,
  budgetClassOf,
  type ClientTransport,
  type SecurityEvent,
} from '../src/index.js';

class Tr implements ClientTransport {
  msgs: Message[] = [];
  closed: { code: ErrorCode; text: string } | null = null;
  send(d: Uint8Array): void {
    try {
      this.msgs.push(decode(d, { baseline: () => ({ qi: 0, qj: 0 }) }));
    } catch {
      /* snapshots with deltas are not needed here */
    }
  }
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return 0;
  }
  errors(): string[] {
    return this.msgs.filter((m) => m.type === 'error').map((m) => (m as { text: string }).text);
  }
}

function rig(): { n: WorldNode; clock: { ms: number }; log: SecurityEvent[]; join: () => { id: number; t: Tr } } {
  const clock = { ms: 1_000_000 };
  const log: SecurityEvent[] = [];
  const n = new WorldNode({
    mapTiles: 96,
    spawn: { i0: 30, j0: 30, side: 20 },
    packetClock: () => clock.ms,
    securityLog: (e) => log.push(e),
  });
  const join = (): { id: number; t: Tr } => {
    const t = new Tr();
    const id = n.addPlayer(t, `acct-secret-${n.clients.size}`, undefined, `Name_${n.clients.size}`);
    return { id, t };
  };
  return { n, clock, log, join };
}
const ping = (k: number): Uint8Array => encode({ type: 'ping', clientTimeMs: k });
const cast = (seq: number): Uint8Array => encode({ type: 'skill_cast', seq, skillId: 1, targetId: 0, aim: null });
const input = (seq: number): Uint8Array =>
  encode({ type: 'input', ack: 0, inputs: [{ seq, dtMs: 50, dir: 0, mag: 0, flags: 0 }] });

describe('ConnectionGuard', () => {
  it('a bucket allows its burst, refills at the configured rate, and counts what it drops', () => {
    const g = new ConnectionGuard();
    const { burst, perS } = SECURITY_CONFIG.BUDGETS.ping;
    let t = 0;
    for (let k = 0; k < burst; k++) expect(g.take('ping', t)).toBe(true);
    expect(g.take('ping', t)).toBe(false);
    expect(g.dropped.ping).toBe(1);
    t += 1000 / perS; // exactly one token back
    expect(g.take('ping', t)).toBe(true);
    expect(g.take('ping', t)).toBe(false);
    t += 60_000; // never above the burst after a long quiet spell
    let n = 0;
    while (g.take('ping', t)) n++;
    expect(n).toBe(burst);
  });

  it('strikes age out of their window; a sustained run kicks', () => {
    const g = new ConnectionGuard();
    let t = 0;
    for (let k = 0; k < SECURITY_CONFIG.MALFORMED_MAX - 1; k++) expect(g.strikeMalformed(t)).toBe(false);
    t += SECURITY_CONFIG.MALFORMED_WINDOW_MS; // an honest bug a while ago is forgiven
    for (let k = 0; k < SECURITY_CONFIG.MALFORMED_MAX - 1; k++) expect(g.strikeMalformed(t)).toBe(false);
    expect(g.strikeMalformed(t)).toBe(true);
  });

  it('log lines and error replies are throttled per key', () => {
    const g = new ConnectionGuard();
    expect(g.due('a', 0)).toBe(true);
    expect(g.due('a', 1)).toBe(false);
    expect(g.due('b', 1)).toBe(true);
    expect(g.due('a', SECURITY_CONFIG.LOG_THROTTLE_MS)).toBe(true);
  });

  it('every client message type has a budget class, server-direction types have none', () => {
    const client = [
      'input',
      'skill_cast',
      'ping',
      'chat_send',
      'party_cmd',
      'inv_cmd',
      'sect_cmd',
      'friend_cmd',
      'market_search',
      'market_list',
      'market_buy',
      'market_cancel',
      'trade_cmd',
      'meditate_start',
      'meditate_stop',
      'breakthrough_start',
    ];
    for (const t of client) expect(budgetClassOf(t), t).not.toBeNull();
    const server = [
      'snapshot',
      'aoi_enter',
      'aoi_leave',
      'skill_result',
      'pong',
      'error',
      'status_update',
      'boss_phase',
      'market_results',
      'market_result',
      'market_notice',
    ];
    for (const t of server) expect(budgetClassOf(t), t).toBeNull();
  });
});

describe('World Node message budgets', () => {
  it('an honest client at 20 Hz input + a slow ping is never dropped, even over a long session', () => {
    const { n, clock, join } = rig();
    const a = join();
    for (let k = 0; k < 20 * 120; k++) {
      clock.ms += 50;
      n.receive(a.id, input(k & 0xffff));
      if (k % 20 === 0) n.receive(a.id, ping(k));
      if (k % 7 === 0) n.receive(a.id, cast(k & 0xffff));
    }
    expect(n.metrics.budgetDrops).toBe(0);
    expect(a.t.closed).toBeNull();
  });

  it('a stalled tab that resumes with a backlog (a burst of ~1.5 s of inputs) is not penalised', () => {
    const { n, join } = rig();
    const a = join();
    for (let k = 0; k < 30; k++) n.receive(a.id, input(k)); // back to back, no time passing
    expect(n.metrics.budgetDrops).toBe(0);
    expect(a.t.closed).toBeNull();
  });

  it('a short burst over a budget drops frames and answers once, without a kick', () => {
    const { n, clock, log, join } = rig();
    const a = join();
    const burst = SECURITY_CONFIG.BUDGETS.cast.burst;
    for (let k = 0; k < burst + 10; k++) n.receive(a.id, cast(k));
    expect(n.metrics.budgetDrops).toBe(10);
    expect(a.t.closed).toBeNull();
    expect(a.t.errors().filter((t) => t === 'message rate limit')).toHaveLength(1); // not one reply per dropped frame
    expect(log.filter((e) => e.ev === 'budget_drop')).toHaveLength(1);
    clock.ms += 2000; // the bucket refills: casting works again
    const before = n.metrics.budgetDrops;
    n.receive(a.id, cast(99));
    expect(n.metrics.budgetDrops).toBe(before);
  });

  it('a sustained flood of one class is kicked, and the kick is logged', () => {
    const { n, clock, log, join } = rig();
    const a = join();
    for (let k = 0; k < 400 && !a.t.closed; k++) {
      n.receive(a.id, ping(k));
      clock.ms += 20; // 50 pings/s: under the global packet limit, far over the ping budget
    }
    expect(a.t.closed?.code).toBe(ErrorCode.RateLimited);
    expect(n.metrics.kicksFlood).toBe(1);
    expect(log.some((e) => e.ev === 'kick')).toBe(true);
  });

  it('floods of one connection never touch another', () => {
    const { n, clock, join } = rig();
    const bad = join();
    const good = join();
    for (let k = 0; k < 300 && !bad.t.closed; k++) n.receive(bad.id, cast(k));
    clock.ms += 50;
    n.receive(good.id, ping(7));
    expect(bad.t.closed).not.toBeNull();
    expect(good.t.closed).toBeNull();
    expect(good.t.msgs.some((m) => m.type === 'pong')).toBe(true);
  });
});

describe('malformed and out-of-direction frames', () => {
  it('server-direction messages sent by a client are rejected and counted like malformed ones', () => {
    const { n, join } = rig();
    const a = join();
    const frame = encode({ type: 'pong', clientTimeMs: 1, serverTimeMs: 2 });
    for (let k = 0; k < SECURITY_CONFIG.MALFORMED_MAX; k++) n.receive(a.id, frame);
    expect(a.t.errors()).toContain('unexpected message');
    expect(a.t.closed?.code).toBe(ErrorCode.BadMessage);
  });

  it('a few honest-bug frames spread over time never kick (the strikes age out)', () => {
    const { n, clock, join } = rig();
    const a = join();
    for (let k = 0; k < 40; k++) {
      n.receive(a.id, new Uint8Array([9, 9, 9]));
      clock.ms += SECURITY_CONFIG.MALFORMED_WINDOW_MS / (SECURITY_CONFIG.MALFORMED_MAX - 2);
    }
    expect(a.t.closed).toBeNull();
    expect(a.t.msgs.filter((m) => m.type === 'error').length).toBe(40); // each one is still answered
  });

  it('an unexpected message counts toward the kick (it used to be counted but never kicked)', () => {
    const { n, join } = rig();
    const a = join(); // no progression module: meditate is unexpected
    const m = encode({ type: 'meditate_start', requestId: 'a'.repeat(32) });
    for (let k = 0; k < SECURITY_CONFIG.MALFORMED_MAX; k++) n.receive(a.id, m);
    expect(a.t.closed?.code).toBe(ErrorCode.BadMessage);
  });
});

describe('security log', () => {
  it('events carry the numeric entity, a fixed reason and counters only: no account, name, address or payload', () => {
    const { n, log, join } = rig();
    const a = join();
    for (let k = 0; k < SECURITY_CONFIG.MALFORMED_MAX; k++) n.receive(a.id, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    const b = join();
    for (let k = 0; k < 100 && !b.t.closed; k++) n.receive(b.id, cast(k));
    const text = JSON.stringify(log);
    expect(log.map((e) => e.ev)).toEqual(expect.arrayContaining(['bad_frame', 'kick', 'budget_drop']));
    expect(text).not.toMatch(/acct-secret|Name_|deadbeef|222,173|127\.0|token/i);
    for (const e of log) {
      expect(Object.keys(e).sort()).toEqual(expect.arrayContaining(['ev', 'tick', 'entity', 'reason']));
      expect(typeof e.entity).toBe('number');
      for (const v of Object.values(e.detail ?? {})) expect(typeof v).toBe('number');
    }
    expect(n.metrics.securityEvents).toBe(log.length);
  });

  it('a throwing sink never takes the world down', () => {
    const n = new WorldNode({
      mapTiles: 96,
      spawn: { i0: 30, j0: 30, side: 20 },
      securityLog: () => {
        throw new Error('sink down');
      },
    });
    const t = new Tr();
    const id = n.addPlayer(t, 'x');
    for (let k = 0; k < 10; k++) n.receive(id, new Uint8Array([1]));
    expect(t.closed?.code).toBe(ErrorCode.BadMessage);
    n.tick();
  });
});
