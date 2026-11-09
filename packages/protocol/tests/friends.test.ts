import { describe, expect, it } from 'vitest';
import { FRIENDS } from '@vgtd/shared';
import {
  COLD_ENVELOPE,
  FRIEND_WIRE_LIMITS,
  FriendOp,
  FriendReason,
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
  { type: 'friend_cmd', op: FriendOp.Request, clientMsgId: 65535, name: 'Lý Thanh Vân' },
  { type: 'friend_cmd', op: FriendOp.Accept, clientMsgId: 1, name: '' },
  { type: 'friend_cmd', op: FriendOp.Decline, clientMsgId: 2, name: 'alice' },
  { type: 'friend_cmd', op: FriendOp.Remove, clientMsgId: 3, name: 'bob_2' },
  { type: 'friend_result', clientMsgId: 9, reason: FriendReason.AlreadyFriends },
  { type: 'friend_state', friends: [], incoming: [], outgoing: [] },
  {
    type: 'friend_state',
    friends: [
      { name: 'bob', classId: 2, online: true },
      { name: 'Lý Thanh Vân', classId: 0, online: false },
    ],
    incoming: ['carol'],
    outgoing: ['dave', 'erin'],
  },
];
const bytesOf = (n: number) => 'a'.repeat(n);

describe('friend messages (cold family ids 92-94)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses ids 92 friend_cmd, 93 friend_result, 94 friend_state on the cold envelope, with the protocol version unchanged', () => {
    const ids: Record<string, number> = { friend_cmd: 92, friend_result: 93, friend_state: 94 };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
    expect(PROTOCOL_VERSION).toBe(5); // additive cold ids: no bump
  });

  it('golden bytes: friend_cmd and friend_state', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    // op 1, clientMsgId 0x0102, name 'bo'
    expect(Buffer.from(encode({ type: 'friend_cmd', op: 1, clientMsgId: 0x0102, name: 'bo' })).toString('hex')).toBe(
      `${v}80005c` + '01' + '0102' + '02' + '626f',
    );
    // 1 friend 'a' class 3 online, 1 incoming 'b', 0 outgoing
    expect(
      Buffer.from(
        encode({
          type: 'friend_state',
          friends: [{ name: 'a', classId: 3, online: true }],
          incoming: ['b'],
          outgoing: [],
        }),
      ).toString('hex'),
    ).toBe(`${v}80005e` + '01' + '01' + '61' + '03' + '01' + '01' + '01' + '62' + '00');
  });

  it('validates ops, names, sizes and counts', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad({ type: 'friend_cmd', op: 0, clientMsgId: 0, name: 'x' });
    bad({ type: 'friend_cmd', op: 5, clientMsgId: 0, name: 'x' });
    bad({ type: 'friend_cmd', op: FriendOp.Request, clientMsgId: 0, name: '' }); // request needs a name
    bad({ type: 'friend_cmd', op: FriendOp.Remove, clientMsgId: 0, name: '' });
    bad({ type: 'friend_cmd', op: FriendOp.Request, clientMsgId: 65536, name: 'x' });
    bad({
      type: 'friend_cmd',
      op: FriendOp.Request,
      clientMsgId: 0,
      name: bytesOf(FRIEND_WIRE_LIMITS.MAX_NAME_BYTES + 1),
    });
    bad({ type: 'friend_cmd', op: FriendOp.Request, clientMsgId: 0, name: '\ud800' });
    bad({ type: 'friend_result', clientMsgId: 0, reason: 256 });
    const f = (i: number) => ({ name: `f${i}`, classId: 1, online: false });
    bad({
      type: 'friend_state',
      friends: Array.from({ length: FRIENDS.MAX_FRIENDS + 1 }, (_, i) => f(i)),
      incoming: [],
      outgoing: [],
    });
    bad({
      type: 'friend_state',
      friends: [],
      incoming: Array.from({ length: FRIENDS.MAX_INCOMING + 1 }, (_, i) => `i${i}`),
      outgoing: [],
    });
    bad({
      type: 'friend_state',
      friends: [],
      incoming: [],
      outgoing: Array.from({ length: FRIENDS.MAX_OUTGOING + 1 }, (_, i) => `o${i}`),
    });
    bad({ type: 'friend_state', friends: [{ name: 'a', classId: 256, online: true }], incoming: [], outgoing: [] });
    bad({ type: 'friend_state', friends: [{ name: 'a', classId: 1, online: 1 }], incoming: [], outgoing: [] });
    bad({ type: 'friend_state', friends: [null], incoming: [], outgoing: [] });
    // the maximum is fine
    const full = {
      type: 'friend_state' as const,
      friends: Array.from({ length: FRIENDS.MAX_FRIENDS }, (_, i) => f(i)),
      incoming: Array.from({ length: FRIENDS.MAX_INCOMING }, (_, i) => `i${i}`),
      outgoing: Array.from({ length: FRIENDS.MAX_OUTGOING }, (_, i) => `o${i}`),
    };
    expect(decode(encode(full))).toEqual(full);
    expect(encode(full).length).toBeLessThan(1200); // the whole picture of a full account is about a kilobyte
  });

  it('decoder: truncation at every length, trailing bytes, invalid UTF-8, counts above the limits, a bad online flag', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0])), m.type).toThrowError(/trailing/);
    }
    const b = Uint8Array.from(encode({ type: 'friend_cmd', op: 1, clientMsgId: 0, name: 'ab' }));
    b[b.length - 1] = 0xff;
    expect(() => decode(b)).toThrowError(/not valid UTF-8/);
    const big = Uint8Array.from(encode({ type: 'friend_state', friends: [], incoming: [], outgoing: [] }));
    big[4] = FRIENDS.MAX_FRIENDS + 1; // friend count
    expect(() => decode(big)).toThrow(ProtocolError);
    const flag = Uint8Array.from(
      encode({ type: 'friend_state', friends: [{ name: 'a', classId: 1, online: true }], incoming: [], outgoing: [] }),
    );
    flag[flag.length - 3] = 2; // online flag (before the two zero counts)
    expect(() => decode(flag)).toThrowError(/online flag/);
  });

  it('random bytes never crash the decoder (only ProtocolError) and anything that decodes re-encodes identically', () => {
    const r = lcg(4417);
    for (let k = 0; k < 4000; k++) {
      const n = r.int(2, 60);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = 92 + r.int(0, 2);
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
