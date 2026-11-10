import { readFileSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MOB_AI,
  MOB_ID_BASE,
  MOB_RESPAWN_MS,
  NETWORK,
  STARTER_MOB_KEY,
  STARTER_MOB_PACKS,
  ZONE_SPAWN_TABLES,
  elementOfWireId,
  mobDefByKey,
  mobRealm,
  mobStats,
} from '@vgtd/shared';
import { ErrorCode, decode, encode, type BaselinePos, type Message } from '@vgtd/protocol';
import {
  TileGrid,
  circleBlocked,
  createWorld,
  spawnEntity,
  stateHash,
  type EntityState,
  type SimWorld,
} from '@vgtd/sim';
import { COLLIDER_RADIUS_TILES, DEFAULT_CLASS, classWireId } from '@vgtd/shared';
import {
  MobManager,
  WorldFullError,
  WorldNode,
  defaultMobZones,
  isMobId,
  type ClientTransport,
  type MobZone,
} from '../src/index.js';

const N = 96;
const open = (): TileGrid => TileGrid.fromRows(Array.from({ length: N }, () => '.'.repeat(N)));
const ZONE: MobZone = { zone: 'bia_rung', i0: 20, j0: 20, i1: 60, j1: 60 };
const SEED = 20261108;

/** Stand-in player entity at an exact position. */
function player(world: SimWorld, id: number, i: number, j: number): SimWorld {
  return spawnEntity(world, { id, i, j, hp: 1000 });
}
function moveEntity(world: SimWorld, id: number, i: number, j: number): SimWorld {
  return { ...world, entities: world.entities.map((e) => (e.id === id ? { ...e, i, j } : e)) };
}
/** One fixed tick of the mob module (the player step is not needed for these tests). */
function advance(m: MobManager, w: SimWorld): SimWorld {
  return m.step({ ...w, tick: w.tick + 1, timeMs: w.timeMs + NETWORK.TICK_MS });
}
function mobs(w: SimWorld): EntityState[] {
  return w.entities.filter((e) => isMobId(e.id));
}
function make(seed = SEED, density = 0.5, zones: MobZone[] = [ZONE]): { m: MobManager; w: SimWorld } {
  const m = new MobManager({ seed, zones, grid: open(), density });
  return { m, w: m.populate(createWorld(seed)) };
}

describe('spawn tables per zone', () => {
  it('spawns table counts x density in table order with ids MOB_ID_BASE + slot, inside the zone and off blocked tiles', () => {
    const rows = Array.from({ length: N }, (_, j) =>
      Array.from({ length: N }, (_, i) => (i % 7 === 3 && j % 5 === 1 ? '#' : '.')).join(''),
    );
    const grid = TileGrid.fromRows(rows);
    const m = new MobManager({ seed: SEED, zones: [ZONE], grid, density: 1 });
    const w = m.populate(createWorld(SEED));
    const table = ZONE_SPAWN_TABLES.find((t) => t.zone === 'bia_rung')!;
    const expected = table.groups.reduce((n, g) => n + g.count, 0);
    expect(m.size).toBe(expected);
    expect(mobs(w)).toHaveLength(expected);
    expect(mobs(w).map((e) => e.id)).toEqual(Array.from({ length: expected }, (_, k) => MOB_ID_BASE + k));
    // slot order follows the table: the first `count` slots are the first group's def
    const first = table.groups[0]!;
    for (let k = 0; k < first.count; k++) expect(m.info(MOB_ID_BASE + k)!.def.key).toBe(first.def);
    for (const e of mobs(w)) {
      expect(e.i).toBeGreaterThanOrEqual(ZONE.i0);
      expect(e.i).toBeLessThan(ZONE.i1);
      expect(e.j).toBeGreaterThanOrEqual(ZONE.j0);
      expect(e.j).toBeLessThan(ZONE.j1);
      expect(circleBlocked(grid, e.i, e.j, COLLIDER_RADIUS_TILES, 0, false)).toBe(false);
      const info = m.info(e.id)!;
      expect(info.level).toBeGreaterThanOrEqual(info.def.levelMin);
      expect(info.level).toBeLessThanOrEqual(info.def.levelMax);
      expect(e.hp).toBe(info.maxHp);
      expect(info.maxHp).toBe(mobStats(info.def, info.level).hp);
    }
  });
  it('density scales the counts and 0 spawns nothing; zones without a table are skipped', () => {
    expect(make(SEED, 2).m.size).toBe(2 * make(SEED, 1).m.size);
    expect(make(SEED, 0).m.size).toBe(0);
    const m = new MobManager({ seed: 1, zones: defaultMobZones(N), grid: open(), density: 0.1 });
    expect(m.size).toBeGreaterThan(4);
  });
});

describe('determinism', () => {
  /** A scripted run: a player walks through the zone for 600 ticks while the mobs react. */
  function run(seed: number, shuffle = false): { mob: string; sim: string } {
    const { m, w: w0 } = make(seed, 0.6);
    let w = player(w0, 7, 30, 30);
    if (shuffle) w = { ...w, entities: [...w.entities].reverse() }; // order must not matter (spawnEntity keeps it sorted)
    for (let t = 0; t < 600; t++) {
      const ang = t / 40;
      w = moveEntity(w, 7, 40 + 12 * Math.sin(ang), 40 + 12 * Math.cos(ang)); // deterministic path (test only)
      w = advance(m, w);
    }
    return { mob: m.stateHash(), sim: stateHash(w) };
  }
  it('same seed + same inputs => identical mob state and world hash', () => {
    expect(run(SEED)).toEqual(run(SEED));
  });
  it('a different seed gives a different outcome', () => {
    const a = run(SEED);
    const b = run(SEED + 1);
    expect(b.mob).not.toBe(a.mob);
    expect(b.sim).not.toBe(a.sim);
  });
  it('mob module sources contain no ambient time or randomness', () => {
    const dir = pjoin(fileURLToPath(new URL('.', import.meta.url)), '../src/world/mobs');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(pjoin(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|setTimeout|hrtime/);
    }
  });
});

describe('aggro, chase, leash and return', () => {
  const tho = mobDefByKey('mob_doc_tho')!;
  const ai = MOB_AI[tho.tier];
  /** a single-mob world: one mob slot from a 1-count table, home at the zone centre */
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
  const dist = (a: { i: number; j: number }, b: { i: number; j: number }): number => Math.hypot(a.i - b.i, a.j - b.j);
  const get = (w: SimWorld, id: number): EntityState => w.entities.find((e) => e.id === id)!;

  it('ignores a player outside the aggro radius and chases one inside it', () => {
    const s0 = single();
    const { m, id } = s0;
    let w = s0.w;
    const home = m.info(id)!.home;
    w = player(w, 1, home.i + ai.aggroRadius + 5, home.j);
    for (let t = 0; t < 40; t++) w = advance(m, w);
    expect(['idle', 'wander']).toContain(m.info(id)!.state);
    w = moveEntity(w, 1, home.i + ai.aggroRadius - 2, home.j);
    for (let t = 0; t < 12; t++) w = advance(m, w); // scan period is 5 ticks
    expect(m.info(id)!.state).toBe('chase');
    expect(m.info(id)!.target).toBe(1);
  });

  it('chases at its own speed, stops at engage range, never deals damage', () => {
    const s0 = single();
    const { m, id } = s0;
    let w = s0.w;
    const home = m.info(id)!.home;
    w = player(w, 1, home.i + ai.aggroRadius - 1, home.j);
    for (let t = 0; t < 200; t++) w = advance(m, w);
    const d = dist(get(w, id), get(w, 1));
    expect(d).toBeLessThanOrEqual(ai.engageRange + 0.6);
    expect(get(w, 1).hp).toBe(1000);
    expect(get(w, id).hp).toBe(m.info(id)!.maxHp);
  });

  it('leash: a kited mob breaks off at the leash radius, returns home and goes idle', () => {
    const s0 = single();
    const { m, id } = s0;
    let w = s0.w;
    const home = m.info(id)!.home;
    w = player(w, 1, home.i + 3, home.j);
    let maxFromHome = 0;
    let sawReturn = false;
    // the player runs away along +i faster than the mob, staying just inside the lose radius ahead of it
    for (let t = 0; t < 600; t++) {
      const mob = get(w, id);
      const px = Math.min(mob.i + 4, home.i + 80);
      w = moveEntity(w, 1, px, home.j);
      w = advance(m, w);
      maxFromHome = Math.max(maxFromHome, dist(get(w, id), home));
      if (m.info(id)!.state === 'return') sawReturn = true;
    }
    expect(sawReturn).toBe(true);
    // never far beyond the leash radius (one tick of movement of overshoot)
    expect(maxFromHome).toBeLessThanOrEqual(ai.leashRadius + 0.5);
    // player is gone far away now: the mob walked home and is idling there
    w = moveEntity(w, 1, home.i + 80, home.j + 80);
    for (let t = 0; t < 600; t++) w = advance(m, w);
    expect(dist(get(w, id), home)).toBeLessThanOrEqual(ai.wanderRadius + 0.7);
    expect(['idle', 'wander']).toContain(m.info(id)!.state);
  });

  it('a returning mob ignores players until it is home', () => {
    const s0 = single();
    const { m, id } = s0;
    let w = s0.w;
    const home = m.info(id)!.home;
    w = player(w, 1, home.i + 3, home.j);
    for (let t = 0; t < 30; t++) w = advance(m, w);
    expect(m.info(id)!.state).toBe('chase');
    w = moveEntity(w, 1, home.i + 200, home.j); // target vanishes far away: lose radius exceeded
    w = advance(m, w);
    expect(m.info(id)!.state).toBe('return');
    // a new player stands right next to the returning mob: no re-aggro during the walk home
    const mob = get(w, id);
    w = player(w, 2, mob.i + 1, mob.j);
    if (dist(mob, home) > ai.homeRadius + 1) {
      w = advance(m, w);
      expect(m.info(id)!.state).toBe('return');
    }
  });
});

describe('combatStats (seam for the combat step)', () => {
  it('reports defense, realm, main element, drop source and max HP of a living mob, undefined otherwise', () => {
    const { m, w } = make(SEED, 1);
    for (const e of mobs(w)) {
      const info = m.info(e.id)!;
      const cs = m.combatStats(e.id)!;
      const st = mobStats(info.def, info.level);
      expect(cs).toEqual({
        defense: st.def,
        realm: mobRealm(info.level),
        element: info.def.elements[info.variant] ?? info.def.elements[0],
        dropSource: info.def.tier === 'normal' ? 'field' : info.def.tier,
        hpMax: info.maxHp,
        tier: info.def.tier,
      });
      expect(cs.realm).toBeGreaterThanOrEqual(1);
    }
    expect(m.combatStats(12345)).toBeUndefined(); // a player id
    expect(m.combatStats(MOB_ID_BASE + 99999)).toBeUndefined();
    const id = mobs(w)[0]!.id;
    m.kill(w, id);
    expect(m.combatStats(id)).toBeUndefined();
  });
  it('a respawned mob reports the stats of its new level', () => {
    const { m, w: w0 } = make(SEED, 0.3);
    let w = m.kill(w0, mobs(w0)[0]!.id);
    const id = MOB_ID_BASE;
    for (let t = 0; t < 40_000 && !m.combatStats(id); t++) w = advance(m, w);
    const cs = m.combatStats(id)!;
    const info = m.info(id)!;
    expect(cs.defense).toBe(mobStats(info.def, info.level).def);
    expect(cs.hpMax).toBe(info.maxHp);
  });
});

describe('respawn', () => {
  it('kill despawns the mob and respawns it after the tier timer at its home with a fresh level', () => {
    const { m, w: w0 } = make(SEED, 0.3);
    let w = w0;
    const id = mobs(w)[0]!.id;
    const before = m.info(id)!;
    const alive = m.alive;
    w = { ...w, tick: 100 };
    w = m.kill(w, id);
    expect(m.info(id)!.alive).toBe(false);
    expect(m.alive).toBe(alive - 1);
    expect(w.entities.some((e) => e.id === id)).toBe(false);
    expect(m.kill(w, id)).toBe(w); // killing a dead mob is a no-op
    const delay = Math.ceil(MOB_RESPAWN_MS[before.def.tier] / NETWORK.TICK_MS);
    expect(m.info(id)!.respawnAtTick).toBe(100 + delay);
    // not before the timer
    w = { ...w, tick: 100 + delay - 2 };
    w = advance(m, w); // tick = 100 + delay - 1
    expect(w.entities.some((e) => e.id === id)).toBe(false);
    w = advance(m, w); // tick = 100 + delay
    const back = w.entities.find((e) => e.id === id)!;
    expect(back).toBeDefined();
    expect(m.info(id)!.alive).toBe(true);
    expect(m.info(id)!.home).toEqual(before.home);
    expect(back.i).toBe(before.home.i);
    expect(back.hp).toBe(m.info(id)!.maxHp);
    expect(m.alive).toBe(alive);
    // world stays sorted by id
    expect(w.entities.map((e) => e.id)).toEqual([...w.entities.map((e) => e.id)].sort((a, b) => a - b));
  });
  it('respawns are deterministic too', () => {
    const go = (): string => {
      const { m, w: w0 } = make(SEED, 0.3);
      let w = w0;
      for (const e of mobs(w).slice(0, 5)) w = m.kill(w, e.id);
      for (let t = 0; t < 1000; t++) w = advance(m, w);
      return m.stateHash() + stateHash(w);
    };
    expect(go()).toBe(go());
  });
});

// ---------------------------------------------------------------------------------------------- AOI / replication
class Fake implements ClientTransport {
  msgs: Message[] = [];
  known = new Map<number, BaselinePos>();
  seq = 0;
  last = 0;
  send(data: Uint8Array): void {
    const m = decode(data, { baseline: (i) => this.known.get(i) });
    this.msgs.push(m);
    if (m.type === 'snapshot') {
      this.last = m.seq;
      for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    } else if (m.type === 'aoi_enter') for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    else if (m.type === 'aoi_leave') for (const i of m.indices) this.known.delete(i);
  }
  close(_c: ErrorCode, _t: string): void {}
  buffered(): number {
    return 0;
  }
  input(dir: number): Uint8Array {
    return encode({
      type: 'input',
      ack: this.last,
      inputs: [{ seq: ++this.seq & 0xffff, dtMs: 50, dir, mag: 15, flags: 0 }],
    });
  }
}

describe('player ids stay below MOB_ID_BASE', () => {
  const zone: MobZone = { zone: 'bia_rung', i0: 70, j0: 70, i1: 90, j1: 90 };
  const setNextId = (n: WorldNode, v: number): void => {
    (n as unknown as { nextId: number }).nextId = v;
  };
  it('with mobs, the join that would take id MOB_ID_BASE is refused and nothing is added', () => {
    const n = new WorldNode({
      seed: SEED,
      mapTiles: 160,
      spawn: { i0: 78, j0: 78, side: 4 },
      mobs: { zones: [zone], density: 0.2 },
    });
    setNextId(n, MOB_ID_BASE - 1);
    const last = new Fake();
    expect(n.addPlayer(last, 'last')).toBe(MOB_ID_BASE - 1); // the last legal id
    const before = n.world.entities.length;
    expect(() => n.addPlayer(new Fake(), 'late')).toThrow(WorldFullError);
    expect(n.clients.size).toBe(1);
    expect(n.world.entities).toHaveLength(before);
    // no entity id appears twice, and the player is not mistaken for a mob
    const ids = n.world.entities.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(n.mobs!.kindOf(MOB_ID_BASE - 1)).toBe(0);
    for (let t = 0; t < 20; t++) n.tick(); // still runs
  });
  it('a player leaving does not free an id above the limit; a node without mobs is unaffected', () => {
    const plain = new WorldNode({ seed: SEED, mapTiles: 160, spawn: { i0: 78, j0: 78, side: 4 } });
    setNextId(plain, MOB_ID_BASE + 5);
    expect(plain.addPlayer(new Fake(), 'a')).toBe(MOB_ID_BASE + 5); // no mobs: no collision possible, allocation unchanged
  });
});

describe('AOI replicates mobs', () => {
  const zone: MobZone = { zone: 'bia_rung', i0: 70, j0: 70, i1: 90, j1: 90 };
  function nodeWithMobs(density = 1): { n: WorldNode; c: Fake; id: number } {
    const n = new WorldNode({
      seed: SEED,
      mapTiles: 160,
      spawn: { i0: 78, j0: 78, side: 4 },
      mobs: { zones: [zone], density },
    });
    const c = new Fake();
    const id = n.addPlayer(c, 'acc');
    return { n, c, id };
  }
  it('mobs near a player arrive in aoi_enter as kind 1 with defId and maxHp, then move in snapshots', () => {
    const { n, c } = nodeWithMobs();
    for (let t = 0; t < 80; t++) n.tick();
    const enters = c.msgs.flatMap((m) => (m.type === 'aoi_enter' ? m.entities : []));
    const monsters = enters.filter((e) => e.kind === 1);
    expect(monsters.length).toBeGreaterThan(5);
    for (const e of monsters) {
      expect(isMobId(e.entityId)).toBe(true);
      expect(e.defId).toBe(n.mobs!.info(e.entityId)!.def.id);
      expect([1, 2, 3, 4]).toContain(e.defId); // the bia_rung defs
      expect(e.maxHp).toBe(n.mobs!.info(e.entityId)!.maxHp);
      expect(e.hpPct).toBe(100);
    }
    expect(enters.filter((e) => e.kind === 0)).toHaveLength(0); // the player itself is never listed
    const idx = new Set(monsters.map((e) => e.index));
    const moved = c.msgs.some((m) => m.type === 'snapshot' && m.entities.some((e) => idx.has(e.index) && e.anim === 1));
    expect(moved).toBe(true);
  });
  it('every monster enter carries its own element on the wire: main or variant (D114), absent for an elementless mob (D120)', () => {
    const { n, c } = nodeWithMobs();
    for (let t = 0; t < 80; t++) n.tick();
    const monsters = c.msgs.flatMap((m) => (m.type === 'aoi_enter' ? m.entities : [])).filter((e) => e.kind === 1);
    expect(monsters.length).toBeGreaterThan(5);
    let variants = 0;
    for (const e of monsters) {
      const info = n.mobs!.info(e.entityId)!;
      const want = info.def.elements[info.variant] ?? info.def.elements[0] ?? null;
      expect(elementOfWireId(e.element ?? 0)).toBe(want);
      if (info.variant === 1) variants++;
    }
    expect(variants).toBeGreaterThan(0); // some packs of a two-element mob carry the second element
  });
  it('a mob that leaves the area (killed) is sent as aoi_leave, and re-enters when it respawns', () => {
    const { n, c } = nodeWithMobs(0.2);
    for (let t = 0; t < 10; t++) n.tick();
    const enters = c.msgs.flatMap((m) => (m.type === 'aoi_enter' ? m.entities : [])).filter((e) => e.kind === 1);
    expect(enters.length).toBeGreaterThan(0);
    const victim = enters[0]!;
    n.world = n.mobs!.kill(n.world, victim.entityId);
    const before = c.msgs.length;
    for (let t = 0; t < 4; t++) n.tick();
    const leaves = c.msgs.slice(before).flatMap((m) => (m.type === 'aoi_leave' ? m.indices : []));
    expect(leaves).toContain(victim.index);
    const delay = Math.ceil(MOB_RESPAWN_MS[n.mobs!.info(victim.entityId)!.def.tier] / NETWORK.TICK_MS);
    for (let t = 0; t < delay + 6; t++) n.tick();
    const again = c.msgs.slice(before).flatMap((m) => (m.type === 'aoi_enter' ? m.entities : []));
    expect(again.some((e) => e.entityId === victim.entityId)).toBe(true);
  });
  it('a node without mobs behaves as before (no monsters; a player carries its class wire id as defId, D82)', () => {
    const n = new WorldNode({ seed: SEED, mapTiles: 160, spawn: { i0: 78, j0: 78, side: 4 } });
    const c = new Fake();
    n.addPlayer(c, 'a');
    const c2 = new Fake();
    n.addPlayer(c2, 'b');
    for (let t = 0; t < 30; t++) n.tick();
    expect(n.mobs).toBeNull();
    const ents = c.msgs.flatMap((m) => (m.type === 'aoi_enter' ? m.entities : []));
    expect(ents.length).toBeGreaterThan(0);
    for (const e of ents) expect([e.kind, e.defId]).toEqual([0, classWireId(DEFAULT_CLASS)]);
  });
});

describe('starter packs (D123)', () => {
  it('the first packs of the first-quest mob spawn within a short walk of the spawn square, on the full slice map', () => {
    const n = 256;
    const grid = TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n)));
    const m = new MobManager({ seed: SEED, zones: defaultMobZones(n), grid });
    const w = m.populate(createWorld(SEED));
    const def = mobDefByKey(STARTER_MOB_KEY)!;
    const near = mobs(w).filter(
      (e) =>
        m.info(e.id)?.def.id === def.id && Math.max(Math.abs(e.i - n / 2), Math.abs(e.j - n / 2)) <= 0.22 * 120 + 3,
    );
    // 2 packs of 3 (pack members sit within MOB_PACK_RADIUS of the leader)
    expect(near.length).toBeGreaterThanOrEqual(STARTER_MOB_PACKS * 3);
  });
});
