/**
 * NPC sect end to end (D98): a real kill pays Cống hiến through the node (combat -> drops hook -> ledger), and real server + gateway +
 * NetClients + SectModels run the join / library flow, including a restart on the durable file store (D92).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SECT } from '@vgtd/shared';
import { wireSkillIds } from '@vgtd/client-combat';
import { ErrorCode, SectOp, SectReason, encode } from '@vgtd/protocol';
import { TileGrid, spawnEntity, type SimWorld } from '@vgtd/sim';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only
import { ChatLog } from '@vgtd/client-core/src/ui/ChatLog.js';
import { SectModel } from '@vgtd/client-core/src/ui/SectModel.js';
import {
  InventoryService,
  SectService,
  WorldNode,
  libraryOf,
  openFileStores,
  startServer,
  type ClientTransport,
  type FileStores,
  type MobCombatStats,
  type MobPort,
  type RunningServer,
} from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

const MOB = 1_000_001;
class FakeMobs implements MobPort {
  killed: number[] = [];
  constructor(private readonly source: 'field' | 'elite' | 'boss') {}
  combatStats(id: number): MobCombatStats | undefined {
    return id === MOB && !this.killed.includes(id)
      ? { defense: 40, realm: 1, element: 'moc', dropSource: this.source, hpMax: 5000 }
      : undefined;
  }
  kill(world: SimWorld, id: number): SimWorld {
    this.killed.push(id);
    return { ...world, entities: world.entities.filter((e) => e.id !== id) };
  }
}
class Quiet implements ClientTransport {
  send(): void {}
  close(_c: ErrorCode, _t: string): void {}
  buffered(): number {
    return 0;
  }
}

describe('a kill pays Cống hiến through the node', () => {
  function kill(
    source: 'field' | 'elite' | 'boss',
    member: boolean,
  ): { node: WorldNode; sect: SectService; killed: number[] } {
    const inventory = new InventoryService();
    const sect = new SectService({ ledger: inventory.ledger });
    const mobs = new FakeMobs(source);
    const node = new WorldNode({
      seed: 3,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      combat: { mobs },
      inventory,
      sect,
    });
    const id = node.addPlayer(new Quiet(), 'acc-1');
    node.tick(); // the node indexes entities once per tick: a command can only come after the first one
    if (member) {
      // the sect NPC stands in the middle of the spawn area: the player is right there
      expect(sect.handle(id, { type: 'sect_cmd', op: SectOp.Join, clientMsgId: 1, manual: 0 }, 1000).reason).toBe(
        SectReason.Ok,
      );
    }
    const me = node.world.entities.find((e) => e.id === id)!;
    node.world = spawnEntity(node.world, { id: MOB, i: me.i + 2, j: me.j, hp: 1, mpMax: 0 });
    for (let t = 0; t < 30; t++) node.tick();
    node.receive(
      id,
      encode({
        type: 'skill_cast',
        seq: 1,
        skillId: wireSkillIds().get('kiem_khi_tram')!,
        targetId: 0,
        aim: { qi: Math.round((me.i + 3) * 32), qj: Math.round(me.j * 32) },
      }),
    );
    for (let t = 0; t < 40; t++) node.tick();
    return { node, sect, killed: mobs.killed };
  }

  it('a member gets the reward of the mob’s drop source, exactly once per kill, and the ledger stays consistent', () => {
    for (const source of ['field', 'elite', 'boss'] as const) {
      const { sect, killed } = kill(source, true);
      expect(killed, source).toEqual([MOB]);
      expect(sect.contribution('acc-1'), source).toBe(BigInt(SECT.KILL_REWARD[source]));
      expect(sect.ledger.reconcile(), source).toEqual([]);
      expect(sect.metrics.earned, source).toBe(SECT.KILL_REWARD[source]);
    }
  });

  it('a non-member gets nothing from the same kill', () => {
    const { sect, killed } = kill('boss', false);
    expect(killed).toEqual([MOB]);
    expect(sect.contribution('acc-1')).toBe(0n);
    // (the shared ledger also holds stone drops: only Cống hiến entries matter here)
    expect(sect.ledger.entries.filter((e) => e.accountKey.includes(SECT.CURRENCY))).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------ real server + NetClients
const FAST = { N: 1024, r: 8, p: 1 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(20);
  }
}
let srv: RunningServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.stop();
  srv = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Player {
  net: NetClient;
  chat: ChatLog;
  sect: SectModel;
  results: SectReason[];
  say(raw: string): boolean;
  close(): void;
}
async function player(s: RunningServer, name: string, classId?: number): Promise<Player> {
  const deps: NetDeps = {
    fetch: (url, init) => fetch(url, init),
    WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
    now: () => performance.now(),
  };
  const net = new NetClient({
    baseUrl: `http://127.0.0.1:${s.port}`,
    username: name,
    password: TEST_ONLY_GOOD,
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
  });
  if (classId !== undefined) net.classRequest = classId;
  const sect = new SectModel();
  const results: SectReason[] = [];
  const chat = new ChatLog({ myName: () => name });
  net.sectEvents = {
    onSectState: (m) => {
      const line = sect.applyState(m);
      if (line) chat.system(line);
    },
    onSectResult: (m) => {
      results.push(m.reason);
      const refusal = sect.applyResult(m);
      if (refusal) chat.system(refusal, 'error');
    },
  };
  await net.connect();
  const loop = setInterval(() => net.update(50), 50);
  return {
    net,
    chat,
    sect,
    results,
    say: (raw) =>
      chat.submit(
        raw,
        () => false,
        undefined,
        (m) => net.sendSect(m),
      ),
    close: () => {
      clearInterval(loop);
      net.close();
    },
  };
}
const SERVER_OPTS = { mapTiles: 128, spawn: { i0: 60, j0: 60, side: 6 } };

describe('sect end to end (real server, real NetClients)', () => {
  it('join at the NPC, earn Cống hiến, buy a manual from the library of the class, refusals come back in Vietnamese', async () => {
    srv = await startServer({
      port: 0,
      auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      world: SERVER_OPTS,
    });
    const s = srv;
    const a = await player(s, 'sect_alice');
    await until('first sect state', () => a.sect.ready);
    expect(a.sect.view()).toMatchObject({ member: false, contribution: 0 });
    expect(a.sect.view().library).toHaveLength(5);
    expect(a.sect.nearNpc(a.net.selfPosition())).toBe(true);

    // not a member yet: the library is closed
    a.say('/sect buy 1');
    await until('refused', () => a.results.length === 1);
    expect(a.results).toEqual([SectReason.NotMember]);
    expect(a.chat.entries.at(-1)).toMatchObject({ tone: 'error', text: expect.stringContaining('chưa gia nhập') });

    expect(a.say('/sect join')).toBe(true);
    await until('member', () => a.sect.member);
    expect(a.chat.entries.map((e) => e.text).join('\n')).toMatch(/đã gia nhập/);

    // earn: the server credits Cống hiến for a member's kills (here driven through the same hook the combat core calls)
    const accountId = [...s.world.clients.values()][0]!.accountId;
    for (let k = 0; k < 4; k++) s.world.sect!.onKill(accountId, 'boss', `mob${k}@${k}`);
    await until('balance shown', () => a.sect.contribution === 4 * SECT.KILL_REWARD.boss);

    const first = a.sect.view().library[0]!;
    expect(first.price).toBe(libraryOf('kiem')[0]!.price);
    a.say('/sect buy 1');
    await until('bought', () => a.sect.view().library[0]!.owned);
    expect(a.sect.contribution).toBe(4 * SECT.KILL_REWARD.boss - first.price);
    expect(a.chat.entries.map((e) => e.text).join('\n')).toMatch(/đã học bí tịch/);
    a.say('/sect buy 1');
    await until('refused again', () => a.results.at(-1) === SectReason.AlreadyOwned);
    a.say('/sect buy 2');
    await until('not enough', () => a.results.at(-1) === SectReason.NotEnoughContribution);
    expect(s.world.sect!.ledger.reconcile()).toEqual([]);
    a.close();
  });

  it('the NPC range is enforced by the server: a player outside it is refused, whatever the client thinks', async () => {
    srv = await startServer({
      port: 0,
      auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      world: SERVER_OPTS,
    });
    const s = srv;
    const a = await player(s, 'sect_far');
    await until('state', () => a.sect.ready);
    const id = [...s.world.clients.keys()][0]!;
    s.world.world = {
      ...s.world.world,
      entities: s.world.world.entities.map((e) => (e.id === id ? { ...e, i: 20, j: 20 } : e)),
    };
    await sleep(120); // a few ticks so the node sees the new position
    a.say('/sect join');
    await until('answer', () => a.results.length === 1);
    expect(a.results).toEqual([SectReason.TooFar]);
    expect(a.sect.member).toBe(false);
    a.close();
  });
});

describe('the sect survives a server restart on the durable file store (D92)', () => {
  it('membership, the bought manual and the Cống hiến balance come back for the same account', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-sect-'));
    dirs.push(dir);
    const boot = async (): Promise<{ s: RunningServer; stores: FileStores }> => {
      const stores = openFileStores(dir, { flushMs: -1 });
      const s = await startServer({
        port: 0,
        auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000, store: stores.accounts },
        world: {
          ...SERVER_OPTS,
          inventory: new InventoryService({ store: stores.inventories, ledger: stores.ledger }),
        },
        progression: { store: stores.progression },
        sect: { store: stores.sect },
      });
      srv = s;
      return { s, stores };
    };
    let { s, stores } = await boot();
    const a = await player(s, 'sect_keep');
    await until('state', () => a.sect.ready);
    a.say('/sect join');
    await until('member', () => a.sect.member);
    const accountId = [...s.world.clients.values()][0]!.accountId;
    for (let k = 0; k < 4; k++) s.world.sect!.onKill(accountId, 'boss', `m${k}@${k}`);
    await until('balance', () => a.sect.contribution === 100);
    a.say('/sect buy 1');
    await until('bought', () => a.sect.view().library[0]!.owned);
    const left = a.sect.contribution;
    a.close();
    await sleep(200);
    await s.stop();
    s.world.inventory!.flushAll();
    stores.flush();
    srv = undefined;

    ({ s, stores } = await boot());
    const b = await player(s, 'sect_keep'); // same account, new process
    await until('restored', () => b.sect.ready && b.sect.member);
    expect(b.sect.contribution).toBe(left);
    expect(b.sect.view().library[0]!.owned).toBe(true);
    b.say('/sect buy 1');
    await until('still owned', () => b.results.at(-1) === SectReason.AlreadyOwned);
    expect(b.sect.contribution).toBe(left); // nothing was charged again
    void stores;
    b.close();
  });
});
