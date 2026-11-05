/**
 * Canonical constants — "Hồ sơ tổng hợp" §3 (Thông số chuẩn hợp nhất).
 * Values here override anything in the original docs (§4 lists superseded values).
 */

// ---------------------------------------------------------------- grid / projection
export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 720;

/** Base tile, px @1x (art is drawn @2x = 128 × 64). */
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
export const TILE_HALF_WIDTH = TILE_WIDTH / 2; // 32
export const TILE_HALF_HEIGHT = TILE_HEIGHT / 2; // 16

/** Chunk = 32 × 32 tiles = 2048 × 1024 px @1x (shared by client and server). */
export const CHUNK_SIZE = 32;
export const CHUNK_PX_WIDTH = CHUNK_SIZE * TILE_WIDTH; // 2048
export const CHUNK_PX_HEIGHT = CHUNK_SIZE * TILE_HEIGHT; // 1024

/** Elevation: each level is 32 px @1x, at most 4 levels above the base. */
export const HEIGHT_LEVEL_PX = 32;
export const MAX_HEIGHT_LEVELS = 4;

/** Chunk streaming windows (Asset Matrix): always load 3×3, prefetch 5×5, evict outside 7×7 (LRU). */
export const STREAM_LOAD_RADIUS = 1; // 3 × 3
export const STREAM_PREFETCH_RADIUS = 2; // 5 × 5
export const STREAM_KEEP_RADIUS = 3; // 7 × 7

// ---------------------------------------------------------------- draw layers
export enum Layer {
  L0_GROUND = 0,
  L1_DECAL = 1,
  L2_SHADOW = 2,
  L3_YSORT = 3,
  L4_AIR = 4,
  L5_WEATHER = 5,
  L6_WORLD_UI = 6,
  L7_SCREEN_UI = 7,
}

export const LAYER_NAMES: readonly string[] = [
  'Ground',
  'Decal',
  'Shadow',
  'Y-sort',
  'Air',
  'Weather',
  'World UI',
  'Screen UI',
];

/** Only L3 is Y-sorted against the player/monsters (L4/L6 sort internally by Y). */
export const Y_SORTED_LAYER = Layer.L3_YSORT;
/** Max L3 objects on Mobile (Asset Matrix). */
export const MAX_L3_OBJECTS_MOBILE = 300;

// ---------------------------------------------------------------- directions
export type Direction = 'S' | 'SE' | 'E' | 'NE' | 'N' | 'NW' | 'W' | 'SW';

/** The 8 directions, clockwise on screen starting at S (down). */
export const DIRECTIONS: readonly Direction[] = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];

/** Directions that have drawn art for monsters/NPC/pets (5 + mirror). */
export const DRAWN_DIRECTIONS: readonly Direction[] = ['S', 'SE', 'E', 'NE', 'N'];

/** SW/W/NW reuse SE/E/NE with scaleX = −1. */
export const MIRRORED_DIRECTIONS: Readonly<Partial<Record<Direction, Direction>>> = {
  SW: 'SE',
  W: 'E',
  NW: 'NE',
};

/** Tile-space (di, dj) step for each screen direction (x=(i−j)·32, y=(i+j)·16, y down). */
export const DIRECTION_TILE_VECTORS: Readonly<Record<Direction, readonly [number, number]>> = {
  S: [1, 1],
  SE: [1, 0],
  E: [1, -1],
  NE: [0, -1],
  N: [-1, -1],
  NW: [-1, 0],
  W: [-1, 1],
  SW: [0, 1],
};

/** Light source is fixed to the NW for every asset. */
export const LIGHT_DIRECTION: Direction = 'NW';

// ---------------------------------------------------------------- quality tiers
export type QualityId = 'white' | 'green' | 'blue' | 'purple' | 'gold' | 'red';

export interface QualityTier {
  readonly id: QualityId;
  readonly index: number; // 0..5
  readonly name: string; // Vietnamese
  /** breakthrough-pill quality factor q (Công thức §2) */
  readonly pillFactor: number;
}

/** 6 tiers, White → Red (replaces the old 5-tier scale). */
export const QUALITY_TIERS: readonly QualityTier[] = [
  { id: 'white', index: 0, name: 'Trắng', pillFactor: 0.6 },
  { id: 'green', index: 1, name: 'Lục', pillFactor: 0.8 },
  { id: 'blue', index: 2, name: 'Lam', pillFactor: 1.0 },
  { id: 'purple', index: 3, name: 'Tím', pillFactor: 1.2 },
  { id: 'gold', index: 4, name: 'Vàng', pillFactor: 1.4 },
  { id: 'red', index: 5, name: 'Đỏ', pillFactor: 1.6 },
];
export const QUALITY_TIER_COUNT = QUALITY_TIERS.length;

// ---------------------------------------------------------------- network
export const NETWORK = {
  /** World Node simulation tick (Hz). */
  TICK_HZ: 20,
  TICK_MS: 50,
  /** AOI update loop (Hz) — every 2nd tick. */
  AOI_HZ: 10,
  /** Update rate by distance band (Hz): near = on screen, mid = in AOI off screen, far = >80% of radius. */
  UPDATE_HZ_NEAR: 20,
  UPDATE_HZ_MID: 10,
  UPDATE_HZ_FAR: 5,
  /** Input send rate. */
  INPUT_HZ_PC: 30,
  INPUT_HZ_MOBILE: 20,
  /** Interpolation delay (ms). Mobile/Web adapts 150 → 250. */
  INTERP_DELAY_MS_PC: 100,
  INTERP_DELAY_MS_MOBILE: 150,
  INTERP_DELAY_MS_MOBILE_MAX: 250,
  /** Max lag-compensation rewind (ms). */
  LAG_COMP_MAX_MS: 200,
  /** Max entities sent per client. */
  MAX_ENTITIES_PER_CLIENT_MOBILE: 120,
  MAX_ENTITIES_PER_CLIENT_PC: 200,
  /** Downstream bandwidth budget (KB/s). */
  BANDWIDTH_KBPS_COMBAT: 8,
  BANDWIDTH_KBPS_MARKET: 13,
  BANDWIDTH_KBPS_WAR: 25,
} as const;

/** AOI = 2×2 screens around the player, in screen-axis coords u = i − j, w = i + j. */
export const AOI = {
  HALF_U: 40,
  HALF_W: 45,
  /** Exit radius = 1.15 × enter radius (hysteresis) → 46 / 52 tiles. */
  EXIT_FACTOR: 1.15,
  EXIT_HALF_U: 46,
  EXIT_HALF_W: 52,
  /** Spatial-hash cell = (floor(u/16), floor(w/16)); 512 × 256 px on screen. */
  HASH_CELL: 16,
  /** Shift AOI centre by velocity × this many seconds while flying. */
  FLIGHT_LEAD_S: 0.5,
  /** Fraction of radius beyond which an entity is in the "far" band. */
  FAR_BAND_FRACTION: 0.8,
} as const;

// ---------------------------------------------------------------- performance budgets
export const BUDGETS = {
  /** Initial download (Web) in MB — replaces the old 30/29 MB. */
  INITIAL_DOWNLOAD_MB_WEB: 25,
  RAM_MB_WEB: 500,
  TEXTURE_RAM_MB_WEB: 220,
  DRAW_CALLS_WEB_MOBILE: 80,
  DRAW_CALLS_PC: 150,
  VFX_PARTICLES_WEB_MOBILE: 1000,
  VFX_PARTICLES_PC: 3000,
  SPINE_FULL_UPDATE_MAX: 30,
  ATLAS_MAX_WEB_MOBILE: 2048,
  ATLAS_MAX_PC: 4096,
  ATLAS_PADDING_PX: 2,
} as const;

// ---------------------------------------------------------------- characters (canvas / hitbox)
export const CANVAS_BY_FOOTPRINT = {
  '1x1': 128,
  elite: 192,
  '2x2': 256,
  '4x4': 512,
} as const;
/** Pivot = (W/2, H − 12) px @1x; matches the Spine root bone. */
export const PIVOT_BOTTOM_OFFSET_PX = 12;
export const COLLIDER_RADIUS_TILES = 0.35;
export const HURTBOX_RADIUS_TILES = 0.45;
export const PICK_BOX_PX = { width: 48, height: 100 } as const;

/**
 * Hit volumes by square footprint (docs/03 §5 "Quy đổi kích thước theo footprint"). Radii are in tiles (logic
 * space), pick box in px @1x (screen space, bottom edge at the pivot). 8 × 8 bosses have per-part volumes instead,
 * so there is no row. Elite monsters (canvas 192) are 1 × 1 logically (docs/31 F-05 default).
 */
export const HIT_VOLUMES_BY_FOOTPRINT = {
  '1x1': { colliderRadius: COLLIDER_RADIUS_TILES, hurtboxRadius: HURTBOX_RADIUS_TILES, pickBox: PICK_BOX_PX },
  '2x2': { colliderRadius: 0.8, hurtboxRadius: 0.95, pickBox: { width: 120, height: 180 } },
  '4x4': { colliderRadius: 1.7, hurtboxRadius: 1.9, pickBox: { width: 240, height: 340 } },
} as const;

// ---------------------------------------------------------------- gameplay structure
export const REALM_COUNT = 9;
export const TOTAL_STAGES = 41;
/** Luyện Khí has 9 sub-stages; every other realm has 4 (Sơ, Trung, Hậu, Viên Mãn). */
export const LUYEN_KHI_SUBSTAGES = 9;
export const DEFAULT_SUBSTAGES = 4;
