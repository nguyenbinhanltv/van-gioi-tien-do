/**
 * Vạn Bảo Lâu end to end (D112): real server, real gateway, real NetClients and MarketModels (what the browser panel runs, minus the DOM):
 * list from the bag, browse, buy, the seller's notice, the wallets, and a restart on the durable file store (D92) in the middle of a sale.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TileGrid } from '@vgtd/sim';
import { itemDefByKey } from '@vgtd/shared';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only
import { MarketModel } from '@vgtd/client-core/src/ui/MarketModel.js';
import { InventoryService, openFileStores, startServer, type FileStores, type RunningServer } from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

const FAST = { N: 1024, r: 8, p: 1 };
const HEAL = itemDefByKey('heal_pill')!.id;
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
  name: string;
  net: NetClient;
  market: MarketModel;
  lines: string[];
  /** the bag slot holding `defId`, or -1 */
  slotOf(defId: number): number;
  search(over?: Parameters<MarketModel['setFilter']>[0]): Promise<void>;
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
  const market = new MarketModel(() => 0.5);
  const lines: string[] = [];
  net.marketEvents = {
    onMarketResults: (m) => market.applyResults(m),
    onMarketResult: (m) => {
      const l = market.applyResult(m);
      if (l) lines.push(l);
    },
    onMarketNotice: (m) => lines.push(market.applyNotice(m)),
  };
  await net.connect();
  const loop = setInterval(() => net.update(50), 50);
  return {
    name,
    net,
    market,
    lines,
    slotOf: (defId) => {
      for (let i = 0; i < net.bag.slotCount; i++) if (net.bag.itemAt(i)?.defId === defId) return i;
      return -1;
    },
    async search(over = {}) {
      market.setFilter(over);
      const v = market.version;
      expect(net.sendMarket(market.searchCmd())).toBe(true);
      await until('results', () => market.version > v);
    },
    close: () => {
      clearInterval(loop);
      net.close();
    },
  };
}

const SERVER_WORLD = { mapTiles: 128, spawn: { i0: 60, j0: 60, side: 6 } };
const accountId = (s: RunningServer, name: string): string => s.auth.store.byUsername(name)!.id;
const give = (
  s: RunningServer,
  name: string,
  items: { item: 'stone_ha' | 'heal_pill'; qty: number }[],
  key: string,
): void => {
  s.world.inventory!.grantDrops(accountId(s, name), items, 'elite', key);
};

describe('Vạn Bảo Lâu end to end (real server, real NetClient)', () => {
  it('list from the bag, browse, buy: money and item move once, the seller gets a notice', async () => {
    srv = await startServer({
      port: 0,
      auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      world: { ...SERVER_WORLD, inventory: new InventoryService() },
    });
    const s = srv;
    expect(s.world.market).toBeDefined();
    const alice = await player(s, 'mk_alice');
    const bob = await player(s, 'mk_bob');
    give(
      s,
      'mk_alice',
      [
        { item: 'stone_ha', qty: 100 },
        { item: 'heal_pill', qty: 20 },
      ],
      'a1',
    );
    give(s, 'mk_bob', [{ item: 'stone_ha', qty: 5000 }], 'b1');
    await until('bags', () => alice.slotOf(HEAL) >= 0 && bob.net.bag.wallet.LT_HA === 5000);

    // list 10 of the 20 at 100 each: the lot costs 1000, the fee is 10
    const slot = alice.slotOf(HEAL);
    expect(alice.market.listProblem(100, 10, 20, 24)).toBeNull();
    expect(alice.market.preview(100, 10)).toEqual({ total: 1000, fee: 10, tax: 50, proceeds: 950 });
    expect(alice.net.sendMarket(alice.market.listCmd(slot, 10, 100, 24))).toBe(true);
    await until('listed', () => alice.lines.length === 1);
    expect(alice.lines[0]).toContain('Phí niêm yết 10');
    await until('escrow', () => alice.net.bag.itemAt(slot)?.qty === 10 && alice.net.bag.wallet.LT_HA === 90);

    // bob browses and sees it
    await bob.search();
    expect(bob.market.total).toBe(1);
    expect(bob.market.listings()[0]).toMatchObject({
      seller: 'mk_alice',
      qty: 10,
      unitPrice: 100,
      defId: HEAL,
      mine: false,
    });
    expect(bob.market.summaryLines().join('\n')).toContain('Đan hồi máu');
    await alice.search({ view: 1 });
    expect(alice.market.listings()[0]!.mine).toBe(true);

    // bob buys it
    const id = bob.market.listings()[0]!.listingId;
    expect(bob.net.sendMarket(bob.market.buyCmd(id))).toBe(true);
    await until('bought', () => bob.lines.length === 1);
    expect(bob.lines[0]).toContain('Đã mua');
    expect(bob.lines[0]).toContain('1000');
    await until('bob bag', () => bob.slotOf(HEAL) >= 0 && bob.net.bag.wallet.LT_HA === 4000);
    expect(bob.net.bag.itemAt(bob.slotOf(HEAL))!.qty).toBe(10);
    await until('alice paid', () => alice.net.bag.wallet.LT_HA === 90 + 950);
    expect(alice.lines.some((l) => l.includes('đã bán') && l.includes('950'))).toBe(true);

    // a second buy of the same listing is refused, nothing changes
    expect(bob.net.sendMarket(bob.market.buyCmd(id))).toBe(true);
    await until('refused', () => bob.lines.length === 2);
    expect(bob.lines[1]).toContain('không còn');
    expect(bob.net.bag.wallet.LT_HA).toBe(4000);
    expect(s.world.inventory!.ledger.reconcile()).toEqual([]);
    alice.close();
    bob.close();
  }, 30_000);

  it('a cancel brings the lot back; a refusal reads in Vietnamese; the rate limit answers instead of dropping', async () => {
    srv = await startServer({
      port: 0,
      auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      world: { ...SERVER_WORLD, inventory: new InventoryService() },
    });
    const s = srv;
    const alice = await player(s, 'mk_c_alice');
    give(
      s,
      'mk_c_alice',
      [
        { item: 'stone_ha', qty: 50 },
        { item: 'heal_pill', qty: 5 },
      ],
      'c1',
    );
    await until('bag', () => alice.slotOf(HEAL) >= 0 && alice.net.bag.wallet.LT_HA === 50);
    const slot = alice.slotOf(HEAL);
    alice.net.sendMarket(alice.market.listCmd(slot, 5, 10, 12));
    await until('listed', () => alice.lines.length === 1);
    await alice.search({ view: 1 });
    const id = alice.market.listings()[0]!.listingId;
    alice.net.sendMarket(alice.market.cancelCmd(id));
    await until('cancelled', () => alice.lines.length === 2);
    expect(alice.lines[1]).toContain('Đã gỡ');
    await until('item back', () => alice.net.bag.itemAt(slot)?.qty === 5);
    // somebody else's / a missing listing reads the same
    alice.net.sendMarket(alice.market.cancelCmd(999_999));
    await until('refusal', () => alice.lines.length === 3);
    expect(alice.lines[2]).toContain('không còn');
    // a flood is answered (RateLimited), never silently dropped
    for (let i = 0; i < 12; i++) alice.net.sendMarket(alice.market.cancelCmd(999_000 + i));
    await until('flood answered', () => alice.lines.length === 3 + 12);
    expect(alice.lines.some((l) => l.includes('quá nhanh'))).toBe(true);
    alice.close();
  }, 30_000);

  it('survives a server restart on the durable file store: the escrowed lot is still on sale and is bought exactly once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-market-'));
    dirs.push(dir);
    const boot = async (): Promise<{ s: RunningServer; stores: FileStores }> => {
      const stores = openFileStores(dir, { flushMs: -1 });
      const s = await startServer({
        port: 0,
        auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000, store: stores.accounts },
        world: {
          ...SERVER_WORLD,
          inventory: new InventoryService({
            store: stores.inventories,
            ledger: stores.ledger,
            durable: stores.durable,
          }),
        },
        progression: { store: stores.progression },
        market: { store: stores.market, durable: (label) => stores.durableMarket.commit(label) },
      });
      srv = s;
      return { s, stores };
    };
    let { s, stores } = await boot();
    const a = await player(s, 'mk_r_alice');
    const b = await player(s, 'mk_r_bob');
    give(
      s,
      'mk_r_alice',
      [
        { item: 'stone_ha', qty: 100 },
        { item: 'heal_pill', qty: 10 },
      ],
      'r1',
    );
    give(s, 'mk_r_bob', [{ item: 'stone_ha', qty: 2000 }], 'r2');
    await until('bags', () => a.slotOf(HEAL) >= 0 && b.net.bag.wallet.LT_HA === 2000);
    a.net.sendMarket(a.market.listCmd(a.slotOf(HEAL), 10, 100, 48));
    await until('listed', () => a.lines.length === 1);
    a.close();
    b.close();
    await sleep(200);
    await s.stop();
    stores.flush();
    srv = undefined;

    // a new process on the same data directory
    ({ s, stores } = await boot());
    expect(s.world.market!.listingCount()).toBe(1);
    expect(stores.market.load()!.listings).toHaveLength(1);
    const b2 = await player(s, 'mk_r_bob');
    await until('wallet back', () => b2.net.bag.wallet.LT_HA === 2000);
    await b2.search();
    expect(b2.market.total).toBe(1);
    expect(b2.market.listings()[0]).toMatchObject({ seller: 'mk_r_alice', qty: 10, unitPrice: 100 });
    b2.net.sendMarket(b2.market.buyCmd(b2.market.listings()[0]!.listingId));
    await until('bought', () => b2.lines.length === 1 && b2.net.bag.wallet.LT_HA === 1000);
    await until('item', () => b2.slotOf(HEAL) >= 0);
    expect(b2.net.bag.itemAt(b2.slotOf(HEAL))!.qty).toBe(10);
    // alice comes back: her item is gone (sold), her money arrived, and nothing was duplicated
    const a2 = await player(s, 'mk_r_alice');
    await until('alice wallet', () => a2.net.bag.wallet.LT_HA === 100 - 10 + 950);
    expect(a2.slotOf(HEAL)).toBe(-1);
    expect(s.world.inventory!.ledger.reconcile()).toEqual([]);
    expect(s.world.market!.listingCount()).toBe(0);
    a2.close();
    b2.close();
    await sleep(100);
    await s.stop();
    stores.flush();
    srv = undefined;
  }, 40_000);
});
