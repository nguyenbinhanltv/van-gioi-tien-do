import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  ProtocolError,
  decode,
  decodeJson,
  encode,
  encodeJson,
  type BaselineLookup,
  type Message,
} from '../src/index.js';
import { lcg, randMessage } from './helpers.js';

/** Baseline that knows every entity, so delta records in fuzzed snapshots are decodable. */
const baseline: BaselineLookup = (i) => ({ qi: 30000 + i, qj: 30000 - i });

/** Decode must either succeed or throw ProtocolError — never anything else, never hang. */
function tryDecode(bytes: Uint8Array): Message | null {
  try {
    return decode(bytes, { baseline });
  } catch (e) {
    expect(e, `threw a non-ProtocolError for ${Array.from(bytes).join(',')}`).toBeInstanceOf(ProtocolError);
    return null;
  }
}

describe('fuzz: arbitrary bytes', () => {
  it('50,000 random buffers: only ProtocolError, and every success is stable under re-encode', () => {
    const r = lcg(1234);
    let ok = 0;
    for (let k = 0; k < 50_000; k++) {
      const len = r.int(0, 80);
      const b = new Uint8Array(len);
      for (let x = 0; x < len; x++) b[x] = r.int(0, 255);
      if (len >= 2 && r.bool(0.8)) {
        b[0] = PROTOCOL_VERSION; // get past the version check so bodies are exercised
        b[1] = r.int(1, 9);
      }
      const m = tryDecode(b);
      if (m) {
        ok++;
        expect(tryDecode(encode(m, { baseline }))).toEqual(m);
      }
    }
    expect(ok).toBeGreaterThan(100); // the fuzzer does reach valid messages
  });

  it('mutated valid packets (bit flips, byte replacement, truncation, extension)', () => {
    const r = lcg(99);
    for (let k = 0; k < 20_000; k++) {
      const m = randMessage(r);
      const b = Uint8Array.from(encode(m));
      const op = r.int(0, 3);
      let c: Uint8Array = b;
      if (op === 0 && b.length) b[r.int(0, b.length - 1)]! ^= 1 << r.int(0, 7);
      else if (op === 1 && b.length) b[r.int(0, b.length - 1)] = r.int(0, 255);
      else if (op === 2) c = b.subarray(0, r.int(0, b.length));
      else {
        c = new Uint8Array(b.length + r.int(1, 8));
        c.set(b);
        for (let x = b.length; x < c.length; x++) c[x] = r.int(0, 255);
      }
      const out = tryDecode(c);
      if (out) expect(tryDecode(encode(out, { baseline }))).toEqual(out);
    }
  });

  it('huge claimed counts are rejected quickly without allocating', () => {
    const t0 = Date.now();
    // aoi_enter with count 0xFFFF, aoi_leave 0xFFFF, snapshot count 0xFFFF
    expect(() => decode(Uint8Array.from([1, 3, 0xff, 0xff]))).toThrow(ProtocolError);
    expect(() => decode(Uint8Array.from([1, 4, 0xff, 0xff]))).toThrow(ProtocolError);
    expect(() => decode(Uint8Array.from([1, 2, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff]), { baseline })).toThrow(ProtocolError);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('non-canonical encodings are rejected: padding bits, unknown flags, delta in a full snapshot', () => {
    // snapshot, no self/baseline, one absolute record, then flip a padding bit
    const good = encode({
      type: 'snapshot',
      seq: 1,
      baselineSeq: null,
      tick: 1,
      self: null,
      entities: [{ index: 3, qi: 100, qj: 200, anim: 1, dir: 2, hpPct: null }],
    });
    const padded = Uint8Array.from(good);
    padded[padded.length - 1]! |= 1; // record = 37 bits ⇒ 3 padding bits
    expect(() => decode(padded)).toThrowError(/padding/);
    const flags = Uint8Array.from(good);
    flags[2] = 0x80;
    expect(() => decode(flags)).toThrowError(/flags/);
    const d = Uint8Array.from(good);
    d[2 + 1 + 2 + 4 + 2 + 1] = 0; // clear the "absolute" bit of the first record (index high bits stay)
    expect(() => decode(d, { baseline })).toThrow(ProtocolError);
  });
});

describe('fuzz: JSON debug codec', () => {
  it('arbitrary JSON values never throw anything but ProtocolError', () => {
    const r = lcg(5);
    const pool: unknown[] = [
      null,
      0,
      -1,
      1.5,
      1e30,
      'x',
      '',
      true,
      [],
      {},
      { type: 'input' },
      { type: 'snapshot', entities: 3 },
      { v: 4 },
      { v: 4, type: 'aoi_leave', indices: 'x' },
      { v: 4, type: 'ping', clientTimeMs: '5' },
    ];
    for (let k = 0; k < 5000; k++) {
      const v = r.bool(0.5)
        ? pool[r.int(0, pool.length - 1)]
        : {
            v: r.int(0, 2),
            type: ['input', 'ping', 'pong', 'error', 'snapshot', 'x'][r.int(0, 5)],
            [['ack', 'clientTimeMs', 'code', 'tick', 'inputs'][r.int(0, 4)]!]: pool[r.int(0, pool.length - 1)],
          };
      try {
        decodeJson(JSON.stringify(v));
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
      }
    }
  });
  it('prototype pollution payloads are inert', () => {
    const m = decodeJson('{"v":4,"type":"ping","clientTimeMs":1,"__proto__":{"polluted":1},"constructor":{"x":1}}');
    expect(m).toEqual({ type: 'ping', clientTimeMs: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('encodeJson refuses invalid messages', () => {
    expect(() => encodeJson({ type: 'ping', clientTimeMs: -5 })).toThrow(ProtocolError);
  });
});
