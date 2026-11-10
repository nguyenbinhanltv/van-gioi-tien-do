/**
 * Quests end to end (D107): real server (inventory + progression + quests on the durable file store), real gateway, real NetClient and
 * QuestModel (what the browser panel runs, minus the DOM). The player really walks between the NPCs; every status comes from the server.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAG_MAX, TileGrid, encodeDirection } from '@vgtd/sim';
import { itemDefByKey, type DropItem } from '@vgtd/shared';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only
import { QuestModel, QuestOp, QuestStatus } from '@vgtd/client-core/src/ui/QuestModel.js';
import { InventoryService, openFileStores, startServer, type FileStores, type RunningServer } from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

const FAST = { N: 1024, r: 8, p: 1 };
const MAP = 128;
const C = MAP / 2;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(20);
  }
}
let srv: RunningServer | undefined;
let stores: FileStores | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.stop();
  srv = undefined;
  stores?.flush();
  stores = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Player {
  name: string;
  net: NetClient;
  quests: QuestModel;
  results: number[];
  lines: string[];
  /** walk with this heading until `done()` */
  walk(di: number, dj: number, done: () => boolean): Promise<void>;
  cmd(op: QuestOp, arg: string): void;
  close(): void;
}
async function player(s: RunningServer, name: string): Promise<Player> {
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
  const quests = new QuestModel();
  const results: number[] = [];
  const lines: string[] = [];
  net.questEvents = {
    onQuestState: (m) => lines.push(...quests.applyState(m, performance.now())),
    onQuestResult: (m) => {
      results.push(m.reason);
      const refusal = quests.applyResult(m);
      if (refusal) lines.push(refusal);
    },
  };
  await net.connect();
  let intent: Parameters<NetClient['update']>[1];
  const loop = setInterval(() => net.update(50, intent), 50);
  let id = 0;
  return {
    name,
    net,
    quests,
    results,
    lines,
    walk: async (di, dj, done) => {
      intent = { dir: encodeDirection(di, dj), mag: MAG_MAX, flags: 0 };
      try {
        await until('walk', done, 15_000);
      } finally {
        intent = undefined;
      }
      await sleep(150);
    },
    cmd: (op, arg) => {
      expect(
        net.sendQuest({
          op,
          clientMsgId: ++id,
          ...(op === QuestOp.Talk ? { npc: arg } : { questId: arg }),
        }),
      ).toBe(true);
    },
    close: () => {
      clearInterval(loop);
      net.close();
    },
  };
}

async function boot(dir: string): Promise<RunningServer> {
  stores = openFileStores(dir, { flushMs: -1 });
  // spawn on top of the elder (npc_truong_lao_dan stands 4 west and 9 north of the map centre, D125)
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000, store: stores.accounts },
    world: {
      mapTiles: MAP,
      spawn: { i0: C - 4.2, j0: C - 9.2, side: 0.4 },
      inventory: new InventoryService({ store: stores.inventories, ledger: stores.ledger }),
    },
    progression: { store: stores.progression },
    quests: { store: stores.quests },
  });
  return srv;
}

describe('quests end to end (real server, real NetClient, durable file store)', () => {
  it('accept at the elder, walk to the senior, talk, turn in: the reward arrives and survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-quests-'));
    dirs.push(dir);
    const s = await boot(dir);
    const p = await player(s, 'qu_alice');
    await until('the quest log arrives', () => p.quests.ready);
    await until(
      'the profile is known, so the first quest opens',
      () => p.quests.statusOf('q_c1_nhap_mon') === QuestStatus.Available,
    );
    expect(p.quests.markerFor('npc_truong_lao_dan')).toBe('!');
    expect(p.quests.statusOf('q_c1_van_khi')).toBe(QuestStatus.Locked);

    // nothing a client says about its own progress exists: a claim before the objective is refused, by the server
    p.cmd(QuestOp.Claim, 'q_c1_nhap_mon');
    await until('refused', () => p.results.length === 1);
    expect(p.results[0]).not.toBe(0);

    p.cmd(QuestOp.Accept, 'q_c1_nhap_mon');
    await until('accepted', () => p.quests.statusOf('q_c1_nhap_mon') === QuestStatus.Active);
    expect(p.lines.join('\n')).toMatch(/Đã nhận nhiệm vụ: Nhập Môn/);

    // talking from the wrong place is refused
    p.cmd(QuestOp.Talk, 'npc_su_huynh');
    await until('talk refused', () => p.results.length === 3);
    expect(p.results[2]).not.toBe(0);
    expect(p.quests.statusOf('q_c1_nhap_mon')).toBe(QuestStatus.Active);

    // walk south to the senior (14 tiles), talk, claim
    await p.walk(0, 1, () => (p.net.selfPosition()?.j ?? 0) >= C + 2);
    p.cmd(QuestOp.Talk, 'npc_su_huynh');
    await until('objective done', () => p.quests.statusOf('q_c1_nhap_mon') === QuestStatus.Ready);
    expect(p.quests.markerFor('npc_su_huynh')).toBe('?');
    expect(p.quests.tracker()[0]).toMatchObject({ id: 'q_c1_nhap_mon', goToName: 'Sư Huynh' });
    p.cmd(QuestOp.Claim, 'q_c1_nhap_mon');
    await until('completed', () => p.quests.statusOf('q_c1_nhap_mon') === QuestStatus.Completed);
    await until('the next quest opens', () => p.quests.statusOf('q_c1_van_khi') === QuestStatus.Available);
    expect(p.quests.markerFor('npc_su_huynh')).toBe('!');
    expect(p.lines.join('\n')).toMatch(/Hoàn thành nhiệm vụ: Nhập Môn/);

    const id = s.auth.store.byUsername('qu_alice')!.id;
    const pills = () => s.world.inventory!.bagOf(id).count(itemDefByKey('heal_pill' as DropItem)!.id);
    expect(pills()).toBe(2);
    p.close();
    await sleep(200);
    await srv?.stop();
    srv = undefined;
    stores?.flush();

    // restart on the same files: the completed quest is still completed, the reward was not paid again
    stores = undefined;
    const s2 = await boot(dir);
    const q = await player(s2, 'qu_alice');
    await until(
      'the log arrives again',
      () => q.quests.ready && q.quests.statusOf('q_c1_van_khi') === QuestStatus.Available,
    );
    expect(q.quests.statusOf('q_c1_nhap_mon')).toBe(QuestStatus.Completed);
    q.cmd(QuestOp.Claim, 'q_c1_nhap_mon');
    await until('refused again', () => q.results.length === 1);
    expect(q.results[0]).not.toBe(0);
    expect(s2.world.inventory!.bagOf(id).count(itemDefByKey('heal_pill' as DropItem)!.id)).toBe(2);
    expect(s2.world.inventory!.ledger.reconcile()).toEqual([]);
    q.close();
  }, 60_000);

  it('quest commands are rejected as unexpected when the server runs without the quests module', async () => {
    srv = await startServer({
      port: 0,
      auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      world: { mapTiles: MAP, spawn: { i0: C, j0: C, side: 2 } },
      quests: false,
    });
    const p = await player(srv, 'qu_bob');
    await sleep(200);
    expect(p.quests.ready).toBe(false); // no state is ever pushed
    p.cmd(QuestOp.Accept, 'q_c1_nhap_mon');
    await sleep(300);
    expect(p.results).toEqual([]); // the node answered with a generic error instead
    p.close();
  }, 30_000);
});
