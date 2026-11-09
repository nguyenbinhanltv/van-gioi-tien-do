import { describe, expect, it } from 'vitest';
import { ITEM_USE, NETWORK, breakthroughPillChance, itemDefByKey as defByKey } from '@vgtd/shared';
import {
  BreakthroughOutcome,
  ErrorCode,
  InvOp,
  InvReason,
  decode,
  encode,
  type BreakthroughResultMsg,
  type InvResultMsg,
  type InvStateMsg,
  type Message,
} from '@vgtd/protocol';
import type { SimWorld } from '@vgtd/sim';
import {
  InMemoryProgressionStore,
  InventoryService,
  ProgressionService,
  WorldNode,
  newRecord,
  type ClientTransport,
} from '../src/index.js';

const HEAL = defByKey('heal_pill')!;
const BTP = defByKey('breakthrough_pill')!;
const MAT = defByKey('craft_material')!;
const BP = defByKey('blueprint_gold_red')!;
const ACC = 'acc-use';
const MOB = 1_000_001;
const hex = (n: number): string => n.toString(16).padStart(32, '0');
let seq = 0;
const rid = (): string => hex(++seq);
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

class Client implements ClientTransport {
  msgs: Message[] = [];
  id = 0;
  send(data: Uint8Array): void {
    this.msgs.push(decode(data));
  }
  close(_code: ErrorCode): void {}
  buffered(): number {
    return 0;
  }
  results(): InvResultMsg[] {
    return this.msgs.filter((m): m is InvResultMsg => m.type === 'inv_result');
  }
  lastState(): InvStateMsg {
    return this.msgs.filter((m): m is InvStateMsg => m.type === 'inv_state').at(-1)!;
  }
  breakthroughs(): BreakthroughResultMsg[] {
    return this.msgs.filter((m): m is BreakthroughResultMsg => m.type === 'breakthrough_result');
  }
}

async function setup(opts: { fullTuVi?: boolean } = {}) {
  const inventory = new InventoryService();
  const store = new InMemoryProgressionStore();
  if (opts.fullTuVi)
    await store.save(
      {
        ...newRecord(ACC, { type: 'tap_tam', elements: ['kim', 'moc', 'thuy'], mutation: null }),
        exp: 1000,
        version: 1,
      },
      0,
    );
  const progression = new ProgressionService({ store, seed: 11 });
  const node = new WorldNode({
    seed: 5,
    mapTiles: 64,
    spawn: { i0: 20, j0: 20, side: 4 },
    inventory,
    combat: {},
    progression,
  });
  const c = new Client();
  c.id = node.addPlayer(c, ACC);
  await flush();
  node.tick();
  const bag = inventory.bagOf(ACC);
  const give = (defId: number, quality: number, qty: number): void => {
    expect(bag.add({ defId, quality, qty }).ok).toBe(true);
    node.invSync!.markDirty(ACC);
    node.tick();
  };
  const use = (slot: number, requestId = rid()): InvResultMsg => {
    node.receive(c.id, encode({ type: 'inv_cmd', requestId, op: InvOp.Use, from: slot, to: 0 }));
    return c.results().at(-1)!;
  };
  const tick = (k: number): void => {
    for (let i = 0; i < k; i++) node.tick();
  };
  const hit = (amount: number): void => {
    const r = node.combat!.damagePlayer(node.world, c.id, amount, MOB);
    (node as unknown as { world: SimWorld }).world = r.world;
  };
  const me = () => node.world.entities.find((e) => e.id === c.id)!;
  const hpMax = node.combat!.maxHpOf(c.id)!;
  const qty = (slot: number): number => {
    const s = bag.slots[slot];
    return s && s.kind === 'stack' ? s.qty : 0;
  };
  return { node, c, inventory, progression, bag, give, use, tick, hit, me, hpMax, qty };
}

describe('item use: heal pill (D90)', () => {
  it('heals 18 % of max HP, consumes exactly one, and the shared 8 s cooldown refuses the next without eating it', async () => {
    const t = await setup();
    t.give(HEAL.id, 2, 5);
    t.hit(Math.round(t.hpMax * 0.6)); // 40 % HP left
    const hp0 = t.me().hp;
    const r = t.use(0);
    expect(r).toMatchObject({ op: InvOp.Use, reason: InvReason.Ok });
    const heal = Math.round(t.hpMax * ITEM_USE.healPill.healPct);
    expect(t.me().hp).toBe(hp0 + heal);
    expect(t.qty(0)).toBe(4);
    t.tick(1);
    expect(t.c.lastState().slots[0]).toMatchObject({ kind: 'stack', qty: 4 }); // the client sees the new count
    // still cooling down: refused, nothing consumed, no heal
    expect(t.use(0).reason).toBe(InvReason.OnCooldown);
    expect(t.qty(0)).toBe(4);
    expect(t.me().hp).toBe(hp0 + heal);
    // the cooldown (8 s) passes
    t.tick(Math.ceil((ITEM_USE.healPill.cooldownMs / 1000) * NETWORK.TICK_HZ));
    expect(t.use(0).reason).toBe(InvReason.Ok);
    expect(t.qty(0)).toBe(3);
  });

  it('is refused at full HP (nothing consumed), never overheals, and a dead player cannot drink', async () => {
    const t = await setup();
    t.give(HEAL.id, 0, 3);
    expect(t.use(0).reason).toBe(InvReason.NothingToHeal);
    expect(t.qty(0)).toBe(3);
    t.hit(1); // 1 HP missing: heals only that
    expect(t.use(0).reason).toBe(InvReason.Ok);
    expect(t.me().hp).toBe(t.hpMax);
    expect(t.qty(0)).toBe(2);
    t.hit(t.hpMax * 10); // dies
    t.tick(Math.ceil((ITEM_USE.healPill.cooldownMs / 1000) * NETWORK.TICK_HZ));
    expect(t.use(0).reason).toBe(InvReason.Dead);
    expect(t.qty(0)).toBe(2);
  });

  it('the last unit empties the slot', async () => {
    const t = await setup();
    t.give(HEAL.id, 1, 1);
    t.hit(Math.round(t.hpMax * 0.5));
    expect(t.use(0).reason).toBe(InvReason.Ok);
    expect(t.bag.slots[0]).toBeNull();
    t.tick(1);
    expect(t.c.lastState().slots[0]).toBeNull();
  });

  it('a replayed requestId returns the first answer and consumes nothing again', async () => {
    const t = await setup();
    t.give(HEAL.id, 0, 5);
    t.hit(Math.round(t.hpMax * 0.7));
    const id = rid();
    const first = t.use(0, id);
    const hp = t.me().hp;
    const again = t.use(0, id);
    expect(again).toEqual(first);
    expect(t.qty(0)).toBe(4);
    expect(t.me().hp).toBe(hp);
  });
});

describe('item use: validation (D90)', () => {
  it('refuses empty slots, out-of-range slots, items without a use and instances, and never changes the bag', async () => {
    const t = await setup();
    t.give(MAT.id, 0, 7);
    t.give(BP.id, 5, 1);
    expect(t.use(5).reason).toBe(InvReason.EmptySlot);
    expect(t.use(60).reason).toBe(InvReason.BadSlot);
    expect(t.use(0).reason).toBe(InvReason.NotUsable); // craft material
    expect(t.use(1).reason).toBe(InvReason.NotUsable); // blueprint (instance)
    expect(t.qty(0)).toBe(7);
    expect(t.bag.slots[1]).toMatchObject({ kind: 'instance' });
  });

  it('a Use command is rate limited like every inventory command and the refusal does not consume', async () => {
    const t = await setup();
    t.give(HEAL.id, 0, 50);
    t.hit(Math.round(t.hpMax * 0.9));
    const reasons: number[] = [];
    for (let k = 0; k < 14; k++) reasons.push(t.use(0).reason);
    expect(reasons).toContain(InvReason.RateLimited);
    // only the first accepted command healed; the rest were cooldown or rate-limited and ate nothing
    expect(t.qty(0)).toBe(49);
  });
});

describe('item use: breakthrough pill (D90)', () => {
  const attempt = (t: Awaited<ReturnType<typeof setup>>): BreakthroughResultMsg => {
    t.node.receive(t.c.id, encode({ type: 'breakthrough_start', requestId: rid() }));
    return t.c.breakthroughs().at(-1)!;
  };

  it('without a pill the minor roll is the plain 90 %; with one the next attempt uses the docs/07 pill bonus, and the pill is spent by it', async () => {
    const plain = await setup({ fullTuVi: true });
    const base = attempt(plain);
    expect(base.chance).toBe(9000);

    const t = await setup({ fullTuVi: true });
    t.give(BTP.id, 5, 2);
    expect(t.use(0).reason).toBe(InvReason.Ok);
    expect(t.qty(0)).toBe(1);
    expect(t.progression.pendingPill(t.c.id)).toBe(5);
    const r = attempt(t);
    expect(r.outcome === BreakthroughOutcome.Success || r.outcome === BreakthroughOutcome.Failure).toBe(true);
    expect(r.chance).toBe(Math.round(breakthroughPillChance(0.9, 5) * 10_000)); // 95 %: the formula clamps at 95
    expect(r.chance).toBeGreaterThan(base.chance);
    expect(t.progression.pendingPill(t.c.id)).toBeNull(); // spent by the attempt
  });

  it('only one pill waits at a time (the second is refused and stays in the bag), and a rejected attempt keeps the pill', async () => {
    const t = await setup(); // tu vi not full: the attempt is rejected
    t.give(BTP.id, 2, 3);
    expect(t.use(0).reason).toBe(InvReason.Ok);
    t.tick(1);
    expect(t.use(0).reason).toBe(InvReason.PillActive);
    expect(t.qty(0)).toBe(2);
    const r = attempt(t);
    expect(r.outcome).toBe(BreakthroughOutcome.Rejected);
    expect(t.progression.pendingPill(t.c.id)).toBe(2); // refused attempts do not spend it
  });

  it('is deterministic: the same script gives the same roll result and the same remaining bag', async () => {
    const run = async (): Promise<string> => {
      const t = await setup({ fullTuVi: true });
      t.give(BTP.id, 3, 1);
      t.use(0);
      const r = attempt(t);
      return JSON.stringify([r.outcome, r.chance, r.toStage, t.bag.slots[0]]);
    };
    expect(await run()).toBe(await run());
  });
});

describe('item use without the systems it needs', () => {
  it('a node without combat or progression answers NotUsable and keeps the item', async () => {
    const inventory = new InventoryService();
    const node = new WorldNode({ seed: 5, mapTiles: 64, spawn: { i0: 20, j0: 20, side: 4 }, inventory });
    const c = new Client();
    c.id = node.addPlayer(c, ACC);
    const bag = inventory.bagOf(ACC);
    bag.add({ defId: HEAL.id, quality: 0, qty: 2 });
    bag.add({ defId: BTP.id, quality: 0, qty: 2 });
    node.tick();
    node.receive(c.id, encode({ type: 'inv_cmd', requestId: rid(), op: InvOp.Use, from: 0, to: 0 }));
    expect(c.results().at(-1)!.reason).toBe(InvReason.NotUsable);
    node.receive(c.id, encode({ type: 'inv_cmd', requestId: rid(), op: InvOp.Use, from: 1, to: 0 }));
    expect(c.results().at(-1)!.reason).toBe(InvReason.NotUsable);
    expect(bag.slots[0]).toMatchObject({ kind: 'stack', qty: 2 });
    expect(bag.slots[1]).toMatchObject({ kind: 'stack', qty: 2 });
  });
});
