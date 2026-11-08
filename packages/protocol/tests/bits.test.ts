import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter, ProtocolError } from '../src/index.js';

/** The original bit-at-a-time writer, kept here as the reference the optimised one must match exactly. */
function referenceBits(fields: readonly (readonly [number, number])[]): Uint8Array {
  const bytes: number[] = [];
  let cur = 0;
  let n = 0;
  for (const [value, bits] of fields) {
    for (let b = bits - 1; b >= 0; b--) {
      cur = (cur << 1) | ((value >>> b) & 1);
      if (++n === 8) {
        bytes.push(cur);
        cur = 0;
        n = 0;
      }
    }
  }
  if (n > 0) bytes.push(cur << (8 - n));
  return Uint8Array.from(bytes);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('BitWriter (chunked) is bit-for-bit the bit-at-a-time writer', () => {
  it('matches the reference over thousands of random field sequences, widths 0-24, any alignment', () => {
    const r = rng(7);
    for (let t = 0; t < 3000; t++) {
      const count = Math.floor(r() * 40);
      const fields: [number, number][] = [];
      for (let k = 0; k < count; k++) {
        const bits = Math.floor(r() * 25); // 0..24
        fields.push([bits === 0 ? 0 : Math.floor(r() * 2 ** bits), bits]);
      }
      const w = new BitWriter(Math.floor(r() * 4)); // tiny capacities force growth
      for (const [v, b] of fields) w.write(v, b);
      expect(Array.from(w.finish())).toEqual(Array.from(referenceBits(fields)));
    }
  });

  it('writes the snapshot record layout (10 + 1 + 8 + 8 + 6 + 3 + 1 bits) exactly, and a reader reads it back', () => {
    const w = new BitWriter();
    const rec = [
      [1023, 10],
      [0, 1],
      [0xff, 8],
      [0x80, 8],
      [63, 6],
      [7, 3],
      [1, 1],
      [127, 7],
    ] as const;
    for (const [v, b] of rec) w.write(v, b);
    const out = w.finish();
    expect(Array.from(out)).toEqual(Array.from(referenceBits(rec)));
    const r = new BitReader(out);
    for (const [v, b] of rec) expect(r.read(b)).toBe(v);
  });

  it('rejects values that do not fit (and non-integers / negatives), like before', () => {
    const w = new BitWriter();
    expect(() => w.write(4, 2)).toThrow(ProtocolError);
    expect(() => w.write(-1, 8)).toThrow(ProtocolError);
    expect(() => w.write(1.5, 8)).toThrow(ProtocolError);
    expect(() => w.write(2 ** 24, 24)).toThrow(ProtocolError);
    expect(() => w.write(2 ** 24 - 1, 24)).not.toThrow();
  });

  it('finish() returns an independent copy and an empty writer finishes to zero bytes', () => {
    const w = new BitWriter();
    expect(w.finish().length).toBe(0);
    const w2 = new BitWriter();
    w2.write(0b101, 3);
    const a = w2.finish();
    expect(Array.from(a)).toEqual([0b10100000]);
    a[0] = 0; // mutating the result must not affect the writer's own buffer
    expect(Array.from(w2.finish())).toEqual([0b10100000]); // the writer's bytes are untouched
  });
});
