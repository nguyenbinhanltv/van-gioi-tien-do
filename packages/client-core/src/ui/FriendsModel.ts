/**
 * Friends model (D96): what the client knows about its friend list, fed by the server's `friend_state` / `friend_result`. Engine-free and
 * DOM-free: the Cocos friends panel only renders `friends()` / `incoming()` / `outgoing()`. The server stays authoritative (it decides who
 * is a friend, who is online and every refusal); this keeps no rules of its own beyond sorting and showing answers in Vietnamese.
 *
 * "Whisper" and "invite to party" are not friend features on the wire: `whisperPrefill(name)` / `inviteCommand(name)` build the existing chat
 * input / party command, so the shortcuts need no extra server code and inherit their rules (rate limits, party rules).
 */
import { FRIENDS } from '@vgtd/shared';
import { t, type StringKey } from '../i18n/strings.js';
import { FriendReason, type FriendEntry, type FriendResultMsg, type FriendStateMsg } from '@vgtd/protocol';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { FriendOp } from '@vgtd/protocol';

/** String key of every friend refusal (user-facing text: `friendReasonText`). */
export const FRIEND_REASON_KEY: Readonly<Record<number, StringKey | null>> = {
  [FriendReason.Ok]: null,
  [FriendReason.RateLimited]: 'friends.reason.rate_limited',
  [FriendReason.NoSuchPlayer]: 'friends.reason.no_such_player',
  [FriendReason.Self]: 'friends.reason.self',
  [FriendReason.AlreadyFriends]: 'friends.reason.already_friends',
  [FriendReason.AlreadyRequested]: 'friends.reason.already_requested',
  [FriendReason.FriendListFull]: 'friends.reason.list_full',
  [FriendReason.TargetListFull]: 'friends.reason.target_list_full',
  [FriendReason.TooManyRequests]: 'friends.reason.too_many_requests',
  [FriendReason.NoRequest]: 'friends.reason.no_request',
  [FriendReason.NotFriends]: 'friends.reason.not_friends',
  [FriendReason.NotReady]: 'friends.reason.not_ready',
};

/** The player-facing text of a friend refusal: '' for Ok, the generic "refused (code n)" line for an unknown code. */
export function friendReasonText(reason: number): string {
  const key = FRIEND_REASON_KEY[reason];
  if (key === null) return '';
  if (key === undefined) return t('friends.reason.unknown', { code: reason });
  return t(key, { max: reason === FriendReason.TooManyRequests ? FRIENDS.MAX_OUTGOING : FRIENDS.MAX_FRIENDS });
}

export interface FriendView extends FriendEntry {
  /** shortcuts only make sense for someone who is online (a whisper to an offline player is refused by the server) */
  canWhisper: boolean;
  canInvite: boolean;
}

export class FriendsModel {
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  private list: FriendEntry[] = [];
  private inc: string[] = [];
  private out: string[] = [];
  private seen = false;

  /** True once the server has sent the first state (before that the panel shows "loading", not "no friends"). */
  get ready(): boolean {
    return this.seen;
  }

  /** Online friends first, then by name (case-insensitive); stable for equal names. */
  friends(): FriendView[] {
    return [...this.list]
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map((f) => ({ ...f, canWhisper: f.online, canInvite: f.online }));
  }
  /** Names who asked to be your friend, oldest first. */
  incoming(): string[] {
    return [...this.inc];
  }
  /** Names you asked, oldest first. */
  outgoing(): string[] {
    return [...this.out];
  }
  get onlineCount(): number {
    return this.list.filter((f) => f.online).length;
  }
  get count(): number {
    return this.list.length;
  }
  isFriend(name: string): boolean {
    const n = name.toLowerCase();
    return this.list.some((f) => f.name.toLowerCase() === n);
  }

  /**
   * The picture changed. Returns a system line for what is worth announcing (a new request, a new friend, a friend gone), or null.
   * Presence changes are NOT announced: they would spam the log, the panel shows them.
   */
  applyState(m: FriendStateMsg): string | null {
    const had = this.seen;
    const before = new Set(this.list.map((f) => f.name.toLowerCase()));
    const beforeInc = new Set(this.inc.map((n) => n.toLowerCase()));
    this.list = m.friends.map((f) => ({ ...f }));
    this.inc = [...m.incoming];
    this.out = [...m.outgoing];
    this.seen = true;
    this.version++;
    if (!had) return this.inc.length ? t('friends.event.pending_requests', { n: this.inc.length }) : null;
    const added = this.list.filter((f) => !before.has(f.name.toLowerCase())).map((f) => f.name);
    if (added.length) return t('friends.event.now_friends', { names: added.join(', ') });
    const now = new Set(this.list.map((f) => f.name.toLowerCase()));
    const gone = [...before].filter((n) => !now.has(n));
    if (gone.length) return t('friends.event.removed', { names: gone.join(', ') });
    const newInc = this.inc.filter((n) => !beforeInc.has(n.toLowerCase()));
    if (newInc.length) return t('friends.event.request_from', { names: newInc.join(', '), first: newInc[0]! });
    return null;
  }

  /** The answer to a command: the line to show when refused, null when done. */
  applyResult(m: FriendResultMsg): string | null {
    if (m.reason === FriendReason.Ok) return null;
    return friendReasonText(m.reason);
  }

  /** What to put in the chat input for "Nhắn riêng": the existing whisper command. */
  whisperPrefill(name: string): string {
    return `/w ${name} `;
  }
  /** The existing party command for "Mời vào tổ đội". */
  inviteCommand(name: string): string {
    return `/invite ${name}`;
  }

  /** The list as plain lines (for `/friends` in the chat log). */
  summaryLines(): string[] {
    if (!this.seen) return [t('friends.summary.not_loaded')];
    const lines = [
      t('friends.summary.header', { count: this.count, max: FRIENDS.MAX_FRIENDS, online: this.onlineCount }),
    ];
    for (const f of this.friends()) lines.push(`  ${f.online ? '●' : '○'} ${f.name}`);
    if (this.count === 0) lines.push(t('friends.summary.empty'));
    if (this.inc.length) lines.push(t('friends.summary.incoming', { names: this.inc.join(', ') }));
    if (this.out.length) lines.push(t('friends.summary.outgoing', { names: this.out.join(', ') }));
    return lines;
  }
}
