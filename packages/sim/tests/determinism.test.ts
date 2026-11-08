import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FLAG_DODGE,
  FLAG_FLY_TOGGLE,
  TileGrid,
  createWorld,
  spawnEntity,
  stateHash,
  step,
  type SimInput,
  type SimWorld,
} from '../src/index.js';
import { SKILLS, cast, ctxOf, mv } from './helpers.js';

/** Tiny test-only LCG (independent of the sim RNG so the script is reproducible). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function maze(seed: number): TileGrid {
  const r = lcg(seed);
  const rows: string[] = [];
  for (let j = 0; j < 48; j++) {
    let row = '';
    for (let i = 0; i < 48; i++) {
      const edge = i === 0 || j === 0 || i === 47 || j === 47;
      row += edge || (r() < 0.12 && (i + j) % 7 !== 0) ? '#' : r() < 0.03 ? 'n' : '.';
    }
    rows.push(row);
  }
  return TileGrid.fromRows(rows);
}

const ENTITIES = 12;

function script(seed: number) {
  const r = lcg(seed);
  const seqs = new Array<number>(ENTITIES).fill(0);
  return (tick: number): SimInput[] => {
    const out: SimInput[] = [];
    for (let id = 1; id <= ENTITIES; id++) {
      if (r() < 0.08) continue; // dropped packet
      const moving = r() < 0.85;
      const flags = (r() < 0.03 ? FLAG_DODGE : 0) | (r() < 0.01 ? FLAG_FLY_TOGGLE : 0);
      out.push(
        mv(id, (seqs[id - 1] = (seqs[id - 1]! + 1) & 0xffff), moving ? Math.floor(r() * 255) : 255, {
          dtMs: 40 + Math.floor(r() * 11),
          mag: 1 + Math.floor(r() * 15),
          flags,
        }),
      );
      if (r() < 0.02)
        out.push(
          cast(id, tick & 0xffff, 1 + Math.floor(r() * 3), {
            rttMs: Math.floor(r() * 200),
            targetId: 1 + Math.floor(r() * ENTITIES),
          }),
        );
    }
    return out;
  };
}

function initial(seed: number): SimWorld {
  let w = createWorld(seed);
  for (let id = 1; id <= ENTITIES; id++)
    w = spawnEntity(w, { id, i: 2.5 + (id % 6) * 6, j: 2.5 + Math.floor(id / 6) * 6, mp: 5000, agi: 100 + id * 5 });
  return w;
}

function simulate(worldSeed: number, inputSeed: number, ticks: number, checkpoints: number[] = []) {
  const grid = maze(7);
  const ctx = { grid, skills: SKILLS };
  const gen = script(inputSeed);
  let w = initial(worldSeed);
  const hashes: string[] = [];
  for (let t = 0; t < ticks; t++) {
    w = step(w, gen(t), ctx).world;
    if (checkpoints.includes(t + 1)) hashes.push(stateHash(w));
  }
  return { w, hashes, final: stateHash(w) };
}

describe('determinism', () => {
  const CP = [1, 100, 1000, 5000, 10_000];

  it('same seed + same inputs ⇒ identical state hash at every checkpoint over 10,000 ticks', () => {
    const a = simulate(42, 99, 10_000, CP);
    const b = simulate(42, 99, 10_000, CP);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.final).toBe(b.final);
    expect(a.hashes).toHaveLength(CP.length);
    expect(new Set(a.hashes).size).toBe(CP.length); // the state is actually evolving
  });

  it('the hash is sensitive: different input script or different seed ⇒ different hash', () => {
    const base = simulate(42, 99, 2000).final;
    expect(simulate(42, 100, 2000).final).not.toBe(base);
    expect(simulate(43, 99, 2000).final).not.toBe(base); // rng seed changes cast rolls / world state
  });

  it('is independent of how the run is chunked (step is pure; no hidden state)', () => {
    const ticks = 3000;
    const grid = maze(7);
    const ctx = { grid, skills: SKILLS };
    const gen = script(5);
    const inputs = Array.from({ length: ticks }, (_, t) => gen(t));
    let a = initial(1);
    for (let t = 0; t < ticks; t++) a = step(a, inputs[t]!, ctx).world;
    // replay from a deep-copied mid-run snapshot
    let b = initial(1);
    for (let t = 0; t < 1500; t++) b = step(b, inputs[t]!, ctx).world;
    b = JSON.parse(JSON.stringify(b)) as SimWorld;
    for (let t = 1500; t < ticks; t++) b = step(b, inputs[t]!, ctx).world;
    expect(stateHash(b)).toBe(stateHash(a));
  });

  it('input order inside a tick does not matter across different entities', () => {
    const ctx = ctxOf();
    const w0 = initial(3);
    const ins = [mv(1, 1, 10), mv(2, 1, 20), mv(3, 1, 30), cast(4, 1, 3), mv(5, 1, 40)];
    const a = step(w0, ins, ctx).world;
    const b = step(w0, [...ins].reverse(), ctx).world;
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('step() does not mutate its inputs', () => {
    const ctx = ctxOf();
    const w0 = initial(3);
    const before = JSON.stringify(w0);
    const ins = [mv(1, 1, 10), cast(2, 1, 1)];
    const insBefore = JSON.stringify(ins);
    step(w0, ins, ctx);
    expect(JSON.stringify(w0)).toBe(before);
    expect(JSON.stringify(ins)).toBe(insBefore);
  });

  it('golden hash (guards against engine / refactor drift)', () => {
    // If this fails after an intentional gameplay change, re-pin it; if it fails on a different Node version
    // with no code change, the simulation is no longer cross-engine deterministic — that is a bug.
    expect(simulate(42, 99, 2000).final).toBe(GOLDEN_2000);
  });

  it('the sim sources never use Math.random / Date.now / performance.now / unordered iteration of Map/Set', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now/);
      expect(src, f).not.toMatch(/for\s*\([^)]*\bof\s+[a-zA-Z_.]*(moves|casts|byId)\b/); // Maps are lookup-only
      expect(src, f).not.toMatch(/\.(forEach|keys|values|entries)\(\)?[^;]*\b(moves|casts|byId)\b/);
    }
  });
});

const GOLDEN_2000 = 'decc81aa544fbb23';
