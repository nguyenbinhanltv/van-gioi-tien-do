import { describe, expect, it } from 'vitest';
import type { DropRoll, DropSource } from '@vgtd/shared';
import { wireSkillIds } from '@vgtd/client-combat';
import { ErrorCode, encode } from '@vgtd/protocol';
import { createWorld, spawnEntity, type SimWorld } from '@vgtd/sim';
import {
  DropSink,
  InventoryService,
  MobManager,
  WorldNode,
  dropKillKey,
  type ClientTransport,
  type DropEvent,
  type MobCombatStats,
  type MobPort,
} from '../src/index.js';

const MOB = 1_000_001;
const faucet = (kind: 'SYSTEM_FAUCET_DROP_MOB' | 'SYSTEM_FAUCET_DROP_ELITE' | 'SYSTEM_FAUCET_DROP_BOSS') =>
  ({ kind, ownerId: null, currency: 'LT_HA' }) as const;

function sinkRig(opts: { source?: DropSource; owners?: Record<number, string>; tick?: () => number } = {}) {
  const inventory = new InventoryService();
  let tick = 100;
  const sink = new DropSink({
    inventory,
    ownerOf: (id) => (opts.owners ?? { 7: 'acc-7' })[id],
    tick: opts.tick ?? (() => tick),
    mobs: opts.source
      ? { combatStats: () => ({ dropSource: opts.source }) as unknown as MobCombatStats }
      : { combatStats: () => undefined },
  });
  return { inventory, sink, setTick: (t: number) => (tick = t) };
}
const ev = (rolls: DropRoll[], killerId = 7, mobId = MOB): DropEvent => ({ killerId, mobId, rolls });

describe('DropSink (combat onDrops -> InventoryService.grantDrops)', () => {
  it('grants to the killer’s account with the stable kill key mobId@tick', () => {
    const r = sinkRig({ source: 'field' });
    r.inventory.onJoin('acc-7');
    const res = r.sink.handle(
      ev([
        { item: 'stone_ha', qty: 3 },
        { item: 'heal_pill', qty: 2, quality: 1 },
      ]),
    )!;
    expect(res.replayed).toBe(false);
    expect(r.inventory.wallet('acc-7', 'LT_HA')).toBe(3n);
    expect(r.inventory.bagOf('acc-7').count(1, 1)).toBe(2);
    expect(dropKillKey(MOB, 100)).toBe(`${MOB}@100`);
    // the grant is remembered under exactly that key: granting it again by hand is a replay
    expect(r.inventory.grantDrops('acc-7', [{ item: 'stone_ha', qty: 3 }], 'field', `${MOB}@100`).replayed).toBe(true);
    expect(r.sink.stats).toMatchObject({ grants: 1, replays: 0, noOwner: 0 });
  });

  it('replaying the same event (same mob, same tick) grants nothing twice; the same mob on another tick is a new kill', () => {
    const r = sinkRig({ source: 'field' });
    r.inventory.onJoin('acc-7');
    const e = ev([
      { item: 'stone_ha', qty: 2 },
      { item: 'craft_material', qty: 4 },
    ]);
    r.sink.handle(e);
    r.sink.handle(e);
    expect(r.inventory.wallet('acc-7', 'LT_HA')).toBe(2n);
    expect(r.inventory.bagOf('acc-7').count(6)).toBe(4);
    expect(r.sink.stats).toMatchObject({ grants: 1, replays: 1 });
    r.setTick(101); // respawned and killed again
    r.sink.handle(e);
    expect(r.inventory.wallet('acc-7', 'LT_HA')).toBe(4n);
    expect(r.inventory.bagOf('acc-7').count(6)).toBe(8);
    expect(r.inventory.ledger.reconcile()).toEqual([]);
  });

  it('the faucet follows the mob’s drop source (field / elite / boss)', () => {
    for (const [source, kind] of [
      ['field', 'SYSTEM_FAUCET_DROP_MOB'],
      ['elite', 'SYSTEM_FAUCET_DROP_ELITE'],
      ['boss', 'SYSTEM_FAUCET_DROP_BOSS'],
    ] as const) {
      const r = sinkRig({ source });
      r.sink.handle(ev([{ item: 'stone_ha', qty: 5 }]));
      expect(r.inventory.ledger.balance(faucet(kind)), source).toBe(-5n);
    }
  });

  it('an unreadable mob falls back to field and is counted; a killer who is gone gets nothing and nothing throws', () => {
    const r = sinkRig();
    r.sink.handle(ev([{ item: 'stone_ha', qty: 1 }]));
    expect(r.inventory.ledger.balance(faucet('SYSTEM_FAUCET_DROP_MOB'))).toBe(-1n);
    expect(r.sink.stats.sourceFallbacks).toBe(1);
    expect(r.sink.handle(ev([{ item: 'stone_ha', qty: 9 }], 99))).toBeUndefined(); // entity 99 is not connected
    expect(r.sink.stats.noOwner).toBe(1);
    expect(r.inventory.ledger.entries).toHaveLength(2); // only the first grant
  });

  it('with a real MobManager the source is readable at callback time (combat calls onDrops BEFORE mobs.kill) but not after', () => {
    // a single-elite manager over an open grid
    const open = new MobManager({
      seed: 3,
      grid: openGrid(),
      zones: [{ zone: 'bia_rung', i0: 10, j0: 10, i1: 30, j1: 30 }],
      tables: [{ zone: 'bia_rung', groups: [{ def: 'elite_lang_vuong', count: 1 }] }],
    });
    let world: SimWorld = open.populate(createWorld(3));
    const inventory = new InventoryService();
    const sink = new DropSink({ inventory, ownerOf: () => 'acc', tick: () => world.tick, mobs: open });
    expect(open.combatStats(MOB - 1)?.dropSource).toBe('elite');
    sink.handle(ev([{ item: 'stone_ha', qty: 4 }], 1, MOB - 1)); // callback first ...
    world = open.kill(world, MOB - 1); // ... then the kill, like CombatSystem
    expect(inventory.ledger.balance(faucet('SYSTEM_FAUCET_DROP_ELITE'))).toBe(-4n);
    expect(open.combatStats(MOB - 1)).toBeUndefined(); // the order matters: after kill the source is gone
    sink.handle(ev([{ item: 'stone_ha', qty: 1 }], 1, MOB - 1));
    expect(sink.stats.sourceFallbacks).toBe(1);
  });
});

function openGrid() {
  // the same open test grid the other server tests use
  return new WorldNode({ mapTiles: 64 }).ctx.grid;
}

// ----------------------------------------------------------------------------------------------- end to end
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
class Quiet implements ClientTransport {
  send(): void {}
  close(_c: ErrorCode, _t: string): void {}
  buffered(): number {
    return 0;
  }
}

describe('killing a mob online fills the killer’s bag and wallet (WorldNode: combat + inventory)', () => {
  function kill(seed: number): { node: WorldNode; rolls: DropRoll[][]; inventory: InventoryService } {
    const inventory = new InventoryService();
    const mobs = new FakeMobs();
    const rolls: DropRoll[][] = [];
    const node = new WorldNode({
      seed,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      combat: { mobs, onDrops: (d) => rolls.push([...d.rolls]) },
      inventory,
    });
    const id = node.addPlayer(new Quiet(), 'acc-1');
    const me = node.world.entities.find((e) => e.id === id)!;
    node.world = spawnEntity(node.world, { id: MOB, i: me.i + 2, j: me.j, hp: 1, mpMax: 0 });
    const skillId = wireSkillIds().get('kiem_khi_tram')!;
    for (let t = 0; t < 30; t++) node.tick();
    node.receive(
      id,
      encode({
        type: 'skill_cast',
        seq: 1,
        skillId,
        targetId: 0,
        aim: { qi: Math.round((me.i + 3) * 32), qj: Math.round(me.j * 32) },
      }),
    );
    for (let t = 0; t < 40; t++) node.tick();
    expect(mobs.killed).toEqual([MOB]);
    return { node, rolls, inventory };
  }

  it('the kill’s drops arrive in the account’s wallet and bag, the caller’s own onDrops still runs, and a replay changes nothing', () => {
    // fixed seeds so the test is deterministic; take the first one whose kill drops something
    let found: ReturnType<typeof kill> | undefined;
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
      const k = kill(seed);
      if ((k.rolls[0] ?? []).length > 0) {
        found = k;
        break;
      }
    }
    expect(found, 'no seed produced a drop').toBeDefined();
    const { node, rolls, inventory } = found!;
    expect(rolls).toHaveLength(1); // the caller's onDrops ran exactly once
    expect(node.dropSink).not.toBeNull();
    expect(node.dropSink!.stats).toMatchObject({ grants: 1, replays: 0, noOwner: 0, sourceFallbacks: 0 });

    const stones = rolls[0]!.filter((r) => r.item === 'stone_ha').reduce((n, r) => n + r.qty, 0);
    expect(inventory.wallet('acc-1', 'LT_HA')).toBe(BigInt(stones));
    const itemRolls = rolls[0]!.filter((r) => !r.item.startsWith('stone_'));
    const held = (() => {
      const bag = inventory.bagOf('acc-1');
      return bag.slots.reduce((n, s) => n + (s ? (s.kind === 'stack' ? s.qty : 1) : 0), 0);
    })();
    expect(held).toBe(itemRolls.reduce((n, r) => n + r.qty, 0));
    expect(inventory.ledger.reconcile()).toEqual([]);

    // the same kill event again (same mob, same tick) is a replay
    const walletBefore = inventory.wallet('acc-1', 'LT_HA');
    const key = [...inventoryKeys(node)][0]!;
    expect(key).toMatch(new RegExp(`^${MOB}@\\d+$`));
    expect(inventory.grantDrops('acc-1', rolls[0]!, 'field', key).replayed).toBe(true);
    expect(inventory.wallet('acc-1', 'LT_HA')).toBe(walletBefore);
  });

  it('a node with combat but no inventory is unchanged (no sink, caller’s onDrops untouched)', () => {
    const rolls: DropRoll[][] = [];
    const node = new WorldNode({
      seed: 1,
      mapTiles: 64,
      combat: { mobs: new FakeMobs(), onDrops: (d) => rolls.push([...d.rolls]) },
    });
    expect(node.dropSink).toBeNull();
    expect(node.inventory).toBeNull();
  });
});

/** The kill keys the node's inventory has granted (reads the service's private memory for the assertion above). */
function inventoryKeys(node: WorldNode): Set<string> {
  const grants = (node.inventory as unknown as { grants: Map<string, unknown> }).grants;
  return new Set([...grants.keys()].map((k) => k.split('|')[1]!));
}
