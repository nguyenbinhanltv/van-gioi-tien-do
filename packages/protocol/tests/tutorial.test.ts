import { describe, expect, it } from 'vitest';
import { TUTORIAL_ALL_MASK, TUTORIAL_FLAG_COMPLETE, TUTORIAL_FLAG_SKIPPED } from '@vgtd/shared';
import {
  COLD_ENVELOPE,
  PROTOCOL_VERSION,
  ProtocolError,
  decode,
  decodeJson,
  encode,
  encodeJson,
  peekHeader,
  type ColdMessage,
} from '../src/index.js';
import { lcg } from './helpers.js';

const samples: ColdMessage[] = [
  { type: 'tutorial_state', done: 0, kills: 0, flags: 0 },
  { type: 'tutorial_state', done: 0b1010101, kills: 2, flags: TUTORIAL_FLAG_SKIPPED },
  {
    type: 'tutorial_state',
    done: TUTORIAL_ALL_MASK,
    kills: 255,
    flags: TUTORIAL_FLAG_SKIPPED | TUTORIAL_FLAG_COMPLETE,
  },
  { type: 'tutorial_skip' },
];

describe('tutorial messages (cold family ids 49-50)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses ids 49 tutorial_state and 50 tutorial_skip on the cold envelope', () => {
    const ids: Record<string, number> = { tutorial_state: 49, tutorial_skip: 50 };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
  });

  it('golden bytes', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    expect(Buffer.from(encode({ type: 'tutorial_state', done: 0x0105, kills: 2, flags: 1 })).toString('hex')).toBe(
      `${v}800031` + '0105' + '02' + '01',
    );
    expect(Buffer.from(encode({ type: 'tutorial_skip' })).toString('hex')).toBe(`${v}800032`);
  });

  it('rejects unknown step bits, flags and out-of-range counters', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad({ type: 'tutorial_state', done: TUTORIAL_ALL_MASK + 1, kills: 0, flags: 0 });
    bad({ type: 'tutorial_state', done: -1, kills: 0, flags: 0 });
    bad({ type: 'tutorial_state', done: 0, kills: 256, flags: 0 });
    bad({ type: 'tutorial_state', done: 0, kills: 0, flags: 4 });
    bad({ type: 'tutorial_state', done: 1.5, kills: 0, flags: 0 });
  });

  it('decoder: truncation, trailing bytes, unknown bits and flags', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0])), m.type).toThrowError(/trailing/);
    }
    const hiBits = Uint8Array.from(encode({ type: 'tutorial_state', done: 0, kills: 0, flags: 0 }));
    hiBits[4] = 0xff; // high byte of `done`
    expect(() => decode(hiBits)).toThrow(ProtocolError);
    const flags = Uint8Array.from(encode({ type: 'tutorial_state', done: 0, kills: 0, flags: 0 }));
    flags[flags.length - 1] = 4;
    expect(() => decode(flags)).toThrow(ProtocolError);
  });

  it('random bytes never crash the decoder (only ProtocolError) and anything that decodes re-encodes identically', () => {
    const r = lcg(5151);
    for (let k = 0; k < 3000; k++) {
      const n = r.int(2, 12);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = 49 + r.int(0, 1);
      let m;
      try {
        m = decode(buf);
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
        continue;
      }
      expect(Array.from(encode(m))).toEqual(Array.from(buf));
    }
  });
});
