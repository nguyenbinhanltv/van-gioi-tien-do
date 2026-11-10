import { describe, expect, it } from 'vitest';
import { TileGrid } from '@vgtd/sim';
import { CHAT_LIMITS, ChatChannel, ChatReason, decode, encode, type ChatLine, type Message } from '@vgtd/protocol';
import {
  CHAT_REASON_KEY,
  ChatLog,
  chatReasonText,
  NetClient,
  parseChatInput,
  type NetDeps,
  type SocketLike,
} from '@vgtd/client-core';

const send = (channel: number, text: string, target = '') => ({ kind: 'send', channel, target, text });

describe('parseChatInput', () => {
  it('plain text is a World line; surrounding space is trimmed; nothing is empty', () => {
    expect(parseChatInput('  hello there  ')).toEqual(send(ChatChannel.World, 'hello there'));
    expect(parseChatInput('')).toEqual({ kind: 'empty' });
    expect(parseChatInput('   \t ')).toEqual({ kind: 'empty' });
  });
  it.each([['/z'], ['/zone'], ['/v']])('%s text is the Zone channel', (cmd) => {
    expect(parseChatInput(`${cmd} anyone near?`)).toEqual(send(ChatChannel.Zone, 'anyone near?'));
  });
  it('/s and /world force the World channel; // sends a World line that starts with a slash', () => {
    expect(parseChatInput('/s shout')).toEqual(send(ChatChannel.World, 'shout'));
    expect(parseChatInput('/world shout')).toEqual(send(ChatChannel.World, 'shout'));
    expect(parseChatInput('//shrug')).toEqual(send(ChatChannel.World, '/shrug'));
  });
  it('whisper: /w name text (also /t and /whisper), the text keeps its inner spaces', () => {
    expect(parseChatInput('/w bob  hi   there')).toEqual(send(ChatChannel.Whisper, 'hi   there', 'bob'));
    expect(parseChatInput('/T BOB x')).toEqual(send(ChatChannel.Whisper, 'x', 'BOB'));
    expect(parseChatInput('/whisper bob_2 y')).toEqual(send(ChatChannel.Whisper, 'y', 'bob_2'));
  });
  it('malformed whispers and unknown commands are local errors', () => {
    for (const bad of ['/w', '/w bob', '/w   ', '/zzz hi', '/z']) expect(parseChatInput(bad).kind, bad).toBe('error');
    expect(parseChatInput('/w bob')).toEqual({ kind: 'error', message: 'Dùng: /w tên nội dung' });
    expect(parseChatInput('/nope x')).toEqual({ kind: 'error', message: 'Lệnh không rõ: /nope. Gõ /help.' });
    expect(parseChatInput('/w ' + 'a'.repeat(25) + ' hi').kind).toBe('error'); // a name is never longer than 24 bytes
  });
  it('/help and /? ask for help', () => {
    for (const h of ['/help', '/?', '/H']) expect(parseChatInput(h)).toEqual({ kind: 'help' });
  });
  it('/r replies to the last whisperer and says so when there is none', () => {
    expect(parseChatInput('/r thanks', { lastWhisperFrom: 'carol' })).toEqual(
      send(ChatChannel.Whisper, 'thanks', 'carol'),
    );
    expect(parseChatInput('/r thanks', { lastWhisperFrom: null })).toEqual({
      kind: 'error',
      message: 'Chưa có ai nhắn riêng cho bạn.',
    });
  });
  it('length is checked in bytes: 128 Vietnamese "đ" fit, 129 do not', () => {
    expect(parseChatInput('đ'.repeat(128)).kind).toBe('send');
    expect(parseChatInput('đ'.repeat(129))).toEqual({ kind: 'error', message: chatReasonText(ChatReason.TooLong) });
    expect(parseChatInput('a'.repeat(CHAT_LIMITS.MAX_TEXT_BYTES)).kind).toBe('send');
    expect(parseChatInput('a'.repeat(CHAT_LIMITS.MAX_TEXT_BYTES + 1)).kind).toBe('error');
  });
});

const line = (o: Partial<ChatLine> = {}): ChatLine => ({
  channel: ChatChannel.World,
  senderId: 7,
  senderName: 'alice',
  toName: '',
  ts: 1,
  text: 'hi',
  ...o,
});

describe('ChatLog', () => {
  const log = () => new ChatLog({ myName: () => 'me', max: 5 });

  it('formats every channel, whispers read from my side', () => {
    const l = log();
    expect(l.format(line())).toBe('[Thế giới] alice: hi');
    expect(l.format(line({ channel: ChatChannel.Zone }))).toBe('[Vùng] alice: hi');
    expect(l.format(line({ channel: ChatChannel.Whisper, toName: 'me' }))).toBe('[Thì thầm] alice → bạn: hi');
    expect(l.format(line({ channel: ChatChannel.Whisper, senderName: 'me', toName: 'bob' }))).toBe(
      '[Thì thầm] bạn → bob: hi',
    );
  });
  it('keeps only the newest lines, with increasing ids and a bumping version', () => {
    const l = log();
    const v0 = l.version;
    for (let k = 0; k < 8; k++) l.applyMsg({ type: 'chat_msg', ...line({ text: `m${k}` }) });
    expect(l.entries).toHaveLength(5);
    expect(l.entries.map((e) => e.text.slice(-2))).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
    const ids = l.entries.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(l.version).toBe(v0 + 8);
  });
  it('history lines are added in order; only a whisper TO me sets the /r target (not my own echo)', () => {
    const l = log();
    l.applyHistory({ type: 'chat_history', lines: [line({ text: 'a' }), line({ text: 'b', senderName: 'bob' })] });
    expect(l.entries.map((e) => e.text)).toEqual(['[Thế giới] alice: a', '[Thế giới] bob: b']);
    l.applyMsg({ type: 'chat_msg', ...line({ channel: ChatChannel.Whisper, senderName: 'carol', toName: 'me' }) });
    expect(l.lastWhisperFrom).toBe('carol');
    l.applyMsg({ type: 'chat_msg', ...line({ channel: ChatChannel.Whisper, senderName: 'me', toName: 'dave' }) });
    expect(l.lastWhisperFrom).toBe('carol');
  });
  it('a delivered result shows nothing; a refusal shows its Vietnamese reason as an error line', () => {
    const l = log();
    expect(l.applyResult({ type: 'chat_result', clientMsgId: 1, reason: ChatReason.Ok })).toBeNull();
    const e = l.applyResult({ type: 'chat_result', clientMsgId: 2, reason: ChatReason.RateLimited })!;
    expect(e).toMatchObject({ tone: 'error', text: chatReasonText(ChatReason.RateLimited) });
    expect(l.applyResult({ type: 'chat_result', clientMsgId: 3, reason: 200 })!.text).toBe('Tin bị từ chối (mã 200).');
  });
  it('every wire reason has a Vietnamese text', () => {
    for (const k of Object.keys(ChatReason)
      .filter((x) => /^\d+$/.test(x))
      .map(Number)) {
      expect(k in CHAT_REASON_KEY, `reason ${k}`).toBe(true);
      if (k !== ChatReason.Ok) expect(chatReasonText(k).length).toBeGreaterThan(5);
    }
  });
  it('client message ids count up and wrap at 16 bits', () => {
    const l = log();
    expect([l.nextClientMsgId(), l.nextClientMsgId()]).toEqual([1, 2]);
    for (let k = 0; k < 65533; k++) l.nextClientMsgId();
    expect(l.nextClientMsgId()).toBe(0); // 65535 was the last id of the loop above
    expect(l.nextClientMsgId()).toBe(1);
  });
  it('submit: sends good lines, answers help / errors locally, tells about a closed socket', () => {
    const l = log();
    const sent: unknown[] = [];
    const ok = (m: unknown): boolean => {
      sent.push(m);
      return true;
    };
    expect(l.submit('hello', ok)).toBe(true);
    expect(sent).toEqual([{ channel: ChatChannel.World, text: 'hello', target: '', clientMsgId: 1 }]);
    expect(l.submit('   ', ok)).toBe(false);
    expect(l.submit('/w bob', ok)).toBe(false);
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error', text: 'Dùng: /w tên nội dung' });
    expect(l.submit('/help', ok)).toBe(false);
    expect(l.entries.at(-1)!.tone).toBe('system');
    expect(sent).toHaveLength(1);
    expect(l.submit('x', () => false)).toBe(false);
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error', text: 'Chưa kết nối máy chủ.' });
  });
});

// ---------------------------------------------------------------- NetClient wiring
class FakeSocket implements SocketLike {
  static last: FakeSocket;
  binaryType = '';
  readyState = 1;
  sent: (string | Uint8Array)[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.({}));
  }
  send(d: string | Uint8Array): void {
    this.sent.push(d);
    if (typeof d === 'string')
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({ type: 'hello_ack', entityId: 1, protocol: 4, mapTiles: 64, classId: 1 }),
        }),
      );
  }
  close(): void {
    this.readyState = 3;
  }
  push(m: Message): void {
    const b = encode(m);
    this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  }
}
const deps: NetDeps = {
  fetch: async (url) => ({ status: url.endsWith('/auth/register') ? 201 : 200, json: async () => ({ token: 'tok' }) }),
  WebSocket: FakeSocket as unknown as NetDeps['WebSocket'],
  now: () => 1000,
};
async function connected(): Promise<{ net: NetClient; sock: FakeSocket }> {
  const net = new NetClient({
    baseUrl: 'http://x',
    username: 'u',
    password: 'p',
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
  });
  await net.connect();
  return { net, sock: FakeSocket.last };
}

describe('NetClient chat wiring', () => {
  it('delivers chat_msg / chat_history / chat_result to chatEvents, survives `events` being replaced, isolates a throwing hook', async () => {
    const { net, sock } = await connected();
    const log: string[] = [];
    net.chatEvents = {
      onChatMsg: (m) => log.push(`msg ${m.text}`),
      onChatHistory: (m) => log.push(`history ${m.lines.length}`),
      onChatResult: (m) => {
        log.push(`result ${m.reason}`);
        throw new Error('boom');
      },
    };
    net.events = {}; // combat attaching later replaces the whole events object
    sock.push({ type: 'chat_history', lines: [line(), line()] });
    sock.push({ type: 'chat_msg', ...line({ text: 'yo' }) });
    sock.push({ type: 'chat_result', clientMsgId: 1, reason: ChatReason.Muted });
    sock.push({ type: 'chat_msg', ...line({ text: 'after the throw' }) });
    expect(log).toEqual(['history 2', 'msg yo', `result ${ChatReason.Muted}`, 'msg after the throw']);
    expect(net.lastError).toBe('hook: boom');
    expect(net.status).toBe('online');
  });
  it('sendChat writes a chat_send frame; false when the socket is closed or the line cannot be encoded', async () => {
    const { net, sock } = await connected();
    const frames = () => sock.sent.filter((x): x is Uint8Array => typeof x !== 'string').map((b) => decode(b));
    expect(net.sendChat({ channel: ChatChannel.World, text: 'hi', clientMsgId: 70000 })).toBe(true); // id wraps to 16 bits
    expect(net.sendChat({ channel: ChatChannel.Whisper, text: 'psst', target: 'bob', clientMsgId: 2 })).toBe(true);
    expect(frames()).toEqual([
      { type: 'chat_send', channel: 1, clientMsgId: 70000 & 0xffff, target: '', text: 'hi' },
      { type: 'chat_send', channel: 3, clientMsgId: 2, target: 'bob', text: 'psst' },
    ]);
    expect(net.sendChat({ channel: ChatChannel.World, text: 'a'.repeat(300), clientMsgId: 3 })).toBe(false); // not encodable
    expect(net.sendChat({ channel: ChatChannel.Whisper, text: 'x', clientMsgId: 4 })).toBe(false); // a whisper needs a target
    expect(frames()).toHaveLength(2);
    sock.readyState = 3;
    expect(net.sendChat({ channel: ChatChannel.World, text: 'late', clientMsgId: 5 })).toBe(false);
  });
});
