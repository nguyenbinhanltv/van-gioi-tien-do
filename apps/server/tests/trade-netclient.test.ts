/**
 * Direct trade end to end (D102): real server + gateway + NetClients + TradeModels (what the browser panel runs, minus the DOM): the window,
 * the two-step lock and confirm, the atomic exchange with the 3% stone tax, a partner who drops mid-trade, an item used while it sits in the
 * window, the rate limit through the wire, and a restart on the durable file store (D92).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itemDefByKey } from '@vgtd/shared';
import { TradeClosed, TradePhase, TradeReason } from '@vgtd/protocol';
import { TileGrid } from '@vgtd/sim';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only
import { ChatLog } from '@vgtd/client-core/src/ui/ChatLog.js';
import { TradeModel } from '@vgtd/client-core/src/ui/TradeModel.js';
import {
  InventoryService,
  TRADE_CONFIG,
  openFileStores,
  startServer,
  type FileStores,
  type RunningServer,
} from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

const FAST = { N: 1024, r: 8, p: 1 };
const PILL = itemDefByKey('heal_pill')!.id;
const MAT = itemDefByKey('craft_material')!.id;
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
  chat: ChatLog;
  trade: TradeModel;
  results: TradeReason[];
  say(raw: string): boolean;
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
  const chat = new ChatLog({ myName: () => name });
  const trade = new TradeModel({ now: () => performance.now() });
  const results: TradeReason[] = [];
  net.tradeEvents = {
    onTradeState: (m) => {
      const line = trade.applyState(m);
      if (line) chat.system(line);
    },
    onTradeInvite: (m) => chat.system(trade.applyInvite(m)),
    onTradeResult: (m) => {
      results.push(m.reason);
      const refusal = trade.applyResult(m);
      if (refusal) chat.system(refusal, 'error');
    },
  };
  await net.connect();
  const loop = setInterval(() => net.update(50), 50);
  return {
    name,
    net,
    chat,
    trade,
    results,
    say: (raw) =>
      chat.submit(
        raw,
        () => false,
        undefined,
        undefined, // sect
        undefined, // friend
        (m) => net.sendTrade(m),
      ),
    close: () => {
      clearInterval(loop);
      net.close();
    },
  };
}
const SERVER_OPTS = { mapTiles: 128, spawn: { i0: 60, j0: 60, side: 6 } };
const accountOf = (s: RunningServer, p: Player): string => s.world.clients.get(p.net.entityId)!.accountId;
async function boot(inventory = new InventoryService()): Promise<RunningServer> {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { ...SERVER_OPTS, inventory },
  });
  return srv;
}
const give = (
  s: RunningServer,
  owner: string,
  rolls: { item: 'heal_pill' | 'craft_material' | 'stone_ha'; qty: number; quality?: number }[],
): void => {
  s.world.inventory!.grantDrops(owner, rolls, 'field', `give-${owner}-${Math.random()}`);
};
const bagSlot = (s: RunningServer, owner: string, defId: number): number =>
  s.world.inventory!.bagOf(owner).slots.findIndex((x) => x?.kind === 'stack' && x.defId === defId);

describe('direct trade end to end', () => {
  it('invite -> accept -> offers -> lock -> confirm: items and taxed stones cross atomically and both panels show the result', async () => {
    const s = await boot();
    const a = await player(s, 'tr_alice');
    const b = await player(s, 'tr_bob');
    await until('both in the world', () => a.net.entityId > 0 && b.net.entityId > 0);
    const A = accountOf(s, a);
    const B = accountOf(s, b);
    give(s, A, [
      { item: 'heal_pill', qty: 10, quality: 1 },
      { item: 'stone_ha', qty: 500 },
    ]);
    give(s, B, [{ item: 'craft_material', qty: 30, quality: 0 }]);
    await until('bags arrived', () => a.net.bag.ready && b.net.bag.ready && a.net.bag.wallet.LT_HA === 500);

    expect(a.say('/trade tr_bob')).toBe(true);
    await until('bob got the invite', () => b.trade.invite()?.fromName === 'tr_alice');
    expect(b.chat.entries.map((e) => e.text).join('\n')).toMatch(/tr_alice mời bạn giao dịch/);
    expect(b.say('/trade accept')).toBe(true);
    await until('window open on both sides', () => a.trade.open && b.trade.open);
    expect(a.trade.view().partner).toBe('tr_bob');

    const pillSlot = bagSlot(s, A, PILL);
    const matSlot = bagSlot(s, B, MAT);
    a.say(`/trade add ${pillSlot + 1} 4`);
    a.say('/trade stones ha 200');
    b.say(`/trade add ${matSlot + 1} 25`);
    await until(
      'both see both offers',
      () => b.trade.view().theirs.stones[0] === 200 && a.trade.view().theirs.items.length === 1,
    );
    expect(b.trade.view().theirs.items).toEqual([
      expect.objectContaining({ defId: PILL, qty: 4, name: 'Đan hồi máu (phẩm 1)' }),
    ]);

    a.say('/trade lock');
    b.say('/trade lock');
    await until('both locked', () => a.trade.view().canConfirm && b.trade.view().canConfirm);
    a.say('/trade confirm');
    await until('alice confirmed', () => a.trade.view().mine.confirmed);
    expect(s.world.inventory!.wallet(A, 'LT_HA')).toBe(500n); // one confirm is not a trade
    b.say('/trade confirm');
    await until(
      'done on both sides',
      () => !a.trade.open && !b.trade.open && a.chat.entries.some((e) => /hoàn tất/.test(e.text)),
    );

    const inv = s.world.inventory!;
    expect([inv.bagOf(A).count(PILL), inv.bagOf(B).count(PILL)]).toEqual([6, 4]);
    expect([inv.bagOf(A).count(MAT), inv.bagOf(B).count(MAT)]).toEqual([25, 5]);
    expect([inv.wallet(A, 'LT_HA'), inv.wallet(B, 'LT_HA')]).toEqual([500n - 200n, 194n]);
    expect(inv.ledger.reconcile()).toEqual([]);
    expect(a.chat.entries.map((e) => e.text).join('\n')).toMatch(/hoàn tất.*thuế 3%: 6 linh thạch hạ phẩm/);
    // the bag views follow the server
    await until('bag views updated', () => a.net.bag.wallet.LT_HA === 300 && b.net.bag.wallet.LT_HA === 194);
    a.close();
    b.close();
  });

  it('a partner who drops mid-trade cancels the window with nothing moved; an item used while in the window leaves it', async () => {
    const s = await boot();
    const a = await player(s, 'tr_x');
    let b = await player(s, 'tr_y');
    await until('in the world', () => a.net.entityId > 0 && b.net.entityId > 0);
    const A = accountOf(s, a);
    give(s, A, [
      { item: 'heal_pill', qty: 5, quality: 1 },
      { item: 'stone_ha', qty: 100 },
    ]);
    await until('bag', () => a.net.bag.ready && a.net.bag.wallet.LT_HA === 100);
    a.say('/trade tr_y');
    await until('invite', () => b.trade.invite() !== null);
    b.say('/trade accept');
    await until('open', () => a.trade.open && b.trade.open);
    const slot = bagSlot(s, A, PILL);
    a.say(`/trade add ${slot + 1} 5`);
    a.say('/trade stones ha 100');
    a.say('/trade lock');
    b.say('/trade lock');
    await until('both locked', () => a.trade.view().canConfirm);
    // alice drinks a pill while the window is open
    s.world.inventory!.bagOf(A).takeOne(slot); // the same effect as the use command on the server's bag: one pill is gone
    await until(
      'window reset by the server',
      () => !a.trade.view().mine.locked && a.trade.view().mine.items.length === 0,
    );
    expect(a.chat.entries.some((e) => e.tone === 'error')).toBe(false);
    // bob now drops
    b.close();
    await until(
      'alice told the partner left',
      () => !a.trade.open && a.chat.entries.some((e) => /đã rời game/.test(e.text)),
    );
    expect(s.world.inventory!.bagOf(A).count(PILL)).toBe(4); // nothing lost beyond the pill she used
    expect(s.world.inventory!.wallet(A, 'LT_HA')).toBe(100n);
    expect(s.world.trade!.openWindows).toBe(0);
    // bob logs in again: no stale window, his bag is untouched
    b = await player(s, 'tr_y');
    await sleep(150);
    expect(b.trade.open).toBe(false);
    expect(s.world.inventory!.bagOf(accountOf(s, b)).count(PILL)).toBe(0);
    a.close();
    b.close();
  });

  it('refusals and the rate limit come through the wire: unknown names, far players and probing end in RateLimited', async () => {
    const s = await boot();
    const a = await player(s, 'tr_probe');
    await until('in the world', () => a.net.entityId > 0);
    a.say('/trade tr_probe');
    a.say('/trade lock');
    await until('two answers', () => a.results.length === 2);
    expect(a.results).toEqual([TradeReason.Self, TradeReason.NotTrading]);
    expect(a.chat.entries.filter((e) => e.tone === 'error').map((e) => e.text)).toEqual([
      'Không thể giao dịch với chính mình.',
      'Bạn không ở trong giao dịch nào.',
    ]);
    const burst = TRADE_CONFIG.RATE.burst;
    const before = a.results.length;
    for (let k = 0; k < burst + 6; k++) a.say(`/trade ghost_${k}`);
    await until('probe answers', () => a.results.length === before + burst + 6);
    const answers = a.results.slice(before);
    expect(answers.filter((r) => r === TradeReason.RateLimited).length).toBeGreaterThanOrEqual(6);
    expect(answers.filter((r) => r === TradeReason.NoSuchPlayer).length).toBeLessThanOrEqual(burst);
    a.close();
  });

  it('a trade without an inventory is simply not there: the server answers the unexpected message instead of crashing', async () => {
    srv = await startServer({
      port: 0,
      auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      world: SERVER_OPTS, // no inventory => no trade module
    });
    expect(srv.world.trade).toBeUndefined();
    const a = await player(srv, 'tr_noinv');
    await until('in the world', () => a.net.entityId > 0);
    a.say('/trade someone');
    await sleep(300);
    expect(a.net.status).toBe('online'); // an error frame, not a kick
    a.close();
  });
});

describe('a trade survives a restart on the durable file store (D92)', () => {
  it('after the trade and a clean flush, a new server process has both bags and wallets exactly as the trade left them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-trade-e2e-'));
    dirs.push(dir);
    const open = async (): Promise<{ s: RunningServer; stores: FileStores }> => {
      const stores = openFileStores(dir, { flushMs: -1 });
      const s = await startServer({
        port: 0,
        auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000, store: stores.accounts },
        world: {
          ...SERVER_OPTS,
          inventory: new InventoryService({ store: stores.inventories, ledger: stores.ledger }),
        },
        progression: { store: stores.progression },
      });
      srv = s;
      return { s, stores };
    };
    let { s, stores } = await open();
    const a = await player(s, 'tr_keep_a');
    const b = await player(s, 'tr_keep_b');
    await until('in the world', () => a.net.entityId > 0 && b.net.entityId > 0);
    const A = accountOf(s, a);
    const B = accountOf(s, b);
    give(s, A, [
      { item: 'heal_pill', qty: 8, quality: 1 },
      { item: 'stone_ha', qty: 1000 },
    ]);
    await until('bag', () => a.net.bag.ready && a.net.bag.wallet.LT_HA === 1000);
    a.say('/trade tr_keep_b');
    await until('invite', () => b.trade.invite() !== null);
    b.say('/trade accept');
    await until('open', () => a.trade.open && b.trade.open);
    a.say(`/trade add ${bagSlot(s, A, PILL) + 1} 8`);
    a.say('/trade stones ha 1000');
    a.say('/trade lock');
    b.say('/trade lock');
    await until('locked', () => a.trade.view().canConfirm && b.trade.view().canConfirm);
    a.say('/trade confirm');
    b.say('/trade confirm');
    await until('done', () => !a.trade.open && s.world.inventory!.bagOf(B).count(PILL) === 8);
    a.close();
    b.close();
    await sleep(200);
    await s.stop();
    s.world.inventory!.flushAll();
    stores.flush();
    srv = undefined;

    ({ s, stores } = await open());
    const inv = s.world.inventory!;
    // the accounts are the same, so the stored bags / wallets answer for them
    expect([inv.bagOf(A).count(PILL), inv.bagOf(B).count(PILL)]).toEqual([0, 8]);
    expect([inv.wallet(A, 'LT_HA'), inv.wallet(B, 'LT_HA')]).toEqual([0n, 970n]);
    expect(inv.ledger.reconcile()).toEqual([]);
    expect(s.world.trade!.openWindows).toBe(0);
    void stores;
    void TradePhase;
    void TradeClosed;
    void MAT;
  });
});
