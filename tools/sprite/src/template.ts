/**
 * Template generator: the blank sheet handed to the image model. N cells on a cols x rows grid, magenta key background, per
 * cell the ground / pelvis / head-top guide lines, a leading-leg marker (blue triangle bottom-left = L leads, red bottom-right
 * = R leads) and optional foot ghosts (cyan = near / R foot, amber = far / L foot). No text anywhere: labels live in the
 * manifest only.
 */
import type { Image } from '@vgtd/rig';
import type { Direction } from '@vgtd/shared';
import { facingGroundVector } from './gait.js';
import { fillEllipse, fillTriangle, hLine, solid, toPremultiplied, vLine, type Straight } from './raster.js';
import {
  CELL_PX,
  KEY_MAGENTA,
  type CellSpec,
  type Guides,
  type Rgb,
  type SheetGrid,
  type TemplateManifest,
} from './types.js';

/** Guide colours. Distinct from the key colour and from skin / cloth hues, so they are easy to spot and to ignore. */
export const GUIDE_COLORS = {
  ground: [40, 40, 40] as Rgb,
  pelvis: [90, 90, 90] as Rgb,
  head: [90, 90, 90] as Rgb,
  center: [120, 120, 120] as Rgb,
  border: [30, 30, 30] as Rgb,
  nearFoot: [0, 220, 230] as Rgb,
  farFoot: [255, 170, 0] as Rgb,
  leadL: [40, 90, 255] as Rgb,
  leadR: [230, 40, 40] as Rgb,
};

export interface TemplateOptions {
  readonly clip: string;
  /** Cells in use. */
  readonly frames: number;
  readonly cols: number;
  readonly cell?: number;
  readonly guides: Guides;
  /** One spec per frame; default: neutral cells without ghosts. */
  readonly cells?: readonly CellSpec[];
  readonly key?: Rgb;
}

export interface Template {
  readonly image: Image;
  readonly manifest: TemplateManifest;
}

function drawCell(img: Straight, ox: number, oy: number, cell: number, g: Guides, spec: CellSpec): void {
  // frame border
  hLine(img, oy, ox, ox + cell, GUIDE_COLORS.border, 1);
  hLine(img, oy + cell - 1, ox, ox + cell, GUIDE_COLORS.border, 1);
  vLine(img, ox, oy, oy + cell, GUIDE_COLORS.border, 1);
  vLine(img, ox + cell - 1, oy, oy + cell, GUIDE_COLORS.border, 1);
  // guides (dashed, thin) and the pelvis axis
  vLine(img, ox + g.centerX, oy + 4, oy + g.ground, GUIDE_COLORS.center, 0.6, 6);
  hLine(img, oy + g.head, ox + 4, ox + cell - 4, GUIDE_COLORS.head, 0.7, 8);
  hLine(img, oy + g.pelvis, ox + 4, ox + cell - 4, GUIDE_COLORS.pelvis, 0.7, 8);
  hLine(img, oy + g.ground, ox + 4, ox + cell - 4, GUIDE_COLORS.ground, 1);
  // foot ghosts: soft filled ovals on the ground line (flat: they are footprints, not feet)
  const ghost = (f: CellSpec['nearFoot'], c: Rgb) => {
    if (!f) return;
    fillEllipse(img, ox + f.x, oy + f.y, f.planted ? 11 : 8, f.planted ? 4 : 3, c, f.planted ? 0.9 : 0.55);
  };
  ghost(spec.farFoot, GUIDE_COLORS.farFoot);
  ghost(spec.nearFoot, GUIDE_COLORS.nearFoot);
  // leading leg marker
  if (spec.leading === 'L') {
    fillTriangle(img, [ox + 6, oy + cell - 6], [ox + 26, oy + cell - 6], [ox + 6, oy + cell - 26], GUIDE_COLORS.leadL);
  } else if (spec.leading === 'R') {
    fillTriangle(
      img,
      [ox + cell - 6, oy + cell - 6],
      [ox + cell - 26, oy + cell - 6],
      [ox + cell - 6, oy + cell - 26],
      GUIDE_COLORS.leadR,
    );
  }
}

/** Build the template PNG image and its manifest. */
export function buildTemplate(opts: TemplateOptions): Template {
  const cell = opts.cell ?? CELL_PX;
  const key = opts.key ?? KEY_MAGENTA;
  const rows = Math.ceil(opts.frames / opts.cols);
  const grid: SheetGrid = { cols: opts.cols, rows, cell };
  const cells: CellSpec[] = Array.from({ length: opts.frames }, (_, i) => opts.cells?.[i] ?? { leading: null });
  const sheet = solid(opts.cols * cell, rows * cell, key);
  cells.forEach((spec, i) =>
    drawCell(sheet, (i % opts.cols) * cell, Math.floor(i / opts.cols) * cell, cell, opts.guides, spec),
  );
  const manifest: TemplateManifest = {
    clip: opts.clip,
    grid,
    frames: opts.frames,
    guides: opts.guides,
    key,
    cells,
    width: sheet.width,
    height: sheet.height,
  };
  return { image: toPremultiplied(sheet), manifest };
}

export interface LocomotionOptions {
  /** Ground facing in y-down sprite space. Default E for existing templates. */
  readonly direction?: Direction;
  /** Half stride: how far (px @2x) a foot travels from the contact point to the neutral line. */
  readonly halfStride: number;
  /** Peak sole height (px @2x) of the swinging foot. */
  readonly lift: number;
  /**
   * Fraction of the cycle each foot is planted (stance). Default 0.5 (walk); a sprint is shorter (~0.33) and has flight
   * cells with both feet off the ground. Use the same value for `halfStrideFor`.
   */
  readonly stance?: number;
  /** Which leg is the first to make contact (cell 0). Default R. */
  readonly first?: 'L' | 'R';
}

/** Annotated ground contacts: the frames (0-based) in which each foot is really planted in the drawings. */
export interface Contacts {
  readonly R?: readonly number[];
  readonly L?: readonly number[];
}

/**
 * Replace the template's planted flags by the ACTUAL contact annotation of the drawings (a sprint's stance is shorter than the
 * template's half cycle, and the artist's feet can be lifted where the template planted them). The ghost positions are kept;
 * a foot without a ghost stays without one.
 */
export function applyContacts(cells: readonly CellSpec[], contacts: Contacts): CellSpec[] {
  return cells.map((c, i) => ({
    ...c,
    ...(c.nearFoot ? { nearFoot: { ...c.nearFoot, planted: contacts.R?.includes(i) ?? false } } : {}),
    ...(c.farFoot ? { farFoot: { ...c.farFoot, planted: contacts.L?.includes(i) ?? false } } : {}),
  }));
}

/** Tags of the 12-cell walk / run cycle (6 cells per step: contact, load, passing, toe-off, up, pre-contact). */
export const STEP_TAGS = ['contact', 'down', 'passing', 'toeoff', 'up', 'precontact'] as const;

/**
 * Foot ghosts and leading-leg flags of a locomotion cycle of `frames` cells (two steps: the first half has the `first`
 * leg leading, the second half the other). A planted foot slides back at constant speed (the character stays in the cell
 * centre); the swinging foot returns along a raised arc.
 */
export function locomotionCells(frames: number, g: Guides, opts: LocomotionOptions): CellSpec[] {
  const direction = opts.direction ?? 'E';
  const axis = facingGroundVector(direction);
  const project = (f: NonNullable<CellSpec['nearFoot']>) =>
    direction === 'E'
      ? f
      : {
          x: g.centerX + (f.x - g.centerX) * axis.x,
          y: g.ground + (f.x - g.centerX) * axis.y + (f.y - g.ground),
          planted: f.planted,
        };
  const first = opts.first ?? 'R';
  const s = opts.halfStride;
  const stance = opts.stance ?? 0.5;
  if (!(stance > 0 && stance <= 0.5)) throw new RangeError('stance must be in (0, 0.5]');
  const foot = (phase: number): { x: number; y: number; planted: boolean } => {
    // phase 0..1 over one full cycle for ONE foot: 0 = front contact; stance until `stance`; swing for the rest
    const p = ((phase % 1) + 1) % 1;
    if (p < stance) return { x: g.centerX + s * (1 - (2 * p) / stance), y: g.ground, planted: true };
    const q = (p - stance) / (1 - stance); // 0..1 swing
    return { x: g.centerX - s + 2 * s * q, y: g.ground - opts.lift * Math.sin(Math.PI * q), planted: false };
  };
  return Array.from({ length: frames }, (_, i) => {
    const t = i / frames;
    const lead = foot(t);
    const other = foot(t + 0.5);
    // `first` leg is the one at phase t; its ghost colour follows the side
    const nearIsFirst = first === 'R';
    const near = nearIsFirst ? lead : other;
    const far = nearIsFirst ? other : lead;
    const frontIsNear = near.x >= far.x;
    const step = Math.floor((i * 2) / frames); // 0 or 1
    const half = frames / 2;
    const tag = STEP_TAGS[Math.floor(((i % half) * STEP_TAGS.length) / half)] ?? 'contact';
    return {
      leading: frontIsNear ? 'R' : 'L',
      nearFoot: project(near),
      farFoot: project(far),
      tag: `${step === 0 ? first : first === 'R' ? 'L' : 'R'}_${tag}`,
    } satisfies CellSpec;
  });
}
