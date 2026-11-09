/**
 * Chat ("cold family") messages (docs/22 §7, docs/24 ids 40-42; id 43 added by D87 so every command gets an answer).
 * Same `[ver][0x80][msgId u16][body]` envelope and fixed big-endian bodies as `progression.ts` / `inventory.ts`.
 *
 *   chat_send    C->S  one line of chat: channel, clientMsgId (echoed in the result), optional whisper target name, text <= 256 bytes
 *   chat_msg     S->C  one delivered line: channel, sender, optional recipient name (whispers), server time, text
 *   chat_history S->C  the last lines of the World channel, sent once on join
 *   chat_result  S->C  answer to every chat_send (0 = accepted), so a refusal is never silent (docs/24 §5.1)
 *
 * Text is UTF-8, validated here (valid code points, length caps in BYTES, docs/24 §2); control-character stripping, rate limits, the word
 * filter and muting are the server's job (a user typing a newline must not look like a malformed packet).
 */
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export enum ChatChannel {
  World = 1,
  Zone = 2,
  Whisper = 3,
  /** reserved for the party feature (docs/10 §7.1); the server refuses it until parties exist */
  Party = 4,
}

/** Why a chat_send was refused (0 = delivered). Values are wire-stable. */
export enum ChatReason {
  Ok = 0,
  RateLimited = 1,
  /** longer than CHAT_LIMITS.MAX_TEXT_BYTES (the codec already refuses it; the server answers the same way for text that grew while sanitising) */
  TooLong = 2,
  /** nothing left to send after sanitising */
  Empty = 3,
  Muted = 4,
  /** unknown channel, or a channel that is not open yet (Party) */
  BadChannel = 5,
  /** whisper target offline or unknown: the answer never says which */
  NoSuchPlayer = 6,
  /** the player is not in the world (yet) */
  NotReady = 7,
  /** whispering yourself */
  SelfWhisper = 8,
}

export const CHAT_LIMITS = {
  /** docs/24 §2: chat text <= 256 bytes */
  MAX_TEXT_BYTES: 256,
  /** docs/24 §2: names <= 24 bytes */
  MAX_NAME_BYTES: 24,
  /** lines in one chat_history (u8) */
  MAX_HISTORY: 50,
} as const;

export interface ChatLine {
  channel: number;
  /** entity id of the sender (0 = system) */
  senderId: number;
  senderName: string;
  /** recipient name for a whisper (so the sender's echo reads "me -> target"), '' otherwise */
  toName: string;
  /** server time, ms (uint32, wraps like the other time fields) */
  ts: number;
  text: string;
}
export interface ChatSendMsg {
  type: 'chat_send';
  channel: number;
  /** echoed in chat_result (uint16, wraps) */
  clientMsgId: number;
  /** whisper target name, '' for the other channels */
  target: string;
  text: string;
}
export interface ChatMsgMsg extends ChatLine {
  type: 'chat_msg';
}
export interface ChatHistoryMsg {
  type: 'chat_history';
  lines: readonly ChatLine[];
}
export interface ChatResultMsg {
  type: 'chat_result';
  clientMsgId: number;
  reason: number;
}
export type ChatClientMessage = ChatSendMsg;
export type ChatServerMessage = ChatMsgMsg | ChatHistoryMsg | ChatResultMsg;
export type ChatMessage = ChatClientMessage | ChatServerMessage;

type Rec = Record<string, unknown>;
const U16 = 0xffff;
const U32 = 0xffffffff;
const ENC = new TextEncoder();
const DEC = new TextDecoder('utf-8', { fatal: true });

function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}
/** A string whose UTF-8 form fits `maxBytes` (and is not lone-surrogate garbage: those do not survive an encode/decode round trip). */
function str(x: unknown, maxBytes: number, what: string): string {
  if (typeof x !== 'string') throw new ProtocolError('malformed', `${what} must be a string`);
  const bytes = ENC.encode(x);
  if (bytes.length > maxBytes) throw new ProtocolError('range', `${what} is longer than ${maxBytes} bytes`);
  if (DEC.decode(bytes) !== x) throw new ProtocolError('malformed', `${what} is not valid Unicode text`);
  return x;
}
const channel = (x: unknown): number => int(x, 1, 4, 'channel');

function line(o: Rec): ChatLine {
  return {
    channel: channel(o.channel),
    senderId: int(o.senderId, 0, U32, 'senderId'),
    senderName: str(o.senderName, CHAT_LIMITS.MAX_NAME_BYTES, 'senderName'),
    toName: str(o.toName, CHAT_LIMITS.MAX_NAME_BYTES, 'toName'),
    ts: int(o.ts, 0, U32, 'ts'),
    text: str(o.text, CHAT_LIMITS.MAX_TEXT_BYTES, 'text'),
  };
}

/** The normalised chat message for `o.type`, or null when it is not one. */
export function validateChatMessage(o: Rec): ChatMessage | null {
  switch (o.type) {
    case 'chat_send': {
      const ch = channel(o.channel);
      const target = str(o.target, CHAT_LIMITS.MAX_NAME_BYTES, 'target');
      if ((ch === ChatChannel.Whisper) !== target.length > 0)
        throw new ProtocolError('malformed', 'only whispers carry a target name, and every whisper needs one');
      return {
        type: 'chat_send',
        channel: ch,
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        target,
        text: str(o.text, CHAT_LIMITS.MAX_TEXT_BYTES, 'text'),
      };
    }
    case 'chat_msg':
      return { type: 'chat_msg', ...line(o) };
    case 'chat_history': {
      if (!Array.isArray(o.lines) || o.lines.length > CHAT_LIMITS.MAX_HISTORY)
        throw new ProtocolError('range', `lines must be an array of at most ${CHAT_LIMITS.MAX_HISTORY}`);
      return {
        type: 'chat_history',
        lines: o.lines.map((l) => {
          if (typeof l !== 'object' || l === null || Array.isArray(l))
            throw new ProtocolError('malformed', 'a chat line must be an object');
          return line(l as Rec);
        }),
      };
    }
    case 'chat_result':
      return {
        type: 'chat_result',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        reason: int(o.reason, 0, 255, 'reason'),
      };
    default:
      return null;
  }
}

function writeStr(w: ColdWriter, s: string, wide: boolean): void {
  const b = ENC.encode(s);
  if (wide) w.u16(b.length);
  else w.u8(b.length);
  w.bytes(b);
}
function readStr(r: ColdReader, wide: boolean, max: number, what: string): string {
  const n = wide ? r.u16() : r.u8();
  if (n > max) throw new ProtocolError('range', `${what} is longer than ${max} bytes`);
  try {
    return DEC.decode(r.sub(n));
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError('malformed', `${what} is not valid UTF-8`);
  }
}
function writeLine(w: ColdWriter, l: ChatLine): void {
  w.u8(l.channel);
  w.u32(l.senderId);
  writeStr(w, l.senderName, false);
  writeStr(w, l.toName, false);
  w.u32(l.ts);
  writeStr(w, l.text, true);
}
function readLine(r: ColdReader): Rec {
  return {
    channel: r.u8(),
    senderId: r.u32(),
    senderName: readStr(r, false, CHAT_LIMITS.MAX_NAME_BYTES, 'senderName'),
    toName: readStr(r, false, CHAT_LIMITS.MAX_NAME_BYTES, 'toName'),
    ts: r.u32(),
    text: readStr(r, true, CHAT_LIMITS.MAX_TEXT_BYTES, 'text'),
  };
}

export function encodeChatBody(w: ColdWriter, m: ChatMessage): void {
  switch (m.type) {
    case 'chat_send':
      w.u8(m.channel);
      w.u16(m.clientMsgId);
      writeStr(w, m.target, false);
      writeStr(w, m.text, true);
      break;
    case 'chat_msg':
      writeLine(w, m);
      break;
    case 'chat_history':
      w.u8(m.lines.length);
      for (const l of m.lines) writeLine(w, l);
      break;
    case 'chat_result':
      w.u16(m.clientMsgId);
      w.u8(m.reason);
      break;
  }
}

export function decodeChatBody(r: ColdReader, type: ChatMessage['type']): Rec {
  switch (type) {
    case 'chat_send':
      return {
        type,
        channel: r.u8(),
        clientMsgId: r.u16(),
        target: readStr(r, false, CHAT_LIMITS.MAX_NAME_BYTES, 'target'),
        text: readStr(r, true, CHAT_LIMITS.MAX_TEXT_BYTES, 'text'),
      };
    case 'chat_msg':
      return { type, ...readLine(r) };
    case 'chat_history': {
      const n = r.u8();
      if (n > CHAT_LIMITS.MAX_HISTORY) throw new ProtocolError('range', 'too many history lines');
      const lines: Rec[] = [];
      for (let i = 0; i < n; i++) lines.push(readLine(r));
      return { type, lines };
    }
    case 'chat_result':
      return { type, clientMsgId: r.u16(), reason: r.u8() };
  }
}
