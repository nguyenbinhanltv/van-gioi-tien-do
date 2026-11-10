import { describe, it, expect } from 'vitest';
import { QUEST_NPCS } from '@vgtd/shared';
import manifest from '../../../tools/procgen/src/gemini/manifest.json';
import {
  NPC_MIN_SEPARATION,
  NPC_MIN_SPAWN_DISTANCE,
  NPC_STANDEE_KEYS,
  SECT_NPC_LAYOUT,
  onApproachLine,
  placeSectNpcs,
  type NpcPlacementInput,
} from '../assets/scripts/NpcPlacement';
import {
  mulberry32,
  placeProps,
  SPAWN_CLEAR_RADIUS,
  type PropDef,
  type Terrain,
} from '../assets/scripts/PropPlacement';

const W = 160;
const H = 160;
const spawn = { i: 80, j: 80 };

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

/** Smooth value-noise terrain with ponds, dry around the spawn (like the real map's spawn search). */
function terrainOf(seed: number): (i: number, j: number) => Terrain | null {
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
    if (Math.max(Math.abs(i - spawn.i), Math.abs(j - spawn.j)) <= 16) return 'grass';
    const n = noise(i, j);
    return n < 0.3 ? 'water' : n < 0.5 ? 'dirt' : 'grass';
  };
}

function inputFor(terrain: (i: number, j: number) => Terrain | null, blocked: Set<string>): NpcPlacementInput {
  return {
    width: W,
    height: H,
    spawn,
    isLand: (i, j) => terrain(i, j) === 'dirt' || terrain(i, j) === 'grass',
    isBlocked: (i, j) => blocked.has(`${i},${j}`),
  };
}

describe('NPC standee keys', () => {
  it('are the manifest npcs, each with a preferred spot, and use the docs/12 npc_<name> id style', () => {
    const m = Object.keys(manifest.npcs).filter((k) => !k.startsWith('_'));
    expect([...m].sort()).toEqual([...NPC_STANDEE_KEYS].sort());
    for (const k of NPC_STANDEE_KEYS) {
      expect(k).toMatch(/^npc_[a-z_]+$/);
      expect(SECT_NPC_LAYOUT[k]).toBeDefined();
    }
  });
});

describe('placeSectNpcs', () => {
  it('places all six on open grass at their preferred spots, deterministically', () => {
    const inp = inputFor(() => 'grass', new Set());
    const a = placeSectNpcs(inp);
    expect(a).toHaveLength(6);
    expect(placeSectNpcs(inp)).toEqual(a);
    for (const n of a) {
      expect(n.i).toBe(spawn.i + SECT_NPC_LAYOUT[n.key].di);
      expect(n.j).toBe(spawn.j + SECT_NPC_LAYOUT[n.key].dj);
    }
  });

  it('keeps the arrival tile and the approach line to the gate free, and the NPCs apart', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const placed = placeSectNpcs(inputFor(terrainOf(seed), new Set()));
      expect(placed.length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      for (const n of placed) {
        expect(Math.max(Math.abs(n.i - spawn.i), Math.abs(n.j - spawn.j))).toBeGreaterThanOrEqual(
          NPC_MIN_SPAWN_DISTANCE,
        );
        expect(onApproachLine(spawn, n.i, n.j), `${n.key} on the approach line`).toBe(false);
      }
      for (let a = 0; a < placed.length; a++)
        for (let b = a + 1; b < placed.length; b++)
          expect(
            Math.max(Math.abs(placed[a]!.i - placed[b]!.i), Math.abs(placed[a]!.j - placed[b]!.j)),
          ).toBeGreaterThanOrEqual(NPC_MIN_SEPARATION);
    }
  });

  it('never stands on water, a coast tile or a blocked tile; it nudges, or skips when nothing fits', () => {
    const terrain = terrainOf(9);
    const blocked = new Set<string>();
    // block the preferred tile of the first NPC: it must move to a neighbour, not overlap
    const first = SECT_NPC_LAYOUT[NPC_STANDEE_KEYS[0]!];
    blocked.add(`${spawn.i + first.di},${spawn.j + first.dj}`);
    const placed = placeSectNpcs(inputFor(terrain, blocked));
    const moved = placed.find((p) => p.key === NPC_STANDEE_KEYS[0]);
    expect(moved).toBeDefined();
    expect(`${moved!.i},${moved!.j}`).not.toBe(`${spawn.i + first.di},${spawn.j + first.dj}`);
    for (const n of placed) {
      expect(blocked.has(`${n.i},${n.j}`)).toBe(false);
      for (const [di, dj] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const t = terrain(n.i + di, n.j + dj);
        expect(t === 'dirt' || t === 'grass', `${n.key} next to water`).toBe(true);
      }
    }
    // an all-water world places nobody
    expect(placeSectNpcs(inputFor(() => 'water', new Set()))).toEqual([]);
  });

  it('never collides with the courtyard or the scattered props of placeProps (whole footprint blocked set)', () => {
    for (const seed of [1, 2, 3]) {
      const terrain = terrainOf(seed + 20);
      const props = placeProps({ width: W, height: H, seed, spawn, terrain, defs, count: 110, radius: 40 });
      const blocked = new Set(props.blocked.map(([i, j]) => `${i},${j}`));
      for (const p of [...props.courtyard, ...props.props]) blocked.add(`${p.i},${p.j}`);
      const npcs = placeSectNpcs(inputFor(terrain, blocked));
      expect(npcs.length).toBeGreaterThanOrEqual(4);
      for (const n of npcs) {
        expect(blocked.has(`${n.i},${n.j}`), `${n.key} on a prop tile`).toBe(false);
        // the plaza stays open: not inside the props' own clear zone either
        expect(Math.max(Math.abs(n.i - spawn.i), Math.abs(n.j - spawn.j))).toBeGreaterThan(SPAWN_CLEAR_RADIUS - 2);
      }
    }
  });
});

describe('quest NPC tiles (D125)', () => {
  it('the standee layout is the table the server range-checks against (shared QUEST_NPCS offsets)', () => {
    for (const n of QUEST_NPCS)
      expect(SECT_NPC_LAYOUT[n.key as keyof typeof SECT_NPC_LAYOUT]).toEqual({ di: n.offset[0], dj: n.offset[1] });
  });
});
