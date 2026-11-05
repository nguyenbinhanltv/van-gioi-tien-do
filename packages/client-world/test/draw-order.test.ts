import { describe, expect, it } from 'vitest';
import { Layer, cliffFaceGroup, compareDrawOrder, sortKey } from '@vgtd/shared';
import {
  buildDrawPlan,
  cliffFaceObject,
  entityDrawItem,
  findDrawOrderInversions,
  objectDrawItems,
  orderForDraw,
  type DrawItem,
  type WorldObject,
} from '../src/index.js';

// ------------------------------------------------------------------ deterministic generator
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const N = 32;

interface GenMap {
  elevation: Uint8Array;
  objects: WorldObject[];
}

/** 32×32 map: nested plateaus (levels 1 and 2) with cliff faces on their +i / +j edges, plus 1×1, 2×2, 4×4 props. */
function generateMap(seed: number): GenMap {
  const r = rng(seed);
  const elevation = new Uint8Array(N * N);
  const rect = (i0: number, j0: number, w: number, h: number, level: number): void => {
    for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) elevation[j * N + i] = level;
  };
  const pw = 10 + Math.floor(r() * 6);
  const ph = 10 + Math.floor(r() * 6);
  const pi = 2 + Math.floor(r() * 8);
  const pj = 2 + Math.floor(r() * 8);
  rect(pi, pj, pw, ph, 1);
  rect(pi + 3, pj + 3, pw - 6, ph - 6, 2);
  const el = (i: number, j: number): number => (i < 0 || j < 0 || i >= N || j >= N ? 0 : elevation[j * N + i]!);

  const objects: WorldObject[] = [];
  const used = new Uint8Array(N * N);
  let id = 1;
  // cliff faces: the higher tile whose +i or +j neighbour is lower carries the face
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const e = el(i, j);
      if (e > 0 && (el(i + 1, j) < e || el(i, j + 1) < e)) {
        objects.push(cliffFaceObject(id++, i, j, e));
        used[j * N + i] = 1;
      }
    }
  }
  // Level-design rule (docs/04 §3): keep props one tile away from cliff cells.
  const keepOut = new Uint8Array(N * N);
  for (const o of objects) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = o.i0 + di;
        const j = o.j0 + dj;
        if (i >= 0 && j >= 0 && i < N && j < N) keepOut[j * N + i] = 1;
      }
    }
  }
  // props: sizes by weight; footprint must be free and on one elevation level
  const sizes: Array<[number, number, number, number]> = [
    // w, h, spriteW, spriteH
    [1, 1, 64, 128],
    [1, 1, 64, 96],
    [2, 2, 128, 128],
    [4, 4, 256, 192],
  ];
  for (let attempt = 0; attempt < 400; attempt++) {
    const pick = r();
    const [w, h, sw, sh] = pick < 0.6 ? sizes[0]! : pick < 0.8 ? sizes[1]! : pick < 0.95 ? sizes[2]! : sizes[3]!;
    const i0 = Math.floor(r() * (N - w + 1));
    const j0 = Math.floor(r() * (N - h + 1));
    const level = el(i0, j0);
    let ok = true;
    for (let j = j0; j < j0 + h && ok; j++) {
      for (let i = i0; i < i0 + w && ok; i++) ok = !used[j * N + i] && !keepOut[j * N + i] && el(i, j) === level;
    }
    if (!ok) continue;
    for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) used[j * N + i] = 1;
    objects.push({ id: id++, layer: Layer.L3_YSORT, i0, j0, w, h, group: level, spriteWidth: sw, spriteHeight: sh });
  }
  return { elevation, objects };
}

describe('generated 32×32 map with cliffs and 2×2 / 4×4 objects', () => {
  it('has cliffs, and all prop sizes appear across seeds', () => {
    const sizes = new Set<string>();
    let cliffs = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (const o of generateMap(seed).objects) {
        if (o.kind === 'cliff') cliffs++;
        else sizes.add(`${o.w}x${o.h}`);
      }
    }
    expect(cliffs).toBeGreaterThan(50);
    expect([...sizes].sort()).toEqual(['1x1', '2x2', '4x4']);
  });

  it('has zero draw-order inversions over 200 seeds (4×4 sliced, 2×2 / 1×1 sorted by bottom vertex)', () => {
    let checked = 0;
    let slices = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { objects } = generateMap(seed);
      const items = objects.flatMap((o) => objectDrawItems(o));
      slices += items.length - objects.length;
      const ordered = orderForDraw(items);
      const inv = findDrawOrderInversions(ordered);
      expect(inv.map((x) => [x.first.sourceId, x.second.sourceId])).toEqual([]);
      checked += ordered.length;
    }
    expect(slices).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(10_000);
  });

  it('the verifier is not vacuous: an unsliced 4×4 next to a 1×1 in front IS an inversion, slicing fixes it', () => {
    const big: WorldObject = {
      id: 1,
      layer: Layer.L3_YSORT,
      i0: 0,
      j0: 0,
      w: 4,
      h: 4,
      group: 0,
      spriteWidth: 256,
      spriteHeight: 192,
    };
    const small: WorldObject = {
      id: 2,
      layer: Layer.L3_YSORT,
      i0: 4,
      j0: 0,
      w: 1,
      h: 1,
      group: 0,
      spriteWidth: 64,
      spriteHeight: 96,
    };
    const unsliced = orderForDraw([...objectDrawItems(big, 99), ...objectDrawItems(small)]);
    expect(findDrawOrderInversions(unsliced).length).toBeGreaterThan(0);
    const sliced = orderForDraw([...objectDrawItems(big), ...objectDrawItems(small)]);
    expect(findDrawOrderInversions(sliced)).toEqual([]);
    expect(objectDrawItems(big)).toHaveLength(7); // w + h - 1 columns
  });

  it('elevation groups: low groups always precede high groups; cliff faces use the lower group', () => {
    const { objects } = generateMap(7);
    const ordered = orderForDraw(objects.flatMap((o) => objectDrawItems(o)));
    for (let k = 1; k < ordered.length; k++) expect(ordered[k]!.group).toBeGreaterThanOrEqual(ordered[k - 1]!.group);
    for (const o of objects.filter((x) => x.kind === 'cliff')) {
      const top = Math.min(2, Math.max(1, o.group + 1));
      expect(o.group).toBe(cliffFaceGroup(top));
    }
  });
});

describe('entities vs props', () => {
  const tree: WorldObject = {
    id: 10,
    layer: Layer.L3_YSORT,
    i0: 5,
    j0: 5,
    w: 1,
    h: 1,
    group: 0,
    spriteWidth: 64,
    spriteHeight: 128,
  };
  const player = (i: number, j: number, group = 0, id = 1): DrawItem =>
    entityDrawItem({ id, i, j, group, width: 48, height: 100 });
  const orderOf = (...items: DrawItem[]): number[] => orderForDraw(items).map((x) => x.sourceId);

  it('entity in the +i / +j neighbour cell (centre) is drawn after the prop; behind it, before', () => {
    const t = objectDrawItems(tree);
    expect(orderOf(...t, player(6.5, 5.5))).toEqual([10, 1]); // +i neighbour
    expect(orderOf(...t, player(5.5, 6.5))).toEqual([10, 1]); // +j neighbour: exact sortY tie, resolved by STATIC_SORT_BIAS
    expect(orderOf(...t, player(4.5, 5.5))).toEqual([1, 10]);
    expect(orderOf(...t, player(5.5, 4.5))).toEqual([1, 10]);
  });

  it('2×2 prop: pivot = bottom vertex', () => {
    const rock: WorldObject = { ...tree, id: 11, i0: 5, j0: 5, w: 2, h: 2 };
    const r = objectDrawItems(rock);
    expect(r).toHaveLength(1);
    expect(orderOf(...r, player(7.5, 6.5))).toEqual([11, 1]);
    expect(orderOf(...r, player(6.5, 6.5))).toEqual([1, 11]); // inside the footprint: sortY below the bottom vertex
  });

  it('boss n×n sorts by the bottom vertex of its footprint', () => {
    const boss = entityDrawItem({ id: 5, i: 10, j: 10, group: 0, width: 256, height: 256, bossSize: 4 });
    expect(boss.sortY).toBe((10 + 2 + 10 + 2) * 16);
  });

  it('cliff: entity on the lower ground in front of a face is drawn after it; on the plateau (higher group) also after', () => {
    const face = cliffFaceObject(20, 5, 5, 1);
    expect(orderOf(...objectDrawItems(face), player(6.1, 5.2, 0))).toEqual([20, 1]); // lower ground, +i side
    expect(orderOf(...objectDrawItems(face), player(5.2, 6.1, 0))).toEqual([20, 1]); // lower ground, +j side
    expect(orderOf(...objectDrawItems(face), player(3.5, 3.5, 1))).toEqual([20, 1]); // plateau top: group 1
    expect(orderOf(...objectDrawItems(face), player(4.5, 4.5, 0))).toEqual([1, 20]); // behind the cliff on low ground
  });
});

describe('layers', () => {
  const mk = (layer: Layer, group: number, id: number, sortY = 0): DrawItem => ({
    layer,
    group,
    id,
    sourceId: id,
    sortY,
    x: 0,
    dynamic: false,
    rect: { x: 0, y: 0, width: 1, height: 1 },
  });

  it('only L3 is sorted; other layers keep insertion order; layers come out ascending', () => {
    const items = [
      mk(Layer.L4_AIR, 0, 1, 50),
      mk(Layer.L3_YSORT, 0, 2, 30),
      mk(Layer.L0_GROUND, 0, 3, 99),
      mk(Layer.L3_YSORT, 0, 4, 10),
      mk(Layer.L0_GROUND, 0, 5, 1),
      mk(Layer.L4_AIR, 0, 6, 1),
    ];
    expect(orderForDraw(items).map((x) => x.id)).toEqual([3, 5, 4, 2, 1, 6]);
  });

  it('buildDrawPlan interleaves ground and Y-sort per elevation level, then L4+', () => {
    const items = [
      mk(Layer.L3_YSORT, 1, 1, 5),
      mk(Layer.L0_GROUND, 1, 2),
      mk(Layer.L0_GROUND, 0, 3),
      mk(Layer.L3_YSORT, 0, 4, 100),
      mk(Layer.L3_YSORT, 0, 5, 20),
      mk(Layer.L4_AIR, 0, 6),
      mk(Layer.L2_SHADOW, 0, 7),
    ];
    const plan = buildDrawPlan(items).map(
      (s) => `${s.kind}:${'level' in s ? s.level : 'group' in s ? s.group : s.layer}:${s.items.map((x) => x.id)}`,
    );
    expect(plan).toEqual(['ground:0:3,7', 'ysort:0:5,4', 'ground:1:2', 'ysort:1:1', 'layer:4:6']);
  });
});

describe('benchmark: sorting 2,000 sprites', () => {
  function makeItems(n: number, seed: number): DrawItem[] {
    const r = rng(seed);
    const items: DrawItem[] = [];
    for (let k = 0; k < n; k++) {
      const i = r() * 64;
      const j = r() * 64;
      const e = entityDrawItem({ id: k + 1, i, j, group: Math.floor(r() * 3), width: 48, height: 100 });
      items.push(e);
    }
    return items;
  }
  const time = (fn: () => void, reps: number): number => {
    for (let k = 0; k < 20; k++) fn(); // warm-up
    const t0 = performance.now();
    for (let k = 0; k < reps; k++) fn();
    return (performance.now() - t0) / reps;
  };

  it('reports timings and stays well inside a 16.6 ms frame', () => {
    const base = makeItems(2000, 42);
    const shuffled = (): DrawItem[] => base.slice();
    const fullSort = time(() => {
      shuffled().sort(compareDrawOrder);
    }, 200);

    // Frame-to-frame coherence: previous order, 5% of the sprites moved a little
    const prev = base.slice().sort(compareDrawOrder);
    const r = rng(7);
    const moved = prev.map((it) => (r() < 0.05 ? { ...it, sortY: it.sortY + (r() - 0.5) * 200 } : it));
    const incremental = time(() => {
      moved.slice().sort(compareDrawOrder);
    }, 400);

    // Packed numeric key variant (what a hot loop can use when ties are rare)
    const keys = new Float64Array(base.length);
    const idx = new Uint32Array(base.length);
    const keyed = time(() => {
      for (let k = 0; k < base.length; k++) {
        keys[k] = sortKey(base[k]!.group, base[k]!.sortY);
        idx[k] = k;
      }
      Array.prototype.sort.call(
        idx,
        (a: number, b: number) => keys[a]! - keys[b]! || base[a]!.x - base[b]!.x || base[a]!.id - base[b]!.id,
      );
    }, 200);

    console.log(
      `sort 2000 sprites: random order ${fullSort.toFixed(3)} ms | nearly sorted (5% moved) ${incremental.toFixed(3)} ms | packed key ${keyed.toFixed(3)} ms`,
    );
    expect(fullSort).toBeLessThan(8); // generous CI bound: half a 60 fps frame
    expect(incremental).toBeLessThan(8);
  });
});
