import { describe, expect, it } from 'vitest';
import { TileGrid, stepMove, type MoveState } from '@vgtd/sim';
import type { AoiEnterMsg, SelfState, SnapshotMsg } from '@vgtd/protocol';
import {
  MAX_PENDING_INPUTS,
  Predictor,
  RemoteWorld,
  SNAP_ERROR_TILES,
  resolveServer,
  selfToMoveState,
  type MoveIntent,
} from '@vgtd/client-core';

const grid = TileGrid.fromRows(Array.from({ length: 64 }, () => '.'.repeat(64)));
const self = (o: Partial<SelfState> = {}): SelfState => ({
  lastSeq: 0,
  i: 10,
  j: 10,
  layer: 0,
  flying: false,
  qinggong: false,
  facing: 0,
  dashLeftMs: 0,
  dashCdMs: 0,
  invulnMs: 0,
  vitals: null,
  status: null,
  ...o,
});
const EAST: MoveIntent = { dir: 0, mag: 15, flags: 0 };

function ready(p = new Predictor(grid)): Predictor {
  p.reconcile(self());
  return p;
}

describe('Predictor', () => {
  it('does not predict or emit inputs before the first snapshot', () => {
    const p = new Predictor(grid);
    expect(p.ready).toBe(false);
    expect(p.push(EAST, 50)).toBeNull();
    expect(p.display()).toBeNull();
  });

  it('runs the same stepMove the server runs (prediction == authoritative result)', () => {
    const p = ready();
    let s: MoveState = selfToMoveState(self(), 100);
    for (let k = 0; k < 40; k++) {
      p.push(EAST, 50);
      s = stepMove(s, { dtMs: 50, dir: 0, mag: 15, flags: 0 }, grid);
    }
    expect(p.state!.i).toBe(s.i);
    expect(p.state!.j).toBe(s.j);
    expect(p.state!.i).toBeGreaterThan(10 + 8); // 2 s at ~4.5 tiles/s
  });

  it('numbers inputs from 1, wraps at uint16 and resends only the newest three', () => {
    const p = ready();
    const seqs = [1, 2, 3, 4].map(() => p.push(EAST, 50)!.seq);
    expect(seqs).toEqual([1, 2, 3, 4]);
    expect(p.recent().map((x) => x.seq)).toEqual([2, 3, 4]);
    (p as unknown as { seq: number }).seq = 0xffff;
    expect(p.push(EAST, 50)!.seq).toBe(0);
  });

  it('exact agreement: reconcile drops acked inputs, replays the rest and leaves no correction', () => {
    const p = ready();
    const server: MoveState[] = [selfToMoveState(self(), 100)];
    for (let k = 0; k < 10; k++) {
      p.push(EAST, 50);
      server.push(stepMove(server[k]!, { dtMs: 50, dir: 0, mag: 15, flags: 0 }, grid));
    }
    const before = p.state!.i;
    // the server has processed 6 of the 10 inputs
    p.reconcile(self({ lastSeq: 6, i: server[6]!.i, j: server[6]!.j, facing: 0 }));
    expect(p.pendingCount).toBe(4);
    expect(p.lastError).toBeLessThan(1e-9);
    expect(p.state!.i).toBeCloseTo(before, 9);
    const d = p.display()!;
    expect(d.i).toBeCloseTo(before, 9);
  });

  it('a small disagreement is eased in over 100 ms, a medium one over 200 ms, a huge one snaps', () => {
    const run = (shift: number) => {
      const p = ready();
      for (let k = 0; k < 4; k++) p.push(EAST, 50);
      const shown = p.display()!;
      // the server believes we are `shift` tiles behind where we predicted (no inputs acked)
      p.reconcile(self({ lastSeq: 0, i: 10 - shift }));
      return { p, shown };
    };
    const small = run(0.1);
    expect(small.p.display()!.i).toBeCloseTo(small.shown.i, 6); // still drawn where the player saw it
    small.p.advance(50);
    const mid = small.p.display()!.i;
    expect(mid).toBeLessThan(small.shown.i);
    expect(mid).toBeGreaterThan(small.p.state!.i);
    small.p.advance(60);
    expect(small.p.display()!.i).toBeCloseTo(small.p.state!.i, 9);

    const medium = run(1);
    medium.p.advance(150); // 200 ms ease: not finished after 150 ms
    expect(medium.p.display()!.i).toBeGreaterThan(medium.p.state!.i + 1e-6);
    medium.p.advance(60);
    expect(medium.p.display()!.i).toBeCloseTo(medium.p.state!.i, 9);

    const big = run(SNAP_ERROR_TILES + 1);
    expect(big.p.display()!.i).toBeCloseTo(big.p.state!.i, 9); // snapped immediately
  });

  it('keeps a bounded queue while the server stays silent', () => {
    const p = ready();
    for (let k = 0; k < MAX_PENDING_INPUTS + 50; k++) p.push(EAST, 50);
    expect(p.pendingCount).toBe(MAX_PENDING_INPUTS);
  });

  it('client-side collisions match: walking into a wall stops at the same place as the server', () => {
    const walled = TileGrid.fromRows(['..........', '..........', '..........', '.....#....', '..........']);
    const p = new Predictor(walled);
    p.reconcile(self({ i: 1.5, j: 3.5 }));
    for (let k = 0; k < 60; k++) p.push(EAST, 50);
    let s = selfToMoveState(self({ i: 1.5, j: 3.5 }), 100);
    for (let k = 0; k < 60; k++) s = stepMove(s, { dtMs: 50, dir: 0, mag: 15, flags: 0 }, walled);
    expect(p.state!.i).toBe(s.i);
    expect(p.state!.i).toBeLessThan(5); // blocked by the pillar at tile 5
  });
});

describe('RemoteWorld interpolation', () => {
  const enter = (index: number, i: number, j: number): AoiEnterMsg => ({
    type: 'aoi_enter',
    entities: [
      { index, entityId: 100 + index, kind: 0, defId: 0, qi: i * 32, qj: j * 32, anim: 0, dir: 2, hpPct: 100, maxHp: 1000 },
    ],
  });
  const snap = (index: number, i: number, j: number, anim = 1): SnapshotMsg => ({
    type: 'snapshot',
    seq: 1,
    baselineSeq: null,
    tick: 1,
    self: null,
    entities: [{ index, qi: i * 32, qj: j * 32, anim, dir: 3, hpPct: null }],
  });

  it('draws 150 ms in the past, interpolating between the two bracketing samples', () => {
    const w = new RemoteWorld(150);
    w.onEnter(enter(5, 10, 10), 1000);
    w.onSnapshot(snap(5, 12, 10), 1100);
    w.onSnapshot(snap(5, 14, 10), 1200);
    // at now = 1275 we draw t = 1125: a quarter of the way from 12 to 14
    const [v] = w.sample(1275);
    expect(v!.i).toBeCloseTo(12.5, 6);
    expect(v!.speed).toBeCloseTo(20, 6); // 2 tiles per 100 ms
    expect(v!.entityId).toBe(105);
    expect(v!.dir).toBe(3);
    // exactly at a sample time -> that sample
    expect(w.sample(1250)[0]!.i).toBeCloseTo(12, 6);
  });

  it('holds still past the newest sample (no extrapolation) and before the first one', () => {
    const w = new RemoteWorld(150);
    w.onEnter(enter(1, 3, 4), 1000);
    expect(w.sample(1010)[0]!.i).toBeCloseTo(3, 6);
    w.onSnapshot(snap(1, 5, 4), 1100);
    const late = w.sample(5000)[0]!;
    expect(late.i).toBeCloseTo(5, 6);
    expect(late.speed).toBe(0);
  });

  it('leave removes the entity and its baseline; unknown snapshot indices are ignored', () => {
    const w = new RemoteWorld();
    w.onEnter(enter(2, 1, 1), 0);
    expect(w.baseline(2)).toEqual({ qi: 32, qj: 32 });
    w.onLeave({ type: 'aoi_leave', indices: [2] });
    expect(w.baseline(2)).toBeUndefined();
    expect(w.sample(1000)).toHaveLength(0);
    w.onSnapshot(snap(9, 1, 1), 10);
    expect(w.sample(1000)).toHaveLength(0);
  });

  it('keeps a bounded sample history', () => {
    const w = new RemoteWorld();
    w.onEnter(enter(0, 0, 0), 0);
    for (let k = 1; k <= 100; k++) w.onSnapshot(snap(0, k % 50, 0), k * 50);
    expect(w.entities.get(0)!.samples.length).toBeLessThanOrEqual(8);
  });
});

describe('resolveServer (credentials only go to the page host or loopback)', () => {
  it('defaults to the page host on :8080 and accepts host:port or a full URL on allowed hosts', () => {
    expect(resolveServer(null, 'localhost')).toEqual({ origin: 'http://localhost:8080', ignored: false });
    expect(resolveServer('', 'game.lan')).toEqual({ origin: 'http://game.lan:8080', ignored: false });
    expect(resolveServer('localhost:9000', 'game.lan')).toEqual({ origin: 'http://localhost:9000', ignored: false });
    expect(resolveServer('http://127.0.0.1:8081', 'x')).toEqual({ origin: 'http://127.0.0.1:8081', ignored: false });
    expect(resolveServer('game.lan:8090', 'game.lan')).toEqual({ origin: 'http://game.lan:8090', ignored: false });
  });

  it('ignores third-party hosts, credentials in the URL and paths', () => {
    for (const bad of [
      'evil.example',
      'http://evil.example:8080',
      'localhost.evil.example:8080',
      'http://user:pw@localhost:8080',
      'http://localhost:8080/steal',
      '//evil.example',
      'http://[::1]:8080',
    ]) {
      expect(resolveServer(bad, 'localhost'), bad).toEqual({ origin: 'http://localhost:8080', ignored: true });
    }
  });
});
