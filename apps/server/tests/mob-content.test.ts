import { describe, expect, it } from 'vitest';
import {
  COLLIDER_RADIUS_TILES,
  MOB_AI,
  MOB_BANDS,
  MOB_ID_BASE,
  MOB_PACK_RADIUS,
  MOB_THREAT,
  NETWORK,
  ZONE_SPAWN_TABLES,
  mobDefByKey,
} from '@vgtd/shared';
import { TileGrid, circleBlocked, createWorld, spawnEntity, type EntityState, type SimWorld } from '@vgtd/sim';
import { MobManager, defaultMobZones, isMobId, type MobZone } from '../src/index.js';

const SEED = 20261109;
const N = 256;
/** an open map with scattered blocked tiles so placement has to check walkability */
function mapWithRocks(n = N): TileGrid {
  const rows = Array.from({ length: n }, (_, j) =>
    Array.from({ length: n }, (_, i) => ((i * 7 + j * 13) % 11 === 0 && (i + j) % 3 === 0 ? '#' : '.')).join(''),
  );
  return TileGrid.fromRows(rows);
}
const grid = mapWithRocks();
const zones = defaultMobZones(N);
const centre = { i: N / 2, j: N / 2 };
const cheb = (i: number, j: number): number => Math.max(Math.abs(i - centre.i), Math.abs(j - centre.j));
const radius = Math.max(...zones.map((z) => z.i1)) - Math.min(...zones.map((z) => z.i0));
const R = radius / 2;

function build(seed = SEED): { m: MobManager; w: SimWorld } {
  const m = new MobManager({ seed, zones, grid });
  return { m, w: m.populate(createWorld(seed)) };
}
function infos(m: MobManager): ReturnType<MobManager['info']>[] {
  return Array.from({ length: m.size }, (_, k) => m.info(MOB_ID_BASE + k));
}

describe('spawn layout: tier bands, safe zone, packs (D83)', () => {
  it('is identical for the same seed and different for another one', () => {
    const a = build(SEED);
    const b = build(SEED);
    expect(a.m.stateHash()).toBe(b.m.stateHash());
    expect(infos(a.m).map((x) => x!.home)).toEqual(infos(b.m).map((x) => x!.home));
    expect(build(SEED + 1).m.stateHash()).not.toBe(a.m.stateHash());
  });

  it('spawns more mobs than the old 10-per-def table and never inside the safe zone around the map centre', () => {
    const { m } = build();
    const expected = zones.reduce((n, z) => {
      const t = ZONE_SPAWN_TABLES.find((x) => x.zone === z.zone)!;
      return n + t.groups.reduce((s, g) => s + g.count, 0);
    }, 0);
    expect(m.size).toBe(expected);
    const safe = MOB_BANDS.normal.minFrac * R;
    for (const x of infos(m)) expect(cheb(x!.home.i, x!.home.j)).toBeGreaterThanOrEqual(safe - 1e-9);
  });

  it('every home is on a walkable tile and inside its zone rectangle (map with obstacles)', () => {
    const { m } = build();
    for (const x of infos(m)) {
      const z = zones.find((r) => r.zone === x!.zone)!;
      expect(x!.home.i).toBeGreaterThanOrEqual(z.i0);
      expect(x!.home.i).toBeLessThan(z.i1);
      expect(x!.home.j).toBeGreaterThanOrEqual(z.j0);
      expect(x!.home.j).toBeLessThan(z.j1);
      expect(circleBlocked(grid, x!.home.i, x!.home.j, COLLIDER_RADIUS_TILES, 0, false)).toBe(false);
    }
  });

  it('most mobs sit inside their tier band, and bosses are farther out than normals on average', () => {
    const { m } = build();
    const all = infos(m).map((x) => x!);
    const inBand = all.filter((x) => {
      const b = MOB_BANDS[x.def.tier];
      const d = cheb(x.home.i, x.home.j);
      return d >= b.minFrac * R - 1e-9 && d <= b.maxFrac * R + 1e-9;
    });
    expect(inBand.length / all.length).toBeGreaterThan(0.9);
    const mean = (tier: string): number => {
      const xs = all.filter((x) => x.def.tier === tier).map((x) => cheb(x.home.i, x.home.j));
      return xs.reduce((a, c) => a + c, 0) / xs.length;
    };
    expect(mean('boss')).toBeGreaterThan(mean('elite'));
    expect(mean('elite')).toBeGreaterThan(mean('normal'));
  });

  it('normal mobs come in packs: consecutive members of a group share an anchor within the pack radius', () => {
    const { m } = build();
    const tables = ZONE_SPAWN_TABLES.find((t) => t.zone === 'bia_rung')!;
    const g = tables.groups.find((x) => mobDefByKey(x.def)!.tier === 'normal')!;
    expect(g.pack).toBeGreaterThan(1);
    // first slot of the first bia_rung group is a pack leader (the first zone in defaultMobZones is bia_rung)
    const first = m.info(MOB_ID_BASE)!;
    expect(first.zone).toBe('bia_rung');
    const second = m.info(MOB_ID_BASE + 1)!;
    const third = m.info(MOB_ID_BASE + 2)!;
    const d = (a: typeof first, b: typeof first): number => Math.hypot(a.home.i - b.home.i, a.home.j - b.home.j);
    expect(d(first, second)).toBeLessThanOrEqual(MOB_PACK_RADIUS * Math.SQRT2 + 1e-9);
    expect(d(first, third)).toBeLessThanOrEqual(MOB_PACK_RADIUS * Math.SQRT2 + 1e-9);
  });

  it('a tiny map (bands do not fit) still places every mob on a walkable tile', () => {
    const n = 40;
    const g = TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n)));
    const z = defaultMobZones(n);
    const m = new MobManager({ seed: SEED, zones: z, grid: g });
    expect(m.size).toBeGreaterThan(0);
    for (const x of infos(m))
      expect(circleBlocked(g, x!.home.i, x!.home.j, COLLIDER_RADIUS_TILES, 0, false)).toBe(false);
  });
});

describe('threat table (D83)', () => {
  const tho = mobDefByKey('mob_doc_tho')!;
  const ai = MOB_AI[tho.tier];
  const open = (): TileGrid => TileGrid.fromRows(Array.from({ length: 96 }, () => '.'.repeat(96)));
  function single(): { m: MobManager; w: SimWorld; id: number } {
    const zone: MobZone = { zone: 'bia_rung', i0: 47.9, j0: 47.9, i1: 48.1, j1: 48.1 };
    const m = new MobManager({
      seed: SEED,
      zones: [zone],
      grid: open(),
      tables: [{ zone: 'bia_rung', groups: [{ def: 'mob_doc_tho', count: 1 }] }],
    });
    return { m, w: m.populate(createWorld(SEED)), id: MOB_ID_BASE };
  }
  const advance = (m: MobManager, w: SimWorld): SimWorld =>
    m.step({ ...w, tick: w.tick + 1, timeMs: w.timeMs + NETWORK.TICK_MS });
  const put = (w: SimWorld, id: number, i: number, j: number): SimWorld => spawnEntity(w, { id, i, j, hp: 1000 });
  const move = (w: SimWorld, id: number, i: number, j: number): SimWorld => ({
    ...w,
    entities: w.entities.map((e): EntityState => (e.id === id ? { ...e, i, j } : e)),
  });
  const run = (m: MobManager, w: SimWorld, ticks: number): SimWorld => {
    for (let t = 0; t < ticks; t++) w = advance(m, w);
    return w;
  };

  it('damage from a player outside the aggro radius pulls the mob to the attacker', () => {
    const { m, id, w: w0 } = single();
    const home = m.info(id)!.home;
    let w = put(w0, 1, home.i + ai.aggroRadius + 2, home.j); // would never aggro on proximity
    w = run(m, w, 30);
    expect(['idle', 'wander']).toContain(m.info(id)!.state);
    m.onDamage(id, 1, 50);
    run(m, w, 2);
    expect(m.info(id)!.state).toBe('chase');
    expect(m.info(id)!.target).toBe(1);
    expect(m.info(id)!.threat).toEqual([{ id: 1, value: 50 }]);
  });

  it('chases the highest threat, switches only past the hysteresis ratio, ties go to the lowest id', () => {
    const { m, id, w: w0 } = single();
    const home = m.info(id)!.home;
    let w = put(put(w0, 1, home.i + 2, home.j), 2, home.i, home.j + 2);
    m.onDamage(id, 2, 100);
    w = run(m, w, 2);
    expect(m.info(id)!.target).toBe(2);
    m.onDamage(id, 1, 100); // equal threat: no switch (needs > ratio x current)
    w = run(m, w, 2);
    expect(m.info(id)!.target).toBe(2);
    m.onDamage(id, 1, 100 * MOB_THREAT.switchRatio); // 1 now has 100 + 110 = 210 > 1.1 x 100
    w = run(m, w, 2);
    expect(m.info(id)!.target).toBe(1);
    expect(m.info(id)!.threat.map((t) => t.id)).toEqual([1, 2]);
    // a mob attacker, a dead target, a non-positive amount and an unknown mob add nothing
    m.onDamage(id, MOB_ID_BASE + 5, 999);
    m.onDamage(id, 3, 0);
    m.onDamage(id, 3, -5);
    m.onDamage(MOB_ID_BASE + 77, 1, 10);
    expect(m.info(id)!.threat).toHaveLength(2);
    void w;
  });

  it('forgets an attacker that left (disconnected) and clears everything when the mob returns home or dies', () => {
    const { m, id, w: w0 } = single();
    const home = m.info(id)!.home;
    let w = put(w0, 1, home.i + 3, home.j);
    m.onDamage(id, 1, 40);
    w = run(m, w, 2);
    expect(m.info(id)!.threat).toHaveLength(1);
    w = { ...w, entities: w.entities.filter((e) => e.id !== 1) };
    w = run(m, w, 2);
    expect(m.info(id)!.threat).toHaveLength(0); // the attacker is gone: nothing to chase
    // kite beyond the leash: the mob returns and forgets
    w = put(w, 2, home.i + 3, home.j);
    m.onDamage(id, 2, 40);
    w = run(m, w, 2);
    w = move(w, 2, home.i + ai.leashRadius + 30, home.j);
    w = run(m, w, 6);
    expect(['return', 'idle']).toContain(m.info(id)!.state); // gave up (it is already near home, so it may be idle again)
    expect(m.info(id)!.threat).toHaveLength(0);
    w = run(m, w, 60);
    expect(m.info(id)!.state).not.toBe('chase'); // no turning around at the leash edge
    // death clears the table
    m.onDamage(id, 2, 5);
    expect(m.info(id)!.threat).toHaveLength(1);
    m.kill(w, id);
    expect(m.info(id)!.threat).toHaveLength(0);
    m.onDamage(id, 2, 5); // a dead mob takes no threat
    expect(m.info(id)!.threat).toHaveLength(0);
  });

  it('threat on a far-away player decays and is dropped; the table is capped', () => {
    const { m, id, w: w0 } = single();
    const home = m.info(id)!.home;
    let w = put(w0, 1, home.i + MOB_THREAT.forgetRadius + 1, home.j);
    m.onDamage(id, 1, 5);
    // far from the mob: it starts a chase, but the entry decays (0.2 / s => below 1 after ~8 s) -> a few hundred ticks
    for (let t = 0; t < 400 && m.info(id)!.threat.length > 0; t++) w = advance(m, w);
    expect(m.info(id)!.threat).toHaveLength(0);
    for (let a = 100; a < 140; a++) m.onDamage(id, a, a); // 40 attackers: only the 16 strongest stay
    const kept = m.info(id)!.threat;
    expect(kept).toHaveLength(16);
    expect(kept[0]!.id).toBe(139);
    void w;
  });

  it('same seed + same damage script gives the same state hash', () => {
    const script = (): string => {
      const { m, id, w: w0 } = single();
      const home = m.info(id)!.home;
      let w = put(put(w0, 1, home.i + 2, home.j), 2, home.i, home.j + 3);
      for (let t = 0; t < 120; t++) {
        if (t % 17 === 0) m.onDamage(id, 1 + (t % 2), 10 + t);
        w = advance(m, w);
      }
      return m.stateHash();
    };
    expect(script()).toBe(script());
  });

  it('only mob ids carry threat state: players are never mobs', () => {
    expect(isMobId(1)).toBe(false);
    expect(isMobId(MOB_ID_BASE)).toBe(true);
  });
});
