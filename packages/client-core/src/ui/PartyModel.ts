/**
 * Party model (D93): what the client knows about its party, fed by the server's `party_state` / `party_vitals` / `party_invite` /
 * `party_result` messages. Engine-free and DOM-free: the Cocos party frames only render `members()` / `invite()`. The server stays
 * authoritative; this keeps no rules of its own beyond showing the answers in Vietnamese.
 */
import { PARTY } from '@vgtd/shared';
import { PartyReason, type PartyInviteMsg, type PartyResultMsg, type PartyStateMsg, type PartyVitalsMsg } from '@vgtd/protocol';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { PartyOp } from '@vgtd/protocol';

/** Vietnamese text of every party refusal (user-facing). */
export const PARTY_REASON_TEXT: Readonly<Record<number, string>> = {
  [PartyReason.Ok]: '',
  [PartyReason.RateLimited]: 'Bạn thao tác quá nhanh, hãy chờ giây lát.',
  [PartyReason.NoSuchPlayer]: 'Không tìm thấy người chơi này (hoặc họ đang ngoại tuyến).',
  [PartyReason.Self]: 'Không thể tự chọn chính mình.',
  [PartyReason.PartyFull]: 'Tổ đội đã đủ người.',
  [PartyReason.TargetInParty]: 'Người này đã ở trong một tổ đội.',
  [PartyReason.NotLeader]: 'Chỉ đội trưởng mới làm được việc này.',
  [PartyReason.NotInParty]: 'Không có trong tổ đội (hoặc người đó không thuộc tổ đội của bạn).',
  [PartyReason.NoInvite]: 'Không có lời mời nào còn hiệu lực.',
  [PartyReason.AlreadyInParty]: 'Bạn đang ở trong một tổ đội, hãy rời đội trước.',
  [PartyReason.TooManyInvites]: 'Người này đang có quá nhiều lời mời (hoặc bạn đã mời rồi).',
  [PartyReason.NotReady]: 'Chưa vào game, chưa thao tác được.',
};

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
    if (!this.roster.length) return wasIn ? 'Bạn đã rời tổ đội.' : null;
    if (!wasIn) {
      const lead = this.roster.find((x) => x.entityId === m.leaderId)?.name ?? '';
      return `Bạn đã vào tổ đội của ${lead} (${this.roster.length}/${PARTY.MAX_SIZE}).`;
    }
    const names = (list: typeof before) => new Set(list.map((x) => x.entityId));
    const was = names(before);
    const now = names(this.roster);
    const joined = this.roster.filter((x) => !was.has(x.entityId)).map((x) => x.name);
    const left = before.filter((x) => !now.has(x.entityId)).map((x) => x.name);
    const parts: string[] = [];
    if (joined.length) parts.push(`${joined.join(', ')} vào tổ đội`);
    if (left.length) parts.push(`${left.join(', ')} rời tổ đội`);
    return parts.length ? `${parts.join('; ')}.` : null;
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
    return `${m.fromName} mời bạn vào tổ đội. Gõ /accept để nhận hoặc /decline để từ chối.`;
  }

  /** The answer to one of our commands: a refusal text, or null when it worked. */
  applyResult(m: PartyResultMsg): string | null {
    return m.reason === PartyReason.Ok ? null : (PARTY_REASON_TEXT[m.reason] ?? `Lệnh tổ đội bị từ chối (mã ${m.reason}).`);
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

