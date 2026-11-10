/**
 * Tutorial / FTUE ("cold family", D105; docs/16). Same `[ver][0x80][msgId u16][body]` envelope and strict fixed big-endian bodies as the
 * other cold messages.
 *
 *   tutorial_state  S->C  where the player is in the first-session flow: bitmask of finished steps (bit = index in `TUTORIAL_STEPS`),
 *                         kills counted so far, flags (1 = skipped, 2 = complete). Sent after joining and on every change.
 *   tutorial_skip   C->S  the player dismisses the hints ("Bỏ qua"). No body. Progress is still recorded; the answer is a fresh state.
 *
 * The client never reports progress: the server decides every step from what it saw.
 */
import { TUTORIAL_ALL_MASK } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export interface TutorialStateMsg {
  type: 'tutorial_state';
  /** finished steps, bit k = `TUTORIAL_STEPS[k]` */
  done: number;
  /** kills counted toward the `kills` step (0..255; stays at `TUTORIAL.killTarget` once reached) */
  kills: number;
  /** TUTORIAL_FLAG_SKIPPED | TUTORIAL_FLAG_COMPLETE */
  flags: number;
}
export interface TutorialSkipMsg {
  type: 'tutorial_skip';
}
export type TutorialClientMessage = TutorialSkipMsg;
export type TutorialServerMessage = TutorialStateMsg;
export type TutorialMessage = TutorialClientMessage | TutorialServerMessage;

type Rec = Record<string, unknown>;

function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}

/** The normalised tutorial message for `o.type`, or null when it is not one. */
export function validateTutorialMessage(o: Rec): TutorialMessage | null {
  switch (o.type) {
    case 'tutorial_skip':
      return { type: 'tutorial_skip' };
    case 'tutorial_state':
      return {
        type: 'tutorial_state',
        done: int(o.done, 0, TUTORIAL_ALL_MASK, 'done'),
        kills: int(o.kills, 0, 255, 'kills'),
        flags: int(o.flags, 0, 3, 'flags'),
      };
    default:
      return null;
  }
}

export function encodeTutorialBody(w: ColdWriter, m: TutorialMessage): void {
  if (m.type === 'tutorial_state') {
    w.u16(m.done);
    w.u8(m.kills);
    w.u8(m.flags);
  }
}

export function decodeTutorialBody(r: ColdReader, type: TutorialMessage['type']): Rec {
  if (type === 'tutorial_skip') return { type };
  const done = r.u16();
  if (done > TUTORIAL_ALL_MASK) throw new ProtocolError('range', 'unknown tutorial step bits');
  const kills = r.u8();
  const flags = r.u8();
  if (flags > 3) throw new ProtocolError('range', 'unknown tutorial flags');
  return { type, done, kills, flags };
}
