/**
 * `encodeSnapshotRecords` (D119) is the server's allocation-free snapshot path: it must produce EXACTLY the bytes `encode({type: 'snapshot'})`
 * does, for every input, and refuse exactly what `encode` refuses.
 */
import { describe, expect, it } from 'vitest';
import {
  BitWriter,
  LIMITS,
  ProtocolError,
  SnapshotRecords,
  decode,
  encode,
  encodeSnapshotRecords,
  type BaselinePos,
  type SelfState,
  type SnapshotEntity,
} from '../src/index.js';
import { lcg } from './helpers.js';

const SELF: SelfState = {
  lastSeq: 77,
  i: 12.5,
  j: 30.25,
  layer: 0,
  flying: false,
  qinggong: true,
  facing: 3,
  dashLeftMs: 0,
  dashCdMs: 1500,
  invulnMs: 0,
  vitals: { hp: 900, hpMax: 1000, mp: 40, mpMax: 100, shield: 5 },
  status: { rootMs: 0, slowMs: 1200, slowPct: 30, poisonMs: 800 },
};

function records(list: SnapshotEntity[]): SnapshotRecords {
  const r = new SnapshotRecords();
  list.forEach((e, k) => {
    r.index[k] = e.index;
    r.qi[k] = e.qi;
    r.qj[k] = e.qj;
    r.anim[k] = e.anim;
    r.dir[k] = e.dir;
    r.hp[k] = e.hpPct === null ? -1 : e.hpPct;
  });
  r.count = list.length;
  return r;
}

/** both paths on the same input: the reference `encode` and the records encoder */
function both(
  head: { seq: number; baselineSeq: number | null; tick: number; self: SelfState | null },
  entities: SnapshotEntity[],
  base: (BaselinePos | undefined)[],
): [Uint8Array, Uint8Array] {
  const ref = encode({ type: 'snapshot', ...head, entities }, { baseline: (i) => base[i] });
  const fast = encodeSnapshotRecords(head, records(entities), base);
  return [ref, fast];
}

describe('encodeSnapshotRecords == encode(snapshot)', () => {
  it('is byte-identical on a full snapshot with self, vitals and status (absolute positions, hp on every record)', () => {
    const ents: SnapshotEntity[] = Array.from({ length: 40 }, (_, k) => ({
      index: k * 5,
      qi: 100 + k * 37,
      qj: 65000 - k * 91,
      anim: k % 64,
      dir: k % 8,
      hpPct: k % 127,
    }));
    const [ref, fast] = both({ seq: 1, baselineSeq: null, tick: 4_000_000_000, self: SELF }, ents, []);
    expect(Array.from(fast)).toEqual(Array.from(ref));
    const m = decode(fast);
    expect(m.type === 'snapshot' && m.entities).toHaveLength(40);
  });

  it('is byte-identical for delta records: in range, exactly on the limits, just outside, and with and without a baseline slot', () => {
    const base: (BaselinePos | undefined)[] = [];
    const ents: SnapshotEntity[] = [];
    const deltas = [0, 1, -1, 127, -128, 128, -129, 255, -255, 1000];
    deltas.forEach((d, k) => {
      base[k] = { qi: 5000, qj: 6000 };
      ents.push({ index: k, qi: 5000 + d, qj: 6000 - d, anim: 1, dir: 2, hpPct: null });
    });
    ents.push({ index: 20, qi: 10, qj: 20, anim: 0, dir: 0, hpPct: 0 }); // no baseline for this slot: absolute
    const [ref, fast] = both({ seq: 9, baselineSeq: 8, tick: 123, self: null }, ents, base);
    expect(Array.from(fast)).toEqual(Array.from(ref));
  });

  it('is byte-identical on seeded random snapshots (sizes 0..300, random baselines, with and without self / baselineSeq)', () => {
    const rnd = lcg(2024);
    const int = (max: number): number => Math.floor(rnd() * (max + 1));
    for (let round = 0; round < 300; round++) {
      const n = round === 0 ? 0 : int(300);
      const base: (BaselinePos | undefined)[] = [];
      const ents: SnapshotEntity[] = [];
      const used = new Set<number>();
      while (ents.length < n) {
        const index = int(LIMITS.MAX_LOCAL_INDEX);
        if (used.has(index)) continue;
        used.add(index);
        if (rnd() < 0.7) base[index] = { qi: int(65535), qj: int(65535) };
        const near = base[index] && rnd() < 0.8;
        ents.push({
          index,
          qi: near ? Math.min(65535, Math.max(0, base[index]!.qi + int(300) - 150)) : int(65535),
          qj: near ? Math.min(65535, Math.max(0, base[index]!.qj + int(300) - 150)) : int(65535),
          anim: int(LIMITS.ANIM_MAX),
          dir: int(7),
          hpPct: rnd() < 0.5 ? null : int(LIMITS.HP_PCT_MAX),
        });
      }
      const head = {
        seq: int(65535),
        baselineSeq: rnd() < 0.5 ? null : int(65535),
        tick: int(0xffffffff),
        self: rnd() < 0.5 ? SELF : null,
      };
      const [ref, fast] = both(head, ents, base);
      expect(Array.from(fast), `round ${round}`).toEqual(Array.from(ref));
    }
  });

  it('is reusable: the same SnapshotRecords refilled with a shorter list leaves no stale records behind, and the result is a copy', () => {
    const rec = new SnapshotRecords();
    const fill = (list: SnapshotEntity[]): void => {
      list.forEach((e, k) => {
        rec.index[k] = e.index;
        rec.qi[k] = e.qi;
        rec.qj[k] = e.qj;
        rec.anim[k] = e.anim;
        rec.dir[k] = e.dir;
        rec.hp[k] = e.hpPct === null ? -1 : e.hpPct;
      });
      rec.count = list.length;
    };
    const head = { seq: 1, baselineSeq: null, tick: 5, self: null };
    const a: SnapshotEntity[] = [
      { index: 1, qi: 10, qj: 20, anim: 1, dir: 1, hpPct: 50 },
      { index: 2, qi: 11, qj: 21, anim: 2, dir: 2, hpPct: null },
      { index: 3, qi: 12, qj: 22, anim: 3, dir: 3, hpPct: 7 },
    ];
    fill(a);
    const first = encodeSnapshotRecords(head, rec, []);
    const firstCopy = Array.from(first);
    fill(a.slice(0, 1));
    const second = encodeSnapshotRecords(head, rec, []);
    expect(Array.from(second)).toEqual(Array.from(encode({ type: 'snapshot', ...head, entities: a.slice(0, 1) })));
    expect(Array.from(first)).toEqual(firstCopy); // a later encode never rewrites an earlier result
  });
});

describe('encodeSnapshotRecords refuses what encode refuses', () => {
  const good: SnapshotEntity = { index: 1, qi: 10, qj: 20, anim: 1, dir: 1, hpPct: 50 };
  const head = { seq: 1, baselineSeq: null as number | null, tick: 5, self: null as SelfState | null };

  /** a field value that does not fit its width must throw a ProtocolError from BOTH paths */
  const bad = (over: Partial<Record<keyof SnapshotEntity, number | null>>, h = head): void => {
    const e = { ...good, ...over } as SnapshotEntity;
    expect(() => encode({ type: 'snapshot', ...h, entities: [e] })).toThrow(ProtocolError);
    expect(() => encodeSnapshotRecords(h, records([e]), [])).toThrow(ProtocolError);
  };

  it('record fields out of range or fractional', () => {
    bad({ index: LIMITS.MAX_LOCAL_INDEX + 1 });
    bad({ index: -1 });
    bad({ qi: 65536 });
    bad({ qj: -1 });
    bad({ qi: 1.5 });
    bad({ anim: LIMITS.ANIM_MAX + 1 });
    bad({ dir: 8 });
    bad({ hpPct: LIMITS.HP_PCT_MAX + 1 });
    bad({ qi: Number.NaN });
  });

  it('header fields out of range, and a bad self', () => {
    bad({}, { ...head, seq: 65536 });
    bad({}, { ...head, seq: -1 });
    bad({}, { ...head, baselineSeq: 65536 });
    bad({}, { ...head, tick: 2 ** 32 });
    bad({}, { ...head, tick: 1.5 });
    bad({}, { ...head, self: { ...SELF, facing: 255 } });
    bad({}, { ...head, self: { ...SELF, dashCdMs: 70000 } });
  });
});

describe('BitWriter.finishView', () => {
  it('returns the same bytes as finish() but a view of the writer buffer (no copy), padded like finish()', () => {
    const a = new BitWriter(4);
    const b = new BitWriter(4);
    for (const w of [a, b]) {
      w.write(0b101, 3);
      w.write(0x3ff, 10);
      w.write(1, 1);
    }
    const copy = a.finish();
    const view = b.finishView();
    expect(Array.from(view)).toEqual(Array.from(copy));
    expect(view.buffer).not.toBe(copy.buffer); // finish() allocated, the view shares the writer's own buffer
    b.reset();
    b.write(0xff, 8);
    expect(view[0]).toBe(0xff); // the view is only valid until the writer is reused (documented)
  });
});
