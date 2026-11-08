import { describe, expect, it } from 'vitest';
import { NETWORK } from '@vgtd/shared';
import { decode, encode, type BaselineLookup, type SnapshotEntity, type SnapshotMsg } from '../src/index.js';
import { lcg, randSelf } from './helpers.js';

/** Simulate one second (20 ticks) of server snapshots for one client and return the encoded byte count. */
function snapshotBytesPerSecond(near: number, mid: number, far: number, seed: number) {
  const r = lcg(seed);
  const total = near + mid + far;
  const pos = new Map<number, { qi: number; qj: number }>();
  const sent = new Map<number, { qi: number; qj: number }>(); // what the client last received (the delta baseline)
  for (let i = 0; i < total; i++) {
    const p = { qi: r.int(2000, 8000), qj: r.int(2000, 8000) };
    pos.set(i, p);
    sent.set(i, { ...p });
  }
  const self = randSelf(r);
  let bytes = 0;
  let records = 0;
  let packets = 0;
  const baseline: BaselineLookup = (i) => sent.get(i);
  for (let tick = 0; tick < 20; tick++) {
    const entities: SnapshotEntity[] = [];
    for (let i = 0; i < total; i++) {
      const p = pos.get(i)!;
      // entities walk at ~4.5 tiles/s = 7 units per tick, in random headings
      p.qi += r.int(-7, 7);
      p.qj += r.int(-7, 7);
      const band = i < near ? 1 : i < near + mid ? 2 : 4; // 20 / 10 / 5 Hz
      if (tick % band !== 0) continue;
      entities.push({
        index: i,
        qi: p.qi,
        qj: p.qj,
        anim: r.int(0, 5),
        dir: r.int(0, 7),
        hpPct: r.bool(0.1) ? r.int(0, 100) : null,
      });
    }
    const m: SnapshotMsg = {
      type: 'snapshot',
      seq: tick,
      baselineSeq: tick === 0 ? null : tick - 1,
      tick,
      self,
      entities,
    };
    const buf = encode(m, { baseline });
    expect(decode(buf, { baseline })).toEqual(m); // the measured bytes really decode
    bytes += buf.length;
    records += entities.length;
    packets++;
    for (const e of entities) sent.set(e.index, { qi: e.qi, qj: e.qj });
  }
  return { bytes, records, packets, perRecord: bytes / records };
}

const KB = 1024;
// docs/08 §8 "Ước tính băng thông chiều xuống": events + headers per scenario
const EVENTS_KBPS = { combat: 2, market: 3, war: 14 };

describe('bandwidth budgets (docs/08 §8)', () => {
  it('input packet: 5 bytes per input + 5-byte header; 3 inputs at 30 Hz is well under 1 KB/s up', () => {
    const one = encode({ type: 'input', ack: 1, inputs: [{ seq: 1, dtMs: 50, dir: 10, mag: 15, flags: 0 }] });
    const three = encode({
      type: 'input',
      ack: 1,
      inputs: [1, 2, 3].map((seq) => ({ seq, dtMs: 33, dir: 10, mag: 15, flags: 0 })),
    });
    expect(one.length).toBe(10);
    expect(three.length).toBe(20);
    expect(three.length * NETWORK.INPUT_HZ_PC).toBeLessThan(1 * KB);
    expect(three.length * NETWORK.INPUT_HZ_MOBILE).toBeLessThan(1 * KB);
  });

  it('typical entity record is 37–44 bits (~5–6 bytes), matching the doc estimate', () => {
    const s = snapshotBytesPerSecond(30, 20, 20, 1);
    expect(s.perRecord).toBeGreaterThan(4.5);
    expect(s.perRecord).toBeLessThan(6.5); // includes the per-packet header and self block amortised
  });

  it('fighting field monsters (30 near / 20 mid / 20 far): total < 8 KB/s with ~2 KB/s of events', () => {
    const s = snapshotBytesPerSecond(30, 20, 20, 2);
    expect(s.records).toBe(30 * 20 + 20 * 10 + 20 * 5); // 900 entity updates/s as in the doc
    expect(s.bytes).toBeLessThan(6.0 * KB); // doc: ≈ 5.4 KB/s snapshots
    expect(s.bytes + EVENTS_KBPS.combat * KB).toBeLessThan(NETWORK.BANDWIDTH_KBPS_COMBAT * KB);
  });

  it('busy sect market (60 / 40 / 20, entity cap 120): total < 13 KB/s', () => {
    const s = snapshotBytesPerSecond(60, 40, 20, 3);
    expect(s.records).toBe(60 * 20 + 40 * 10 + 20 * 5);
    expect(s.bytes).toBeLessThan(10.2 * KB); // doc: ≈ 10.2 KB/s snapshots
    expect(s.bytes + EVENTS_KBPS.market * KB).toBeLessThan(NETWORK.BANDWIDTH_KBPS_MARKET * KB);
  });

  it('sect war 100 vs 100 (cap 120 visible): total < 25 KB/s with ~14 KB/s of skill/damage events', () => {
    const s = snapshotBytesPerSecond(60, 40, 20, 4);
    expect(s.bytes + EVENTS_KBPS.war * KB).toBeLessThan(NETWORK.BANDWIDTH_KBPS_WAR * KB);
  });

  it('the visible-entity cap fits the 10-bit local index (≤ 1,024) and PC cap 200 / mobile 120 snapshot is < 2 KB', () => {
    expect(NETWORK.MAX_ENTITIES_PER_CLIENT_PC).toBeLessThanOrEqual(1024);
    const r = lcg(8);
    const entities = Array.from({ length: NETWORK.MAX_ENTITIES_PER_CLIENT_MOBILE }, (_, i) => ({
      index: i,
      qi: 1000 + i,
      qj: 1000,
      anim: r.int(0, 5),
      dir: r.int(0, 7),
      hpPct: null,
    }));
    const base: BaselineLookup = (i) => ({ qi: 1000 + i - 3, qj: 1002 });
    const buf = encode(
      { type: 'snapshot', seq: 1, baselineSeq: 0, tick: 1, self: randSelf(r), entities },
      { baseline: base },
    );
    expect(buf.length).toBeLessThan(2 * KB);
  });

  it('other messages stay small: spawn 20 B/entity, skill cast 10 B, skill result < 40 B for 3 hits, ping 6 B', () => {
    expect(encode({ type: 'skill_cast', seq: 1, skillId: 2, targetId: 3 }).length).toBe(10);
    expect(encode({ type: 'ping', clientTimeMs: 1 }).length).toBe(6);
    expect(encode({ type: 'pong', clientTimeMs: 1, serverTimeMs: 2 }).length).toBe(10);
    const enter = encode({
      type: 'aoi_enter',
      entities: [{ index: 1, entityId: 9, kind: 1, defId: 3, qi: 5, qj: 6, anim: 0, dir: 0, hpPct: 100, maxHp: 1200 }],
    });
    expect(enter.length).toBe(4 + 20); // v2: +2 B defId (D74)
    const res = encode({
      type: 'skill_result',
      seq: 1,
      reason: 0,
      skillId: 3,
      readyAtMs: 1000,
      casterIndex: 4,
      hits: [1, 2, 3].map((t) => ({ targetIndex: t, damage: 347, flags: 0 })),
    });
    expect(res.length).toBeLessThan(40);
  });
});
