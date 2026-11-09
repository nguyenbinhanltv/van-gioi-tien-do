import { describe, it, expect } from 'vitest';
import { mobZoneAt } from '@vgtd/shared';
import manifest from '../../../tools/procgen/src/gemini/manifest.json';
import {
  COURTYARD,
  SPAWN_CLEAR_RADIUS,
  SWAMP_REACH,
  mulberry32,
  placeProps,
  type PlacementInput,
  type PropDef,
  type Terrain,
} from '../assets/scripts/PropPlacement';

const defs = Object.fromEntries(
  Object.entries(manifest.props).map(([n, p]) => [
    n,
    {
      block: p.block,
      biomes: p.biomes,
      zones: 'zones' in p ? (p.zones as string[]) : undefined,
      weight: p.weight,
      spacing: 'spacing' in p ? (p.spacing as number) : 1,
    } as PropDef,
  ]),
);
const W = 160;
const H = 160;
const spawn = { i: 80, j: 80 };

/** Procedural-looking terrain: smooth value noise -> water ponds in grass / dirt, optional lava patch far away. */
function makeTerrain(seed: number, lava = false): (i: number, j: number) => Terrain | null {
  const r = mulberry32(seed);
  const g = Array.from({ length: 17 * 17 }, () => r());
  const noise = (x: number, y: number) => {
    const fx = (x / W) * 16,
      fy = (y / H) * 16;
    const x0 = Math.min(15, Math.floor(fx)),
      y0 = Math.min(15, Math.floor(fy));
    const tx = fx - x0,
      ty = fy - y0;
    const v = (a: number, b: number) => g[b * 17 + a]!;
    return (
      (v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty
    );
  };
  return (i, j) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return null;
    if (lava && i > 120 && j < 40) return 'lava';
    // keep the spawn square dry, like the real map's spawn search does
    if (Math.max(Math.abs(i - spawn.i), Math.abs(j - spawn.j)) <= 14) return noise(i, j) > 0.55 ? 'dirt' : 'grass';
    const n = noise(i, j);
    return n < 0.3 ? 'water' : n < 0.5 ? 'dirt' : 'grass';
  };
}

function input(over: Partial<PlacementInput> = {}): PlacementInput {
  return { width: W, height: H, seed: 1, spawn, terrain: makeTerrain(5), defs, count: 110, radius: 40, ...over };
}
const isLand = (t: Terrain | null) => t === 'dirt' || t === 'grass';

describe('placeProps', () => {
  it('is deterministic: same map + seed -> identical props', () => {
    expect(placeProps(input())).toEqual(placeProps(input()));
    expect(placeProps(input({ seed: 2 })).props).not.toEqual(placeProps(input({ seed: 1 })).props);
  });

  it('places a courtyard and a scatter, never more than asked', () => {
    const r = placeProps(input());
    expect(r.props.length).toBeGreaterThan(60);
    expect(r.props.length).toBeLessThanOrEqual(110);
    const names = new Set(r.courtyard.map((c) => c.name));
    for (const must of ['sect_gate_paifang', 'pavilion_small', 'well_stone', 'lantern_stone', 'incense_burner'])
      expect(names.has(must), `courtyard has ${must}`).toBe(true);
  });

  it('keeps the spawn clear zone empty (no prop anchor, no blocked tile)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = placeProps(input({ seed, terrain: makeTerrain(seed + 10) }));
      const near = (i: number, j: number) =>
        Math.max(Math.abs(i - spawn.i), Math.abs(j - spawn.j)) <= SPAWN_CLEAR_RADIUS;
      expect([...r.props, ...r.courtyard].filter((p) => near(p.i, p.j))).toEqual([]);
      expect(r.blocked.filter(([i, j]) => near(i, j))).toEqual([]);
    }
  });

  it('only blocks land tiles, never the same tile twice, nothing off the map', () => {
    const terrain = makeTerrain(7);
    const r = placeProps(input({ terrain }));
    const seen = new Set<string>();
    for (const [i, j] of r.blocked) {
      expect(isLand(terrain(i, j)), `blocked ${i},${j}`).toBe(true);
      expect(seen.has(`${i},${j}`), `duplicate ${i},${j}`).toBe(false);
      seen.add(`${i},${j}`);
    }
    for (const p of [...r.props, ...r.courtyard]) expect(isLand(terrain(p.i, p.j))).toBe(true);
  });

  it('maps biomes: swamp trees only near water, none of them on dry land; lava rocks only near lava', () => {
    const terrain = makeTerrain(5, true);
    const near = (i: number, j: number, t: Terrain) => {
      for (let dj = -SWAMP_REACH; dj <= SWAMP_REACH; dj++)
        for (let di = -SWAMP_REACH; di <= SWAMP_REACH; di++) if (terrain(i + di, j + dj) === t) return true;
      return false;
    };
    // widen the scatter so the lava patch (far from the spawn) is reachable
    const r = placeProps(input({ terrain, radius: 80, count: 400 }));
    const swamp = r.props.filter((p) => p.name === 'tree_dead_swamp');
    const lava = r.props.filter((p) => p.name === 'rock_lava_cooled');
    expect(swamp.length).toBeGreaterThan(0);
    for (const p of swamp) expect(near(p.i, p.j, 'water'), `swamp tree ${p.i},${p.j}`).toBe(true);
    for (const p of lava) expect(near(p.i, p.j, 'lava')).toBe(true);
    // lava edges only take lava rocks (never sect props)
    for (const p of r.props.filter((p) => defs[p.name]!.biomes.includes('sect')))
      expect(near(p.i, p.j, 'lava')).toBe(false);
    // a pond is not a swamp: shore tiles do not all grow swamp trees
    expect(
      r.props.filter((p) => defs[p.name]!.biomes.includes('sect') && near(p.i, p.j, 'water')).length,
    ).toBeGreaterThan(0);
    // the slice map has no lava: no lava rock anywhere
    const none = placeProps(input({ terrain: makeTerrain(5, false), radius: 80, count: 400 }));
    expect(none.props.some((p) => p.name === 'rock_lava_cooled')).toBe(false);
  });

  it('does not disconnect the walkable world: reachable land near the spawn barely shrinks, the gate passage stays open', () => {
    for (const seed of [1, 2, 3]) {
      const terrain = makeTerrain(seed + 20);
      const r = placeProps(input({ seed, terrain }));
      const blockedSet = new Set(r.blocked.map(([i, j]) => `${i},${j}`));
      const reach = (blocked: Set<string>) => {
        const seen = new Set<string>([`${spawn.i},${spawn.j}`]);
        const q: Array<[number, number]> = [[spawn.i, spawn.j]];
        while (q.length) {
          const [i, j] = q.pop()!;
          for (const [di, dj] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const ni = i + di,
              nj = j + dj,
              k = `${ni},${nj}`;
            if (seen.has(k) || blocked.has(k) || !isLand(terrain(ni, nj))) continue;
            if (Math.max(Math.abs(ni - spawn.i), Math.abs(nj - spawn.j)) > 40) continue;
            seen.add(k);
            q.push([ni, nj]);
          }
        }
        return seen;
      };
      const before = reach(new Set());
      const after = reach(blockedSet);
      // props occupy tiles, so compare against the land tiles that are NOT blocked themselves
      const free = [...before].filter((k) => !blockedSet.has(k)).length;
      expect(after.size / free, `seed ${seed}`).toBeGreaterThan(0.97);
      const gate = r.courtyard.find((c) => c.name === 'sect_gate_paifang');
      if (gate) {
        expect(blockedSet.has(`${gate.i},${gate.j}`), 'gate passage centre').toBe(false);
        expect(after.has(`${gate.i},${gate.j}`), 'gate passage reachable from the spawn').toBe(true);
      }
    }
  });

  it('keeps the approach line to the gate free of scattered props', () => {
    const r = placeProps(input({ terrain: () => 'grass', count: 300 }));
    const gate = COURTYARD.find((c) => c.name === 'sect_gate_paifang')!;
    expect(gate.di).toBeLessThan(-SPAWN_CLEAR_RADIUS);
    const blocked = new Set(r.blocked.map(([i, j]) => `${i},${j}`));
    for (let k = 3; k <= 9; k++)
      expect(blocked.has(`${spawn.i - k},${spawn.j - k}`), `approach tile -${k}`).toBe(false);
  });

  it('blocks exactly the manifest footprint of each placed prop', () => {
    const r = placeProps(input({ terrain: () => 'grass' }));
    const expected = new Set<string>();
    for (const p of [...r.courtyard, ...r.props])
      for (const [di, dj] of defs[p.name]!.block) expected.add(`${p.i + di},${p.j + dj}`);
    expect(new Set(r.blocked.map(([i, j]) => `${i},${j}`))).toEqual(expected);
  });

  it('honours `spacing`: no two props of spacing 2 closer than 3 tiles (2 free tiles between), every pair keeps at least 1 free tile', () => {
    const footprint = (p: { name: string; i: number; j: number }): Array<[number, number]> => [
      [p.i, p.j],
      ...defs[p.name]!.block.map(([di, dj]) => [p.i + di, p.j + dj] as [number, number]),
    ];
    const dist = (a: Array<[number, number]>, b: Array<[number, number]>) =>
      Math.min(...a.flatMap(([ai, aj]) => b.map(([bi, bj]) => Math.max(Math.abs(ai - bi), Math.abs(aj - bj)))));
    for (const seed of [1, 2, 3]) {
      const r = placeProps(input({ seed, terrain: () => 'grass', count: 200 }));
      const all = [...r.courtyard, ...r.props];
      const tall = r.props.filter((p) => (defs[p.name]!.spacing ?? 1) === 2);
      expect(tall.length, `seed ${seed}: tall trees placed`).toBeGreaterThan(5);
      for (let a = 0; a < tall.length; a++)
        for (let b = a + 1; b < tall.length; b++)
          expect(
            dist(footprint(tall[a]!), footprint(tall[b]!)),
            `${tall[a]!.name}@${tall[a]!.i},${tall[a]!.j} vs ${tall[b]!.name}@${tall[b]!.i},${tall[b]!.j}`,
          ).toBeGreaterThanOrEqual(3);
      // scattered props (incl. 2x2 rocks) never touch another prop's footprint: at least one free tile between
      for (let a = 0; a < r.props.length; a++)
        for (let b = a + 1; b < r.props.length; b++)
          expect(
            dist(footprint(r.props[a]!), footprint(r.props[b]!)),
            `seed ${seed}: ${r.props[a]!.name} vs ${r.props[b]!.name}`,
          ).toBeGreaterThanOrEqual(2);
      expect(all.length).toBeGreaterThan(r.props.length);
    }
  });
});

describe('zone dressing (PART 2 props)', () => {
  const zoneAt = (i: number, j: number) => mobZoneAt(i, j, W);
  const zoneOnly = Object.entries(defs).filter(([, d]) => d.zones && d.biomes.length === 0);

  it('manifest: zone props name real zones and are scatterable', () => {
    const zones = new Set(['bia_rung', 'dam_lay_doc', 'co_thu_trung_tam', 'doc_hoa_dam']);
    for (const [n, d] of Object.entries(defs))
      for (const z of d.zones ?? []) expect(zones.has(z), n + ' ' + z).toBe(true);
    for (const z of ['dam_lay_doc', 'co_thu_trung_tam', 'doc_hoa_dam'])
      expect(
        Object.values(defs).some((d) => d.zones?.includes(z) && d.weight > 0),
        z,
      ).toBe(true);
  });

  it('places each zone dressing only inside its zone and gives every dressed zone some', () => {
    const seen = new Map<string, number>();
    for (const seed of [1, 2, 3]) {
      const r = placeProps(input({ seed, zoneAt, terrain: makeTerrain(seed + 3) }));
      for (const p of r.props) {
        const d = defs[p.name]!;
        if (!d.zones) continue;
        const z = zoneAt(p.i, p.j);
        const inZone = z !== null && d.zones.includes(z);
        // zone-only props must be inside their zone; props that are also biome props (reeds on a shore) may sit elsewhere
        if (d.biomes.length === 0) expect(inZone, p.name + ' at ' + p.i + ',' + p.j + ' zone ' + z).toBe(true);
        if (inZone) seen.set(z!, (seen.get(z!) ?? 0) + 1);
      }
    }
    for (const z of ['dam_lay_doc', 'co_thu_trung_tam', 'doc_hoa_dam']) expect(seen.get(z) ?? 0, z).toBeGreaterThan(0);
  });

  it('is deterministic with a zone function, and without one no zone-only prop is scattered', () => {
    expect(placeProps(input({ zoneAt }))).toEqual(placeProps(input({ zoneAt })));
    const plain = placeProps(input());
    for (const [n] of zoneOnly)
      expect(
        plain.props.some((p) => p.name === n),
        n,
      ).toBe(false);
  });

  it('keeps the big ancient tree (4 x 4) on land with its spacing', () => {
    const r = placeProps(input({ zoneAt, radius: 60, count: 300, terrain: makeTerrain(9) }));
    const trees = r.props.filter((p) => p.name === 'ancient_tree_giant');
    for (const a of trees)
      for (const b of trees)
        if (a !== b) expect(Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j))).toBeGreaterThanOrEqual(5);
  });
});
