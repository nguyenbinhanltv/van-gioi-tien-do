/** Human-readable debug codec: same message objects as the binary codec, tagged with the protocol version. */
import { ProtocolError } from './errors.js';
import { PROTOCOL_VERSION, type Message } from './types.js';
import { validateMessage } from './validate.js';

export function encodeJson(msg: Message, space?: number): string {
  const m = validateMessage(msg);
  return JSON.stringify({ v: PROTOCOL_VERSION, ...m }, null, space);
}

export function decodeJson(text: string): Message {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProtocolError('malformed', 'invalid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new ProtocolError('malformed', 'message must be an object');
  const { v, ...rest } = raw as Record<string, unknown>;
  if (v !== PROTOCOL_VERSION)
    throw new ProtocolError('version', `unsupported protocol version ${String(v)} (expected ${PROTOCOL_VERSION})`);
  return validateMessage(rest);
}
