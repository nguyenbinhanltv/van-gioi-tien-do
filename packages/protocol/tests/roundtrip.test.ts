import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '@vgtd/shared';
import { createWorld, spawnEntity, step } from '@vgtd/sim';
import {
  PROTOCOL_VERSION,
  ProtocolError,
  decode,
  decodeJson,
  dequantizePos,
  encode,
  encodeJson,
  moveStateFromSelf,
  peekHeader,
  quantizePos,
  selfStateOf,
  snapshotEntityOf,
  type BaselineLookup,
  type Message,
  type SelfState,
  type SnapshotMsg,
} from '../src/index.js';
import { lcg, randEntity, randMessage, randSelf, type HotType } from './helpers.js';

const TYPES: HotType[] = [
  'input',
  'snapshot',
  'aoi_enter',
  'aoi_leave',
  'skill_cast',
  'skill_result',
  'error',
  'ping',
  'pong',
];

describe('binary round trip', () => {
  it.each(TYPES)('%s: decode(encode(m)) equals m (500 random messages)', (type) => {
    const r = lcg(type.length * 7919);
    for (let k = 0; k < 500; k++) {
      const m = randMessage(r, type);
      const bytes = encode(m);
      expect(decode(bytes), `${type} #${k}`).toEqual(m);
      // canonical: re-encoding gives the same bytes
      expect(Array.from(encode(decode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('every packet starts with [version][type]', () => {
    for (const t of TYPES) {
      const b = encode(randMessage(lcg(1), t));
      expect(b[0]).toBe(PROTOCOL_VERSION);
      expect(peekHeader(b).type).toBe(t);
    }
  });

  it('rejects other protocol versions and unknown types', () => {
    const b = encode({ type: 'ping', clientTimeMs: 5 });
    const bad = Uint8Array.from(b);
    bad[0] = PROTOCOL_VERSION + 1;
    expect(() => decode(bad)).toThrow(ProtocolError);
    try {
      decode(bad);
    } catch (e) {
      expect((e as ProtocolError).code).toBe('version');
    }
    const unk = Uint8Array.from(b);
    unk[1] = 200;
    expect(() => decode(unk)).toThrowError(/unknown message type/);
  });

  it('rejects truncated packets at every length and trailing garbage', () => {
    const r = lcg(3);
    for (const t of TYPES) {
      const b = encode(randMessage(r, t));
      for (let n = 0; n < b.length; n++) {
        // every strict prefix is incomplete (counts are encoded before the lists)
        expect(() => decode(b.subarray(0, n)), `${t}: prefix ${n}/${b.length}`).toThrow(ProtocolError);
      }
      const extra = new Uint8Array(b.length + 1);
      extra.set(b);
      expect(() => decode(extra)).toThrowError(/trailing/);
    }
  });

  it('out-of-range fields are rejected by the encoder', () => {
    expect(() => encode({ type: 'input', ack: 0, inputs: [{ seq: 0, dtMs: 50, dir: 0, mag: 16, flags: 0 }] })).toThrow(
      ProtocolError,
    );
    expect(() => encode({ type: 'input', ack: 0, inputs: [] })).toThrow(ProtocolError);
    expect(() =>
      encode({ type: 'input', ack: 0, inputs: Array(4).fill({ seq: 0, dtMs: 50, dir: 0, mag: 1, flags: 0 }) }),
    ).toThrow(ProtocolError);
    expect(() =>
      encode({ type: 'input', ack: 70000, inputs: [{ seq: 0, dtMs: 50, dir: 0, mag: 1, flags: 0 }] }),
    ).toThrow(ProtocolError);
    expect(() => encode({ type: 'error', code: 1, text: 'a'.repeat(300) })).toThrow(ProtocolError);
    expect(() => encode({ type: 'aoi_leave', indices: [1024] })).toThrow(ProtocolError);
    expect(() => encode({ type: 'skill_cast', seq: -1, skillId: 0, targetId: 0, aim: null })).toThrow(ProtocolError);
    expect(() =>
      encode({
        type: 'snapshot',
        seq: 0,
        baselineSeq: null,
        tick: 0,
        self: null,
        entities: [{ index: 0, qi: 70000, qj: 0, anim: 0, dir: 0, hpPct: null }],
      }),
    ).toThrow(ProtocolError);
    expect(() => encode({ type: 'nope' } as unknown as Message)).toThrow(ProtocolError);
  });

  it('input packet carries exactly seq/dtMs/dir/mag/flags (5 bytes each) — docs/08 §4 table', () => {
    const b = encode({ type: 'input', ack: 7, inputs: [{ seq: 513, dtMs: 50, dir: 200, mag: 9, flags: 5 }] });
    expect(Array.from(b)).toEqual([PROTOCOL_VERSION, 1, 0, 7, 1, 2, 1, 50, 200, (9 << 4) | 5]);
  });
});

describe('snapshot deltas', () => {
  const base = new Map<number, { qi: number; qj: number }>();
  const lookup: BaselineLookup = (i) => base.get(i);

  it('uses 8-bit deltas against the baseline and absolute 16-bit otherwise; decode needs the same baseline', () => {
    base.clear();
    base.set(1, { qi: 1000, qj: 2000 });
    base.set(2, { qi: 500, qj: 500 });
    const m: SnapshotMsg = {
      type: 'snapshot',
      seq: 11,
      baselineSeq: 10,
      tick: 123456,
      self: null,
      entities: [
        { index: 1, qi: 1010, qj: 1990, anim: 3, dir: 2, hpPct: null }, // delta (+10, −10)
        { index: 2, qi: 500 + 127, qj: 500 - 128, anim: 1, dir: 7, hpPct: 55 }, // delta extremes
        { index: 3, qi: 4000, qj: 4001, anim: 63, dir: 0, hpPct: 127 }, // no baseline → absolute
        { index: 1, qi: 1000 + 128, qj: 2000, anim: 0, dir: 0, hpPct: null }, // delta out of range → absolute
      ],
    };
    const bytes = encode(m, { baseline: lookup });
    expect(decode(bytes, { baseline: lookup })).toEqual(m);
    // header 1+1+1+2+2+4 + count 2 = 13; records: 37 + 37+7 + 43+7... computed below
    const bits =
      10 +
      1 +
      16 +
      6 +
      3 +
      1 /*delta, no hp*/ +
      (10 + 1 + 16 + 6 + 3 + 1 + 7) +
      (10 + 1 + 32 + 6 + 3 + 1 + 7) +
      (10 + 1 + 32 + 6 + 3 + 1);
    expect(bytes.length).toBe(13 + Math.ceil(bits / 8));
    expect(() => decode(bytes)).toThrowError(/baseline/);
  });

  it('a full snapshot (baselineSeq null) is all absolute and needs no baseline', () => {
    const r = lcg(9);
    const m: SnapshotMsg = {
      type: 'snapshot',
      seq: 1,
      baselineSeq: null,
      tick: 1,
      self: randSelf(r),
      entities: [randEntity(r, 4), randEntity(r, 5)],
    };
    expect(decode(encode(m, { baseline: lookup }))).toEqual(m);
  });

  it('delta chain: positions reconstructed over 200 snapshots with random walks stay exact', () => {
    const r = lcg(21);
    const cur = new Map<number, { qi: number; qj: number }>();
    for (let i = 0; i < 40; i++) cur.set(i, { qi: r.int(100, 60000), qj: r.int(100, 60000) });
    let baseline = new Map(cur);
    let seq = 0;
    for (let n = 0; n < 200; n++) {
      const ents = [] as SnapshotMsg['entities'];
      for (const [i, p] of cur) {
        const jump = r.bool(0.02) ? 500 : 6;
        p.qi = Math.min(65535, Math.max(0, p.qi + r.int(-jump, jump)));
        p.qj = Math.min(65535, Math.max(0, p.qj + r.int(-jump, jump)));
        ents.push({ index: i, qi: p.qi, qj: p.qj, anim: r.int(0, 63), dir: r.int(0, 7), hpPct: null });
      }
      const m: SnapshotMsg = {
        type: 'snapshot',
        seq: seq++ & 0xffff,
        baselineSeq: 0,
        tick: n,
        self: null,
        entities: ents,
      };
      const out = decode(encode(m, { baseline: (i) => baseline.get(i) }), { baseline: (i) => baseline.get(i) });
      expect(out).toEqual(m);
      baseline = new Map([...cur].map(([k, v]) => [k, { ...v }]));
    }
  });

  it('quantisation is 1/32 tile', () => {
    expect(quantizePos(10.5)).toBe(336);
    expect(dequantizePos(336)).toBe(10.5);
    expect(Math.abs(dequantizePos(quantizePos(3.14159)) - 3.14159)).toBeLessThanOrEqual(1 / 64);
    expect(() => quantizePos(-1)).toThrow(ProtocolError);
    expect(() => quantizePos(2048)).toThrow(ProtocolError);
  });
});

describe('JSON debug codec', () => {
  it.each(TYPES)('%s: decodeJson(encodeJson(m)) equals m', (type) => {
    const r = lcg(77 + type.length);
    for (let k = 0; k < 200; k++) {
      const m = randMessage(r, type);
      expect(decodeJson(encodeJson(m))).toEqual(m);
    }
  });
  it('is tagged with the protocol version and is pretty-printable', () => {
    const j = encodeJson({ type: 'ping', clientTimeMs: 9 }, 2);
    expect(JSON.parse(j)).toEqual({ v: PROTOCOL_VERSION, type: 'ping', clientTimeMs: 9 });
    expect(j).toContain('\n');
  });
  it('rejects bad version, bad JSON, unknown fields get dropped, bad ranges throw', () => {
    expect(() => decodeJson('{')).toThrowError(ProtocolError);
    expect(() => decodeJson('[]')).toThrowError(ProtocolError);
    expect(() => decodeJson(JSON.stringify({ v: 99, type: 'ping', clientTimeMs: 1 }))).toThrowError(/version/);
    expect(() => decodeJson(JSON.stringify({ v: 3, type: 'ping', clientTimeMs: -1 }))).toThrowError(ProtocolError);
    expect(() => decodeJson(JSON.stringify({ v: 3, type: 'nope' }))).toThrowError(/unknown message type/);
    expect(decodeJson(JSON.stringify({ v: 3, type: 'ping', clientTimeMs: 4, evil: '__proto__' }))).toEqual({
      type: 'ping',
      clientTimeMs: 4,
    });
  });
  it('binary and JSON decode to the same message', () => {
    const r = lcg(5);
    for (let k = 0; k < 100; k++) {
      const m = randMessage(r);
      expect(decode(encode(m))).toEqual(decodeJson(encodeJson(m)));
    }
  });
});

describe('sim adapters', () => {
  it('selfStateOf → wire → moveStateFromSelf reproduces the movement state (float32 position)', () => {
    let w = createWorld(1);
    w = spawnEntity(w, { id: 1, i: 10.5, j: 20.25 });
    const grid = {
      width: 64,
      height: 64,
      flags: () => 1,
      level: () => 0,
    };
    for (let t = 0; t < 30; t++) {
      w = step(w, [{ kind: 'move', entityId: 1, seq: t + 1, dtMs: 50, dir: 40, mag: 15, flags: t === 3 ? 1 : 0 }], {
        grid,
        skills: [],
      }).world;
    }
    const e = w.entities[0]!;
    const self = selfStateOf(e);
    const out = decode(
      encode({ type: 'snapshot', seq: 1, baselineSeq: null, tick: w.tick, self, entities: [] }),
    ) as SnapshotMsg;
    expect(out.self).toEqual(self);
    const ms = moveStateFromSelf(out.self!, e.agi);
    expect(Math.abs(ms.i - e.i)).toBeLessThan(1e-5);
    expect(ms.dashCdMs).toBe(Math.round(e.dashCdMs));
    expect(ms.layer).toBe(e.layer);
    expect(out.self!.lastSeq).toBe(30);
  });
  it('snapshotEntityOf maps the facing code to the shared 8-direction index', () => {
    let w = createWorld(1);
    w = spawnEntity(w, { id: 1, i: 5.25, j: 6.75, facing: 224 });
    const s = snapshotEntityOf(9, w.entities[0]!, 2, null);
    expect(DIRECTIONS[s.dir]).toBe('E');
    expect([s.index, s.qi, s.qj]).toEqual([9, 168, 216]);
  });
});

describe('v3: skill_cast aim point and self vitals (D78)', () => {
  const self = (vitals: SelfState['vitals']): SelfState => ({
    lastSeq: 1,
    i: 10.5,
    j: 20.25,
    layer: 0,
    flying: false,
    qinggong: false,
    facing: 32,
    dashLeftMs: 0,
    dashCdMs: 0,
    invulnMs: 0,
    vitals,
  });
  const snap = (s: SelfState): Message => ({
    type: 'snapshot',
    seq: 1,
    baselineSeq: null,
    tick: 5,
    self: s,
    entities: [],
  });

  it('skill_cast round-trips with and without an aim point (binary and JSON)', () => {
    for (const aim of [null, { qi: 0, qj: 0 }, { qi: 65535, qj: 12345 }]) {
      const m: Message = { type: 'skill_cast', seq: 9, skillId: 3, targetId: 77, aim };
      expect(decode(encode(m))).toEqual(m);
      expect(decodeJson(encodeJson(m))).toEqual(m);
    }
  });

  it('self vitals round-trip, cost 20 bytes only when present, and the JSON codec validates them', () => {
    const v = { hp: 1200, hpMax: 1200, mp: 394, mpMax: 400, shield: 0 };
    const without = encode(snap(self(null)));
    const withV = encode(snap(self(v)));
    expect(withV.length - without.length).toBe(20);
    expect(decode(withV)).toEqual(snap(self(v)));
    expect(decode(without)).toEqual(snap(self(null)));
    expect(decodeJson(encodeJson(snap(self(v))))).toEqual(snap(self(v)));
    expect(() => encode(snap(self({ ...v, hp: -1 })))).toThrow(ProtocolError);
    expect(() => encode(snap(self({ ...v, shield: 2 ** 32 })))).toThrow(ProtocolError);
  });

  it('rejects unknown cast flags and out-of-range aim', () => {
    const buf = encode({ type: 'skill_cast', seq: 1, skillId: 2, targetId: 3, aim: null });
    const bad = Uint8Array.from(buf);
    bad[bad.length - 1] = 0x80; // unknown flag bit
    expect(() => decode(bad)).toThrow(ProtocolError);
    expect(() => encode({ type: 'skill_cast', seq: 1, skillId: 2, targetId: 3, aim: { qi: 70000, qj: 0 } })).toThrow(
      ProtocolError,
    );
  });
});
