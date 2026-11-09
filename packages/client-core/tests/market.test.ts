import { describe, expect, it } from 'vitest';
import { MARKET_BOARD } from '@vgtd/shared';
import {
  MarketNoticeKind,
  MarketOp,
  MarketReason,
  MarketSort,
  MarketView,
  type MarketListing,
  type MarketResultMsg,
} from '@vgtd/protocol';
import { MARKET_REASON_TEXT, MarketModel, itemLabel } from '../src/index.js';

const listing = (id: number, over: Partial<MarketListing> = {}): MarketListing => ({
  listingId: id,
  defId: 1,
  quality: 0,
  qty: 10,
  unitPrice: 100,
  seller: 'alice',
  minutesLeft: 90,
  mine: false,
  ...over,
});
const result = (m: MarketResultMsg, over: Partial<MarketResultMsg>): MarketResultMsg => ({ ...m, ...over });

describe('MarketModel (D112)', () => {
  it('builds commands with fresh uint16 ids and keeps the filter in the search', () => {
    const m = new MarketModel(() => 0.99999);
    m.setFilter({ defId: 2, minQuality: 3, sort: MarketSort.Newest });
    const a = m.searchCmd();
    const b = m.searchCmd();
    expect(a).toMatchObject({
      type: 'market_search',
      view: MarketView.Browse,
      defId: 2,
      minQuality: 3,
      sort: MarketSort.Newest,
      page: 0,
    });
    expect(b.clientMsgId).not.toBe(a.clientMsgId);
    expect(a.clientMsgId).toBeLessThanOrEqual(0xffff);
    expect(m.listCmd(4, 5, 100, 24)).toMatchObject({
      type: 'market_list',
      slot: 4,
      qty: 5,
      unitPrice: 100,
      durationH: 24,
    });
    expect(m.buyCmd(7)).toMatchObject({ type: 'market_buy', listingId: 7 });
    expect(m.cancelCmd(8)).toMatchObject({ type: 'market_cancel', listingId: 8 });
    expect(m.waitingCount).toBe(3);
  });

  it('a filter change goes back to page 0, a page change keeps the filter, and the page is clamped', () => {
    const m = new MarketModel(() => 0);
    m.setFilter({ page: 3 });
    expect(m.filter.page).toBe(3);
    m.setFilter({ defId: 1 });
    expect(m.filter.page).toBe(0);
    m.setFilter({ page: 3 });
    m.setFilter({ sort: MarketSort.PriceDesc });
    expect(m.filter).toMatchObject({ sort: MarketSort.PriceDesc, page: 0 });
    m.setFilter({ page: 9999 });
    expect(m.filter.page).toBe(MARKET_BOARD.MAX_PAGE);
    m.setFilter({ page: -4 });
    expect(m.filter.page).toBe(0);
  });

  it('applies only the answer to the NEWEST search (a slow older page must not overwrite the view)', () => {
    const m = new MarketModel(() => 0);
    expect(m.ready).toBe(false);
    const old = m.searchCmd();
    const cur = m.searchCmd();
    m.applyResults({
      type: 'market_results',
      clientMsgId: cur.clientMsgId,
      view: 0,
      page: 0,
      total: 1,
      listings: [listing(2)],
    });
    m.applyResults({
      type: 'market_results',
      clientMsgId: old.clientMsgId,
      view: 0,
      page: 0,
      total: 5,
      listings: [listing(1)],
    });
    expect(m.listings().map((l) => l.listingId)).toEqual([2]);
    expect(m.total).toBe(1);
    expect(m.ready).toBe(true);
    expect(m.pages).toBe(1);
    m.applyResults({
      type: 'market_results',
      clientMsgId: m.searchCmd().clientMsgId,
      view: 0,
      page: 0,
      total: 17,
      listings: [],
    });
    expect(m.pages).toBe(Math.ceil(17 / MARKET_BOARD.PAGE_SIZE));
  });

  it('previews the fee and the tax with the shared rules (1 % fee at least 1, 5 % tax rounded up)', () => {
    const m = new MarketModel(() => 0);
    expect(m.preview(100, 10)).toEqual({ total: 1000, fee: 10, tax: 50, proceeds: 950 });
    expect(m.preview(1, 1)).toEqual({ total: 1, fee: 1, tax: 1, proceeds: 0 });
    expect(m.preview(13, 7)).toEqual({ total: 91, fee: 1, tax: 5, proceeds: 86 });
    expect(m.preview(0, 5)).toEqual({ total: 0, fee: 0, tax: 0, proceeds: 0 });
  });

  it('checks the form locally and says why in Vietnamese', () => {
    const m = new MarketModel(() => 0);
    expect(m.listProblem(100, 5, 10, 24)).toBeNull();
    expect(m.listProblem(0, 5, 10, 24)).toContain('giá');
    expect(m.listProblem(1.5, 5, 10, 24)).toContain('giá');
    expect(m.listProblem(100, 11, 10, 24)).toContain('Số lượng');
    expect(m.listProblem(100, 0, 10, 24)).toContain('Số lượng');
    expect(m.listProblem(MARKET_BOARD.MAX_TOTAL_PRICE, 2, 10, 24)).toContain('Tổng giá');
    expect(m.listProblem(100, 5, 10, 7)).toContain('Thời hạn');
  });

  it('turns every answer into a line: success with the charged numbers, refusals in Vietnamese, unknown ids ignored', () => {
    const m = new MarketModel(() => 0);
    m.applyResults({
      type: 'market_results',
      clientMsgId: m.searchCmd().clientMsgId,
      view: 0,
      page: 0,
      total: 1,
      listings: [listing(9)],
    });
    const list = m.listCmd(0, 10, 100, 24);
    const base: MarketResultMsg = {
      type: 'market_result',
      clientMsgId: list.clientMsgId,
      op: MarketOp.List,
      reason: 0,
      listingId: 3,
      amount: 10,
      tax: 0,
    };
    expect(m.applyResult(base)).toContain('Phí niêm yết 10');
    const buy = m.buyCmd(9);
    const bought = m.applyResult(
      result(base, { clientMsgId: buy.clientMsgId, op: MarketOp.Buy, listingId: 9, amount: 1000, tax: 50 }),
    );
    expect(bought).toContain('Đan hồi máu x10');
    expect(bought).toContain('1000');
    const cancel = m.cancelCmd(9);
    expect(m.applyResult(result(base, { clientMsgId: cancel.clientMsgId, op: MarketOp.Cancel, amount: 0 }))).toContain(
      'Đã gỡ',
    );
    const refused = m.buyCmd(9);
    expect(
      m.applyResult(result(base, { clientMsgId: refused.clientMsgId, op: MarketOp.Buy, reason: MarketReason.NoFunds })),
    ).toBe(MARKET_REASON_TEXT[MarketReason.NoFunds]);
    expect(m.applyResult(result(base, { clientMsgId: 4242 }))).toBeNull(); // an answer to nothing this model asked
    expect(m.waitingCount).toBe(0);
    for (const reason of Object.values(MarketReason).filter((v): v is number => typeof v === 'number'))
      if (reason !== MarketReason.Ok) expect(MARKET_REASON_TEXT[reason], `reason ${reason}`).toBeTruthy();
  });

  it('notices read as sold (with what the seller received) or expired', () => {
    const m = new MarketModel(() => 0);
    const sold = m.applyNotice({
      type: 'market_notice',
      kind: MarketNoticeKind.Sold,
      listingId: 1,
      defId: 2,
      quality: 0,
      qty: 3,
      amount: 285,
    });
    expect(sold).toContain('Đan đột phá x3');
    expect(sold).toContain('285');
    expect(
      m.applyNotice({
        type: 'market_notice',
        kind: MarketNoticeKind.Expired,
        listingId: 2,
        defId: 1,
        quality: 0,
        qty: 1,
        amount: 0,
      }),
    ).toContain('hết hạn');
    expect(itemLabel(99)).toBe('Vật phẩm #99'); // an id from a newer server does not break the panel
  });

  it('reset forgets pending commands and the page; the plain-text summary names the listings', () => {
    const m = new MarketModel(() => 0);
    expect(m.summaryLines()).toEqual(['Vạn Bảo Lâu chưa tải xong.']);
    m.applyResults({
      type: 'market_results',
      clientMsgId: m.searchCmd().clientMsgId,
      view: 0,
      page: 0,
      total: 1,
      listings: [listing(5, { mine: true })],
    });
    m.buyCmd(5);
    expect(m.summaryLines().join('\n')).toContain('#5 Đan hồi máu');
    expect(m.summaryLines().join('\n')).toContain('(bạn)');
    const v = m.version;
    m.reset();
    expect(m.version).toBeGreaterThan(v);
    expect(m.waitingCount).toBe(0);
    expect(m.ready).toBe(false);
    expect(m.listings()).toEqual([]);
  });
});
