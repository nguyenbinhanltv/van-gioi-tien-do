import type { Layer } from '@vgtd/shared';

/** Result of a loader for one chunk. Tile arrays are row-major, index = j * CHUNK_SIZE + i (chunk-local). */
export interface ChunkData {
  ci: number;
  cj: number;
  /** Named ground tile layers (e.g. procgen: liquid, dirt, grass), -1 = empty. */
  tileLayers: Record<string, Int16Array>;
  /** Elevation level per tile (0..MAX_HEIGHT_LEVELS). */
  elevation: Uint8Array;
  /** Props / cliff faces / overhead objects whose footprint N-corner lies inside this chunk (world tile coords). */
  objects: WorldObject[];
}

/**
 * A static world object. Tile coords are WORLD tiles; (i0, j0) is the N-corner tile of the footprint,
 * the S vertex is (i0 + w, j0 + h). y is screen-down (Cocos client must flip y).
 */
export interface WorldObject {
  id: number;
  layer: Layer;
  i0: number;
  j0: number;
  w: number;
  h: number;
  /** Elevation group the object stands on (cliff faces: use cliffFaceGroup()). */
  group: number;
  /** Sprite size in px @1x, bottom-centre anchored on the footprint S vertex (lifted by `group`). */
  spriteWidth: number;
  spriteHeight: number;
  /** Explicit sortY (px @1x) overriding the footprint-bottom-vertex rule (cliff faces: pivot at the cliff foot). */
  sortY?: number;
  /** Height in tiles (for the "taller than 2 tiles" auto-fade rule). Default derived from spriteHeight / 32. */
  heightTiles?: number;
  /** L4/L5 only: trigger polygon in WORLD tile coords; fades when the local player pivot is inside. */
  zone?: Array<{ i: number; j: number }>;
  /** L4/L5 only: never triggers (drifting clouds): kept at constant alpha. */
  passive?: boolean;
  kind?: string;
}

export interface ChunkLoader {
  /** Resolve with the chunk data, or `null` when the chunk does not exist (outside the map). Must honour `signal`. */
  load(coord: { ci: number; cj: number }, signal: AbortSignal): Promise<ChunkData | null>;
}
