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
  type SkillResultMsg,
  type SnapshotEntity,
  type SnapshotMsg,
} from './types.js';
import { validateMessage } from './validate.js';

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

const TYPE_IDS: Readonly<Record<Message['type'], MsgType>> = {
  input: MsgType.Input,
  snapshot: MsgType.Snapshot,
  aoi_enter: MsgType.AoiEnter,
  aoi_leave: MsgType.AoiLeave,
  skill_cast: MsgType.SkillCast,
  skill_result: MsgType.SkillResult,
  error: MsgType.Error,
  ping: MsgType.Ping,
  pong: MsgType.Pong,
};

const SELF_FLAG_FLYING = 1;
const SELF_FLAG_QINGGONG = 2;
const SNAP_FLAG_SELF = 1;
const SNAP_FLAG_BASELINE = 2;
const TEXT_ENC = new TextEncoder();
const TEXT_DEC = new TextDecoder('utf-8', { fatal: true });

// ---------------------------------------------------------------- encode
export function encode(msg: Message, opts: CodecOptions = {}): Uint8Array {
  const m = validateMessage(msg);
  const w = new ByteWriter();
  w.u8(PROTOCOL_VERSION);
  w.u8(TYPE_IDS[m.type]);
  switch (m.type) {
    case 'input':
      encodeInput(w, m);
      break;
    case 'skill_cast':
      w.u16(m.seq);
      w.u16(m.skillId);
      w.u32(m.targetId);
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
  w.u8((s.flying ? SELF_FLAG_FLYING : 0) | (s.qinggong ? SELF_FLAG_QINGGONG : 0));
  w.u8(s.facing);
  w.u16(s.dashLeftMs);
  w.u16(s.dashCdMs);
  w.u16(s.invulnMs);
}

function decodeSelf(r: ByteReader): SelfState {
  const lastSeq = r.u16();
  const i = r.f32();
  const j = r.f32();
  const layer = r.u8();
  const f = r.u8();
  if ((f & ~(SELF_FLAG_FLYING | SELF_FLAG_QINGGONG)) !== 0) throw new ProtocolError('malformed', 'unknown self flags');
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
  };
}

function encodeSnapshot(w: ByteWriter, m: SnapshotMsg, opts: CodecOptions): void {
  const hasBase = m.baselineSeq !== null;
  w.u8((m.self ? SNAP_FLAG_SELF : 0) | (hasBase ? SNAP_FLAG_BASELINE : 0));
  w.u16(m.seq);
  if (m.baselineSeq !== null) w.u16(m.baselineSeq);
  w.u32(m.tick);
  if (m.self) encodeSelf(w, m.self);
  w.u16(m.entities.length);
  const bits = new BitWriter();
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
    w.u8(e.dir);
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
export function peekHeader(buf: Uint8Array): { version: number; type: Message['type'] } {
  if (buf.length < 2) throw new ProtocolError('truncated', 'packet shorter than the 2-byte header');
  const version = buf[0]!;
  if (version !== PROTOCOL_VERSION)
    throw new ProtocolError('version', `unsupported protocol version ${version} (expected ${PROTOCOL_VERSION})`);
  const type = MSG_TYPE_NAMES[buf[1]!];
  if (!type) throw new ProtocolError('type', `unknown message type id ${buf[1]}`);
  return { version, type };
}

export function decode(buf: Uint8Array, opts: CodecOptions = {}): Message {
  const { type } = peekHeader(buf);
  const r = new ByteReader(buf);
  r.pos = 2;
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
      msg = { type, seq: r.u16(), skillId: r.u16(), targetId: r.u32() };
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
        entities.push({
          index: r.u16(),
          entityId: r.u32(),
          kind: r.u8(),
          defId: r.u16(),
          qi: r.u16(),
          qj: r.u16(),
          anim: r.u8(),
          dir: r.u8(),
          hpPct: r.u8(),
          maxHp: r.u32(),
        });
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
