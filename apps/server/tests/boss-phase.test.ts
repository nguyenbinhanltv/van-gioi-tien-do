/** boss_phase on the wire (D91): who gets it, what it carries, and that it is sent once per phase change. */
import { describe, expect, it } from 'vitest';
import { MOB_ID_BASE, MOB_TRANSFORM_MS } from '@vgtd/shared';
import { decode, peekHeader, type Message } from '@vgtd/protocol';
import { WorldNode } from '../src/index.js';

class Recorder {
  got: Message[] = [];
  send(b: Uint8Array): void {
    if (peekHeader(b).type === 'boss_phase') this.got.push(decode(b)); // snapshots need a baseline to decode
  }
  close(): void {}
  buffered(): number {
    return 0;
  }
}

describe('boss_phase (D91)', () => {
  const makeNode = () =>
    new WorldNode({
      seed: 8,
      mapTiles: 256,
      spawn: { i0: 20, j0: 20, side: 1 },
      mobs: { zones: [{ zone: 'co_thu_trung_tam', i0: 14, j0: 14, i1: 30, j1: 30 }], density: 1 },
      combat: {},
    });

  it('goes once to the clients whose AOI holds the boss, with the new phase index and the transform window; a far player gets nothing', () => {
    const node = makeNode();
    const near = new Recorder();
    const far = new Recorder();
    const nearId = node.addPlayer(near, 'near');
    const farId = node.addPlayer(far, 'far');
    const mobs = node.mobs!;
    let bossId = 0;
    for (let k = 0; k < mobs.size; k++)
      if (mobs.info(MOB_ID_BASE + k)?.def.key === 'boss_ho_vuong') bossId = MOB_ID_BASE + k;
    expect(bossId).toBeGreaterThan(0);
    const maxHp = mobs.info(bossId)!.maxHp;
    const boss = () => node.world.entities.find((e) => e.id === bossId)!;
    node.world = {
      ...node.world,
      entities: node.world.entities.map((e) =>
        e.id === nearId ? { ...e, i: boss().i + 3, j: boss().j } : e.id === farId ? { ...e, i: 200.5, j: 200.5 } : e,
      ),
    };
    for (let k = 0; k < 5; k++) node.tick();
    expect(near.got).toHaveLength(0); // full HP: phase 0 is not announced
    node.world = {
      ...node.world,
      entities: node.world.entities.map((e) => (e.id === bossId ? { ...e, hp: Math.floor(maxHp * 0.45) } : e)),
    };
    for (let k = 0; k < 60; k++) node.tick();
    expect(near.got).toEqual([{ type: 'boss_phase', mobEntityId: bossId, phase: 1, transformMs: MOB_TRANSFORM_MS }]);
    expect(far.got).toHaveLength(0);
  });
});
