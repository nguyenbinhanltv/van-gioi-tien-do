import { describe, expect, it } from 'vitest';
import { itemDefByKey as defByKey } from '@vgtd/shared';
import { BagModel } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only (the package index also pulls DOM input code)
import { wireSkillIds } from '@vgtd/client-combat';
import {
  COLD_ENVELOPE,
  ErrorCode,
  InvOp,
  InvReason,
  decode,
  encode,
  type InvCmdMsg,
  type InvResultMsg,
  type InvStateMsg,
  type Message,
} from '@vgtd/protocol';
import { spawnEntity, type SimWorld } from '@vgtd/sim';
import { InventoryService, WorldNode, type ClientTransport, type MobCombatStats, type MobPort } from '../src/index.js';

const HEAL = defByKey('heal_pill')!;
const MAT = defByKey('craft_material')!;
const BP = defByKey('blueprint_gold_red')!;

/** A client connection that keeps only the inventory messages, like the NetClient bag wiring does. */
class Client implements ClientTransport {
  readonly states: InvStateMsg[] = [];
  readonly results: InvResultMsg[] = [];
  readonly bag = new BagModel();
  closed: ErrorCode | null = null;
  errors = 0;
  id = 0;
  send(data: Uint8Array): void {
    if (data[1] !== COLD_ENVELOPE) {
      if (data[1] === 7) this.errors++; // error packet
      return; // snapshots / aoi: not needed here
    }
    const m: Message = decode(data);
    if (m.type === 'inv_state') {
      this.states.push(m);
      this.bag.applyState(m);
    } else if (m.type === 'inv_result') {
      this.results.push(m);
      this.bag.applyResult(m);
    }
  }
  close(code: ErrorCode): void {
    this.closed = code;
  }
  buffered(): number {
    return 0;
  }
}
let reqSeq = 0;
const rid = (): string => (++reqSeq).toString(16).padStart(32, '0');

function rig(opts: { bagSlots?: number; pendingMax?: number } = {}) {
  const inventory = new InventoryService(opts);
  const node = new WorldNode({ seed: 4, mapTiles: 64, spawn: { i0: 20, j0: 20, side: 4 }, inventory });
  const join = (account: string): Client => {
    const c = new Client();
    c.id = node.addPlayer(c, account);
    return c;
  };
  const send = (c: Client, cmd: InvCmdMsg): void => node.receive(c.id, encode(cmd));
  const tick = (k = 1): void => {
    for (let t = 0; t < k; t++) node.tick();
  };
  return { inventory, node, join, send, tick };
}
/** What the client model shows must equal what the server holds. */
function expectSynced(c: Client, inventory: InventoryService, account: string): void {
  const bag = inventory.bagOf(account);
  expect(c.bag.slotCount).toBe(bag.capacity);
  bag.slots.forEach((s, i) => {
    const it = c.bag.itemAt(i);
    if (!s) return expect(it).toBeNull();
    const inst = s.kind === 'instance' ? bag.instances.get(s.id)! : null;
    expect(it).toMatchObject({
      defId: s.kind === 'stack' ? s.defId : inst!.defId,
      quality: s.kind === 'stack' ? s.quality : inst!.quality,
    });
    if (s.kind === 'stack') expect(it!.qty).toBe(s.qty);
    else expect(it!.durability).toBe(bag.instances.get(s.id)!.durability);
  });
  expect(c.bag.wallet).toEqual({
    LT_HA: Number(inventory.wallet(account, 'LT_HA')),
    LT_TRUNG: Number(inventory.wallet(account, 'LT_TRUNG')),
    LT_THUONG: Number(inventory.wallet(account, 'LT_THUONG')),
  });
  expect(c.bag.pendingTotal).toBe(inventory.pendingOf(account).reduce((n, p) => n + p.qty, 0));
}

describe('the visible bag over the wire (inv_state / inv_cmd / inv_result)', () => {
  it('a joining player gets its inventory in the first tick', () => {
    const r = rig();
    const c = r.join('acc');
    expect(c.states).toHaveLength(0); // sent at the end of the tick, not inside addPlayer
    r.tick();
    expect(c.states).toHaveLength(1);
    expect(c.bag.slotCount).toBe(40);
    expectSynced(c, r.inventory, 'acc');
  });

  it('a grant reaches the client the next tick, and several changes in one tick make ONE inv_state', () => {
    const r = rig();
    const c = r.join('acc');
    r.tick();
    const before = c.states.length;
    r.inventory.grantDrops(
      'acc',
      [
        { item: 'stone_ha', qty: 3 },
        { item: 'heal_pill', qty: 2, quality: 1 },
      ],
      'field',
      'k1',
    );
    r.inventory.grantDrops(
      'acc',
      [
        { item: 'craft_material', qty: 7 },
        { item: 'blueprint_gold_red', qty: 1, quality: 5 },
      ],
      'field',
      'k2',
    );
    r.inventory.grantDrops('acc', [{ item: 'stone_trung', qty: 1 }], 'elite', 'k3');
    expect(c.states.length).toBe(before); // nothing is sent mid-tick
    r.tick();
    expect(c.states.length).toBe(before + 1);
    expectSynced(c, r.inventory, 'acc');
    expect(c.bag.wallet).toMatchObject({ LT_HA: 3, LT_TRUNG: 1 });
    r.tick(3);
    expect(c.states.length).toBe(before + 1); // idle ticks send nothing
  });

  it('a replayed kill grants nothing and sends nothing', () => {
    const r = rig();
    const c = r.join('acc');
    r.inventory.grantDrops('acc', [{ item: 'craft_material', qty: 1 }], 'field', 'same');
    r.tick();
    const n = c.states.length;
    r.inventory.grantDrops('acc', [{ item: 'craft_material', qty: 1 }], 'field', 'same'); // replay
    r.tick();
    expect(c.states.length).toBe(n);
    expect(c.bag.itemAt(0)!.qty).toBe(1);
  });

  it('inventories are private: another account never receives my state', () => {
    const r = rig();
    const a = r.join('alice');
    const b = r.join('bob');
    r.tick();
    const bobStates = b.states.length;
    r.inventory.grantDrops('alice', [{ item: 'stone_ha', qty: 9 }], 'field', 'k');
    r.tick();
    expect(a.bag.wallet.LT_HA).toBe(9);
    expect(b.states.length).toBe(bobStates);
    expect(b.bag.wallet.LT_HA).toBe(0);
  });

  it('move: the server swaps / merges, answers inv_result Ok, then sends the new state', () => {
    const r = rig();
    const c = r.join('acc');
    r.inventory.grantDrops(
      'acc',
      [
        { item: 'heal_pill', qty: 5, quality: 0 },
        { item: 'craft_material', qty: 2 },
      ],
      'field',
      'k',
    );
    r.tick();
    expect(c.bag.itemAt(0)).toMatchObject({ defId: HEAL.id });
    expect(c.bag.itemAt(1)).toMatchObject({ defId: MAT.id });
    const cmd = c.bag.moveCmd(0, 5, rid)!;
    r.send(c, cmd);
    expect(c.results).toEqual([
      { type: 'inv_result', requestId: cmd.requestId, op: InvOp.Move, reason: InvReason.Ok, count: 0 },
    ]);
    expect(c.bag.waitingCount).toBe(0);
    r.tick();
    expect(c.bag.itemAt(0)).toBeNull();
    expect(c.bag.itemAt(5)).toMatchObject({ defId: HEAL.id, qty: 5 });
    expectSynced(c, r.inventory, 'acc');
    // swap two occupied slots
    r.send(c, c.bag.moveCmd(1, 5, rid)!);
    r.tick();
    expect(c.bag.itemAt(1)).toMatchObject({ defId: HEAL.id });
    expect(c.bag.itemAt(5)).toMatchObject({ defId: MAT.id });
  });

  it('refuses bad commands with a reason and changes nothing (empty source, slot out of range)', () => {
    const r = rig();
    const c = r.join('acc');
    r.inventory.grantDrops('acc', [{ item: 'craft_material', qty: 2 }], 'field', 'k');
    r.tick();
    const empty: InvCmdMsg = { type: 'inv_cmd', requestId: rid(), op: InvOp.Move, from: 7, to: 8 }; // built by hand: the model would refuse it locally
    const high: InvCmdMsg = { type: 'inv_cmd', requestId: rid(), op: InvOp.Move, from: 0, to: 63 }; // valid on the wire, beyond the 40-slot bag
    r.send(c, empty);
    r.send(c, high);
    expect(c.results.map((x) => x.reason)).toEqual([InvReason.EmptySlot, InvReason.BadSlot]);
    const n = c.states.length;
    r.tick();
    expect(c.states.length).toBe(n); // nothing changed, nothing to send
    expect(c.bag.itemAt(0)).toMatchObject({ defId: MAT.id, qty: 2 });
  });

  it('replaying a requestId returns the first answer and applies nothing again', () => {
    const r = rig();
    const c = r.join('acc');
    r.inventory.grantDrops('acc', [{ item: 'heal_pill', qty: 5, quality: 0 }], 'field', 'k');
    r.tick();
    const cmd = c.bag.moveCmd(0, 4, rid)!;
    r.send(c, cmd);
    r.send(c, cmd); // the same packet again (a retry / duplicate)
    expect(c.results).toHaveLength(2);
    expect(c.results[1]).toEqual(c.results[0]);
    expect(c.results[0]!.reason).toBe(InvReason.Ok); // a second real execution would have said EmptySlot
    r.tick();
    expect(c.bag.itemAt(4)).toMatchObject({ qty: 5 });
    expect(c.bag.itemAt(0)).toBeNull();
  });

  it('rate limit: a burst beyond the budget is refused (not remembered), and the same id succeeds after the budget refills', () => {
    const r = rig();
    const c = r.join('acc');
    r.inventory.grantDrops('acc', [{ item: 'heal_pill', qty: 5, quality: 0 }], 'field', 'k');
    r.tick();
    const cmds: InvCmdMsg[] = [];
    for (let k = 0; k < 11; k++)
      cmds.push({ type: 'inv_cmd', requestId: rid(), op: InvOp.Move, from: k % 2 ? 1 : 0, to: k % 2 ? 0 : 1 });
    for (const m of cmds) r.send(c, m);
    expect(c.results.slice(0, 10).every((x) => x.reason === InvReason.Ok)).toBe(true);
    expect(c.results[10]!.reason).toBe(InvReason.RateLimited);
    r.tick(6); // 300 ms of sim time = 3 tokens
    r.send(c, cmds[10]!);
    expect(c.results[11]).toMatchObject({ requestId: cmds[10]!.requestId, reason: InvReason.Ok });
  });

  it('claim_pending moves parked loot into the bag when there is room, with a count', () => {
    const r = rig({ bagSlots: 2, pendingMax: 4 });
    const c = r.join('acc');
    r.inventory.grantDrops('acc', [{ item: 'blueprint_white_green', qty: 2, quality: 0 }], 'field', 'a'); // fills both slots
    r.inventory.grantDrops(
      'acc',
      [
        { item: 'heal_pill', qty: 3, quality: 0 },
        { item: 'craft_material', qty: 4 },
      ],
      'field',
      'b',
    ); // both park
    r.tick();
    expect(c.bag.pendingTotal).toBe(7);
    const none = c.bag.claimCmd(rid)!;
    r.send(c, none);
    expect(c.results[0]).toMatchObject({ reason: InvReason.NothingMoved, count: 0 });
    // free a slot by removing the instance on the server side, then claim
    r.inventory.bagOf('acc').removeInstance(0);
    r.inventory.bagOf('acc').removeInstance(1);
    const claim = c.bag.claimCmd(rid)!;
    r.send(c, claim);
    expect(c.results[1]).toMatchObject({ reason: InvReason.Ok, count: 2 });
    r.tick();
    expect(c.bag.pendingTotal).toBe(0);
    expectSynced(c, r.inventory, 'acc');
  });

  it('a pending entry at the quantity cap still encodes: inv_state never fails because of loot volume', () => {
    const r = rig({ bagSlots: 1, pendingMax: 2 });
    const c = r.join('acc');
    r.inventory.grantDrops('acc', [{ item: 'blueprint_white_green', qty: 1, quality: 0 }], 'field', 'fill');
    for (let k = 0; k < 4; k++)
      r.inventory.grantDrops('acc', [{ item: 'craft_material', qty: 40_000 }], 'field', `k${k}`);
    expect(() => encode(r.node.invSync!.stateOf('acc'))).not.toThrow();
    r.tick();
    expect(c.bag.pendingTotal).toBe(65_535);
    expect(r.node.metrics.inventorySendErrors).toBe(0);
  });

  it('one owner whose inv_state cannot be built or sent never stops the tick or starves the others', () => {
    const r = rig();
    const bad = r.join('bad');
    const good = r.join('good');
    r.tick();
    const real = r.node.invSync!.stateOf.bind(r.node.invSync!);
    r.node.invSync!.stateOf = (owner: string) => {
      if (owner === 'bad') throw new Error('boom');
      return real(owner);
    };
    r.inventory.grantDrops('bad', [{ item: 'stone_ha', qty: 1 }], 'field', 'k1');
    r.inventory.grantDrops('good', [{ item: 'stone_ha', qty: 2 }], 'field', 'k2');
    const before = good.states.length;
    expect(() => r.tick()).not.toThrow();
    expect(r.node.metrics.inventorySendErrors).toBe(1);
    expect(good.states.length).toBe(before + 1);
    expect(good.bag.wallet.LT_HA).toBe(2);
    expect(bad.closed).toBeNull(); // not kicked: the world just carries on
    expect(() => r.tick(3)).not.toThrow();
  });

  it('a node without an inventory answers inv_cmd with an error and counts it', () => {
    const node = new WorldNode({ seed: 1, mapTiles: 64 });
    const c = new Client();
    c.id = node.addPlayer(c, 'x');
    node.receive(c.id, encode({ type: 'inv_cmd', requestId: rid(), op: InvOp.ClaimPending, from: 0, to: 0 }));
    expect(c.errors).toBe(1);
    expect(node.invSync).toBeNull();
  });

  it('leaving and rejoining brings the saved inventory back in the first state', () => {
    const r = rig();
    const c = r.join('acc');
    r.inventory.grantDrops(
      'acc',
      [
        { item: 'blueprint_gold_red', qty: 1, quality: 4 },
        { item: 'stone_ha', qty: 5 },
      ],
      'boss',
      'k',
    );
    r.tick();
    r.node.removePlayer(c.id);
    const c2 = r.join('acc');
    r.tick();
    expect(c2.states).toHaveLength(1);
    expect(c2.bag.itemAt(0)).toMatchObject({ kind: 'instance', defId: BP.id, quality: 4 });
    expect(c2.bag.wallet.LT_HA).toBe(5);
  });
});

// ------------------------------------------------------------------------------------- a real kill reaches the bag view
const MOB = 1_000_001;
class FakeMobs implements MobPort {
  killed: number[] = [];
  combatStats(id: number): MobCombatStats | undefined {
    return id === MOB && !this.killed.includes(id)
      ? { defense: 40, realm: 1, element: 'moc', dropSource: 'field', hpMax: 5000 }
      : undefined;
  }
  kill(world: SimWorld, id: number): SimWorld {
    this.killed.push(id);
    return { ...world, entities: world.entities.filter((e) => e.id !== id) };
  }
}

describe('killing a mob updates the client bag view', () => {
  it('combat -> DropSink -> inventory -> inv_state -> BagModel equals the server bag', () => {
    let found = false;
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
      const inventory = new InventoryService();
      const mobs = new FakeMobs();
      const node = new WorldNode({
        seed,
        mapTiles: 64,
        spawn: { i0: 20, j0: 20, side: 1 },
        combat: { mobs },
        inventory,
      });
      const c = new Client();
      c.id = node.addPlayer(c, 'acc');
      const me = node.world.entities.find((e) => e.id === c.id)!;
      node.world = spawnEntity(node.world, { id: MOB, i: me.i + 2, j: me.j, hp: 1, mpMax: 0 });
      for (let t = 0; t < 30; t++) node.tick();
      const statesBefore = c.states.length;
      node.receive(
        c.id,
        encode({
          type: 'skill_cast',
          seq: 1,
          skillId: wireSkillIds().get('kiem_khi_tram')!,
          targetId: 0,
          aim: { qi: Math.round((me.i + 3) * 32), qj: Math.round(me.j * 32) },
        }),
      );
      for (let t = 0; t < 40; t++) node.tick();
      expect(mobs.killed).toEqual([MOB]);
      const dropped =
        node.dropSink!.stats.grants === 1 &&
        (inventory.bagOf('acc').freeSlots() < 40 || inventory.wallet('acc', 'LT_HA') > 0n);
      if (!dropped) continue; // this seed rolled no drop: try the next one
      found = true;
      expect(c.states.length).toBeGreaterThan(statesBefore);
      expectSynced(c, inventory, 'acc');
      break;
    }
    expect(found, 'no seed produced a drop').toBe(true);
  });
});
