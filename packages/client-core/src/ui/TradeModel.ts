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
import { reasonTexts, t, type StringKey } from '../i18n/strings.js';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { TradeOp, TradePhase } from '@vgtd/protocol';

/** Text of every trade refusal (user-facing, from the string table; `{range}` / `{max}` = the shared limits). */
export const TRADE_REASON_TEXT: Readonly<Record<number, string>> = reasonTexts(
  {
    [TradeReason.Ok]: null,
    [TradeReason.RateLimited]: 'trade.reason.rate_limited',
    [TradeReason.NotReady]: 'trade.reason.not_ready',
    [TradeReason.NoSuchPlayer]: 'trade.reason.no_such_player',
    [TradeReason.Self]: 'trade.reason.self',
    [TradeReason.TooFar]: 'trade.reason.too_far',
    [TradeReason.AlreadyTrading]: 'trade.reason.already_trading',
    [TradeReason.TargetBusy]: 'trade.reason.target_busy',
    [TradeReason.NoInvite]: 'trade.reason.no_invite',
    [TradeReason.NotTrading]: 'trade.reason.not_trading',
    [TradeReason.BadSlot]: 'trade.reason.bad_slot',
    [TradeReason.NotTradable]: 'trade.reason.not_tradable',
    [TradeReason.TooManyLines]: 'trade.reason.too_many_lines',
    [TradeReason.NotEnough]: 'trade.reason.not_enough',
    [TradeReason.BadAmount]: 'trade.reason.bad_amount',
    [TradeReason.NotLocked]: 'trade.reason.not_locked',
    [TradeReason.ItemsChanged]: 'trade.reason.items_changed',
    [TradeReason.NoSpace]: 'trade.reason.no_space',
    [TradeReason.NotEnoughStones]: 'trade.reason.not_enough_stones',
  },
  () => ({ range: TRADE.RANGE_TILES, max: TRADE.MAX_LINES }),
);

/** Stone labels in `CURRENCIES` order (docs/26 s2.1): `STONE_LABELS[i]`. */
export const STONE_LABELS: Readonly<Record<number, string>> = reasonTexts({
  0: 'trade.stone.ha',
  1: 'trade.stone.trung',
  2: 'trade.stone.thuong',
});

const ITEM_NAME_KEY: Readonly<Record<string, StringKey>> = {
  heal_pill: 'trade.item.heal_pill',
  breakthrough_pill: 'trade.item.breakthrough_pill',
  craft_material: 'trade.item.craft_material',
  blueprint_white_green: 'trade.item.blueprint_white_green',
  blueprint_blue_purple: 'trade.item.blueprint_blue_purple',
  blueprint_gold_red: 'trade.item.blueprint_gold_red',
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

  /** What a bag item is called: the key made readable (names from the string table). */
  itemName(defId: number, quality: number): string {
    const key = itemDefById(defId)?.key;
    const k = key && ITEM_NAME_KEY[key];
    const base = k ? t(k) : (key ?? t('trade.item.unknown', { id: defId }));
    return quality > 0 ? t('trade.item.quality', { base, quality }) : base;
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
    return t('trade.line.invite', { from: m.fromName });
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
      return !was || was.phase !== TradePhase.Open ? t('trade.line.opened', { partner: m.partner }) : null;
    }
    if (m.phase === TradePhase.Done) {
      const tax = m.tax
        .map((n, i) => (n > 0 ? t('trade.stones', { n, kind: STONE_LABELS[i] ?? '' }) : ''))
        .filter(Boolean);
      return tax.length
        ? t('trade.line.done_tax', { partner: m.partner, tax: tax.join(', ') })
        : t('trade.line.done', { partner: m.partner });
    }
    switch (m.closed) {
      case TradeClosed.PartnerLeft:
        return t('trade.line.partner_left', { partner: m.partner || t('trade.partner_unknown') });
      case TradeClosed.Expired:
        return t('trade.line.expired');
      default:
        return t('trade.line.cancelled');
    }
  }

  /** The answer to a command: the line to show when refused, null when done. */
  applyResult(m: TradeResultMsg): string | null {
    if (m.reason === TradeReason.Ok) return null;
    return TRADE_REASON_TEXT[m.reason] ?? t('trade.line.refused', { code: m.reason });
  }

  /** The window as plain lines (for `/trade` in the chat log). */
  summaryLines(): string[] {
    const v = this.view();
    if (!v.open) return [t('trade.summary.none')];
    const side = (label: string, s: TradeSideRow): string => {
      const parts = s.items.map((l) => `${l.qty}× ${l.name}`);
      s.stones.forEach((n, i) => n > 0 && parts.push(t('trade.stones', { n, kind: STONE_LABELS[i] ?? '' })));
      const state = s.confirmed ? t('trade.summary.confirmed') : s.locked ? t('trade.summary.locked') : '';
      return t('trade.summary.side', {
        label,
        items: parts.length ? parts.join(', ') : t('trade.summary.nothing'),
        state,
      });
    };
    return [
      t('trade.summary.head', { partner: v.partner }),
      side(t('trade.summary.you_give'), v.mine),
      side(t('trade.summary.they_give', { partner: v.partner }), v.theirs),
    ];
  }
}
