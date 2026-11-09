/**
 * Chat model (D87): turns what the player types into a `chat_send`, and what the server sends into display lines. Engine-free and
 * DOM-free: the Cocos chat box only renders `ChatLog.entries` (as TEXT, never as markup: names and lines come from other players).
 * The server stays authoritative: this only guards obvious mistakes locally (empty, over 256 bytes, unknown command) so the player gets an
 * answer without a round trip; everything else (rate limit, mute, filter, whisper target) is decided and answered by the server.
 *
 * Commands: plain text = World channel; `/z text` Zone (everyone who can see you); `/w name text` whisper; `/r text` reply to the last
 * player who whispered you; `//text` sends a World line that starts with a slash; `/help`.
 */
import {
  CHAT_LIMITS,
  ChatChannel,
  ChatReason,
  type ChatHistoryMsg,
  type ChatLine,
  type ChatMsgMsg,
  type ChatResultMsg,
} from '@vgtd/protocol';

export type ChatTone = 'world' | 'zone' | 'whisper' | 'system' | 'error';

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
].join('\n');

export type ParsedChatInput =
  | { kind: 'empty' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'send'; channel: number; target: string; text: string };

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
  [ChatChannel.Party]: 'zone',
};

export interface ChatLogOptions {
  /** the local player's name (whispers sent by me are echoed back to me) */
  myName: () => string;
  /** lines kept (oldest dropped) */
  max?: number;
}

export type SendChat = (m: { channel: number; text: string; target: string; clientMsgId: number }) => boolean;

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
  submit(raw: string, send: SendChat): boolean {
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
      case 'send': {
        const ok = send({ channel: p.channel, text: p.text, target: p.target, clientMsgId: this.nextClientMsgId() });
        if (!ok) this.system('Chưa kết nối máy chủ.', 'error');
        return ok;
      }
    }
  }
}
