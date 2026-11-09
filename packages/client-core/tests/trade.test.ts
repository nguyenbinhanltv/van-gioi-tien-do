import { describe, expect, it } from 'vitest';
import { TradeClosed, TradeOp, TradePhase, TradeReason, type TradeSideView, type TradeStateMsg } from '@vgtd/protocol';
import { ChatLog, TRADE_REASON_TEXT, TradeModel, parseChatInput } from '../src/index.js';

const side = (o: Partial<TradeSideView> = {}): TradeSideView => ({
  items: [],
  stones: [0, 0, 0],
  locked: false,
  confirmed: false,
  ...o,
});
const state = (o: Partial<TradeStateMsg> = {}): TradeStateMsg => ({
  type: 'trade_state',
  phase: TradePhase.Open,
  closed: TradeClosed.None,
  partner: 'bob',
  mine: side(),
  theirs: side(),
  tax: [0, 0, 0],
  ...o,
});
const trade = (op: number, o: Record<string, unknown> = {}) => ({
  kind: 'trade',
  op,
  name: '',
  slot: 0,
  qty: 0,
  currency: 0,
  amount: 0,
  ...o,
});

describe('trade commands in the chat input', () => {
  it('/trade alone shows the window; /trade name invites; accept / decline take an optional name', () => {
    expect(parseChatInput('/trade')).toEqual({ kind: 'trades' });
    expect(parseChatInput('/trade bob')).toEqual(trade(TradeOp.Invite, { name: 'bob' }));
    expect(parseChatInput('/gd bob')).toEqual(trade(TradeOp.Invite, { name: 'bob' }));
    expect(parseChatInput('/trade accept')).toEqual(trade(TradeOp.Accept));
    expect(parseChatInput('/trade accept alice')).toEqual(trade(TradeOp.Accept, { name: 'alice' }));
    expect(parseChatInput('/trade decline alice')).toEqual(trade(TradeOp.Decline, { name: 'alice' }));
    expect(parseChatInput('/trade ' + 'a'.repeat(25))).toMatchObject({ kind: 'error' });
  });

  it('lock / confirm / cancel take nothing; add uses 1-based bag slots (0-based on the wire) and an optional quantity', () => {
    expect(parseChatInput('/trade lock')).toEqual(trade(TradeOp.Lock));
    expect(parseChatInput('/trade confirm')).toEqual(trade(TradeOp.Confirm));
    expect(parseChatInput('/trade cancel')).toEqual(trade(TradeOp.Cancel));
    expect(parseChatInput('/trade add 3')).toEqual(trade(TradeOp.SetItem, { slot: 2, qty: 1 }));
    expect(parseChatInput('/trade add 1 20')).toEqual(trade(TradeOp.SetItem, { slot: 0, qty: 20 }));
    expect(parseChatInput('/trade add 2 0')).toEqual(trade(TradeOp.SetItem, { slot: 1, qty: 0 }));
    expect(parseChatInput('/trade add')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/trade add x')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/trade add 1 70000')).toMatchObject({ kind: 'error' });
  });

  it('stones: /trade stones ha|trung|thuong amount', () => {
    expect(parseChatInput('/trade stones ha 100')).toEqual(trade(TradeOp.SetStones, { currency: 0, amount: 100 }));
    expect(parseChatInput('/trade stones trung 5')).toEqual(trade(TradeOp.SetStones, { currency: 1, amount: 5 }));
    expect(parseChatInput('/trade stones thuong 0')).toEqual(trade(TradeOp.SetStones, { currency: 2, amount: 0 }));
    expect(parseChatInput('/trade stones vang 5')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/trade stones ha')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/trade stones ha 99999999999')).toMatchObject({ kind: 'error' });
  });

  it('ChatLog.submit sends a trade command with a client id, says so when the socket is closed, and /trade calls the panel hook', () => {
    let shown = 0;
    const l = new ChatLog({ myName: () => 'me', onTrade: () => shown++ });
    const got: unknown[] = [];
    const never = () => false;
    expect(l.submit('/trade bob', never, never, undefined, undefined, (m) => (got.push(m), true))).toBe(true);
    expect(got).toEqual([
      { op: TradeOp.Invite, name: 'bob', slot: 0, qty: 0, currency: 0, amount: 0, clientMsgId: expect.any(Number) },
    ]);
    expect(l.submit('/trade lock', never, never, undefined, undefined, () => false)).toBe(false);
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error', text: 'Chưa kết nối máy chủ.' });
    expect(l.submit('/trade lock', never)).toBe(false); // no trade sender wired
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error' });
    expect(l.submit('/trade', never, never, undefined, undefined, () => true)).toBe(false);
    expect(shown).toBe(1);
  });
});

describe('TradeModel', () => {
  const model = () => {
    const clock = { t: 0 };
    return { m: new TradeModel({ now: () => clock.t }), clock };
  };

  it('is closed until a window opens; the view shows both sides, names items and gives lock / confirm hints', () => {
    const { m } = model();
    expect(m.view()).toMatchObject({ open: false, canLock: false, canConfirm: false });
    expect(
      m.applyState(state({ mine: side({ items: [{ defId: 1, quality: 0, qty: 5 }], stones: [100, 0, 0] }) })),
    ).toMatch(/Đã mở giao dịch với bob/);
    let v = m.view();
    expect(v).toMatchObject({ open: true, partner: 'bob', canLock: true, canConfirm: false });
    expect(v.mine.items).toEqual([{ defId: 1, quality: 0, qty: 5, name: 'Đan hồi máu' }]);
    expect(v.mine.stones).toEqual([100, 0, 0]);
    m.applyState(state({ mine: side({ locked: true }), theirs: side({ locked: true }) }));
    v = m.view();
    expect([v.canLock, v.canConfirm]).toEqual([false, true]);
    m.applyState(state({ mine: side({ locked: true, confirmed: true }), theirs: side({ locked: true }) }));
    expect(m.view().canConfirm).toBe(false); // already confirmed
  });

  it('announces open / done (with the tax) / closed (cancelled, partner left, expired); ordinary offer changes are silent', () => {
    const { m } = model();
    expect(m.applyState(state())).toMatch(/Đã mở/);
    expect(m.applyState(state({ theirs: side({ stones: [5, 0, 0] }) }))).toBeNull();
    expect(m.applyState(state({ phase: TradePhase.Done, tax: [7, 0, 1] }))).toMatch(
      /hoàn tất.*7 linh thạch hạ phẩm, 1 linh thạch thượng phẩm/,
    );
    expect(m.view().open).toBe(false);
    m.applyState(state());
    expect(m.applyState(state({ phase: TradePhase.Closed, closed: TradeClosed.PartnerLeft }))).toMatch(
      /đã rời game.*không có gì bị mất/,
    );
    m.applyState(state());
    expect(m.applyState(state({ phase: TradePhase.Closed, closed: TradeClosed.Expired }))).toMatch(/hết hạn/);
    m.applyState(state());
    expect(m.applyState(state({ phase: TradePhase.Closed, closed: TradeClosed.Cancelled }))).toMatch(/đã hủy/);
  });

  it('invites: the newest is answered by /trade accept, they expire on the model clock and are dropped when a window opens', () => {
    const { m, clock } = model();
    expect(m.invite()).toBeNull();
    expect(m.applyInvite({ type: 'trade_invite', fromName: 'alice', ttlMs: 30000 })).toMatch(/alice mời bạn giao dịch/);
    m.applyInvite({ type: 'trade_invite', fromName: 'carol', ttlMs: 30000 });
    expect(m.invite()!.fromName).toBe('carol');
    clock.t = 29_999;
    expect(m.invite()).not.toBeNull();
    clock.t = 30_001;
    expect(m.invite()).toBeNull();
    m.applyInvite({ type: 'trade_invite', fromName: 'dave', ttlMs: 30000 });
    m.forgetInvite('dave');
    expect(m.invite()).toBeNull();
    m.applyInvite({ type: 'trade_invite', fromName: 'erin', ttlMs: 30000 });
    m.applyState(state());
    expect(m.invite()).toBeNull();
  });

  it('answers every refusal in Vietnamese, and bumps the version per change', () => {
    const { m } = model();
    const v0 = m.version;
    m.applyState(state());
    expect(m.version).toBeGreaterThan(v0);
    expect(m.applyResult({ type: 'trade_result', clientMsgId: 1, reason: TradeReason.Ok })).toBeNull();
    for (const reason of Object.values(TradeReason).filter((v): v is number => typeof v === 'number')) {
      if (reason === TradeReason.Ok) continue;
      expect(TRADE_REASON_TEXT[reason], `reason ${reason}`).toBeTruthy();
      expect(m.applyResult({ type: 'trade_result', clientMsgId: 1, reason })).toBe(TRADE_REASON_TEXT[reason]);
    }
    expect(m.applyResult({ type: 'trade_result', clientMsgId: 1, reason: 200 })).toMatch(/mã 200/);
  });

  it('summary lines for /trade: no window, then both offers with their lock state', () => {
    const { m } = model();
    expect(m.summaryLines()[0]).toMatch(/không ở trong giao dịch/);
    m.applyState(
      state({
        mine: side({ items: [{ defId: 6, quality: 0, qty: 25 }], locked: true }),
        theirs: side({ stones: [10, 0, 0], locked: true, confirmed: true }),
      }),
    );
    const text = m.summaryLines().join('\n');
    expect(text).toMatch(/Giao dịch với bob/);
    expect(text).toMatch(/Bạn đưa: 25× Nguyên liệu \[đã khóa\]/);
    expect(text).toMatch(/bob đưa: 10 linh thạch hạ phẩm \[đã xác nhận\]/);
  });
});
