/** The P5 gameplay bot: real NetClient bots against the real gateway + world node, a few seconds, a few bots. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATHS } from '@vgtd/shared';
import { compileSkills } from '@vgtd/sim';
import { GameBot, REALISTIC, pathOfBot, socialPaced } from '../src/loadtest/game-bot.js';
import { InventoryService, startServer, type RunningServer } from '../src/index.js';

const FAST = { N: 1024, r: 8, p: 1 };
let srv: RunningServer;

beforeAll(async () => {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: {
      seed: 5,
      mapTiles: 128,
      spawn: { i0: 48, j0: 48, side: 32 },
      skills: compileSkills(),
      mobs: { zones: [{ zone: 'bia_rung', i0: 40, j0: 40, i1: 72, j1: 72 }], density: 0.6 },
      combat: {},
      inventory: new InventoryService(),
    },
  });
});
afterAll(async () => {
  await srv.stop();
});

describe('socialPaced / pathOfBot', () => {
  it('divides only the social cadence and gives every class in turn', () => {
    const p = socialPaced(0.1);
    expect(p.chatEveryMs).toEqual([REALISTIC.chatEveryMs[0] * 0.1, REALISTIC.chatEveryMs[1] * 0.1]);
    expect(p.huntMaxMs).toBe(REALISTIC.huntMaxMs);
    expect(p.weights).toEqual(REALISTIC.weights);
    expect(Array.from({ length: 12 }, (_, n) => pathOfBot(n))).toEqual([...PATHS, ...PATHS]);
  });
});

describe('GameBot', () => {
  it('logs in with its class, walks, hunts and casts, chats and invites to a party, and stays online', async () => {
    const roster = ['gb_a', 'gb_b', 'gb_c', 'gb_d'];
    const bots = roster.map(
      (name, n) =>
        new GameBot({
          baseUrl: `http://127.0.0.1:${srv.port}`,
          name,
          path: pathOfBot(n),
          seed: 11 + n,
          area: { i0: 48, j0: 48, side: 32 },
          roster,
          profile: { ...socialPaced(0.02), weights: { hunt: 90, wander: 10, idle: 0, meditate: 0 } },
        }),
    );
    await Promise.all(bots.map((b) => b.connect()));
    const t0 = performance.now();
    let last = t0;
    const timer = setInterval(() => {
      const now = performance.now();
      for (const b of bots) b.update(now - t0, now - last);
      last = now;
    }, 33);
    await new Promise((r) => setTimeout(r, 9000));
    clearInterval(timer);
    const st = bots.map((b) => b.stats);
    for (const b of bots) b.close();
    for (const s of st) {
      expect(s.status, s.name).toBe('online');
      expect(s.ended, s.name).toBe(false);
      expect(s.entityId, s.name).toBeGreaterThan(0);
      expect(s.snapshots, s.name).toBeGreaterThan(50);
    }
    // each class is the one asked for at creation (D82), and the server kept it
    for (let n = 0; n < bots.length; n++) expect(bots[n]!.net.classId).toBe(n + 1);
    const sum = (k: 'casts' | 'castsAccepted' | 'chatSent' | 'chatDelivered' | 'partyInvitesSent' | 'walked') =>
      st.reduce((a, s) => a + s[k], 0);
    expect(sum('walked')).toBeGreaterThan(5);
    expect(sum('casts')).toBeGreaterThan(0);
    expect(sum('castsAccepted')).toBeGreaterThan(0);
    expect(sum('chatSent')).toBeGreaterThan(0);
    expect(sum('chatDelivered')).toBeGreaterThan(0);
    expect(sum('partyInvitesSent')).toBeGreaterThan(0);
  }, 40_000);
});
