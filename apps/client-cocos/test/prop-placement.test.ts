import { describe, it, expect } from 'vitest';
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
});
