import { describe, expect, it } from 'vitest';
import {
  COLD_ENVELOPE,
  ColdMsgId,
  INV_LIMITS,
  InvOp,
  InvReason,
  PROTOCOL_VERSION,
  ProtocolError,
  decode,
  decodeJson,
  encode,
  encodeJson,
  peekHeader,
  type ColdMessage,
  type InvStateMsg,
} from '../src/index.js';
import { lcg } from './helpers.js';

const REQ = '0123456789abcdef0123456789abcdef';

const state: InvStateMsg = {
  type: 'inv_state',
  wallet: [12, 3, 0],
  slots: [
    { kind: 'stack', defId: 1, quality: 2, qty: 99 },
    null,
    { kind: 'instance', defId: 5, quality: 5, durability: 7500, bound: false },
    { kind: 'stack', defId: 6, quality: 0, qty: 999 },
    { kind: 'instance', defId: 3, quality: 0, durability: 0, bound: true },
  ],
  pending: [
    { defId: 1, quality: 0, qty: 3 },
    { defId: 6, quality: 0, qty: 40 },
  ],
};
const samples: ColdMessage[] = [
  state,
  { type: 'inv_state', wallet: [0, 0, 0], slots: [], pending: [] },
  { type: 'inv_cmd', requestId: REQ, op: InvOp.Move, from: 3, to: 17 },
  { type: 'inv_cmd', requestId: REQ, op: InvOp.ClaimPending, from: 0, to: 0 },
  { type: 'inv_cmd', requestId: REQ, op: InvOp.Use, from: 9, to: 0 },
  { type: 'inv_result', requestId: REQ, op: InvOp.Move, reason: InvReason.Ok, count: 0 },
  { type: 'inv_result', requestId: REQ, op: InvOp.Use, reason: InvReason.OnCooldown, count: 0 },
  { type: 'inv_result', requestId: REQ, op: InvOp.Use, reason: InvReason.PillActive, count: 0 },
  { type: 'inv_result', requestId: REQ, op: InvOp.ClaimPending, reason: InvReason.NothingMoved, count: 0 },
];

describe('inventory (cold family) codec', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_t, m) => {
      const bytes = encode(m);
      expect(decode(bytes)).toEqual(m);
      expect(Array.from(encode(decode(bytes)))).toEqual(Array.from(bytes));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses the cold envelope with the stable ids 66-68 (60-65 stay progression)', () => {
    const ids: Record<string, number> = { inv_state: 66, inv_cmd: 67, inv_result: 68 };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
    expect([ColdMsgId.InvState, ColdMsgId.InvCmd, ColdMsgId.InvResult]).toEqual([66, 67, 68]);
    expect(ColdMsgId.MeditateResult).toBe(65);
    expect(PROTOCOL_VERSION).toBe(5);
  });

  it('golden bytes: inv_cmd move and inv_result', () => {
    expect(Array.from(encode(samples[2]!))).toEqual([
      5,
      0x80,
      0,
      67,
      ...Array.from({ length: 8 }, (_, i) => [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef][i]!),
      0x01,
      0x23,
      0x45,
      0x67,
      0x89,
      0xab,
      0xcd,
      0xef,
      1,
      3,
      17,
    ]);
    expect(Array.from(encode(samples[5]!)).slice(-3)).toEqual([1, 0, 0]); // op, reason, count
  });

  it('inv_state layout: u8 slot count, 3 x float64 wallet, tagged slots, u8 pending count', () => {
    const b = encode({
      type: 'inv_state',
      wallet: [1, 2, 3],
      slots: [{ kind: 'stack', defId: 258, quality: 4, qty: 7 }, null],
      pending: [{ defId: 1, quality: 0, qty: 2 }],
    });
    // header 4, count 1, wallet 24, slot0: 1+2+1+2, slot1: 1, pending count 1, entry 2+1+2
    expect(b.length).toBe(4 + 1 + 24 + 6 + 1 + 1 + 5);
    expect(b[4]).toBe(2);
    expect(Array.from(b.slice(29, 35))).toEqual([1, 1, 2, 4, 0, 7]); // tag, defId 258 = 0x0102, quality, qty 7
    expect(b[35]).toBe(0);
    expect(b[36]).toBe(1);
  });

  it('a full 64-slot bag with 255 pending entries stays small', () => {
    const slots = Array.from({ length: INV_LIMITS.MAX_SLOTS }, (_, i) =>
      i % 2
        ? { kind: 'stack' as const, defId: 1, quality: 1, qty: 99 }
        : { kind: 'instance' as const, defId: 5, quality: 3, durability: 10_000, bound: false },
    );
    const pending = Array.from({ length: 255 }, () => ({ defId: 6, quality: 0, qty: 1 }));
    const b = encode({ type: 'inv_state', wallet: [1, 1, 1], slots, pending });
    expect(b.length).toBeLessThan(2400);
    expect(decode(b)).toMatchObject({ type: 'inv_state', slots: { length: 64 }, pending: { length: 255 } });
  });

  it('range-checks fields (encoder and decoder)', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad({ ...state, wallet: [-1, 0, 0] });
    bad({ ...state, wallet: [1.5, 0, 0] });
    bad({ ...state, wallet: [0, 0] });
    bad({ ...state, wallet: [Number.MAX_SAFE_INTEGER + 2, 0, 0] });
    bad({ ...state, slots: Array.from({ length: 65 }, () => null) });
    bad({ ...state, slots: [{ kind: 'stack', defId: 1, quality: 6, qty: 1 }] });
    bad({ ...state, slots: [{ kind: 'stack', defId: 1, quality: 0, qty: 0 }] });
    bad({ ...state, slots: [{ kind: 'instance', defId: 1, quality: 0, durability: 10_001, bound: false }] });
    bad({ ...state, slots: [{ kind: 'instance', defId: 1, quality: 0, durability: 1, bound: 1 }] });
    bad({ ...state, slots: [{ kind: 'gem', defId: 1 }] });
    bad({ type: 'inv_cmd', requestId: 'XYZ', op: 1, from: 0, to: 1 });
    bad({ type: 'inv_cmd', requestId: REQ, op: 3, from: 0, to: 1 }); // a use carries only its source slot
    bad({ type: 'inv_cmd', requestId: REQ, op: 4, from: 0, to: 0 }); // unknown op
    bad({ type: 'inv_cmd', requestId: REQ, op: InvOp.Use, from: 64, to: 0 });
    bad({ type: 'inv_result', requestId: REQ, op: 4, reason: 0, count: 0 });
    bad({ type: 'inv_cmd', requestId: REQ, op: 1, from: 64, to: 1 });
    bad({ type: 'inv_cmd', requestId: REQ, op: InvOp.ClaimPending, from: 1, to: 0 }); // a claim carries no slots
    bad({ type: 'inv_result', requestId: REQ, op: 0, reason: 0, count: 0 });
    const b = Uint8Array.from(encode(samples[0]!));
    b[4 + 1 + 24] = 3; // unknown slot kind
    expect(() => decode(b)).toThrow(ProtocolError);
    const t = Uint8Array.from(encode(samples[0]!));
    expect(() => decode(t.slice(0, t.length - 1))).toThrow(ProtocolError); // truncated
    expect(() => decode(Uint8Array.from([...t, 0]))).toThrow(ProtocolError); // trailing byte
  });

  it('there is no price / shop / entitlement field anywhere in the messages', () => {
    for (const m of samples) expect(JSON.stringify(m)).not.toMatch(/price|shop|receipt|entitle|tien_ngoc|cash/i);
  });

  it('random bytes never crash the decoder (only ProtocolError) and anything that decodes re-encodes identically', () => {
    const r = lcg(68);
    for (let k = 0; k < 4000; k++) {
      const n = r.int(2, 60);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = r.int(64, 70);
      try {
        const m = decode(buf);
        expect(Array.from(encode(m))).toEqual(Array.from(buf));
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
      }
    }
  });
});
