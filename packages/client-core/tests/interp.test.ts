import { describe, expect, it } from 'vitest';
import { NETWORK } from '@vgtd/shared';
import type { AoiEnterMsg, SnapshotMsg } from '@vgtd/protocol';
import { DEFAULT_INTERP_DELAY_MS, MAX_INTERP_DELAY_MS, RemoteWorld } from '@vgtd/client-core';

const Q = 32;
const enter = (i: number, j: number): AoiEnterMsg => ({
  type: 'aoi_enter',
  entities: [{ index: 1, entityId: 7, kind: 0, qi: i * Q, qj: j * Q, anim: 0, dir: 2, hpPct: 100, maxHp: 1000 }],
});
const snap = (i: number, j: number): SnapshotMsg => ({
  type: 'snapshot',
  seq: 1,
  baselineSeq: null,
  tick: 1,
  self: null,
  entities: [{ index: 1, qi: Math.round(i * Q), qj: Math.round(j * Q), anim: 1, dir: 2, hpPct: null }],
});

/** Feed one entity moving at `speed` tiles/s with a snapshot every `periodMs`; sample at 60 fps. Returns per-frame x. */
function run(w: RemoteWorld, periodMs: number, speed: number, seconds: number): { t: number; i: number }[] {
  let x = 10;
  w.onEnter(enter(x, 10), 0);
  const frames: { t: number; i: number }[] = [];
  let nextSnap = periodMs;
  for (let t = 0; t <= seconds * 1000; t += 1000 / 60) {
    while (nextSnap <= t) {
      x = 10 + (speed * nextSnap) / 1000;
      w.onSnapshot(snap(x, 10), nextSnap);
      nextSnap += periodMs;
    }
    const v = w.sample(t)[0]!;
    frames.push({ t, i: v.i });
  }
  return frames;
}

/** Longest run of consecutive frames in which the drawn position did not change at all (after warm-up). */
function longestFreezeMs(frames: { t: number; i: number }[], from: number): number {
  let best = 0;
  let start = -1;
  for (let k = 1; k < frames.length; k++) {
    if (frames[k]!.t < from) continue;
    const still = Math.abs(frames[k]!.i - frames[k - 1]!.i) < 1e-9;
    if (still && start < 0) start = frames[k - 1]!.t;
    if (!still && start >= 0) {
      best = Math.max(best, frames[k - 1]!.t - start);
      start = -1;
    }
  }
  if (start >= 0) best = Math.max(best, frames.at(-1)!.t - start);
  return best;
}

describe('adaptive interpolation delay (D73)', () => {
  it('uses the shared constants: base 150 ms, cap 250 ms, factor 1.25', () => {
    expect(DEFAULT_INTERP_DELAY_MS).toBe(NETWORK.INTERP_DELAY_MS_MOBILE);
    expect(MAX_INTERP_DELAY_MS).toBe(NETWORK.INTERP_DELAY_MS_MOBILE_MAX);
    expect(NETWORK.INTERP_SPACING_FACTOR).toBe(1.25);
  });

  it('keeps the 150 ms base for 20 Hz and 10 Hz entities and raises it to 250 ms for 5 Hz ones', () => {
    for (const [period, want] of [
      [50, 150],
      [100, 150], // 1.25 x 100 = 125 < 150
      [200, 250], // 1.25 x 200 = 250
    ] as const) {
      const w = new RemoteWorld();
      run(w, period, 4.5, 3);
      expect(w.delayOf(w.entities.get(1)!), `${period} ms spacing`).toBeCloseTo(want, 6);
    }
  });

  it('never exceeds the cap and ignores long quiet gaps when estimating the spacing', () => {
    const w = new RemoteWorld();
    w.onEnter(enter(10, 10), 0);
    w.onSnapshot(snap(11, 10), 3000); // 3 s gap: idle, not a snapshot rate
    expect(w.delayOf(w.entities.get(1)!)).toBe(150);
    const e = w.entities.get(1)!;
    e.spacingMs = 10_000; // even a pathological estimate cannot push the delay past the cap
    expect(w.delayOf(e)).toBe(250);
  });

  it('a 5 Hz entity moves continuously with the adaptive delay but freezes every cycle with a fixed 150 ms delay', () => {
    const adaptive = run(new RemoteWorld(150, 250), 200, 4.5, 6);
    const fixed = run(new RemoteWorld(150, 150), 200, 4.5, 6);
    expect(longestFreezeMs(adaptive, 2000)).toBeLessThan(40); // a frame or two at most
    expect(longestFreezeMs(fixed, 2000)).toBeGreaterThan(40); // ~50 ms hold per 200 ms cycle
    // and the adaptive path is also smooth in speed: ~4.5 tiles/s between frames
    const steps = adaptive.slice(1).map((f, k) => (f.i - adaptive[k]!.i) / ((f.t - adaptive[k]!.t) / 1000));
    const settled = steps.filter((_, k) => adaptive[k]!.t > 2000);
    for (const s of settled) expect(Math.abs(s - 4.5)).toBeLessThan(0.5);
  });

  it('adapts when an entity changes band (20 Hz -> 5 Hz)', () => {
    const w = new RemoteWorld();
    w.onEnter(enter(10, 10), 0);
    let t = 0;
    for (let k = 0; k < 20; k++) w.onSnapshot(snap(10 + k * 0.2, 10), (t += 50));
    expect(w.delayOf(w.entities.get(1)!)).toBe(150);
    for (let k = 0; k < 12; k++) w.onSnapshot(snap(14 + k, 10), (t += 200));
    expect(w.delayOf(w.entities.get(1)!)).toBeGreaterThan(240);
  });

  it('an entity that stood still (no records) and then moves does not pop: it starts from where it stood', () => {
    const w = new RemoteWorld();
    w.onEnter(enter(10, 10), 0);
    let t = 0;
    for (let k = 0; k < 10; k++) w.onSnapshot(snap(10, 10), (t += 100)); // establishes ~100 ms spacing
    // ... 3 s with no records at all (unchanged), then it takes a step
    const resume = t + 3000;
    w.onSnapshot(snap(10.6, 10), resume);
    // 150 ms after the record arrived the drawn position must be between the old and new spot, not already at the new one
    const atArrival = w.sample(resume)[0]!;
    expect(atArrival.i).toBeCloseTo(10, 1); // still at the old position (we draw 150 ms in the past)
    const later = w.sample(resume + 150)[0]!;
    expect(later.i).toBeGreaterThan(10);
    expect(later.i).toBeLessThanOrEqual(10.6 + 1e-9);
    // monotonic, no jump larger than the step
    let prev = atArrival.i;
    for (let dt = 0; dt <= 300; dt += 10) {
      const x = w.sample(resume + dt)[0]!.i;
      expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(x - prev).toBeLessThan(0.35);
      prev = x;
    }
  });

  it('the custom base delay still applies as the floor', () => {
    const w = new RemoteWorld(100, 250);
    run(w, 50, 4.5, 2);
    expect(w.delayOf(w.entities.get(1)!)).toBe(100);
  });
});
