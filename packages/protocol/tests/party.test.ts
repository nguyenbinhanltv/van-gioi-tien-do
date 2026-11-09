import { describe, expect, it } from 'vitest';
import {
  COLD_ENVELOPE,
  PARTY_WIRE_LIMITS,
  PROTOCOL_VERSION,
  PartyOp,
  PartyReason,
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
  { type: 'party_cmd', op: PartyOp.Invite, clientMsgId: 65535, name: 'Lý Thanh Vân' },
  { type: 'party_cmd', op: PartyOp.Accept, clientMsgId: 1, name: '' },
  { type: 'party_cmd', op: PartyOp.Leave, clientMsgId: 2, name: '' },
  { type: 'party_cmd', op: PartyOp.Kick, clientMsgId: 3, name: 'bob_2' },
  { type: 'party_result', clientMsgId: 9, reason: PartyReason.NotLeader },
  { type: 'party_invite', fromName: 'alice', ttlMs: 30000 },
  { type: 'party_state', leaderId: 0, members: [] },
  {
    type: 'party_state',
    leaderId: 7,
    members: [
      { entityId: 3, name: 'bob', classId: 2 },
      { entityId: 7, name: 'Lý Thanh Vân', classId: 6 },
    ],
  },
  { type: 'party_vitals', members: [{ entityId: 3, hp: 120, hpMax: 150, mp: 0, mpMax: 60 }] },
  { type: 'party_vitals', members: [] },
];
const bytesOf = (n: number) => 'a'.repeat(n);

describe('party messages (cold family ids 44-48)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses ids 44 party_cmd, 45 party_result, 46 party_invite, 47 party_state, 48 party_vitals on the cold envelope', () => {
    const ids: Record<string, number> = {
      party_cmd: 44,
      party_result: 45,
      party_invite: 46,
      party_state: 47,
      party_vitals: 48,
    };
    for (const m of samples) {
      if (!(m.type in ids)) continue;
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
  });

  it('golden bytes: party_cmd and party_state', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    // op 1, clientMsgId 0x0102, name 'bo' (len 2)
    expect(Buffer.from(encode({ type: 'party_cmd', op: 1, clientMsgId: 0x0102, name: 'bo' })).toString('hex')).toBe(
      `${v}80002c` + '01' + '0102' + '02' + '626f',
    );
    // leader 5, 1 member: id 5, name 'a', class 3
    expect(
      Buffer.from(
        encode({ type: 'party_state', leaderId: 5, members: [{ entityId: 5, name: 'a', classId: 3 }] }),
      ).toString('hex'),
    ).toBe(`${v}80002f` + '00000005' + '01' + '00000005' + '01' + '61' + '03');
  });

  it('validates ops, names, sizes and the leader', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad({ type: 'party_cmd', op: 0, clientMsgId: 0, name: 'x' });
    bad({ type: 'party_cmd', op: 6, clientMsgId: 0, name: 'x' });
    bad({ type: 'party_cmd', op: PartyOp.Invite, clientMsgId: 0, name: '' }); // invite needs a name
    bad({ type: 'party_cmd', op: PartyOp.Kick, clientMsgId: 0, name: '' });
    bad({ type: 'party_cmd', op: PartyOp.Leave, clientMsgId: 0, name: 'x' }); // leave takes none
    bad({ type: 'party_cmd', op: PartyOp.Invite, clientMsgId: 65536, name: 'x' });
    bad({ type: 'party_cmd', op: PartyOp.Invite, clientMsgId: 0, name: bytesOf(PARTY_WIRE_LIMITS.MAX_NAME_BYTES + 1) });
    bad({ type: 'party_cmd', op: PartyOp.Invite, clientMsgId: 0, name: '\ud800' });
    bad({ type: 'party_result', clientMsgId: 0, reason: 256 });
    bad({ type: 'party_invite', fromName: 'a', ttlMs: 65536 });
    bad({ type: 'party_state', leaderId: 9, members: [{ entityId: 3, name: 'a', classId: 1 }] }); // leader not a member
    bad({ type: 'party_state', leaderId: 3, members: [] }); // an empty roster has no leader
    const five = Array.from({ length: 5 }, (_, i) => ({ entityId: i + 1, name: 'm', classId: 1 }));
    bad({ type: 'party_state', leaderId: 1, members: five }); // more than PARTY.MAX_SIZE
    bad({
      type: 'party_vitals',
      members: Array.from({ length: 5 }, () => ({ entityId: 1, hp: 1, hpMax: 1, mp: 1, mpMax: 1 })),
    });
    bad({ type: 'party_vitals', members: [{ entityId: 1, hp: -1, hpMax: 1, mp: 1, mpMax: 1 }] });
    bad({ type: 'party_vitals', members: [null] });
  });

  it('decoder: truncation at every length, trailing bytes, invalid UTF-8, a roster larger than the party limit', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0])), m.type).toThrowError(/trailing/);
    }
    const b = Uint8Array.from(encode({ type: 'party_cmd', op: 1, clientMsgId: 0, name: 'ab' }));
    b[b.length - 1] = 0xff;
    expect(() => decode(b)).toThrowError(/not valid UTF-8/);
    const big = Uint8Array.from(encode({ type: 'party_vitals', members: [] }));
    big[big.length - 1] = 9; // 9 members announced, none present
    expect(() => decode(big)).toThrow(ProtocolError);
  });

  it('random bytes never crash the decoder (only ProtocolError) and anything that decodes re-encodes identically', () => {
    const r = lcg(9917);
    for (let k = 0; k < 4000; k++) {
      const n = r.int(2, 60);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = 44 + r.int(0, 4);
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
