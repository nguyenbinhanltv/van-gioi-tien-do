/**
 * SectService (D98, docs/10 §7.1 P4 "Tông môn NPC: gia nhập, Cống hiến, kho bí tịch"): the NPC sect "Sơn Môn Đại Phái".
 *
 *  - join / leave: only while standing near the sect NPC (`SECT.NPC_RANGE_TILES`); no player-made sects;
 *  - Cống hiến (`CONG_HIEN`): an in-game currency in the DOUBLE-ENTRY ledger (docs/26), the same rules as the stones: every credit and
 *    debit is a balanced, logged transaction (kill reward: `SYSTEM_FAUCET_SECT_KILL` -> wallet; purchase: wallet -> `SYSTEM_SINK_SECT_LIBRARY`),
 *    a wallet never goes below 0, a transaction key replays instead of applying twice. Never transferable: nothing here moves it between players;
 *  - earned per kill while a member (rates in `SECT.KILL_REWARD`, provisional), spent in the library on the manuals of the character's class
 *    (`libraryOf`), each bought at most once;
 *  - membership and bought manuals persist through `SectStore` (the file store of D92); the balance through the ledger's own store.
 *
 * Authority: the actor is whoever the connection authenticated as. Every `sect_cmd` gets exactly one `sect_result`. Every command takes a
 * rate-limit token first. Output goes through the host: a `sect_state` to every live session of an account whenever something changed,
 * coalesced per tick (a kill streak is one message per tick).
 */
import { SECT, type DropSource, type PathId } from '@vgtd/shared';
import {
  LIMITS,
  SectOp,
  SectReason,
  type SectCmdMsg,
  type SectResultMsg,
  type SectServerMessage,
  type SectStateMsg,
} from '@vgtd/protocol';
import { Ledger, LedgerError, type AccountRef } from '../world/inventory/ledger.js';
import { SECT_CONFIG } from './config.js';
import { libraryOf } from './library.js';
import { InMemorySectStore, type SectSnapshot, type SectStore } from './store.js';

export interface SectPeer {
  readonly entityId: number;
  readonly accountId: string;
  /** the character's class; undefined before it is known (then the library is empty) */
  readonly path: PathId | undefined;
}

export interface SectHost {
  deliver(entityId: number, msg: SectServerMessage): void;
  /** where the player stands (tile space), undefined when gone */
  posOf(entityId: number): { i: number; j: number } | undefined;
  /** where the NPC stands when the options do not say: the middle of the spawn area */
  readonly defaultNpc: { i: number; j: number };
}

export interface SectServiceOptions {
  /** the world's ledger (shared with the inventory so one `ledger.json` holds stones and Cống hiến) */
  ledger: Ledger;
  store?: SectStore;
  /** where the sect NPC stands (tile space); default: the middle of the spawn area (the host decides) */
  npc?: { i: number; j: number };
}

interface Bucket {
  tokens: number;
  at: number;
}

export interface SectMetrics {
  joined: number;
  left: number;
  bought: number;
  /** Cống hiến credited for kills since start */
  earned: number;
  refused: Record<number, number>;
  /** kill rewards that failed to post (never expected; the tick must not die) */
  rewardErrors: number;
}

const wallet = (accountId: string): AccountRef => ({
  kind: 'PLAYER_WALLET',
  ownerId: accountId,
  currency: SECT.CURRENCY,
});
const faucet: AccountRef = { kind: 'SYSTEM_FAUCET_SECT_KILL', ownerId: null, currency: SECT.CURRENCY };
const sink: AccountRef = { kind: 'SYSTEM_SINK_SECT_LIBRARY', ownerId: null, currency: SECT.CURRENCY };

const U32_MAX = 0xffffffff;

export class SectService {
  readonly metrics: SectMetrics = { joined: 0, left: 0, bought: 0, earned: 0, refused: {}, rewardErrors: 0 };
  readonly ledger: Ledger;
  private host: SectHost | null = null;
  private readonly store: SectStore;
  private npc: { i: number; j: number } | undefined;
  private readonly members = new Set<string>();
  /** account -> skill ids bought */
  private readonly manuals = new Map<string, Set<string>>();
  private readonly peers = new Map<number, SectPeer>();
  /** account -> live sessions (entity ids, ascending) */
  private readonly sessions = new Map<string, number[]>();
  private readonly dirty = new Set<string>();
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: SectServiceOptions) {
    this.ledger = opts.ledger;
    this.store = opts.store ?? new InMemorySectStore();
    this.npc = opts.npc;
    const s = this.store.load();
    if (s) {
      for (const a of s.members) this.members.add(a);
      for (const [a, skill] of s.manuals) this.ownedSet(a).add(skill);
    }
  }

  attach(host: SectHost): void {
    this.host = host;
    this.npc ??= host.defaultNpc;
  }

  /** Where the sect NPC stands (known once attached to a host). */
  get npcAt(): { i: number; j: number } {
    return this.npc ?? { i: 0, j: 0 };
  }

  // ------------------------------------------------------------------ persistence
  snapshot(): SectSnapshot {
    const manuals: [string, string][] = [];
    for (const [a, set] of [...this.manuals].sort((x, y) => (x[0] < y[0] ? -1 : 1)))
      for (const m of [...set].sort()) manuals.push([a, m]);
    return { members: [...this.members].sort(), manuals };
  }
  private persist(): void {
    this.store.save(this.snapshot());
  }
  private ownedSet(accountId: string): Set<string> {
    let s = this.manuals.get(accountId);
    if (!s) {
      s = new Set();
      this.manuals.set(accountId, s);
    }
    return s;
  }

  // ------------------------------------------------------------------ queries
  isMember(accountId: string): boolean {
    return this.members.has(accountId);
  }
  owns(accountId: string, skillId: string): boolean {
    return this.manuals.get(accountId)?.has(skillId) ?? false;
  }
  /** Cống hiến balance (bigint from the ledger). */
  contribution(accountId: string): bigint {
    return this.ledger.balance(wallet(accountId));
  }
  stateOf(accountId: string, path: PathId | undefined): SectStateMsg {
    const bal = this.contribution(accountId);
    const owned = this.manuals.get(accountId);
    return {
      type: 'sect_state',
      member: this.members.has(accountId),
      contribution: bal > BigInt(U32_MAX) ? U32_MAX : Number(bal),
      npcQi: Math.min(LIMITS.POS_MAX_Q, Math.max(0, Math.round(this.npcAt.i * LIMITS.POS_SCALE))),
      npcQj: Math.min(LIMITS.POS_MAX_Q, Math.max(0, Math.round(this.npcAt.j * LIMITS.POS_SCALE))),
      library: path
        ? libraryOf(path).map((m) => ({
            name: m.name,
            levelMin: m.levelMin,
            price: m.price,
            owned: owned?.has(m.skillId) ?? false,
          }))
        : [],
    };
  }

  // ------------------------------------------------------------------ sessions
  join(peer: SectPeer): void {
    this.peers.set(peer.entityId, peer);
    const list = this.sessions.get(peer.accountId) ?? [];
    list.push(peer.entityId);
    list.sort((a, b) => a - b);
    this.sessions.set(peer.accountId, list);
    this.dirty.add(peer.accountId); // the joining session gets its state at the next tick
  }
  leave(entityId: number): void {
    const p = this.peers.get(entityId);
    if (!p) return;
    this.peers.delete(entityId);
    const list = (this.sessions.get(p.accountId) ?? []).filter((e) => e !== entityId);
    if (list.length) this.sessions.set(p.accountId, list);
    else this.sessions.delete(p.accountId);
  }

  // ------------------------------------------------------------------ commands
  handle(entityId: number, cmd: SectCmdMsg, nowMs: number): SectResultMsg {
    const result = (reason: SectReason): SectResultMsg => {
      if (reason !== SectReason.Ok) this.metrics.refused[reason] = (this.metrics.refused[reason] ?? 0) + 1;
      return { type: 'sect_result', clientMsgId: cmd.clientMsgId, reason };
    };
    const me = this.peers.get(entityId);
    if (!me || !this.host) return result(SectReason.NotReady);
    if (!this.take(me.accountId, nowMs)) return result(SectReason.RateLimited);
    const at = this.host.posOf(entityId);
    if (!at) return result(SectReason.NotReady);
    if (Math.hypot(at.i - this.npcAt.i, at.j - this.npcAt.j) > SECT.NPC_RANGE_TILES) return result(SectReason.TooFar);
    switch (cmd.op) {
      case SectOp.Join:
        return result(this.joinSect(me));
      case SectOp.Leave:
        return result(this.leaveSect(me));
      case SectOp.Buy:
        return result(this.buy(me, cmd.manual));
      default:
        return result(SectReason.NotReady);
    }
  }

  private joinSect(me: SectPeer): SectReason {
    if (this.members.has(me.accountId)) return SectReason.AlreadyMember;
    this.members.add(me.accountId);
    this.metrics.joined++;
    this.dirty.add(me.accountId);
    this.persist();
    return SectReason.Ok;
  }

  /** Leaving keeps the Cống hiến balance and the manuals already bought (docs are silent: PROVISIONAL, D98); it stops earning and buying. */
  private leaveSect(me: SectPeer): SectReason {
    if (!this.members.delete(me.accountId)) return SectReason.NotMember;
    this.metrics.left++;
    this.dirty.add(me.accountId);
    this.persist();
    return SectReason.Ok;
  }

  private buy(me: SectPeer, index: number): SectReason {
    if (!this.members.has(me.accountId)) return SectReason.NotMember;
    const manual = me.path ? libraryOf(me.path)[index] : undefined;
    if (!manual) return SectReason.NoSuchManual;
    if (this.owns(me.accountId, manual.skillId)) return SectReason.AlreadyOwned;
    const price = BigInt(manual.price);
    if (this.contribution(me.accountId) < price) return SectReason.NotEnoughContribution;
    try {
      // one balanced transaction: wallet -> library sink. The key is per (account, manual), so a retry replays instead of charging twice.
      this.ledger.post({
        reason: 'SECT_PURCHASE',
        idempotencyKey: `sect:buy:${me.accountId}:${manual.skillId}`,
        entries: [
          { account: wallet(me.accountId), delta: -price },
          { account: sink, delta: price },
        ],
      });
    } catch (e) {
      if (e instanceof LedgerError && e.code === 'INSUFFICIENT_FUNDS') return SectReason.NotEnoughContribution;
      throw e;
    }
    this.ownedSet(me.accountId).add(manual.skillId);
    this.metrics.bought++;
    this.dirty.add(me.accountId);
    this.persist();
    return SectReason.Ok;
  }

  // ------------------------------------------------------------------ kills
  /**
   * A member's kill pays Cống hiến by drop source (`SECT.KILL_REWARD`). `killKey` identifies the kill (`mobId@tick` per account), so a
   * repeated event replays instead of paying twice. Not a member, or a reward of 0: nothing. Never throws (a kill must not break the tick).
   */
  onKill(accountId: string, source: DropSource, killKey: string): void {
    if (!this.members.has(accountId)) return;
    const amount = BigInt(SECT.KILL_REWARD[source] ?? 0);
    if (amount <= 0n) return;
    try {
      const r = this.ledger.post({
        reason: 'SECT_REWARD',
        idempotencyKey: `sect:kill:${accountId}|${killKey}`,
        entries: [
          { account: faucet, delta: -amount },
          { account: wallet(accountId), delta: amount },
        ],
      });
      if (!r.replayed) {
        this.metrics.earned += Number(amount);
        this.dirty.add(accountId);
      }
    } catch {
      this.metrics.rewardErrors++;
    }
  }

  // ------------------------------------------------------------------ output
  /** Called every world tick: sends each changed account's `sect_state` to its live sessions (one message per session per tick). */
  tick(): void {
    if (!this.host || this.dirty.size === 0) return;
    const accounts = [...this.dirty];
    this.dirty.clear();
    for (const a of accounts) {
      for (const e of this.sessions.get(a) ?? []) {
        const peer = this.peers.get(e);
        if (peer) this.host.deliver(e, this.stateOf(a, peer.path));
      }
    }
  }

  /** Token bucket per account: `burst` tokens, one refilled every `refillMs`. */
  private take(accountId: string, nowMs: number): boolean {
    const { refillMs, burst } = SECT_CONFIG.RATE;
    const b = this.buckets.get(accountId) ?? { tokens: burst, at: nowMs };
    b.tokens = Math.min(burst, b.tokens + Math.max(0, nowMs - b.at) / refillMs);
    b.at = nowMs;
    this.buckets.set(accountId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
