/**
 * Party model (D93): what the client knows about its party, fed by the server's `party_state` / `party_vitals` / `party_invite` /
 * `party_result` messages. Engine-free and DOM-free: the Cocos party frames only render `members()` / `invite()`. The server stays
 * authoritative; this keeps no rules of its own beyond showing the answers in Vietnamese.
 */
import { PARTY } from '@vgtd/shared';
import { t, type StringKey } from '../i18n/strings.js';
import { PartyReason, type PartyInviteMsg, type PartyResultMsg, type PartyStateMsg, type PartyVitalsMsg } from '@vgtd/protocol';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { PartyOp } from '@vgtd/protocol';

/** String key of every party refusal (user-facing text: `partyReasonText`). */
export const PARTY_REASON_KEY: Readonly<Record<number, StringKey | null>> = {
  [PartyReason.Ok]: null,
  [PartyReason.RateLimited]: 'party.reason.rate_limited',
  [PartyReason.NoSuchPlayer]: 'party.reason.no_such_player',
  [PartyReason.Self]: 'party.reason.self',
  [PartyReason.PartyFull]: 'party.reason.full',
  [PartyReason.TargetInParty]: 'party.reason.target_in_party',
  [PartyReason.NotLeader]: 'party.reason.not_leader',
  [PartyReason.NotInParty]: 'party.reason.not_in_party',
  [PartyReason.NoInvite]: 'party.reason.no_invite',
  [PartyReason.AlreadyInParty]: 'party.reason.already_in_party',
  [PartyReason.TooManyInvites]: 'party.reason.too_many_invites',
  [PartyReason.NotReady]: 'party.reason.not_ready',
};

/** The player-facing text of a party refusal: '' for Ok, the generic "refused (code n)" line for an unknown code. */
export function partyReasonText(reason: number): string {
  const key = PARTY_REASON_KEY[reason];
  if (key === null) return '';
  return key === undefined ? t('party.reason.unknown', { code: reason }) : t(key);
}

export interface PartyMemberView {
  entityId: number;
  name: string;
  classId: number;
  isLeader: boolean;
  isMe: boolean;
  /** undefined until the first `party_vitals` after the roster changed */
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
}
export interface PendingInvite {
  fromName: string;
  /** model clock, ms, at which it stops being valid */
  expiresAtMs: number;
}

export interface PartyModelOptions {
  /** the local player's entity id (known after `hello_ack`) */
  myId: () => number;
  /** monotonic clock in ms */
  now: () => number;
}

export class PartyModel {
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  private leaderId = 0;
  private roster: Array<{ entityId: number; name: string; classId: number }> = [];
  private vitals = new Map<number, { hp: number; hpMax: number; mp: number; mpMax: number }>();
  private invites: PendingInvite[] = [];

  constructor(private readonly o: PartyModelOptions) {}

  get inParty(): boolean {
    return this.roster.length > 0;
  }
  get leader(): number {
    return this.leaderId;
  }
  get amLeader(): boolean {
    return this.inParty && this.leaderId === this.o.myId();
  }

  /** Members in roster order; vitals filled in when known. */
  members(): PartyMemberView[] {
    const me = this.o.myId();
    return this.roster.map((m) => {
      const v = this.vitals.get(m.entityId);
      return { ...m, isLeader: m.entityId === this.leaderId, isMe: m.entityId === me, ...(v ?? {}) };
    });
  }

  /** The newest live invite (what `/accept` answers), or null. */
  invite(): PendingInvite | null {
    this.expire();
    return this.invites.length ? this.invites[this.invites.length - 1]! : null;
  }
  pendingInvites(): PendingInvite[] {
    this.expire();
    return [...this.invites];
  }
  private expire(): void {
    const t = this.o.now();
    const live = this.invites.filter((i) => i.expiresAtMs > t);
    if (live.length !== this.invites.length) {
      this.invites = live;
      this.version++;
    }
  }

  /**
   * The roster changed. Returns a system line to show ("you joined", "alice left"...), or null when nothing worth saying.
   */
  applyState(m: PartyStateMsg): string | null {
    const before = this.roster;
    const wasIn = before.length > 0;
    this.roster = m.members.map((x) => ({ entityId: x.entityId, name: x.name, classId: x.classId }));
    this.leaderId = m.leaderId;
    const keep = new Set(this.roster.map((x) => x.entityId));
    for (const id of [...this.vitals.keys()]) if (!keep.has(id)) this.vitals.delete(id);
    if (this.roster.length) this.invites = []; // joined a party: pending invites are moot (the server dropped them too)
    this.version++;
    if (!this.roster.length) return wasIn ? t('party.event.you_left') : null;
    if (!wasIn) {
      const lead = this.roster.find((x) => x.entityId === m.leaderId)?.name ?? '';
      return t('party.event.you_joined', { leader: lead, size: this.roster.length, max: PARTY.MAX_SIZE });
    }
    const names = (list: typeof before) => new Set(list.map((x) => x.entityId));
    const was = names(before);
    const now = names(this.roster);
    const joined = this.roster.filter((x) => !was.has(x.entityId)).map((x) => x.name);
    const left = before.filter((x) => !now.has(x.entityId)).map((x) => x.name);
    if (joined.length && left.length) return t('party.event.joined_and_left', { joined: joined.join(', '), left: left.join(', ') });
    if (joined.length) return t('party.event.joined', { names: joined.join(', ') });
    if (left.length) return t('party.event.left', { names: left.join(', ') });
    return null;
  }

  applyVitals(m: PartyVitalsMsg): void {
    for (const v of m.members) this.vitals.set(v.entityId, { hp: v.hp, hpMax: v.hpMax, mp: v.mp, mpMax: v.mpMax });
    this.version++;
  }

  /** A new invite; returns the line to show. */
  applyInvite(m: PartyInviteMsg): string {
    this.invites = this.invites.filter((i) => i.fromName !== m.fromName);
    this.invites.push({ fromName: m.fromName, expiresAtMs: this.o.now() + m.ttlMs });
    this.version++;
    return t('party.invite.line', { from: m.fromName });
  }

  /** The answer to one of our commands: a refusal text, or null when it worked. */
  applyResult(m: PartyResultMsg): string | null {
    return m.reason === PartyReason.Ok ? null : partyReasonText(m.reason);
  }

  /** We answered an invite from `fromName` ('' = the newest): forget it locally (the server's result confirms). */
  forgetInvite(fromName: string): void {
    const at = fromName
      ? this.invites.findIndex((i) => i.fromName.toLowerCase() === fromName.toLowerCase())
      : this.invites.length - 1;
    if (at < 0) return;
    this.invites.splice(at, 1);
    this.version++;
  }
}

