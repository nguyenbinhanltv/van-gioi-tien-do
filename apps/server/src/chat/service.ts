/**
 * ChatService (docs/22 §7): World, Zone and Whisper channels. Authority: the sender is whoever the connection authenticated as (the client
 * never names a sender); the server sanitises, filters, rate-limits and mutes, then fans the line out. Time is the simulation clock passed
 * in by the caller (`WorldNode`), never the wall clock, so behaviour is reproducible in tests.
 *
 * Every `chat_send` gets exactly one `chat_result` (0 = delivered); a refused line is never silent. A whisper answer never reveals whether a
 * name exists: offline and unknown are the same `NoSuchPlayer`.
 *
 * Persistence: the World and Zone channels are not stored (docs/22 §7); a ring of the last lines is kept in RAM for `history`. Whispers are
 * not stored either yet (the 30-day `chat_messages` table is OPEN-ITEMS 20).
 */
import { AOI, toUW } from '@vgtd/shared';
import {
  CHAT_LIMITS,
  ChatChannel,
  ChatReason,
  type ChatLine,
  type ChatMsgMsg,
  type ChatResultMsg,
  type ChatSendMsg,
} from '@vgtd/protocol';
import { CHAT_CONFIG } from './config.js';
import { maskBanned, sanitize } from './filter.js';

export interface ChatPeer {
  readonly entityId: number;
  readonly accountId: string;
  /** display / whisper name (the unique username) */
  readonly name: string;
}

export interface ChatOptions {
  /** banned words (default: the placeholder list in config; the real list is a moderation decision) */
  bannedWords?: readonly string[];
  /** lines kept for the World channel history ring (default `CHAT_CONFIG.HISTORY_RING`) */
  historyRing?: number;
}

/** What the world node provides: where a player is (for the Zone channel) and how to deliver a line to a player. */
export interface ChatHost {
  deliver(entityId: number, msg: ChatMsgMsg): void;
  /** tile position of a player, undefined when gone */
  posOf(entityId: number): { i: number; j: number } | undefined;
  /** members of the party `entityId` is in (itself included), `[]` when in none: the Party channel's audience (D92) */
  partyMembers?(entityId: number): readonly number[];
}

interface Bucket {
  tokens: number;
  at: number;
}
type RateKind = keyof typeof CHAT_CONFIG.RATE;

export interface ChatMetrics {
  delivered: Record<number, number>;
  refused: Record<number, number>;
}

export class ChatService {
  readonly metrics: ChatMetrics = { delivered: {}, refused: {} };
  private host: ChatHost | null = null;
  private readonly peers = new Map<number, ChatPeer>();
  private readonly byName = new Map<string, number>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly mutes = new Map<string, number>();
  private readonly ring: ChatLine[] = [];
  private readonly banned: readonly string[];
  private readonly ringMax: number;

  constructor(opts: ChatOptions = {}) {
    this.banned = opts.bannedWords ?? CHAT_CONFIG.PLACEHOLDER_BANNED;
    this.ringMax = opts.historyRing ?? CHAT_CONFIG.HISTORY_RING;
  }

  attach(host: ChatHost): void {
    this.host = host;
  }

  // ------------------------------------------------------------------ peers
  join(peer: ChatPeer): void {
    this.peers.set(peer.entityId, peer);
    this.byName.set(peer.name.toLowerCase(), peer.entityId);
  }
  leave(entityId: number): void {
    const p = this.peers.get(entityId);
    if (!p) return;
    this.peers.delete(entityId);
    if (this.byName.get(p.name.toLowerCase()) === entityId) this.byName.delete(p.name.toLowerCase());
  }
  has(entityId: number): boolean {
    return this.peers.has(entityId);
  }

  // ------------------------------------------------------------------ moderation
  /** Mute an account until `untilMs` (sim time); `Infinity` = until unmuted. */
  mute(accountId: string, untilMs: number): void {
    this.mutes.set(accountId, untilMs);
  }
  unmute(accountId: string): void {
    this.mutes.delete(accountId);
  }
  isMuted(accountId: string, nowMs: number): boolean {
    const until = this.mutes.get(accountId);
    if (until === undefined) return false;
    if (nowMs >= until) {
      this.mutes.delete(accountId);
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ history
  /** The most recent World lines, oldest first (what a joining player sees). */
  history(n: number = CHAT_CONFIG.HISTORY_ON_JOIN): ChatLine[] {
    return this.ring.slice(-Math.min(n, CHAT_LIMITS.MAX_HISTORY));
  }

  // ------------------------------------------------------------------ sending
  /** Handle one `chat_send` from a joined player; returns the `chat_result` to send back. Deliveries go through the host. */
  handle(entityId: number, msg: ChatSendMsg, nowMs: number): ChatResultMsg {
    const result = (reason: ChatReason): ChatResultMsg => {
      if (reason !== ChatReason.Ok) this.metrics.refused[reason] = (this.metrics.refused[reason] ?? 0) + 1;
      return { type: 'chat_result', clientMsgId: msg.clientMsgId, reason };
    };
    const peer = this.peers.get(entityId);
    if (!peer || !this.host) return result(ChatReason.NotReady);
    const kind = this.kindOf(msg.channel);
    if (!kind) return result(ChatReason.BadChannel); // unknown channel
    if (this.isMuted(peer.accountId, nowMs)) return result(ChatReason.Muted);

    const text = maskBanned(sanitize(msg.text), this.banned);
    if (!text) return result(ChatReason.Empty);
    if (new TextEncoder().encode(text).length > CHAT_LIMITS.MAX_TEXT_BYTES) return result(ChatReason.TooLong);

    // the Party channel needs a party (checked before a token is spent, like a whisper target)
    let partyAudience: readonly number[] = [];
    if (msg.channel === ChatChannel.Party) {
      partyAudience = this.host.partyMembers?.(entityId) ?? [];
      if (!partyAudience.includes(entityId)) return result(ChatReason.NotInParty);
    }
    // validate the target BEFORE spending a token: a typo in a whisper name should not cost the player a message
    let target: ChatPeer | undefined;
    if (msg.channel === ChatChannel.Whisper) {
      const id = this.byName.get(msg.target.toLowerCase());
      target = id === undefined ? undefined : this.peers.get(id);
      if (!target) return result(ChatReason.NoSuchPlayer);
      if (target.entityId === entityId) return result(ChatReason.SelfWhisper);
    }
    if (!this.take(peer.accountId, kind, nowMs)) return result(ChatReason.RateLimited);

    const line: ChatLine = {
      channel: msg.channel,
      senderId: entityId,
      senderName: peer.name,
      toName: target ? target.name : '',
      ts: nowMs >>> 0,
      text,
    };
    const out: ChatMsgMsg = { type: 'chat_msg', ...line };
    if (target) {
      this.host.deliver(target.entityId, out);
      this.host.deliver(entityId, out); // the sender's echo ("me -> target")
    } else if (msg.channel === ChatChannel.Party) {
      for (const id of partyAudience) this.host.deliver(id, out);
    } else if (msg.channel === ChatChannel.World) {
      this.ring.push(line);
      if (this.ring.length > this.ringMax) this.ring.splice(0, this.ring.length - this.ringMax);
      for (const id of this.peers.keys()) this.host.deliver(id, out);
    } else {
      // Zone: everyone inside the sender's AOI box (the area the sender sees), the sender included
      const at = this.host.posOf(entityId);
      if (!at) return result(ChatReason.NotReady);
      const c = toUW(at.i, at.j);
      for (const id of this.peers.keys()) {
        const p = this.host.posOf(id);
        if (!p) continue;
        const u = toUW(p.i, p.j);
        if (Math.abs(u.u - c.u) <= AOI.HALF_U && Math.abs(u.w - c.w) <= AOI.HALF_W) this.host.deliver(id, out);
      }
    }
    this.metrics.delivered[msg.channel] = (this.metrics.delivered[msg.channel] ?? 0) + 1;
    return result(ChatReason.Ok);
  }

  private kindOf(channel: number): RateKind | null {
    return channel === ChatChannel.World
      ? 'world'
      : channel === ChatChannel.Zone
        ? 'zone'
        : channel === ChatChannel.Whisper
          ? 'whisper'
          : channel === ChatChannel.Party
            ? 'party'
            : null;
  }

  /** Token bucket per account and channel kind: `burst` tokens, one refilled every `refillMs`. */
  private take(accountId: string, kind: RateKind, nowMs: number): boolean {
    const { refillMs, burst } = CHAT_CONFIG.RATE[kind];
    const key = `${accountId}|${kind}`;
    const b = this.buckets.get(key) ?? { tokens: burst, at: nowMs };
    b.tokens = Math.min(burst, b.tokens + Math.max(0, nowMs - b.at) / refillMs);
    b.at = nowMs;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
