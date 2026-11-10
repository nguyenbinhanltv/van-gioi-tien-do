import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { TileGrid } from '@vgtd/sim';
// engine-free parts only (the package index also pulls DOM input code, which the server's tsconfig has no lib for)
import { NetClient, type NetDeps, type SocketLike } from '@vgtd/client-core/src/net/index.js';
import { CraftModel } from '@vgtd/client-core/src/ui/CraftModel.js';
import { requestIdFrom } from '@vgtd/client-core/src/ui/ProgressionView.js';
import { ALCHEMY, craftFee, itemDefByKey, recipeByKey, type DropRoll } from '@vgtd/shared';
import {
  InMemoryProgressionStore,
  InventoryService,
  newRecord,
  startServer,
  type ProgressRecord,
  type RunningServer,
} from '../src/index.js';

/**
 * End to end over a real WebSocket (D108): the client-core NetClient + CraftModel (the model behind the crafting panel) against the real gateway,
 * World Node, ProgressionService, InventoryService and CraftService. Every rule is the production one; the character is simply created at
 * Trúc Cơ (realm 2), the realm crafting opens at, so the test does not have to cultivate for hours.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until<T>(what: string, get: () => T | null | undefined | false, timeoutMs = 20000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${what}`);
    await sleep(25);
  }
}

/** A progression store whose new characters start at realm 2. */
class TrucCoStore extends InMemoryProgressionStore {
  override async load(id: string): Promise<ProgressRecord | undefined> {
    const have = await super.load(id);
    if (have) return have;
    await this.save({ ...newRecord(id, { type: 'don', elements: ['moc'], mutation: null }), realm: 2, version: 1 }, 0);
    return super.load(id);
  }
}

let server: RunningServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe('alchemy over the wire', () => {
  it('a Trúc Cơ player at the furnace crafts a pill: answer, result, bag, wallet, ledger sink and mastery all agree', async () => {
    const inv = new InventoryService();
    server = await startServer({
      port: 0,
      autoTick: true,
      auth: { scrypt: { N: 1024, r: 8, p: 1 }, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      world: { mapTiles: 64, spawn: { i0: 20, j0: 20, side: 16 }, inventory: inv, craft: true },
      progression: { seed: 42, store: new TrucCoStore() },
    });
    const srv = server;
    const deps: NetDeps = {
      fetch: (url, init) => fetch(url, init),
      WebSocket: WebSocket as unknown as new (url: string) => SocketLike,
      now: () => performance.now(),
    };
    const net = new NetClient({
      baseUrl: `http://127.0.0.1:${srv.port}`,
      username: `alch_${Math.floor(Math.random() * 1e6)}`,
      password: requestIdFrom(Math.random),
      deps,
      makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
    });
    const MAT = itemDefByKey('craft_material')!.id;
    const model = new CraftModel({
      now: () => performance.now(),
      newRequestId: () => requestIdFrom(Math.random),
      bagCount: (id) => net.bag.count(id),
      stones: () => Number(net.bag.wallet.LT_HA ?? 0),
      realm: () => 2,
    });
    net.craftEvents = { onCraftState: (m) => model.applyState(m), onCraftResult: (m) => model.applyResult(m) };
    await net.connect();
    const loop = setInterval(() => net.update(50, { dir: 255, mag: 0, flags: 0 }), 50); // idle: it must not cancel the craft
    try {
      await until('craft_state', () => model.ready);
      expect(model.furnace).not.toBeNull();
      const acct = [...srv.world.clients.values()][0]!.accountId;
      inv.grantDrops(
        acct,
        [
          { item: 'craft_material', qty: 40, quality: 0 },
          { item: 'stone_ha', qty: 200, quality: 0 },
        ] as DropRoll[],
        'field',
        'e2e-grant',
      );
      await until('bag state', () => net.bag.count(MAT) === 40 && Number(net.bag.wallet.LT_HA) === 200);
      const recipe = recipeByKey('pill_truc_co_dan')!;
      const hint = model.recipes(net.selfPosition()).find((r) => r.key === recipe.key)!;
      expect(hint.canStart).toBe(true);
      expect(model.start(recipe.wireId, 1, (m) => net.sendCraft(m))).toBe(true);
      await until('accepted', () => model.toast()?.text.includes('Bắt đầu luyện'));
      expect(model.job()?.name).toBe(recipe.name);
      // the craft completes after CRAFT_MS of server time
      await until('result', () => /thành công|thất bại/.test(model.toast()?.text ?? ''), ALCHEMY.CRAFT_MS + 8000);
      const log = [...(srv.world.craft?.log ?? [])];
      expect(log).toHaveLength(1);
      const fee = craftFee(recipe);
      await until('bag after', () => Number(net.bag.wallet.LT_HA) === 200 - fee);
      if (log[0]!.success) {
        expect(net.bag.count(MAT)).toBe(40 - recipe.materials);
        expect(net.bag.count(itemDefByKey('breakthrough_pill')!.id)).toBe(1);
        await until('mastery', () => model.masteryOf(recipe.wireId) > 0);
      } else {
        expect(net.bag.count(MAT)).toBe(40 - Math.ceil(recipe.materials * 0.6));
        expect(net.bag.count(itemDefByKey('breakthrough_pill')!.id)).toBe(0);
      }
      expect(inv.ledger.balance({ kind: 'SYSTEM_SINK_CRAFT_FEE', ownerId: null, currency: 'LT_HA' })).toBe(BigInt(fee));
      expect(inv.ledger.reconcile()).toEqual([]);
      expect(model.job()).toBeNull();
      expect(srv.world.craft?.metrics.rejected).toBe(0);
    } finally {
      clearInterval(loop);
      net.close();
    }
  }, 40_000);
});
