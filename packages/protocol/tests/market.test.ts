import { describe, expect, it } from 'vitest';
import { MARKET_BOARD } from '@vgtd/shared';
import {
  COLD_ENVELOPE,
  MARKET_WIRE,
  MarketNoticeKind,
  MarketOp,
  MarketReason,
  MarketSort,
  MarketView,
  PROTOCOL_VERSION,
  ProtocolError,
  decode,
  decodeJson,
  encode,
  encodeJson,
  peekHeader,
  type ColdMessage,
  type MarketListing,
} from '../src/index.js';
import { lcg } from './helpers.js';

const listing = (i: number, over: Partial<MarketListing> = {}): MarketListing => ({
  listingId: 1000 + i,
  defId: 1 + (i % 6),
  quality: i % 6,
  qty: 1 + i,
  unitPrice: 50 + i * 7,
  seller: `seller_${i}`,
  minutesLeft: 720 - i,
  mine: i % 2 === 0,
  ...over,
});

const samples: ColdMessage[] = [
  {
    type: 'market_search',
    clientMsgId: 65535,
    view: MarketView.Browse,
    defId: 0,
    minQuality: 0,
    sort: MarketSort.PriceAsc,
    page: 0,
  },
  {
    type: 'market_search',
    clientMsgId: 2,
    view: MarketView.Mine,
    defId: 2,
    minQuality: 5,
    sort: MarketSort.EndingSoon,
    page: MARKET_BOARD.MAX_PAGE,
  },
  { type: 'market_results', clientMsgId: 7, view: MarketView.Browse, page: 0, total: 0, listings: [] },
  {
    type: 'market_results',
    clientMsgId: 8,
    view: MarketView.Mine,
    page: 3,
    total: 65535,
    listings: [listing(0), listing(1, { seller: 'Lý Thanh Vân' })],
  },
  { type: 'market_list', clientMsgId: 1, slot: 255, qty: 65535, unitPrice: 4_000_000_000, durationH: 48 },
  { type: 'market_buy', clientMsgId: 3, listingId: 4_294_967_295 },
  { type: 'market_cancel', clientMsgId: 4, listingId: 1 },
  {
    type: 'market_result',
    clientMsgId: 9,
    op: MarketOp.Buy,
    reason: MarketReason.NoFunds,
    listingId: 12,
    amount: 1000,
    tax: 50,
  },
  { type: 'market_notice', kind: MarketNoticeKind.Sold, listingId: 5, defId: 2, quality: 3, qty: 10, amount: 950 },
  { type: 'market_notice', kind: MarketNoticeKind.Expired, listingId: 6, defId: 1, quality: 0, qty: 1, amount: 0 },
];

describe('market messages (cold family ids 50-56)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses the docs/24 ids 50-54 (+55 cancel, 56 notice) on the cold envelope, protocol version unchanged', () => {
    const ids: Record<string, number> = {
      market_search: 50,
      market_results: 51,
      market_list: 52,
      market_buy: 53,
      market_result: 54,
      market_cancel: 55,
      market_notice: 56,
    };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
    expect(PROTOCOL_VERSION).toBe(5);
  });

  it('golden bytes: market_buy and market_list', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    expect(
      Buffer.from(encode({ type: 'market_buy', clientMsgId: 0x0102, listingId: 0x0a0b0c0d })).toString('hex'),
    ).toBe(`${v}800035` + '0102' + '0a0b0c0d');
    expect(
      Buffer.from(
        encode({ type: 'market_list', clientMsgId: 1, slot: 3, qty: 0x0010, unitPrice: 0x000003e8, durationH: 24 }),
      ).toString('hex'),
    ).toBe(`${v}800034` + '0001' + '03' + '0010' + '000003e8' + '18');
  });

  it('validates every field: ranges, enums, names, page size', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    const search = { type: 'market_search', clientMsgId: 0, view: 0, defId: 0, minQuality: 0, sort: 0, page: 0 };
    bad({ ...search, view: 2 });
    bad({ ...search, sort: 4 });
    bad({ ...search, minQuality: 6 });
    bad({ ...search, defId: 256 });
    bad({ ...search, page: MARKET_BOARD.MAX_PAGE + 1 });
    bad({ ...search, clientMsgId: 65536 });
    const list = { type: 'market_list', clientMsgId: 0, slot: 0, qty: 1, unitPrice: 1, durationH: 24 };
    bad({ ...list, qty: 0 });
    bad({ ...list, qty: MARKET_WIRE.MAX_QTY + 1 });
    bad({ ...list, unitPrice: 0 });
    bad({ ...list, unitPrice: 2 ** 32 });
    bad({ ...list, durationH: 0 });
    bad({ ...list, slot: 256 });
    bad({ type: 'market_buy', clientMsgId: 0, listingId: 0 });
    bad({ type: 'market_cancel', clientMsgId: 0, listingId: 2 ** 32 });
    bad({ type: 'market_result', clientMsgId: 0, op: 0, reason: 0, listingId: 0, amount: 0, tax: 0 });
    bad({ type: 'market_notice', kind: 3, listingId: 1, defId: 1, quality: 0, qty: 1, amount: 0 });
    const res = { type: 'market_results', clientMsgId: 0, view: 0, page: 0, total: 0 };
    bad({ ...res, listings: Array.from({ length: MARKET_BOARD.PAGE_SIZE + 1 }, (_, i) => listing(i)) });
    bad({ ...res, listings: [{ ...listing(0), seller: 'x'.repeat(MARKET_WIRE.MAX_NAME_BYTES + 1) }] });
    bad({ ...res, listings: [{ ...listing(0), seller: '\ud800' }] });
    bad({ ...res, listings: [{ ...listing(0), mine: 1 }] });
    bad({ ...res, listings: [{ ...listing(0), quality: 6 }] });
    bad({ ...res, listings: [null] });
    // the maximum page is fine and small
    const full = {
      ...res,
      type: 'market_results' as const,
      listings: Array.from({ length: MARKET_BOARD.PAGE_SIZE }, (_, i) =>
        listing(i, { seller: 'y'.repeat(MARKET_WIRE.MAX_NAME_BYTES) }),
      ),
    };
    expect(decode(encode(full))).toEqual(full);
    expect(encode(full).length).toBeLessThan(400); // a full page of listings with the longest names stays far under a packet
  });

  it('decoder: truncation at every length, trailing bytes, a bad mine flag', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      const longer = new Uint8Array(b.length + 1);
      longer.set(b);
      expect(() => decode(longer), `${m.type} trailing`).toThrow(ProtocolError);
    }
    const b = Uint8Array.from(
      encode({
        type: 'market_results',
        clientMsgId: 1,
        view: 0,
        page: 0,
        total: 1,
        listings: [listing(1, { seller: 'a' })],
      }),
    );
    b[b.length - 1] = 2; // the mine flag is the last byte
    expect(() => decode(b)).toThrow(ProtocolError);
  });

  it('fuzz: random bytes after a market header never crash the decoder with anything but a ProtocolError', () => {
    const rnd = lcg(12345);
    for (let k = 0; k < 400; k++) {
      const id = 50 + (k % 7);
      const len = Math.floor(rnd() * 40);
      const bytes = new Uint8Array(4 + len);
      bytes[0] = PROTOCOL_VERSION;
      bytes[1] = COLD_ENVELOPE;
      bytes[2] = 0;
      bytes[3] = id;
      for (let i = 0; i < len; i++) bytes[4 + i] = Math.floor(rnd() * 256);
      try {
        decode(bytes);
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
      }
    }
  });
});
