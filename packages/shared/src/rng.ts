/**
 * Seeded PRNG for every simulation roll (ADR-010 / D63): xoshiro128** with a serializable 4 x uint32 state,
 * seeded with splitmix32. Uses only `Math.imul`, shifts and rotates, so results are identical on every JS engine.
 * All functions are pure and return the next state; the state belongs in the world and in `stateHash()`.
 * Never use `Math.random` / `Date.now` in simulation code (skill vgtd-sim-determinism).
 */
export type RngState = readonly [number, number, number, number];

const TWO_32 = 4294967296;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** splitmix32 step: returns [next counter, output]. */
function splitmix32(x: number): [number, number] {
  const w = (x + 0x9e3779b9) >>> 0;
  let z = w;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return [w, (z ^ (z >>> 15)) >>> 0];
}

function nonZero(w: [number, number, number, number]): RngState {
  // xoshiro's all-zero state is a fixed point; it is unreachable from splitmix32 in practice, but guard anyway.
  if ((w[0] | w[1] | w[2] | w[3]) === 0) w[0] = 1;
  return w;
}

/** Build a state from a 32-bit seed (fractional / negative values are truncated with `>>> 0`). */
export function rngSeed(seed: number): RngState {
  let x = seed >>> 0;
  const w: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const [nx, z] = splitmix32(x);
    x = nx;
    w[k] = z;
  }
  return nonZero(w);
}

/** Build a state from 128 bits of entropy (server economy rolls). Words are truncated to uint32. */
export function rngSeedFromWords(a: number, b: number, c: number, d: number): RngState {
  return nonZero([a >>> 0, b >>> 0, c >>> 0, d >>> 0]);
}

/** Next uint32. Returns [value, nextState]. */
export function rngNextU32(state: RngState): [number, RngState] {
  let [s0, s1, s2, s3] = state;
  const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  s2 = (s2 ^ s0) >>> 0;
  s3 = (s3 ^ s1) >>> 0;
  s1 = (s1 ^ s2) >>> 0;
  s0 = (s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotl(s3, 11);
  return [result, [s0, s1, s2, s3]];
}

/** Returns [value in [0,1), nextState]. */
export function rngFloat(state: RngState): [number, RngState] {
  const [u, s] = rngNextU32(state);
  return [u / TWO_32, s];
}

/** Uniform integer in [0, n), 1 <= n <= 2^32; rejection sampling keeps it unbiased. */
export function rngInt(state: RngState, n: number): [number, RngState] {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32)
    throw new RangeError(`rngInt: n must be an integer in 1..2^32, got ${n}`);
  const limit = TWO_32 - (TWO_32 % n);
  let s = state;
  for (;;) {
    const [u, next] = rngNextU32(s);
    s = next;
    if (u < limit) return [u % n, s];
  }
}

/**
 * Named independent stream derived from `state` and a label (`combat`, `ai`, `drop`, `breakthrough`, `tribulation`,
 * `craft`). Pure: does not advance the parent. Each stream must be drawn in a fixed, documented order.
 */
export function rngFork(state: RngState, label: string): RngState {
  let h = 0x811c9dc5; // FNV-1a over the UTF-16 code units of the label
  for (let k = 0; k < label.length; k++) h = Math.imul(h ^ label.charCodeAt(k), 0x01000193) >>> 0;
  let x = h;
  const w: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const [nx, z] = splitmix32(x);
    x = nx;
    w[k] = (state[k]! ^ z) >>> 0;
  }
  let s = nonZero(w);
  for (let k = 0; k < 8; k++) s = rngNextU32(s)[1];
  return s;
}

/** Type guard for deserialized state (e.g. loaded from a snapshot). */
export function rngStateValid(s: unknown): s is RngState {
  return (
    Array.isArray(s) &&
    s.length === 4 &&
    s.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < TWO_32) &&
    (s[0] | s[1] | s[2] | s[3]) !== 0
  );
}
