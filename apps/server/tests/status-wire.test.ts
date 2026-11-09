/** Own and other players' statuses on the wire (D94): change-only status block, status_update to viewers, movement really locked. */
import { describe, expect, it } from 'vitest';
import { decode, encode, type BaselinePos, type Message } from '@vgtd/protocol';
import { WorldNode, type ClientTransport } from '../src/index.js';

class Client implements ClientTransport {
  msgs: Message[] = [];
  known = new Map<number, BaselinePos>();
  send(data: Uint8Array): void {
    const m = decode(data, { baseline: (i) => this.known.get(i) });
    this.msgs.push(m);
    if (m.type === 'snapshot') for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    else if (m.type === 'aoi_enter') for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    else if (m.type === 'aoi_leave') for (const i of m.indices) this.known.delete(i);
  }
  close(): void {}
  buffered(): number {
    return 0;
  }
  statuses() {
    return this.msgs.flatMap((m) => (m.type === 'snapshot' && m.self?.status ? [m.self.status] : []));
  }
  updates() {
    return this.msgs.flatMap((m) => (m.type === 'status_update' ? [m] : []));
  }
}

const makeNode = () => new WorldNode({ seed: 4, mapTiles: 256, spawn: { i0: 20, j0: 20, side: 1 }, combat: {} });
const ackAll = (node: WorldNode, id: number, c: Client, seqRef: { n: number }, mag = 0, dir = 0): void => {
  seqRef.n++;
  node.receive(
    id,
    encode({
      type: 'input',
      ack: c.msgs.filter((m) => m.type === 'snapshot').length,
      inputs: [{ seq: seqRef.n, dtMs: 50, dir, mag, flags: 0 }],
    }),
  );
};

/** Tick `n` times the way real clients do: every client acknowledges the snapshots it got (otherwise every snapshot is a full one). */
const run = (node: WorldNode, n: number): void => {
  const seqs = new Map<number, { n: number }>();
  for (let k = 0; k < n; k++) {
    for (const c of node.clients.values()) {
      if (!seqs.has(c.id)) seqs.set(c.id, { n: 1000 });
      ackAll(node, c.id, c.transport as unknown as Client, seqs.get(c.id)!, 0, 255);
    }
    node.tick();
  }
};

describe('own status block (D94)', () => {
  it('is sent once when an effect is applied, not again while unchanged, and once more (zeros) when it expires', () => {
    const node = makeNode();
    const c = new Client();
    const id = node.addPlayer(c, 'acc');
    run(node, 10);
    expect(c.statuses()).toHaveLength(0); // nothing active: no block at all
    node.combat!.status.rootPlayer(id, node.world.timeMs, 1000);
    node.combat!.status.slowPlayer(id, node.world.timeMs, 2000, 0.5);
    run(node, 6);
    const first = c.statuses();
    expect(first).toHaveLength(1);
    expect(first[0]!.rootMs).toBeGreaterThan(800);
    expect(first[0]!.rootMs).toBeLessThanOrEqual(1000);
    expect(first[0]!.slowMs).toBeGreaterThan(1700);
    expect(first[0]!.slowPct).toBe(50);
    expect(first[0]!.poisonMs).toBe(0);
    run(node, 10); // unchanged: no new block
    expect(c.statuses()).toHaveLength(1);
    run(node, 20); // the root expired (1 s): one more block, root gone, slow still on
    const second = c.statuses();
    expect(second).toHaveLength(2);
    expect(second[1]!.rootMs).toBe(0);
    expect(second[1]!.slowMs).toBeGreaterThan(0);
    run(node, 40); // the slow expired too: all zeros, then silence
    const all = c.statuses();
    expect(all).toHaveLength(3);
    expect(all[2]).toEqual({ rootMs: 0, slowMs: 0, slowPct: 0, poisonMs: 0 });
    run(node, 20);
    expect(c.statuses()).toHaveLength(3);
  });

  it('a refresh (longer duration) is sent again; a client that joins while the effect is active gets it in its first snapshots', () => {
    const node = makeNode();
    const c = new Client();
    const id = node.addPlayer(c, 'a');
    node.combat!.status.poisonPlayer(id, node.world.timeMs, 3000, 1000, 1, 99);
    run(node, 4);
    expect(c.statuses()).toHaveLength(1);
    node.combat!.status.poisonPlayer(id, node.world.timeMs, 5000, 1000, 1, 99);
    run(node, 4);
    const s = c.statuses();
    expect(s).toHaveLength(2);
    expect(s[1]!.poisonMs).toBeGreaterThan(s[0]!.poisonMs);
    // a reconnect-style resync (new snapshot baseline) while active carries the block again
    const late = new Client();
    const lateId = node.addPlayer(late, 'b');
    node.combat!.status.rootPlayer(lateId, node.world.timeMs, 4000);
    run(node, 4);
    expect(late.statuses().length).toBeGreaterThan(0);
    expect(late.statuses()[0]!.rootMs).toBeGreaterThan(3000);
  });

  it('a rooted player does not move on the server; the same input moves them once the root is over', () => {
    const node = makeNode();
    const c = new Client();
    const id = node.addPlayer(c, 'acc');
    const me = () => node.world.entities.find((e) => e.id === id)!;
    run(node, 5);
    const seq = { n: 5000 }; // after the idle seqs of run()
    node.combat!.status.rootPlayer(id, node.world.timeMs, 1000);
    const i0 = me().i;
    const j0 = me().j;
    for (let k = 0; k < 10; k++) {
      ackAll(node, id, c, seq, 15, 0);
      node.tick();
    }
    expect(Math.hypot(me().i - i0, me().j - j0)).toBeLessThan(0.01);
    for (let k = 0; k < 40; k++) {
      ackAll(node, id, c, seq, 15, 0);
      node.tick();
    }
    expect(Math.hypot(me().i - i0, me().j - j0)).toBeGreaterThan(1);
  });
});

describe('status_update for other players (D94)', () => {
  it('viewers get one update when the mask changes and one when it clears; the player itself and a far player get none', () => {
    const node = makeNode();
    const viewer = new Client();
    const victim = new Client();
    const far = new Client();
    node.addPlayer(viewer, 'viewer');
    const victimId = node.addPlayer(victim, 'victim');
    const farId = node.addPlayer(far, 'far');
    node.world = {
      ...node.world,
      entities: node.world.entities.map((e) => (e.id === farId ? { ...e, i: 200.5, j: 200.5 } : e)),
    };
    run(node, 6);
    node.combat!.status.rootPlayer(victimId, node.world.timeMs, 600);
    node.combat!.status.poisonPlayer(victimId, node.world.timeMs, 1500, 500, 1, 7);
    run(node, 4);
    expect(viewer.updates()).toEqual([{ type: 'status_update', entityId: victimId, mask: 1 | 4 }]);
    run(node, 40); // root and poison both ended
    expect(viewer.updates().map((u) => u.mask)).toEqual([5, 4, 0]); // root gone first, then all clear
    expect(victim.updates()).toHaveLength(0);
    expect(far.updates()).toHaveLength(0);
  });
});
