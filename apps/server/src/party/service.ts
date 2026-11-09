/**
 * PartyService (D92, docs/10 §7.1 P4 "Tổ đội (4)"): invite / accept / decline / leave / kick, one leader, at most `PARTY.MAX_SIZE` members.
 * Session-only by design: parties live in RAM, a disconnect is a leave, nothing is persisted (the persistence files belong to other workers).
 *
 * Authority: every actor is whoever the connection authenticated as; names only select the OTHER player. An unknown and an offline name give
 * the same `NoSuchPlayer`. Every `party_cmd` gets exactly one `party_result`. Time is the simulation clock handed in by `WorldNode`.
 *
 * Output goes through the host: `party_invite` to the invited player, `party_state` (the roster) to every member whenever it changes,
 * `party_vitals` (members' HP / MP) a few times a second but only when something changed.
 */
import { PARTY } from '@vgtd/shared';
import {
  PartyOp,
  PartyReason,
  type PartyCmdMsg,
  type PartyResultMsg,
  type PartyServerMessage,
  type PartyStateMsg,
  type PartyVital,
} from '@vgtd/protocol';
import { PARTY_CONFIG } from './config.js';

export interface PartyPeer {
  readonly entityId: number;
  readonly accountId: string;
  /** display name (the unique username) */
  readonly name: string;
  /** class wire id (1..6) */
  readonly classId: number;
}

export interface PartyHost {
  deliver(entityId: number, msg: PartyServerMessage): void;
  /** current HP / MP of a player, undefined when gone */
  vitalsOf(entityId: number): { hp: number; hpMax: number; mp: number; mpMax: number } | undefined;
}

interface Party {
  id: number;
  leader: number;
  /** join order; the leader is always one of them */
  members: number[];
  /** signature of the last vitals sent, so an unchanged party costs nothing */
  vitalsSig: string;
}
interface Invite {
  from: number;
  expiresAtMs: number;
}
interface Bucket {
  tokens: number;
  at: number;
}

export interface PartyMetrics {
  created: number;
  disbanded: number;
  invites: number;
  refused: Record<number, number>;
}

export class PartyService {
  readonly metrics: PartyMetrics = { created: 0, disbanded: 0, invites: 0, refused: {} };
  private host: PartyHost | null = null;
  private readonly peers = new Map<number, PartyPeer>();
  private readonly byName = new Map<string, number>();
  private readonly parties = new Map<number, Party>();
  private readonly partyOf = new Map<number, number>();
  /** target entity -> live invites (oldest first) */
  private readonly invites = new Map<number, Invite[]>();
  private readonly buckets = new Map<string, Bucket>();
  private nextPartyId = 1;

  attach(host: PartyHost): void {
    this.host = host;
  }

  // ------------------------------------------------------------------ peers
  join(peer: PartyPeer): void {
    this.peers.set(peer.entityId, peer);
    this.byName.set(peer.name.toLowerCase(), peer.entityId);
  }

  /** A player left the world: leaves the party and loses every invite sent or received. */
  leave(entityId: number): void {
    const p = this.peers.get(entityId);
    if (!p) return;
    this.removeFromParty(entityId, false);
    this.invites.delete(entityId);
    for (const [to, list] of this.invites) {
      const kept = list.filter((i) => i.from !== entityId);
      if (kept.length) this.invites.set(to, kept);
      else this.invites.delete(to);
    }
    this.peers.delete(entityId);
    if (this.byName.get(p.name.toLowerCase()) === entityId) this.byName.delete(p.name.toLowerCase());
  }

  // ------------------------------------------------------------------ queries (chat, combat)
  /** Entity ids of the party `entityId` is in, itself included, ascending; `[]` when in no party. */
  membersOf(entityId: number): number[] {
    const id = this.partyOf.get(entityId);
    const party = id === undefined ? undefined : this.parties.get(id);
    return party ? [...party.members].sort((a, b) => a - b) : [];
  }
  partyIdOf(entityId: number): number {
    return this.partyOf.get(entityId) ?? 0;
  }
  leaderOf(entityId: number): number {
    const id = this.partyOf.get(entityId);
    return id === undefined ? 0 : (this.parties.get(id)?.leader ?? 0);
  }
  get partyCount(): number {
    return this.parties.size;
  }

  // ------------------------------------------------------------------ commands
  handle(entityId: number, cmd: PartyCmdMsg, nowMs: number): PartyResultMsg {
    const result = (reason: PartyReason): PartyResultMsg => {
      if (reason !== PartyReason.Ok) this.metrics.refused[reason] = (this.metrics.refused[reason] ?? 0) + 1;
      return { type: 'party_result', clientMsgId: cmd.clientMsgId, reason };
    };
    const me = this.peers.get(entityId);
    if (!me || !this.host) return result(PartyReason.NotReady);
    if (!this.take(me.accountId, nowMs)) return result(PartyReason.RateLimited);
    this.expire(nowMs);
    switch (cmd.op) {
      case PartyOp.Invite:
        return result(this.invite(me, cmd.name, nowMs));
      case PartyOp.Accept:
        return result(this.accept(me, cmd.name));
      case PartyOp.Decline:
        return result(this.decline(me, cmd.name));
      case PartyOp.Leave:
        if (!this.partyOf.has(entityId)) return result(PartyReason.NotInParty);
        this.removeFromParty(entityId, true);
        return result(PartyReason.Ok);
      case PartyOp.Kick:
        return result(this.kick(me, cmd.name));
      default:
        return result(PartyReason.NotReady);
    }
  }

  private find(name: string): PartyPeer | undefined {
    const id = this.byName.get(name.toLowerCase());
    return id === undefined ? undefined : this.peers.get(id);
  }

  private invite(me: PartyPeer, name: string, nowMs: number): PartyReason {
    const target = this.find(name);
    if (!target) return PartyReason.NoSuchPlayer;
    if (target.entityId === me.entityId) return PartyReason.Self;
    const mine = this.partyOf.get(me.entityId);
    if (mine !== undefined) {
      const party = this.parties.get(mine)!;
      if (party.leader !== me.entityId) return PartyReason.NotLeader;
      if (party.members.length >= PARTY.MAX_SIZE) return PartyReason.PartyFull;
    }
    if (this.partyOf.has(target.entityId)) return PartyReason.TargetInParty;
    const list = this.invites.get(target.entityId) ?? [];
    if (list.length >= PARTY.MAX_PENDING_INVITES || list.some((i) => i.from === me.entityId))
      return PartyReason.TooManyInvites;
    list.push({ from: me.entityId, expiresAtMs: nowMs + PARTY.INVITE_TTL_MS });
    this.invites.set(target.entityId, list);
    this.metrics.invites++;
    this.host!.deliver(target.entityId, { type: 'party_invite', fromName: me.name, ttlMs: PARTY.INVITE_TTL_MS });
    return PartyReason.Ok;
  }

  /** The live invite `me` is answering: the one from `name`, or the newest when `name` is empty. */
  private pick(me: PartyPeer, name: string): { list: Invite[]; at: number } | null {
    const list = this.invites.get(me.entityId) ?? [];
    if (!name) return list.length ? { list, at: list.length - 1 } : null;
    const from = this.find(name);
    const at = from ? list.findIndex((i) => i.from === from.entityId) : -1;
    return at < 0 ? null : { list, at };
  }

  private drop(me: PartyPeer, list: Invite[], at: number): Invite {
    const [inv] = list.splice(at, 1);
    if (list.length) this.invites.set(me.entityId, list);
    else this.invites.delete(me.entityId);
    return inv!;
  }

  private accept(me: PartyPeer, name: string): PartyReason {
    if (this.partyOf.has(me.entityId)) return PartyReason.AlreadyInParty;
    const hit = this.pick(me, name);
    if (!hit) return PartyReason.NoInvite;
    const from = this.peers.get(hit.list[hit.at]!.from);
    if (!from) {
      this.drop(me, hit.list, hit.at);
      return PartyReason.NoInvite;
    }
    let party = this.parties.get(this.partyOf.get(from.entityId) ?? -1);
    if (party && party.members.length >= PARTY.MAX_SIZE) return PartyReason.PartyFull;
    this.drop(me, hit.list, hit.at);
    if (!party) {
      party = { id: this.nextPartyId++, leader: from.entityId, members: [from.entityId], vitalsSig: '' };
      this.parties.set(party.id, party);
      this.partyOf.set(from.entityId, party.id);
      this.metrics.created++;
    }
    party.members.push(me.entityId);
    this.partyOf.set(me.entityId, party.id);
    // anything else that was pending for the new member is moot now
    this.invites.delete(me.entityId);
    this.broadcastState(party);
    return PartyReason.Ok;
  }

  private decline(me: PartyPeer, name: string): PartyReason {
    const hit = this.pick(me, name);
    if (!hit) return PartyReason.NoInvite;
    this.drop(me, hit.list, hit.at);
    return PartyReason.Ok;
  }

  private kick(me: PartyPeer, name: string): PartyReason {
    const id = this.partyOf.get(me.entityId);
    if (id === undefined) return PartyReason.NotInParty;
    const party = this.parties.get(id)!;
    if (party.leader !== me.entityId) return PartyReason.NotLeader;
    const target = this.find(name);
    if (!target || !party.members.includes(target.entityId)) return PartyReason.NotInParty;
    if (target.entityId === me.entityId) return PartyReason.Self;
    this.removeFromParty(target.entityId, true);
    return PartyReason.Ok;
  }

  /** Take one member out; a party of one is disbanded, a leaving leader hands over to the longest-standing member. */
  private removeFromParty(entityId: number, notifyLeaver: boolean): void {
    const id = this.partyOf.get(entityId);
    if (id === undefined) return;
    const party = this.parties.get(id)!;
    party.members = party.members.filter((m) => m !== entityId);
    this.partyOf.delete(entityId);
    if (notifyLeaver) this.sendState(entityId, null);
    if (party.members.length <= 1) {
      for (const m of party.members) {
        this.partyOf.delete(m);
        this.sendState(m, null);
      }
      this.parties.delete(party.id);
      this.metrics.disbanded++;
      return;
    }
    if (party.leader === entityId) party.leader = party.members[0]!;
    this.broadcastState(party);
  }

  // ------------------------------------------------------------------ output
  private stateOf(party: Party | null): PartyStateMsg {
    if (!party) return { type: 'party_state', leaderId: 0, members: [] };
    return {
      type: 'party_state',
      leaderId: party.leader,
      members: party.members.map((m) => {
        const p = this.peers.get(m);
        return { entityId: m, name: p?.name ?? '', classId: p?.classId ?? 0 };
      }),
    };
  }
  private sendState(entityId: number, party: Party | null): void {
    this.host?.deliver(entityId, this.stateOf(party));
  }
  private broadcastState(party: Party): void {
    party.vitalsSig = ''; // the roster changed: the next vitals pass sends to everyone
    const msg = this.stateOf(party);
    for (const m of party.members) this.host?.deliver(m, msg);
  }

  /**
   * Called every world tick: expires invites and, every `PARTY.VITALS_EVERY_TICKS` ticks, sends each party's members their HP / MP when
   * any of them changed since the last send.
   */
  tick(nowMs: number, tick: number): void {
    if (!this.host) return;
    if (tick % PARTY.VITALS_EVERY_TICKS !== 0) return;
    this.expire(nowMs);
    for (const party of this.parties.values()) {
      const members: PartyVital[] = [];
      for (const m of party.members) {
        const v = this.host.vitalsOf(m);
        if (v) members.push({ entityId: m, ...v });
      }
      const sig = members.map((v) => `${v.entityId}:${v.hp}/${v.hpMax}:${v.mp}/${v.mpMax}`).join('|');
      if (sig === party.vitalsSig) continue;
      party.vitalsSig = sig;
      const msg: PartyServerMessage = { type: 'party_vitals', members };
      for (const m of party.members) this.host.deliver(m, msg);
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
    const { refillMs, burst } = PARTY_CONFIG.RATE;
    const b = this.buckets.get(accountId) ?? { tokens: burst, at: nowMs };
    b.tokens = Math.min(burst, b.tokens + Math.max(0, nowMs - b.at) / refillMs);
    b.at = nowMs;
    this.buckets.set(accountId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
