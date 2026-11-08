import { describe, expect, it } from 'vitest';
import { rngFloat, rngFork, rngInt, rngNextU32, rngSeed, rngStateValid, type RngState } from '../src/index.js';

function take(state: RngState, n: number): { out: number[]; state: RngState } {
  const out: number[] = [];
  let s = state;
  for (let k = 0; k < n; k++) {
    const [v, next] = rngNextU32(s);
    out.push(v);
    s = next;
  }
  return { out, state: s };
}

// Vectors computed with an independent reference (Python, 32-bit masked arithmetic); the {1,2,3,4} outputs
// also match the published xoshiro128** reference implementation.
describe('xoshiro128** known vectors', () => {
  it('state [1,2,3,4]', () => {
    expect(take([1, 2, 3, 4], 4).out).toEqual([11520, 0, 5927040, 70819200]);
  });
  it('1000th output and final state from [1,2,3,4]', () => {
    const r = take([1, 2, 3, 4], 1000);
    expect(r.out[999]).toBe(0xbcfd424b);
    expect(r.state).toEqual([2954884481, 294556968, 2598411021, 550772539]);
  });
  it('rngSeed expands a uint32 with splitmix32', () => {
    expect(rngSeed(0)).toEqual([1684164658, 3653269916, 2939563536, 2141751570]);
    expect(rngSeed(42)).toEqual([551831576, 144025891, 322543647, 3034809370]);
    expect(take(rngSeed(42), 3).out).toEqual([0x275d943d, 0xd9b9aab4, 0x04a1304e]);
  });
  it('rngFork derives named streams without advancing the parent', () => {
    const p = rngSeed(42);
    expect(rngFork(p, 'combat')).toEqual([943303573, 1337806016, 1613770791, 4164202296]);
    expect(rngFork(p, 'drop')).toEqual([703697195, 1622901495, 4170813549, 2190148391]);
    expect(rngFork(p, 'combat')).toEqual(rngFork(p, 'combat'));
    expect(rngFork(p, 'combat')).not.toEqual(rngFork(p, 'ai'));
  });
});

describe('rng properties', () => {
  it('is pure and serializable: a JSON round-trip continues the same stream', () => {
    const s = rngSeed(7);
    const copy = JSON.parse(JSON.stringify(s)) as unknown;
    expect(rngStateValid(copy)).toBe(true);
    expect(take(copy as RngState, 50).out).toEqual(take(s, 50).out);
    expect(rngNextU32(s)).toEqual(rngNextU32(s));
  });
  it('rngFloat is in [0,1)', () => {
    let s = rngSeed(1);
    for (let k = 0; k < 5000; k++) {
      const [v, n] = rngFloat(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      s = n;
    }
  });
  it('rngInt is bounded and roughly uniform', () => {
    let s = rngSeed(3);
    const buckets = new Array<number>(6).fill(0);
    for (let k = 0; k < 6000; k++) {
      const [v, n] = rngInt(s, 6);
      buckets[v]!++;
      s = n;
    }
    for (const b of buckets) expect(Math.abs(b - 1000)).toBeLessThan(150);
    expect(() => rngInt(s, 0)).toThrow(RangeError);
  });
  it('rejects malformed or all-zero states', () => {
    expect(rngStateValid([1, 2, 3])).toBe(false);
    expect(rngStateValid([1, 2, 3, 1.5])).toBe(false);
    expect(rngStateValid([1, 2, 3, 2 ** 32])).toBe(false);
    expect(rngStateValid([0, 0, 0, 0])).toBe(false);
  });
});
