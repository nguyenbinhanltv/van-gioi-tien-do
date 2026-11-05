import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_SIZE, tileToScreen } from '@vgtd/shared';
import {
  ChunkStreamer,
  ProcgenChunkLoader,
  ProcgenFormatError,
  loadProcgenWorld,
  parseProcgenMap,
  parseTileset,
  sliceChunk,
} from '../src/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const generator = resolve(here, '../../../tools/procgen/src/tilemap/generate_tilemap.js');

let outDir = '';
let tilesetRaw: unknown;
let mapRaw: Record<string, unknown>;

beforeAll(() => {
  // Run the real @vgtd/procgen generator so the loader is tested against what it actually emits.
  outDir = mkdtempSync(join(tmpdir(), 'vgtd-procgen-'));
  execFileSync(process.execPath, [generator, '--out', outDir, '--seed', '4242'], { stdio: 'pipe' });
  tilesetRaw = JSON.parse(readFileSync(join(outDir, 'tileset.json'), 'utf8'));
  mapRaw = JSON.parse(readFileSync(join(outDir, 'map.json'), 'utf8')) as Record<string, unknown>;
}, 60_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('real procgen output', () => {
  it('parses tileset.json + map.json (32×32, @2x tiles, liquid → dirt → grass layers)', () => {
    const w = parseProcgenMap(tilesetRaw, mapRaw);
    expect(w.width).toBe(32);
    expect(w.height).toBe(32);
    expect(w.seed).toBe(4242);
    expect(w.pixelScale).toBe(2); // 128 × 64 tiles
    expect(w.layers.map((l) => l.name)).toEqual(['liquid', 'dirt', 'grass']);
    expect(w.tileset.tiles.length).toBe(40);
    expect(w.elevation.every((e) => e === 0)).toBe(true); // procgen has no elevation yet
    expect(w.objects).toEqual([]);
  });

  it('a 32×32 map is exactly chunk (0,0); neighbours do not exist', () => {
    const w = parseProcgenMap(tilesetRaw, mapRaw);
    const c = sliceChunk(w, { ci: 0, cj: 0 })!;
    expect(c).not.toBeNull();
    for (const l of w.layers) expect(Array.from(c.tileLayers[l.name]!)).toEqual(Array.from(l.data));
    expect(sliceChunk(w, { ci: 1, cj: 0 })).toBeNull();
    expect(sliceChunk(w, { ci: 0, cj: 1 })).toBeNull();
    expect(sliceChunk(w, { ci: -1, cj: 0 })).toBeNull();
  });

  it('loadProcgenWorld reads through a readText callback and follows map.tileset', async () => {
    const asked: string[] = [];
    const w = await loadProcgenWorld((name) => {
      asked.push(name);
      return Promise.resolve(readFileSync(join(outDir, name), 'utf8'));
    });
    expect(asked).toEqual(['map.json', 'tileset.json']);
    expect(w.width).toBe(32);
  });

  it('streams through ChunkStreamer: chunk (0,0) loaded, outside chunks resolve as missing', async () => {
    const w = parseProcgenMap(tilesetRaw, mapRaw);
    const s = new ChunkStreamer(new ProcgenChunkLoader(w));
    const c = tileToScreen(16, 16);
    s.update({ camera: { x: c.x - 640, y: c.y - 360, width: 1280, height: 720 } }, 0);
    await new Promise((r) => setTimeout(r, 0));
    s.update({ camera: { x: c.x - 640, y: c.y - 360, width: 1280, height: 720 } }, 200);
    expect(s.status({ ci: 0, cj: 0 })).toBe('loaded');
    expect(s.status({ ci: 1, cj: 0 })).toBe('missing');
    expect(s.visibleReady()).toBe(true);
    expect(s.get({ ci: 0, cj: 0 })!.tileLayers.grass).toBeInstanceOf(Int16Array);
  });
});

describe('format validation & chunk slicing', () => {
  const tileset = (): Record<string, unknown> => JSON.parse(JSON.stringify(tilesetRaw)) as Record<string, unknown>;
  const smallMap = (w: number, h: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    format: 'tutien-isomap',
    version: 1,
    width: w,
    height: h,
    seed: 1,
    tileset: 'tileset.json',
    layers: [{ name: 'dirt', data: Array.from({ length: w * h }, (_, k) => (k % 7 === 0 ? -1 : 4)) }],
    ...extra,
  });

  it('rejects wrong format, version, tile ratio, unknown tile ids and wrong data length', () => {
    expect(() => parseProcgenMap(tilesetRaw, { ...smallMap(2, 2), format: 'x' })).toThrow(ProcgenFormatError);
    expect(() => parseProcgenMap(tilesetRaw, { ...smallMap(2, 2), version: 2 })).toThrow(/version/);
    expect(() => parseTileset({ ...tileset(), tileHeight: 40 })).toThrow(/2:1/);
    expect(() => parseTileset({ ...tileset(), format: 'nope' })).toThrow(ProcgenFormatError);
    const badId = smallMap(2, 2);
    (badId.layers as Array<{ data: number[] }>)[0]!.data[1] = 999;
    expect(() => parseProcgenMap(tilesetRaw, badId)).toThrow(/unknown tile id 999/);
    const badLen = smallMap(2, 2);
    (badLen.layers as Array<{ data: number[] }>)[0]!.data.pop();
    expect(() => parseProcgenMap(tilesetRaw, badLen)).toThrow(/data must have 4 entries/);
    expect(() => parseProcgenMap(tilesetRaw, null)).toThrow(ProcgenFormatError);
  });

  it('slices a 70×40 map into 3×2 chunks with -1 padding and routes objects/elevation by N-corner', () => {
    const W = 70;
    const H = 40;
    const m = smallMap(W, H, {
      objects: [
        { id: 1, i: 5, j: 5, w: 1, h: 1, spriteWidth: 64, spriteHeight: 128 },
        { id: 2, i: 40, j: 35, w: 2, h: 2, group: 1, spriteWidth: 128, spriteHeight: 128 },
        { id: 3, i: 31, j: 31, w: 4, h: 4, spriteWidth: 256, spriteHeight: 192 }, // straddles 4 chunks: belongs to (0,0)
        {
          id: 4,
          i: 20,
          j: 20,
          layer: 4,
          zone: [
            { i: 19, j: 19 },
            { i: 24, j: 19 },
            { i: 24, j: 24 },
          ],
          spriteWidth: 192,
          spriteHeight: 128,
        },
      ],
    });
    (m.layers as unknown[]).push({
      name: 'elevation',
      data: Array.from({ length: W * H }, (_, k) => (k % W >= 64 ? 2 : 0)),
    });
    const w = parseProcgenMap(tilesetRaw, m);
    expect(w.layers.map((l) => l.name)).toEqual(['dirt']); // elevation is not a tile layer
    const c00 = sliceChunk(w, { ci: 0, cj: 0 })!;
    expect(c00.objects.map((o) => o.id).sort()).toEqual([1, 3, 4]);
    expect(c00.objects.find((o) => o.id === 4)!.layer).toBe(4);
    const c21 = sliceChunk(w, { ci: 2, cj: 1 })!; // i 64..69, j 32..39 only partially inside the map
    expect(c21.elevation[0]).toBe(2);
    expect(c21.tileLayers.dirt![CHUNK_SIZE - 1]).toBe(-1); // i = 95 → outside the map
    expect(c21.tileLayers.dirt![8 * CHUNK_SIZE]).toBe(-1); // j = 40 → outside
    expect(c21.objects).toEqual([]);
    const c11 = sliceChunk(w, { ci: 1, cj: 1 })!;
    expect(c11.objects.map((o) => o.id)).toEqual([2]);
    expect(c11.objects[0]!.group).toBe(1);
    expect(sliceChunk(w, { ci: 3, cj: 0 })).toBeNull();
    expect(sliceChunk(w, { ci: 0, cj: 2 })).toBeNull();
    // every tile of the original layer appears exactly once across chunks
    let count = 0;
    for (let cj = 0; cj < 2; cj++) {
      for (let ci = 0; ci < 3; ci++)
        count += Array.from(sliceChunk(w, { ci, cj })!.tileLayers.dirt!).filter((v) => v !== -1).length;
    }
    expect(count).toBe(w.layers[0]!.data.filter((v) => v !== -1).length);
  });

  it('rejects objects outside the map / bad groups / duplicate ids', () => {
    const base = smallMap(8, 8);
    expect(() => parseProcgenMap(tilesetRaw, { ...base, objects: [{ id: 1, i: 7, j: 7, w: 2, h: 2 }] })).toThrow(
      /outside/,
    );
    expect(() => parseProcgenMap(tilesetRaw, { ...base, objects: [{ id: 1, i: 1, j: 1, group: 9 }] })).toThrow(/group/);
    expect(() =>
      parseProcgenMap(tilesetRaw, {
        ...base,
        objects: [
          { id: 1, i: 1, j: 1 },
          { id: 1, i: 3, j: 3 },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});
