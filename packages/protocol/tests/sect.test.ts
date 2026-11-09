import { describe, expect, it } from 'vitest';
import { SECT } from '@vgtd/shared';
import {
  COLD_ENVELOPE,
  PROTOCOL_VERSION,
  ProtocolError,
  SECT_WIRE_LIMITS,
  SectOp,
  SectReason,
  decode,
  decodeJson,
  encode,
  encodeJson,
  peekHeader,
  type ColdMessage,
} from '../src/index.js';
import { lcg } from './helpers.js';

const samples: ColdMessage[] = [
  { type: 'sect_cmd', op: SectOp.Join, clientMsgId: 65535, manual: 0 },
  { type: 'sect_cmd', op: SectOp.Leave, clientMsgId: 1, manual: 0 },
  { type: 'sect_cmd', op: SectOp.Buy, clientMsgId: 2, manual: SECT.MAX_MANUALS - 1 },
  { type: 'sect_result', clientMsgId: 9, reason: SectReason.NotEnoughContribution },
  { type: 'sect_state', member: false, contribution: 0, npcQi: 0, npcQj: 0, library: [] },
  {
    type: 'sect_state',
    member: true,
    contribution: 4_294_967_295,
    npcQi: 4096,
    npcQj: 65535,
    library: [
      { name: 'Kim Quang Quet', levelMin: 20, price: 60, owned: true },
      { name: 'Vạn Kiếm Quy Tông', levelMin: 65, price: 195, owned: false },
    ],
  },
];

describe('sect messages (cold family ids 100-102)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses ids 100 sect_cmd, 101 sect_result, 102 sect_state on the cold envelope, with the protocol version unchanged', () => {
    const ids: Record<string, number> = { sect_cmd: 100, sect_result: 101, sect_state: 102 };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
  });

  it('golden bytes: sect_cmd and sect_state', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    // op 3 (buy), clientMsgId 0x0102, manual 4
    expect(Buffer.from(encode({ type: 'sect_cmd', op: 3, clientMsgId: 0x0102, manual: 4 })).toString('hex')).toBe(
      `${v}800064` + '03' + '0102' + '04',
    );
    // member, contribution 0x01020304, npc (5, 6), one manual 'a' level 20 price 60 owned
    expect(
      Buffer.from(
        encode({
          type: 'sect_state',
          member: true,
          contribution: 0x01020304,
          npcQi: 5,
          npcQj: 6,
          library: [{ name: 'a', levelMin: 20, price: 60, owned: true }],
        }),
      ).toString('hex'),
    ).toBe(`${v}800066` + '01' + '01020304' + '0005' + '0006' + '01' + '01' + '61' + '14' + '003c' + '01');
  });

  it('validates ops, the manual index, names, sizes and flags', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad({ type: 'sect_cmd', op: 0, clientMsgId: 0, manual: 0 });
    bad({ type: 'sect_cmd', op: 4, clientMsgId: 0, manual: 0 });
    bad({ type: 'sect_cmd', op: SectOp.Buy, clientMsgId: 0, manual: SECT.MAX_MANUALS }); // out of range
    bad({ type: 'sect_cmd', op: SectOp.Join, clientMsgId: 0, manual: 1 }); // only buy takes an index
    bad({ type: 'sect_cmd', op: SectOp.Join, clientMsgId: 65536, manual: 0 });
    bad({ type: 'sect_result', clientMsgId: 0, reason: 256 });
    const st = { type: 'sect_state', member: true, contribution: 0, npcQi: 0, npcQj: 0, library: [] };
    bad({ ...st, member: 1 });
    bad({ ...st, contribution: -1 });
    bad({ ...st, contribution: 4_294_967_296 });
    bad({ ...st, npcQi: 65536 });
    bad({
      ...st,
      library: Array.from({ length: SECT.MAX_MANUALS + 1 }, () => ({ name: 'a', levelMin: 1, price: 1, owned: false })),
    });
    bad({
      ...st,
      library: [{ name: 'a'.repeat(SECT_WIRE_LIMITS.MAX_NAME_BYTES + 1), levelMin: 1, price: 1, owned: false }],
    });
    bad({ ...st, library: [{ name: '\ud800', levelMin: 1, price: 1, owned: false }] });
    bad({ ...st, library: [{ name: 'a', levelMin: 256, price: 1, owned: false }] });
    bad({ ...st, library: [{ name: 'a', levelMin: 1, price: 65536, owned: false }] });
    bad({ ...st, library: [{ name: 'a', levelMin: 1, price: 1, owned: 'yes' }] });
    bad({ ...st, library: [null] });
    // the maximum is fine
    const full = {
      ...st,
      library: Array.from({ length: SECT.MAX_MANUALS }, (_, i) => ({
        name: 'x'.repeat(SECT_WIRE_LIMITS.MAX_NAME_BYTES),
        levelMin: i,
        price: 65535,
        owned: i % 2 === 0,
      })),
    } as ColdMessage;
    expect(decode(encode(full))).toEqual(full);
  });

  it('decoder: truncation at every length, trailing bytes, invalid UTF-8, bad flags, a library larger than the limit', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0])), m.type).toThrowError(/trailing/);
    }
    const base = encode({ type: 'sect_state', member: false, contribution: 0, npcQi: 0, npcQj: 0, library: [] });
    const flag = Uint8Array.from(base);
    flag[4] = 2; // member flag
    expect(() => decode(flag)).toThrowError(/member flag/);
    const big = Uint8Array.from(base);
    big[big.length - 1] = SECT.MAX_MANUALS + 1; // library count
    expect(() => decode(big)).toThrow(ProtocolError);
    const withName = Uint8Array.from(
      encode({
        type: 'sect_state',
        member: false,
        contribution: 0,
        npcQi: 0,
        npcQj: 0,
        library: [{ name: 'ab', levelMin: 1, price: 1, owned: false }],
      }),
    );
    withName[withName.length - 5] = 0xff; // last byte of the name (name, level, price x2, owned follow it)
    expect(() => decode(withName)).toThrowError(/not valid UTF-8/);
    const ownedFlag = Uint8Array.from(
      encode({
        type: 'sect_state',
        member: false,
        contribution: 0,
        npcQi: 0,
        npcQj: 0,
        library: [{ name: 'a', levelMin: 1, price: 1, owned: true }],
      }),
    );
    ownedFlag[ownedFlag.length - 1] = 2;
    expect(() => decode(ownedFlag)).toThrowError(/owned flag/);
  });

  it('random bytes never crash the decoder (only ProtocolError) and anything that decodes re-encodes identically', () => {
    const r = lcg(6203);
    for (let k = 0; k < 4000; k++) {
      const n = r.int(2, 60);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = 100 + r.int(0, 2);
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
