import { describe, expect, it } from 'vitest';
import {
  COLD_ENVELOPE,
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

const samples: ColdMessage[] = [
  {
    type: 'major_event',
    phase: 1,
    wave: 0,
    waves: 3,
    remainingMs: 90_000,
    strengthPct: 120,
    result: 0,
    tier: 0,
    expLostPct: 0,
    lockMin: 0,
    tamMaId: 2_000_000,
  },
  {
    type: 'major_event',
    phase: 3,
    wave: 2,
    waves: 3,
    remainingMs: 0,
    strengthPct: 140,
    result: 0,
    tier: 0,
    expLostPct: 0,
    lockMin: 0,
    tamMaId: 0,
  },
  {
    type: 'major_event',
    phase: 4,
    wave: 1,
    waves: 3,
    remainingMs: 0,
    strengthPct: 200,
    result: 4,
    tier: 3,
    expLostPct: 50,
    lockMin: 1440,
    tamMaId: 0,
  },
  { type: 'tribulation_strike', wave: 1, waves: 3, strike: 0, qi: 3200, qj: 3250, damage: 22_000 },
  { type: 'tribulation_strike', wave: 9, waves: 9, strike: 8, qi: 65535, qj: 0, damage: 4_294_967_295 },
];

describe('major breakthrough messages (cold family ids 69-70, D97)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses ids 69 / 70 on the cold envelope and has the documented sizes (major_event 22 B, tribulation_strike 15 B)', () => {
    const ev = encode(samples[0]!);
    const st = encode(samples[3]!);
    expect([ev[0], ev[1], (ev[2]! << 8) | ev[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, 69]);
    expect([st[0], st[1], (st[2]! << 8) | st[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, 70]);
    expect(peekHeader(ev).type).toBe('major_event');
    expect(peekHeader(st).type).toBe('tribulation_strike');
    expect(ev.length).toBe(4 + 18);
    expect(st.length).toBe(4 + 11);
  });

  it('validates phases, results, tiers, percentages and wave numbers', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    const ev = samples[0] as Extract<ColdMessage, { type: 'major_event' }>;
    bad({ ...ev, phase: 0 });
    bad({ ...ev, phase: 5 });
    bad({ ...ev, result: 5 });
    bad({ ...ev, tier: 4 });
    bad({ ...ev, expLostPct: 101 });
    bad({ ...ev, strengthPct: 65536 });
    bad({ ...ev, remainingMs: -1 });
    const st = samples[3] as Extract<ColdMessage, { type: 'tribulation_strike' }>;
    bad({ ...st, wave: 0 });
    bad({ ...st, damage: 2 ** 32 });
    bad({ ...st, qi: 65536 });
  });

  it('decoder: truncation at every length and trailing bytes are errors; the new breakthrough reasons are valid on the wire', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0])), m.type).toThrowError(/trailing/);
    }
    for (const reason of [ProgressionReason.EventActive, ProgressionReason.NotPrepared, ProgressionReason.Locked]) {
      const m: ColdMessage = {
        type: 'breakthrough_result',
        requestId: 'a'.repeat(32),
        outcome: 3,
        kind: 2,
        reason,
        fromStage: 13,
        toStage: 13,
        chance: 0,
        nFail: 0,
      };
      expect(decode(encode(m))).toEqual(m);
    }
  });
});
