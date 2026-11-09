/**
 * TradeService (D102, docs/10 §7.1 P4 "Giao dịch trực tiếp (thuế 3%)", docs/26 §5.5): the trade window between two nearby online players.
 *
 *   invite -> accept -> both put item lines (from their bag) and stones in the window -> each LOCKS (step 1) -> each CONFIRMS (step 2,
 *   needs both locked) -> the server executes ONE atomic exchange (`InventoryService.exchange`: items and the 3% taxed stones in a single
 *   all-or-nothing step) -> both get a "done" state.
 *
 * Anti-dupe design:
 *  - items stay in their owner's bag until the executing step, which takes them out of copies of both bags, puts the received ones in,
 *    books the stones in ONE balanced ledger transaction and only then swaps the real bags in: no moment where an item is in two places
 *    or none, so a disconnect, a cancel, an expiry or a crash before the swap leaves everything where it was;
 *  - offers are IDENTITIES (an instance id, or defId + quality + qty), not slot numbers, and are re-checked against the live bag at every
 *    tick and again inside the exchange: an item used, dropped or traded away while it sits in the window is dropped from the window and
 *    both locks are undone;
 *  - any change of either offer (and a lost line) resets BOTH locks and confirmations ("đổi nội dung thì hủy xác nhận");
 *  - a player is in at most one window; the window runs to a `done` flag once, so a double confirm cannot execute twice, and the ledger
 *    key `trade:<id>` would replay it anyway.
 *
 * Authority: the actor is whoever the connection authenticated as; a name only selects the OTHER player, a slot only selects an item of the
 * actor's own bag. Every command takes a rate-limit token BEFORE any name is resolved (anti-enumeration, like whispers and friends).
 * Every `trade_cmd` gets exactly one `trade_result`. In-game currency only: nothing about prices in money, shops, receipts or entitlements.
 */
import { CURRENCIES, TRADE, itemDefById } from '@vgtd/shared';
import {
  TradeClosed,
  TradeOp,
  TradePhase,
  TradeReason,
  type TradeCmdMsg,
  type TradeResultMsg,
  type TradeServerMessage,
  type TradeSideView,
  type TradeStateMsg,
} from '@vgtd/protocol';
import type { ExchangeSide, InventoryService, TradeLine } from '../world/inventory/service.js';
import { TRADE_CONFIG } from './config.js';

export interface TradePeer {
  readonly entityId: number;
  readonly accountId: string;
  /** display name (the unique username) */
  readonly name: string;
}

export interface TradeHost {
  deliver(entityId: number, msg: TradeServerMessage): void;
  /** where the player stands (tile space), undefined when gone */
  posOf(entityId: number): { i: number; j: number } | undefined;
}

export interface TradeServiceOptions {
  inventory: InventoryService;
}

interface Offer {
  items: TradeLine[];
  stones: bigint[];
  locked: boolean;
  confirmed: boolean;
}
interface Session {
  id: number;
  /** the two entity ids, in the order the window was opened (inviter first) */
  ents: [number, number];
  offers: Map<number, Offer>;
  lastChangeMs: number;
  done: boolean;
}
interface Invite {
  from: number;
  expiresAtMs: number;
}
interface Bucket {
  tokens: number;
  at: number;
}

export interface TradeMetrics {
  completed: number;
  cancelled: number;
  invites: number;
  /** a window reset because an offered item / stones were no longer there */
  invalidated: number;
  /** stones taxed away, per currency (`CURRENCIES` order) */
  taxed: bigint[];
  refused: Record<number, number>;
}

const emptyOffer = (): Offer => ({ items: [], stones: CURRENCIES.map(() => 0n), locked: false, confirmed: false });
const U32_MAX = 0xffffffff;
const clampU32 = (v: bigint): number => (v > BigInt(U32_MAX) ? U32_MAX : Number(v));

export class TradeService {
  readonly metrics: TradeMetrics = {
    completed: 0,
    cancelled: 0,
    invites: 0,
    invalidated: 0,
    taxed: CURRENCIES.map(() => 0n),
    refused: {},
  };
  private host: TradeHost | null = null;
  private readonly inv: InventoryService;
  private readonly peers = new Map<number, TradePeer>();
  private readonly byName = new Map<string, number>();
  private readonly sessions = new Map<number, Session>();
  private readonly sessionOf = new Map<number, number>();
  /** target entity -> live invites (oldest first) */
  private readonly invites = new Map<number, Invite[]>();
  private readonly dirty = new Set<number>();
  private readonly buckets = new Map<string, Bucket>();
  private nextId = 1;

  constructor(opts: TradeServiceOptions) {
    this.inv = opts.inventory;
  }

  attach(host: TradeHost): void {
    this.host = host;
  }

  // ------------------------------------------------------------------ peers
  join(peer: TradePeer): void {
    this.peers.set(peer.entityId, peer);
    this.byName.set(peer.name.toLowerCase(), peer.entityId);
  }

  /** A player left the world: their window is cancelled (nothing was moved), their invites vanish. */
  leave(entityId: number): void {
    const p = this.peers.get(entityId);
    if (!p) return;
    const sid = this.sessionOf.get(entityId);
    const s = sid === undefined ? undefined : this.sessions.get(sid);
    if (s) this.close(s, TradeClosed.PartnerLeft, entityId);
    this.invites.delete(entityId);
    for (const [to, list] of this.invites) {
      const kept = list.filter((i) => i.from !== entityId);
      if (kept.length) this.invites.set(to, kept);
      else this.invites.delete(to);
    }
    this.peers.delete(entityId);
    if (this.byName.get(p.name.toLowerCase()) === entityId) this.byName.delete(p.name.toLowerCase());
  }

  // ------------------------------------------------------------------ queries
  inTrade(entityId: number): boolean {
    return this.sessionOf.has(entityId);
  }
  get openWindows(): number {
    return this.sessions.size;
  }

  // ------------------------------------------------------------------ commands
  handle(entityId: number, cmd: TradeCmdMsg, nowMs: number): TradeResultMsg {
    const result = (reason: TradeReason): TradeResultMsg => {
      if (reason !== TradeReason.Ok) this.metrics.refused[reason] = (this.metrics.refused[reason] ?? 0) + 1;
      return { type: 'trade_result', clientMsgId: cmd.clientMsgId, reason };
    };
    const me = this.peers.get(entityId);
    if (!me || !this.host) return result(TradeReason.NotReady);
    // the token is spent BEFORE any name is resolved: the answers below are facts about other players (anti-enumeration)
    if (!this.take(me.accountId, nowMs)) return result(TradeReason.RateLimited);
    this.expire(nowMs);
    switch (cmd.op) {
      case TradeOp.Invite:
        return result(this.invite(me, cmd.name, nowMs));
      case TradeOp.Accept:
        return result(this.accept(me, cmd.name, nowMs));
      case TradeOp.Decline:
        return result(this.decline(me, cmd.name));
      case TradeOp.SetItem:
        return result(this.setItem(me, cmd.slot, cmd.qty, nowMs));
      case TradeOp.SetStones:
        return result(this.setStones(me, cmd.currency, cmd.amount, nowMs));
      case TradeOp.Lock:
        return result(this.lock(me, nowMs));
      case TradeOp.Confirm:
        return result(this.confirm(me, nowMs));
      case TradeOp.Cancel: {
        const s = this.sessionFor(me.entityId);
        if (!s) return result(TradeReason.NotTrading);
        this.close(s, TradeClosed.Cancelled, me.entityId);
        return result(TradeReason.Ok);
      }
      default:
        return result(TradeReason.NotReady);
    }
  }

  private find(name: string): TradePeer | undefined {
    const id = this.byName.get(name.toLowerCase());
    return id === undefined ? undefined : this.peers.get(id);
  }
  private sessionFor(entityId: number): Session | undefined {
    const sid = this.sessionOf.get(entityId);
    return sid === undefined ? undefined : this.sessions.get(sid);
  }
  private near(a: number, b: number): boolean {
    const pa = this.host?.posOf(a);
    const pb = this.host?.posOf(b);
    return !!pa && !!pb && Math.hypot(pa.i - pb.i, pa.j - pb.j) <= TRADE.RANGE_TILES;
  }

  private invite(me: TradePeer, name: string, nowMs: number): TradeReason {
    const target = this.find(name);
    if (!target) return TradeReason.NoSuchPlayer;
    if (target.entityId === me.entityId) return TradeReason.Self;
    if (this.sessionOf.has(me.entityId)) return TradeReason.AlreadyTrading;
    if (this.sessionOf.has(target.entityId)) return TradeReason.TargetBusy;
    if (!this.near(me.entityId, target.entityId)) return TradeReason.TooFar;
    const list = this.invites.get(target.entityId) ?? [];
    if (list.length >= TRADE.MAX_PENDING_INVITES || list.some((i) => i.from === me.entityId))
      return TradeReason.TargetBusy;
    list.push({ from: me.entityId, expiresAtMs: nowMs + TRADE.INVITE_TTL_MS });
    this.invites.set(target.entityId, list);
    this.metrics.invites++;
    this.host!.deliver(target.entityId, { type: 'trade_invite', fromName: me.name, ttlMs: TRADE.INVITE_TTL_MS });
    return TradeReason.Ok;
  }

  /** The live invite `me` is answering: the one from `name`, or the newest when `name` is empty. */
  private pick(me: TradePeer, name: string): { list: Invite[]; at: number } | null {
    const list = this.invites.get(me.entityId) ?? [];
    if (!name) return list.length ? { list, at: list.length - 1 } : null;
    const from = this.find(name);
    const at = from ? list.findIndex((i) => i.from === from.entityId) : -1;
    return at < 0 ? null : { list, at };
  }
  private drop(me: TradePeer, list: Invite[], at: number): Invite {
    const [inv] = list.splice(at, 1);
    if (list.length) this.invites.set(me.entityId, list);
    else this.invites.delete(me.entityId);
    return inv!;
  }

  private accept(me: TradePeer, name: string, nowMs: number): TradeReason {
    if (this.sessionOf.has(me.entityId)) return TradeReason.AlreadyTrading;
    const hit = this.pick(me, name);
    if (!hit) return TradeReason.NoInvite;
    const from = this.peers.get(hit.list[hit.at]!.from);
    if (!from || this.sessionOf.has(from.entityId) || !this.near(from.entityId, me.entityId)) {
      this.drop(me, hit.list, hit.at);
      return from && this.sessionOf.has(from.entityId) ? TradeReason.TargetBusy : TradeReason.NoInvite;
    }
    this.drop(me, hit.list, hit.at);
    const s: Session = {
      id: this.nextId++,
      ents: [from.entityId, me.entityId],
      offers: new Map([
        [from.entityId, emptyOffer()],
        [me.entityId, emptyOffer()],
      ]),
      lastChangeMs: nowMs,
      done: false,
    };
    this.sessions.set(s.id, s);
    this.sessionOf.set(from.entityId, s.id);
    this.sessionOf.set(me.entityId, s.id);
    // anything else pending for either player is moot now
    this.invites.delete(me.entityId);
    this.invites.delete(from.entityId);
    this.dirty.add(s.id);
    return TradeReason.Ok;
  }

  private decline(me: TradePeer, name: string): TradeReason {
    const hit = this.pick(me, name);
    if (!hit) return TradeReason.NoInvite;
    this.drop(me, hit.list, hit.at);
    return TradeReason.Ok;
  }

  /** Any change of an offer undoes BOTH locks and confirmations. */
  private reset(s: Session, nowMs: number): void {
    for (const o of s.offers.values()) {
      o.locked = false;
      o.confirmed = false;
    }
    s.lastChangeMs = nowMs;
    this.dirty.add(s.id);
  }

  private setItem(me: TradePeer, slot: number, qty: number, nowMs: number): TradeReason {
    const s = this.sessionFor(me.entityId);
    if (!s) return TradeReason.NotTrading;
    const offer = s.offers.get(me.entityId)!;
    const bag = this.inv.bagOf(me.accountId);
    const held = slot < bag.capacity ? bag.slots[slot] : undefined;
    if (!held) return TradeReason.BadSlot;
    let line: TradeLine;
    if (held.kind === 'instance') {
      const inst = bag.instances.get(held.id)!;
      const def = itemDefById(inst.defId);
      if (!def || !def.tradable || inst.bound) return TradeReason.NotTradable;
      line = { kind: 'instance', id: inst.id, defId: inst.defId, quality: inst.quality };
      qty = qty > 0 ? 1 : 0;
    } else {
      const def = itemDefById(held.defId);
      if (!def || !def.tradable) return TradeReason.NotTradable;
      if (qty > bag.count(held.defId, held.quality)) return TradeReason.NotEnough;
      line = { kind: 'stack', defId: held.defId, quality: held.quality, qty };
    }
    const same = (l: TradeLine): boolean =>
      l.kind === line.kind &&
      (l.kind === 'instance'
        ? l.id === (line as { id: string }).id
        : l.defId === line.defId && l.quality === line.quality);
    const at = offer.items.findIndex(same);
    if (qty === 0) {
      if (at < 0) return TradeReason.Ok; // nothing to take out: not a change
      offer.items.splice(at, 1);
    } else if (at >= 0) {
      const cur = offer.items[at]!;
      if (cur.kind === 'stack' && line.kind === 'stack' && cur.qty === line.qty) return TradeReason.Ok; // same offer: not a change
      if (cur.kind === 'instance') return TradeReason.Ok; // already offered
      offer.items[at] = line;
    } else {
      if (offer.items.length >= TRADE.MAX_LINES) return TradeReason.TooManyLines;
      offer.items.push(line);
    }
    this.reset(s, nowMs);
    return TradeReason.Ok;
  }

  private setStones(me: TradePeer, currency: number, amount: number, nowMs: number): TradeReason {
    const s = this.sessionFor(me.entityId);
    if (!s) return TradeReason.NotTrading;
    const cur = CURRENCIES[currency];
    if (cur === undefined || !Number.isInteger(amount) || amount < 0) return TradeReason.BadAmount;
    const want = BigInt(amount);
    if (this.inv.wallet(me.accountId, cur) < want) return TradeReason.NotEnough;
    const offer = s.offers.get(me.entityId)!;
    if (offer.stones[currency] === want) return TradeReason.Ok; // not a change
    offer.stones[currency] = want;
    this.reset(s, nowMs);
    return TradeReason.Ok;
  }

  private lock(me: TradePeer, nowMs: number): TradeReason {
    const s = this.sessionFor(me.entityId);
    if (!s) return TradeReason.NotTrading;
    this.revalidate(s, nowMs); // a window whose offer went stale is reset before anyone can lock it
    const o = s.offers.get(me.entityId)!;
    if (!o.locked) {
      o.locked = true;
      o.confirmed = false;
      s.lastChangeMs = nowMs;
      this.dirty.add(s.id);
    }
    return TradeReason.Ok;
  }

  private confirm(me: TradePeer, nowMs: number): TradeReason {
    const s = this.sessionFor(me.entityId);
    if (!s || s.done) return TradeReason.NotTrading;
    if (this.revalidate(s, nowMs)) return TradeReason.ItemsChanged;
    const mine = s.offers.get(me.entityId)!;
    const other = s.offers.get(s.ents[0] === me.entityId ? s.ents[1] : s.ents[0])!;
    if (!mine.locked || !other.locked) return TradeReason.NotLocked;
    if (mine.confirmed) return TradeReason.Ok; // a second confirm is a no-op, never a second execution
    mine.confirmed = true;
    s.lastChangeMs = nowMs;
    this.dirty.add(s.id);
    if (!other.confirmed) return TradeReason.Ok;
    return this.execute(s, nowMs);
  }

  // ------------------------------------------------------------------ execution
  private sideOf(s: Session, entityId: number): ExchangeSide {
    const o = s.offers.get(entityId)!;
    return { owner: this.peers.get(entityId)!.accountId, items: o.items, stones: o.stones };
  }

  private execute(s: Session, nowMs: number): TradeReason {
    if (s.done) return TradeReason.NotTrading;
    const [ea, eb] = s.ents;
    const r = this.inv.exchange(`trade:${s.id}`, this.sideOf(s, ea), this.sideOf(s, eb));
    if (!r.ok) {
      // nothing was applied: drop what is no longer valid, undo both locks, tell the players why
      this.revalidate(s, nowMs);
      this.reset(s, nowMs);
      switch (r.reason) {
        case 'NO_SPACE_A':
        case 'NO_SPACE_B':
          return TradeReason.NoSpace;
        case 'FUNDS_A':
        case 'FUNDS_B':
          return TradeReason.NotEnoughStones;
        case 'NOT_TRADABLE':
          return TradeReason.NotTradable;
        default:
          return TradeReason.ItemsChanged;
      }
    }
    s.done = true;
    this.metrics.completed++;
    r.tax.forEach((t, c) => (this.metrics.taxed[c] = this.metrics.taxed[c]! + t));
    for (const e of s.ents) this.host!.deliver(e, this.stateFor(s, e, TradePhase.Done, TradeClosed.None, r.tax));
    this.end(s);
    return TradeReason.Ok;
  }

  // ------------------------------------------------------------------ validation of the window against the live bags
  /**
   * Drop offered lines that are no longer in the owner's bag (used, dropped, traded away, moved out of a quantity) and stones the owner no
   * longer has; if anything was dropped, undo both locks. Returns true when something changed.
   */
  private revalidate(s: Session, nowMs: number): boolean {
    let changed = false;
    for (const e of s.ents) {
      const p = this.peers.get(e);
      const o = s.offers.get(e)!;
      if (!p) continue;
      const bag = this.inv.bagOf(p.accountId);
      const valid = (l: TradeLine): boolean => {
        if (l.kind === 'instance') return bag.slots.some((sl) => sl?.kind === 'instance' && sl.id === l.id);
        return bag.count(l.defId, l.quality) >= l.qty;
      };
      const kept = o.items.filter(valid);
      if (kept.length !== o.items.length) {
        o.items = kept;
        changed = true;
      }
      CURRENCIES.forEach((cur, c) => {
        const have = this.inv.wallet(p.accountId, cur);
        if (o.stones[c]! > have) {
          o.stones[c] = have;
          changed = true;
        }
      });
    }
    if (changed) {
      this.metrics.invalidated++;
      this.reset(s, nowMs);
    }
    return changed;
  }

  // ------------------------------------------------------------------ closing and output
  private end(s: Session): void {
    this.sessions.delete(s.id);
    this.dirty.delete(s.id);
    for (const e of s.ents) if (this.sessionOf.get(e) === s.id) this.sessionOf.delete(e);
  }

  /** Close a window without executing it: nothing was moved, so nothing needs undoing. `by` is who ended it (told nothing about it twice). */
  private close(s: Session, why: TradeClosed, by: number | null): void {
    if (s.done) return;
    s.done = true;
    this.metrics.cancelled++;
    for (const e of s.ents) {
      if (e === by && why === TradeClosed.PartnerLeft) continue; // the one who left gets nothing
      this.host?.deliver(e, this.stateFor(s, e, TradePhase.Closed, why));
    }
    this.end(s);
  }

  private view(o: Offer): TradeSideView {
    return {
      items: o.items.map((l) => ({ defId: l.defId, quality: l.quality, qty: l.kind === 'stack' ? l.qty : 1 })),
      stones: o.stones.map(clampU32),
      locked: o.locked,
      confirmed: o.confirmed,
    };
  }
  private stateFor(
    s: Session,
    viewer: number,
    phase: TradePhase,
    closed: TradeClosed,
    tax: readonly bigint[] = CURRENCIES.map(() => 0n),
  ): TradeStateMsg {
    const other = s.ents[0] === viewer ? s.ents[1] : s.ents[0];
    return {
      type: 'trade_state',
      phase,
      closed,
      partner: this.peers.get(other)?.name ?? '',
      mine: this.view(s.offers.get(viewer)!),
      theirs: this.view(s.offers.get(other)!),
      tax: tax.map(clampU32),
    };
  }

  /**
   * Called every world tick: expires invites, cancels windows idle for `TRADE.IDLE_MS`, re-checks every open window against the live bags
   * (an item used or dropped in the meantime leaves the window and undoes the locks) and sends each changed window's state to both players.
   */
  tick(nowMs: number): void {
    if (!this.host) return;
    this.expire(nowMs);
    for (const s of [...this.sessions.values()]) {
      if (nowMs - s.lastChangeMs >= TRADE.IDLE_MS) {
        this.close(s, TradeClosed.Expired, null);
        continue;
      }
      this.revalidate(s, nowMs);
    }
    if (this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (!s) continue;
      for (const e of s.ents) this.host.deliver(e, this.stateFor(s, e, TradePhase.Open, TradeClosed.None));
    }
  }

  private expire(nowMs: number): void {
    for (const [to, list] of this.invites) {
      const live = list.filter((i) => i.expiresAtMs > nowMs);
      if (live.length === list.length) continue;
      if (live.length) this.invites.set(to, live);
      else this.invites.delete(to);
    }
  }

  /** Token bucket per account: `burst` tokens, one refilled every `refillMs`. */
  private take(accountId: string, nowMs: number): boolean {
    const { refillMs, burst } = TRADE_CONFIG.RATE;
    const b = this.buckets.get(accountId) ?? { tokens: burst, at: nowMs };
    b.tokens = Math.min(burst, b.tokens + Math.max(0, nowMs - b.at) / refillMs);
    b.at = nowMs;
    this.buckets.set(accountId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
