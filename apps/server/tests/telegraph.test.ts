/** Mob attack telegraphs on the wire (D87, protocol v5): who gets `telegraph_start` / `telegraph_end`, and what they carry. */
import { describe, expect, it } from 'vitest';
import { MOB_ID_BASE, mobAttacksOf, mobDefByKey, type MobDef } from '@vgtd/shared';
import { decode, peekHeader, TelegraphShape, type Message } from '@vgtd/protocol';
import { TileGrid, compileSkills, createWorld, spawnEntity, step, type SimContext } from '@vgtd/sim';
import {
  CombatSystem,
  MobAttackSystem,
  WorldNode,
  type MobAttackPort,
  type MobAttackView,
  type MobTelegraphEvent,
} from '../src/index.js';

class Recorder {
  got: Message[] = [];
  /** bytes of telegraph frames received */
  bytes = 0;
  send(b: Uint8Array): void {
    // snapshots need a client baseline to decode; only the telegraph frames matter here
    if (peekHeader(b).type.startsWith('telegraph_')) {
      this.got.push(decode(b));
      this.bytes += b.length;
    }
  }
  close(): void {}
  buffered(): number {
    return 0;
  }
  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.got.filter((m): m is Extract<Message, { type: T }> => m.type === type);
  }
}

describe('MobAttackSystem reports telegraphs', () => {
  const MOB = MOB_ID_BASE;
  const setup = () => {
    const ctx: SimContext = {
      grid: TileGrid.fromRows(Array.from({ length: 64 }, () => '.'.repeat(64))),
      skills: compileSkills(),
    };
    const combat = new CombatSystem(ctx, { seed: 1 });
    const def = mobDefByKey('mob_hoi_lang') as MobDef;
    const st = combat.addPlayer(1, 'kiem');
    let world = createWorld(1);
    world = spawnEntity(world, { id: 1, i: 20.5, j: 20.5, hp: st.hpMax, mpMax: st.mpMax });
    world = spawnEntity(world, { id: MOB, i: 21.7, j: 20.5, hp: 5000, mpMax: 0 });
    const port: MobAttackPort = {
      attackView: (id): MobAttackView | undefined =>
        id === MOB ? { state: 'chase', target: 1, level: 12, def } : undefined,
    };
    const sys = new MobAttackSystem(ctx, combat, port, 1);
    const all: MobTelegraphEvent[] = [];
    return {
      sys,
      all,
      get world() {
        return world;
      },
      run(ticks: number, kill?: number) {
        for (let k = 0; k < ticks; k++) {
          world = step(world, [], ctx, 50).world;
          if (kill === k)
            world = { ...world, entities: world.entities.map((e) => (e.id === MOB ? { ...e, hp: 0 } : e)) };
          const out = sys.step(world);
          world = out.world;
          all.push(...out.telegraphs);
        }
      },
    };
  };

  it('start (locked shape, telegraph time) then end (landed) with the same id', () => {
    const r = setup();
    r.run(40);
    const start = r.all.find((t) => t.kind === 'start');
    expect(start).toMatchObject({
      kind: 'start',
      mobId: MOB,
      durationMs: mobAttacksOf(mobDefByKey('mob_hoi_lang')!)[1]!.telegraphMs,
    });
    const end = r.all.find((t) => t.kind === 'end');
    expect(end).toMatchObject({ kind: 'end', id: (start as { id: number }).id, cancelled: false });
  });

  it('a mob that dies during its telegraph cancels it', () => {
    const r = setup();
    r.run(3);
    expect(r.all.filter((t) => t.kind === 'start')).toHaveLength(1);
    r.run(1, 0);
    const end = r.all.find((t) => t.kind === 'end');
    expect(end).toMatchObject({ kind: 'end', cancelled: true });
  });
});

describe('WorldNode sends telegraphs only to clients whose AOI holds the anchor', () => {
  const makeNode = () =>
    new WorldNode({
      seed: 5,
      mapTiles: 256,
      spawn: { i0: 20, j0: 20, side: 1 },
      mobs: { zones: [{ zone: 'bia_rung', i0: 14, j0: 14, i1: 28, j1: 28 }], density: 0.4 },
      combat: {},
    });

  it('the nearby player gets matching start / end frames; a player 200 tiles away gets none', () => {
    const node = makeNode();
    const near = new Recorder();
    const far = new Recorder();
    node.addPlayer(near, 'near');
    const farId = node.addPlayer(far, 'far');
    node.world = {
      ...node.world,
      entities: node.world.entities.map((e) => (e.id === farId ? { ...e, i: 200.5, j: 200.5 } : e)),
    };
    for (let k = 0; k < 4000 && near.of('telegraph_end').length < 2; k++) node.tick();
    const starts = near.of('telegraph_start');
    const ends = near.of('telegraph_end');
    expect(starts.length).toBeGreaterThan(0);
    expect(ends.length).toBeGreaterThan(0);
    for (const s of starts) {
      expect(s.mobEntityId).toBeGreaterThanOrEqual(MOB_ID_BASE);
      expect([TelegraphShape.Circle, TelegraphShape.Cone, TelegraphShape.Line]).toContain(s.shape);
      expect(s.size).toBeGreaterThan(0);
      expect(s.durationMs).toBeGreaterThan(0);
    }
    // every end pairs with an earlier start of the same id
    const startIds = new Set(starts.map((s) => s.id));
    for (const e of ends) expect(startIds.has(e.id)).toBe(true);
    expect(far.of('telegraph_start')).toHaveLength(0);
    expect(far.of('telegraph_end')).toHaveLength(0);
  });

  it('bandwidth: a player standing in a mob zone for 60 s gets a few hundred bytes per second of telegraph frames at most', () => {
    const node = makeNode();
    const me = new Recorder();
    node.addPlayer(me, 'solo');
    const ticks = 1200;
    for (let k = 0; k < ticks; k++) node.tick();
    const seconds = (ticks * 50) / 1000;
    expect(me.of('telegraph_start').length).toBeGreaterThan(0);
    expect(me.bytes / seconds).toBeLessThan(300);
  });
});
