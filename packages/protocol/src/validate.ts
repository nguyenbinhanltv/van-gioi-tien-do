import { MAG_MAX } from '@vgtd/sim';
import { ProtocolError } from './errors.js';
import { validateColdMessage } from './progression.js';
import {
  LIMITS,
  type AoiEnterMsg,
  type AoiLeaveMsg,
  type EnterEntity,
  type ErrorMsg,
  type InputMsg,
  type InputPacket,
  type Message,
  type PingMsg,
  type PongMsg,
  type SelfState,
  type SelfVitals,
  type SkillCastMsg,
  type SkillHit,
  type SkillResultMsg,
  type SnapshotEntity,
  type SnapshotMsg,
  type TelegraphEndMsg,
  type TelegraphStartMsg,
} from './types.js';

type Rec = Record<string, unknown>;

function rec(x: unknown, what: string): Rec {
  if (typeof x !== 'object' || x === null || Array.isArray(x))
    throw new ProtocolError('malformed', `${what} must be an object`);
  return x as Rec;
}
function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) {
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  }
  return x;
}
function num(x: unknown, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new ProtocolError('range', `${what} must be a finite number`);
  return x;
}
function bool(x: unknown, what: string): boolean {
  if (typeof x !== 'boolean') throw new ProtocolError('malformed', `${what} must be a boolean`);
  return x;
}
function arr(x: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(x)) throw new ProtocolError('malformed', `${what} must be an array`);
  if (x.length > max) throw new ProtocolError('range', `${what} has more than ${max} items`);
  return x;
}

const U16 = 0xffff;
const U32 = 0xffffffff;

function inputPacket(x: unknown): InputPacket {
  const o = rec(x, 'input');
  return {
    seq: int(o.seq, 0, U16, 'input.seq'),
    dtMs: int(o.dtMs, 0, 255, 'input.dtMs'),
    dir: int(o.dir, 0, 255, 'input.dir'),
    mag: int(o.mag, 0, MAG_MAX, 'input.mag'),
    flags: int(o.flags, 0, 15, 'input.flags'),
  };
}

function aim(x: unknown): { qi: number; qj: number } {
  const o = rec(x, 'aim');
  return { qi: int(o.qi, 0, U16, 'aim.qi'), qj: int(o.qj, 0, U16, 'aim.qj') };
}

function vitals(x: unknown): SelfVitals {
  const o = rec(x, 'self.vitals');
  return {
    hp: int(o.hp, 0, U32, 'vitals.hp'),
    hpMax: int(o.hpMax, 0, U32, 'vitals.hpMax'),
    mp: int(o.mp, 0, U32, 'vitals.mp'),
    mpMax: int(o.mpMax, 0, U32, 'vitals.mpMax'),
    shield: int(o.shield, 0, U32, 'vitals.shield'),
  };
}

export function validateSelf(x: unknown): SelfState {
  const o = rec(x, 'self');
  return {
    lastSeq: int(o.lastSeq, 0, U16, 'self.lastSeq'),
    i: num(o.i, 'self.i'),
    j: num(o.j, 'self.j'),
    layer: int(o.layer, 0, 255, 'self.layer'),
    flying: bool(o.flying, 'self.flying'),
    qinggong: bool(o.qinggong, 'self.qinggong'),
    facing: int(o.facing, 0, 254, 'self.facing'),
    dashLeftMs: int(o.dashLeftMs, 0, U16, 'self.dashLeftMs'),
    dashCdMs: int(o.dashCdMs, 0, U16, 'self.dashCdMs'),
    invulnMs: int(o.invulnMs, 0, U16, 'self.invulnMs'),
    vitals: o.vitals === null ? null : vitals(o.vitals),
  };
}

function snapEntity(x: unknown): SnapshotEntity {
  const o = rec(x, 'entity');
  return {
    index: int(o.index, 0, LIMITS.MAX_LOCAL_INDEX, 'entity.index'),
    qi: int(o.qi, 0, LIMITS.POS_MAX_Q, 'entity.qi'),
    qj: int(o.qj, 0, LIMITS.POS_MAX_Q, 'entity.qj'),
    anim: int(o.anim, 0, LIMITS.ANIM_MAX, 'entity.anim'),
    dir: int(o.dir, 0, 7, 'entity.dir'),
    hpPct: o.hpPct === null ? null : int(o.hpPct, 0, LIMITS.HP_PCT_MAX, 'entity.hpPct'),
  };
}

function enterEntity(x: unknown): EnterEntity {
  const o = rec(x, 'enter entity');
  return {
    index: int(o.index, 0, LIMITS.MAX_LOCAL_INDEX, 'enter.index'),
    entityId: int(o.entityId, 0, U32, 'enter.entityId'),
    kind: int(o.kind, 0, 255, 'enter.kind'),
    defId: int(o.defId, 0, 65535, 'enter.defId'),
    qi: int(o.qi, 0, LIMITS.POS_MAX_Q, 'enter.qi'),
    qj: int(o.qj, 0, LIMITS.POS_MAX_Q, 'enter.qj'),
    anim: int(o.anim, 0, 255, 'enter.anim'),
    dir: int(o.dir, 0, 7, 'enter.dir'),
    hpPct: int(o.hpPct, 0, 255, 'enter.hpPct'),
    maxHp: int(o.maxHp, 0, U32, 'enter.maxHp'),
  };
}

function hit(x: unknown): SkillHit {
  const o = rec(x, 'hit');
  return {
    targetIndex: int(o.targetIndex, 0, U16, 'hit.targetIndex'),
    damage: int(o.damage, 0, U32, 'hit.damage'),
    flags: int(o.flags, 0, 255, 'hit.flags'),
  };
}

/**
 * Validate an untrusted message object (e.g. from the JSON codec) and return a normalised copy with only known fields.
 * Throws ProtocolError for anything out of range — the binary encoder runs the same checks.
 */
export function validateMessage(x: unknown): Message {
  const o = rec(x, 'message');
  switch (o.type) {
    case 'input': {
      const inputs = arr(o.inputs, LIMITS.MAX_INPUTS_PER_PACKET, 'inputs').map(inputPacket);
      if (inputs.length < 1) throw new ProtocolError('range', 'input packet needs 1–3 inputs');
      const m: InputMsg = { type: 'input', ack: int(o.ack, 0, U16, 'ack'), inputs };
      return m;
    }
    case 'skill_cast': {
      const m: SkillCastMsg = {
        type: 'skill_cast',
        seq: int(o.seq, 0, U16, 'seq'),
        skillId: int(o.skillId, 0, U16, 'skillId'),
        targetId: int(o.targetId, 0, U32, 'targetId'),
        aim: o.aim === null ? null : aim(o.aim),
      };
      return m;
    }
    case 'ping': {
      const m: PingMsg = { type: 'ping', clientTimeMs: int(o.clientTimeMs, 0, U32, 'clientTimeMs') };
      return m;
    }
    case 'snapshot': {
      const m: SnapshotMsg = {
        type: 'snapshot',
        seq: int(o.seq, 0, U16, 'seq'),
        baselineSeq: o.baselineSeq === null ? null : int(o.baselineSeq, 0, U16, 'baselineSeq'),
        tick: int(o.tick, 0, U32, 'tick'),
        self: o.self === null ? null : validateSelf(o.self),
        entities: arr(o.entities, LIMITS.MAX_LOCAL_INDEX + 1, 'entities').map(snapEntity),
      };
      return m;
    }
    case 'aoi_enter': {
      const m: AoiEnterMsg = {
        type: 'aoi_enter',
        entities: arr(o.entities, LIMITS.MAX_ENTER_PER_MSG, 'entities').map(enterEntity),
      };
      return m;
    }
    case 'aoi_leave': {
      const m: AoiLeaveMsg = {
        type: 'aoi_leave',
        indices: arr(o.indices, LIMITS.MAX_ENTER_PER_MSG, 'indices').map((v) =>
          int(v, 0, LIMITS.MAX_LOCAL_INDEX, 'index'),
        ),
      };
      return m;
    }
    case 'skill_result': {
      const m: SkillResultMsg = {
        type: 'skill_result',
        seq: int(o.seq, 0, U16, 'seq'),
        reason: int(o.reason, 0, 255, 'reason'),
        skillId: int(o.skillId, 0, U16, 'skillId'),
        readyAtMs: int(o.readyAtMs, 0, U32, 'readyAtMs'),
        casterIndex: int(o.casterIndex, 0, U16, 'casterIndex'),
        hits: arr(o.hits, LIMITS.MAX_HITS, 'hits').map(hit),
      };
      return m;
    }
    case 'error': {
      if (typeof o.text !== 'string') throw new ProtocolError('malformed', 'text must be a string');
      const m: ErrorMsg = { type: 'error', code: int(o.code, 0, U16, 'code'), text: o.text };
      return m;
    }
    case 'pong': {
      const m: PongMsg = {
        type: 'pong',
        clientTimeMs: int(o.clientTimeMs, 0, U32, 'clientTimeMs'),
        serverTimeMs: int(o.serverTimeMs, 0, U32, 'serverTimeMs'),
      };
      return m;
    }
    case 'telegraph_start': {
      const m: TelegraphStartMsg = {
        type: 'telegraph_start',
        id: int(o.id, 0, U16, 'id'),
        mobEntityId: int(o.mobEntityId, 0, U32, 'mobEntityId'),
        shape: int(o.shape, 0, 2, 'shape'),
        qi: int(o.qi, 0, LIMITS.POS_MAX_Q, 'qi'),
        qj: int(o.qj, 0, LIMITS.POS_MAX_Q, 'qj'),
        facing: int(o.facing, 0, 254, 'facing'),
        size: int(o.size, 0, U16, 'size'),
        extra: int(o.extra, 0, U16, 'extra'),
        durationMs: int(o.durationMs, 0, U16, 'durationMs'),
      };
      return m;
    }
    case 'telegraph_end': {
      if (typeof o.cancelled !== 'boolean') throw new ProtocolError('malformed', 'cancelled must be a boolean');
      const m: TelegraphEndMsg = { type: 'telegraph_end', id: int(o.id, 0, U16, 'id'), cancelled: o.cancelled };
      return m;
    }
    default: {
      const cold = validateColdMessage(o);
      if (cold) return cold;
      throw new ProtocolError('type', `unknown message type ${String(o.type)}`);
    }
  }
}
