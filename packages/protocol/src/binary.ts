/**
 * Compact binary codec (DataView based, no dependencies). Big-endian. Layout per message type — see README.
 *
 * Decoding is strict (canonical): trailing bytes, non-zero padding bits and out-of-range values are rejected with
 * ProtocolError, so decode(encode(m)) === m and a successful decode of arbitrary bytes always re-encodes cleanly.
 */
import { BitReader, BitWriter } from './bits.js';
import { ProtocolError } from './errors.js';
import {
  LIMITS,
  MSG_TYPE_NAMES,
  MsgType,
  PROTOCOL_VERSION,
  type AoiEnterMsg,
  type EnterEntity,
  type ErrorMsg,
  type InputMsg,
  type Message,
  type SelfState,
  type SelfStatus,
  type SkillResultMsg,
  type SnapshotEntity,
  type SnapshotMsg,
} from './types.js';
import {
  COLD_ENVELOPE,
  COLD_MSG_IDS,
  COLD_MSG_NAMES,
  decodeColdBody,
  encodeColdBody,
  type ColdMessage,
} from './progression.js';
import { validateMessage, validateSelf } from './validate.js';

/** Position of an entity (1/32 tile) in the snapshot the deltas are relative to. */
export interface BaselinePos {
  qi: number;
  qj: number;
}
export type BaselineLookup = (index: number) => BaselinePos | undefined;

export interface CodecOptions {
  /** required to decode delta records, and used by the encoder to choose delta over absolute */
  baseline?: BaselineLookup;
}

// ---------------------------------------------------------------- byte helpers
class ByteWriter {
  private buf = new Uint8Array(64);
  private view = new DataView(this.buf.buffer);
  len = 0;
  /** Start over, keeping the allocated buffer (the module-level scratch writer is reused by every `encode`). */
  reset(): void {
    this.len = 0;
  }
  /** make room for `n` more bytes up front (one allocation instead of repeated doubling) */
  reserve(n: number): void {
    this.ensure(n);
  }
  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.len++, v);
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.len, v);
    this.len += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.len, v);
    this.len += 4;
  }
  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.len, v);
    this.len += 4;
  }
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.len, v);
    this.len += 8;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class ByteReader {
  private view: DataView;
  pos = 0;
  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private need(n: number): void {
    if (this.pos + n > this.buf.length)
      throw new ProtocolError('truncated', `need ${n} more byte(s) at offset ${this.pos}`);
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos);
    this.pos += 4;
    if (!Number.isFinite(v)) throw new ProtocolError('malformed', 'non-finite float');
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos);
    this.pos += 8;
    if (!Number.isFinite(v)) throw new ProtocolError('malformed', 'non-finite float');
    return v;
  }
  sub(n: number): Uint8Array {
    this.need(n);
    const s = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
  rest(): Uint8Array {
    return this.buf.subarray(this.pos);
  }
  end(): void {
    if (this.pos !== this.buf.length)
      throw new ProtocolError('trailing', `${this.buf.length - this.pos} trailing byte(s)`);
  }
}

// ---------------------------------------------------------------- quantisation helpers
/** Tile coordinate → uint16 in 1/32 tile. */
export function quantizePos(v: number): number {
  const q = Math.round(v * LIMITS.POS_SCALE);
  if (!(q >= 0 && q <= LIMITS.POS_MAX_Q)) throw new ProtocolError('range', `position ${v} outside 0..2047.97 tiles`);
  return q;
}
export function dequantizePos(q: number): number {
  return q / LIMITS.POS_SCALE;
}

const TYPE_IDS: Readonly<Record<Exclude<Message['type'], ColdMessage['type']>, MsgType>> = {
  input: MsgType.Input,
  snapshot: MsgType.Snapshot,
  aoi_enter: MsgType.AoiEnter,
  aoi_leave: MsgType.AoiLeave,
  skill_cast: MsgType.SkillCast,
  skill_result: MsgType.SkillResult,
  error: MsgType.Error,
  ping: MsgType.Ping,
  pong: MsgType.Pong,
  telegraph_start: MsgType.TelegraphStart,
  telegraph_end: MsgType.TelegraphEnd,
  boss_phase: MsgType.BossPhase,
  status_update: MsgType.StatusUpdate,
};

const SELF_FLAG_FLYING = 1;
const SELF_FLAG_QINGGONG = 2;
const SELF_FLAG_VITALS = 4;
const SELF_FLAG_STATUS = 8;
const CAST_FLAG_AIM = 1;
const SNAP_FLAG_SELF = 1;
const SNAP_FLAG_BASELINE = 2;
const TEXT_ENC = new TextEncoder();
const TEXT_DEC = new TextDecoder('utf-8', { fatal: true });

// ---------------------------------------------------------------- encode
/**
 * Reused by every `encode` (a snapshot per client per tick would otherwise allocate a buffer + DataView each time). Safe because
 * encoding is synchronous and never re-entrant, and every result is a COPY (`result()` slices), so callers never see the scratch.
 */
const SCRATCH = new ByteWriter();
const SCRATCH_BITS = new BitWriter(1024);

export function encode(msg: Message, opts: CodecOptions = {}): Uint8Array {
  const m = validateMessage(msg);
  const w = SCRATCH;
  w.reset();
  w.u8(PROTOCOL_VERSION);
  if (isCold(m)) {
    w.u8(COLD_ENVELOPE);
    w.u16(COLD_MSG_IDS[m.type]);
    encodeColdBody(w, m);
    return w.result();
  }
  w.u8(TYPE_IDS[m.type]);
  switch (m.type) {
    case 'input':
      encodeInput(w, m);
      break;
    case 'skill_cast':
      w.u16(m.seq);
      w.u16(m.skillId);
      w.u32(m.targetId);
      w.u8(m.aim ? CAST_FLAG_AIM : 0);
      if (m.aim) {
        w.u16(m.aim.qi);
        w.u16(m.aim.qj);
      }
      break;
    case 'ping':
      w.u32(m.clientTimeMs);
      break;
    case 'pong':
      w.u32(m.clientTimeMs);
      w.u32(m.serverTimeMs);
      break;
    case 'snapshot':
      encodeSnapshot(w, m, opts);
      break;
    case 'aoi_enter':
      encodeEnter(w, m);
      break;
    case 'aoi_leave':
      w.u16(m.indices.length);
      for (const i of m.indices) w.u16(i);
      break;
    case 'skill_result':
      encodeSkillResult(w, m);
      break;
    case 'error':
      encodeError(w, m);
      break;
    case 'telegraph_start':
      w.u16(m.id);
      w.u32(m.mobEntityId);
      w.u8(m.shape);
      w.u16(m.qi);
      w.u16(m.qj);
      w.u8(m.facing);
      w.u16(m.size);
      w.u16(m.extra);
      w.u16(m.durationMs);
      break;
    case 'telegraph_end':
      w.u16(m.id);
      w.u8(m.cancelled ? 1 : 0);
      break;
    case 'status_update':
      w.u32(m.entityId);
      w.u8(m.mask);
      break;
    case 'boss_phase':
      w.u32(m.mobEntityId);
      w.u8(m.phase);
      w.u16(m.transformMs);
      break;
  }
  return w.result();
}

function encodeInput(w: ByteWriter, m: InputMsg): void {
  w.u16(m.ack);
  w.u8(m.inputs.length);
  for (const i of m.inputs) {
    w.u16(i.seq);
    w.u8(i.dtMs);
    w.u8(i.dir);
    w.u8((i.mag << 4) | i.flags);
  }
}

function encodeSelf(w: ByteWriter, s: SelfState): void {
  w.u16(s.lastSeq);
  w.f32(s.i);
  w.f32(s.j);
  w.u8(s.layer);
  w.u8(
    (s.flying ? SELF_FLAG_FLYING : 0) |
      (s.qinggong ? SELF_FLAG_QINGGONG : 0) |
      (s.vitals ? SELF_FLAG_VITALS : 0) |
      (s.status ? SELF_FLAG_STATUS : 0),
  );
  w.u8(s.facing);
  w.u16(s.dashLeftMs);
  w.u16(s.dashCdMs);
  w.u16(s.invulnMs);
  if (s.vitals) {
    w.u32(s.vitals.hp);
    w.u32(s.vitals.hpMax);
    w.u32(s.vitals.mp);
    w.u32(s.vitals.mpMax);
    w.u32(s.vitals.shield);
  }
  if (s.status) {
    // mask, then the remaining ms (u16) of each active effect in bit order, the slow factor (percent, u8) after the slow time
    const st = s.status;
    w.u8((st.rootMs > 0 ? 1 : 0) | (st.slowMs > 0 ? 2 : 0) | (st.poisonMs > 0 ? 4 : 0));
    if (st.rootMs > 0) w.u16(st.rootMs);
    if (st.slowMs > 0) {
      w.u16(st.slowMs);
      w.u8(st.slowPct);
    }
    if (st.poisonMs > 0) w.u16(st.poisonMs);
  }
}

function decodeSelf(r: ByteReader): SelfState {
  const lastSeq = r.u16();
  const i = r.f32();
  const j = r.f32();
  const layer = r.u8();
  const f = r.u8();
  if ((f & ~(SELF_FLAG_FLYING | SELF_FLAG_QINGGONG | SELF_FLAG_VITALS | SELF_FLAG_STATUS)) !== 0)
    throw new ProtocolError('malformed', 'unknown self flags');
  const facing = r.u8();
  if (facing > 254) throw new ProtocolError('range', 'facing 255 is not a valid direction code');
  return {
    lastSeq,
    i,
    j,
    layer,
    flying: (f & SELF_FLAG_FLYING) !== 0,
    qinggong: (f & SELF_FLAG_QINGGONG) !== 0,
    facing,
    dashLeftMs: r.u16(),
    dashCdMs: r.u16(),
    invulnMs: r.u16(),
    vitals:
      (f & SELF_FLAG_VITALS) !== 0
        ? { hp: r.u32(), hpMax: r.u32(), mp: r.u32(), mpMax: r.u32(), shield: r.u32() }
        : null,
    status: (f & SELF_FLAG_STATUS) !== 0 ? decodeSelfStatus(r) : null,
  };
}

function decodeSelfStatus(r: ByteReader): SelfStatus {
  const mask = r.u8();
  if ((mask & ~7) !== 0) throw new ProtocolError('malformed', 'unknown status bits');
  const st: SelfStatus = { rootMs: 0, slowMs: 0, slowPct: 0, poisonMs: 0 };
  if (mask & 1) st.rootMs = r.u16();
  if (mask & 2) {
    st.slowMs = r.u16();
    st.slowPct = r.u8();
  }
  if (mask & 4) st.poisonMs = r.u16();
  return st;
}

/**
 * The entity records of one snapshot as parallel arrays ("struct of arrays"), for `encodeSnapshotRecords`: the server fills ONE instance per
 * tick and reuses it for every client, so a snapshot costs no per-entity object. `hp[k]` < 0 means "no hpPct in this record".
 */
export class SnapshotRecords {
  count = 0;
  // Float64Array on purpose: a typed array of a narrow integer type would silently wrap or truncate an out-of-range / fractional value, and the
  // bit writer must see it to throw exactly like `encode` does.
  index = new Float64Array(LIMITS.MAX_LOCAL_INDEX + 1);
  qi = new Float64Array(LIMITS.MAX_LOCAL_INDEX + 1);
  qj = new Float64Array(LIMITS.MAX_LOCAL_INDEX + 1);
  anim = new Float64Array(LIMITS.MAX_LOCAL_INDEX + 1);
  dir = new Float64Array(LIMITS.MAX_LOCAL_INDEX + 1);
  /** hpPct 0..127, or -1 for none */
  hp = new Float64Array(LIMITS.MAX_LOCAL_INDEX + 1);
}

export interface SnapshotHeader {
  seq: number;
  baselineSeq: number | null;
  tick: number;
  self: SelfState | null;
}

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const isU = (v: number, max: number): boolean => Number.isInteger(v) && v >= 0 && v <= max;

/**
 * The same bytes as `encode({ type: 'snapshot', ... })`, without building the message: no per-entity objects, no re-validation pass, and the
 * bit stream is appended without an intermediate copy (one copy of the finished message remains: the caller owns the result). Every
 * field is still range-checked: the header here, `self` by `validateSelf`, and each record by the bit writer itself (every wire limit
 * equals its bit width), so a bad value throws the same `ProtocolError` as before. `baseline[index]` is the client's last-sent position of
 * that slot (a delta is used when it fits), exactly like `CodecOptions.baseline`.
 */
export function encodeSnapshotRecords(
  head: SnapshotHeader,
  rec: SnapshotRecords,
  baseline: ArrayLike<BaselinePos | undefined>,
): Uint8Array {
  if (!isU(head.seq, U16_MAX))
    throw new ProtocolError('range', `seq must be an integer in 0..${U16_MAX}, got ${String(head.seq)}`);
  if (head.baselineSeq !== null && !isU(head.baselineSeq, U16_MAX))
    throw new ProtocolError(
      'range',
      `baselineSeq must be an integer in 0..${U16_MAX}, got ${String(head.baselineSeq)}`,
    );
  if (!isU(head.tick, U32_MAX))
    throw new ProtocolError('range', `tick must be an integer in 0..${U32_MAX}, got ${String(head.tick)}`);
  const n = rec.count;
  const self = head.self === null ? null : validateSelf(head.self);
  const w = SCRATCH;
  w.reset();
  w.u8(PROTOCOL_VERSION);
  w.u8(MsgType.Snapshot);
  const hasBase = head.baselineSeq !== null;
  w.u8((self ? SNAP_FLAG_SELF : 0) | (hasBase ? SNAP_FLAG_BASELINE : 0));
  w.u16(head.seq);
  if (head.baselineSeq !== null) w.u16(head.baselineSeq);
  w.u32(head.tick);
  if (self) encodeSelf(w, self);
  w.u16(n);
  w.reserve(48 + n * 6);
  const bits = SCRATCH_BITS;
  bits.reset();
  for (let k = 0; k < n; k++) {
    const index = rec.index[k]!;
    const qi = rec.qi[k]!;
    const qj = rec.qj[k]!;
    bits.write(index, 10);
    const base = hasBase ? baseline[index] : undefined;
    if (base !== undefined) {
      const di = qi - base.qi;
      const dj = qj - base.qj;
      if (di >= LIMITS.DELTA_MIN && di <= LIMITS.DELTA_MAX && dj >= LIMITS.DELTA_MIN && dj <= LIMITS.DELTA_MAX) {
        bits.write(0, 1);
        bits.write(di & 0xff, 8);
        bits.write(dj & 0xff, 8);
      } else {
        bits.write(1, 1);
        bits.write(qi, 16);
        bits.write(qj, 16);
      }
    } else {
      bits.write(1, 1);
      bits.write(qi, 16);
      bits.write(qj, 16);
    }
    bits.write(rec.anim[k]!, 6);
    bits.write(rec.dir[k]!, 3);
    const hp = rec.hp[k]!;
    if (hp < 0) bits.write(0, 1);
    else {
      bits.write(1, 1);
      bits.write(hp, 7);
    }
  }
  w.bytes(bits.finishView());
  return w.result();
}

function encodeSnapshot(w: ByteWriter, m: SnapshotMsg, opts: CodecOptions): void {
  const hasBase = m.baselineSeq !== null;
  w.u8((m.self ? SNAP_FLAG_SELF : 0) | (hasBase ? SNAP_FLAG_BASELINE : 0));
  w.u16(m.seq);
  if (m.baselineSeq !== null) w.u16(m.baselineSeq);
  w.u32(m.tick);
  if (m.self) encodeSelf(w, m.self);
  w.u16(m.entities.length);
  // an entity record is 37-44 bits (5-6 bytes): size both buffers once
  w.reserve(48 + m.entities.length * 6);
  const bits = SCRATCH_BITS;
  bits.reset();
  for (const e of m.entities) {
    bits.write(e.index, 10);
    const base = hasBase ? opts.baseline?.(e.index) : undefined;
    const di = base ? e.qi - base.qi : 0;
    const dj = base ? e.qj - base.qj : 0;
    const useDelta =
      base !== undefined &&
      di >= LIMITS.DELTA_MIN &&
      di <= LIMITS.DELTA_MAX &&
      dj >= LIMITS.DELTA_MIN &&
      dj <= LIMITS.DELTA_MAX;
    if (useDelta) {
      bits.write(0, 1);
      bits.write(di & 0xff, 8);
      bits.write(dj & 0xff, 8);
    } else {
      bits.write(1, 1);
      bits.write(e.qi, 16);
      bits.write(e.qj, 16);
    }
    bits.write(e.anim, 6);
    bits.write(e.dir, 3);
    if (e.hpPct === null) bits.write(0, 1);
    else {
      bits.write(1, 1);
      bits.write(e.hpPct, 7);
    }
  }
  w.bytes(bits.finish());
}

function encodeEnter(w: ByteWriter, m: AoiEnterMsg): void {
  w.u16(m.entities.length);
  for (const e of m.entities) {
    w.u16(e.index);
    w.u32(e.entityId);
    w.u8(e.kind);
    w.u16(e.defId);
    w.u16(e.qi);
    w.u16(e.qj);
    w.u8(e.anim);
    w.u8((e.dir & 7) | ((e.element ?? 0) << 4)); // D120: direction 0-7 in the low bits, the monster element (0-5) in the high nibble
    w.u8(e.hpPct);
    w.u32(e.maxHp);
  }
}

function encodeSkillResult(w: ByteWriter, m: SkillResultMsg): void {
  w.u16(m.seq);
  w.u8(m.reason);
  w.u16(m.skillId);
  w.u32(m.readyAtMs);
  w.u16(m.casterIndex);
  w.u8(m.hits.length);
  for (const h of m.hits) {
    w.u16(h.targetIndex);
    w.u32(h.damage);
    w.u8(h.flags);
  }
}

function encodeError(w: ByteWriter, m: ErrorMsg): void {
  const text = TEXT_ENC.encode(m.text);
  if (text.length > LIMITS.MAX_ERROR_TEXT_BYTES) throw new ProtocolError('range', 'error text longer than 255 bytes');
  w.u16(m.code);
  w.u8(text.length);
  w.bytes(text);
}

// ---------------------------------------------------------------- decode
/** Read the 2-byte header without decoding the body (gateways route on this). */
function isCold(m: Message): m is ColdMessage {
  return m.type in COLD_MSG_IDS;
}

export function peekHeader(buf: Uint8Array): { version: number; type: Message['type'] } {
  if (buf.length < 2) throw new ProtocolError('truncated', 'packet shorter than the 2-byte header');
  const version = buf[0]!;
  if (version !== PROTOCOL_VERSION)
    throw new ProtocolError('version', `unsupported protocol version ${version} (expected ${PROTOCOL_VERSION})`);
  if (buf[1] === COLD_ENVELOPE) {
    if (buf.length < 4) throw new ProtocolError('truncated', 'cold envelope shorter than its 4-byte header');
    const cold = COLD_MSG_NAMES[(buf[2]! << 8) | buf[3]!];
    if (!cold) throw new ProtocolError('type', `unknown cold message id ${(buf[2]! << 8) | buf[3]!}`);
    return { version, type: cold };
  }
  const type = MSG_TYPE_NAMES[buf[1]!];
  if (!type) throw new ProtocolError('type', `unknown message type id ${buf[1]}`);
  return { version, type };
}

export function decode(buf: Uint8Array, opts: CodecOptions = {}): Message {
  const { type } = peekHeader(buf);
  const r = new ByteReader(buf);
  r.pos = 2;
  if (buf[1] === COLD_ENVELOPE) {
    r.pos = 4;
    const body = decodeColdBody(r, type as ColdMessage['type']);
    r.end();
    return validateMessage(body);
  }
  let msg: Message;
  switch (type) {
    case 'input': {
      const ack = r.u16();
      const n = r.u8();
      if (n < 1 || n > LIMITS.MAX_INPUTS_PER_PACKET) throw new ProtocolError('range', `input count ${n} not in 1..3`);
      const inputs = [];
      for (let k = 0; k < n; k++) {
        const seq = r.u16();
        const dtMs = r.u8();
        const dir = r.u8();
        const mf = r.u8();
        inputs.push({ seq, dtMs, dir, mag: mf >> 4, flags: mf & 15 });
      }
      msg = { type, ack, inputs };
      break;
    }
    case 'skill_cast':
      {
        const seq = r.u16();
        const skillId = r.u16();
        const targetId = r.u32();
        const cf = r.u8();
        if ((cf & ~CAST_FLAG_AIM) !== 0) throw new ProtocolError('malformed', 'unknown cast flags');
        const aim = (cf & CAST_FLAG_AIM) !== 0 ? { qi: r.u16(), qj: r.u16() } : null;
        msg = { type, seq, skillId, targetId, aim };
      }
      break;
    case 'ping':
      msg = { type, clientTimeMs: r.u32() };
      break;
    case 'pong':
      msg = { type, clientTimeMs: r.u32(), serverTimeMs: r.u32() };
      break;
    case 'snapshot':
      msg = decodeSnapshot(r, opts);
      break;
    case 'aoi_enter': {
      const n = r.u16();
      if (n > LIMITS.MAX_ENTER_PER_MSG) throw new ProtocolError('range', 'too many entities');
      const entities: EnterEntity[] = [];
      for (let k = 0; k < n; k++) {
        const ent: EnterEntity = {
          index: r.u16(),
          entityId: r.u32(),
          kind: r.u8(),
          defId: r.u16(),
          qi: r.u16(),
          qj: r.u16(),
          anim: r.u8(),
          dir: 0,
          hpPct: 0,
          maxHp: 0,
        };
        const db = r.u8();
        ent.dir = db & 7;
        if (db >> 4 > 5) throw new ProtocolError('range', 'enter.element');
        if (db >> 4 > 0) ent.element = db >> 4; // absent = none: entries without an element decode exactly as before D120
        ent.hpPct = r.u8();
        ent.maxHp = r.u32();
        entities.push(ent);
      }
      msg = { type, entities };
      break;
    }
    case 'aoi_leave': {
      const n = r.u16();
      if (n > LIMITS.MAX_ENTER_PER_MSG) throw new ProtocolError('range', 'too many indices');
      const indices: number[] = [];
      for (let k = 0; k < n; k++) indices.push(r.u16());
      msg = { type, indices };
      break;
    }
    case 'skill_result': {
      const seq = r.u16();
      const reason = r.u8();
      const skillId = r.u16();
      const readyAtMs = r.u32();
      const casterIndex = r.u16();
      const n = r.u8();
      const hits = [];
      for (let k = 0; k < n; k++) hits.push({ targetIndex: r.u16(), damage: r.u32(), flags: r.u8() });
      msg = { type, seq, reason, skillId, readyAtMs, casterIndex, hits };
      break;
    }
    case 'error': {
      const code = r.u16();
      const n = r.u8();
      let text: string;
      try {
        text = TEXT_DEC.decode(r.sub(n));
      } catch (e) {
        if (e instanceof ProtocolError) throw e;
        throw new ProtocolError('malformed', 'error text is not valid UTF-8');
      }
      msg = { type, code, text };
      break;
    }
    case 'telegraph_start':
      msg = {
        type,
        id: r.u16(),
        mobEntityId: r.u32(),
        shape: r.u8(),
        qi: r.u16(),
        qj: r.u16(),
        facing: r.u8(),
        size: r.u16(),
        extra: r.u16(),
        durationMs: r.u16(),
      };
      break;
    case 'telegraph_end': {
      const id = r.u16();
      const c = r.u8();
      if (c > 1) throw new ProtocolError('malformed', 'cancelled flag must be 0 or 1');
      msg = { type, id, cancelled: c === 1 };
      break;
    }
    case 'boss_phase':
      msg = { type, mobEntityId: r.u32(), phase: r.u8(), transformMs: r.u16() };
      break;
    case 'status_update':
      msg = { type, entityId: r.u32(), mask: r.u8() };
      break;
    default:
      throw new ProtocolError('type', `message ${type} is not a hot-family message`);
  }
  r.end();
  return validateMessage(msg); // range-checks everything (e.g. index ≤ 1023, dir ≤ 7)
}

function decodeSnapshot(r: ByteReader, opts: CodecOptions): SnapshotMsg {
  const flags = r.u8();
  if ((flags & ~(SNAP_FLAG_SELF | SNAP_FLAG_BASELINE)) !== 0)
    throw new ProtocolError('malformed', 'unknown snapshot flags');
  const seq = r.u16();
  const baselineSeq = (flags & SNAP_FLAG_BASELINE) !== 0 ? r.u16() : null;
  const tick = r.u32();
  const self = (flags & SNAP_FLAG_SELF) !== 0 ? decodeSelf(r) : null;
  const count = r.u16();
  if (count > LIMITS.MAX_LOCAL_INDEX + 1) throw new ProtocolError('range', 'too many snapshot entities');
  const body = r.rest();
  const bits = new BitReader(body);
  const entities: SnapshotEntity[] = [];
  for (let k = 0; k < count; k++) {
    const index = bits.read(10);
    const abs = bits.read(1) === 1;
    let qi: number;
    let qj: number;
    if (abs) {
      qi = bits.read(16);
      qj = bits.read(16);
    } else {
      if (baselineSeq === null) throw new ProtocolError('malformed', 'delta record in a full snapshot');
      const base = opts.baseline?.(index);
      if (!base) throw new ProtocolError('baseline', `no baseline position for entity index ${index}`);
      const di = (bits.read(8) << 24) >> 24;
      const dj = (bits.read(8) << 24) >> 24;
      qi = base.qi + di;
      qj = base.qj + dj;
    }
    const anim = bits.read(6);
    const dir = bits.read(3);
    const hpPct = bits.read(1) === 1 ? bits.read(7) : null;
    entities.push({ index, qi, qj, anim, dir, hpPct });
  }
  r.pos += bits.finish();
  return { type: 'snapshot', seq, baselineSeq, tick, self, entities };
}
