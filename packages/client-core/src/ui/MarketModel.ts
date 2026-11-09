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

/** re-exported so engine scripts (which only see client-core) can name the enums */
export { MarketNoticeKind, MarketOp, MarketReason, MarketSort, MarketView } from '@vgtd/protocol';

/** Vietnamese text of every market refusal (user-facing). */
export const MARKET_REASON_TEXT: Readonly<Record<number, string>> = {
  [MarketReason.Ok]: '',
  [MarketReason.RateLimited]: 'Bạn thao tác quá nhanh, hãy chờ giây lát.',
  [MarketReason.NotReady]: 'Chưa vào game, chưa dùng được Vạn Bảo Lâu.',
  [MarketReason.BadRequest]: 'Giá, số lượng hoặc thời hạn không hợp lệ.',
  [MarketReason.NoSuchListing]: 'Món hàng này không còn (đã bán, đã hủy, hết hạn, hoặc không phải của bạn).',
  [MarketReason.NoItem]: 'Ô túi này không có món đồ có thể bán (trống, không đủ số lượng, hoặc đã khóa).',
  [MarketReason.TooManyListings]: `Bạn đang đăng bán tối đa ${MARKET_BOARD.MAX_LISTINGS_PER_ACCOUNT} món.`,
  [MarketReason.NoFunds]: 'Không đủ Linh thạch hạ phẩm.',
  [MarketReason.NoSpace]: 'Túi đồ của bạn không còn chỗ.',
  [MarketReason.SelfBuy]: 'Không thể mua hàng do chính bạn đăng.',
};

/** Placeholder item names (docs/07 §6); an id this client does not know (a newer server) shows as `Vật phẩm #id`. */
const ITEM_LABEL: Readonly<Record<string, string>> = {
  heal_pill: 'Đan hồi máu',
  breakthrough_pill: 'Đan đột phá',
  blueprint_white_green: 'Bản vẽ (Trắng-Lục)',
  blueprint_blue_purple: 'Bản vẽ (Lam-Tím)',
  blueprint_gold_red: 'Bản vẽ (Vàng-Đỏ)',
  craft_material: 'Nguyên liệu',
};
export const QUALITY_LABEL = ['Trắng', 'Lục', 'Lam', 'Tím', 'Vàng', 'Đỏ'] as const;
export const SORT_LABEL: Readonly<Record<number, string>> = {
  [MarketSort.PriceAsc]: 'Giá thấp trước',
  [MarketSort.PriceDesc]: 'Giá cao trước',
  [MarketSort.Newest]: 'Mới đăng',
  [MarketSort.EndingSoon]: 'Sắp hết hạn',
};

export function itemLabel(defId: number): string {
  const key = itemDefById(defId)?.key;
  return (key && ITEM_LABEL[key]) || `Vật phẩm #${defId}`;
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
  readonly filter: MarketFilter = { view: MarketView.Browse, defId: 0, minQuality: 0, sort: MarketSort.PriceAsc, page: 0 };
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
    if (!Number.isInteger(unitPrice) || unitPrice < MARKET_BOARD.MIN_UNIT_PRICE) return 'Hãy nhập giá (số nguyên, tối thiểu 1).';
    if (!Number.isInteger(qty) || qty < 1 || qty > available) return 'Số lượng không hợp lệ.';
    if (unitPrice * qty > MARKET_BOARD.MAX_TOTAL_PRICE) return 'Tổng giá quá lớn.';
    if (!MARKET_BOARD.DURATIONS_H.includes(durationH)) return 'Thời hạn không hợp lệ.';
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
    if (m.reason !== MarketReason.Ok) line = MARKET_REASON_TEXT[m.reason] ?? `Thao tác bị từ chối (mã ${m.reason}).`;
    else if (m.op === MarketOp.List) line = `Đã đăng bán. Phí niêm yết ${m.amount} hạ phẩm (không hoàn lại).`;
    else if (m.op === MarketOp.Buy)
      line = `Đã mua ${w?.label ?? 'món hàng'} với giá ${m.amount} hạ phẩm (người bán chịu thuế ${m.tax}).`;
    else if (m.op === MarketOp.Cancel) line = `Đã gỡ ${w?.label ?? 'món hàng'} về túi (phí niêm yết không hoàn lại).`;
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
        ? `Vạn Bảo Lâu: ${what} đã bán, bạn nhận ${m.amount} hạ phẩm (sau thuế).`
        : `Vạn Bảo Lâu: ${what} đã hết hạn và được trả về túi (hoặc kho nhặt đồ).`;
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
    if (!this.seen) return ['Vạn Bảo Lâu chưa tải xong.'];
    const f = this.filter;
    const head = f.view === MarketView.Mine ? 'Hàng của bạn' : 'Vạn Bảo Lâu';
    const lines = [`${head} (${this._total} món, trang ${f.page + 1}/${this.pages}, ${SORT_LABEL[f.sort] ?? ''}):`];
    for (const l of this.rows)
      lines.push(
        `  #${l.listingId} ${itemLabel(l.defId)} ${QUALITY_LABEL[l.quality] ?? ''} x${l.qty} · ${l.unitPrice} hạ/cái · ${l.seller}${l.mine ? ' (bạn)' : ''} · còn ${l.minutesLeft} phút`,
      );
    if (this.rows.length === 0) lines.push('  (không có món nào)');
    return lines;
  }
}
