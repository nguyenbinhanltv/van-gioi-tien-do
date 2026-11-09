/**
 * Where the six Son Mon NPC standees stand: a ring in the plaza around the spawn. Engine-free (unit-tested).
 *
 * Keys are the docs/12 style `npc_<name>` ids; the sect system (D98) maps its own NPC ids onto them. Same tile conventions as
 * PropPlacement: integer (i, j) is a tile, +i runs screen right-down, +j screen left-down, screen-up is (-1, -1).
 */

/** Stable standee keys (= the file names of the owner's concepts in assets-src/concepts/npcs and the sidecar keys). */
export const NPC_STANDEE_KEYS = [
  'npc_chuong_mon', // sect head
  'npc_truong_lao_dan', // alchemy elder
  'npc_ve_binh', // gate guard
  'npc_su_huynh', // senior brother
  'npc_tho_ren', // blacksmith
  'npc_thuong_nhan', // merchant
] as const;
export type NpcStandeeKey = (typeof NPC_STANDEE_KEYS)[number];

/** Preferred tile offsets from the spawn: >= 5 tiles away, off the approach line to the gate, clear of the courtyard props. */
export const SECT_NPC_LAYOUT: Readonly<Record<NpcStandeeKey, { di: number; dj: number }>> = {
  npc_chuong_mon: { di: -9, dj: -4 },
  npc_truong_lao_dan: { di: -4, dj: -9 },
  npc_ve_binh: { di: -6, dj: -12 },
  npc_su_huynh: { di: -5, dj: 5 },
  npc_tho_ren: { di: 5, dj: -5 },
  npc_thuong_nhan: { di: 6, dj: 5 },
};

/** An NPC never stands closer than this to the spawn tile (Chebyshev): the arrival tile and its neighbours stay free. */
export const NPC_MIN_SPAWN_DISTANCE = 5;
/** Two NPCs keep at least this many tiles between their anchors (Chebyshev). */
export const NPC_MIN_SEPARATION = 2;

export interface PlacedNpc {
  key: NpcStandeeKey;
  /** the tile the NPC stands on (it blocks it) */
  i: number;
  j: number;
}

export interface NpcPlacementInput {
  width: number;
  height: number;
  spawn: { i: number; j: number };
  /** true for land (dirt / grass), false for water / outside the map */
  isLand(i: number, j: number): boolean;
  /** tiles already blocked by props, the courtyard or the gate */
  isBlocked(i: number, j: number): boolean;
}

/** The approach corridor to the gate: tiles up to 3 wide along screen-up from the spawn (PropPlacement keeps it free of props). */
export function onApproachLine(spawn: { i: number; j: number }, i: number, j: number): boolean {
  const di = i - spawn.i;
  const dj = j - spawn.j;
  return di <= -3 && dj <= -3 && Math.abs(di - dj) <= 2;
}

const NUDGE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, -1],
  [2, 0],
  [0, 2],
  [-2, 0],
  [0, -2],
  [1, -1],
  [-1, 1],
];

/**
 * Places every NPC at its preferred spot, nudged to the nearest free tile when that one is water, blocked or too close to something;
 * an NPC with no free tile within the nudge set is skipped (the map is procedural: the plaza adapts instead of forcing terrain).
 */
export function placeSectNpcs(input: NpcPlacementInput): PlacedNpc[] {
  const { spawn } = input;
  const out: PlacedNpc[] = [];
  const free = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= input.width || j >= input.height) return false;
    if (!input.isLand(i, j) || input.isBlocked(i, j)) return false;
    // land on all four sides: a coast tile only shows a rim of ground
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (!input.isLand(i + di, j + dj)) return false;
    if (Math.max(Math.abs(i - spawn.i), Math.abs(j - spawn.j)) < NPC_MIN_SPAWN_DISTANCE) return false;
    if (onApproachLine(spawn, i, j)) return false;
    return !out.some((o) => Math.max(Math.abs(o.i - i), Math.abs(o.j - j)) < NPC_MIN_SEPARATION);
  };
  for (const key of NPC_STANDEE_KEYS) {
    const at = SECT_NPC_LAYOUT[key];
    for (const [ni, nj] of NUDGE) {
      const i = spawn.i + at.di + ni;
      const j = spawn.j + at.dj + nj;
      if (free(i, j)) {
        out.push({ key, i, j });
        break;
      }
    }
  }
  return out;
}
