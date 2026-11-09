import { describe, expect, it } from 'vitest';
import {
  CHAT_LIMITS,
  COLD_ENVELOPE,
  ChatChannel,
  ChatReason,
  PROTOCOL_VERSION,
  ProtocolError,
  decode,
  decodeJson,
  encode,
  encodeJson,
  peekHeader,
  type ChatLine,
  type ColdMessage,
} from '../src/index.js';
import { lcg } from './helpers.js';

const line = (o: Partial<ChatLine> = {}): ChatLine => ({
  channel: ChatChannel.World,
  senderId: 7,
  senderName: 'Lý Thanh Vân',
  toName: '',
  ts: 123456,
  text: 'Xin chào, đạo hữu! 你好 🌸',
  ...o,
});
const samples: ColdMessage[] = [
  { type: 'chat_send', channel: ChatChannel.World, clientMsgId: 65535, target: '', text: 'hello' },
  { type: 'chat_send', channel: ChatChannel.Whisper, clientMsgId: 1, target: 'bob_2', text: 'psst' },
  { type: 'chat_msg', ...line() },
  { type: 'chat_msg', ...line({ channel: ChatChannel.Whisper, toName: 'bob_2', senderId: 0 }) },
  { type: 'chat_history', lines: [line(), line({ channel: ChatChannel.Zone, text: '' })] },
  { type: 'chat_history', lines: [] },
  { type: 'chat_result', clientMsgId: 9, reason: ChatReason.Muted },
];
const bytesOf = (n: number, ch = 'a') => ch.repeat(n);

describe('chat messages (cold family ids 40-43)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses the docs/24 envelope with ids 40 chat_send, 41 chat_msg, 42 chat_history, 43 chat_result', () => {
    const ids: Record<string, number> = { chat_send: 40, chat_msg: 41, chat_history: 42, chat_result: 43 };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
  });

  it('golden bytes: chat_send and chat_result', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    // channel 1, clientMsgId 0x0102, target '' (len 0), text 'hi' (u16 len 2)
    expect(
      Buffer.from(encode({ type: 'chat_send', channel: 1, clientMsgId: 0x0102, target: '', text: 'hi' })).toString(
        'hex',
      ),
    ).toBe(`${v}800028` + '01' + '0102' + '00' + '0002' + '6869');
    expect(
      Buffer.from(encode({ type: 'chat_result', clientMsgId: 3, reason: ChatReason.RateLimited })).toString('hex'),
    ).toBe(`${v}80002b` + '0003' + '01');
  });

  it('text is capped in BYTES, not characters (docs/24 §2)', () => {
    const ok = (text: string) => encode({ type: 'chat_send', channel: 1, clientMsgId: 0, target: '', text });
    expect(() => ok(bytesOf(CHAT_LIMITS.MAX_TEXT_BYTES))).not.toThrow();
    expect(() => ok(bytesOf(CHAT_LIMITS.MAX_TEXT_BYTES + 1))).toThrow(ProtocolError);
  });
  it('multibyte: Vietnamese letters count as 2-3 bytes each', () => {
    const n = (s: string) => new TextEncoder().encode(s).length;
    expect(n('ạ')).toBe(3);
    expect(n('đ')).toBe(2);
    const fits = 'đ'.repeat(128); // 256 bytes
    const tooLong = 'đ'.repeat(129);
    const send = (text: string) => encode({ type: 'chat_send', channel: 1, clientMsgId: 0, target: '', text });
    expect(() => send(fits)).not.toThrow();
    expect(() => send(tooLong)).toThrow(/longer than 256 bytes/);
  });

  it('names are capped at 24 bytes and a whisper needs exactly a target', () => {
    const base = { type: 'chat_send' as const, clientMsgId: 0, text: 'x' };
    expect(() => encode({ ...base, channel: ChatChannel.Whisper, target: bytesOf(24) })).not.toThrow();
    expect(() => encode({ ...base, channel: ChatChannel.Whisper, target: bytesOf(25) })).toThrow(ProtocolError);
    expect(() => encode({ ...base, channel: ChatChannel.Whisper, target: '' })).toThrow(/every whisper needs one/);
    expect(() => encode({ ...base, channel: ChatChannel.World, target: 'bob' })).toThrow(/only whispers/);
    expect(() => encode({ ...samples[2]!, senderName: bytesOf(25) } as ColdMessage)).toThrow(ProtocolError);
  });

  it('rejects invalid channels, ranges and non-text values', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad({ type: 'chat_send', channel: 0, clientMsgId: 0, target: '', text: 'x' });
    bad({ type: 'chat_send', channel: 5, clientMsgId: 0, target: '', text: 'x' });
    bad({ type: 'chat_send', channel: 1, clientMsgId: 65536, target: '', text: 'x' });
    bad({ type: 'chat_send', channel: 1, clientMsgId: 0, target: '', text: 5 });
    bad({ type: 'chat_send', channel: 1, clientMsgId: 0, target: '', text: '\ud800' }); // lone surrogate
    bad({ type: 'chat_msg', ...line(), ts: -1 });
    bad({ type: 'chat_msg', ...line(), senderId: 2 ** 32 });
    bad({ type: 'chat_history', lines: Array.from({ length: CHAT_LIMITS.MAX_HISTORY + 1 }, () => line()) });
    bad({ type: 'chat_history', lines: [null] });
    bad({ type: 'chat_result', clientMsgId: 0, reason: 256 });
  });

  it('decoder: truncation at every length, trailing bytes, invalid UTF-8 and over-long fields', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0])), m.type).toThrowError(/trailing/);
    }
    const b = Uint8Array.from(encode({ type: 'chat_send', channel: 1, clientMsgId: 0, target: '', text: 'ab' }));
    b[b.length - 1] = 0xff; // not UTF-8
    expect(() => decode(b)).toThrowError(/not valid UTF-8/);
    const long = Uint8Array.from(encode({ type: 'chat_send', channel: 1, clientMsgId: 0, target: '', text: 'ab' }));
    long[long.length - 4] = 0x02; // text length 0x0202 = 514 > 256 (high byte of the u16)
    expect(() => decode(long)).toThrow(ProtocolError);
  });

  it('random bytes never crash the decoder (only ProtocolError) and anything that decodes re-encodes identically', () => {
    const r = lcg(4243);
    for (let k = 0; k < 4000; k++) {
      const n = r.int(2, 60);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = r.int(40, 43);
      try {
        const m = decode(buf);
        expect(Array.from(encode(m))).toEqual(Array.from(buf));
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
      }
    }
  });
});
