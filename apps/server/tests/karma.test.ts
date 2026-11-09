/**
 * Nghiệp Lực (K) and Đạo Tâm on the server (D103): the stored values, the documented events, the daily gain cap, the Nghiệp-band ceiling of
 * Đạo Tâm, persistence (including the file store of D92) and the adapter the Tâm Ma uses.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ColdServerMessage } from '@vgtd/protocol';
import { DAO_TAM, NETWORK, breakthroughSuccess } from '@vgtd/shared';
import {
  InMemoryProgressionStore,
  PROGRESSION_CONFIG,
  ProgressionService,
  openFileStores,
  planBreakthrough,
  type ProgressionStore,
} from '../src/index.js';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(
  store: ProgressionStore,
  characterId = 'acc1',
): Promise<{ svc: ProgressionService; out: ColdServerMessage[]; at: number }> {
  const svc = new ProgressionService({ store, seed: 1 });
  svc.join(1, characterId, 0);
  await flush();
  const r = { svc, out: [] as ColdServerMessage[], at: 1000 };
  r.out.push(...svc.tick(r.at, NETWORK.TICK_MS).map((o) => o.msg));
  return r;
}
const daoMsgs = (out: ColdServerMessage[]): number[] =>
  out.filter((m): m is Extract<ColdServerMessage, { type: 'dao_tam' }> => m.type === 'dao_tam').map((m) => m.daoTam);
const drain = (r: { svc: ProgressionService; out: ColdServerMessage[]; at: number }): void => {
  r.at += NETWORK.TICK_MS;
  r.out.push(...r.svc.tick(r.at, NETWORK.TICK_MS).map((o) => o.msg));
};

describe('a new character', () => {
  it('starts neutral: K 0, Đạo Tâm at the start value, and the client is told once', async () => {
    const r = await boot(new InMemoryProgressionStore());
    expect(r.svc.karmaOf(1)).toBe(0);
    expect(r.svc.daoTamOf(1)).toBe(DAO_TAM.START);
    expect(daoMsgs(r.out)).toEqual([DAO_TAM.START]);
    drain(r);
    drain(r);
    expect(daoMsgs(r.out)).toEqual([DAO_TAM.START]); // not repeated while nothing changes
  });

  it('before its profile loads the adapter answers the start value and K 0 (nothing throws, nothing is invented)', () => {
    const svc = new ProgressionService({ store: new InMemoryProgressionStore(), seed: 1 });
    expect(svc.tamMaInputs(99)).toEqual({ karma: 0, daoTam: DAO_TAM.START, nghiepAnh: 0 });
    expect(svc.applyKarma(99, 'pvp_kill_unflagged', 0)).toBeNull();
    expect(svc.adjustDaoTam(99, 5)).toBeNull();
  });
});

describe('documented K events', () => {
  it('a loss lowers K, reaches the client in char_state and feeds the existing Karma_Penalty of the breakthrough', async () => {
    const r = await boot(new InMemoryProgressionStore());
    expect(r.svc.applyKarma(1, 'pvp_kill_unflagged_weaker', 5)).toEqual({ karma: -120, delta: -120 });
    drain(r);
    const states = r.out.filter((m) => m.type === 'char_state');
    expect(states.at(-1)).toMatchObject({ karma: -120 });
    const rec = r.svc.recordOf(1)!;
    expect(rec.karma).toBe(-120);
    const clean = planBreakthrough({ ...rec, karma: 0 })!;
    const dirty = planBreakthrough(rec)!;
    expect(dirty.kind).toBe(clean.kind);
    if (dirty.kind === 'major' && clean.kind === 'major')
      expect(dirty.chance).toBeCloseTo(breakthroughSuccess({ realm: rec.realm, karma: -120, nFail: 0 }), 12);
    else expect(dirty.chance).toBeLessThan(clean.chance); // the minor one is penalised too (half of the major penalty)
  });

  it('the daily +100 gain budget resets on a new server day and is never charged by losses', async () => {
    const r = await boot(new InMemoryProgressionStore());
    let gained = 0;
    for (let k = 0; k < 15; k++) gained += r.svc.applyKarma(1, 'pvp_kill_flagged', 7)!.delta;
    expect(gained).toBe(100); // 10 kills of +10, the other 5 give nothing
    expect(r.svc.karmaOf(1)).toBe(100);
    expect(r.svc.applyKarma(1, 'pvp_kill_unflagged', 7)!.delta).toBe(-50); // a loss still applies
    expect(r.svc.applyKarma(1, 'pvp_kill_flagged', 7)!.delta).toBe(0); // and did not refund the budget
    expect(r.svc.applyKarma(1, 'pvp_kill_flagged', 8)!.delta).toBe(10); // next day
    expect(r.svc.karmaOf(1)).toBe(60);
  });

  it('K is clamped at -1000 and never leaves the range', async () => {
    const r = await boot(new InMemoryProgressionStore());
    for (let k = 0; k < 30; k++) r.svc.applyKarma(1, 'pvp_kill_unflagged_weaker', 1);
    expect(r.svc.karmaOf(1)).toBe(-1000);
  });
});

describe('Đạo Tâm', () => {
  it('moves only through adjustDaoTam, clamped to 0..100, and the client hears the value that counts', async () => {
    const r = await boot(new InMemoryProgressionStore());
    expect(r.svc.adjustDaoTam(1, 1000)).toBe(100);
    expect(r.svc.adjustDaoTam(1, -1000)).toBe(0);
    drain(r);
    expect(daoMsgs(r.out)).toEqual([DAO_TAM.START, 100, 0]);
    expect(r.svc.adjustDaoTam(1, 0)).toBe(0); // no change: no message
    drain(r);
    expect(daoMsgs(r.out)).toHaveLength(3);
  });

  it('falling into a lower Nghiệp band lowers the value that counts without touching what was stored', async () => {
    const r = await boot(new InMemoryProgressionStore());
    r.svc.adjustDaoTam(1, 40); // stored 100
    expect(r.svc.daoTamOf(1)).toBe(100);
    for (let k = 0; k < 6; k++) r.svc.applyKarma(1, 'pvp_kill_unflagged_weaker', 1); // K -720: Ma đạo
    expect(r.svc.karmaOf(1)).toBe(-720);
    expect(r.svc.daoTamOf(1)).toBe(60);
    expect(r.svc.recordOf(1)!.daoTam).toBe(100); // the stored number is intact
    drain(r);
    expect(daoMsgs(r.out).at(-1)).toBe(60);
    // climbing back above -700 restores what was earned
    for (let day = 1; day <= 3; day++) for (let k = 0; k < 10; k++) r.svc.applyKarma(1, 'pvp_kill_flagged', day);
    expect(r.svc.karmaOf(1)).toBe(-420);
    expect(r.svc.daoTamOf(1)).toBe(80);
  });

  it('the Tâm Ma adapter reports K, the effective Đạo Tâm and the Nghiệp Ảnh shadows from one place', async () => {
    const r = await boot(new InMemoryProgressionStore());
    for (let k = 0; k < 5; k++) r.svc.applyKarma(1, 'pvp_kill_unflagged_weaker', 1); // -600
    expect(r.svc.tamMaInputs(1)).toEqual({ karma: -600, daoTam: 60, nghiepAnh: 3 });
  });
});

describe('persistence', () => {
  it('K, Đạo Tâm and the gain budget survive a restart (in-memory store)', async () => {
    const store = new InMemoryProgressionStore();
    const a = await boot(store);
    a.svc.applyKarma(1, 'pvp_kill_flagged', 4);
    a.svc.adjustDaoTam(1, -25);
    await a.svc.leave(1);
    const b = await boot(store);
    expect(b.svc.karmaOf(1)).toBe(10);
    expect(b.svc.daoTamOf(1)).toBe(DAO_TAM.START - 25);
    expect(daoMsgs(b.out)).toEqual([DAO_TAM.START - 25]);
    // the budget used earlier today is remembered
    for (let k = 0; k < 15; k++) b.svc.applyKarma(1, 'pvp_kill_flagged', 4);
    expect(b.svc.karmaOf(1)).toBe(100);
  });

  it('survive through the D92 file store, and a record written before D103 loads with the defaults', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-karma-'));
    dirs.push(dir);
    const s1 = openFileStores(dir);
    const a = await boot(s1.progression);
    a.svc.applyKarma(1, 'pvp_kill_unflagged', 2);
    a.svc.adjustDaoTam(1, 15);
    await a.svc.leave(1);
    s1.flush();
    const s2 = openFileStores(dir);
    const b = await boot(s2.progression);
    expect(b.svc.karmaOf(1)).toBe(-50);
    expect(b.svc.daoTamOf(1)).toBe(DAO_TAM.START + 15);
    // an old record: no daoTam / karmaGain fields at all
    const stored = await s2.progression.load('acc1');
    const { daoTam: _d, karmaGain: _g, ...old } = stored!;
    void _d;
    void _g;
    await s2.progression.save({ ...old, version: stored!.version + 1 }, stored!.version);
    const s3 = new ProgressionService({ store: s2.progression, seed: 1 });
    s3.join(7, 'acc1', 0);
    await flush();
    expect(s3.daoTamOf(7)).toBe(DAO_TAM.START);
    expect(s3.karmaOf(7)).toBe(-50);
  });
});

describe('what stays out of scope', () => {
  it('Karma_Penalty is the formula of docs/07 (this system only feeds K into it)', () => {
    expect(PROGRESSION_CONFIG).toBeDefined();
    expect(breakthroughSuccess({ realm: 1, karma: -700, nFail: 0 })).toBeCloseTo(
      breakthroughSuccess({ realm: 1, karma: 0, nFail: 0 }) - 0.14,
      12,
    );
  });
});
