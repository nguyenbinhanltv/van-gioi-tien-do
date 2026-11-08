/**
 * Reads the files written by @vgtd/procgen (tools/procgen/src/tilemap/generate_tilemap.js):
 *   tileset.json  { format: 'tutien-tileset', version: 1, tileWidth, tileHeight, tiles: [{ id, name, x, y, w, h }] }
 *   map.json      { format: 'tutien-isomap',  version: 1, width, height, tileset, layers: [{ name, data }] }
 * into the chunk model. Layer data is row-major (index = j * width + i, -1 = empty).
 *
 * procgen currently emits only ground layers (liquid / dirt / grass). Optional forward-compatible extras, read when
 * present: a layer named `elevation` (levels 0..4) and a top-level `objects` array (see `RawObject`).
 * Pixel sizes in the files are @2x (128 × 64) or @1x (64 × 32); world logic always uses shared's 64 × 32 grid,
 * `pixelScale` only tells the renderer which texture density it got.
 */
import { CHUNK_SIZE, Layer, MAX_HEIGHT_LEVELS, TILE_HEIGHT, TILE_WIDTH } from '@vgtd/shared';
import type { ChunkCoord } from '@vgtd/shared';
import type { ChunkData, ChunkLoader, WorldObject } from './types.js';

export interface TilesetTile {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TilesetInfo {
  image: string;
  imageWidth: number;
  imageHeight: number;
  tileWidth: number;
  tileHeight: number;
  padding: number;
  tiles: TilesetTile[];
  byId: Map<number, TilesetTile>;
}

export interface ProcgenWorld {
  seed: number;
  width: number;
  height: number;
  /** tileset px / 64 × 32 grid: 1 for @1x, 2 for @2x. */
  pixelScale: number;
  tileset: TilesetInfo;
  /** Ground layers by name in draw order (procgen: liquid → dirt → grass), each width × height. */
  layers: Array<{ name: string; data: Int16Array }>;
  elevation: Uint8Array;
  objects: WorldObject[];
}

/** Optional `objects[]` entry in map.json (forward-compatible; procgen does not emit it yet). */
export interface RawObject {
  /** Non-negative integer, at most MAX_OBJECT_ID (ids are multiplied by SLICE_ID_STRIDE). */
  id: number;
  /** Layer number 0..7 (default 3 = L3 Y-sort). */
  layer?: number;
  /** N-corner tile of the footprint (D67: i0/j0/w/h), integers. */
  i0: number;
  j0: number;
  w?: number;
  h?: number;
  group?: number;
  spriteWidth?: number;
  spriteHeight?: number;
  heightTiles?: number;
  zone?: Array<{ i: number; j: number }>;
  passive?: boolean;
  kind?: string;
}

export class ProcgenFormatError extends Error {}

type Obj = Record<string, unknown>;

function fail(msg: string): never {
  throw new ProcgenFormatError(msg);
}
function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(o: Obj, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${where}.${k} must be a number`);
  return v;
}
function posInt(o: Obj, k: string, where: string): number {
  const v = num(o, k, where);
  if (!Number.isInteger(v) || v <= 0) fail(`${where}.${k} must be a positive integer`);
  return v;
}

export function parseTileset(raw: unknown): TilesetInfo {
  if (!isObj(raw)) fail('tileset.json must be an object');
  if (raw.format !== 'tutien-tileset') fail(`tileset.json: unexpected format ${String(raw.format)}`);
  if (raw.version !== 1) fail(`tileset.json: unsupported version ${String(raw.version)}`);
  const tileWidth = posInt(raw, 'tileWidth', 'tileset');
  const tileHeight = posInt(raw, 'tileHeight', 'tileset');
  if (tileWidth !== tileHeight * 2) fail(`tileset: tile ${tileWidth}×${tileHeight} is not 2:1`);
  if (!Array.isArray(raw.tiles)) fail('tileset.tiles must be an array');
  const tiles: TilesetTile[] = raw.tiles.map((t: unknown, n: number) => {
    if (!isObj(t)) fail(`tileset.tiles[${n}] must be an object`);
    const name = t.name;
    if (typeof name !== 'string') fail(`tileset.tiles[${n}].name must be a string`);
    return {
      id: num(t, 'id', `tiles[${n}]`),
      name,
      x: num(t, 'x', `tiles[${n}]`),
      y: num(t, 'y', `tiles[${n}]`),
      w: num(t, 'w', `tiles[${n}]`),
      h: num(t, 'h', `tiles[${n}]`),
    };
  });
  const byId = new Map<number, TilesetTile>();
  for (const t of tiles) {
    if (byId.has(t.id)) fail(`tileset: duplicate tile id ${t.id}`);
    byId.set(t.id, t);
  }
  return {
    image: typeof raw.image === 'string' ? raw.image : '',
    imageWidth: num(raw, 'imageWidth', 'tileset'),
    imageHeight: num(raw, 'imageHeight', 'tileset'),
    tileWidth,
    tileHeight,
    padding: typeof raw.padding === 'number' ? raw.padding : 0,
    tiles,
    byId,
  };
}

/** Largest object id: `id * SLICE_ID_STRIDE (64)` must stay a safe integer. */
export const MAX_OBJECT_ID = Math.floor(Number.MAX_SAFE_INTEGER / 64);

function int(o: Record<string, unknown>, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${where}.${key} must be an integer`);
  return v;
}

function objectId(o: Record<string, unknown>, where: string): number {
  const v = int(o, 'id', where);
  if (v < 0 || v > MAX_OBJECT_ID) fail(`${where}.id must be in 0..${MAX_OBJECT_ID}`);
  return v;
}

function parseObject(o: unknown, n: number, width: number, height: number): WorldObject {
  if (!isObj(o)) fail(`objects[${n}] must be an object`);
  const where = `objects[${n}]`;
  const layer = o.layer === undefined ? Layer.L3_YSORT : num(o, 'layer', where);
  if (!Number.isInteger(layer) || layer < 0 || layer > Layer.L7_SCREEN_UI) fail(`${where}.layer out of range`);
  const w = o.w === undefined ? 1 : posInt(o, 'w', where);
  const h = o.h === undefined ? 1 : posInt(o, 'h', where);
  const i0 = int(o, 'i0', where);
  const j0 = int(o, 'j0', where);
  if (i0 < 0 || j0 < 0 || i0 + w > width || j0 + h > height)
    fail(`${where} footprint outside the ${width}×${height} map`);
  const group = o.group === undefined ? 0 : num(o, 'group', where);
  if (!Number.isInteger(group) || group < 0 || group > MAX_HEIGHT_LEVELS) fail(`${where}.group out of range`);
  const spriteWidth = o.spriteWidth === undefined ? w * TILE_WIDTH : num(o, 'spriteWidth', where);
  const spriteHeight = o.spriteHeight === undefined ? TILE_HEIGHT * 2 : num(o, 'spriteHeight', where);
  const out: WorldObject = {
    id: objectId(o, where),
    layer: layer as Layer,
    i0,
    j0,
    w,
    h,
    group,
    spriteWidth,
    spriteHeight,
  };
  if (typeof o.heightTiles === 'number') out.heightTiles = o.heightTiles;
  if (Array.isArray(o.zone)) {
    out.zone = o.zone.map((p: unknown, k: number) => {
      if (!isObj(p)) fail(`${where}.zone[${k}] must be an object`);
      return { i: num(p, 'i', `${where}.zone[${k}]`), j: num(p, 'j', `${where}.zone[${k}]`) };
    });
  }
  if (o.passive === true) out.passive = true;
  if (typeof o.kind === 'string') out.kind = o.kind;
  return out;
}

export function parseProcgenMap(tilesetJson: unknown, mapJson: unknown): ProcgenWorld {
  const tileset = parseTileset(tilesetJson);
  if (!isObj(mapJson)) fail('map.json must be an object');
  if (mapJson.format !== 'tutien-isomap') fail(`map.json: unexpected format ${String(mapJson.format)}`);
  if (mapJson.version !== 1) fail(`map.json: unsupported version ${String(mapJson.version)}`);
  const width = posInt(mapJson, 'width', 'map');
  const height = posInt(mapJson, 'height', 'map');
  if (!Array.isArray(mapJson.layers)) fail('map.layers must be an array');

  const layers: Array<{ name: string; data: Int16Array }> = [];
  let elevation = new Uint8Array(width * height);
  mapJson.layers.forEach((l: unknown, n: number) => {
    if (!isObj(l)) fail(`layers[${n}] must be an object`);
    if (typeof l.name !== 'string') fail(`layers[${n}].name must be a string`);
    if (!Array.isArray(l.data) || l.data.length !== width * height)
      fail(`layers[${n}] (${l.name}) data must have ${width * height} entries`);
    if (l.name === 'elevation') {
      elevation = Uint8Array.from(l.data as number[], (v) => {
        if (!Number.isInteger(v) || v < 0 || v > MAX_HEIGHT_LEVELS) fail(`elevation value ${String(v)} out of range`);
        return v;
      });
      return;
    }
    // validate the RAW entries: Int16Array.from would silently coerce null / NaN / 1.7 / 65536 to valid-looking ids
    const raw = l.data as unknown[];
    for (let k = 0; k < raw.length; k++) {
      const id = raw[k];
      if (typeof id !== 'number' || !Number.isInteger(id))
        fail(`layers[${n}] (${l.name}) entry ${k} must be an integer`);
      if (id !== -1 && !tileset.byId.has(id)) fail(`layers[${n}] (${l.name}) refers to unknown tile id ${id}`);
    }
    const data = Int16Array.from(raw as number[]);
    layers.push({ name: l.name, data });
  });

  const rawObjects = mapJson.objects;
  const objects = Array.isArray(rawObjects)
    ? rawObjects.map((o: unknown, n: number) => parseObject(o, n, width, height))
    : [];
  const ids = new Set<number>();
  for (const o of objects) {
    if (ids.has(o.id)) fail(`duplicate object id ${o.id}`);
    ids.add(o.id);
  }
  return {
    seed: typeof mapJson.seed === 'number' ? mapJson.seed : 0,
    width,
    height,
    pixelScale: tileset.tileWidth / TILE_WIDTH,
    tileset,
    layers,
    elevation,
    objects,
  };
}

/** Fetch + parse. `readText(name)` resolves a file next to map.json (HTTP fetch, fs, Cocos resources...). */
export async function loadProcgenWorld(
  readText: (name: string) => Promise<string>,
  mapName = 'map.json',
): Promise<ProcgenWorld> {
  const mapRaw: unknown = JSON.parse(await readText(mapName));
  const tilesetName = isObj(mapRaw) && typeof mapRaw.tileset === 'string' ? mapRaw.tileset : 'tileset.json';
  const tilesetRaw: unknown = JSON.parse(await readText(tilesetName));
  return parseProcgenMap(tilesetRaw, mapRaw);
}

/** Slice one chunk out of the whole world. Returns null when the chunk lies entirely outside the map. */
export function sliceChunk(world: ProcgenWorld, c: ChunkCoord): ChunkData | null {
  const i0 = c.ci * CHUNK_SIZE;
  const j0 = c.cj * CHUNK_SIZE;
  if (i0 >= world.width || j0 >= world.height || c.ci < 0 || c.cj < 0) return null;
  const n = CHUNK_SIZE * CHUNK_SIZE;
  const tileLayers: Record<string, Int16Array> = {};
  for (const l of world.layers) {
    const out = new Int16Array(n).fill(-1);
    for (let lj = 0; lj < CHUNK_SIZE; lj++) {
      const j = j0 + lj;
      if (j >= world.height) break;
      for (let li = 0; li < CHUNK_SIZE; li++) {
        const i = i0 + li;
        if (i >= world.width) break;
        out[lj * CHUNK_SIZE + li] = l.data[j * world.width + i]!;
      }
    }
    tileLayers[l.name] = out;
  }
  const elevation = new Uint8Array(n);
  for (let lj = 0; lj < CHUNK_SIZE && j0 + lj < world.height; lj++) {
    for (let li = 0; li < CHUNK_SIZE && i0 + li < world.width; li++) {
      elevation[lj * CHUNK_SIZE + li] = world.elevation[(j0 + lj) * world.width + i0 + li]!;
    }
  }
  // An object belongs to the chunk containing its N-corner tile.
  const objects = world.objects.filter(
    (o) => Math.floor(o.i0 / CHUNK_SIZE) === c.ci && Math.floor(o.j0 / CHUNK_SIZE) === c.cj,
  );
  return { ci: c.ci, cj: c.cj, tileLayers, elevation, objects };
}

/** ChunkLoader over an in-memory ProcgenWorld (the whole map is loaded once, chunks are cut on demand). */
export class ProcgenChunkLoader implements ChunkLoader {
  constructor(readonly world: ProcgenWorld) {}

  load(coord: ChunkCoord, signal: AbortSignal): Promise<ChunkData | null> {
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    return Promise.resolve(sliceChunk(this.world, coord));
  }
}
