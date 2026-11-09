import { describe, expect, it } from 'vitest';
import { CURRENCIES, TRADE } from '@vgtd/shared';
import {
  COLD_ENVELOPE,
  PROTOCOL_VERSION,
  ProtocolError,
  TRADE_WIRE_LIMITS,
  TradeClosed,
  TradeOp,
  TradePhase,
  TradeReason,
  decode,
  decodeJson,
  encode,
  encodeJson,
  peekHeader,
  type ColdMessage,
} from '../src/index.js';
import { lcg } from './helpers.js';

const cmd = (o: Record<string, unknown> = {}) => ({
  type: 'trade_cmd',
  op: TradeOp.Lock,
  clientMsgId: 1,
  name: '',
  slot: 0,
  qty: 0,
  currency: 0,
  amount: 0,
  ...o,
});
const side = (o: Record<string, unknown> = {}) => ({
  items: [],
  stones: [0, 0, 0],
  locked: false,
  confirmed: false,
  ...o,
});
const stateMsg = (o: Record<string, unknown> = {}) => ({
  type: 'trade_state',
  phase: TradePhase.Open,
  closed: TradeClosed.None,
  partner: 'bob',
  mine: side(),
  theirs: side(),
  tax: [0, 0, 0],
  ...o,
});

const samples: ColdMessage[] = [
  cmd({ op: TradeOp.Invite, name: 'Lý Thanh Vân', clientMsgId: 65535 }),
  cmd({ op: TradeOp.Accept }),
  cmd({ op: TradeOp.Decline, name: 'alice' }),
  cmd({ op: TradeOp.SetItem, slot: 255, qty: 65535 }),
  cmd({ op: TradeOp.SetStones, currency: 2, amount: 4_294_967_295 }),
  cmd({ op: TradeOp.Lock }),
  cmd({ op: TradeOp.Confirm }),
  cmd({ op: TradeOp.Cancel }),
  { type: 'trade_result', clientMsgId: 9, reason: TradeReason.ItemsChanged },
  { type: 'trade_invite', fromName: 'alice', ttlMs: 30000 },
  stateMsg({ phase: TradePhase.Closed, closed: TradeClosed.PartnerLeft, partner: '' }),
  stateMsg({
    mine: side({
      items: [
        { defId: 1, quality: 0, qty: 5 },
        { defId: 3, quality: 2, qty: 1 },
      ],
      stones: [100, 0, 7],
      locked: true,
    }),
    theirs: side({ stones: [0, 4_294_967_295, 0], locked: true, confirmed: true }),
  }),
  stateMsg({ phase: TradePhase.Done, tax: [7, 0, 1] }),
] as unknown as ColdMessage[];

describe('trade messages (cold family ids 71-74)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses ids 71 trade_cmd, 72 trade_result, 73 trade_state, 74 trade_invite on the cold envelope, with the protocol version unchanged', () => {
    const ids: Record<string, number> = { trade_cmd: 71, trade_result: 72, trade_state: 73, trade_invite: 74 };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
  });

  it('golden bytes: trade_cmd (set-stones) and an empty trade_state', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    // op 5, clientMsgId 0x0102, name '' (len 0), slot 0, qty 0, currency 1, amount 0x01020304
    expect(
      Buffer.from(
        encode(cmd({ op: 5, clientMsgId: 0x0102, currency: 1, amount: 0x01020304 }) as unknown as ColdMessage),
      ).toString('hex'),
    ).toBe(`${v}800047` + '05' + '0102' + '00' + '00' + '0000' + '01' + '01020304');
    // phase 1, closed 0, partner 'a', two empty sides (0 items, 3 x u32 zero, 2 flags), tax 3 x u32 zero
    const side0 = '00' + '00000000'.repeat(3) + '00' + '00';
    expect(Buffer.from(encode(stateMsg({ partner: 'a' }) as unknown as ColdMessage)).toString('hex')).toBe(
      `${v}800049` + '01' + '00' + '01' + '61' + side0 + side0 + '00000000'.repeat(3),
    );
  });

  it('validates ops, which fields each op may carry, names, sizes and ranges', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad(cmd({ op: 0 }));
    bad(cmd({ op: 9 }));
    bad(cmd({ op: TradeOp.Invite, name: '' })); // invite needs a name
    bad(cmd({ op: TradeOp.Lock, name: 'x' })); // only invite / accept / decline take one
    bad(cmd({ op: TradeOp.Lock, slot: 1 })); // only set-item takes slot / qty
    bad(cmd({ op: TradeOp.Lock, qty: 1 }));
    bad(cmd({ op: TradeOp.Lock, amount: 1 })); // only set-stones takes currency / amount
    bad(cmd({ op: TradeOp.Lock, currency: 1 }));
    bad(cmd({ op: TradeOp.SetItem, slot: 256 }));
    bad(cmd({ op: TradeOp.SetItem, qty: 65536 }));
    bad(cmd({ op: TradeOp.SetStones, currency: CURRENCIES.length }));
    bad(cmd({ op: TradeOp.SetStones, amount: 4_294_967_296 }));
    bad(cmd({ op: TradeOp.SetStones, amount: -1 }));
    bad(cmd({ clientMsgId: 65536 }));
    bad(cmd({ op: TradeOp.Invite, name: 'a'.repeat(TRADE_WIRE_LIMITS.MAX_NAME_BYTES + 1) }));
    bad(cmd({ op: TradeOp.Invite, name: '\ud800' }));
    bad({ type: 'trade_result', clientMsgId: 0, reason: 256 });
    bad({ type: 'trade_invite', fromName: 'a', ttlMs: 65536 });
    bad(stateMsg({ phase: 3 }));
    bad(stateMsg({ closed: 4 }));
    bad(stateMsg({ mine: side({ locked: 1 }) }));
    bad(stateMsg({ mine: side({ stones: [1, 2] }) })); // wrong number of currencies
    bad(stateMsg({ mine: side({ stones: [1, 2, -3] }) }));
    bad(stateMsg({ tax: [0, 0] }));
    bad(stateMsg({ mine: side({ items: [{ defId: 1, quality: 0, qty: 0 }] }) })); // a line has at least one
    bad(stateMsg({ mine: side({ items: [{ defId: 65536, quality: 0, qty: 1 }] }) }));
    bad(
      stateMsg({
        theirs: side({ items: Array.from({ length: TRADE.MAX_LINES + 1 }, () => ({ defId: 1, quality: 0, qty: 1 })) }),
      }),
    );
    bad(stateMsg({ theirs: null }));
    // the maximum is fine
    const full = stateMsg({
      mine: side({
        items: Array.from({ length: TRADE.MAX_LINES }, (_, i) => ({ defId: i + 1, quality: 5, qty: 65535 })),
        stones: [4_294_967_295, 4_294_967_295, 4_294_967_295],
      }),
    }) as unknown as ColdMessage;
    expect(decode(encode(full))).toEqual(full);
  });

  it('decoder: truncation at every length, trailing bytes, invalid UTF-8, bad flags, too many lines', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0])), m.type).toThrowError(/trailing/);
    }
    const nm = Uint8Array.from(encode(cmd({ op: TradeOp.Invite, name: 'ab' }) as unknown as ColdMessage));
    nm[8] = 0xff; // the name bytes start after op(1) clientMsgId(2) len(1)
    expect(() => decode(nm)).toThrowError(/not valid UTF-8/);
    const base = Uint8Array.from(encode(stateMsg({ partner: '' }) as unknown as ColdMessage));
    // layout of an empty state after the 4-byte header: phase, closed, partner len (0), then the first side: count (index 7), 3 x u32, locked (20), confirmed (21)
    const tooMany = Uint8Array.from(base);
    tooMany[7] = TRADE.MAX_LINES + 1;
    expect(() => decode(tooMany)).toThrowError(/too many item lines/);
    const lockedFlag = Uint8Array.from(base);
    lockedFlag[20] = 2;
    expect(() => decode(lockedFlag)).toThrowError(/locked flag/);
    const confirmedFlag = Uint8Array.from(base);
    confirmedFlag[21] = 2;
    expect(() => decode(confirmedFlag)).toThrowError(/confirmed flag/);
  });

  it('random bytes never crash the decoder (only ProtocolError) and anything that decodes re-encodes identically', () => {
    const r = lcg(7411);
    for (let k = 0; k < 4000; k++) {
      const n = r.int(2, 70);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = 71 + r.int(0, 3);
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
