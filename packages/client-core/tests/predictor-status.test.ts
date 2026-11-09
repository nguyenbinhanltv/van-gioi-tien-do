/** Prediction with root / slow (D94): the predicted movement matches what the server does with the same inputs. */
import { describe, expect, it } from 'vitest';
import { TileGrid, stepMove, type MoveState } from '@vgtd/sim';
import type { InputPacket, SelfState } from '@vgtd/protocol';
import { Predictor, selfToMoveState, type MoveIntent } from '@vgtd/client-core';

const grid = TileGrid.fromRows(Array.from({ length: 128 }, () => '.'.repeat(128)));
const self = (o: Partial<SelfState> = {}): SelfState => ({
  lastSeq: 0,
  i: 20,
  j: 20,
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

/** What the server does: the same rewrite as `StatusSystem.adjustMove`, with the status the SERVER has at that input. */
class FakeServer {
  state: MoveState = selfToMoveState(self(), 100);
  lastSeq = 0;
  constructor(
    public rootMs: number,
    public slowMs = 0,
    public slowFactor = 1,
  ) {}
  process(p: InputPacket): void {
    let mag = p.mag;
    if (this.rootMs > 0) mag = 0;
    else if (this.slowMs > 0) mag = Math.floor(mag * this.slowFactor);
    this.state = stepMove(this.state, { ...p, mag }, grid);
    this.rootMs = Math.max(0, this.rootMs - p.dtMs);
    this.slowMs = Math.max(0, this.slowMs - p.dtMs);
    this.lastSeq = p.seq;
  }
  snapshot(withStatus: boolean): SelfState {
    return self({
      lastSeq: this.lastSeq,
      i: this.state.i,
      j: this.state.j,
      status: withStatus
        ? {
            rootMs: this.rootMs,
            slowMs: this.slowMs,
            slowPct: this.slowMs > 0 ? Math.round(this.slowFactor * 100) : 0,
            poisonMs: 0,
          }
        : null,
    });
  }
}

function drive(p: Predictor, server: FakeServer, n: number, snapshotAfter: number | null, withStatus: boolean): void {
  const sent: InputPacket[] = [];
  for (let k = 0; k < n; k++) {
    const pkt = p.push(EAST, 50)!;
    sent.push(pkt);
    server.process(pkt);
    if (snapshotAfter !== null && k + 1 === snapshotAfter) p.reconcile(server.snapshot(withStatus));
  }
}

describe('Predictor with root / slow (D94)', () => {
  it('a rooted player predicts standing still: the replay after the status block matches the server, and the root ends at the same input', () => {
    const p = new Predictor(grid);
    p.reconcile(self());
    const server = new FakeServer(500); // rooted for 10 inputs from the start
    // the status block arrives with the snapshot acking the first 4 inputs: 6 are still unacked and are replayed under the root
    drive(p, server, 8, null, true);
    const ackServer = new FakeServer(500);
    const pktsAcked: InputPacket[] = [];
    for (let k = 0; k < 4; k++) pktsAcked.push({ seq: k + 1, dtMs: 50, dir: 0, mag: 15, flags: 0 });
    pktsAcked.forEach((x) => ackServer.process(x));
    p.reconcile(ackServer.snapshot(true)); // root 300 ms left at the ack
    expect(p.moveStatus.rootMs).toBe(300 - 4 * 50); // 4 unacked inputs replayed
    // keep going: client and server both step 12 more inputs; the root ends after input 10 on both
    for (let k = 0; k < 12; k++) {
      const pkt = p.push(EAST, 50)!;
      server.process(pkt);
    }
    p.reconcile(server.snapshot(false)); // a status-less snapshot: nothing changed on the server, the client's own countdown holds
    expect(p.lastError).toBeLessThan(1e-4);
    expect(server.state.i).toBeGreaterThan(20.5); // it moved after the root ended
    expect(p.moveStatus.rootMs).toBe(0);
  });

  it('a slowed player predicts the slower speed: no drift against the server over a long walk', () => {
    const p = new Predictor(grid);
    p.reconcile(self());
    const server = new FakeServer(0, 2000, 0.5);
    const ack = new FakeServer(0, 2000, 0.5);
    p.reconcile(ack.snapshot(true)); // block arrives before any input
    expect(p.moveStatus.slowMs).toBe(2000);
    for (let k = 0; k < 60; k++) {
      const pkt = p.push(EAST, 50)!;
      server.process(pkt);
    }
    p.reconcile(server.snapshot(false));
    expect(p.lastError).toBeLessThan(1e-4);
    // and it really is slower than an unaffected walk of the same inputs
    const free = new FakeServer(0);
    for (let k = 0; k < 60; k++) free.process({ seq: k + 1, dtMs: 50, dir: 0, mag: 15, flags: 0 });
    expect(server.state.i - 20).toBeLessThan((free.state.i - 20) * 0.9);
  });

  it('without status knowledge a rooted server makes the old prediction drift (the rubber-band this fixes), and an all-zero block clears the assumption', () => {
    const p = new Predictor(grid);
    p.reconcile(self());
    const server = new FakeServer(1000);
    drive(p, server, 10, null, false);
    p.reconcile(server.snapshot(false)); // no status info: the client predicted a walk, the server stood still
    expect(p.lastError).toBeGreaterThan(0.5);
    p.reconcile(server.snapshot(true));
    expect(p.moveStatus.rootMs).toBeGreaterThan(0);
    const cleared = self({ lastSeq: 10, status: { rootMs: 0, slowMs: 0, slowPct: 0, poisonMs: 0 } });
    p.reconcile(cleared);
    expect(p.moveStatus).toEqual({ rootMs: 0, slowMs: 0, slowFactor: 1 });
  });

  it('inputs are still sent unmodified (the server rewrites them itself)', () => {
    const p = new Predictor(grid);
    p.reconcile(self({ status: { rootMs: 5000, slowMs: 0, slowPct: 0, poisonMs: 0 } }));
    const pkt = p.push(EAST, 50)!;
    expect(pkt.mag).toBe(15);
    expect(p.recent(1)[0]!.mag).toBe(15);
  });
});

describe('status HUD data (D94)', () => {
  it('statusRowItems lists root, slow, poison, shield in a fixed order with rounded-up seconds', async () => {
    const { statusRowItems, statusMaskGlyphs } = await import('@vgtd/client-core');
    expect(statusRowItems({ rootMs: 0, slowMs: 0, slowPct: 0, poisonMs: 0 }, 0)).toEqual([]);
    const items = statusRowItems({ rootMs: 1200, slowMs: 400, slowPct: 50, poisonMs: 3000 }, 80);
    expect(items.map((i) => i.id)).toEqual(['root', 'slow', 'poison', 'shield']);
    expect(items.map((i) => i.secs)).toEqual([2, 1, 3, null]);
    expect(items[1]!.note).toBe('-50%');
    expect(items[3]!.note).toBe('80');
    expect(statusMaskGlyphs(0)).toBe('');
    expect(statusMaskGlyphs(1 | 4)).toBe('TROI DOC');
  });
});
