/**
 * Trade model (D102): what the client knows about its direct-trade window, fed by the server's `trade_state` / `trade_invite` /
 * `trade_result`. Engine-free and DOM-free: the Cocos trade panel only renders `view()` / `invite()`. The server stays authoritative (who is in the
 * window, what is offered, the locks, the tax, every refusal); this keeps no rules of its own beyond naming items and showing answers in
 * Vietnamese.
 *
 * Everything is in-game currency (docs/26: Linh thạch hạ / trung / thượng): no real money, price, shop or entitlement exists in a trade.
 */
import { TRADE, itemDefById } from '@vgtd/shared';
import {
  TradeClosed,
  TradePhase,
  TradeReason,
  type TradeInviteMsg,
  type TradeResultMsg,
  type TradeSideView,
  type TradeStateMsg,
} from '@vgtd/protocol';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { TradeOp, TradePhase } from '@vgtd/protocol';

/** Vietnamese text of every trade refusal (user-facing). */
export const TRADE_REASON_TEXT: Readonly<Record<number, string>> = {
  [TradeReason.Ok]: '',
  [TradeReason.RateLimited]: 'Bạn thao tác quá nhanh, hãy chờ giây lát.',
  [TradeReason.NotReady]: 'Chưa vào game, chưa giao dịch được.',
  [TradeReason.NoSuchPlayer]: 'Không tìm thấy người chơi này (hoặc họ đang ngoại tuyến).',
  [TradeReason.Self]: 'Không thể giao dịch với chính mình.',
  [TradeReason.TooFar]: `Hai bên phải đứng gần nhau (trong ${TRADE.RANGE_TILES} ô).`,
  [TradeReason.AlreadyTrading]: 'Bạn đang trong một giao dịch, hãy hoàn tất hoặc hủy trước.',
  [TradeReason.TargetBusy]: 'Người này đang giao dịch (hoặc đã được mời).',
  [TradeReason.NoInvite]: 'Không có lời mời giao dịch nào còn hiệu lực.',
  [TradeReason.NotTrading]: 'Bạn không ở trong giao dịch nào.',
  [TradeReason.BadSlot]: 'Ô túi đồ này trống hoặc không hợp lệ.',
  [TradeReason.NotTradable]: 'Vật phẩm này không giao dịch được.',
  [TradeReason.TooManyLines]: `Mỗi bên đặt tối đa ${TRADE.MAX_LINES} dòng vật phẩm.`,
  [TradeReason.NotEnough]: 'Bạn không có đủ số lượng này.',
  [TradeReason.BadAmount]: 'Số lượng hoặc loại linh thạch không hợp lệ.',
  [TradeReason.NotLocked]: 'Cả hai bên phải khóa đề nghị trước khi xác nhận.',
  [TradeReason.ItemsChanged]: 'Vật phẩm đã thay đổi (dùng, bỏ, hoặc đã giao đi): giao dịch được đặt lại, hãy kiểm tra rồi khóa lại.',
  [TradeReason.NoSpace]: 'Túi đồ của một bên không đủ chỗ: giao dịch chưa thực hiện.',
  [TradeReason.NotEnoughStones]: 'Một bên không còn đủ linh thạch: giao dịch chưa thực hiện.',
};

/** Stone labels in `CURRENCIES` order (docs/26 §2.1). */
export const STONE_LABELS: readonly string[] = ['hạ phẩm', 'trung phẩm', 'thượng phẩm'];

const ITEM_NAMES: Readonly<Record<string, string>> = {
  heal_pill: 'Đan hồi máu',
  breakthrough_pill: 'Đan đột phá',
  craft_material: 'Nguyên liệu',
  blueprint_white_green: 'Bản vẽ (trắng-lục)',
  blueprint_blue_purple: 'Bản vẽ (lam-tím)',
  blueprint_gold_red: 'Bản vẽ (vàng-đỏ)',
};

export interface TradeLineRow {
  defId: number;
  quality: number;
  qty: number;
  name: string;
}
export interface TradeSideRow {
  items: TradeLineRow[];
  stones: number[];
  locked: boolean;
  confirmed: boolean;
}
export interface TradeView {
  open: boolean;
  partner: string;
  mine: TradeSideRow;
  theirs: TradeSideRow;
  /** a hint only (the server decides): I may lock now */
  canLock: boolean;
  /** a hint only: both locked and I have not confirmed yet */
  canConfirm: boolean;
}
export interface TradeInvite {
  fromName: string;
  /** model clock, ms, at which it stops being valid */
  expiresAtMs: number;
}

export interface TradeModelOptions {
  /** monotonic clock in ms */
  now: () => number;
}

const emptySide = (): TradeSideRow => ({ items: [], stones: [0, 0, 0], locked: false, confirmed: false });

export class TradeModel {
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  private state: TradeStateMsg | null = null;
  private invites: TradeInvite[] = [];

  constructor(private readonly o: TradeModelOptions) {}

  /** What a bag item is called: the key made readable (placeholder names; there is no i18n table yet). */
  itemName(defId: number, quality: number): string {
    const key = itemDefById(defId)?.key;
    const base = (key && ITEM_NAMES[key]) || (key ?? `Vật phẩm ${defId}`);
    return quality > 0 ? `${base} (phẩm ${quality})` : base;
  }

  private row(s: TradeSideView): TradeSideRow {
    return {
      items: s.items.map((l) => ({ ...l, name: this.itemName(l.defId, l.quality) })),
      stones: [...s.stones],
      locked: s.locked,
      confirmed: s.confirmed,
    };
  }

  get open(): boolean {
    return this.state?.phase === TradePhase.Open;
  }

  view(): TradeView {
    const s = this.state;
    if (!s || s.phase !== TradePhase.Open)
      return { open: false, partner: '', mine: emptySide(), theirs: emptySide(), canLock: false, canConfirm: false };
    return {
      open: true,
      partner: s.partner,
      mine: this.row(s.mine),
      theirs: this.row(s.theirs),
      canLock: !s.mine.locked,
      canConfirm: s.mine.locked && s.theirs.locked && !s.mine.confirmed,
    };
  }

  /** The newest live invite (what `/trade accept` answers), or null. */
  invite(): TradeInvite | null {
    this.expire();
    return this.invites.length ? this.invites[this.invites.length - 1]! : null;
  }
  private expire(): void {
    const t = this.o.now();
    const live = this.invites.filter((i) => i.expiresAtMs > t);
    if (live.length !== this.invites.length) {
      this.invites = live;
      this.version++;
    }
  }
  forgetInvite(fromName: string): void {
    const before = this.invites.length;
    this.invites = this.invites.filter((i) => i.fromName !== fromName);
    if (this.invites.length !== before) this.version++;
  }

  /** A new invite; returns the line to show. */
  applyInvite(m: TradeInviteMsg): string {
    this.invites = this.invites.filter((i) => i.fromName !== m.fromName);
    this.invites.push({ fromName: m.fromName, expiresAtMs: this.o.now() + m.ttlMs });
    this.version++;
    return `${m.fromName} mời bạn giao dịch. Gõ /trade accept để nhận hoặc /trade decline để từ chối.`;
  }

  /**
   * The window changed. Returns a system line for what is worth announcing (opened, closed and why, done with the tax), or null for an ordinary
   * offer change (the panel shows those).
   */
  applyState(m: TradeStateMsg): string | null {
    const was = this.state;
    this.state = { ...m, mine: { ...m.mine }, theirs: { ...m.theirs } };
    this.version++;
    if (m.phase === TradePhase.Open) {
      this.invites = []; // a window is open: pending invites are moot (the server dropped them too)
      return !was || was.phase !== TradePhase.Open ? `Đã mở giao dịch với ${m.partner}.` : null;
    }
    if (m.phase === TradePhase.Done) {
      const tax = m.tax.map((t, i) => (t > 0 ? `${t} linh thạch ${STONE_LABELS[i]}` : '')).filter(Boolean);
      return `Giao dịch với ${m.partner} đã hoàn tất${tax.length ? ` (thuế 3%: ${tax.join(', ')})` : ''}.`;
    }
    switch (m.closed) {
      case TradeClosed.PartnerLeft:
        return `${m.partner || 'Đối phương'} đã rời game: giao dịch bị hủy, không có gì bị mất.`;
      case TradeClosed.Expired:
        return 'Giao dịch hết hạn (60 giây không thay đổi): không có gì bị mất.';
      default:
        return 'Giao dịch đã hủy: không có gì bị mất.';
    }
  }

  /** The answer to a command: the line to show when refused, null when done. */
  applyResult(m: TradeResultMsg): string | null {
    if (m.reason === TradeReason.Ok) return null;
    return TRADE_REASON_TEXT[m.reason] ?? `Thao tác bị từ chối (mã ${m.reason}).`;
  }

  /** The window as plain lines (for `/trade` in the chat log). */
  summaryLines(): string[] {
    const v = this.view();
    if (!v.open) return ['Bạn không ở trong giao dịch nào. Gõ /trade tên để mời người chơi đứng gần.'];
    const side = (label: string, s: TradeSideRow): string => {
      const parts = s.items.map((l) => `${l.qty}× ${l.name}`);
      s.stones.forEach((n, i) => n > 0 && parts.push(`${n} linh thạch ${STONE_LABELS[i]}`));
      return `${label}: ${parts.length ? parts.join(', ') : '(chưa đặt gì)'}${s.confirmed ? ' [đã xác nhận]' : s.locked ? ' [đã khóa]' : ''}`;
    };
    return [`Giao dịch với ${v.partner}:`, side('  Bạn đưa', v.mine), side(`  ${v.partner} đưa`, v.theirs)];
  }
}
