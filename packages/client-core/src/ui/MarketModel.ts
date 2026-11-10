/**
 * Market model (D112, Vạn Bảo Lâu): what the client knows about the auction house, fed by the server's `market_results` / `market_result` /
 * `market_notice`. Engine-free and DOM-free: the Cocos market panel only renders `listings()` and calls the command builders. The server is
 * authoritative for everything (who may list what, every price check, fee and tax, every refusal); this model keeps no rules of its own except
 * a PREVIEW of the fee and tax so a seller sees the cost before sending: the numbers come from the same `@vgtd/shared` functions the server
 * uses, and the real figures always come back in `market_result`. In-game stone currency only: no price / shop / real-money notions.
 */
import {
  MARKET_BOARD,
  MARKET_TAX_BETA_BPS,
  itemDefById,
  listingFeeInt,
  marketTaxInt,
  sellerProceedsInt,
} from '@vgtd/shared';
import {
  MarketNoticeKind,
  MarketOp,
  MarketReason,
  MarketSort,
  MarketView,
  type MarketBuyMsg,
  type MarketCancelMsg,
  type MarketListMsg,
  type MarketListing,
  type MarketNoticeMsg,
  type MarketResultMsg,
  type MarketResultsMsg,
  type MarketSearchMsg,
} from '@vgtd/protocol';
import { reasonTexts, t, type StringKey } from '../i18n/strings.js';

/** re-exported so engine scripts (which only see client-core) can name the enums */
export { MarketNoticeKind, MarketOp, MarketReason, MarketSort, MarketView } from '@vgtd/protocol';

/** Text of every market refusal (user-facing, from the string table; `{max}` = most listings per account). */
export const MARKET_REASON_TEXT: Readonly<Record<number, string>> = reasonTexts(
  {
    [MarketReason.Ok]: null,
    [MarketReason.RateLimited]: 'market.reason.rate_limited',
    [MarketReason.NotReady]: 'market.reason.not_ready',
    [MarketReason.BadRequest]: 'market.reason.bad_request',
    [MarketReason.NoSuchListing]: 'market.reason.no_such_listing',
    [MarketReason.NoItem]: 'market.reason.no_item',
    [MarketReason.TooManyListings]: 'market.reason.too_many_listings',
    [MarketReason.NoFunds]: 'market.reason.no_funds',
    [MarketReason.NoSpace]: 'market.reason.no_space',
    [MarketReason.SelfBuy]: 'market.reason.self_buy',
  },
  () => ({ max: MARKET_BOARD.MAX_LISTINGS_PER_ACCOUNT }),
);

/** String key of the placeholder item names (docs/07 s6); an id this client does not know (a newer server) shows as "Vat pham #id". */
const ITEM_LABEL_KEY: Readonly<Record<string, StringKey>> = {
  heal_pill: 'market.item.heal_pill',
  breakthrough_pill: 'market.item.breakthrough_pill',
  blueprint_white_green: 'market.item.blueprint_white_green',
  blueprint_blue_purple: 'market.item.blueprint_blue_purple',
  blueprint_gold_red: 'market.item.blueprint_gold_red',
  craft_material: 'market.item.craft_material',
};
/** Quality names (Trang .. Do) by index: `QUALITY_LABEL[q]`. */
export const QUALITY_LABEL: Readonly<Record<number, string>> = reasonTexts({
  0: 'market.quality.white',
  1: 'market.quality.green',
  2: 'market.quality.blue',
  3: 'market.quality.purple',
  4: 'market.quality.gold',
  5: 'market.quality.red',
});
export const SORT_LABEL: Readonly<Record<number, string>> = reasonTexts({
  [MarketSort.PriceAsc]: 'market.sort.price_asc',
  [MarketSort.PriceDesc]: 'market.sort.price_desc',
  [MarketSort.Newest]: 'market.sort.newest',
  [MarketSort.EndingSoon]: 'market.sort.ending_soon',
});

export function itemLabel(defId: number): string {
  const key = itemDefById(defId)?.key;
  const k = key && ITEM_LABEL_KEY[key];
  return k ? t(k) : t('market.item.unknown', { id: defId });
}

export interface MarketFilter {
  view: number;
  /** item definition id, 0 = any */
  defId: number;
  minQuality: number;
  sort: number;
  page: number;
}

export interface ListPreview {
  /** unit price x quantity */
  total: number;
  /** the non-refundable listing fee (1 %) the seller pays now */
  fee: number;
  /** the 5 % tax taken from a sale */
  tax: number;
  /** what the seller receives when it sells */
  proceeds: number;
}

type Waiting = { op: number; listing?: MarketListing; label?: string };

export class MarketModel {
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  readonly filter: MarketFilter = {
    view: MarketView.Browse,
    defId: 0,
    minQuality: 0,
    sort: MarketSort.PriceAsc,
    page: 0,
  };
  private rows: MarketListing[] = [];
  private _total = 0;
  private seen = false;
  private id = 0;
  private lastSearchId = -1;
  private readonly waiting = new Map<number, Waiting>();
  /** the newest line worth showing (a result, a refusal or a notice) */
  lastLine = '';

  constructor(private readonly rand: () => number = Math.random) {
    this.id = Math.floor(this.rand() * 0xffff);
  }

  /** True once the first results arrived (before that the panel shows "loading", not "empty"). */
  get ready(): boolean {
    return this.seen;
  }
  listings(): readonly MarketListing[] {
    return this.rows;
  }
  get total(): number {
    return this._total;
  }
  get pages(): number {
    return Math.max(1, Math.ceil(this._total / MARKET_BOARD.PAGE_SIZE));
  }
  get waitingCount(): number {
    return this.waiting.size;
  }

  private nextId(): number {
    this.id = (this.id + 1) & 0xffff;
    return this.id;
  }

  /** Change the filter (any field); the page restarts at 0 unless it is the thing changed. */
  setFilter(f: Partial<MarketFilter>): void {
    const pageOnly = Object.keys(f).length === 1 && f.page !== undefined;
    Object.assign(this.filter, f);
    if (!pageOnly && f.page === undefined) this.filter.page = 0;
    this.filter.page = Math.max(0, Math.min(MARKET_BOARD.MAX_PAGE, this.filter.page));
    this.version++;
  }

  // ------------------------------------------------------------------ command builders (the caller sends them)
  searchCmd(): MarketSearchMsg {
    const m: MarketSearchMsg = { type: 'market_search', clientMsgId: this.nextId(), ...this.filter };
    this.lastSearchId = m.clientMsgId;
    return m;
  }
  /** Fee and tax the seller would see for a lot (the server's own `@vgtd/shared` functions; the real charge comes back in the result). */
  preview(unitPrice: number, qty: number): ListPreview {
    const total = BigInt(Math.max(0, Math.floor(unitPrice))) * BigInt(Math.max(0, Math.floor(qty)));
    return {
      total: Number(total),
      fee: total > 0n ? Number(listingFeeInt(total)) : 0,
      tax: Number(marketTaxInt(total, MARKET_TAX_BETA_BPS)),
      proceeds: Number(sellerProceedsInt(total, MARKET_TAX_BETA_BPS)),
    };
  }
  /** The local part of the checks (the server re-validates everything): a Vietnamese problem line, or null when the form is sendable. */
  listProblem(unitPrice: number, qty: number, available: number, durationH: number): string | null {
    if (!Number.isInteger(unitPrice) || unitPrice < MARKET_BOARD.MIN_UNIT_PRICE) return t('market.problem.price');
    if (!Number.isInteger(qty) || qty < 1 || qty > available) return t('market.problem.qty');
    if (unitPrice * qty > MARKET_BOARD.MAX_TOTAL_PRICE) return t('market.problem.total');
    if (!MARKET_BOARD.DURATIONS_H.includes(durationH)) return t('market.problem.duration');
    return null;
  }
  listCmd(slot: number, qty: number, unitPrice: number, durationH: number): MarketListMsg {
    const m: MarketListMsg = { type: 'market_list', clientMsgId: this.nextId(), slot, qty, unitPrice, durationH };
    this.waiting.set(m.clientMsgId, { op: MarketOp.List });
    return m;
  }
  buyCmd(listingId: number): MarketBuyMsg {
    const m: MarketBuyMsg = { type: 'market_buy', clientMsgId: this.nextId(), listingId };
    this.waiting.set(m.clientMsgId, { op: MarketOp.Buy, ...this.labelOf(listingId) });
    return m;
  }
  cancelCmd(listingId: number): MarketCancelMsg {
    const m: MarketCancelMsg = { type: 'market_cancel', clientMsgId: this.nextId(), listingId };
    this.waiting.set(m.clientMsgId, { op: MarketOp.Cancel, ...this.labelOf(listingId) });
    return m;
  }
  private labelOf(listingId: number): Partial<Waiting> {
    const l = this.rows.find((r) => r.listingId === listingId);
    return l ? { listing: l, label: `${itemLabel(l.defId)} x${l.qty}` } : {};
  }

  // ------------------------------------------------------------------ server messages
  /** A page of results. Only the newest search counts (a slow older answer must not overwrite a newer view). */
  applyResults(m: MarketResultsMsg): void {
    if (m.clientMsgId !== this.lastSearchId) return;
    this.rows = m.listings.map((l) => ({ ...l }));
    this._total = m.total;
    this.filter.page = m.page;
    this.seen = true;
    this.version++;
  }

  /** The answer to a list / buy / cancel (or a refused search): the line to show, null for an answer this model did not ask for. */
  applyResult(m: MarketResultMsg): string | null {
    const w = this.waiting.get(m.clientMsgId);
    this.waiting.delete(m.clientMsgId);
    this.version++;
    let line: string;
    if (m.reason !== MarketReason.Ok)
      line = MARKET_REASON_TEXT[m.reason] ?? t('market.result.refused', { code: m.reason });
    else if (m.op === MarketOp.List) line = t('market.result.listed', { fee: m.amount });
    else if (m.op === MarketOp.Buy)
      line = t('market.result.bought', { what: w?.label ?? t('market.result.a_listing'), price: m.amount, tax: m.tax });
    else if (m.op === MarketOp.Cancel)
      line = t('market.result.cancelled', { what: w?.label ?? t('market.result.a_listing') });
    else line = '';
    if (!w && m.op !== MarketOp.Search) return null;
    this.lastLine = line;
    return line || null;
  }

  /** Something happened to one of your listings. */
  applyNotice(m: MarketNoticeMsg): string {
    const what = `${itemLabel(m.defId)} x${m.qty}`;
    this.version++;
    this.lastLine =
      m.kind === MarketNoticeKind.Sold
        ? t('market.notice.sold', { what, amount: m.amount })
        : t('market.notice.expired', { what });
    return this.lastLine;
  }

  /** The connection dropped: forget unanswered commands and the page (the next session starts from a fresh search). */
  reset(): void {
    this.waiting.clear();
    this.rows = [];
    this._total = 0;
    this.seen = false;
    this.lastSearchId = -1;
    this.version++;
  }

  /** The page as plain lines (for `/market` in the chat log). */
  summaryLines(): string[] {
    if (!this.seen) return [t('market.summary.loading')];
    const f = this.filter;
    const head = t(f.view === MarketView.Mine ? 'market.summary.mine' : 'market.summary.browse');
    const lines = [
      t('market.summary.head', {
        head,
        total: this._total,
        page: f.page + 1,
        pages: this.pages,
        sort: SORT_LABEL[f.sort] ?? '',
      }),
    ];
    for (const l of this.rows)
      lines.push(
        t('market.summary.row', {
          id: l.listingId,
          item: itemLabel(l.defId),
          quality: QUALITY_LABEL[l.quality] ?? '',
          qty: l.qty,
          price: l.unitPrice,
          seller: l.mine ? t('market.summary.seller_me', { name: l.seller }) : l.seller,
          mins: l.minutesLeft,
        }),
      );
    if (this.rows.length === 0) lines.push(t('market.summary.empty'));
    return lines;
  }
}
