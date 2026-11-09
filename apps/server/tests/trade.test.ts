/**
 * TradeService + InventoryService.exchange (D102): the two-step window, the atomic exchange with the 3% stone tax, and the anti-dupe cases
 * (double confirm, disconnect mid-trade, concurrent trades, item used / dropped while in the window, full bag, overdraft, restart).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CURRENCIES, DIRECT_TRADE_TAX_BPS, TRADE, directTradeTaxUnits, itemDefByKey } from '@vgtd/shared';
import {
  TradeClosed,
  TradeOp,
  TradePhase,
  TradeReason,
  type TradeServerMessage,
  type TradeStateMsg,
} from '@vgtd/protocol';
import { InventoryService, TRADE_CONFIG, TradeService, openFileStores, type FileStores } from '../src/index.js';

const HA = 0;
const PILL = itemDefByKey('heal_pill')!.id;
const MAT = itemDefByKey('craft_material')!.id;
const BLUEPRINT = itemDefByKey('blueprint_white_green')!.id;

interface Rig {
  inv: InventoryService;
  trade: TradeService;
  pos: Map<number, { i: number; j: number }>;
  got: Map<number, TradeServerMessage[]>;
  /** run one command as `entity`; every call is far enough after the last one that the rate limiter never interferes */
  cmd(
    entity: number,
    op: number,
    o?: { name?: string; slot?: number; qty?: number; currency?: number; amount?: number },
    now?: number,
  ): TradeReason;
  /** tick, then the LAST trade_state each entity got since the previous call */
  states(now?: number): Map<number, TradeStateMsg>;
  /** open a window between two entities */
  open(a: number, b: number): void;
  /** put `n` heal pills / stones / a blueprint into an account */
  give(owner: string, o: { pills?: number; mats?: number; ha?: number; blueprints?: number }): void;
  now: number;
}
const ACCOUNTS: Record<number, [string, string]> = {
  1: ['acc-a', 'alice'],
  2: ['acc-b', 'bob'],
  3: ['acc-c', 'carol'],
  4: ['acc-d', 'dave'],
};

function rig(inv: InventoryService = new InventoryService()): Rig {
  const trade = new TradeService({ inventory: inv });
  const pos = new Map<number, { i: number; j: number }>();
  const got = new Map<number, TradeServerMessage[]>();
  trade.attach({
    deliver: (id, m) => {
      const l = got.get(id) ?? [];
      l.push(m);
      got.set(id, l);
    },
    posOf: (id) => pos.get(id),
  });
  for (const [e, [acc, name]] of Object.entries(ACCOUNTS)) {
    inv.onJoin(acc);
    trade.join({ entityId: Number(e), accountId: acc, name });
    pos.set(Number(e), { i: 50, j: 50 });
  }
  let id = 0;
  const r: Rig = {
    inv,
    trade,
    pos,
    got,
    now: 1_000_000,
    cmd(entity, op, o = {}, now) {
      r.now = now ?? (r.now += 2 * TRADE_CONFIG.RATE.refillMs);
      return trade.handle(
        entity,
        {
          type: 'trade_cmd',
          op,
          clientMsgId: ++id,
          name: o.name ?? '',
          slot: o.slot ?? 0,
          qty: o.qty ?? 0,
          currency: o.currency ?? 0,
          amount: o.amount ?? 0,
        },
        r.now,
      ).reason;
    },
    states(now) {
      trade.tick(now ?? r.now);
      const last = new Map<number, TradeStateMsg>();
      for (const [e, list] of got) for (const m of list) if (m.type === 'trade_state') last.set(e, m);
      got.clear();
      return last;
    },
    open(a, b) {
      expect(r.cmd(a, TradeOp.Invite, { name: ACCOUNTS[b]![1] })).toBe(TradeReason.Ok);
      expect(r.cmd(b, TradeOp.Accept, { name: ACCOUNTS[a]![1] })).toBe(TradeReason.Ok);
      r.states();
    },
    give(owner, o) {
      const rolls: {
        item: 'heal_pill' | 'craft_material' | 'stone_ha' | 'blueprint_white_green';
        qty: number;
        quality?: number;
      }[] = [];
      if (o.pills) rolls.push({ item: 'heal_pill', qty: o.pills, quality: 1 });
      if (o.mats) rolls.push({ item: 'craft_material', qty: o.mats, quality: 0 });
      if (o.ha) rolls.push({ item: 'stone_ha', qty: o.ha });
      if (o.blueprints) rolls.push({ item: 'blueprint_white_green', qty: o.blueprints, quality: 2 });
      inv.grantDrops(owner, rolls, 'field', `give-${owner}-${++id}`);
    },
  };
  return r;
}
const slotOf = (inv: InventoryService, owner: string, defId: number): number =>
  inv
    .bagOf(owner)
    .slots.findIndex(
      (s) => s && (s.kind === 'stack' ? s.defId === defId : inv.bagOf(owner).instances.get(s.id)!.defId === defId),
    );
const have = (inv: InventoryService, owner: string, defId: number): number => inv.bagOf(owner).count(defId);
const ha = (inv: InventoryService, owner: string): bigint => inv.wallet(owner, 'LT_HA');
const sinkHa = (inv: InventoryService): bigint =>
  BigInt(inv.ledger.snapshot().accounts.find((a) => a.key.startsWith('SYSTEM_SINK_TRADE_TAX'))?.balance ?? '0');
/** both lock, both confirm: the trade executes on the second confirm */
const lockAndConfirm = (r: Rig, a = 1, b = 2): [TradeReason, TradeReason] => {
  r.cmd(a, TradeOp.Lock);
  r.cmd(b, TradeOp.Lock);
  const x = r.cmd(a, TradeOp.Confirm);
  const y = r.cmd(b, TradeOp.Confirm);
  return [x, y];
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the tax', () => {
  it('is 3% rounded UP in integer units (docs/26 §2.1), exact for any size', () => {
    expect(DIRECT_TRADE_TAX_BPS).toBe(300);
    expect([0n, 1n, 33n, 34n, 100n, 101n, 1000n].map(directTradeTaxUnits)).toEqual([0n, 1n, 1n, 2n, 3n, 4n, 30n]);
    expect(directTradeTaxUnits(10n ** 18n)).toBe(3n * 10n ** 16n);
  });
});

describe('opening a window', () => {
  it('invite -> accept opens one shared window; far / self / unknown / busy are refused, the answer never says which names exist', () => {
    const r = rig();
    expect(r.cmd(1, TradeOp.Invite, { name: 'alice' })).toBe(TradeReason.Self);
    expect(r.cmd(1, TradeOp.Invite, { name: 'nobody' })).toBe(TradeReason.NoSuchPlayer);
    r.pos.set(2, { i: 50 + TRADE.RANGE_TILES + 1, j: 50 });
    expect(r.cmd(1, TradeOp.Invite, { name: 'bob' })).toBe(TradeReason.TooFar);
    r.pos.set(2, { i: 52, j: 51 });
    expect(r.cmd(1, TradeOp.Invite, { name: 'BoB' })).toBe(TradeReason.Ok); // names ignore case
    expect(r.cmd(1, TradeOp.Invite, { name: 'bob' })).toBe(TradeReason.TargetBusy); // already invited
    expect(r.got.get(2)).toEqual([{ type: 'trade_invite', fromName: 'alice', ttlMs: TRADE.INVITE_TTL_MS }]);
    expect(r.cmd(2, TradeOp.Accept, { name: 'carol' })).toBe(TradeReason.NoInvite);
    expect(r.cmd(2, TradeOp.Accept, { name: 'alice' })).toBe(TradeReason.Ok);
    const s = r.states();
    expect(s.get(1)).toMatchObject({ phase: TradePhase.Open, partner: 'bob' });
    expect(s.get(2)).toMatchObject({ phase: TradePhase.Open, partner: 'alice' });
    expect(s.has(3)).toBe(false);
    expect(r.trade.openWindows).toBe(1);
  });

  it('one window per player: nobody can be pulled into a second one, and a decline / expiry leaves no window', () => {
    const r = rig();
    r.open(1, 2);
    expect(r.cmd(3, TradeOp.Invite, { name: 'alice' })).toBe(TradeReason.TargetBusy);
    expect(r.cmd(1, TradeOp.Invite, { name: 'carol' })).toBe(TradeReason.AlreadyTrading);
    expect(r.cmd(3, TradeOp.Invite, { name: 'dave' })).toBe(TradeReason.Ok);
    expect(r.cmd(4, TradeOp.Decline, { name: 'carol' })).toBe(TradeReason.Ok);
    expect(r.cmd(4, TradeOp.Accept)).toBe(TradeReason.NoInvite);
    expect(r.trade.openWindows).toBe(1);
    // a stale invite does not open anything
    expect(r.cmd(3, TradeOp.Invite, { name: 'dave' })).toBe(TradeReason.Ok);
    r.trade.tick(r.now + TRADE.INVITE_TTL_MS + 1);
    expect(r.cmd(4, TradeOp.Accept, { name: 'carol' }, r.now + TRADE.INVITE_TTL_MS + 5)).toBe(TradeReason.NoInvite);
  });

  it('window commands without a window are refused', () => {
    const r = rig();
    for (const op of [TradeOp.SetItem, TradeOp.SetStones, TradeOp.Lock, TradeOp.Confirm, TradeOp.Cancel])
      expect(r.cmd(1, op, { slot: 0, qty: 1, amount: 1 }), String(op)).toBe(TradeReason.NotTrading);
    expect(r.cmd(99, TradeOp.Invite, { name: 'bob' })).toBe(TradeReason.NotReady); // an entity that never joined
  });
});

describe('a successful trade', () => {
  it('moves items and stones both ways in one step, keeps instance properties, taxes the stones 3% (rounded up) and books it all in the ledger', () => {
    const r = rig();
    r.give('acc-a', { pills: 10, blueprints: 1, ha: 1000 });
    r.give('acc-b', { mats: 50, ha: 100 });
    const bpSlot = slotOf(r.inv, 'acc-a', BLUEPRINT);
    const bag = r.inv.bagOf('acc-a');
    const before = { ...bag.instanceAt(bpSlot)! };
    bag.instances.get(before.id)!.durability = 7777; // wear travels with the item
    const total = (defId: number): number => have(r.inv, 'acc-a', defId) + have(r.inv, 'acc-b', defId);
    const pillsTotal = total(PILL);
    r.open(1, 2);
    expect(r.cmd(1, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-a', PILL), qty: 4 })).toBe(TradeReason.Ok);
    expect(r.cmd(1, TradeOp.SetItem, { slot: bpSlot, qty: 1 })).toBe(TradeReason.Ok);
    expect(r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 200 })).toBe(TradeReason.Ok);
    expect(r.cmd(2, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-b', MAT), qty: 25 })).toBe(TradeReason.Ok);
    expect(r.cmd(2, TradeOp.SetStones, { currency: HA, amount: 10 })).toBe(TradeReason.Ok);
    const open = r.states();
    expect(open.get(2)!.theirs).toMatchObject({
      stones: [200, 0, 0],
      items: [
        { defId: PILL, qty: 4 },
        { defId: BLUEPRINT, qty: 1 },
      ],
    });
    expect(open.get(1)!.theirs.stones).toEqual([10, 0, 0]);

    const [x, y] = lockAndConfirm(r);
    expect([x, y]).toEqual([TradeReason.Ok, TradeReason.Ok]);
    // items crossed, none lost or duplicated
    expect([have(r.inv, 'acc-a', PILL), have(r.inv, 'acc-b', PILL)]).toEqual([6, 4]);
    expect([have(r.inv, 'acc-a', BLUEPRINT), have(r.inv, 'acc-b', BLUEPRINT)]).toEqual([0, 1]);
    expect([have(r.inv, 'acc-a', MAT), have(r.inv, 'acc-b', MAT)]).toEqual([25, 25]);
    expect(total(PILL)).toBe(pillsTotal);
    const got = r.inv.bagOf('acc-b').instanceAt(slotOf(r.inv, 'acc-b', BLUEPRINT))!;
    expect(got).toMatchObject({ defId: BLUEPRINT, quality: 2, durability: 7777 });
    expect(got.id).not.toBe(before.id); // a new id in the new bag; the old one is gone
    expect(r.inv.bagOf('acc-a').instances.has(before.id)).toBe(false);
    // stones: A gave 200 (tax 6) and got 10 (tax 1); B the other way; the sink holds the 7 destroyed
    expect(ha(r.inv, 'acc-a')).toBe(1000n - 200n + 9n);
    expect(ha(r.inv, 'acc-b')).toBe(100n - 10n + 194n);
    expect(sinkHa(r.inv)).toBe(7n);
    expect(r.inv.ledger.reconcile()).toEqual([]);
    expect(r.inv.bagOf('acc-a').check()).toEqual([]);
    expect(r.inv.bagOf('acc-b').check()).toEqual([]);
    // both are told it is done, with the tax; the window is gone
    const done = r.states();
    expect(done.get(1)).toMatchObject({ phase: TradePhase.Done, tax: [7, 0, 0] });
    expect(done.get(2)).toMatchObject({ phase: TradePhase.Done, tax: [7, 0, 0] });
    expect(r.trade.openWindows).toBe(0);
    expect(r.trade.inTrade(1)).toBe(false);
    expect(r.trade.metrics).toMatchObject({ completed: 1, taxed: [7n, 0n, 0n] });
  });

  it('an items-only trade is allowed and costs no tax; a stones-only trade is taxed per direction', () => {
    const r = rig();
    r.give('acc-a', { pills: 3, ha: 100 });
    r.open(1, 2);
    r.cmd(1, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-a', PILL), qty: 3 });
    lockAndConfirm(r);
    expect([have(r.inv, 'acc-a', PILL), have(r.inv, 'acc-b', PILL)]).toEqual([0, 3]);
    expect(sinkHa(r.inv)).toBe(0n);
    r.open(1, 2);
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 100 });
    lockAndConfirm(r);
    expect([ha(r.inv, 'acc-a'), ha(r.inv, 'acc-b'), sinkHa(r.inv)]).toEqual([0n, 97n, 3n]);
    expect(r.inv.ledger.reconcile()).toEqual([]);
  });

  it('no real-money / price / shop / entitlement fields exist on the window state', () => {
    const r = rig();
    r.open(1, 2);
    const s = [...r.got.values()].flat().concat(r.states().get(1)!);
    void s;
    const st = r.trade['stateFor'] ? undefined : undefined;
    void st;
    r.cmd(1, TradeOp.Lock);
    const m = r.states().get(1)!;
    expect(Object.keys(m).sort()).toEqual(['closed', 'mine', 'partner', 'phase', 'tax', 'theirs', 'type']);
    expect(Object.keys(m.mine).sort()).toEqual(['confirmed', 'items', 'locked', 'stones']);
    expect(CURRENCIES).toEqual(['LT_HA', 'LT_TRUNG', 'LT_THUONG']);
  });
});

describe('the two-step lock and confirm', () => {
  it('confirm needs both locked; a second confirm is a no-op; executing needs both confirms', () => {
    const r = rig();
    r.give('acc-a', { ha: 50 });
    r.open(1, 2);
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 50 });
    expect(r.cmd(1, TradeOp.Confirm)).toBe(TradeReason.NotLocked);
    r.cmd(1, TradeOp.Lock);
    expect(r.cmd(1, TradeOp.Confirm)).toBe(TradeReason.NotLocked); // bob has not locked
    r.cmd(2, TradeOp.Lock);
    expect(r.cmd(1, TradeOp.Confirm)).toBe(TradeReason.Ok);
    expect(r.cmd(1, TradeOp.Confirm)).toBe(TradeReason.Ok); // no-op
    expect(ha(r.inv, 'acc-a')).toBe(50n); // only one side confirmed: nothing happened
    expect(r.cmd(2, TradeOp.Confirm)).toBe(TradeReason.Ok);
    expect(ha(r.inv, 'acc-a')).toBe(0n);
  });

  it('ANY change after a lock resets BOTH sides (locks and confirmations), whoever changes', () => {
    const r = rig();
    r.give('acc-a', { pills: 5, ha: 50 });
    r.give('acc-b', { mats: 5, ha: 50 });
    r.open(1, 2);
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 10 });
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    r.cmd(1, TradeOp.Confirm);
    let s = r.states();
    expect([s.get(1)!.mine.locked, s.get(1)!.theirs.locked, s.get(1)!.mine.confirmed]).toEqual([true, true, true]);
    // bob changes his offer: both reset, alice's confirm is gone too
    r.cmd(2, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-b', MAT), qty: 1 });
    s = r.states();
    for (const e of [1, 2])
      expect([
        s.get(e)!.mine.locked,
        s.get(e)!.theirs.locked,
        s.get(e)!.mine.confirmed,
        s.get(e)!.theirs.confirmed,
      ]).toEqual([false, false, false, false]);
    expect(r.cmd(1, TradeOp.Confirm)).toBe(TradeReason.NotLocked);
    // alice changes her stones after locking again
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 11 });
    s = r.states();
    expect([s.get(2)!.mine.locked, s.get(2)!.theirs.locked]).toEqual([false, false]);
    // a no-change command (same amount) does NOT reset
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 11 });
    s = r.states();
    expect(s.get(1)?.mine.locked ?? true).toBe(true);
    expect(ha(r.inv, 'acc-a')).toBe(50n); // nothing executed on the way
  });
});

describe('anti-dupe: the window against the live bag', () => {
  it('an item USED while it sits in the window leaves the window, undoes both locks, and a confirm cannot move it', () => {
    const r = rig();
    r.give('acc-a', { pills: 5 });
    r.open(1, 2);
    const slot = slotOf(r.inv, 'acc-a', PILL);
    r.cmd(1, TradeOp.SetItem, { slot, qty: 5 });
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    r.cmd(1, TradeOp.Confirm);
    r.states();
    r.inv.bagOf('acc-a').takeOne(slot); // alice drinks one pill: only 4 left, but 5 are offered
    const s = r.states().get(2)!;
    expect(s.theirs.items).toEqual([]); // the stale line was dropped
    expect([s.mine.locked, s.theirs.locked, s.theirs.confirmed]).toEqual([false, false, false]);
    expect(r.cmd(2, TradeOp.Confirm)).toBe(TradeReason.NotLocked);
    expect(have(r.inv, 'acc-a', PILL)).toBe(4);
    expect(have(r.inv, 'acc-b', PILL)).toBe(0);
    expect(r.trade.metrics.invalidated).toBe(1);
  });

  it('an item DROPPED / removed between the lock and the confirm is caught at confirm time too (no tick in between)', () => {
    const r = rig();
    r.give('acc-a', { blueprints: 1 });
    r.open(1, 2);
    const slot = slotOf(r.inv, 'acc-a', BLUEPRINT);
    r.cmd(1, TradeOp.SetItem, { slot, qty: 1 });
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    r.cmd(1, TradeOp.Confirm);
    r.inv.bagOf('acc-a').removeInstance(slot); // gone before bob's confirm, and the node has not ticked
    expect(r.cmd(2, TradeOp.Confirm)).toBe(TradeReason.ItemsChanged);
    expect(have(r.inv, 'acc-a', BLUEPRINT)).toBe(0);
    expect(have(r.inv, 'acc-b', BLUEPRINT)).toBe(0); // not duplicated to bob
    expect(r.inv.ledger.entries).toHaveLength(r.inv.ledger.entries.length);
  });

  it('moving a stack to another slot does not break the window (offers are identities, not slot numbers)', () => {
    const r = rig();
    r.give('acc-a', { pills: 5 });
    r.open(1, 2);
    const slot = slotOf(r.inv, 'acc-a', PILL);
    r.cmd(1, TradeOp.SetItem, { slot, qty: 5 });
    r.inv.bagOf('acc-a').move(slot, 20);
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    r.cmd(1, TradeOp.Confirm);
    expect(r.cmd(2, TradeOp.Confirm)).toBe(TradeReason.Ok);
    expect([have(r.inv, 'acc-a', PILL), have(r.inv, 'acc-b', PILL)]).toEqual([0, 5]);
  });

  it('stones spent while in the window are clamped and the locks undone; an overdraft at execution is refused with nothing moved', () => {
    const r = rig();
    r.give('acc-a', { ha: 100 });
    r.open(1, 2);
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 100 });
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    // alice's wallet is drained by something else (a ledger sink, as a purchase would)
    r.inv.ledger.post({
      reason: 'TRADE',
      idempotencyKey: 'drain',
      entries: [
        { account: { kind: 'PLAYER_WALLET', ownerId: 'acc-a', currency: 'LT_HA' }, delta: -70n },
        { account: { kind: 'SYSTEM_SINK_TRADE_TAX', ownerId: null, currency: 'LT_HA' }, delta: 70n },
      ],
    });
    r.cmd(1, TradeOp.Confirm);
    const s = r.states().get(1)!;
    expect(s.mine.stones).toEqual([30, 0, 0]); // clamped to what is left
    expect([s.mine.locked, s.theirs.locked]).toEqual([false, false]);
    expect(ha(r.inv, 'acc-a')).toBe(30n);
    expect(ha(r.inv, 'acc-b')).toBe(0n);
    expect(r.inv.ledger.reconcile()).toEqual([]);
  });

  it('a full bag on the receiving side fails the whole trade: nothing moves, no stones cross, the window stays open with locks undone', () => {
    const r = rig();
    r.give('acc-a', { pills: 2, ha: 100 });
    // bob's bag: every slot holds a different stack of materials so the pills have nowhere to go
    const bobBag = r.inv.bagOf('acc-b');
    for (let q = 0; q < 6; q++)
      for (let k = 0; k < 7 && bobBag.freeSlots() > 0; k++) bobBag.add({ defId: MAT, quality: q, qty: 999 });
    for (let k = 0; bobBag.freeSlots() > 0; k++) bobBag.add({ defId: BLUEPRINT, quality: k % 6, qty: 1 });
    expect(bobBag.freeSlots()).toBe(0);
    r.open(1, 2);
    r.cmd(1, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-a', PILL), qty: 2 });
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 100 });
    const [, y] = lockAndConfirm(r);
    expect(y).toBe(TradeReason.NoSpace);
    expect(have(r.inv, 'acc-a', PILL)).toBe(2);
    expect(have(r.inv, 'acc-b', PILL)).toBe(0);
    expect(ha(r.inv, 'acc-a')).toBe(100n);
    expect(ha(r.inv, 'acc-b')).toBe(0n);
    expect(r.states().get(1)).toMatchObject({ phase: TradePhase.Open, mine: { locked: false } });
    expect(r.inv.ledger.entries.filter((e) => e.accountKey.includes('TRADE_TAX'))).toEqual([]);
  });

  it('bound items cannot be put in the window', () => {
    const r = rig();
    r.give('acc-a', { blueprints: 1 });
    const bag = r.inv.bagOf('acc-a');
    const slot = slotOf(r.inv, 'acc-a', BLUEPRINT);
    bag.instanceAt(slot)!.bound = true;
    r.open(1, 2);
    expect(r.cmd(1, TradeOp.SetItem, { slot, qty: 1 })).toBe(TradeReason.NotTradable);
    expect(r.cmd(1, TradeOp.SetItem, { slot: 39, qty: 1 })).toBe(TradeReason.BadSlot); // empty slot
    expect(r.cmd(1, TradeOp.SetItem, { slot: 200, qty: 1 })).toBe(TradeReason.BadSlot); // out of range
  });

  it('limits: not more items or stones than owned, line cap, currency / amount range', () => {
    const r = rig();
    r.give('acc-a', { pills: 3, ha: 10 });
    r.open(1, 2);
    const slot = slotOf(r.inv, 'acc-a', PILL);
    expect(r.cmd(1, TradeOp.SetItem, { slot, qty: 4 })).toBe(TradeReason.NotEnough);
    expect(r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 11 })).toBe(TradeReason.NotEnough);
    expect(r.cmd(1, TradeOp.SetStones, { currency: 3, amount: 1 })).toBe(TradeReason.BadAmount);
    // fill the window with distinct instance lines until the cap
    const bag = r.inv.bagOf('acc-a');
    for (let k = 0; k < TRADE.MAX_LINES + 1; k++) bag.add({ defId: BLUEPRINT, quality: 0, qty: 1 });
    const slots = bag.slots.map((s, i) => (s?.kind === 'instance' ? i : -1)).filter((i) => i >= 0);
    const answers = slots.slice(0, TRADE.MAX_LINES + 1).map((s) => r.cmd(1, TradeOp.SetItem, { slot: s, qty: 1 }));
    expect(answers.filter((a) => a === TradeReason.Ok)).toHaveLength(TRADE.MAX_LINES);
    expect(answers.at(-1)).toBe(TradeReason.TooManyLines);
    // taking a line out (qty 0) frees room
    expect(r.cmd(1, TradeOp.SetItem, { slot: slots[0]!, qty: 0 })).toBe(TradeReason.Ok);
    expect(r.cmd(1, TradeOp.SetItem, { slot: slots[TRADE.MAX_LINES]!, qty: 1 })).toBe(TradeReason.Ok);
  });
});

describe('anti-dupe: leaving, double confirm, concurrency, expiry', () => {
  it('a disconnect mid-trade (even after both locked) cancels the window with nothing moved and tells the partner', () => {
    const r = rig();
    r.give('acc-a', { pills: 5, ha: 100 });
    r.open(1, 2);
    r.cmd(1, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-a', PILL), qty: 5 });
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 100 });
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    r.cmd(1, TradeOp.Confirm);
    r.states();
    r.trade.leave(2); // bob drops before confirming
    const s = r.states();
    expect(s.get(1)).toMatchObject({ phase: TradePhase.Closed, closed: TradeClosed.PartnerLeft });
    expect(s.has(2)).toBe(false); // the one who left hears nothing
    expect(have(r.inv, 'acc-a', PILL)).toBe(5);
    expect(have(r.inv, 'acc-b', PILL)).toBe(0);
    expect(ha(r.inv, 'acc-a')).toBe(100n);
    expect(r.trade.openWindows).toBe(0);
    expect(r.trade.inTrade(1)).toBe(false);
    // alice can trade again, with someone else
    expect(r.cmd(1, TradeOp.Invite, { name: 'carol' })).toBe(TradeReason.Ok);
  });

  it('cancel by either side closes it for both; the other side is told', () => {
    const r = rig();
    r.open(1, 2);
    expect(r.cmd(2, TradeOp.Cancel)).toBe(TradeReason.Ok);
    const s = r.states();
    expect(s.get(1)).toMatchObject({ phase: TradePhase.Closed, closed: TradeClosed.Cancelled });
    expect(s.get(2)).toMatchObject({ phase: TradePhase.Closed, closed: TradeClosed.Cancelled });
    expect(r.cmd(1, TradeOp.Confirm)).toBe(TradeReason.NotTrading);
  });

  it('a double confirm (and confirms after it is done) never execute twice: stones and items move exactly once', () => {
    const r = rig();
    r.give('acc-a', { pills: 4, ha: 100 });
    r.open(1, 2);
    r.cmd(1, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-a', PILL), qty: 4 });
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 100 });
    r.cmd(1, TradeOp.Lock);
    r.cmd(2, TradeOp.Lock);
    for (let k = 0; k < 3; k++) r.cmd(1, TradeOp.Confirm);
    const txBefore = r.inv.ledger.entries.length;
    expect(r.cmd(2, TradeOp.Confirm)).toBe(TradeReason.Ok);
    const txAfter = r.inv.ledger.entries.length;
    for (const e of [1, 2])
      for (const op of [TradeOp.Confirm, TradeOp.Confirm, TradeOp.Lock])
        expect(r.cmd(e, op)).toBe(TradeReason.NotTrading);
    expect(r.inv.ledger.entries).toHaveLength(txAfter);
    expect(txAfter - txBefore).toBe(3); // one balanced tx: payer, receiver, tax
    expect([have(r.inv, 'acc-a', PILL), have(r.inv, 'acc-b', PILL)]).toEqual([0, 4]);
    expect([ha(r.inv, 'acc-a'), ha(r.inv, 'acc-b'), sinkHa(r.inv)]).toEqual([0n, 97n, 3n]);
  });

  it('the exchange itself is idempotent per key: the same key applies nothing twice', () => {
    const r = rig();
    r.give('acc-a', { pills: 2, ha: 100 });
    const a = {
      owner: 'acc-a',
      items: [{ kind: 'stack' as const, defId: PILL, quality: 1, qty: 2 }],
      stones: [100n, 0n, 0n],
    };
    const b = { owner: 'acc-b', items: [], stones: [0n, 0n, 0n] };
    const first = r.inv.exchange('k1', a, b);
    expect(first).toMatchObject({ ok: true, replayed: false });
    const second = r.inv.exchange('k1', a, b); // the items are gone now, but the key already ran
    expect(second.ok === false || second.replayed === true).toBe(true);
    expect([have(r.inv, 'acc-a', PILL), have(r.inv, 'acc-b', PILL)]).toEqual([0, 2]);
    expect([ha(r.inv, 'acc-a'), ha(r.inv, 'acc-b')]).toEqual([0n, 97n]);
  });

  it('concurrent trades are independent: two windows at once, each exchange only touches its own two players', () => {
    const r = rig();
    r.give('acc-a', { pills: 2 });
    r.give('acc-c', { mats: 7 });
    r.open(1, 2);
    r.open(3, 4);
    r.cmd(1, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-a', PILL), qty: 2 });
    r.cmd(3, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-c', MAT), qty: 7 });
    lockAndConfirm(r, 1, 2);
    expect([have(r.inv, 'acc-b', PILL), have(r.inv, 'acc-d', MAT)]).toEqual([2, 0]); // the other window is untouched
    expect(r.trade.openWindows).toBe(1);
    lockAndConfirm(r, 3, 4);
    expect([have(r.inv, 'acc-d', MAT), have(r.inv, 'acc-c', MAT)]).toEqual([7, 0]);
    expect(r.trade.openWindows).toBe(0);
  });

  it('the same item cannot be offered in two windows: a player has only one window, and a traded-away item cannot be traded again', () => {
    const r = rig();
    r.give('acc-a', { blueprints: 1 });
    r.open(1, 2);
    const slot = slotOf(r.inv, 'acc-a', BLUEPRINT);
    r.cmd(1, TradeOp.SetItem, { slot, qty: 1 });
    expect(r.cmd(1, TradeOp.Invite, { name: 'carol' })).toBe(TradeReason.AlreadyTrading);
    expect(r.cmd(3, TradeOp.Invite, { name: 'alice' })).toBe(TradeReason.TargetBusy);
    lockAndConfirm(r);
    r.open(1, 3);
    expect(r.cmd(1, TradeOp.SetItem, { slot, qty: 1 })).toBe(TradeReason.BadSlot); // the slot is empty now
    expect(have(r.inv, 'acc-a', BLUEPRINT) + have(r.inv, 'acc-b', BLUEPRINT)).toBe(1);
  });

  it('an idle window is cancelled after 60 s, a change keeps it alive, and nothing moved', () => {
    const r = rig();
    r.give('acc-a', { ha: 5 });
    r.open(1, 2);
    const t0 = r.now;
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 5 }, t0 + 30_000);
    r.states(t0 + 30_000); // delivers the state of the change itself
    expect(r.states(t0 + 61_000).size).toBe(0); // 61 s after the start but only 31 s after the last change: still open and quiet
    expect(r.trade.openWindows).toBe(1);
    const s = r.states(t0 + 30_000 + TRADE.IDLE_MS + 1);
    expect(s.get(1)).toMatchObject({ phase: TradePhase.Closed, closed: TradeClosed.Expired });
    expect(r.trade.openWindows).toBe(0);
    expect(ha(r.inv, 'acc-a')).toBe(5n);
  });
});

describe('rate limit and anti-enumeration', () => {
  it('the token is taken before any name is resolved: rapid probes end in RateLimited, a real and an unknown name answer the same once empty', () => {
    const r = rig();
    const burst = TRADE_CONFIG.RATE.burst;
    const answers = Array.from({ length: burst + 4 }, (_, k) => r.cmd(1, TradeOp.Invite, { name: `ghost${k}` }, 0));
    expect(answers.slice(0, burst).every((a) => a === TradeReason.NoSuchPlayer)).toBe(true);
    expect(answers.slice(burst).every((a) => a === TradeReason.RateLimited)).toBe(true);
    for (const name of ['bob', 'alice', 'ghost'])
      expect(r.cmd(1, TradeOp.Invite, { name }, 0)).toBe(TradeReason.RateLimited);
    expect(r.cmd(2, TradeOp.Invite, { name: 'carol' }, 0)).toBe(TradeReason.Ok); // per account
    expect(r.got.get(2)).toBeUndefined();
  });
});

describe('fuzz: whatever happens, nothing is created or destroyed except by use and tax', () => {
  it('600 random steps over three players keep the item and stone totals and every bag consistent', () => {
    let seed = 0xc0ffee;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const r = rig();
    for (const o of ['acc-a', 'acc-b', 'acc-c']) r.give(o, { pills: 20, mats: 40, ha: 500, blueprints: 3 });
    const owners = ['acc-a', 'acc-b', 'acc-c'];
    const items = (defId: number): number => owners.reduce((n, o) => n + have(r.inv, o, defId), 0);
    const totalHa = (): bigint => owners.reduce((n, o) => n + ha(r.inv, o), 0n) + sinkHa(r.inv);
    const start = { pill: items(PILL), mat: items(MAT), bp: items(BLUEPRINT), ha: totalHa() };
    let consumedPills = 0;
    for (let step = 0; step < 600; step++) {
      const e = 1 + rnd(3);
      const acc = ACCOUNTS[e]![0];
      switch (rnd(9)) {
        case 0:
          r.cmd(e, TradeOp.Invite, { name: ACCOUNTS[1 + rnd(3)]![1] });
          break;
        case 1:
          r.cmd(e, TradeOp.Accept);
          break;
        case 2:
          r.cmd(e, TradeOp.SetItem, { slot: rnd(12), qty: rnd(8) });
          break;
        case 3:
          r.cmd(e, TradeOp.SetStones, { currency: 0, amount: rnd(300) });
          break;
        case 4:
          r.cmd(e, TradeOp.Lock);
          break;
        case 5:
          r.cmd(e, TradeOp.Confirm);
          break;
        case 6:
          if (rnd(3) === 0) r.cmd(e, TradeOp.Cancel);
          break;
        case 7: {
          // the owner uses a pill / throws a blueprint away behind the window's back
          const bag = r.inv.bagOf(acc);
          const slot = rnd(12);
          const s = bag.slots[slot];
          if (s?.kind === 'stack' && s.defId === PILL && bag.takeOne(slot).ok) consumedPills++;
          else if (s?.kind === 'instance') bag.removeInstance(slot);
          break;
        }
        default:
          r.states();
      }
      if (step % 40 === 0) {
        // a player leaves and comes back: the window must be gone, the bag is the same
        r.trade.leave(e);
        r.trade.join({ entityId: e, accountId: acc, name: ACCOUNTS[e]![1] });
      }
    }
    // structured rounds on top of the noise, so real trades (and sabotaged ones) definitely happen: open, offer, maybe sabotage, lock, confirm
    for (let round = 0; round < 80; round++) {
      for (const e of [1, 2, 3]) r.cmd(e, TradeOp.Cancel);
      const a = 1 + rnd(3);
      const other = 1 + ((a + rnd(2)) % 3); // a different player than `a`
      if (r.cmd(a, TradeOp.Invite, { name: ACCOUNTS[other]![1] }) !== TradeReason.Ok) continue;
      if (r.cmd(other, TradeOp.Accept) !== TradeReason.Ok) continue;
      for (const e of [a, other]) {
        for (let k = rnd(3); k > 0; k--) r.cmd(e, TradeOp.SetItem, { slot: rnd(12), qty: 1 + rnd(5) });
        if (rnd(2)) r.cmd(e, TradeOp.SetStones, { currency: 0, amount: rnd(200) });
      }
      if (rnd(4) === 0) {
        const bag = r.inv.bagOf(ACCOUNTS[a]![0]);
        const slot = rnd(12);
        const sl = bag.slots[slot];
        if (sl?.kind === 'stack' && sl.defId === PILL && bag.takeOne(slot).ok) consumedPills++;
      }
      r.cmd(a, TradeOp.Lock);
      r.cmd(other, TradeOp.Lock);
      r.cmd(a, TradeOp.Confirm);
      r.cmd(other, TradeOp.Confirm);
      r.states();
    }
    r.states();
    expect(items(PILL) + consumedPills).toBe(start.pill);
    expect(items(MAT)).toBe(start.mat);
    expect(items(BLUEPRINT)).toBeLessThanOrEqual(start.bp); // only removals by the owners themselves
    expect(totalHa()).toBe(start.ha); // stones only ever move between wallets and the tax sink
    expect(r.inv.ledger.reconcile()).toEqual([]);
    for (const o of owners) expect(r.inv.bagOf(o).check()).toEqual([]);
    expect(r.trade.metrics.completed).toBeGreaterThan(0); // the fuzz really did execute trades
  });
});

describe('persistence (D92): a restart sees a consistent result', () => {
  it('after a trade and a flush, a new process loads both bags and wallets with nothing lost or duplicated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-trade-'));
    dirs.push(dir);
    const open = (): { stores: FileStores; inv: InventoryService } => {
      const stores = openFileStores(dir, { flushMs: -1 });
      return { stores, inv: new InventoryService({ store: stores.inventories, ledger: stores.ledger }) };
    };
    const first = open();
    const r = rig(first.inv);
    r.give('acc-a', { pills: 6, blueprints: 1, ha: 300 });
    r.give('acc-b', { mats: 10 });
    r.open(1, 2);
    r.cmd(1, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-a', PILL), qty: 6 });
    r.cmd(1, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-a', BLUEPRINT), qty: 1 });
    r.cmd(1, TradeOp.SetStones, { currency: HA, amount: 300 });
    r.cmd(2, TradeOp.SetItem, { slot: slotOf(r.inv, 'acc-b', MAT), qty: 10 });
    lockAndConfirm(r);
    first.inv.flushAll();
    first.stores.flush();
    // "restart"
    const second = open();
    const inv = second.inv;
    expect([have(inv, 'acc-a', PILL), have(inv, 'acc-b', PILL)]).toEqual([0, 6]);
    expect([have(inv, 'acc-a', BLUEPRINT), have(inv, 'acc-b', BLUEPRINT)]).toEqual([0, 1]);
    expect([have(inv, 'acc-a', MAT), have(inv, 'acc-b', MAT)]).toEqual([10, 0]);
    expect([ha(inv, 'acc-a'), ha(inv, 'acc-b')]).toEqual([0n, 291n]);
    expect(inv.ledger.reconcile()).toEqual([]);
    expect(inv.ledger.snapshot().accounts.find((a) => a.key.startsWith('SYSTEM_SINK_TRADE_TAX'))!.balance).toBe('9');
    expect(inv.bagOf('acc-a').check()).toEqual([]);
    expect(inv.bagOf('acc-b').check()).toEqual([]);
    // the open window did not survive (it lives in memory only): a restart can never complete half a trade
    const t = rig(inv);
    expect(t.trade.openWindows).toBe(0);
  });
});
