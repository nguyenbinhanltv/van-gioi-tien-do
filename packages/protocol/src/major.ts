/**
 * Major breakthrough events (D97, cold family, additive on v5: no version bump). Same `[ver][0x80][msgId u16][body]` envelope and strict
 * fixed big-endian bodies as party.ts / chat.ts.
 *
 *   major_event          S->C  phase changes of a Tâm Ma / Lôi Kiếp event of the receiving player, and its end (result, consequence)
 *   tribulation_strike   S->C  one lightning bolt hit the receiving player (for the VFX; the warning decal is a `telegraph_start`)
 *
 * The final answer to the `breakthrough_start` that began the event is the normal `breakthrough_result` (sent when the event ends).
 */
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

/** Phases of a major event as the client sees them (`MajorPhase` of @vgtd/shared has the same values). */
export const MAJOR_PHASE_MAX = 4;

export interface MajorEventMsg {
  type: 'major_event';
  /** 1 Tâm Ma, 2 Thiên Mệnh (the roll), 3 Lôi Kiếp, 4 ended */
  phase: number;
  /** current wave (1-based; 0 outside the Lôi Kiếp) and the total number of waves (0 when there is no Lôi Kiếp) */
  wave: number;
  waves: number;
  /** ms left in this phase's window (Tâm Ma time limit, pauses); 0 when it has none */
  remainingMs: number;
  /** Tâm Ma strength x100 (120 = 1.2); 0 when there is no Tâm Ma */
  strengthPct: number;
  /** `MajorResult` of @vgtd/shared: 0 while running, 1 success, 2 Tâm Ma lost, 3 roll failed, 4 died in the Kiếp */
  result: number;
  /** `ConsequenceTier`: 0 none, 1 Nhẹ, 2 Trung, 3 Nặng */
  tier: number;
  /** share of the stage's tu vi lost (percent) */
  expLostPct: number;
  /** major-breakthrough lock in minutes (0 = none) */
  lockMin: number;
  /** entity id of the Tâm Ma shadow (0 when there is none) */
  tamMaId: number;
}

export interface TribulationStrikeMsg {
  type: 'tribulation_strike';
  wave: number;
  waves: number;
  strike: number;
  /** where the bolt hit, 1/32 tile (like `telegraph_start`) */
  qi: number;
  qj: number;
  damage: number;
}

export type MajorServerMessage = MajorEventMsg | TribulationStrikeMsg;
export type MajorMessage = MajorServerMessage;

type Rec = Record<string, unknown>;
const U16 = 0xffff;
const U32 = 0xffffffff;

function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}

/** The normalised major message for `o.type`, or null when it is not one. */
export function validateMajorMessage(o: Rec): MajorMessage | null {
  switch (o.type) {
    case 'major_event':
      return {
        type: 'major_event',
        phase: int(o.phase, 1, MAJOR_PHASE_MAX, 'phase'),
        wave: int(o.wave, 0, 255, 'wave'),
        waves: int(o.waves, 0, 255, 'waves'),
        remainingMs: int(o.remainingMs, 0, U32, 'remainingMs'),
        strengthPct: int(o.strengthPct, 0, U16, 'strengthPct'),
        result: int(o.result, 0, 4, 'result'),
        tier: int(o.tier, 0, 3, 'tier'),
        expLostPct: int(o.expLostPct, 0, 100, 'expLostPct'),
        lockMin: int(o.lockMin, 0, U16, 'lockMin'),
        tamMaId: int(o.tamMaId, 0, U32, 'tamMaId'),
      };
    case 'tribulation_strike':
      return {
        type: 'tribulation_strike',
        wave: int(o.wave, 1, 255, 'wave'),
        waves: int(o.waves, 1, 255, 'waves'),
        strike: int(o.strike, 0, 255, 'strike'),
        qi: int(o.qi, 0, U16, 'qi'),
        qj: int(o.qj, 0, U16, 'qj'),
        damage: int(o.damage, 0, U32, 'damage'),
      };
    default:
      return null;
  }
}

export function encodeMajorBody(w: ColdWriter, m: MajorMessage): void {
  switch (m.type) {
    case 'major_event':
      w.u8(m.phase);
      w.u8(m.wave);
      w.u8(m.waves);
      w.u32(m.remainingMs);
      w.u16(m.strengthPct);
      w.u8(m.result);
      w.u8(m.tier);
      w.u8(m.expLostPct);
      w.u16(m.lockMin);
      w.u32(m.tamMaId);
      break;
    case 'tribulation_strike':
      w.u8(m.wave);
      w.u8(m.waves);
      w.u8(m.strike);
      w.u16(m.qi);
      w.u16(m.qj);
      w.u32(m.damage);
      break;
  }
}

export function decodeMajorBody(r: ColdReader, type: MajorMessage['type']): Rec {
  switch (type) {
    case 'major_event':
      return {
        type,
        phase: r.u8(),
        wave: r.u8(),
        waves: r.u8(),
        remainingMs: r.u32(),
        strengthPct: r.u16(),
        result: r.u8(),
        tier: r.u8(),
        expLostPct: r.u8(),
        lockMin: r.u16(),
        tamMaId: r.u32(),
      };
    case 'tribulation_strike':
      return { type, wave: r.u8(), waves: r.u8(), strike: r.u8(), qi: r.u16(), qj: r.u16(), damage: r.u32() };
  }
}
