import { NETWORK } from '@vgtd/shared';
import {
  createWorld,
  spawnEntity,
  step,
  type CastInput,
  type MoveInput,
  type SimContext,
  type SimEvent,
  type SimWorld,
  type SkillDef,
  type SpawnOptions,
} from '../src/index.js';
import { TileGrid } from '../src/index.js';

export const SE = 0; // +i
export const S = 32; // (+i, +j)
export const E = 224; // (+i, −j)
export const SW = 64; // +j
export const NW = 128; // −i

export function mv(entityId: number, seq: number, dir: number, o: Partial<MoveInput> = {}): MoveInput {
  return { kind: 'move', entityId, seq, dtMs: 50, dir, mag: dir === 255 ? 0 : 15, flags: 0, ...o };
}
export function cast(entityId: number, seq: number, skillId: number, o: Partial<CastInput> = {}): CastInput {
  return { kind: 'cast', entityId, seq, skillId, targetId: 0, rttMs: 0, ...o };
}

export function openGrid(n = 64): TileGrid {
  return TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n)));
}

export const SKILLS: SkillDef[] = [
  { id: 0, key: 't.unused', cooldownMs: 0, gcdMs: 0, mpCostPct: 0, range: 0, requiresLos: false, targeting: 'none' },
  {
    id: 1,
    key: 't.self',
    cooldownMs: 3000,
    gcdMs: 500,
    mpCostPct: 0.1,
    range: 0,
    requiresLos: false,
    targeting: 'none',
  },
  { id: 2, key: 't.bolt', cooldownMs: 1000, gcdMs: 0, mpCostPct: 0, range: 8, requiresLos: true, targeting: 'enemy' },
  { id: 3, key: 't.free', cooldownMs: 0, gcdMs: 0, mpCostPct: 0, range: 0, requiresLos: false, targeting: 'none' },
];

export function ctxOf(grid: TileGrid = openGrid()): SimContext {
  return { grid, skills: SKILLS };
}

export function worldWith(seed: number, ...spawns: SpawnOptions[]): SimWorld {
  let w = createWorld(seed);
  for (const s of spawns) w = spawnEntity(w, s);
  return w;
}

/** Run `ticks` ticks feeding one input per tick from `gen(tick)`; returns final world + all events. */
export function run(
  world: SimWorld,
  ctx: SimContext,
  ticks: number,
  gen: (tick: number) => (MoveInput | CastInput)[],
): { world: SimWorld; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let w = world;
  for (let t = 0; t < ticks; t++) {
    const r = step(w, gen(t), ctx, NETWORK.TICK_MS);
    w = r.world;
    events.push(...r.events);
  }
  return { world: w, events };
}

export function ent(w: SimWorld, id: number) {
  const e = w.entities.find((x) => x.id === id);
  if (!e) throw new Error(`no entity ${id}`);
  return e;
}
