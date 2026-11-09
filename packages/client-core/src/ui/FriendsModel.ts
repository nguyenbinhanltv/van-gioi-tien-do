/**
 * Friends model (D96): what the client knows about its friend list, fed by the server's `friend_state` / `friend_result`. Engine-free and
 * DOM-free: the Cocos friends panel only renders `friends()` / `incoming()` / `outgoing()`. The server stays authoritative (it decides who
 * is a friend, who is online and every refusal); this keeps no rules of its own beyond sorting and showing answers in Vietnamese.
 *
 * "Whisper" and "invite to party" are not friend features on the wire: `whisperPrefill(name)` / `inviteCommand(name)` build the existing chat
 * input / party command, so the shortcuts need no extra server code and inherit their rules (rate limits, party rules).
 */
import { FRIENDS } from '@vgtd/shared';
import { FriendReason, type FriendEntry, type FriendResultMsg, type FriendStateMsg } from '@vgtd/protocol';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { FriendOp } from '@vgtd/protocol';

/** Vietnamese text of every friend refusal (user-facing). */
export const FRIEND_REASON_TEXT: Readonly<Record<number, string>> = {
  [FriendReason.Ok]: '',
  [FriendReason.RateLimited]: 'Bạn thao tác quá nhanh, hãy chờ giây lát.',
  [FriendReason.NoSuchPlayer]: 'Không tìm thấy người chơi này.',
  [FriendReason.Self]: 'Không thể tự chọn chính mình.',
  [FriendReason.AlreadyFriends]: 'Hai bạn đã là bạn bè.',
  [FriendReason.AlreadyRequested]: 'Bạn đã gửi lời mời kết bạn cho người này rồi.',
  [FriendReason.FriendListFull]: `Danh sách bạn bè của bạn đã đầy (${FRIENDS.MAX_FRIENDS}).`,
  [FriendReason.TargetListFull]: 'Người này không nhận thêm bạn bè hoặc lời mời lúc này.',
  [FriendReason.TooManyRequests]: `Bạn đang có quá nhiều lời mời chưa được trả lời (${FRIENDS.MAX_OUTGOING}).`,
  [FriendReason.NoRequest]: 'Không có lời mời kết bạn nào như vậy.',
  [FriendReason.NotFriends]: 'Người này không phải bạn bè của bạn.',
  [FriendReason.NotReady]: 'Chưa vào game, chưa thao tác được.',
};

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
    if (!had) return this.inc.length ? `Bạn có ${this.inc.length} lời mời kết bạn. Gõ /friend accept để nhận.` : null;
    const added = this.list.filter((f) => !before.has(f.name.toLowerCase())).map((f) => f.name);
    if (added.length) return `Bạn và ${added.join(', ')} đã là bạn bè.`;
    const now = new Set(this.list.map((f) => f.name.toLowerCase()));
    const gone = [...before].filter((n) => !now.has(n));
    if (gone.length) return `${gone.join(', ')} không còn trong danh sách bạn bè.`;
    const newInc = this.inc.filter((n) => !beforeInc.has(n.toLowerCase()));
    if (newInc.length) return `${newInc.join(', ')} muốn kết bạn với bạn. Gõ /friend accept ${newInc[0]} để nhận.`;
    return null;
  }

  /** The answer to a command: the line to show when refused, null when done. */
  applyResult(m: FriendResultMsg): string | null {
    if (m.reason === FriendReason.Ok) return null;
    return FRIEND_REASON_TEXT[m.reason] ?? `Thao tác bị từ chối (mã ${m.reason}).`;
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
    if (!this.seen) return ['Danh sách bạn bè chưa tải xong.'];
    const lines = [`Bạn bè (${this.count}/${FRIENDS.MAX_FRIENDS}, ${this.onlineCount} đang online):`];
    for (const f of this.friends()) lines.push(`  ${f.online ? '●' : '○'} ${f.name}`);
    if (this.count === 0) lines.push('  (chưa có bạn bè: /friend add tên)');
    if (this.inc.length) lines.push(`Lời mời nhận được: ${this.inc.join(', ')} (/friend accept [tên] · /friend decline [tên])`);
    if (this.out.length) lines.push(`Lời mời đã gửi: ${this.out.join(', ')} (/friend remove tên để thu hồi)`);
    return lines;
  }
}
