import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, chunkKey, tileToScreen } from '@vgtd/shared';
import type { ChunkCoord, Rect } from '@vgtd/shared';
import {
  ChunkPriority,
  ChunkStreamer,
  STREAM_TIERS,
  chunksInRect,
  computeWantedChunks,
  type ChunkData,
  type ChunkLoader,
} from '../src/index.js';

/** 1280×720 camera centred on tile (i, j). */
function cam(i: number, j: number, w = 1280, h = 720): Rect {
  const c = tileToScreen(i, j);
  return { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h };
}

function emptyChunk(c: ChunkCoord): ChunkData {
  return { ci: c.ci, cj: c.cj, tileLayers: {}, elevation: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE), objects: [] };
}

/** Loader whose requests resolve only when the test says so. */
class ManualLoader implements ChunkLoader {
  readonly started: string[] = [];
  readonly aborted: string[] = [];
  private readonly pending = new Map<
    string,
    { resolve: (d: ChunkData | null) => void; reject: (e: unknown) => void }
  >();

  load(c: ChunkCoord, signal: AbortSignal): Promise<ChunkData | null> {
    const k = chunkKey(c.ci, c.cj);
    this.started.push(k);
    signal.addEventListener('abort', () => this.aborted.push(k));
    return new Promise((resolve, reject) => this.pending.set(k, { resolve, reject }));
  }
  get inFlight(): string[] {
    return [...this.pending.keys()];
  }
  finish(c: ChunkCoord, data: ChunkData | null = emptyChunk(c)): void {
    const k = chunkKey(c.ci, c.cj);
    this.pending.get(k)?.resolve(data);
    this.pending.delete(k);
  }
  fail(c: ChunkCoord, err: unknown): void {
    const k = chunkKey(c.ci, c.cj);
    this.pending.get(k)?.reject(err);
    this.pending.delete(k);
  }
  finishAll(): void {
    for (const k of [...this.pending.keys()]) {
      const [ci, cj] = k.split(',').map(Number);
      this.finish({ ci: ci!, cj: cj! });
    }
  }
}

/** Resolves everything immediately. */
class InstantLoader implements ChunkLoader {
  load(c: ChunkCoord): Promise<ChunkData | null> {
    return Promise.resolve(emptyChunk(c));
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const keys = (cs: Iterable<ChunkCoord>): string[] => [...cs].map((c) => chunkKey(c.ci, c.cj)).sort();

describe('chunksInRect', () => {
  it('a 1280×720 camera sees a cross of 5 chunks at a chunk centre, 4 at a corner, up to 6 on an edge', () => {
    // (docs say "max 4"; with 2048×1024 diamonds the rect corners also touch the 4 edge neighbours)
    expect(keys(chunksInRect(cam(16, 16)))).toEqual(['-1,0', '0,-1', '0,0', '0,1', '1,0']);
    expect(keys(chunksInRect(cam(32, 32)))).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(chunksInRect(cam(32, 16))).toHaveLength(6);
    expect(chunksInRect(cam(100, 100))).toHaveLength(4);
  });

  it('is exact on the diamond: a rect inside the corner gap of the bounding box does not pull the neighbour', () => {
    // Chunk (0,0) diamond has its N vertex at (0,0) and W vertex at (-1024, 512); a small rect in the bbox corner
    // (x≈-1000, y≈10) lies outside the diamond.
    const r: Rect = { x: -1010, y: 0, width: 20, height: 20 };
    expect(chunksInRect(r).some((c) => c.ci === 0 && c.cj === 0)).toBe(false);
  });
});

describe('wanted sets per tier', () => {
  const centre = { ci: 5, cj: 5 };
  const input = { camera: cam(5 * 32 + 16, 5 * 32 + 16) };

  it('medium: 3×3 load (P≤1), 5×5 prefetch (P3), nothing beyond', () => {
    const w = computeWantedChunks(input, centre, STREAM_TIERS.medium).wanted;
    expect(w.size).toBe(25);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        expect(w.get(chunkKey(5 + di, 5 + dj))!.priority).toBeLessThanOrEqual(ChunkPriority.Ring);
      }
    }
    expect(w.get(chunkKey(7, 7))!.priority).toBe(ChunkPriority.Prefetch);
    expect(w.has(chunkKey(8, 5))).toBe(false);
    expect(w.get(chunkKey(5, 5))!.priority).toBe(ChunkPriority.Visible);
  });

  it('low: 3×3 window + ring of the visible cross, nothing from the 5×5 corners; high: whole 5×5 is P≤1', () => {
    const low = computeWantedChunks(input, centre, STREAM_TIERS.low).wanted;
    const med = computeWantedChunks(input, centre, STREAM_TIERS.medium).wanted;
    expect(low.size).toBe(21);
    for (const k of low.keys()) expect(med.has(k)).toBe(true);
    expect(low.has(chunkKey(7, 7))).toBe(false);
    expect([...low.values()].every((c) => c.priority <= ChunkPriority.Ring)).toBe(true);
    const hi = computeWantedChunks(input, centre, STREAM_TIERS.high).wanted;
    expect(hi.size).toBe(25);
    expect(hi.get(chunkKey(7, 7))!.priority).toBe(ChunkPriority.Ring);
  });

  it('velocity adds an "ahead" set with priority 2; flying (3 s) reaches further than walking (2 s)', () => {
    const v = { x: 2000, y: 0 }; // px/s, screen-right
    const walk = computeWantedChunks({ ...input, velocity: v }, centre, STREAM_TIERS.low).wanted;
    const fly = computeWantedChunks({ ...input, velocity: v, flying: true }, centre, STREAM_TIERS.low).wanted;
    expect([...walk.values()].some((c) => c.priority === ChunkPriority.Ahead)).toBe(true);
    expect(fly.size).toBeGreaterThan(walk.size);
    expect([...fly.keys()].some((k) => !walk.has(k))).toBe(true);
    // the half-way rect is included: a chunk between the camera and the 2 s position is wanted
    const mid = computeWantedChunks({ ...input, velocity: { x: 3000, y: 0 } }, centre, STREAM_TIERS.low).wanted;
    expect(mid.has(chunkKey(6, 4))).toBe(true);
  });
});

describe('ChunkStreamer', () => {
  it('requests visible chunks before ring before prefetch, max 4 parallel (2 in combat)', async () => {
    const loader = new ManualLoader();
    const s = new ChunkStreamer(loader, { tier: 'medium' });
    s.update({ camera: cam(5 * 32 + 16, 5 * 32 + 16) }, 0);
    expect(loader.started).toHaveLength(4);
    expect(loader.started[0]).toBe('5,5'); // the visible chunk first
    // Finish one → one more starts; ring (P1) chunks all start before any prefetch (P3) chunk.
    const order: string[] = [...loader.started];
    for (let n = 0; n < 40; n++) {
      const k = loader.inFlight[0];
      if (!k) break;
      const [ci, cj] = k.split(',').map(Number);
      loader.finish({ ci: ci!, cj: cj! });
      await flush();
      for (const st of loader.started) if (!order.includes(st)) order.push(st);
      expect(loader.inFlight.length).toBeLessThanOrEqual(4);
    }
    expect(order).toHaveLength(25);
    const ringKeys = new Set<string>();
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) ringKeys.add(chunkKey(5 + di, 5 + dj));
    const lastRing = Math.max(...[...ringKeys].map((k) => order.indexOf(k)));
    const firstOuter = Math.min(...order.map((k, n) => (ringKeys.has(k) ? Infinity : n)));
    expect(lastRing).toBeLessThan(firstOuter);

    const combat = new ManualLoader();
    const s2 = new ChunkStreamer(combat);
    s2.update({ camera: cam(5 * 32 + 16, 5 * 32 + 16), inCombat: true }, 0);
    expect(combat.started).toHaveLength(2);
  });

  it('pans east across many chunks: visible always resolved, nothing lingers past the 30 s hold, far-behind chunks are gone', async () => {
    const loaded = new Set<string>();
    const s = new ChunkStreamer(new InstantLoader(), {
      onLoaded: (c) => loaded.add(chunkKey(c.ci, c.cj)),
      onUnloaded: (c) => loaded.delete(chunkKey(c.ci, c.cj)),
    });
    const keep = STREAM_TIERS.medium.keepRadius;
    const outsideSince = new Map<string, number>();
    const centres = new Set<string>();
    let t = 0;
    // 400 tiles along +i at 8 tiles/s = 50 s, update every 200 ms
    for (let step = 0; step <= 250; step++) {
      const input = { camera: cam(16 + step * 1.6, 16), velocity: { x: 8 * 32, y: 8 * 16 } };
      s.update(input, t);
      await flush(); // loads resolve
      s.update(input, t);
      expect(s.visibleReady()).toBe(true);
      const c = s.centreChunk!;
      centres.add(chunkKey(c.ci, c.cj));
      for (const k of [...outsideSince.keys()]) if (!loaded.has(k)) outsideSince.delete(k);
      for (const k of loaded) {
        const [ci, cj] = k.split(',').map(Number);
        const inside = Math.max(Math.abs(ci! - c.ci), Math.abs(cj! - c.cj)) <= keep;
        if (inside) outsideSince.delete(k);
        else if (!outsideSince.has(k)) outsideSince.set(k, t);
        else expect(t - outsideSince.get(k)!).toBeLessThanOrEqual(30_000);
      }
      t += 200;
    }
    expect(centres.size).toBeGreaterThan(10);
    const c = s.centreChunk!;
    expect(loaded.has(chunkKey(0, 0))).toBe(false);
    expect(loaded.has(chunkKey(c.ci, c.cj))).toBe(true);
    expect(loaded.has(chunkKey(c.ci + 2, c.cj))).toBe(true); // prefetched ahead
    // window (7×7) plus chunks still inside their 30 s hold (the camera moves ~1.5 chunks/s along a 7-wide window)
    expect(loaded.size).toBeLessThanOrEqual(80);
  });

  it('hysteresis: jittering across a chunk border does not change the centre or the wanted set', () => {
    const s = new ChunkStreamer(new ManualLoader(), { hysteresisTiles: 4 });
    s.update({ camera: cam(31.5, 16) }, 0);
    expect(s.centreChunk).toEqual({ ci: 0, cj: 0 });
    const sets: string[] = [];
    for (let n = 0; n < 20; n++) {
      const plan = s.update({ camera: cam(n % 2 ? 32.5 : 31.5, 16) }, 200 * (n + 1));
      sets.push(keys([...plan.wanted.values()].filter((w) => w.priority >= ChunkPriority.Prefetch)).join('|'));
    }
    expect(new Set(sets).size).toBe(1);
    expect(s.centreChunk).toEqual({ ci: 0, cj: 0 });
    // moving clearly past the margin recentres
    s.update({ camera: cam(32 + 5, 16) }, 5000);
    expect(s.centreChunk).toEqual({ ci: 1, cj: 0 });
  });

  it('keeps chunks that left the window until the hold time passes, then unloads them', async () => {
    const unloaded: string[] = [];
    const s = new ChunkStreamer(new InstantLoader(), { onUnloaded: (c) => unloaded.push(chunkKey(c.ci, c.cj)) });
    s.update({ camera: cam(16, 16) }, 0);
    await flush();
    expect(s.status({ ci: 0, cj: 0 })).toBe('loaded');
    // Jump far away without teleport(): old chunks are outside the window
    s.update({ camera: cam(16 + 32 * 20, 16) }, 1000);
    expect(unloaded).toEqual([]); // < 30 s
    s.update({ camera: cam(16 + 32 * 20, 16) }, 31_100);
    expect(unloaded).toContain('0,0');
    expect(s.status({ ci: 0, cj: 0 })).toBeUndefined();
  });

  it('teleport() cancels in-flight loads and the queue; visibleReady() flips when the new area is loaded', async () => {
    const loader = new ManualLoader();
    const s = new ChunkStreamer(loader);
    s.update({ camera: cam(16, 16) }, 0);
    expect(loader.inFlight.length).toBe(4);
    s.teleport();
    expect(loader.aborted).toHaveLength(4);
    expect(s.visibleReady()).toBe(false);
    s.update({ camera: cam(16 + 320, 16 + 320) }, 100);
    expect(s.visibleReady()).toBe(false);
    for (let n = 0; n < 10 && !s.visibleReady(); n++) {
      loader.finishAll();
      await flush();
    }
    expect(s.visibleReady()).toBe(true);
    // a late result of an aborted request must not resurrect it
    loader.finish({ ci: 0, cj: 0 });
    await flush();
    expect(s.status({ ci: 0, cj: 0 })).toBeUndefined();
  });

  it('missing chunks (loader → null) count as resolved; failures retry after retryMs', async () => {
    const loader = new ManualLoader();
    const errors: string[] = [];
    const s = new ChunkStreamer(loader, { retryMs: 1000, onError: (c) => errors.push(chunkKey(c.ci, c.cj)) });
    s.update({ camera: cam(16, 16) }, 0);
    loader.finish({ ci: 0, cj: 0 }, null);
    await flush();
    expect(s.status({ ci: 0, cj: 0 })).toBe('missing');
    expect(s.visibleReady()).toBe(false); // the other visible chunks are still loading
    loader.fail({ ci: 1, cj: 0 }, new Error('net'));
    await flush();
    expect(errors).toEqual(['1,0']);
    expect(s.status({ ci: 1, cj: 0 })).toBe('failed');
    const before = loader.started.filter((k) => k === '1,0').length;
    s.update({ camera: cam(16, 16) }, 500);
    expect(loader.started.filter((k) => k === '1,0').length).toBe(before);
    s.update({ camera: cam(16, 16) }, 1500);
    // the retry waits for a free parallel slot
    for (let n = 0; n < 10 && loader.started.filter((k) => k === '1,0').length === before; n++) {
      loader.finishAll();
      await flush();
    }
    expect(loader.started.filter((k) => k === '1,0').length).toBe(before + 1);
  });
});
