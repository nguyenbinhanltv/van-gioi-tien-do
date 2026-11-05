/** Glue between @vgtd/sim state and wire messages. */
import { DIRECTIONS } from '@vgtd/shared';
import { directionOf, type EntityState, type MoveState } from '@vgtd/sim';
import { dequantizePos, quantizePos } from './binary.js';
import type { InputPacket, SelfState, SnapshotEntity } from './types.js';

/** Server → wire: the owner's movement state. Positions travel as float32 (rounded here so JSON and binary agree). */
export function selfStateOf(e: EntityState): SelfState {
  return {
    lastSeq: e.lastSeq,
    i: Math.fround(e.i),
    j: Math.fround(e.j),
    layer: e.layer,
    flying: e.flying,
    qinggong: e.qinggong,
    facing: e.facing,
    dashLeftMs: Math.round(e.dashLeftMs),
    dashCdMs: Math.round(e.dashCdMs),
    invulnMs: Math.round(e.invulnMs),
  };
}

/** Client: rebuild a MoveState from the server's self block to re-run pending inputs. `agi` comes from the client's own stats. */
export function moveStateFromSelf(s: SelfState, agi: number): MoveState {
  return {
    i: s.i,
    j: s.j,
    vi: 0,
    vj: 0,
    layer: s.layer,
    flying: s.flying,
    qinggong: s.qinggong,
    facing: s.facing,
    agi,
    dashLeftMs: s.dashLeftMs,
    dashCdMs: s.dashCdMs,
    invulnMs: s.invulnMs,
  };
}

/** Server → wire for any visible entity (anim/hpPct are game-level and supplied by the caller). */
export function snapshotEntityOf(index: number, e: EntityState, anim: number, hpPct: number | null): SnapshotEntity {
  const dir = DIRECTIONS.indexOf(directionOf(e.facing));
  return { index, qi: quantizePos(e.i), qj: quantizePos(e.j), anim, dir, hpPct };
}

export function positionOf(e: Pick<SnapshotEntity, 'qi' | 'qj'>): { i: number; j: number } {
  return { i: dequantizePos(e.qi), j: dequantizePos(e.qj) };
}

/** client-core `InputManager.toPacket()` output + bookkeeping → wire InputPacket. */
export function inputPacketFrom(
  fields: { dir: number; mag: number; flags: number },
  seq: number,
  dtMs: number,
): InputPacket {
  return { seq: seq & 0xffff, dtMs, dir: fields.dir, mag: fields.mag, flags: fields.flags };
}
