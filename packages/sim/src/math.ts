/**
 * Deterministic math. `Math.sin/cos/hypot/pow` are not guaranteed bit-identical across JS engines, so the
 * simulation only uses + − × ÷ and sqrt (all IEEE-754 exact-rounded) plus a Taylor-series direction table.
 */
import { DIR_CODES } from './constants.js';

const TAU = Math.PI * 2;

function sinTaylor(x: number): number {
  let term = x;
  let sum = x;
  for (let n = 1; n <= 14; n++) {
    term = (-term * x * x) / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
}
function cosTaylor(x: number): number {
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 14; n++) {
    term = (-term * x * x) / ((2 * n - 1) * (2 * n));
    sum += term;
  }
  return sum;
}

/** DIR_COS[k], DIR_SIN[k] = cos/sin of k/256 · 2π (angle measured in tile space from +i toward +j). */
export const DIR_COS: Float64Array = new Float64Array(DIR_CODES);
export const DIR_SIN: Float64Array = new Float64Array(DIR_CODES);
for (let k = 0; k < DIR_CODES; k++) {
  const q = k >> 6;
  const a = (k & 63) * (TAU / DIR_CODES);
  const s = sinTaylor(a);
  const c = cosTaylor(a);
  const [cx, sx] = q === 0 ? [c, s] : q === 1 ? [-s, c] : q === 2 ? [-c, -s] : [s, -c];
  DIR_COS[k] = cx;
  DIR_SIN[k] = sx;
}

export function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Quantise a tile-space direction to the 0..254 code used by the input packet (255 = idle). Same as client-core encodeDir. */
export function encodeDirection(di: number, dj: number): number {
  if (hypot(di, dj) < 1e-6) return 255;
  let a = Math.atan2(dj, di);
  if (a < 0) a += TAU;
  const code = Math.round((a / TAU) * DIR_CODES) % DIR_CODES;
  return code === 255 ? 254 : code;
}

/** uint16 sequence comparison with wrap-around: is `a` newer than `b`? */
export function seqNewer(a: number, b: number): boolean {
  return a !== b && ((a - b) & 0xffff) < 0x8000;
}
