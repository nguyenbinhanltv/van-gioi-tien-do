/**
 * Monster / boss descriptors (docs/03 §6): multi-tile footprints and the V sort line, part-breaking,
 * phase-by-skin, mutation variants, rig limits (§1).
 */
import {
  CANVAS_BY_FOOTPRINT,
  TILE_HEIGHT,
  TILE_WIDTH,
  bossSortY,
  footprintSortY,
  pivotSortY,
  tileToScreen,
  type Vec2,
} from '@vgtd/shared';

// ------------------------------------------------------------------ multi-tile boss
export type BossFootprintClass = '2x2' | '4x4' | '8x8';

export interface BossFootprintSpec {
  readonly footprint: BossFootprintClass;
  readonly n: 2 | 4 | 8;
  /** Footprint diamond on screen @1x. */
  readonly diamondPx: { readonly width: number; readonly height: number };
  /** Canvas @1x; null = per part. */
  readonly canvas: number | null;
  /** Directions drawn: 5 + mirror, or 1–3 for the pieced boss. */
  readonly scheme: 'five_mirror' | 'parts_1_3';
  readonly sort: 'bottom_vertex' | 'bottom_vertex_v_line' | 'per_part';
  /** Allowed render technology. */
  readonly render: readonly ('spine' | 'prerender' | 'spine_pieced')[];
  readonly examples: readonly string[];
}

const diamond = (n: number) => ({ width: n * TILE_WIDTH, height: n * TILE_HEIGHT });

export const BOSS_FOOTPRINTS: readonly BossFootprintSpec[] = [
  {
    footprint: '2x2',
    n: 2,
    diamondPx: diamond(2),
    canvas: CANVAS_BY_FOOTPRINT['2x2'],
    scheme: 'five_mirror',
    sort: 'bottom_vertex',
    render: ['spine', 'prerender'],
    examples: ['Hổ vương', 'Khôi lỗi tướng'],
  },
  {
    footprint: '4x4',
    n: 4,
    diamondPx: diamond(4),
    canvas: CANVAS_BY_FOOTPRINT['4x4'],
    scheme: 'five_mirror', // spec table says "Spine · 8 hướng"; locked decision 2026-11-05: 5 + mirror, 8 only per asymmetric animation
    sort: 'bottom_vertex_v_line',
    render: ['spine'],
    examples: ['Giao Long', 'Huyết Lang Vương'],
  },
  {
    footprint: '8x8',
    n: 8,
    diamondPx: diamond(8),
    canvas: null,
    scheme: 'parts_1_3',
    sort: 'per_part',
    render: ['spine_pieced'],
    examples: ['Thao Thiết', 'Cửu Đầu Xà'],
  },
];

export function getBossFootprint(cls: BossFootprintClass): BossFootprintSpec {
  return BOSS_FOOTPRINTS.find((b) => b.footprint === cls)!;
}

/** A square n × n footprint spanning tiles [i0, i0+n) × [j0, j0+n); (i0, j0) is its N vertex. */
export interface SquareFootprint {
  readonly i0: number;
  readonly j0: number;
  readonly n: number;
}

/** Sort key of an n × n boss = Y of the bottom (S) vertex = centre Y + n·16 (shared `footprintSortY`). */
export function bossFootprintSortY(fp: SquareFootprint): number {
  return footprintSortY(fp.i0, fp.j0, fp.n, fp.n);
}

/** Same value via the spec formula sortY = y_centre + n × 16 (centre = middle of the footprint diamond). */
export function bossSortYFromCentre(fp: SquareFootprint): number {
  const centre = tileToScreen(fp.i0 + fp.n / 2, fp.j0 + fp.n / 2);
  return bossSortY(centre.y, fp.n);
}

/** Tiles locked on the navgrid; a square footprint occupies the same cells whatever the facing. */
export function occupiedTiles(fp: SquareFootprint): { i: number; j: number }[] {
  const out: { i: number; j: number }[] = [];
  for (let i = fp.i0; i < fp.i0 + fp.n; i++) for (let j = fp.j0; j < fp.j0 + fp.n; j++) out.push({ i, j });
  return out;
}

/** The V sort line = the two front (south-facing) edges: W vertex → S vertex → E vertex, in screen px @1x. */
export function vSortLine(fp: SquareFootprint): { west: Vec2; south: Vec2; east: Vec2 } {
  return {
    west: tileToScreen(fp.i0, fp.j0 + fp.n),
    south: tileToScreen(fp.i0 + fp.n, fp.j0 + fp.n),
    east: tileToScreen(fp.i0 + fp.n, fp.j0),
  };
}

/** Screen Y of the V line at screen X, or null outside [west.x, east.x]. */
export function vSortLineY(fp: SquareFootprint, x: number): number | null {
  const { west, south, east } = vSortLine(fp);
  if (x < west.x || x > east.x) return null;
  const [a, b] = x <= south.x ? [west, south] : [south, east];
  return a.x === b.x ? Math.max(a.y, b.y) : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
}

/**
 * Is an entity at tile position (i, j) drawn IN FRONT of (after) the boss?
 *   · 4 × 4 and up: in front when below the V line (covers the corners where its Y is smaller than the boss
 *     sort key but it visually stands before the flank);
 *   · otherwise / outside the V's x-range: plain sort-key comparison (larger Y draws later).
 * Rule (docs/31 F-04 / ADR-023 default, `below_draws_after`): below the V edge = nearer the camera = drawn after
 * the boss. The alternative literal reading of docs/03 §6 is selectable with `{ vRule: 'below_draws_before' }`
 * (only the V-corner cases flip; the plain sort-key rule below the bottom vertex is unaffected).
 */
export type VSortRule = 'below_draws_after' | 'below_draws_before';
export const DEFAULT_V_SORT_RULE: VSortRule = 'below_draws_after';

export function isInFrontOfBoss(
  i: number,
  j: number,
  fp: SquareFootprint,
  options: { readonly vRule?: VSortRule } = {},
): boolean {
  const entityY = pivotSortY(i, j);
  if (entityY > bossFootprintSortY(fp)) return true;
  if (fp.n >= 4) {
    const x = tileToScreen(i, j).x;
    const vy = vSortLineY(fp, x);
    if (vy !== null) {
      // Literal reading: an entity below the V is drawn BEFORE the boss, so it is never "in front".
      return (options.vRule ?? DEFAULT_V_SORT_RULE) === 'below_draws_after' ? entityY > vy : false;
    }
  }
  return false;
}

// ------------------------------------------------------------------ pieced 8 × 8 boss parts
export type BossPartRole = 'body' | 'head' | 'tail' | 'limb';

export interface BossPartSpec {
  readonly id: string;
  readonly role: BossPartRole;
  /** Own skeleton file/key (body + each head/tail are separate skeletons). */
  readonly skeleton: string;
  /** Body bone the part is positioned on by code (null for the body itself). */
  readonly anchorBone: string | null;
  /** Logic-space circles in tiles: each part has its own collider and hurtbox. */
  readonly colliderRadius: number;
  readonly hurtboxRadius: number;
}

// ------------------------------------------------------------------ part-breaking
export type PartState = 'intact' | 'cracked' | 'broken';

/** Cracked at ≤ 50 % part HP; intact above it. */
export const PART_CRACK_THRESHOLD = 0.5;
/** Debris is a Sprite Sheet of 8–12 frames flying on a curve. */
export const PART_DEBRIS_FRAMES = { min: 8, max: 12 } as const;
/** Pre-render monsters may lose at most one part (base sheet without the part + overlay sheet). */
export const PRERENDER_MAX_BREAKABLE_PARTS = 1;
/** Every Spine break slot carries exactly these three attachments. */
export const PART_ATTACHMENT_COUNT = 3;

export interface PartBreakSpec {
  /** Spine slot name; the intact attachment shares it. */
  readonly slot: string;
  /** Part HP pool (separate from boss HP). */
  readonly maxHp: number;
  /** Skills tied to this part: weakened when cracked, locked when broken. */
  readonly skills: readonly string[];
  /** Rare material ids dropped on break. */
  readonly drops: readonly string[];
}

export interface PartAttachmentNames {
  readonly intact: string;
  readonly cracked: string;
  readonly stump: string;
}

export function partAttachmentNames(slot: string): PartAttachmentNames {
  return { intact: slot, cracked: `${slot}_cracked`, stump: `${slot}_stump` };
}

export function partStateFromHp(hp: number, maxHp: number): PartState {
  if (hp <= 0) return 'broken';
  return hp / maxHp <= PART_CRACK_THRESHOLD ? 'cracked' : 'intact';
}

export interface PartStateEffects {
  readonly attachment: keyof PartAttachmentNames;
  /** Cracked: sparks + small smoke. */
  readonly sparksAndSmoke: boolean;
  readonly skillsWeakened: boolean;
  readonly skillsLocked: boolean;
  readonly spawnDebris: boolean;
  readonly dropRareMaterial: boolean;
}

export function partStateEffects(state: PartState): PartStateEffects {
  switch (state) {
    case 'intact':
      return {
        attachment: 'intact',
        sparksAndSmoke: false,
        skillsWeakened: false,
        skillsLocked: false,
        spawnDebris: false,
        dropRareMaterial: false,
      };
    case 'cracked':
      return {
        attachment: 'cracked',
        sparksAndSmoke: true,
        skillsWeakened: true,
        skillsLocked: false,
        spawnDebris: false,
        dropRareMaterial: false,
      };
    case 'broken':
      return {
        attachment: 'stump',
        sparksAndSmoke: false,
        skillsWeakened: false,
        skillsLocked: true,
        spawnDebris: true,
        dropRareMaterial: true,
      };
  }
}

// ------------------------------------------------------------------ phase by skin
export const TRANSFORM_START_S = 0.8;
export const TRANSFORM_END_S = 1.0;
/** The swap is hidden by a flash / ink splash for 2–3 frames. */
export const TRANSFORM_COVER_FRAMES = { min: 2, max: 3 } as const;

export interface PhaseSpec {
  readonly id: string;
  /** Boss HP fraction at (or below) which this phase starts, e.g. 0.6 and 0.25. */
  readonly hpThreshold: number;
  /** Spine skin applied at the swap. */
  readonly skin: string;
  /** Atlas page for the phase (preloaded when the fight starts). */
  readonly atlas: string;
  /** Tint-shader palette id. */
  readonly tint?: string;
  /** Arena decal / tilemap layer swapped during transform_end. */
  readonly arenaDecal?: string;
}

/** Phase index active at `hpFraction` (0 = base). Boss is immune during the transformation chain. */
export function phaseIndexForHp(phases: readonly PhaseSpec[], hpFraction: number): number {
  let idx = 0;
  const sorted = [...phases].sort((a, b) => b.hpThreshold - a.hpThreshold);
  for (const p of sorted) if (hpFraction <= p.hpThreshold) idx++;
  return idx;
}

/** Atlases of the phases listed (all phases after the base one), to preload at the start of the fight (not at the threshold). */
export function phasePreloadAtlases(phases: readonly PhaseSpec[]): string[] {
  return [...new Set(phases.map((p) => p.atlas))];
}

/** Total scripted transform time: start (0,8 s) + end (1,0 s). */
export function transformDuration(): number {
  return TRANSFORM_START_S + TRANSFORM_END_S;
}

// ------------------------------------------------------------------ mutation variants
export type MutationVariantId = 'huyet_sac' | 'ma_hoa' | 'loi_hoa';
export const MUTATION_VARIANT_IDS: readonly MutationVariantId[] = ['huyet_sac', 'ma_hoa', 'loi_hoa'];
export const MUTATION_SCALE_RANGE = { min: 1.1, max: 1.3 } as const;

export interface MutationVariantSpec {
  readonly id: MutationVariantId;
  readonly tint: string;
  /** Extra spike / horn attachments added on the original skeleton. */
  readonly extraAttachments: readonly string[];
  readonly scale: number;
}

// ------------------------------------------------------------------ rig limits (§1)
export type RigKind = 'player' | 'pet' | 'boss';

export interface RigLimits {
  readonly bones: number;
  readonly slots: number;
  readonly meshVertices: number;
  readonly physicsConstraints: number;
}

export const RIG_LIMITS: Readonly<Record<RigKind, RigLimits>> = {
  player: { bones: 60, slots: 40, meshVertices: 600, physicsConstraints: 6 },
  pet: { bones: 50, slots: 25, meshVertices: 400, physicsConstraints: 4 },
  boss: { bones: 120, slots: 60, meshVertices: 1500, physicsConstraints: 8 },
};

/** Full-update skeleton cap on Mobile/Web: 30 total (shared `BUDGETS.SPINE_FULL_UPDATE_MAX`), of which 1–2 bosses. */
export const BOSS_FULL_UPDATE_MAX = 2;
