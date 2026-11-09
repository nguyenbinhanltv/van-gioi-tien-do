import { describe, expect, it } from 'vitest';
import { ALCHEMY } from '@vgtd/shared';
import {
  COLD_ENVELOPE,
  CRAFT_ANSWER_INDEX,
  CraftOp,
  CraftOutcome,
  CraftReason,
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

const REQ = '0123456789abcdef0123456789abcdef';
const samples: ColdMessage[] = [
  { type: 'craft_cmd', requestId: REQ, op: CraftOp.Start, recipeId: 2, count: ALCHEMY.QUEUE_MAX },
  { type: 'craft_cmd', requestId: REQ, op: CraftOp.Cancel, recipeId: 0, count: 0 },
  {
    type: 'craft_result',
    requestId: REQ,
    index: CRAFT_ANSWER_INDEX,
    outcome: CraftOutcome.Rejected,
    reason: CraftReason.TooFar,
    recipeId: 2,
    quality: 0,
    qty: 0,
    lost: 0,
  },
  {
    type: 'craft_result',
    requestId: REQ,
    index: 3,
    outcome: CraftOutcome.Success,
    reason: 0,
    recipeId: 2,
    quality: 3,
    qty: 1,
    lost: 0,
  },
  {
    type: 'craft_result',
    requestId: REQ,
    index: 0,
    outcome: CraftOutcome.Failed,
    reason: 0,
    recipeId: 3,
    quality: 0,
    qty: 0,
    lost: 15,
  },
  {
    type: 'craft_state',
    furnaceQi: 3840,
    furnaceQj: 4000,
    job: { recipeId: 0, done: 0, total: 0, remainingMs: 0 },
    mastery: [],
  },
  {
    type: 'craft_state',
    furnaceQi: 1,
    furnaceQj: 65535,
    job: { recipeId: 2, done: 3, total: 10, remainingMs: 4200 },
    mastery: [
      { recipeId: 1, points: 100 },
      { recipeId: 2, points: 37 },
    ],
  },
];

describe('craft messages (cold family ids 90, 91, 95)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))('%s round-trips canonically', (_t, m) => {
    const b = encode(m);
    expect(decode(b)).toEqual(m);
    expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
    expect(decodeJson(encodeJson(m))).toEqual(m);
  });

  it('uses the cold envelope with the documented ids', () => {
    const ids: Record<string, number> = { craft_cmd: 90, craft_result: 91, craft_state: 95 };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
  });

  it('craft_cmd is 4 + 16 + 3 bytes; craft_result 4 + 16 + 7', () => {
    expect(encode(samples[0]!).length).toBe(23);
    expect(encode(samples[2]!).length).toBe(27);
  });

  it('range and shape checks (encoder side)', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    const cmd = samples[0] as Extract<ColdMessage, { type: 'craft_cmd' }>;
    bad({ ...cmd, count: 0 }); // start needs a count
    bad({ ...cmd, count: ALCHEMY.QUEUE_MAX + 1 });
    bad({ ...cmd, recipeId: 0 });
    bad({ ...cmd, op: 3 });
    bad({ ...cmd, op: CraftOp.Cancel }); // cancel carries nothing
    bad({ ...cmd, requestId: 'XYZ' });
    const res = samples[3] as Extract<ColdMessage, { type: 'craft_result' }>;
    bad({ ...res, quality: 6 });
    bad({ ...res, outcome: 5 });
    bad({ ...res, index: 10 }); // neither a craft number nor the answer marker
    const st = samples[6] as Extract<ColdMessage, { type: 'craft_state' }>;
    bad({ ...st, job: { ...st.job, done: 11 } });
    bad({ ...st, job: { ...st.job, done: 4, total: 3 } });
    bad({ ...st, job: { recipeId: 0, done: 0, total: 2, remainingMs: 0 } }); // an idle job has no counts
    bad({ ...st, mastery: [{ recipeId: 1, points: 101 }] });
    bad({ ...st, mastery: Array.from({ length: 33 }, () => ({ recipeId: 1, points: 0 })) });
    bad({ ...st, furnaceQi: 65536 });
  });

  it('decoder side: truncation at every length, trailing bytes, out-of-range bytes', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0]))).toThrowError(/trailing/);
    }
    const b = Uint8Array.from(encode(samples[3]!));
    b[4 + 16 + 4] = 9; // quality
    expect(() => decode(b)).toThrow(ProtocolError);
  });

  it('random bytes never crash the decoder (only ProtocolError); whatever decodes re-encodes identically', () => {
    const r = lcg(95);
    let ok = 0;
    for (let k = 0; k < 6000; k++) {
      const buf = Uint8Array.from({ length: r.int(4, 40) }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = [90, 91, 95][r.int(0, 2)]!;
      try {
        const m = decode(buf);
        ok++;
        expect(Array.from(encode(m))).toEqual(Array.from(buf));
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
      }
    }
    // mutated valid frames reach the field checks
    for (let k = 0; k < 3000; k++) {
      const b = Uint8Array.from(encode(samples[r.int(0, samples.length - 1)]!));
      b[r.int(4, b.length - 1)] = r.int(0, 255);
      try {
        const m = decode(b);
        ok++;
        expect(Array.from(encode(m))).toEqual(Array.from(b));
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
      }
    }
    expect(ok).toBeGreaterThan(100);
  });
});
