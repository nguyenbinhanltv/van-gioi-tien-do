/**
 * Vạn Bảo Lâu, the auction house ("cold family", D112; docs/10 §7.1 P4 "Vạn Bảo Lâu cơ bản"; docs/24 reserved cold ids 50-54 for it, 55-56
 * were free). Same `[ver][0x80][msgId u16][body]` envelope and strict fixed big-endian bodies as friends.ts / party.ts.
 *
 *   market_search  C->S  browse (view 0) or "my listings" (view 1): filters, sort, page
 *   market_results S->C  one page of listings + the total, answer to every market_search
 *   market_list    C->S  put a bag slot on the market: qty, unit price in hạ phẩm, duration in hours
 *   market_buy     C->S  buy a whole listing
 *   market_cancel  C->S  take your own listing back
 *   market_result  S->C  the answer to every list / buy / cancel: reason, fee / price / tax actually charged by the server
 *   market_notice  S->C  something happened to one of YOUR listings while you were doing something else: sold, or expired and returned
 *
 * Prices are whole hạ phẩm (the base stone currency); the server computes every fee and tax, the client only ever displays them. The wire
 * has NO real-money, shop-price or entitlement field: this is the in-game stone economy only.
 */
import { MARKET_BOARD } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export enum MarketSort {
  PriceAsc = 0,
  PriceDesc = 1,
  Newest = 2,
  EndingSoon = 3,
}
export enum MarketView {
  Browse = 0,
  Mine = 1,
}
export enum MarketOp {
  List = 1,
  Buy = 2,
  Cancel = 3,
  /** only in a `market_result` that REFUSES a `market_search` (rate limit, not ready); a search that runs answers with `market_results` */
  Search = 4,
}

/** Why a market command was refused (0 = done). Wire-stable. */
export enum MarketReason {
  Ok = 0,
  RateLimited = 1,
  /** the player is not in the world (yet) / the market is off */
  NotReady = 2,
  /** bad price, quantity or duration */
  BadRequest = 3,
  /** no such listing, already sold / cancelled / expired, or not yours to cancel (deliberately the same answer: no probing) */
  NoSuchListing = 4,
  /** the bag slot is empty, not tradable, or bound */
  NoItem = 5,
  /** you already have the maximum number of active listings */
  TooManyListings = 6,
  /** not enough hạ phẩm (for the listing fee, or for the price) */
  NoFunds = 7,
  /** your bag has no room for the item */
  NoSpace = 8,
  /** buying your own listing */
  SelfBuy = 9,
}

export const MARKET_WIRE = { MAX_NAME_BYTES: 24, MAX_QTY: 0xffff } as const;

export interface MarketSearchMsg {
  type: 'market_search';
  clientMsgId: number;
  view: number;
  /** item definition id, 0 = any */
  defId: number;
  /** minimum quality 0..5 */
  minQuality: number;
  sort: number;
  page: number;
}
export interface MarketListing {
  listingId: number;
  defId: number;
  quality: number;
  qty: number;
  /** hạ phẩm per unit; the whole lot costs unitPrice * qty */
  unitPrice: number;
  seller: string;
  /** minutes until it expires (rounded up) */
  minutesLeft: number;
  /** it is one of YOUR listings */
  mine: boolean;
}
export interface MarketResultsMsg {
  type: 'market_results';
  clientMsgId: number;
  view: number;
  page: number;
  /** listings matching the filter in total (all pages) */
  total: number;
  listings: readonly MarketListing[];
}
export interface MarketListMsg {
  type: 'market_list';
  clientMsgId: number;
  /** bag slot index */
  slot: number;
  qty: number;
  unitPrice: number;
  durationH: number;
}
export interface MarketBuyMsg {
  type: 'market_buy';
  clientMsgId: number;
  listingId: number;
}
export interface MarketCancelMsg {
  type: 'market_cancel';
  clientMsgId: number;
  listingId: number;
}
export interface MarketResultMsg {
  type: 'market_result';
  clientMsgId: number;
  op: number;
  reason: number;
  listingId: number;
  /** list: the listing fee charged; buy: the price paid; cancel: 0 */
  amount: number;
  /** buy: the tax taken from the seller's side (shown to the buyer for transparency); otherwise 0 */
  tax: number;
}
export enum MarketNoticeKind {
  /** your listing sold: `amount` is what you received after tax */
  Sold = 1,
  /** your listing expired: the item went back to your bag (or your pending loot) */
  Expired = 2,
}
export interface MarketNoticeMsg {
  type: 'market_notice';
  kind: number;
  listingId: number;
  defId: number;
  quality: number;
  qty: number;
  amount: number;
}
export type MarketClientMessage = MarketSearchMsg | MarketListMsg | MarketBuyMsg | MarketCancelMsg;
export type MarketServerMessage = MarketResultsMsg | MarketResultMsg | MarketNoticeMsg;
export type MarketMessage = MarketClientMessage | MarketServerMessage;

type Rec = Record<string, unknown>;
const U16 = 0xffff;
const U32 = 0xffffffff;
const ENC = new TextEncoder();
const DEC = new TextDecoder('utf-8', { fatal: true });

function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}
function name(x: unknown, what: string): string {
  if (typeof x !== 'string') throw new ProtocolError('malformed', `${what} must be a string`);
  const b = ENC.encode(x);
  if (b.length > MARKET_WIRE.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${MARKET_WIRE.MAX_NAME_BYTES} bytes`);
  if (DEC.decode(b) !== x) throw new ProtocolError('malformed', `${what} is not valid Unicode text`);
  return x;
}
function rec(x: unknown, what: string): Rec {
  if (typeof x !== 'object' || x === null || Array.isArray(x))
    throw new ProtocolError('malformed', `${what} entries must be objects`);
  return x as Rec;
}

function listing(x: unknown): MarketListing {
  const l = rec(x, 'listings');
  if (typeof l.mine !== 'boolean') throw new ProtocolError('malformed', 'mine must be a boolean');
  return {
    listingId: int(l.listingId, 1, U32, 'listingId'),
    defId: int(l.defId, 0, 255, 'defId'),
    quality: int(l.quality, 0, 5, 'quality'),
    qty: int(l.qty, 1, MARKET_WIRE.MAX_QTY, 'qty'),
    unitPrice: int(l.unitPrice, 1, U32, 'unitPrice'),
    seller: name(l.seller, 'seller'),
    minutesLeft: int(l.minutesLeft, 0, U16, 'minutesLeft'),
    mine: l.mine,
  };
}

/** The normalised market message for `o.type`, or null when it is not one. */
export function validateMarketMessage(o: Rec): MarketMessage | null {
  switch (o.type) {
    case 'market_search':
      return {
        type: 'market_search',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        view: int(o.view, MarketView.Browse, MarketView.Mine, 'view'),
        defId: int(o.defId, 0, 255, 'defId'),
        minQuality: int(o.minQuality, 0, 5, 'minQuality'),
        sort: int(o.sort, MarketSort.PriceAsc, MarketSort.EndingSoon, 'sort'),
        page: int(o.page, 0, MARKET_BOARD.MAX_PAGE, 'page'),
      };
    case 'market_results': {
      if (!Array.isArray(o.listings) || o.listings.length > MARKET_BOARD.PAGE_SIZE)
        throw new ProtocolError('range', `listings must be an array of at most ${MARKET_BOARD.PAGE_SIZE}`);
      return {
        type: 'market_results',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        view: int(o.view, MarketView.Browse, MarketView.Mine, 'view'),
        page: int(o.page, 0, MARKET_BOARD.MAX_PAGE, 'page'),
        total: int(o.total, 0, U16, 'total'),
        listings: o.listings.map(listing),
      };
    }
    case 'market_list':
      return {
        type: 'market_list',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        slot: int(o.slot, 0, 255, 'slot'),
        qty: int(o.qty, 1, MARKET_WIRE.MAX_QTY, 'qty'),
        unitPrice: int(o.unitPrice, 1, U32, 'unitPrice'),
        durationH: int(o.durationH, 1, 255, 'durationH'),
      };
    case 'market_buy':
    case 'market_cancel':
      return {
        type: o.type,
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        listingId: int(o.listingId, 1, U32, 'listingId'),
      };
    case 'market_result':
      return {
        type: 'market_result',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        op: int(o.op, MarketOp.List, MarketOp.Search, 'op'),
        reason: int(o.reason, 0, 255, 'reason'),
        listingId: int(o.listingId, 0, U32, 'listingId'),
        amount: int(o.amount, 0, U32, 'amount'),
        tax: int(o.tax, 0, U32, 'tax'),
      };
    case 'market_notice':
      return {
        type: 'market_notice',
        kind: int(o.kind, MarketNoticeKind.Sold, MarketNoticeKind.Expired, 'kind'),
        listingId: int(o.listingId, 1, U32, 'listingId'),
        defId: int(o.defId, 0, 255, 'defId'),
        quality: int(o.quality, 0, 5, 'quality'),
        qty: int(o.qty, 1, MARKET_WIRE.MAX_QTY, 'qty'),
        amount: int(o.amount, 0, U32, 'amount'),
      };
    default:
      return null;
  }
}

function writeName(w: ColdWriter, s: string): void {
  const b = ENC.encode(s);
  w.u8(b.length);
  w.bytes(b);
}
function readName(r: ColdReader, what: string): string {
  const n = r.u8();
  if (n > MARKET_WIRE.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${MARKET_WIRE.MAX_NAME_BYTES} bytes`);
  try {
    return DEC.decode(r.sub(n));
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError('malformed', `${what} is not valid UTF-8`);
  }
}

export function encodeMarketBody(w: ColdWriter, m: MarketMessage): void {
  switch (m.type) {
    case 'market_search':
      w.u16(m.clientMsgId);
      w.u8(m.view);
      w.u8(m.defId);
      w.u8(m.minQuality);
      w.u8(m.sort);
      w.u8(m.page);
      break;
    case 'market_results':
      w.u16(m.clientMsgId);
      w.u8(m.view);
      w.u8(m.page);
      w.u16(m.total);
      w.u8(m.listings.length);
      for (const l of m.listings) {
        w.u32(l.listingId);
        w.u8(l.defId);
        w.u8(l.quality);
        w.u16(l.qty);
        w.u32(l.unitPrice);
        writeName(w, l.seller);
        w.u16(l.minutesLeft);
        w.u8(l.mine ? 1 : 0);
      }
      break;
    case 'market_list':
      w.u16(m.clientMsgId);
      w.u8(m.slot);
      w.u16(m.qty);
      w.u32(m.unitPrice);
      w.u8(m.durationH);
      break;
    case 'market_buy':
    case 'market_cancel':
      w.u16(m.clientMsgId);
      w.u32(m.listingId);
      break;
    case 'market_result':
      w.u16(m.clientMsgId);
      w.u8(m.op);
      w.u8(m.reason);
      w.u32(m.listingId);
      w.u32(m.amount);
      w.u32(m.tax);
      break;
    case 'market_notice':
      w.u8(m.kind);
      w.u32(m.listingId);
      w.u8(m.defId);
      w.u8(m.quality);
      w.u16(m.qty);
      w.u32(m.amount);
      break;
  }
}

export function decodeMarketBody(r: ColdReader, type: MarketMessage['type']): Rec {
  switch (type) {
    case 'market_search':
      return {
        type,
        clientMsgId: r.u16(),
        view: r.u8(),
        defId: r.u8(),
        minQuality: r.u8(),
        sort: r.u8(),
        page: r.u8(),
      };
    case 'market_results': {
      const clientMsgId = r.u16();
      const view = r.u8();
      const page = r.u8();
      const total = r.u16();
      const n = r.u8();
      if (n > MARKET_BOARD.PAGE_SIZE) throw new ProtocolError('range', 'too many listings');
      const listings: Rec[] = [];
      for (let i = 0; i < n; i++) {
        const listingId = r.u32();
        const defId = r.u8();
        const quality = r.u8();
        const qty = r.u16();
        const unitPrice = r.u32();
        const seller = readName(r, 'seller');
        const minutesLeft = r.u16();
        const mine = r.u8();
        if (mine > 1) throw new ProtocolError('malformed', 'mine flag must be 0 or 1');
        listings.push({ listingId, defId, quality, qty, unitPrice, seller, minutesLeft, mine: mine === 1 });
      }
      return { type, clientMsgId, view, page, total, listings };
    }
    case 'market_list':
      return { type, clientMsgId: r.u16(), slot: r.u8(), qty: r.u16(), unitPrice: r.u32(), durationH: r.u8() };
    case 'market_buy':
    case 'market_cancel':
      return { type, clientMsgId: r.u16(), listingId: r.u32() };
    case 'market_result':
      return {
        type,
        clientMsgId: r.u16(),
        op: r.u8(),
        reason: r.u8(),
        listingId: r.u32(),
        amount: r.u32(),
        tax: r.u32(),
      };
    case 'market_notice':
      return { type, kind: r.u8(), listingId: r.u32(), defId: r.u8(), quality: r.u8(), qty: r.u16(), amount: r.u32() };
  }
}
