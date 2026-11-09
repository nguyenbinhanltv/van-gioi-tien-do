/**
 * Terrain of the slice map for the game server (D95): the walkability grid the tile generator writes next to `map.json`
 * (`tools/procgen` -> `terrain.json`, rows of `.` land and `#` water / lava only, the same rule the client uses for
 * `isTerrainWalkable`). With it the server's `TileGrid` blocks what the client blocks, so mobs spawn and walk on land, prediction
 * and the anti-cheat distance check see the same obstacles. Without it (tests, `main.ts` defaults) the map stays open.
 * Pure parsing, no I/O: the dev entry reads the file.
 */
import { TileGrid } from '@vgtd/sim';

export interface TerrainFile {
  width: number;
  height: number;
  seed: number;
  rows: string[];
}

export class TerrainFormatError extends Error {}

/** Validate a parsed `terrain.json`; throws `TerrainFormatError` with the reason. */
export function parseTerrain(json: unknown): TerrainFile {
  const o = json as Partial<TerrainFile> & { format?: unknown; version?: unknown };
  if (!o || typeof o !== 'object') throw new TerrainFormatError('terrain must be an object');
  if (o.format !== 'tutien-terrain' || o.version !== 1) throw new TerrainFormatError('not a tutien-terrain v1 file');
  const { width, height, rows } = o;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0)
    throw new TerrainFormatError('width / height must be positive integers');
  if (!Array.isArray(rows) || rows.length !== height) throw new TerrainFormatError('rows must have `height` entries');
  for (const [j, r] of rows.entries()) {
    if (typeof r !== 'string' || r.length !== width)
      throw new TerrainFormatError(`row ${j} must be a string of ${width} chars`);
    if (!/^[.#]+$/.test(r)) throw new TerrainFormatError(`row ${j} may only hold '.' and '#'`);
  }
  return { width: width!, height: height!, seed: typeof o.seed === 'number' ? o.seed : 0, rows };
}

/** The server grid of a terrain file (`.` walkable level 0, `#` blocked). */
export function terrainGrid(t: TerrainFile): TileGrid {
  return TileGrid.fromRows(t.rows);
}
