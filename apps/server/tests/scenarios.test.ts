/**
 * Building blocks of the P2 exit scenarios (src/loadtest/scenarios.ts), exercised in-process and kept short:
 * the impairment proxy, the flyer / cooldown-hack bot kinds and the real-netcode bot through the S6 impairment.
 */
import { createConnection, createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FLY_SPEED, compileSkills } from '@vgtd/sim';
import { startServer, type RunningServer } from '../src/index.js';
import { Bot } from '../src/loadtest/bot.js';
import { S6_IMPAIRMENT, startImpairProxy } from '../src/loadtest/impair.js';
import { PredictBot } from '../src/loadtest/predict-bot.js';
import { LOADTEST_PASSWORD } from '../src/loadtest/bot.js';

const FAST = { N: 1024, r: 8, p: 1 };
const MAP = 256;
const skills = compileSkills();
let srv: RunningServer;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { mapTiles: MAP, spawn: { i0: 100, j0: 100, side: 56 }, skills },
  });
});
afterAll(async () => {
  await srv.stop();
});

describe('impairment proxy', () => {
  it('keeps byte order under jitter and loss stalls, and really delays delivery', async () => {
    // a server that sends 200 numbered 4-byte chunks, one every 5 ms
    const received: number[] = [];
    let firstAt = 0;
    let t0 = 0;
    const origin: Server = createServer((sock) => {
      let n = 0;
      t0 = performance.now();
      const timer = setInterval(() => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(n++);
        sock.write(b);
        if (n >= 200) {
          clearInterval(timer);
          sock.end();
        }
      }, 5);
    });
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r));
    const originPort = (origin.address() as { port: number }).port;
    const proxy = await startImpairProxy('127.0.0.1', originPort, S6_IMPAIRMENT, 11);
    await new Promise<void>((resolve) => {
      const c = createConnection({ host: '127.0.0.1', port: proxy.port });
      let buf = Buffer.alloc(0);
      c.on('data', (d) => {
        if (!firstAt) firstAt = performance.now();
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 4) {
          received.push(buf.readUInt32BE(0));
          buf = buf.subarray(4);
        }
      });
      c.on('close', () => resolve());
    });
    await proxy.close();
    origin.close();
    expect(received).toHaveLength(200);
    expect(received).toEqual(Array.from({ length: 200 }, (_, k) => k)); // strictly in order, nothing lost
    expect(firstAt - t0).toBeGreaterThan(S6_IMPAIRMENT.delayMs - S6_IMPAIRMENT.jitterMs - 10);
    expect(proxy.stats.stalled).toBeGreaterThan(0); // the 5 % loss model fired
    expect(proxy.stats.chunks).toBeGreaterThan(100);
  }, 30_000);
});

describe('bot kinds', () => {
  it('a flyer toggles flight, reaches FLY_SPEED and is never kicked (no anti-cheat false positive)', async () => {
    const bot = new Bot({
      host: '127.0.0.1',
      port: srv.port,
      name: 'flyer1',
      kind: 'flyer',
      area: { i0: 40, j0: 40, side: 170 },
      seed: 3,
    });
    await bot.connect();
    bot.startInputs();
    bot.startMeasuring();
    await sleep(5000);
    bot.stop();
    expect(bot.report.kicked).toBe(false);
    expect(bot.report.closedUnexpectedly).toBe(false);
    expect(bot.report.maxSpeedTilesPerS).toBeGreaterThan(0.75 * FLY_SPEED);
    expect(bot.report.maxSpeedTilesPerS).toBeLessThanOrEqual(1.05 * FLY_SPEED + 0.5);
    expect(srv.world.metrics.violations.distance ?? 0).toBe(0);
  }, 30_000);

  it('a cooldown-hack bot is capped (accepted casts within the cooldown bound) or kicked; an honest bot is unaffected', async () => {
    const mk = (name: string, kind: 'honest' | 'cooldown'): Bot =>
      new Bot({
        host: '127.0.0.1',
        port: srv.port,
        name,
        kind,
        area: { i0: 100, j0: 100, side: 56 },
        skillCount: skills.length,
        seed: 9,
      });
    const cheat = mk('cdhack1', 'cooldown');
    const honest = mk('cdhonest1', 'honest');
    await Promise.all([cheat.connect(), honest.connect()]);
    cheat.startInputs();
    honest.startInputs();
    cheat.startMeasuring();
    honest.startMeasuring();
    await sleep(5000);
    cheat.stop();
    honest.stop();
    const s0 = skills[0]!;
    const per = Math.max(s0.cooldownMs, s0.gcdMs, 1);
    const activeMs = cheat.report.kickedAfterMs ?? 5000;
    const bound = Math.ceil((activeMs / per) * 1.25) + 2;
    expect(cheat.report.castOk).toBeLessThanOrEqual(bound);
    expect(cheat.report.kicked || cheat.report.castRejected > 0).toBe(true);
    expect(honest.report.kicked).toBe(false);
    expect(honest.report.closedUnexpectedly).toBe(false);
  }, 30_000);
});

describe('real client netcode through the S6 impairment', () => {
  it('stays online and its replay error stays at zero under 400 ms RTT, jitter and loss stalls', async () => {
    const proxy = await startImpairProxy('127.0.0.1', srv.port, S6_IMPAIRMENT, 5);
    const bot = new PredictBot({
      host: '127.0.0.1',
      port: proxy.port,
      name: 'pbot1',
      password: LOADTEST_PASSWORD,
      mapTiles: MAP,
      area: { i0: 100, j0: 100, side: 56 },
      seed: 4,
    });
    await bot.connect();
    bot.start();
    await sleep(1500);
    bot.startMeasuring();
    await sleep(6000);
    const r = bot.report();
    bot.stop();
    await proxy.close();
    expect(r.status).toBe('online');
    expect(r.errorTiles.n).toBeGreaterThan(50);
    expect(r.errorTiles.max).toBeLessThan(0.01); // the client replays unacked inputs exactly like the server applies them
    expect(r.errorsOverSnap).toBe(0);
  }, 40_000);
});
