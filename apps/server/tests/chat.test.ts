import { describe, expect, it } from 'vitest';
import { AOI } from '@vgtd/shared';
import {
  CHAT_LIMITS,
  ChatChannel,
  ChatReason,
  ErrorCode,
  decode,
  encode,
  type ChatMsgMsg,
  type ChatSendMsg,
  type Message,
} from '@vgtd/protocol';
import { CHAT_CONFIG, ChatService, WorldNode, maskBanned, sanitize, type ClientTransport } from '../src/index.js';

// ------------------------------------------------------------------ service units
interface Rig {
  chat: ChatService;
  got: Map<number, ChatMsgMsg[]>;
  at: Map<number, { i: number; j: number }>;
  say(id: number, text: string, channel?: number, target?: string, now?: number, clientMsgId?: number): ChatReason;
}
function rig(opts: ConstructorParameters<typeof ChatService>[0] = {}): Rig {
  const chat = new ChatService(opts);
  const got = new Map<number, ChatMsgMsg[]>();
  const at = new Map<number, { i: number; j: number }>();
  chat.attach({
    deliver: (id, m) => {
      const l = got.get(id) ?? [];
      l.push(m);
      got.set(id, l);
    },
    posOf: (id) => at.get(id),
  });
  for (const [id, name] of [
    [1, 'alice'],
    [2, 'bob'],
    [3, 'carol'],
  ] as const) {
    chat.join({ entityId: id, accountId: `acc-${name}`, name });
    at.set(id, { i: 100, j: 100 });
  }
  return {
    chat,
    got,
    at,
    say(id, text, channel = ChatChannel.World, target = '', now = 10_000, clientMsgId = 1) {
      const msg: ChatSendMsg = { type: 'chat_send', channel, clientMsgId, target, text };
      return chat.handle(id, msg, now).reason;
    },
  };
}
const texts = (r: Rig, id: number) => (r.got.get(id) ?? []).map((m) => m.text);

describe('World channel', () => {
  it('reaches everyone, sender included, with the server-decided sender', () => {
    const r = rig();
    expect(r.say(1, 'hello world')).toBe(ChatReason.Ok);
    for (const id of [1, 2, 3]) expect(r.got.get(id)).toHaveLength(1);
    expect(r.got.get(2)![0]).toMatchObject({
      type: 'chat_msg',
      channel: ChatChannel.World,
      senderId: 1,
      senderName: 'alice',
      toName: '',
      ts: 10_000,
      text: 'hello world',
    });
  });
  it('every chat_send is answered with its clientMsgId, accepted or not', () => {
    const r = rig();
    const ok = r.chat.handle(1, { type: 'chat_send', channel: 1, clientMsgId: 77, target: '', text: 'hi' }, 0);
    const bad = r.chat.handle(1, { type: 'chat_send', channel: 1, clientMsgId: 78, target: '', text: '   ' }, 0);
    expect(ok).toEqual({ type: 'chat_result', clientMsgId: 77, reason: ChatReason.Ok });
    expect(bad).toEqual({ type: 'chat_result', clientMsgId: 78, reason: ChatReason.Empty });
  });
  it('a player that has not joined (or left) gets NotReady and nothing is delivered', () => {
    const r = rig();
    expect(r.say(99, 'ghost')).toBe(ChatReason.NotReady);
    r.chat.leave(2);
    expect(r.say(2, 'after leaving')).toBe(ChatReason.NotReady);
    r.say(1, 'still here');
    expect(r.got.get(2)).toBeUndefined();
  });
  it('keeps a ring of recent lines for newcomers (oldest dropped, wire cap respected)', () => {
    const r = rig({ historyRing: 5 });
    for (let k = 0; k < 8; k++) r.say(1, `line ${k}`, ChatChannel.World, '', 100_000 * (k + 1)); // far apart in time: no rate limit
    expect(r.chat.history().map((l) => l.text)).toEqual(['line 3', 'line 4', 'line 5', 'line 6', 'line 7']);
    expect(r.chat.history(2).map((l) => l.text)).toEqual(['line 6', 'line 7']);
    const big = rig({ historyRing: 500 });
    for (let k = 0; k < 120; k++) big.say(1, `n${k}`, ChatChannel.World, '', 100_000 * (k + 1));
    expect(big.chat.history(1000)).toHaveLength(CHAT_LIMITS.MAX_HISTORY);
  });
  it('zone / whisper lines never enter the World history', () => {
    const r = rig();
    r.say(1, 'zone only', ChatChannel.Zone);
    r.say(1, 'psst', ChatChannel.Whisper, 'bob');
    expect(r.chat.history()).toEqual([]);
  });
});

describe('text hygiene', () => {
  it('control characters become spaces, invisible / bidi-override characters vanish, whitespace collapses', () => {
    expect(sanitize('  a\nb\t\tc\u0000d  ')).toBe('a b c d');
    expect(sanitize('ad‮min​⁦x⁩﻿')).toBe('adminx');
    expect(sanitize('\u0007\u001b[31mred')).toBe('[31mred');
    expect(sanitize('   ')).toBe('');
  });
  it('a line that is nothing but control / invisible characters is Empty', () => {
    const r = rig();
    expect(r.say(1, '\n\n\t​‮')).toBe(ChatReason.Empty);
    expect(r.got.size).toBe(0);
  });
  it('delivered text is the sanitised text', () => {
    const r = rig();
    r.say(1, 'line one\nline two‮');
    expect(texts(r, 2)).toEqual(['line one line two']);
  });
  it('placeholder banned words are masked ignoring case and diacritics, on the ORIGINAL characters', () => {
    expect(maskBanned('say CursewordX now', ['cursewordx'])).toBe('say ********** now');
    expect(maskBanned('PLACEHOLDERBAD', ['placeholderbad'])).toBe('**************');
    expect(maskBanned('chửi đồ ngốc', ['do ngoc'])).toBe('chửi *******');
    expect(maskBanned('hello', [])).toBe('hello');
    expect(maskBanned('hello', ['', 'xyz'])).toBe('hello');
    expect(maskBanned('aXbxc', ['x'])).toBe('a*b*c');
  });
  it('the service filters with the default placeholder list and with an injected list', () => {
    const r = rig();
    r.say(1, `you ${CHAT_CONFIG.PLACEHOLDER_BANNED[0]}!`);
    expect(texts(r, 2)[0]).toMatch(/^you \*+!$/);
    const custom = rig({ bannedWords: ['spam'] });
    custom.say(1, 'SPAM and cursewordx');
    expect(texts(custom, 2)).toEqual(['**** and cursewordx']);
  });
});

describe('rate limits (per account and channel kind, docs/24 §7 proposals)', () => {
  it('World: burst of 2, then refused, then one more line per 5 s', () => {
    const r = rig();
    expect([1, 2, 3].map((k) => r.say(1, `m${k}`, ChatChannel.World, '', 0))).toEqual([
      ChatReason.Ok,
      ChatReason.Ok,
      ChatReason.RateLimited,
    ]);
    expect(r.say(1, 'later', ChatChannel.World, '', 4900)).toBe(ChatReason.RateLimited);
    expect(r.say(1, 'later', ChatChannel.World, '', 5000)).toBe(ChatReason.Ok);
    expect(r.say(1, 'again', ChatChannel.World, '', 5100)).toBe(ChatReason.RateLimited);
    expect(r.chat.metrics.refused[ChatReason.RateLimited]).toBe(3);
  });
  it('a refused line is not delivered and does not spend a token', () => {
    const r = rig();
    r.say(1, 'a', ChatChannel.World, '', 0);
    r.say(1, 'b', ChatChannel.World, '', 0);
    r.say(1, 'c', ChatChannel.World, '', 0); // refused
    expect(texts(r, 2)).toEqual(['a', 'b']);
  });
  it('channels are limited independently, and one player cannot use up another one’s allowance', () => {
    const r = rig();
    r.say(1, 'w1', ChatChannel.World, '', 0);
    r.say(1, 'w2', ChatChannel.World, '', 0);
    expect(r.say(1, 'w3', ChatChannel.World, '', 0)).toBe(ChatReason.RateLimited);
    expect(r.say(1, 'z', ChatChannel.Zone, '', 0)).toBe(ChatReason.Ok);
    expect(r.say(1, 'p', ChatChannel.Whisper, 'bob', 0)).toBe(ChatReason.Ok);
    expect(r.say(2, 'bob can still talk', ChatChannel.World, '', 0)).toBe(ChatReason.Ok);
  });
  it('the limit follows the ACCOUNT: a second connection of one account does not double it', () => {
    const r = rig();
    r.chat.join({ entityId: 4, accountId: 'acc-alice', name: 'alice2' });
    r.at.set(4, { i: 100, j: 100 });
    r.say(1, 'a', ChatChannel.World, '', 0);
    r.say(4, 'b', ChatChannel.World, '', 0);
    expect(r.say(1, 'c', ChatChannel.World, '', 0)).toBe(ChatReason.RateLimited);
    expect(r.say(4, 'd', ChatReason.Ok, '', 0)).toBe(ChatReason.BadChannel); // channel 0 never exists
  });
  it('an hour later the allowance is full again but never above the burst', () => {
    const r = rig();
    for (let k = 0; k < 3; k++) r.say(1, `x${k}`, ChatChannel.World, '', 0);
    const later = 3_600_000;
    expect([1, 2, 3].map((k) => r.say(1, `y${k}`, ChatChannel.World, '', later))).toEqual([
      ChatReason.Ok,
      ChatReason.Ok,
      ChatReason.RateLimited,
    ]);
  });
});

describe('mute', () => {
  it('a muted account cannot speak anywhere (whispers included); the mute expires on the sim clock', () => {
    const r = rig();
    r.chat.mute('acc-alice', 60_000);
    expect(r.say(1, 'x', ChatChannel.World, '', 1000)).toBe(ChatReason.Muted);
    expect(r.say(1, 'x', ChatChannel.Zone, '', 1000)).toBe(ChatReason.Muted);
    expect(r.say(1, 'x', ChatChannel.Whisper, 'bob', 1000)).toBe(ChatReason.Muted);
    expect(r.got.size).toBe(0);
    expect(r.say(1, 'free again', ChatChannel.World, '', 60_000)).toBe(ChatReason.Ok);
    expect(r.chat.isMuted('acc-alice', 60_001)).toBe(false);
  });
  it('unmute lifts it at once, an Infinity mute lasts, and muting one account leaves the others alone', () => {
    const r = rig();
    r.chat.mute('acc-alice', Infinity);
    expect(r.say(1, 'x', ChatChannel.World, '', 1e12)).toBe(ChatReason.Muted);
    expect(r.say(2, 'bob talks', ChatChannel.World, '', 1e12)).toBe(ChatReason.Ok);
    r.chat.unmute('acc-alice');
    expect(r.say(1, 'back', ChatChannel.World, '', 1e12)).toBe(ChatReason.Ok);
  });
  it('a muted player still RECEIVES chat', () => {
    const r = rig();
    r.chat.mute('acc-alice', Infinity);
    r.say(2, 'hello alice', ChatChannel.World, '', 0);
    expect(texts(r, 1)).toEqual(['hello alice']);
  });
});

describe('whisper', () => {
  it('goes to the target and echoes to the sender; the name match ignores case', () => {
    const r = rig();
    expect(r.say(1, 'secret', ChatChannel.Whisper, 'BoB')).toBe(ChatReason.Ok);
    expect(r.got.get(2)).toEqual([
      expect.objectContaining({ channel: ChatChannel.Whisper, senderName: 'alice', toName: 'bob', text: 'secret' }),
    ]);
    expect(r.got.get(1)).toEqual(r.got.get(2)); // the echo is the same line: "alice -> bob"
    expect(r.got.get(3)).toBeUndefined(); // nobody else sees it
  });
  it('unknown and offline targets are the same answer (no way to probe who exists), and cost no token', () => {
    const r = rig();
    r.chat.leave(3);
    expect(r.say(1, 'x', ChatChannel.Whisper, 'carol')).toBe(ChatReason.NoSuchPlayer); // was online, left
    expect(r.say(1, 'x', ChatChannel.Whisper, 'nobody_here')).toBe(ChatReason.NoSuchPlayer);
    for (let k = 0; k < 3; k++)
      expect(r.say(1, `ok${k}`, ChatChannel.Whisper, 'bob', 0)).toBe(k < 3 ? ChatReason.Ok : ChatReason.RateLimited);
  });
  it('whispering yourself is refused', () => {
    const r = rig();
    expect(r.say(1, 'me', ChatChannel.Whisper, 'ALICE')).toBe(ChatReason.SelfWhisper);
  });
  it('rate limited per account: 3 in a burst, then 1 per 2 s', () => {
    const r = rig();
    expect([1, 2, 3, 4].map((k) => r.say(1, `w${k}`, ChatChannel.Whisper, 'bob', 0))).toEqual([
      ChatReason.Ok,
      ChatReason.Ok,
      ChatReason.Ok,
      ChatReason.RateLimited,
    ]);
    expect(r.say(1, 'w5', ChatChannel.Whisper, 'bob', 2000)).toBe(ChatReason.Ok);
  });
  it('a renamed / replaced name entry does not leave the old owner reachable', () => {
    const r = rig();
    r.chat.leave(2);
    r.chat.join({ entityId: 5, accountId: 'acc-bob2', name: 'bob' }); // a new session of the name
    r.say(1, 'to the new bob', ChatChannel.Whisper, 'bob');
    expect(r.got.get(5)).toHaveLength(1);
    expect(r.got.get(2)).toBeUndefined();
  });
});

describe('zone', () => {
  it('reaches players inside the sender’s AOI box (the area the sender sees) and nobody else', () => {
    const r = rig();
    r.at.set(1, { i: 100, j: 100 });
    r.at.set(2, { i: 100 + AOI.HALF_U / 2, j: 100 }); // u = i - j differs by 20: inside
    r.at.set(3, { i: 100 + AOI.HALF_U * 2, j: 100 }); // u differs by 80: outside
    r.say(1, 'anyone near?', ChatChannel.Zone);
    expect(texts(r, 1)).toEqual(['anyone near?']);
    expect(texts(r, 2)).toEqual(['anyone near?']);
    expect(r.got.get(3)).toBeUndefined();
  });
  it('the box edges follow the AOI constants (u and w separately)', () => {
    const r = rig();
    r.at.set(1, { i: 150, j: 150 });
    // a player exactly HALF_U away on the u axis is in; one tile further is out
    r.at.set(2, { i: 150 + AOI.HALF_U / 2, j: 150 - AOI.HALF_U / 2 }); // du = HALF_U, dw = 0
    r.at.set(3, { i: 150 + (AOI.HALF_U + 2) / 2, j: 150 - (AOI.HALF_U + 2) / 2 }); // du = HALF_U + 2
    r.say(1, 'edge', ChatChannel.Zone);
    expect(texts(r, 2)).toEqual(['edge']);
    expect(r.got.get(3)).toBeUndefined();
    // w axis
    const w = rig();
    w.at.set(1, { i: 150, j: 150 });
    w.at.set(2, { i: 150 + AOI.HALF_W / 2, j: 150 + AOI.HALF_W / 2 }); // dw = HALF_W
    w.at.set(3, { i: 150 + (AOI.HALF_W + 2) / 2, j: 150 + (AOI.HALF_W + 2) / 2 });
    w.say(1, 'edge', ChatChannel.Zone);
    expect(texts(w, 2)).toEqual(['edge']);
    expect(w.got.get(3)).toBeUndefined();
  });
  it('is not stored in the World history', () => {
    const r = rig();
    r.say(1, 'zone', ChatChannel.Zone);
    expect(r.chat.history()).toEqual([]);
  });
});

describe('channels that do not exist', () => {
  it.each([[0], [5], [255]])('channel %i is BadChannel', (channel) => {
    const r = rig();
    expect(r.say(1, 'x', channel)).toBe(ChatReason.BadChannel);
    expect(r.got.size).toBe(0);
  });
});

// ------------------------------------------------------------------ over the binary protocol, through the WorldNode
class Fake implements ClientTransport {
  msgs: Message[] = [];
  closed: { code: ErrorCode; text: string } | null = null;
  send(d: Uint8Array): void {
    this.msgs.push(decode(d));
  }
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return 0;
  }
  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.msgs.filter((m): m is Extract<Message, { type: T }> => m.type === type);
  }
}
function node(chat: ChatService | null = new ChatService()) {
  const n = new WorldNode({ mapTiles: 160, spawn: { i0: 78, j0: 78, side: 4 }, ...(chat ? { chat } : {}) });
  const mk = (account: string, name: string) => {
    const t = new Fake();
    const id = n.addPlayer(t, account, undefined, name);
    return { t, id };
  };
  return { n, mk };
}
const frame = (channel: number, text: string, clientMsgId = 1, target = '') =>
  encode({ type: 'chat_send', channel, clientMsgId, target, text });

describe('WorldNode chat over the wire', () => {
  it('delivers a World line to everyone with the sender chosen by the server, and answers the sender with a result', () => {
    const { n, mk } = node();
    const a = mk('acc-a', 'alice');
    const b = mk('acc-b', 'bob');
    n.tick();
    n.receive(a.id, frame(ChatChannel.World, 'hello bob', 9));
    expect(b.t.of('chat_msg')).toEqual([
      expect.objectContaining({ senderId: a.id, senderName: 'alice', text: 'hello bob', channel: ChatChannel.World }),
    ]);
    expect(a.t.of('chat_msg')).toHaveLength(1);
    expect(a.t.of('chat_result')).toEqual([{ type: 'chat_result', clientMsgId: 9, reason: ChatReason.Ok }]);
    expect(b.t.of('chat_result')).toEqual([]); // only the sender gets a result
  });
  it('a newcomer gets the recent World lines once, on the tick after joining', () => {
    const { n, mk } = node();
    const a = mk('acc-a', 'alice');
    n.tick();
    n.receive(a.id, frame(ChatChannel.World, 'before you came'));
    const late = mk('acc-late', 'late_one');
    expect(late.t.of('chat_history')).toHaveLength(0); // not before the gateway's hello_ack: next tick
    n.tick();
    expect(late.t.of('chat_history')).toEqual([
      { type: 'chat_history', lines: [expect.objectContaining({ text: 'before you came', senderName: 'alice' })] },
    ]);
    n.tick();
    expect(late.t.of('chat_history')).toHaveLength(1);
  });
  it('an empty history is not sent at all', () => {
    const { n, mk } = node();
    const a = mk('acc-a', 'alice');
    n.tick();
    expect(a.t.of('chat_history')).toHaveLength(0);
  });
  it('whispers and refusals are answered; a flood is refused, not delivered, and not a kick', () => {
    const { n, mk } = node();
    const a = mk('acc-a', 'alice');
    const b = mk('acc-b', 'bob');
    n.tick();
    n.receive(a.id, frame(ChatChannel.Whisper, 'psst', 1, 'bob'));
    n.receive(a.id, frame(ChatChannel.Whisper, 'lost', 2, 'zed'));
    expect(b.t.of('chat_msg')).toEqual([
      expect.objectContaining({ channel: ChatChannel.Whisper, senderName: 'alice', toName: 'bob' }),
    ]);
    expect(a.t.of('chat_result').map((r) => [r.clientMsgId, r.reason])).toEqual([
      [1, ChatReason.Ok],
      [2, ChatReason.NoSuchPlayer],
    ]);
    for (let k = 0; k < 10; k++) n.receive(a.id, frame(ChatChannel.World, `spam ${k}`, 100 + k));
    const results = a.t.of('chat_result').filter((r) => r.clientMsgId >= 100);
    expect(results.filter((r) => r.reason === ChatReason.Ok)).toHaveLength(2);
    expect(results.filter((r) => r.reason === ChatReason.RateLimited)).toHaveLength(8);
    expect(a.t.closed).toBeNull();
  });
  it('a muted player is refused, and a player who left is no longer reachable by whisper', () => {
    const chat = new ChatService();
    const { n, mk } = node(chat);
    const a = mk('acc-a', 'alice');
    const b = mk('acc-b', 'bob');
    n.tick();
    chat.mute('acc-a', Infinity);
    n.receive(a.id, frame(ChatChannel.World, 'x', 5));
    expect(a.t.of('chat_result')).toEqual([{ type: 'chat_result', clientMsgId: 5, reason: ChatReason.Muted }]);
    expect(b.t.of('chat_msg')).toHaveLength(0);
    n.removePlayer(b.id);
    chat.unmute('acc-a');
    n.receive(a.id, frame(ChatChannel.Whisper, 'x', 6, 'bob'));
    expect(a.t.of('chat_result').at(-1)).toEqual({
      type: 'chat_result',
      clientMsgId: 6,
      reason: ChatReason.NoSuchPlayer,
    });
  });
  it('a node without chat rejects chat_send like any unexpected message', () => {
    const { n, mk } = node(null);
    const a = mk('acc-a', 'alice');
    n.receive(a.id, frame(ChatChannel.World, 'x'));
    expect(a.t.of('error').at(-1)).toMatchObject({ code: ErrorCode.BadMessage });
  });
  it('clients cannot send server-to-client chat messages (no spoofed chat_msg)', () => {
    const { n, mk } = node();
    const a = mk('acc-a', 'alice');
    const b = mk('acc-b', 'bob');
    n.receive(
      a.id,
      encode({
        type: 'chat_msg',
        channel: 1,
        senderId: b.id,
        senderName: 'bob',
        toName: '',
        ts: 1,
        text: 'bob says hi',
      }),
    );
    expect(a.t.of('error').at(-1)).toMatchObject({ code: ErrorCode.BadMessage });
    expect(b.t.of('chat_msg')).toHaveLength(0);
  });
  it('oversized text never reaches the service: the codec refuses it and the client is counted for a malformed packet', () => {
    const { n, mk } = node();
    const a = mk('acc-a', 'alice');
    const good = frame(ChatChannel.World, 'x');
    const tooBig = Uint8Array.from(good);
    tooBig[tooBig.length - 3] = 0x02; // declared text length 0x0201 > 256 (the buffer is shorter too)
    n.receive(a.id, tooBig);
    expect(a.t.of('error').at(-1)).toMatchObject({ code: ErrorCode.BadMessage });
    expect(a.t.of('chat_result')).toHaveLength(0);
    expect(CHAT_LIMITS.MAX_TEXT_BYTES).toBe(256);
  });
});
