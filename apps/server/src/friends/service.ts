/**
 * FriendService (D96, docs/10 §7.1 P4 "bạn bè"): friend requests (send / accept / decline), removal, and the friend list with online status.
 *
 * Friendship is between ACCOUNTS and persisted through `FriendStore` (the file store of D92 keeps it across restarts); online status and
 * the class shown next to a friend come from the live sessions the host reports with `join` / `leave`. Nothing here trusts a client: the
 * actor is whoever the connection authenticated as, a name only selects the OTHER account.
 *
 * Anti-enumeration (same rule as the chat fix #247): every command takes a rate-limit token BEFORE any name is resolved, so the
 * `NoSuchPlayer` / `AlreadyFriends` / ... answers (which say something about other accounts) can never be probed at line rate. Every
 * `friend_cmd` gets exactly one `friend_result`.
 *
 * Output goes through the host: a fresh `friend_state` (friends + requests received + requests sent) to every live session of an account
 * whenever something changed for it. Changes are coalesced per tick (`tick()`), so a login storm of someone with many friends costs each
 * friend one message, not one per event. Time only enters through the rate limiter (the simulation clock handed in by `WorldNode`).
 */
import { FRIENDS } from '@vgtd/shared';
import {
  FriendOp,
  FriendReason,
  type FriendCmdMsg,
  type FriendEntry,
  type FriendResultMsg,
  type FriendServerMessage,
  type FriendStateMsg,
} from '@vgtd/protocol';
import { FRIENDS_CONFIG } from './config.js';
import { InMemoryFriendStore, type FriendSnapshot, type FriendStore } from './store.js';

export interface FriendPeer {
  readonly entityId: number;
  readonly accountId: string;
  /** display name (the unique username) */
  readonly name: string;
  /** class wire id (1..6) */
  readonly classId: number;
}

export interface FriendHost {
  deliver(entityId: number, msg: FriendServerMessage): void;
}

/** Who exists: the account directory (the auth store). Names are matched case-insensitively. */
export interface AccountDirectory {
  /** account id of a lower-cased username, undefined when there is no such account */
  idOf(nameLower: string): string | undefined;
  nameOf(accountId: string): string | undefined;
}

export interface FriendServiceOptions {
  store?: FriendStore;
  directory: AccountDirectory;
}

interface Bucket {
  tokens: number;
  at: number;
}

export interface FriendMetrics {
  /** friendships created / removed since start */
  made: number;
  removed: number;
  requests: number;
  refused: Record<number, number>;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

export class FriendService {
  readonly metrics: FriendMetrics = { made: 0, removed: 0, requests: 0, refused: {} };
  private host: FriendHost | null = null;
  private readonly store: FriendStore;
  private readonly dir: AccountDirectory;
  /** account -> its friends (symmetric) */
  private readonly friends = new Map<string, Set<string>>();
  /** account -> requests it has received (requester ids, oldest first) and sent (target ids, oldest first) */
  private readonly incoming = new Map<string, string[]>();
  private readonly outgoing = new Map<string, string[]>();
  private readonly peers = new Map<number, FriendPeer>();
  /** account -> its live sessions (entity ids, ascending) */
  private readonly sessions = new Map<string, number[]>();
  /** accounts whose `friend_state` must be (re)sent at the next tick */
  private readonly dirty = new Set<string>();
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: FriendServiceOptions) {
    this.store = opts.store ?? new InMemoryFriendStore();
    this.dir = opts.directory;
    this.restore(this.store.load());
  }

  attach(host: FriendHost): void {
    this.host = host;
  }

  // ------------------------------------------------------------------ persistence
  private restore(s: FriendSnapshot | undefined): void {
    if (!s) return;
    for (const [a, b] of s.friends) if (a !== b) this.addFriendship(a, b);
    for (const [from, to] of s.requests) {
      if (from === to || this.friendsOf(from).has(to)) continue;
      if (this.outgoing.get(from)?.includes(to)) continue;
      this.push(this.outgoing, from, to);
      this.push(this.incoming, to, from);
    }
  }

  /** Everything that must survive a restart (presence does not). Stable order, so an unchanged state is an unchanged document. */
  snapshot(): FriendSnapshot {
    const pairs = new Set<string>();
    const friends: [string, string][] = [];
    for (const [a, set] of [...this.friends].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      for (const b of [...set].sort()) {
        const k = pairKey(a, b);
        if (pairs.has(k)) continue;
        pairs.add(k);
        friends.push(a < b ? [a, b] : [b, a]);
      }
    }
    const requests: [string, string][] = [];
    for (const [from, tos] of [...this.outgoing].sort((x, y) => (x[0] < y[0] ? -1 : 1)))
      for (const to of tos) requests.push([from, to]);
    return { friends, requests };
  }
  private persist(): void {
    this.store.save(this.snapshot());
  }

  // ------------------------------------------------------------------ small helpers
  private friendsOf(a: string): Set<string> {
    let s = this.friends.get(a);
    if (!s) {
      s = new Set();
      this.friends.set(a, s);
    }
    return s;
  }
  private push(m: Map<string, string[]>, key: string, v: string): void {
    const l = m.get(key);
    if (l) l.push(v);
    else m.set(key, [v]);
  }
  private pull(m: Map<string, string[]>, key: string, v: string): boolean {
    const l = m.get(key);
    const at = l ? l.indexOf(v) : -1;
    if (!l || at < 0) return false;
    l.splice(at, 1);
    if (l.length === 0) m.delete(key);
    return true;
  }
  private addFriendship(a: string, b: string): void {
    this.friendsOf(a).add(b);
    this.friendsOf(b).add(a);
  }
  private dropRequest(from: string, to: string): boolean {
    const a = this.pull(this.outgoing, from, to);
    const b = this.pull(this.incoming, to, from);
    return a || b;
  }
  private isOnline(accountId: string): boolean {
    return (this.sessions.get(accountId)?.length ?? 0) > 0;
  }
  private classOf(accountId: string): number {
    const first = this.sessions.get(accountId)?.[0];
    return first === undefined ? 0 : (this.peers.get(first)?.classId ?? 0);
  }
  private markDirty(...accounts: string[]): void {
    for (const a of accounts) this.dirty.add(a);
  }

  // ------------------------------------------------------------------ sessions
  join(peer: FriendPeer): void {
    this.peers.set(peer.entityId, peer);
    const list = this.sessions.get(peer.accountId) ?? [];
    const first = list.length === 0;
    list.push(peer.entityId);
    list.sort((a, b) => a - b);
    this.sessions.set(peer.accountId, list);
    // the joining session gets its list; the friends see the status change (only when the account just came online)
    this.markDirty(peer.accountId);
    if (first) this.markDirty(...this.friendsOf(peer.accountId));
  }

  leave(entityId: number): void {
    const p = this.peers.get(entityId);
    if (!p) return;
    this.peers.delete(entityId);
    const list = (this.sessions.get(p.accountId) ?? []).filter((e) => e !== entityId);
    if (list.length) this.sessions.set(p.accountId, list);
    else {
      this.sessions.delete(p.accountId);
      this.markDirty(...this.friendsOf(p.accountId));
    }
  }

  // ------------------------------------------------------------------ queries
  isFriend(accountA: string, accountB: string): boolean {
    return this.friends.get(accountA)?.has(accountB) ?? false;
  }
  friendCount(accountId: string): number {
    return this.friends.get(accountId)?.size ?? 0;
  }
  /** The `friend_state` this account would be sent now. */
  stateOf(accountId: string): FriendStateMsg {
    const friends: FriendEntry[] = [];
    for (const f of this.friends.get(accountId) ?? []) {
      const name = this.dir.nameOf(f);
      if (name === undefined) continue; // the account is gone
      const online = this.isOnline(f);
      friends.push({ name, classId: online ? this.classOf(f) : 0, online });
    }
    const names = (ids: readonly string[] | undefined): string[] =>
      (ids ?? []).map((id) => this.dir.nameOf(id)).filter((n): n is string => n !== undefined);
    return {
      type: 'friend_state',
      friends,
      incoming: names(this.incoming.get(accountId)),
      outgoing: names(this.outgoing.get(accountId)),
    };
  }

  // ------------------------------------------------------------------ commands
  handle(entityId: number, cmd: FriendCmdMsg, nowMs: number): FriendResultMsg {
    const result = (reason: FriendReason): FriendResultMsg => {
      if (reason !== FriendReason.Ok) this.metrics.refused[reason] = (this.metrics.refused[reason] ?? 0) + 1;
      return { type: 'friend_result', clientMsgId: cmd.clientMsgId, reason };
    };
    const me = this.peers.get(entityId);
    if (!me || !this.host) return result(FriendReason.NotReady);
    // the token is spent BEFORE any name is resolved: the answers below are facts about other accounts (anti-enumeration, #247)
    if (!this.take(me.accountId, nowMs)) return result(FriendReason.RateLimited);
    switch (cmd.op) {
      case FriendOp.Request:
        return result(this.request(me, cmd.name));
      case FriendOp.Accept:
        return result(this.accept(me, cmd.name));
      case FriendOp.Decline:
        return result(this.decline(me, cmd.name));
      case FriendOp.Remove:
        return result(this.remove(me, cmd.name));
      default:
        return result(FriendReason.NotReady);
    }
  }

  private resolve(name: string): string | undefined {
    return this.dir.idOf(name.toLowerCase());
  }

  /** Make `a` and `b` friends, if both lists have room. */
  private befriend(a: string, b: string): FriendReason {
    if (this.friendsOf(a).size >= FRIENDS.MAX_FRIENDS) return FriendReason.FriendListFull;
    if (this.friendsOf(b).size >= FRIENDS.MAX_FRIENDS) return FriendReason.TargetListFull;
    this.dropRequest(a, b);
    this.dropRequest(b, a);
    this.addFriendship(a, b);
    this.metrics.made++;
    this.markDirty(a, b);
    this.persist();
    return FriendReason.Ok;
  }

  private request(me: FriendPeer, name: string): FriendReason {
    const id = this.resolve(name);
    if (id === undefined) return FriendReason.NoSuchPlayer;
    if (id === me.accountId) return FriendReason.Self;
    if (this.isFriend(me.accountId, id)) return FriendReason.AlreadyFriends;
    if (this.outgoing.get(me.accountId)?.includes(id)) return FriendReason.AlreadyRequested;
    // they already asked me: asking back is accepting
    if (this.incoming.get(me.accountId)?.includes(id)) return this.befriend(me.accountId, id);
    if (this.friendsOf(me.accountId).size >= FRIENDS.MAX_FRIENDS) return FriendReason.FriendListFull;
    if ((this.outgoing.get(me.accountId)?.length ?? 0) >= FRIENDS.MAX_OUTGOING) return FriendReason.TooManyRequests;
    if ((this.incoming.get(id)?.length ?? 0) >= FRIENDS.MAX_INCOMING || this.friendsOf(id).size >= FRIENDS.MAX_FRIENDS)
      return FriendReason.TargetListFull;
    this.push(this.outgoing, me.accountId, id);
    this.push(this.incoming, id, me.accountId);
    this.metrics.requests++;
    this.markDirty(me.accountId, id);
    this.persist();
    return FriendReason.Ok;
  }

  /** The requester `me` answers: the one called `name`, or the oldest when `name` is empty. */
  private pick(me: FriendPeer, name: string): string | undefined {
    const list = this.incoming.get(me.accountId) ?? [];
    if (!name) return list[0];
    const id = this.resolve(name);
    return id !== undefined && list.includes(id) ? id : undefined;
  }

  private accept(me: FriendPeer, name: string): FriendReason {
    const from = this.pick(me, name);
    if (from === undefined) return FriendReason.NoRequest;
    return this.befriend(me.accountId, from);
  }

  private decline(me: FriendPeer, name: string): FriendReason {
    const from = this.pick(me, name);
    if (from === undefined) return FriendReason.NoRequest;
    this.dropRequest(from, me.accountId);
    this.markDirty(me.accountId, from);
    this.persist();
    return FriendReason.Ok;
  }

  private remove(me: FriendPeer, name: string): FriendReason {
    const id = this.resolve(name);
    if (id === undefined) return FriendReason.NoSuchPlayer;
    if (id === me.accountId) return FriendReason.Self;
    if (this.isFriend(me.accountId, id)) {
      this.friendsOf(me.accountId).delete(id);
      this.friendsOf(id).delete(me.accountId);
      this.metrics.removed++;
      this.markDirty(me.accountId, id);
      this.persist();
      return FriendReason.Ok;
    }
    // not a friend: withdraw a request I sent
    if (this.outgoing.get(me.accountId)?.includes(id)) {
      this.dropRequest(me.accountId, id);
      this.markDirty(me.accountId, id);
      this.persist();
      return FriendReason.Ok;
    }
    return FriendReason.NotFriends;
  }

  // ------------------------------------------------------------------ output
  /** Called every world tick: sends each changed account's `friend_state` to its live sessions (one message per session per tick). */
  tick(): void {
    if (!this.host || this.dirty.size === 0) return;
    const accounts = [...this.dirty];
    this.dirty.clear();
    for (const a of accounts) {
      const sessions = this.sessions.get(a);
      if (!sessions?.length) continue;
      const msg = this.stateOf(a);
      for (const e of sessions) this.host.deliver(e, msg);
    }
  }

  /** Token bucket per account: `burst` tokens, one refilled every `refillMs`. */
  private take(accountId: string, nowMs: number): boolean {
    const { refillMs, burst } = FRIENDS_CONFIG.RATE;
    const b = this.buckets.get(accountId) ?? { tokens: burst, at: nowMs };
    b.tokens = Math.min(burst, b.tokens + Math.max(0, nowMs - b.at) / refillMs);
    b.at = nowMs;
    this.buckets.set(accountId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
