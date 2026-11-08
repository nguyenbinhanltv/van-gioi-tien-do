import { describe, expect, it } from 'vitest';
import { AOI, toUW } from '@vgtd/shared';
import {
  ErrorCode,
  decode,
  dequantizePos,
  encode,
  type BaselinePos,
  type Message,
  type SnapshotMsg,
} from '@vgtd/protocol';
import { TileGrid, compileSkills, type EntityState } from '@vgtd/sim';
import { WorldNode, type ClientTransport, type WorldNodeOptions } from '../src/index.js';

/** A fake client connection that decodes every frame exactly like a real client (per-index baseline). */
class FakeClient implements ClientTransport {
  msgs: Message[] = [];
  closed: { code: ErrorCode; text: string } | null = null;
  known = new Map<number, BaselinePos>();
  entityIdsByIndex = new Map<number, number>();
  id = 0;
  seq = 0;
  lastSnapshotSeq = 0;
  buffer = 0;

  send(data: Uint8Array): void {
    const m = decode(data, { baseline: (i) => this.known.get(i) });
    this.msgs.push(m);
    if (m.type === 'snapshot') {
      this.lastSnapshotSeq = m.seq;
      for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    } else if (m.type === 'aoi_enter') {
      for (const e of m.entities) {
        this.known.set(e.index, { qi: e.qi, qj: e.qj });
        this.entityIdsByIndex.set(e.index, e.entityId);
      }
    } else if (m.type === 'aoi_leave') {
      for (const i of m.indices) {
        this.known.delete(i);
        this.entityIdsByIndex.delete(i);
      }
    }
  }
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return this.buffer;
  }
  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.msgs.filter((m): m is Extract<Message, { type: T }> => m.type === type);
  }
  inputBytes(dir: number, dtMs = 50, count = 1, mag = 15): Uint8Array {
    const inputs = [];
    for (let k = 0; k < count; k++) inputs.push({ seq: ++this.seq & 0xffff, dtMs, dir, mag, flags: 0 });
    return encode({ type: 'input', ack: this.lastSnapshotSeq, inputs: inputs.slice(-3) });
  }
}

function node(opts: WorldNodeOptions = {}): WorldNode {
  return new WorldNode({ mapTiles: 160, spawn: { i0: 60, j0: 60, side: 40 }, ...opts });
}
function join(n: WorldNode): FakeClient {
  const c = new FakeClient();
  c.id = n.addPlayer(c, `acc${n.clients.size}`);
  return c;
}
function ent(n: WorldNode, id: number): EntityState {
  return n.world.entities.find((e) => e.id === id)!;
}
/** Test helper: put an entity on an exact tile position (the sim itself never teleports). */
function place(n: WorldNode, id: number, i: number, j: number): void {
  n.world = { ...n.world, entities: n.world.entities.map((e) => (e.id === id ? { ...e, i, j } : e)) };
}
function ticks(n: WorldNode, k: number): void {
  for (let t = 0; t < k; t++) n.tick();
}
/** A point at screen-axis offset (du, dw) from (i, j) = (80, 80). */
function at(du: number, dw: number): { i: number; j: number } {
  return { i: 80 + (dw + du) / 2, j: 80 + (dw - du) / 2 };
}

describe('World Node: AOI (docs/08 §2)', () => {
  it('a player inside the enter area is announced, with hysteresis before it leaves', () => {
    const n = node();
    const a = join(n);
    const b = join(n);
    place(n, a.id, 80, 80);
    place(n, b.id, at(30, 20).i, at(30, 20).j);
    ticks(n, 2);
    const enter = a.of('aoi_enter').flatMap((m) => m.entities);
    expect(enter.map((e) => e.entityId)).toContain(b.id);
    expect(a.of('aoi_leave')).toHaveLength(0);

    // |u| = 43 is outside the enter radius (40) but inside the exit radius (46): stays visible
    const mid = at(43, 20);
    place(n, b.id, mid.i, mid.j);
    ticks(n, 2);
    expect(a.of('aoi_leave')).toHaveLength(0);

    // |u| = 50 > 46: leaves, and the freed index is reported
    const far = at(50, 20);
    place(n, b.id, far.i, far.j);
    ticks(n, 2);
    expect(a.of('aoi_leave').flatMap((m) => m.indices)).toHaveLength(1);

    // coming back inside re-enters it (index reuse is safe because leave is sent before enter)
    place(n, b.id, at(10, 10).i, at(10, 10).j);
    ticks(n, 2);
    expect(a.of('aoi_enter').flatMap((m) => m.entities.map((e) => e.entityId))).toEqual([b.id, b.id]);
  });

  it('uses the exact |du|<=40, |dw|<=45 box from @vgtd/shared', () => {
    const n = node();
    const a = join(n);
    const inside = join(n);
    const outside = join(n);
    place(n, a.id, 80, 80);
    place(n, inside.id, at(39, 44).i, at(39, 44).j);
    place(n, outside.id, at(10, 47).i, at(10, 47).j);
    ticks(n, 2);
    const seen = a.of('aoi_enter').flatMap((m) => m.entities.map((e) => e.entityId));
    expect(seen).toContain(inside.id);
    expect(seen).not.toContain(outside.id);
    expect(AOI.HALF_U).toBe(40);
  });

  it('caps visible entities per client and keeps the nearest ones', () => {
    const n = node({ maxVisible: 3 });
    const a = join(n);
    const others = Array.from({ length: 6 }, () => join(n));
    place(n, a.id, 80, 80);
    others.forEach((o, k) => place(n, o.id, at(k * 5, 5).i, at(k * 5, 5).j));
    ticks(n, 2);
    const seen = a.of('aoi_enter').flatMap((m) => m.entities.map((e) => e.entityId));
    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set(others.slice(0, 3).map((o) => o.id)));
  });

  it('snapshots honour distance bands: near 20 Hz, far 5 Hz', () => {
    const n = node();
    const a = join(n);
    const near = join(n);
    const far = join(n);
    place(n, a.id, 80, 80);
    place(n, near.id, at(5, 5).i, at(5, 5).j);
    place(n, far.id, at(38, 40).i, at(38, 40).j);
    ticks(n, 2);
    const idxOf = (id: number): number => [...a.entityIdsByIndex].find(([, e]) => e === id)![0];
    const before = a.of('snapshot').length;
    ticks(n, 40);
    const snaps = a.of('snapshot').slice(before);
    const count = (idx: number): number => snaps.filter((s) => s.entities.some((e) => e.index === idx)).length;
    expect(count(idxOf(near.id))).toBe(40);
    expect(count(idxOf(far.id))).toBe(10);
  });
});

describe('World Node: snapshots, deltas and reconciliation data', () => {
  it('self block echoes lastSeq and the authoritative position; other entities decode to their true positions', () => {
    const n = node();
    const a = join(n);
    const b = join(n);
    place(n, a.id, 80, 80);
    place(n, b.id, 85, 82);
    ticks(n, 2);
    for (let k = 0; k < 10; k++) {
      n.receive(a.id, a.inputBytes(0));
      n.receive(b.id, b.inputBytes(64));
      n.tick();
    }
    const last = a.of('snapshot').at(-1)!;
    expect(last.self!.lastSeq).toBe(10);
    expect(last.self!.i).toBeCloseTo(ent(n, a.id).i, 3);
    const idx = [...a.entityIdsByIndex].find(([, e]) => e === b.id)![0];
    const rec = a.known.get(idx)!;
    expect(dequantizePos(rec.qi)).toBeCloseTo(ent(n, b.id).i, 1);
    expect(dequantizePos(rec.qj)).toBeCloseTo(ent(n, b.id).j, 1);
  });

  it('first snapshot is full, later ones are delta against the previous one; no ack for 1 s forces a full snapshot', () => {
    const n = node();
    const a = join(n);
    const b = join(n);
    place(n, a.id, 80, 80);
    place(n, b.id, 84, 80);
    ticks(n, 2);
    const snaps = (): SnapshotMsg[] => a.of('snapshot');
    expect(snaps()[0]!.baselineSeq).toBeNull();
    n.receive(a.id, a.inputBytes(255, 50, 1, 0));
    ticks(n, 2);
    expect(snaps().at(-1)!.baselineSeq).not.toBeNull();
    ticks(n, 25); // 1.25 s without any input packet (= no ack)
    expect(snaps().some((s, k) => k > 3 && s.baselineSeq === null)).toBe(true);
  });

  it('a duplicate input packet is applied once (the 3-input redundancy window does not double-move)', () => {
    const n = node();
    const a = join(n);
    place(n, a.id, 80, 80);
    const pkt = a.inputBytes(0);
    n.receive(a.id, pkt);
    n.receive(a.id, pkt);
    n.tick();
    expect(ent(n, a.id).i).toBeCloseTo(80 + 4.5 * 0.05, 6);
  });

  it('pong echoes the client time and carries server time', () => {
    const n = node();
    const a = join(n);
    n.receive(a.id, encode({ type: 'ping', clientTimeMs: 1234 }));
    expect(a.of('pong')[0]).toMatchObject({ clientTimeMs: 1234, serverTimeMs: 0 });
  });
});

describe('World Node: server authority and anti-cheat', () => {
  it('honest 20 Hz play moves at walk speed and raises no violations', () => {
    const n = node();
    const a = join(n);
    place(n, a.id, 70, 80);
    for (let k = 0; k < 100; k++) {
      n.receive(a.id, a.inputBytes(0));
      n.tick();
    }
    expect(ent(n, a.id).i - 70).toBeCloseTo(4.5 * 5, 3);
    expect(n.metrics.violations).toEqual({});
    expect(a.closed).toBeNull();
  });

  it('speedhack (3 inputs per tick): travel stays at legit speed and the client is kicked', () => {
    const n = node();
    const a = join(n);
    place(n, a.id, 62, 80);
    let ticksRun = 0;
    let lastI = 62;
    while (!a.closed && ticksRun < 400) {
      n.receive(a.id, a.inputBytes(0, 50, 3));
      n.tick();
      if (!a.closed) lastI = ent(n, a.id).i;
      ticksRun++;
    }
    expect(a.closed?.code).toBe(ErrorCode.Kicked);
    // real elapsed time * walk speed (+2% clock tolerance) + the 250 ms budget slack is the most it can ever have travelled
    const legit = 4.5 * (ticksRun / 20) * 1.02 + 4.5 * 0.25 * 1.05;
    expect(lastI - 62).toBeLessThanOrEqual(legit + 1e-6);
    expect(n.metrics.disconnects).toBeGreaterThan(0);
    expect(n.clients.has(a.id)).toBe(false);
  });

  it('teleport attempt (declared dt of 250 ms) never moves farther than a legal step and is penalised', () => {
    const n = node();
    const a = join(n);
    place(n, a.id, 70, 80);
    n.receive(a.id, a.inputBytes(0, 250));
    n.tick();
    expect(ent(n, a.id).i - 70).toBeLessThanOrEqual(4.5 * 0.05 * 1.05 + 1e-9);
    expect(n.metrics.violations.dt).toBe(1);
  });

  it('walls are enforced server side (no walking through blocked tiles)', () => {
    const rows = Array.from({ length: 40 }, () => '.'.repeat(20) + '#' + '.'.repeat(19));
    const n = new WorldNode({ grid: TileGrid.fromRows(rows), spawn: { i0: 10, j0: 10, side: 1 } });
    const a = join(n);
    place(n, a.id, 15.5, 20.5);
    for (let k = 0; k < 60; k++) {
      n.receive(a.id, a.inputBytes(0));
      n.tick();
    }
    expect(ent(n, a.id).i).toBeLessThanOrEqual(20 - 0.35 + 1e-9);
    expect(ent(n, a.id).i).toBeGreaterThan(19);
  });

  it('casts go through server-held cooldowns: first ok, immediate repeat rejected', () => {
    const skills = compileSkills();
    const free = skills.findIndex((s) => s.targeting === 'none' && s.mpCostPct === 0);
    const any = free >= 0 ? free : skills.findIndex((s) => s.targeting === 'none');
    const n = node();
    const a = join(n);
    n.receive(a.id, encode({ type: 'skill_cast', seq: 1, skillId: any, targetId: 0 }));
    n.tick();
    expect(a.of('skill_result')[0]).toMatchObject({ seq: 1, skillId: any });
    expect(a.of('skill_result')[0]!.hits).toEqual([]);
    n.receive(a.id, encode({ type: 'skill_cast', seq: 2, skillId: any, targetId: 0 }));
    n.tick();
    expect(a.of('skill_result')).toHaveLength(2);
    expect(a.of('skill_result')[1]!.reason).not.toBe(0);
    n.receive(a.id, encode({ type: 'skill_cast', seq: 3, skillId: 60, targetId: 0 }));
    n.tick();
    expect(a.of('skill_result')[2]!.reason).toBe(1); // unknown skill
  });

  it('malformed packets are answered with an error and repeated ones kick the client', () => {
    const n = node();
    const a = join(n);
    for (let k = 0; k < 5; k++) n.receive(a.id, new Uint8Array([9, 9, 9]));
    expect(a.of('error').length).toBeGreaterThanOrEqual(5);
    expect(a.closed?.code).toBe(ErrorCode.BadMessage);
    expect(n.metrics.kicksBadMessages).toBe(1);
  });

  it('packet flood above the per-second limit is kicked', () => {
    const n = node();
    const a = join(n);
    for (let k = 0; k < 130 && !a.closed; k++) n.receive(a.id, encode({ type: 'ping', clientTimeMs: k }));
    expect(a.closed?.code).toBe(ErrorCode.RateLimited);
  });

  it('a slow consumer skips snapshots and is eventually kicked', () => {
    const n = node();
    const a = join(n);
    a.buffer = 300 * 1024;
    const before = a.of('snapshot').length;
    ticks(n, 3);
    expect(a.of('snapshot').length).toBe(before);
    expect(n.statsOf(a.id)!.snapshotsSkipped).toBe(3);
    a.buffer = 3 * 1024 * 1024;
    n.tick();
    expect(a.closed?.code).toBe(ErrorCode.Internal);
  });

  it('spawn positions are deterministic for a seed', () => {
    const pos = (seed: number): number[] => {
      const n = node({ seed });
      const a = join(n);
      const b = join(n);
      return [ent(n, a.id).i, ent(n, a.id).j, ent(n, b.id).i, ent(n, b.id).j];
    };
    expect(pos(5)).toEqual(pos(5));
    expect(pos(5)).not.toEqual(pos(6));
    expect(toUW(1, 1).u).toBe(0);
  });
});
