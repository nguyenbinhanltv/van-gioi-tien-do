import { describe, expect, it } from 'vitest';
import { NETWORK } from '@vgtd/shared';
import { BreakthroughOutcome, ErrorCode, ProgressionReason, decode, encode, type Message } from '@vgtd/protocol';
import {
  InMemoryProgressionStore,
  ProgressionService,
  WorldNode,
  newRecord,
  type ProgressRecord,
  type ClientTransport,
  type WorldNodeOptions,
} from '../src/index.js';

class FakeClient implements ClientTransport {
  msgs: Message[] = [];
  closed: { code: ErrorCode; text: string } | null = null;
  id = 0;
  seq = 0;
  send(data: Uint8Array): void {
    this.msgs.push(decode(data));
  }
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return 0;
  }
  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.msgs.filter((m): m is Extract<Message, { type: T }> => m.type === type);
  }
}
const flush = () => new Promise<void>((r) => setImmediate(r));
const hex = (n: number) => n.toString(16).padStart(32, '0');
const move = (c: FakeClient) =>
  encode({ type: 'input', ack: 0, inputs: [{ seq: ++c.seq & 0xffff, dtMs: 50, dir: 0, mag: 15, flags: 0 }] });

async function setup(opts: WorldNodeOptions = {}) {
  const store = new InMemoryProgressionStore();
  const progression = new ProgressionService({ store, seed: 7 });
  const world = new WorldNode({ mapTiles: 160, spawn: { i0: 60, j0: 60, side: 40 }, progression, ...opts });
  const c = new FakeClient();
  c.id = world.addPlayer(c, 'acc-1');
  await flush();
  world.tick();
  return { world, c, store, progression };
}
const ticks = (w: WorldNode, k: number) => {
  for (let i = 0; i < k; i++) w.tick();
};

describe('progression over the real protocol (WorldNode)', () => {
  it('sends char_state on join and answers meditate_start with a result, then streams progress', async () => {
    const { world, c } = await setup();
    expect(c.of('char_state')[0]).toMatchObject({ stage: 1, tuVi: 0, tuViReq: 1000, flags: 0 });
    world.receive(c.id, encode({ type: 'meditate_start', requestId: hex(1) }));
    expect(c.of('meditate_result')).toEqual([
      { type: 'meditate_result', requestId: hex(1), meditating: true, reason: 0 },
    ]);
    ticks(world, NETWORK.TICK_HZ * 3);
    const states = c.of('char_state');
    expect(states.at(-1)!.flags & 1).toBe(1);
    expect(states.at(-1)!.tuVi).toBeGreaterThan(0);
  });
  it('a movement input interrupts meditation and the same input blocks a new start', async () => {
    const { world, c, progression } = await setup();
    world.receive(c.id, encode({ type: 'meditate_start', requestId: hex(1) }));
    expect(progression.isMeditating(c.id)).toBe(true);
    world.receive(c.id, move(c));
    expect(progression.isMeditating(c.id)).toBe(false);
    world.receive(c.id, encode({ type: 'meditate_start', requestId: hex(2) }));
    expect(c.of('meditate_result').at(-1)).toMatchObject({ meditating: false, reason: ProgressionReason.Moving });
  });
  it('a skill cast counts as combat: meditation is refused', async () => {
    const { world, c } = await setup();
    world.receive(c.id, encode({ type: 'skill_cast', seq: 1, skillId: 1, targetId: 0 }));
    world.receive(c.id, encode({ type: 'meditate_start', requestId: hex(1) }));
    expect(c.of('meditate_result').at(-1)).toMatchObject({ meditating: false, reason: ProgressionReason.InCombat });
  });
  it('breakthrough_start is answered with a rejection until the stage is full, never a client-chosen result', async () => {
    const { world, c } = await setup();
    world.receive(c.id, encode({ type: 'breakthrough_start', requestId: hex(1) }));
    expect(c.of('breakthrough_result')[0]).toMatchObject({
      outcome: BreakthroughOutcome.Rejected,
      reason: ProgressionReason.NotEnoughTuVi,
    });
    // clients cannot send server-to-client progression messages
    const bad = encode({
      type: 'breakthrough_result',
      requestId: hex(2),
      outcome: 1,
      kind: 2,
      reason: 0,
      fromStage: 1,
      toStage: 2,
      chance: 10000,
      nFail: 0,
    });
    world.receive(c.id, bad);
    expect(c.of('error').at(-1)).toMatchObject({ code: ErrorCode.BadMessage });
    expect(world.clients.get(c.id)!.stats.badMessages).toBe(1);
  });
  it('a full stage can break through over the wire and the new stage is persisted', async () => {
    const store = new InMemoryProgressionStore();
    await store.save(
      {
        ...newRecord('acc-1', { type: 'tap_tam', elements: ['kim', 'moc', 'thuy'], mutation: null }),
        exp: 1000,
        version: 1,
      },
      0,
    );
    const progression = new ProgressionService({ store, seed: 3 });
    const { world, c } = await setup({ progression });
    world.receive(c.id, encode({ type: 'breakthrough_start', requestId: hex(1) }));
    const r = c.of('breakthrough_result')[0]!;
    expect([BreakthroughOutcome.Success, BreakthroughOutcome.Failure]).toContain(r.outcome);
    expect(r.chance).toBe(9000);
    world.removePlayer(c.id);
    await flush();
    const saved = store.peek('acc-1')!;
    expect(saved.version).toBeGreaterThan(1);
    if (r.outcome === BreakthroughOutcome.Success) expect([saved.realm, saved.subRealm, saved.exp]).toEqual([1, 2, 0]);
    else expect([saved.realm, saved.subRealm, saved.exp]).toEqual([1, 1, 1000]);
  });
  it('a storage conflict that cannot be resolved drops the session with ErrorCode.Internal', async () => {
    class Refusing extends InMemoryProgressionStore {
      refuse = false;
      override async save(rec: ProgressRecord, expected: number): Promise<boolean> {
        return this.refuse ? false : super.save(rec, expected);
      }
    }
    const store = new Refusing();
    await store.save(
      { ...newRecord('acc-1', { type: 'tap_tam', elements: ['kim', 'moc', 'thuy'], mutation: null }), version: 1 },
      0,
    );
    const progression = new ProgressionService({ store, seed: 7 });
    const { world, c } = await setup({ progression });
    store.refuse = true;
    world.receive(c.id, encode({ type: 'meditate_start', requestId: hex(1) }));
    world.receive(c.id, encode({ type: 'meditate_stop', requestId: hex(2) }));
    await flush();
    await flush();
    expect(c.closed).toMatchObject({ code: ErrorCode.Internal });
  });
  it('without a progression service the new messages are rejected like any unexpected message', () => {
    const world = new WorldNode({ mapTiles: 160, spawn: { i0: 60, j0: 60, side: 40 } });
    const c = new FakeClient();
    c.id = world.addPlayer(c, 'acc-1');
    world.receive(c.id, encode({ type: 'meditate_start', requestId: hex(1) }));
    expect(c.of('error').at(-1)).toMatchObject({ code: ErrorCode.BadMessage });
  });
  it('a world with progression stays deterministic: same seed and inputs give identical progression output', async () => {
    const run = async () => {
      const { world, c } = await setup();
      world.receive(c.id, encode({ type: 'meditate_start', requestId: hex(1) }));
      ticks(world, 200);
      return JSON.stringify(c.msgs.filter((m) => ['char_state', 'meditate_result'].includes(m.type)));
    };
    expect(await run()).toBe(await run());
  });
});
