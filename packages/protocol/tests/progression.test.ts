import { describe, expect, it } from 'vitest';
import {
  BreakthroughKind,
  BreakthroughOutcome,
  COLD_ENVELOPE,
  CHAR_FLAG,
  ColdMsgId,
  PROTOCOL_VERSION,
  ProgressionReason,
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
const charState: ColdMessage = {
  type: 'char_state',
  stage: 12,
  flags: CHAR_FLAG.MEDITATING | CHAR_FLAG.BREAKTHROUGH_READY,
  nFail: 3,
  rootType: 1,
  elements: 0b00110,
  mutation: 2,
  karma: -400,
  tuVi: 12345.678,
  tuViReq: 3_000_000.5,
};
const samples: ColdMessage[] = [
  charState,
  { type: 'breakthrough_start', requestId: REQ },
  {
    type: 'breakthrough_result',
    requestId: REQ,
    outcome: BreakthroughOutcome.Failure,
    kind: BreakthroughKind.Major,
    reason: ProgressionReason.Ok,
    fromStage: 9,
    toStage: 9,
    chance: 7000,
    nFail: 1,
  },
  { type: 'meditate_start', requestId: REQ },
  { type: 'meditate_stop', requestId: REQ },
  { type: 'meditate_result', requestId: REQ, meditating: true, reason: ProgressionReason.Ok },
];

describe('progression (cold family) codec', () => {
  it.each(samples.map((m) => [m.type, m] as const))('%s round-trips and re-encodes canonically', (_t, m) => {
    const bytes = encode(m);
    expect(decode(bytes)).toEqual(m);
    expect(Array.from(encode(decode(bytes)))).toEqual(Array.from(bytes));
    expect(decodeJson(encodeJson(m))).toEqual(m);
  });

  it('uses the docs/24 envelope [version][0x80][msgId u16][body] with stable ids 60-65', () => {
    const ids: Record<string, number> = {
      char_state: 60,
      breakthrough_start: 61,
      breakthrough_result: 62,
      meditate_start: 63,
      meditate_stop: 64,
      meditate_result: 65,
    };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
    expect(ColdMsgId.CharState).toBe(60);
  });

  it('golden bytes: meditate_start and breakthrough_result', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    expect(Buffer.from(encode(samples[3]!)).toString('hex')).toBe(v + '80003f' + REQ);
    expect(Buffer.from(encode(samples[2]!)).toString('hex')).toBe(
      v + '80003e' + REQ + '02' + '02' + '00' + '09' + '09' + '1b58' + '01',
    );
  });

  it('char_state layout: 6 flag bytes, karma+1000 u16, two float64', () => {
    const b = encode(charState);
    expect(b.length).toBe(4 + 6 + 2 + 16);
    expect((b[10]! << 8) | b[11]!).toBe(600);
  });

  it('rejects unknown cold ids, truncation at every length and trailing bytes', () => {
    const b = encode(samples[2]!);
    const unk = Uint8Array.from(b);
    unk[3] = 99;
    expect(() => decode(unk)).toThrowError(/unknown cold message id/);
    for (let n = 0; n < b.length; n++) expect(() => decode(b.subarray(0, n)), `len ${n}`).toThrow(ProtocolError);
    expect(() => decode(Uint8Array.from([...b, 0]))).toThrowError(/trailing/);
    expect(() => decode(Uint8Array.from([PROTOCOL_VERSION + 1, COLD_ENVELOPE, 0, 60]))).toThrowError(/version/);
  });

  it('range-checks fields (encoder and decoder)', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad({ ...charState, stage: 0 });
    bad({ ...charState, stage: 42 });
    bad({ ...charState, karma: 1001 });
    bad({ ...charState, tuVi: -1 });
    bad({ ...charState, tuVi: Infinity });
    bad({ ...charState, flags: 8 });
    bad({ type: 'meditate_start', requestId: 'XYZ' });
    bad({ type: 'meditate_start', requestId: REQ.toUpperCase() });
    bad({ ...samples[2]!, outcome: 0 });
    bad({ ...samples[2]!, chance: 10001 });
    const b = Uint8Array.from(encode(samples[5]!));
    b[4 + 16] = 2; // meditating flag must be 0 or 1
    expect(() => decode(b)).toThrow(ProtocolError);
  });

  it('random bytes never crash the decoder (only ProtocolError)', () => {
    const r = lcg(61);
    for (let k = 0; k < 3000; k++) {
      const n = r.int(2, 40);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = r.int(58, 66);
      try {
        const m = decode(buf);
        expect(Array.from(encode(m))).toEqual(Array.from(buf)); // anything that decodes re-encodes identically
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
      }
    }
  });
});
