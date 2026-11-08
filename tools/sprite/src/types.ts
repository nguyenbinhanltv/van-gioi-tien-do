/**
 * Shared types of the sprite-sheet pipeline (D41). All pixel numbers are texture px at 2x (the rig canvas 256x256 is the
 * 128x128 @1x canvas drawn at texture scale 2); y points down; the pivot (feet) is `pivotOf` from `@vgtd/character`.
 */
import type { Image } from '@vgtd/rig';

export type { Image };

/** Foot / leg side of the character: R = near foot in an E view, L = far foot. */
export type Side = 'L' | 'R';

export type Rgb = readonly [number, number, number];

/** Chroma-key colour of the template and of the raw AI sheets. */
export const KEY_MAGENTA: Rgb = [255, 0, 255];

/** Logical cell of the rig canvas @2x. */
export const CELL_PX = 256;

/** The guide lines of a template cell, in cell px (y down). */
export interface Guides {
  /** Ground line: the sole of a planted foot. */
  readonly ground: number;
  /** Top of the head of the upright master. */
  readonly head: number;
  /** Pelvis height of the upright master. */
  readonly pelvis: number;
  /** Vertical axis the pelvis is centred on. */
  readonly centerX: number;
}

/** A foot ghost: where the template asks the artist to put that foot (cell px, y down). */
export interface FootGhost {
  readonly x: number;
  readonly y: number;
  /** True when the foot is planted on the ground in this cell (contact / load / stance). */
  readonly planted: boolean;
}

export interface CellSpec {
  /** Which leg leads (is in front) in this cell; null for a neutral stance (idle, die ...). */
  readonly leading: Side | null;
  /** Near (R, cyan) / far (L, amber) foot ghosts; absent = no guide for that foot. */
  readonly nearFoot?: FootGhost;
  readonly farFoot?: FootGhost;
  /** Free label kept in the manifest only (contact, down, passing, up ...); never drawn: templates carry no text. */
  readonly tag?: string;
}

export interface SheetGrid {
  readonly cols: number;
  readonly rows: number;
  /** Cell edge in texture px of the template (a raw sheet may use any size, as long as cols x rows match). */
  readonly cell: number;
}

export interface TemplateManifest {
  readonly clip: string;
  readonly grid: SheetGrid;
  /** Cells in use (cols x rows may hold more; the rest stays key colour). */
  readonly frames: number;
  readonly guides: Guides;
  readonly key: Rgb;
  readonly cells: readonly CellSpec[];
  /** Pixel size of the template PNG. */
  readonly width: number;
  readonly height: number;
}

/** Measured geometry of the master image (alpha >= threshold), px. */
export interface MasterMetrics {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  /** Row below the lowest opaque pixel. */
  readonly bottom: number;
  readonly height: number;
  readonly width: number;
  /** Centroid x of the torso band: the pelvis axis. */
  readonly pelvisX: number;
}
