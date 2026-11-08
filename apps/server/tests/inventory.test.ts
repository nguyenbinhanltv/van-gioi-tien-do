import { readFileSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveDrops, rngFloat, rngInt, rngSeed, type DropRoll, type RngState } from '@vgtd/shared';
import { ErrorCode } from '@vgtd/protocol';
import {
  Bag,
  DURABILITY_MAX,
  ITEM_DEFS,
  InMemoryInventoryStore,
  InventoryService,
  Ledger,
  LedgerError,
  WorldNode,
  itemDefByKey,
  type AccountRef,
  type ClientTransport,
} from '../src/index.js';

const wallet = (owner: string, currency: 'LT_HA' | 'LT_TRUNG' | 'LT_THUONG' = 'LT_HA'): AccountRef => ({
  kind: 'PLAYER_WALLET',
  ownerId: owner,
  currency,
});
const faucet = (currency: 'LT_HA' | 'LT_TRUNG' | 'LT_THUONG' = 'LT_HA'): AccountRef => ({
  kind: 'SYSTEM_FAUCET_DROP_MOB',
  ownerId: null,
  currency,
});
const seqIds = (): (() => string) => {
  let n = 0;
  return () => `i${++n}`;
};
const HEAL = itemDefByKey('heal_pill')!;
const MAT = itemDefByKey('craft_material')!;
const BP = itemDefByKey('blueprint_gold_red')!;

describe('ledger (docs/26 invariants)', () => {
  it('applies a balanced transaction faucet -> wallet; the faucet may go negative', () => {
    const l = new Ledger();
    const r = l.post({
      reason: 'DROP',
      idempotencyKey: 'k1',
      entries: [
        { account: faucet(), delta: -5n },
        { account: wallet('a'), delta: 5n },
      ],
    });
    expect(r).toEqual({ txId: 1, replayed: false });
    expect(l.balance(wallet('a'))).toBe(5n);
    expect(l.balance(faucet())).toBe(-5n);
    expect(l.reconcile()).toEqual([]);
  });
  it('rejects unbalanced / empty / zero-amount transactions and changes nothing', () => {
    const l = new Ledger();
    expect(() =>
      l.post({ reason: 'DROP', idempotencyKey: 'u', entries: [{ account: wallet('a'), delta: 5n }] }),
    ).toThrow(LedgerError);
    expect(() => l.post({ reason: 'DROP', idempotencyKey: 'e', entries: [] })).toThrow(/without entries/);
    expect(() =>
      l.post({
        reason: 'DROP',
        idempotencyKey: 'z',
        entries: [
          { account: faucet(), delta: 0n },
          { account: wallet('a'), delta: 0n },
        ],
      }),
    ).toThrow(/zero/);
    expect(l.entries).toHaveLength(0);
    expect(l.balance(wallet('a'))).toBe(0n);
  });
  it('never lets a player wallet go negative, atomically (no entry of the rejected tx is applied)', () => {
    const l = new Ledger();
    l.post({
      reason: 'DROP',
      idempotencyKey: 'g',
      entries: [
        { account: faucet(), delta: -3n },
        { account: wallet('a'), delta: 3n },
      ],
    });
    const before = l.entries.length;
    expect(() =>
      l.post({
        reason: 'DROP',
        idempotencyKey: 'bad',
        entries: [
          { account: wallet('a'), delta: -4n },
          { account: wallet('b'), delta: 4n },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_FUNDS' }));
    expect(l.entries).toHaveLength(before);
    expect(l.balance(wallet('a'))).toBe(3n);
    expect(l.balance(wallet('b'))).toBe(0n);
  });
  it('idempotency: same key + content replays, same key + other content is an error', () => {
    const l = new Ledger();
    const tx = {
      reason: 'DROP' as const,
      idempotencyKey: 'once',
      entries: [
        { account: faucet(), delta: -2n },
        { account: wallet('a'), delta: 2n },
      ],
    };
    expect(l.post(tx).replayed).toBe(false);
    expect(l.post(tx)).toEqual({ txId: 1, replayed: true });
    expect(l.balance(wallet('a'))).toBe(2n);
    expect(() =>
      l.post({
        ...tx,
        entries: [
          { account: faucet(), delta: -9n },
          { account: wallet('a'), delta: 9n },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_MISMATCH' }));
  });
  it('keeps currencies separate: each currency must balance on its own', () => {
    const l = new Ledger();
    expect(() =>
      l.post({
        reason: 'DROP',
        idempotencyKey: 'x',
        entries: [
          { account: faucet('LT_HA'), delta: -1n },
          { account: wallet('a', 'LT_TRUNG'), delta: 1n },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNBALANCED' }));
  });
});

describe('bag', () => {
  it('stackables fill partial stacks first, then new slots, never beyond the stack limit', () => {
    const b = new Bag(4, seqIds());
    expect(b.add({ defId: HEAL.id, quality: 1, qty: 90 }).ok).toBe(true);
    expect(b.add({ defId: HEAL.id, quality: 1, qty: 20 }).ok).toBe(true); // 9 into slot 0, 11 into slot 1
    expect(b.slots[0]).toMatchObject({ qty: 99 });
    expect(b.slots[1]).toMatchObject({ qty: 11 });
    expect(b.add({ defId: HEAL.id, quality: 2, qty: 1 }).ok).toBe(true); // other quality = other stack
    expect(b.count(HEAL.id)).toBe(111);
    expect(b.count(HEAL.id, 1)).toBe(110);
    expect(b.check()).toEqual([]);
  });
  it('a failed add leaves the bag exactly as it was (all-or-nothing)', () => {
    const b = new Bag(2, seqIds());
    b.add({ defId: MAT.id, quality: 0, qty: 999 });
    b.add({ defId: HEAL.id, quality: 0, qty: 99 });
    const before = JSON.stringify(b.snapshot());
    expect(b.add({ defId: MAT.id, quality: 0, qty: 1 })).toEqual({ ok: false, reason: 'NO_SPACE' });
    expect(b.add({ defId: BP.id, quality: 5, qty: 1 })).toEqual({ ok: false, reason: 'NO_SPACE' });
    expect(b.add({ defId: 9999, quality: 0, qty: 1 })).toEqual({ ok: false, reason: 'UNKNOWN_ITEM' });
    expect(b.add({ defId: MAT.id, quality: 0, qty: 0 })).toEqual({ ok: false, reason: 'BAD_QTY' });
    expect(b.add({ defId: MAT.id, quality: 9, qty: 1 })).toEqual({ ok: false, reason: 'BAD_QTY' });
    expect(JSON.stringify(b.snapshot())).toBe(before);
  });
  it('instances take one slot each with full durability; wear is clamped at 0 and bumps the version', () => {
    const b = new Bag(3, seqIds());
    expect(b.add({ defId: BP.id, quality: 4, qty: 2 }).ok).toBe(true);
    const inst = b.instanceAt(0)!;
    expect(inst).toMatchObject({ defId: BP.id, quality: 4, durability: DURABILITY_MAX, version: 1 });
    expect(b.loseDurability(0, 2500)).toEqual({ ok: true, value: 7500 });
    expect(b.loseDurability(0, 99_999)).toEqual({ ok: true, value: 0 });
    expect(b.instanceAt(0)!.version).toBe(3);
    expect(b.loseDurability(2, 1)).toEqual({ ok: false, reason: 'EMPTY_SLOT' });
    expect(b.loseDurability(9, 1)).toEqual({ ok: false, reason: 'BAD_SLOT' });
    const removed = b.removeInstance(0);
    expect(removed.ok && removed.value.id).toBe(inst.id);
    expect(b.check()).toEqual([]);
  });
  it('removeStack is all-or-nothing and takes from the last slots first', () => {
    const b = new Bag(3, seqIds());
    b.add({ defId: HEAL.id, quality: 0, qty: 150 }); // 99 + 51
    expect(b.removeStack(HEAL.id, 0, 200)).toEqual({ ok: false, reason: 'NOT_ENOUGH' });
    expect(b.count(HEAL.id)).toBe(150);
    expect(b.removeStack(HEAL.id, 0, 60).ok).toBe(true);
    expect(b.slots[0]).toMatchObject({ qty: 90 });
    expect(b.slots[1]).toBeNull();
    expect(b.removeStack(BP.id, 0, 1)).toEqual({ ok: false, reason: 'NOT_STACKABLE' });
  });
  it('move merges the same stack up to the limit, otherwise swaps; invalid slots are rejected', () => {
    const b = new Bag(4, seqIds());
    b.slots[0] = { kind: 'stack', defId: HEAL.id, quality: 0, qty: 60 };
    b.slots[1] = { kind: 'stack', defId: HEAL.id, quality: 0, qty: 60 };
    b.slots[2] = { kind: 'stack', defId: MAT.id, quality: 0, qty: 5 };
    expect(b.move(0, 1).ok).toBe(true); // 99 in slot 1, 21 left in slot 0
    expect([b.slots[0], b.slots[1]]).toEqual([
      { kind: 'stack', defId: HEAL.id, quality: 0, qty: 21 },
      { kind: 'stack', defId: HEAL.id, quality: 0, qty: 99 },
    ]);
    expect(b.move(2, 3).ok).toBe(true); // into an empty slot
    expect(b.slots[2]).toBeNull();
    expect(b.move(3, 0).ok).toBe(true); // different items: swap
    expect(b.slots[0]).toMatchObject({ defId: MAT.id });
    expect(b.slots[3]).toMatchObject({ defId: HEAL.id, qty: 21 });
    expect(b.move(2, 1)).toEqual({ ok: false, reason: 'EMPTY_SLOT' });
    expect(b.move(0, 9)).toEqual({ ok: false, reason: 'BAD_SLOT' });
    expect(b.check()).toEqual([]);
  });
  it('conservation: 500 random operations never create or destroy items and keep the structure valid', () => {
    const b = new Bag(10, seqIds());
    let rng: RngState = rngSeed(2026);
    const pick = (n: number): number => {
      const [v, next] = rngInt(rng, n);
      rng = next;
      return v;
    };
    const expected = new Map<string, number>(); // `${defId}:${quality}` -> count
    const add = (k: string, n: number): void => void expected.set(k, (expected.get(k) ?? 0) + n);
    for (let op = 0; op < 500; op++) {
      const kind = pick(5);
      const def = ITEM_DEFS[pick(ITEM_DEFS.length)]!;
      const quality = pick(3);
      const qty = def.kind === 'instance' ? 1 + pick(2) : 1 + pick(120);
      const key = `${def.id}:${quality}`;
      if (kind <= 1) {
        if (b.add({ defId: def.id, quality, qty }).ok) add(key, qty);
      } else if (kind === 2 && def.kind === 'stackable') {
        const have = b.count(def.id, quality);
        const take = 1 + pick(60);
        const r = b.removeStack(def.id, quality, take);
        expect(r.ok).toBe(take <= have);
        if (r.ok) add(key, -take);
      } else if (kind === 3) {
        const slot = pick(10);
        const inst = b.instanceAt(slot);
        const r = b.removeInstance(slot);
        if (r.ok && inst) add(`${inst.defId}:${inst.quality}`, -1);
      } else b.move(pick(10), pick(10));
      expect(b.check()).toEqual([]);
    }
    for (const [key, n] of expected) {
      const [d, q] = key.split(':').map(Number) as [number, number];
      expect(b.count(d, q), key).toBe(n);
    }
  });
});

describe('drop sink', () => {
  const rolls = (...r: DropRoll[]): DropRoll[] => r;
  it('pays stones through the ledger from the faucet and puts items in the bag', () => {
    const s = new InventoryService();
    s.onJoin('acc');
    const res = s.grantDrops(
      'acc',
      rolls(
        { item: 'stone_ha', qty: 3 },
        { item: 'stone_trung', qty: 1 },
        { item: 'heal_pill', qty: 1, quality: 2 },
        { item: 'blueprint_gold_red', qty: 1, quality: 5 },
      ),
      'field',
      'mob1@100',
    );
    expect(res.replayed).toBe(false);
    expect(s.wallet('acc', 'LT_HA')).toBe(3n);
    expect(s.wallet('acc', 'LT_TRUNG')).toBe(1n);
    expect(s.ledger.balance(faucet('LT_HA'))).toBe(-3n);
    expect(res.items.map((i) => i.where)).toEqual(['bag', 'bag']);
    expect(s.bagOf('acc').count(HEAL.id, 2)).toBe(1);
    expect(s.bagOf('acc').count(BP.id, 5)).toBe(1);
    expect(s.ledger.reconcile()).toEqual([]);
  });
  it('uses the faucet of the drop source (field / elite / boss)', () => {
    const s = new InventoryService();
    s.grantDrops('a', rolls({ item: 'stone_ha', qty: 1 }), 'elite', 'e');
    s.grantDrops('a', rolls({ item: 'stone_ha', qty: 2 }), 'boss', 'b');
    expect(s.ledger.balance({ kind: 'SYSTEM_FAUCET_DROP_ELITE', ownerId: null, currency: 'LT_HA' })).toBe(-1n);
    expect(s.ledger.balance({ kind: 'SYSTEM_FAUCET_DROP_BOSS', ownerId: null, currency: 'LT_HA' })).toBe(-2n);
    expect(s.wallet('a', 'LT_HA')).toBe(3n);
  });
  it('replaying the same kill key grants nothing twice (stones and items)', () => {
    const s = new InventoryService();
    const r = rolls({ item: 'stone_ha', qty: 2 }, { item: 'craft_material', qty: 5 });
    const first = s.grantDrops('a', r, 'field', 'k');
    const again = s.grantDrops('a', r, 'field', 'k');
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(s.wallet('a', 'LT_HA')).toBe(2n);
    expect(s.bagOf('a').count(MAT.id)).toBe(5);
    // another kill, or another owner with the same key, is a different grant
    s.grantDrops('a', r, 'field', 'k2');
    s.grantDrops('b', r, 'field', 'k');
    expect(s.wallet('a', 'LT_HA')).toBe(4n);
    expect(s.wallet('b', 'LT_HA')).toBe(2n);
  });
  it('a full bag parks the roll in the pending queue, claimPending moves it after space is freed, a full queue reports loss', () => {
    const s = new InventoryService({ bagSlots: 1, pendingMax: 1 });
    s.onJoin('a'); // online: bagOf is the live bag we mutate below
    s.grantDrops('a', rolls({ item: 'blueprint_white_green', qty: 1, quality: 0 }), 'field', 'k1'); // fills the only slot
    const res = s.grantDrops(
      'a',
      rolls({ item: 'heal_pill', qty: 3, quality: 0 }, { item: 'craft_material', qty: 7 }),
      'field',
      'k2',
    );
    expect(res.items.map((i) => i.where)).toEqual(['pending', 'lost']);
    expect(s.pendingOf('a')).toEqual([{ defId: HEAL.id, quality: 0, qty: 3 }]);
    expect(s.lostItems).toBe(7);
    expect(s.claimPending('a')).toBe(0); // still no room
    s.bagOf('a').removeInstance(0);
    expect(s.claimPending('a')).toBe(1);
    expect(s.pendingOf('a')).toEqual([]);
    expect(s.bagOf('a').count(HEAL.id)).toBe(3);
  });
  it('conservation over many real kills: granted = bag + pending + lost, ledger consistent', () => {
    const s = new InventoryService({ bagSlots: 6, pendingMax: 3 });
    let rng: RngState = rngSeed(77);
    const draw = (): number => {
      const [v, next] = rngFloat(rng);
      rng = next;
      return v;
    };
    const granted = new Map<number, number>();
    let stonesHa = 0n;
    for (let kill = 0; kill < 400; kill++) {
      const rs = resolveDrops({ source: kill % 7 === 0 ? 'elite' : 'field', monsterRealm: 1 + (kill % 3) }, draw);
      const res = s.grantDrops('a', rs, kill % 7 === 0 ? 'elite' : 'field', `k${kill}`);
      for (const it of res.items) granted.set(it.defId, (granted.get(it.defId) ?? 0) + it.qty);
      for (const st of res.stones) if (st.currency === 'LT_HA') stonesHa += st.amount;
    }
    const heldTotal =
      ITEM_DEFS.reduce((n, d) => n + s.bagOf('a').count(d.id), 0) + s.pendingOf('a').reduce((n, p) => n + p.qty, 0);
    const grantedTotal = [...granted.values()].reduce((a, b) => a + b, 0);
    expect(heldTotal + s.lostItems).toBe(grantedTotal);
    expect(s.wallet('a', 'LT_HA')).toBe(stonesHa);
    expect(
      s.ledger.balance(faucet('LT_HA')) +
        s.ledger.balance({ kind: 'SYSTEM_FAUCET_DROP_ELITE', ownerId: null, currency: 'LT_HA' }),
    ).toBe(-stonesHa);
    expect(s.ledger.reconcile()).toEqual([]);
    expect(s.bagOf('a').check()).toEqual([]);
  });
  it('is deterministic: the same seed gives the same inventory, ledger and result', () => {
    const run = (): string => {
      const s = new InventoryService({ bagSlots: 8 });
      let rng: RngState = rngSeed(5);
      const draw = (): number => {
        const [v, next] = rngFloat(rng);
        rng = next;
        return v;
      };
      for (let k = 0; k < 200; k++)
        s.grantDrops('a', resolveDrops({ source: 'field', monsterRealm: 1 }, draw), 'field', `k${k}`);
      return JSON.stringify([
        s.bagOf('a').snapshot(),
        s.pendingOf('a'),
        String(s.wallet('a', 'LT_HA')),
        s.ledger.entries.length,
      ]);
    };
    expect(run()).toBe(run());
  });
  it('module sources contain no ambient time or randomness and no money / shop logic', () => {
    const dir = pjoin(fileURLToPath(new URL('.', import.meta.url)), '../src/world/inventory');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(pjoin(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|setTimeout|hrtime/);
      expect(src, f).not.toMatch(/TIEN_NGOC|SYSTEM_FAUCET_IAP|receipt|price|entitlement/i);
    }
  });
});

describe('offline owners (a drop that resolves after the killer left)', () => {
  const stackQty = (snap: ReturnType<InMemoryInventoryStore['load']>, defId: number): number =>
    (snap?.bag.slots ?? []).reduce((n, s) => n + (s && s.kind === 'stack' && s.defId === defId ? s.qty : 0), 0);

  it('a grant to an owner with no onJoin is persisted at once and the owner is not kept in memory', () => {
    const store = new InMemoryInventoryStore();
    const s = new InventoryService({ store });
    expect(store.has('ghost')).toBe(false);
    const res = s.grantDrops(
      'ghost',
      [
        { item: 'heal_pill', qty: 4, quality: 1 },
        { item: 'blueprint_gold_red', qty: 1, quality: 5 },
        { item: 'stone_ha', qty: 2 },
      ],
      'field',
      'k1',
    );
    expect(res.items.map((i) => i.where)).toEqual(['bag', 'bag']);
    expect(s.loadedOwners).toBe(0); // nothing leaked
    const saved = store.load('ghost')!;
    expect(stackQty(saved, HEAL.id)).toBe(4);
    expect(saved.bag.instances).toHaveLength(1);
    expect(s.wallet('ghost', 'LT_HA')).toBe(2n); // the ledger is its own store
    // a second offline grant builds on the stored state (read-modify-write) and instance ids stay unique
    s.grantDrops(
      'ghost',
      [
        { item: 'heal_pill', qty: 3, quality: 1 },
        { item: 'blueprint_gold_red', qty: 1, quality: 5 },
      ],
      'field',
      'k2',
    );
    const again = store.load('ghost')!;
    expect(stackQty(again, HEAL.id)).toBe(7);
    expect(new Set(again.bag.instances.map((i) => i.id)).size).toBe(2);
    expect(s.loadedOwners).toBe(0);
    // joining later sees everything
    s.onJoin('ghost');
    expect(s.bagOf('ghost').count(HEAL.id)).toBe(7);
    expect(s.bagOf('ghost').count(BP.id)).toBe(2);
    expect(s.loadedOwners).toBe(1);
    s.onLeave('ghost');
    expect(s.loadedOwners).toBe(0);
  });

  it('a drop after the killer disconnected (join, leave, then grant) is not lost', () => {
    const store = new InMemoryInventoryStore();
    const s = new InventoryService({ store });
    s.onJoin('p');
    s.onLeave('p');
    s.grantDrops('p', [{ item: 'craft_material', qty: 9 }], 'elite', 'mob@100');
    expect(stackQty(store.load('p'), MAT.id)).toBe(9);
    expect(s.loadedOwners).toBe(0);
    // a restart (new service over the same store) still has them
    const s2 = new InventoryService({ store });
    s2.onJoin('p');
    expect(s2.bagOf('p').count(MAT.id)).toBe(9);
  });

  it('claimPending for an offline owner persists too; an online owner is saved on leave, not on every grant', () => {
    const store = new InMemoryInventoryStore();
    const s = new InventoryService({ store, bagSlots: 1, pendingMax: 2 });
    s.grantDrops(
      'o',
      [
        { item: 'blueprint_white_green', qty: 1, quality: 0 },
        { item: 'heal_pill', qty: 2, quality: 0 },
      ],
      'field',
      'k',
    ); // bag full -> pending
    expect(store.load('o')!.pending).toEqual([{ defId: HEAL.id, quality: 0, qty: 2 }]);
    expect(s.claimPending('o')).toBe(0);
    s.onJoin('o');
    s.bagOf('o').removeInstance(0);
    s.onLeave('o');
    expect(s.claimPending('o')).toBe(1); // offline claim
    expect(store.load('o')!.pending).toEqual([]);
    expect(stackQty(store.load('o'), HEAL.id)).toBe(2);
    expect(s.loadedOwners).toBe(0);

    s.onJoin('live');
    s.grantDrops('live', [{ item: 'craft_material', qty: 1 }], 'field', 'kk');
    expect(store.has('live')).toBe(false); // online: still only in memory until the last connection leaves
    expect(s.loadedOwners).toBe(1);
    s.onLeave('live');
    expect(store.has('live')).toBe(true);
  });
});

describe('persistence seam (store)', () => {
  it('leaving saves bag + pending + sequence, joining restores them; new instance ids never collide', () => {
    const store = new InMemoryInventoryStore();
    const s1 = new InventoryService({ store, bagSlots: 5, pendingMax: 5 });
    s1.onJoin('acc');
    s1.grantDrops(
      'acc',
      [
        { item: 'blueprint_gold_red', qty: 2, quality: 5 },
        { item: 'heal_pill', qty: 150, quality: 1 },
      ],
      'boss',
      'k1',
    );
    s1.bagOf('acc').loseDurability(0, 1234);
    s1.grantDrops(
      'acc',
      [
        { item: 'blueprint_white_green', qty: 3, quality: 0 },
        { item: 'craft_material', qty: 4 },
      ],
      'field',
      'k2',
    ); // 4 slots used: the 3 blueprints cannot fit (1 free) and wait in pending, the materials take the last slot
    const beforeBag = JSON.stringify(s1.bagOf('acc').snapshot());
    const beforePending = JSON.stringify(s1.pendingOf('acc'));
    s1.onLeave('acc');
    expect(store.has('acc')).toBe(true);

    // a new process: a fresh service over the same store
    const s2 = new InventoryService({ store, bagSlots: 5, pendingMax: 5 });
    s2.onJoin('acc');
    expect(JSON.stringify(s2.bagOf('acc').snapshot())).toBe(beforeBag);
    expect(JSON.stringify(s2.pendingOf('acc'))).toBe(beforePending);
    expect(s2.bagOf('acc').instanceAt(0)!.durability).toBe(DURABILITY_MAX - 1234);
    s2.bagOf('acc').removeStack(MAT.id, 0, 4);
    const ids = new Set(s2.bagOf('acc').instances.keys());
    s2.bagOf('acc').add({ defId: BP.id, quality: 3, qty: 1 });
    expect(new Set(s2.bagOf('acc').instances.keys()).size).toBe(ids.size + 1); // a fresh id, no collision
  });
  it('the first connection loads, the last one saves: two connections of an account share one live inventory', () => {
    const store = new InMemoryInventoryStore();
    const s = new InventoryService({ store });
    s.onJoin('a');
    s.onJoin('a');
    s.grantDrops('a', [{ item: 'craft_material', qty: 2 }], 'field', 'k');
    s.onLeave('a');
    expect(store.has('a')).toBe(false); // one connection still online
    s.onLeave('a');
    expect(store.has('a')).toBe(true);
    s.onLeave('a'); // extra leave is harmless
  });
});

describe('WorldNode hook (opts.inventory)', () => {
  class Quiet implements ClientTransport {
    send(): void {}
    close(_c: ErrorCode, _t: string): void {}
    buffered(): number {
      return 0;
    }
  }
  it('loads the account inventory on join and saves it on leave; a node without inventory is unchanged', () => {
    const inventory = new InventoryService();
    const n = new WorldNode({ seed: 3, mapTiles: 64, spawn: { i0: 20, j0: 20, side: 6 }, inventory });
    const id = n.addPlayer(new Quiet(), 'acc-1');
    inventory.grantDrops('acc-1', [{ item: 'heal_pill', qty: 5, quality: 0 }], 'field', 'k');
    expect(inventory.store.load('acc-1')).toBeUndefined(); // saved on leave, not before
    n.removePlayer(id);
    expect(inventory.store.load('acc-1')!.bag.slots.some((s) => s && s.kind === 'stack' && s.qty === 5)).toBe(true);

    const id2 = n.addPlayer(new Quiet(), 'acc-1'); // joins again: the saved items come back
    expect(inventory.bagOf('acc-1').count(HEAL.id)).toBe(5);
    n.removePlayer(id2);

    const plain = new WorldNode({ seed: 3, mapTiles: 64, spawn: { i0: 20, j0: 20, side: 6 } });
    expect(plain.inventory).toBeNull();
    const pid = plain.addPlayer(new Quiet(), 'x');
    plain.removePlayer(pid);
    expect(plain.clients.size).toBe(0);
  });
});
