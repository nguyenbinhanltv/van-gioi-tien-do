/**
 * Chat model (D87): turns what the player types into a `chat_send`, and what the server sends into display lines. Engine-free and
 * DOM-free: the Cocos chat box only renders `ChatLog.entries` (as TEXT, never as markup: names and lines come from other players).
 * The server stays authoritative: this only guards obvious mistakes locally (empty, over 256 bytes, unknown command) so the player gets an
 * answer without a round trip; everything else (rate limit, mute, filter, whisper target) is decided and answered by the server.
 *
 * Party (D93): `/p text` party channel; `/invite name`, `/accept [name]`, `/decline [name]`, `/leave`, `/kick name` are party commands.
 * Trade (D102): `/trade name` invites, `/trade accept|decline [name]`, `/trade add slot [qty]` (qty 0 removes), `/trade stones ha|trung|thuong amount`,
 * `/trade lock`, `/trade confirm`, `/trade cancel`; `/trade` alone shows the window (the panel).
 * Sect (D98): `/sect` shows it (the panel), `/sect join`, `/sect leave`, `/sect buy N` (N = the manual's number in the library).
 * Friends (D96): `/friend add name`, `/friend accept [name]`, `/friend decline [name]`, `/friend remove name` (also withdraws a request), `/friends` lists.
 * Commands: plain text = World channel; `/z text` Zone (everyone who can see you); `/w name text` whisper; `/r text` reply to the last
 * player who whispered you; `//text` sends a World line that starts with a slash; `/help`.
 */
import { SECT } from '@vgtd/shared';
import {
  CHAT_LIMITS,
  ChatChannel,
  ChatReason,
  FriendOp,
  PartyOp,
  TradeOp,
  SectOp,
  type ChatHistoryMsg,
  type ChatLine,
  type ChatMsgMsg,
  type ChatResultMsg,
} from '@vgtd/protocol';

export type ChatTone = 'world' | 'zone' | 'whisper' | 'party' | 'system' | 'error';

export interface ChatEntry {
  /** increasing, for UI diffing */
  id: number;
  tone: ChatTone;
  /** channel tag + sender + text, ready to draw */
  text: string;
  channel: number | null;
}

/** Vietnamese texts of every refusal reason (user-facing). */
export const CHAT_REASON_TEXT: Readonly<Record<number, string>> = {
  [ChatReason.Ok]: '',
  [ChatReason.RateLimited]: 'Bạn nói quá nhanh, hãy chờ giây lát.',
  [ChatReason.TooLong]: `Tin quá dài (tối đa ${CHAT_LIMITS.MAX_TEXT_BYTES} byte).`,
  [ChatReason.Empty]: 'Tin trống.',
  [ChatReason.Muted]: 'Bạn đang bị cấm chat.',
  [ChatReason.BadChannel]: 'Kênh chat này chưa mở.',
  [ChatReason.NoSuchPlayer]: 'Không tìm thấy người chơi này (hoặc họ đang ngoại tuyến).',
  [ChatReason.NotReady]: 'Chưa vào game, chưa chat được.',
  [ChatReason.SelfWhisper]: 'Không thể nhắn riêng cho chính mình.',
  [ChatReason.NotInParty]: 'Bạn chưa vào tổ đội nào.',
};

export const CHAT_HELP = [
  'Chat: gõ nội dung để nói ở kênh Thế giới.',
  '/z nội dung: kênh Vùng (người ở gần bạn) · /w tên nội dung: nhắn riêng · /r nội dung: trả lời người vừa nhắn · //nội dung: gửi tin bắt đầu bằng dấu /',
  'Giao dịch (cần đứng gần): /trade tên · /trade accept|decline · /trade add ô [số] · /trade stones ha|trung|thuong số · /trade lock · /trade confirm · /trade cancel (phím T mở bảng giao dịch)',
  'Tông môn: /sect (xem) · /sect join · /sect leave · /sect buy số (phím K mở bảng Sơn Môn Đại Phái)',
  'Tổ đội: /invite tên · /accept [tên] · /decline [tên] · /leave · /kick tên (đội trưởng) · /p nội dung: chat tổ đội',
  'Bạn bè: /friend add tên · /friend accept [tên] · /friend decline [tên] · /friend remove tên · /friends: xem danh sách (phím O mở bảng bạn bè)',
].join('\n');

export type ParsedChatInput =
  | { kind: 'empty' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'send'; channel: number; target: string; text: string }
  | { kind: 'party'; op: number; name: string }
  | { kind: 'trade'; op: number; name: string; slot: number; qty: number; currency: number; amount: number }
  | { kind: 'trades' }
  | { kind: 'sect'; op: number; manual: number }
  | { kind: 'sects' }
  | { kind: 'friend'; op: number; name: string }
  | { kind: 'friends' };

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export function parseChatInput(raw: string, ctx: { lastWhisperFrom?: string | null } = {}): ParsedChatInput {
  const input = raw.trim();
  if (!input) return { kind: 'empty' };
  const send = (channel: number, text: string, target = ''): ParsedChatInput => {
    const t = text.trim();
    if (!t) return { kind: 'error', message: CHAT_REASON_TEXT[ChatReason.Empty]! };
    if (utf8Bytes(t) > CHAT_LIMITS.MAX_TEXT_BYTES) return { kind: 'error', message: CHAT_REASON_TEXT[ChatReason.TooLong]! };
    return { kind: 'send', channel, target, text: t };
  };
  if (!input.startsWith('/') || input.startsWith('//')) return send(ChatChannel.World, input.startsWith('//') ? input.slice(1) : input);
  const m = /^\/(\S*)\s*([\s\S]*)$/.exec(input)!;
  const cmd = m[1]!.toLowerCase();
  const rest = m[2]!;
  switch (cmd) {
    case 'help':
    case '?':
    case 'h':
      return { kind: 'help' };
    case 'z':
    case 'zone':
    case 'v':
      return send(ChatChannel.Zone, rest);
    case 's':
    case 'world':
    case 'tg':
      return send(ChatChannel.World, rest);
    case 'p':
    case 'party':
    case 'd':
      return send(ChatChannel.Party, rest);
    case 'invite':
    case 'inv':
    case 'moi':
    case 'kick': {
      const name = rest.trim().split(/\s+/)[0] ?? '';
      if (!name) return { kind: 'error', message: `Dùng: /${cmd} tên` };
      if (utf8Bytes(name) > CHAT_LIMITS.MAX_NAME_BYTES) return { kind: 'error', message: CHAT_REASON_TEXT[ChatReason.NoSuchPlayer]! };
      return { kind: 'party', op: cmd === 'kick' ? PartyOp.Kick : PartyOp.Invite, name };
    }
    case 'accept':
    case 'ac':
    case 'dongy':
    case 'decline':
    case 'dc':
    case 'tuchoi': {
      const name = rest.trim().split(/\s+/)[0] ?? '';
      if (utf8Bytes(name) > CHAT_LIMITS.MAX_NAME_BYTES) return { kind: 'error', message: CHAT_REASON_TEXT[ChatReason.NoSuchPlayer]! };
      return { kind: 'party', op: cmd === 'accept' || cmd === 'ac' || cmd === 'dongy' ? PartyOp.Accept : PartyOp.Decline, name };
    }
    case 'trade':
    case 'gd': {
      const parts = rest.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] ?? '').toLowerCase();
      const t = (op: number, extra: { name?: string; slot?: number; qty?: number; currency?: number; amount?: number } = {}): ParsedChatInput => ({
        kind: 'trade',
        op,
        name: extra.name ?? '',
        slot: extra.slot ?? 0,
        qty: extra.qty ?? 0,
        currency: extra.currency ?? 0,
        amount: extra.amount ?? 0,
      });
      const num = (s: string | undefined, max: number): number | null => (s !== undefined && /^\d{1,10}$/.test(s) && Number(s) <= max ? Number(s) : null);
      switch (sub) {
        case '':
          return { kind: 'trades' };
        case 'accept':
        case 'ac':
        case 'dongy':
        case 'decline':
        case 'dc':
        case 'tuchoi': {
          const name = parts[1] ?? '';
          if (utf8Bytes(name) > CHAT_LIMITS.MAX_NAME_BYTES) return { kind: 'error', message: CHAT_REASON_TEXT[ChatReason.NoSuchPlayer]! };
          return t(sub === 'accept' || sub === 'ac' || sub === 'dongy' ? TradeOp.Accept : TradeOp.Decline, { name });
        }
        case 'lock':
        case 'khoa':
          return t(TradeOp.Lock);
        case 'confirm':
        case 'xacnhan':
          return t(TradeOp.Confirm);
        case 'cancel':
        case 'huy':
          return t(TradeOp.Cancel);
        case 'add':
        case 'them': {
          const slot = num(parts[1], 255);
          const qty = parts[2] === undefined ? 1 : num(parts[2], 65535);
          if (slot === null || qty === null) return { kind: 'error', message: 'Dùng: /trade add ô [số lượng] (số lượng 0 để bỏ ra)' };
          return t(TradeOp.SetItem, { slot: slot - 1, qty });
        }
        case 'stones':
        case 'linhthach': {
          const cur = ['ha', 'trung', 'thuong'].indexOf((parts[1] ?? '').toLowerCase());
          const amount = num(parts[2], 4294967295);
          if (cur < 0 || amount === null) return { kind: 'error', message: 'Dùng: /trade stones ha|trung|thuong số lượng' };
          return t(TradeOp.SetStones, { currency: cur, amount });
        }
        default: {
          // /trade name  = invite
          if (utf8Bytes(sub) > CHAT_LIMITS.MAX_NAME_BYTES) return { kind: 'error', message: CHAT_REASON_TEXT[ChatReason.NoSuchPlayer]! };
          return t(TradeOp.Invite, { name: parts[0]! });
        }
      }
    }
    case 'sect':
    case 'tongmon':
    case 'tm': {
      const m2 = /^(\S*)\s*(\S*)/.exec(rest)!;
      const sub = m2[1]!.toLowerCase();
      switch (sub) {
        case '':
        case 'list':
        case 'info':
          return { kind: 'sects' };
        case 'join':
        case 'gianhap':
          return { kind: 'sect', op: SectOp.Join, manual: 0 };
        case 'leave':
        case 'roi':
          return { kind: 'sect', op: SectOp.Leave, manual: 0 };
        case 'buy':
        case 'mua': {
          const n = /^\d{1,2}$/.test(m2[2]!) ? Number(m2[2]) : 0;
          if (n < 1 || n > SECT.MAX_MANUALS) return { kind: 'error', message: 'Dùng: /sect buy số (số thứ tự bí tịch, từ 1)' };
          return { kind: 'sect', op: SectOp.Buy, manual: n - 1 };
        }
        default:
          return { kind: 'error', message: 'Dùng: /sect · /sect join · /sect leave · /sect buy số' };
      }
    }
    case 'friends':
    case 'banbe':
      return { kind: 'friends' };
    case 'friend':
    case 'f':
    case 'ketban': {
      const m2 = /^(\S*)\s*(\S*)/.exec(rest)!;
      const sub = m2[1]!.toLowerCase();
      const name = m2[2]!;
      if (utf8Bytes(name) > CHAT_LIMITS.MAX_NAME_BYTES) return { kind: 'error', message: CHAT_REASON_TEXT[ChatReason.NoSuchPlayer]! };
      switch (sub) {
        case 'add':
        case 'them':
        case 'moi':
          return name ? { kind: 'friend', op: FriendOp.Request, name } : { kind: 'error', message: 'Dùng: /friend add tên' };
        case 'remove':
        case 'rm':
        case 'xoa':
          return name ? { kind: 'friend', op: FriendOp.Remove, name } : { kind: 'error', message: 'Dùng: /friend remove tên' };
        case 'accept':
        case 'ac':
        case 'dongy':
          return { kind: 'friend', op: FriendOp.Accept, name };
        case 'decline':
        case 'dc':
        case 'tuchoi':
          return { kind: 'friend', op: FriendOp.Decline, name };
        case 'list':
        case '':
          return { kind: 'friends' };
        default:
          return { kind: 'error', message: 'Dùng: /friend add|accept|decline|remove [tên] hoặc /friends' };
      }
    }
    case 'leave':
    case 'roi':
      return { kind: 'party', op: PartyOp.Leave, name: '' };
    case 'w':
    case 't':
    case 'whisper': {
      const w = /^(\S+)\s+([\s\S]+)$/.exec(rest);
      if (!w) return { kind: 'error', message: 'Dùng: /w tên nội dung' };
      if (utf8Bytes(w[1]!) > CHAT_LIMITS.MAX_NAME_BYTES) return { kind: 'error', message: CHAT_REASON_TEXT[ChatReason.NoSuchPlayer]! };
      return send(ChatChannel.Whisper, w[2]!, w[1]!);
    }
    case 'r':
    case 'reply': {
      if (!ctx.lastWhisperFrom) return { kind: 'error', message: 'Chưa có ai nhắn riêng cho bạn.' };
      return send(ChatChannel.Whisper, rest, ctx.lastWhisperFrom);
    }
    default:
      return { kind: 'error', message: `Lệnh không rõ: /${m[1]}. Gõ /help.` };
  }
}

const CHANNEL_TAG: Readonly<Record<number, string>> = {
  [ChatChannel.World]: 'Thế giới',
  [ChatChannel.Zone]: 'Vùng',
  [ChatChannel.Whisper]: 'Thì thầm',
  [ChatChannel.Party]: 'Đội',
};
const CHANNEL_TONE: Readonly<Record<number, ChatTone>> = {
  [ChatChannel.World]: 'world',
  [ChatChannel.Zone]: 'zone',
  [ChatChannel.Whisper]: 'whisper',
  [ChatChannel.Party]: 'party',
};

export interface ChatLogOptions {
  /** the local player's name (whispers sent by me are echoed back to me) */
  myName: () => string;
  /** lines kept (oldest dropped) */
  max?: number;
  /** `/trade` alone was typed: show the trade window (the panel, or its text lines) */
  onTrade?: () => void;
  /** `/sect` was typed: show the sect panel (or its text lines) */
  onSect?: () => void;
  /** `/friends` was typed: show the friend list (the panel, or its text lines) */
  onFriends?: () => void;
}

export type SendChat = (m: { channel: number; text: string; target: string; clientMsgId: number }) => boolean;
export type SendParty = (m: { op: number; name: string; clientMsgId: number }) => boolean;
export type SendTrade = (m: {
  op: number;
  clientMsgId: number;
  name: string;
  slot: number;
  qty: number;
  currency: number;
  amount: number;
}) => boolean;
export type SendSect = (m: { op: number; manual: number; clientMsgId: number }) => boolean;
export type SendFriend = (m: { op: number; name: string; clientMsgId: number }) => boolean;

export class ChatLog {
  readonly entries: ChatEntry[] = [];
  /** name of the last player who whispered me (for `/r`) */
  lastWhisperFrom: string | null = null;
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  private nextId = 1;
  private msgId = 0;
  private readonly max: number;

  constructor(private readonly o: ChatLogOptions) {
    this.max = o.max ?? 200;
  }

  /** Display form of a line: `[Thế giới] alice: hi`, `[Thì thầm] alice → bạn: psst`, `[Thì thầm] bạn → bob: psst`. */
  format(l: ChatLine): string {
    const tag = `[${CHANNEL_TAG[l.channel] ?? '?'}]`;
    if (l.channel !== ChatChannel.Whisper) return `${tag} ${l.senderName}: ${l.text}`;
    const mine = l.senderName === this.o.myName();
    return `${tag} ${mine ? 'bạn' : l.senderName} → ${mine ? l.toName : 'bạn'}: ${l.text}`;
  }

  private push(tone: ChatTone, text: string, channel: number | null): ChatEntry {
    const e: ChatEntry = { id: this.nextId++, tone, text, channel };
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    this.version++;
    return e;
  }

  /** A line from the server (own whispers come back as an echo). */
  applyMsg(m: ChatMsgMsg): ChatEntry {
    if (m.channel === ChatChannel.Whisper && m.senderName !== this.o.myName()) this.lastWhisperFrom = m.senderName;
    return this.push(CHANNEL_TONE[m.channel] ?? 'world', this.format(m), m.channel);
  }

  applyHistory(m: ChatHistoryMsg): void {
    for (const l of m.lines) this.push(CHANNEL_TONE[l.channel] ?? 'world', this.format(l), l.channel);
  }

  /** The server's answer to one of our lines: nothing to show when it was delivered, a system line saying why not otherwise. */
  applyResult(m: ChatResultMsg): ChatEntry | null {
    if (m.reason === ChatReason.Ok) return null;
    return this.push('error', CHAT_REASON_TEXT[m.reason] ?? `Tin bị từ chối (mã ${m.reason}).`, null);
  }

  system(text: string, tone: ChatTone = 'system'): ChatEntry {
    return this.push(tone, text, null);
  }

  /** uint16 id for the next outgoing line (wraps), echoed in the result. */
  nextClientMsgId(): number {
    this.msgId = (this.msgId + 1) & 0xffff;
    return this.msgId;
  }

  /**
   * What the player typed. Local mistakes and `/help` are answered here; a good line goes to `send` (false = socket closed -> told so).
   * Returns true when something was sent.
   */
  submit(
    raw: string,
    send: SendChat,
    sendParty?: SendParty,
    sendSect?: SendSect,
    sendFriend?: SendFriend,
    sendTrade?: SendTrade,
  ): boolean {
    const p = parseChatInput(raw, { lastWhisperFrom: this.lastWhisperFrom });
    switch (p.kind) {
      case 'empty':
        return false;
      case 'help':
        for (const l of CHAT_HELP.split('\n')) this.system(l);
        return false;
      case 'error':
        this.system(p.message, 'error');
        return false;
      case 'trades':
        this.o.onTrade?.();
        return false;
      case 'trade': {
        if (!sendTrade) {
          this.system('Giao dịch chưa dùng được.', 'error');
          return false;
        }
        const ok = sendTrade({
          op: p.op,
          clientMsgId: this.nextClientMsgId(),
          name: p.name,
          slot: p.slot,
          qty: p.qty,
          currency: p.currency,
          amount: p.amount,
        });
        if (!ok) this.system('Chưa kết nối máy chủ.', 'error');
        return ok;
      }
      case 'sects':
        this.o.onSect?.();
        return false;
      case 'sect': {
        if (!sendSect) {
          this.system('Tông môn chưa dùng được.', 'error');
          return false;
        }
        const ok = sendSect({ op: p.op, manual: p.manual, clientMsgId: this.nextClientMsgId() });
        if (!ok) this.system('Chưa kết nối máy chủ.', 'error');
        return ok;
      }
      case 'friends':
        this.o.onFriends?.();
        return false;
      case 'friend': {
        if (!sendFriend) {
          this.system('Bạn bè chưa dùng được.', 'error');
          return false;
        }
        const ok = sendFriend({ op: p.op, name: p.name, clientMsgId: this.nextClientMsgId() });
        if (!ok) this.system('Chưa kết nối máy chủ.', 'error');
        return ok;
      }
      case 'party': {
        if (!sendParty) {
          this.system('Tổ đội chưa dùng được.', 'error');
          return false;
        }
        const ok = sendParty({ op: p.op, name: p.name, clientMsgId: this.nextClientMsgId() });
        if (!ok) this.system('Chưa kết nối máy chủ.', 'error');
        return ok;
      }
      case 'send': {
        const ok = send({ channel: p.channel, text: p.text, target: p.target, clientMsgId: this.nextClientMsgId() });
        if (!ok) this.system('Chưa kết nối máy chủ.', 'error');
        return ok;
      }
    }
  }
}
