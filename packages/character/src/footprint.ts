/**
 * Canvas size by footprint, pivot, sockets, overhead UI anchors and hit volumes (docs/03 §3–5).
 * Pivot-space coordinates (sockets, UI anchors) are px @1x with the origin at the pivot and **y UP** (as printed in
 * the spec: hand_R = (−18, 52) is 52 px above the feet). Canvas coordinates use the engine convention: origin at
 * the top-left, y down. Use `pivotToCanvas` to convert.
 */
import {
  CANVAS_BY_FOOTPRINT,
  COLLIDER_RADIUS_TILES,
  HURTBOX_RADIUS_TILES,
  PICK_BOX_PX,
  PIVOT_BOTTOM_OFFSET_PX,
  type Rect,
  type Vec2,
} from '@vgtd/shared';
import { mirrorX, type FootprintClass } from './direction.js';

export type { FootprintClass } from './direction.js';
export const FOOTPRINT_CLASSES: readonly FootprintClass[] = ['1x1', 'elite', '2x2', '4x4', '8x8'];

/** Logical side length in tiles. Elite monsters / mounts are 1 × 1 logically (only the canvas is bigger). */
export type FootprintSize = 1 | 2 | 4 | 8;
export function footprintSize(cls: FootprintClass): FootprintSize {
  switch (cls) {
    case '1x1':
    case 'elite':
      return 1;
    case '2x2':
      return 2;
    case '4x4':
      return 4;
    case '8x8':
      return 8;
  }
}

// ------------------------------------------------------------------ canvas
export interface CanvasSpec {
  readonly footprint: FootprintClass;
  /** Canvas side @1x in px; null = no single canvas (8 × 8 is pieced per part). */
  readonly size1x: number | null;
  readonly size2x: number | null;
  readonly usedFor: string;
  /** Figure height range in px (max null = open-ended). */
  readonly figureHeightPx: { readonly min: number; readonly max: number | null };
  /** Frames per 2048 atlas @1x; null where Sprite Sheets are not used. */
  readonly cellsPerAtlas2048: number | null;
  /** Spine / pieced art only (no Sprite Sheet). */
  readonly spineOnly: boolean;
}

const ATLAS_2048 = 2048;
const cells = (size: number) => Math.floor(ATLAS_2048 / size) ** 2;

export const CANVAS_TABLE: readonly CanvasSpec[] = [
  {
    footprint: '1x1',
    size1x: CANVAS_BY_FOOTPRINT['1x1'],
    size2x: CANVAS_BY_FOOTPRINT['1x1'] * 2,
    usedFor: 'Player, NPC, quái cỡ người (footprint 1 × 1)',
    figureHeightPx: { min: 96, max: 110 },
    cellsPerAtlas2048: cells(CANVAS_BY_FOOTPRINT['1x1']),
    spineOnly: false,
  },
  {
    footprint: 'elite',
    size1x: CANVAS_BY_FOOTPRINT.elite,
    size2x: CANVAS_BY_FOOTPRINT.elite * 2,
    usedFor: 'Quái tinh anh, thú cưỡi',
    figureHeightPx: { min: 140, max: 140 },
    cellsPerAtlas2048: cells(CANVAS_BY_FOOTPRINT.elite),
    spineOnly: false,
  },
  {
    footprint: '2x2',
    size1x: CANVAS_BY_FOOTPRINT['2x2'],
    size2x: CANVAS_BY_FOOTPRINT['2x2'] * 2,
    usedFor: 'Linh thú lớn, quái footprint 2 × 2',
    figureHeightPx: { min: 180, max: 180 },
    cellsPerAtlas2048: cells(CANVAS_BY_FOOTPRINT['2x2']),
    spineOnly: false,
  },
  {
    footprint: '4x4',
    size1x: CANVAS_BY_FOOTPRINT['4x4'],
    size2x: CANVAS_BY_FOOTPRINT['4x4'] * 2,
    usedFor: 'Boss footprint 4 × 4, Pháp Tướng',
    figureHeightPx: { min: 360, max: 360 },
    cellsPerAtlas2048: cells(CANVAS_BY_FOOTPRINT['4x4']),
    spineOnly: true, // @2x only 4 cells per 2048 atlas → 4 × 4 and up must be Spine
  },
  {
    footprint: '8x8',
    size1x: null,
    size2x: null,
    usedFor: 'Boss footprint 8 × 8 (Spine nhiều skeleton ghép mảnh)',
    figureHeightPx: { min: 500, max: null },
    cellsPerAtlas2048: null,
    spineOnly: true,
  },
];

export function getCanvasSpec(cls: FootprintClass): CanvasSpec {
  return CANVAS_TABLE.find((c) => c.footprint === cls)!;
}

/** Canvas side @1x for a footprint class (null for the pieced 8 × 8 boss). */
export function canvasSizeFor(cls: FootprintClass, scale: 1 | 2 = 1): number | null {
  const c = getCanvasSpec(cls);
  return scale === 1 ? c.size1x : c.size2x;
}

/** Pivot = (W/2, H − 12) from the top-left corner of the @1x canvas; equals the Spine root bone. */
export function pivotOf(width: number, height: number = width): Vec2 {
  return { x: width / 2, y: height - PIVOT_BOTTOM_OFFSET_PX };
}

/** Pivot-space point (origin at pivot, y up) → canvas px (origin top-left, y down), optionally mirrored. */
export function pivotToCanvas(p: Vec2, width: number, height: number = width, mirrored = false): Vec2 {
  const pivot = pivotOf(width, height);
  return { x: pivot.x + mirrorX(p.x, mirrored), y: pivot.y - p.y };
}

// ------------------------------------------------------------------ sockets (1 × 1, canvas 128 @1x, pose S)
export type SocketId =
  | 'origin'
  | 'hand_R'
  | 'hand_L'
  | 'back'
  | 'chest'
  | 'head_fx'
  | 'head_top'
  | 'orbit_center'
  | 'mount_seat'
  | 'fly_feet';

export interface SocketSpec {
  readonly id: SocketId;
  /** Bone name, or null for fixed points not attached to any bone. */
  readonly bone: string | null;
  /** Rest position in pivot space (y up); null = per-species (mount_seat). */
  readonly pos: Vec2 | null;
  readonly tiltDeg?: number;
  readonly usedFor: string;
  /** Follows the animation (bone-attached); mount_seat follows the mount's animation. */
  readonly followsAnimation: boolean | 'mount' | 'code';
}

export const SOCKETS: readonly SocketSpec[] = [
  {
    id: 'origin',
    bone: 'root',
    pos: { x: 0, y: 0 },
    usedFor: 'Y-sort, collision, shadow, target ring',
    followsAnimation: false,
  },
  {
    id: 'hand_R',
    bone: 'hand_R',
    pos: { x: -18, y: 52 },
    usedFor: 'Vũ khí chính, phi kiếm, pháp bảo cầm tay',
    followsAnimation: true,
  },
  { id: 'hand_L', bone: 'hand_L', pos: { x: 18, y: 52 }, usedFor: 'Pháp ấn, phù lục, khiên', followsAnimation: true },
  {
    id: 'back',
    bone: 'spine_upper',
    pos: { x: 0, y: 64 },
    tiltDeg: 45,
    usedFor: 'Phi kiếm đeo lưng, gốc cánh và phi phong',
    followsAnimation: true,
  },
  {
    id: 'chest',
    bone: 'spine_mid',
    pos: { x: 0, y: 48 },
    usedFor: 'Điểm trúng đạn và VFX, tâm aura, khiên hộ thể',
    followsAnimation: true,
  },
  {
    id: 'head_fx',
    bone: 'head',
    pos: { x: 0, y: 92 },
    usedFor: 'Dấu choáng, biểu cảm, thần thức',
    followsAnimation: true,
  },
  {
    id: 'head_top',
    bone: null,
    pos: { x: 0, y: 104 },
    usedFor: 'Gốc toàn bộ UI trên đầu (không gắn bone để thanh máu không rung)',
    followsAnimation: false,
  },
  {
    id: 'orbit_center',
    bone: null,
    pos: { x: 0, y: 60 },
    usedFor: 'Pháp khí bay quanh người',
    followsAnimation: false,
  },
  {
    id: 'mount_seat',
    bone: 'seat (skeleton thú)',
    pos: null,
    usedFor: 'Gắn root Player khi cưỡi',
    followsAnimation: 'mount',
  },
  {
    id: 'fly_feet',
    bone: 'root',
    pos: { x: 0, y: 0 },
    usedFor: 'Đứng trên phi kiếm khi ngự kiếm (+ độ cao z)',
    followsAnimation: 'code',
  },
];

/** Orbit path: ellipse 36 × 18 (printed as "36 × 18"; axes vs semi-axes is not stated — see PR notes). */
export const ORBIT_ELLIPSE_PX = { width: 36, height: 18 } as const;

export function getSocket(id: SocketId): SocketSpec {
  return SOCKETS.find((s) => s.id === id)!;
}

/**
 * Socket position in canvas px for a rig pose. `mirrored` flips x (the three mirrored directions "đảo dấu x").
 * Per-species sockets (mount_seat) have no default and must be supplied.
 */
export function socketCanvasPosition(id: SocketId, canvasSize: number, mirrored = false, override?: Vec2): Vec2 {
  const pos = override ?? getSocket(id).pos;
  if (!pos) throw new Error(`socket '${id}' is per-species: pass an explicit position`);
  return pivotToCanvas(pos, canvasSize, canvasSize, mirrored);
}

// ------------------------------------------------------------------ overhead UI (World UI, layer L6)
export const HEAD_TOP_HAT_BONUS_PX = 8;

export interface HeadTopContext {
  /** Tall headwear (+8). */
  readonly tallHat?: boolean;
  /** Mount saddle height in px (species-specific). */
  readonly mountSeatHeight?: number;
  /** Flight height z in px while sword-flying. */
  readonly flyHeight?: number;
  /** Base head_top y; defaults to the 1 × 1 socket (104). */
  readonly base?: number;
}

/** head_top y (pivot space, y up) including the data-declared extras. */
export function headTopY(ctx: HeadTopContext = {}): number {
  const base = ctx.base ?? getSocket('head_top').pos!.y;
  return base + (ctx.tallHat ? HEAD_TOP_HAT_BONUS_PX : 0) + (ctx.mountSeatHeight ?? 0) + (ctx.flyHeight ?? 0);
}

export interface OverheadUiElement {
  readonly id: 'hp_bar' | 'name_title' | 'realm_icon';
  /** Offset above head_top in px. */
  readonly offset: number;
  /** Size @1x; name uses a 12 px bitmap font (width varies). */
  readonly size: { readonly width: number | null; readonly height: number };
  readonly hiddenWhen: string;
}

export const OVERHEAD_UI: readonly OverheadUiElement[] = [
  {
    id: 'hp_bar',
    offset: 6,
    size: { width: 48, height: 5 },
    hiddenWhen: 'Đầy máu và ngoài chiến đấu (với người chơi khác)',
  },
  {
    id: 'name_title',
    offset: 16,
    size: { width: null, height: 12 },
    hiddenWhen: 'Người chơi tắt trong cài đặt',
  },
  { id: 'realm_icon', offset: 30, size: { width: 16, height: 16 }, hiddenWhen: 'Không' },
];

/** Overhead UI anchors in pivot space (y up) for a given head_top. Multi-tile bosses use the HUD bar instead. */
export function overheadAnchors(headTop: number): Record<OverheadUiElement['id'], Vec2> {
  const at = (id: OverheadUiElement['id']): Vec2 => ({
    x: 0,
    y: headTop + OVERHEAD_UI.find((e) => e.id === id)!.offset,
  });
  return { hp_bar: at('hp_bar'), name_title: at('name_title'), realm_icon: at('realm_icon') };
}

/** Multi-tile bosses (footprint ≥ 2 × 2) show their HP bar on the HUD, not overhead ("Boss đa ô"). */
export function usesHudHpBar(cls: FootprintClass): boolean {
  return footprintSize(cls) >= 2;
}

// ------------------------------------------------------------------ hit volumes
export type HitboxSpec =
  | {
      readonly multiPart: false;
      /** Movement collider radius in tiles (logic space). */
      readonly colliderRadius: number;
      /** Hurtbox radius in tiles (logic space). */
      readonly hurtboxRadius: number;
      /** Screen-space pick box px @1x, bottom edge at the pivot. */
      readonly pickBox: { readonly width: number; readonly height: number };
    }
  | { readonly multiPart: true };

export const HITBOX_BY_FOOTPRINT: Readonly<Record<FootprintSize, HitboxSpec>> = {
  1: {
    multiPart: false,
    colliderRadius: COLLIDER_RADIUS_TILES,
    hurtboxRadius: HURTBOX_RADIUS_TILES,
    pickBox: PICK_BOX_PX,
  },
  2: { multiPart: false, colliderRadius: 0.8, hurtboxRadius: 0.95, pickBox: { width: 120, height: 180 } },
  4: { multiPart: false, colliderRadius: 1.7, hurtboxRadius: 1.9, pickBox: { width: 240, height: 340 } },
  8: { multiPart: true },
};

export function getHitboxes(cls: FootprintClass): HitboxSpec {
  return HITBOX_BY_FOOTPRINT[footprintSize(cls)];
}

/** Pick box rectangle on screen (px @1x): horizontally centred on the pivot, bottom edge at the pivot. */
export function pickBoxRect(pivotScreen: Vec2, box: { width: number; height: number }): Rect {
  return { x: pivotScreen.x - box.width / 2, y: pivotScreen.y - box.height, width: box.width, height: box.height };
}

/** Shadow (layer L2): 2:1 ellipse, px @1x. */
export const SHADOW_ELLIPSE_PX = { width: 40, height: 20 } as const;
