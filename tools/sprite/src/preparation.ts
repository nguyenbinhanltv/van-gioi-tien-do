/** Explicit, versioned whole-sheet DPI preparation; never adjusts individual poses. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createImage, decodePng, type Image } from '@vgtd/rig';
import type { Project } from './project.js';
import { resizeImage } from './repair.js';
import { CELL_PX } from './types.js';
import { sheetLayout } from './grouped.js';
import { cellRect } from './slice.js';
import { resampleAffine, validateResample, type ResampleMethod } from './resample.js';

export interface ProjectPreparation {
  readonly kind: 'square-cell-dpi-v1';
  /** JSON containing the character-wide positive finite scale, relative to project.json. */
  readonly calibration: string;
}

/** Input-only audit: missing preparation is a reproducibility error, never an art finding. */
export function auditProjectPreparation(project: Project, baseDir: string): void {
  try {
    if (project.preparation) preparationScale(project.preparation, baseDir);
    const pitches: number[] = [];
    for (const clip of project.clips) {
      const raw = decodePng(readFileSync(resolve(baseDir, clip.sheet)));
      const grid = sheetLayout(clip);
      if (project.preparation)
        normalizeSheetDpi(
          raw,
          grid.cols,
          grid.frames,
          project.resample && project.resample !== 'bilinear' ? { resample: project.resample, defer: true } : {},
        );
      else if (!clip.calibration) pitches.push(raw.width / clip.cols);
    }
    if (pitches.length > 1 && Math.max(...pitches) - Math.min(...pitches) > 1)
      throw new Error('mixed sheet DPI needs preparation or per-sheet calibration');
  } catch (error) {
    throw new Error(`non-reproducible project: ${String(error)}`);
  }
}

export function preparationScale(preparation: ProjectPreparation, baseDir: string): number {
  try {
    if (preparation.kind !== 'square-cell-dpi-v1' || !preparation.calibration?.trim())
      throw new Error('expected square-cell-dpi-v1 and a calibration file');
    const { scale } = JSON.parse(readFileSync(resolve(baseDir, preparation.calibration), 'utf8')) as { scale: number };
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0)
      throw new Error('calibration scale must be positive and finite');
    return scale;
  } catch (error) {
    throw new Error(`non-reproducible project: ${String(error)}`);
  }
}

export interface SheetPreparation {
  readonly resample?: ResampleMethod;
  readonly singlePass?: boolean;
  readonly raw: readonly [number, number];
  readonly normalized: readonly [number, number];
  readonly cropTop: number;
  readonly cropBottom: number;
  readonly dpiScaleX: number;
  readonly dpiScaleY: number;
}

/** Native sliced cell -> logical sliced cell, including fractional lattice boundary rounding. */
export function nativeCellTransform(
  nativeWidth: number,
  nativeHeight: number,
  logicalWidth: number,
  logicalHeight: number,
  cols: number,
  rows: number,
  index: number,
  insetFraction = 0.01,
) {
  const native = cellRect(nativeWidth, nativeHeight, cols, rows, index);
  const logical = cellRect(logicalWidth, logicalHeight, cols, rows, index);
  const nativeInset = Math.round(Math.min(native.width, native.height) * insetFraction);
  const inset = Math.round(Math.min(logical.width, logical.height) * insetFraction);
  const scaleX = logicalWidth / nativeWidth,
    scaleY = logicalHeight / nativeHeight;
  return {
    scaleX,
    scaleY,
    dx: (native.x + nativeInset) * scaleX - logical.x - inset,
    dy: (native.y + nativeInset) * scaleY - logical.y - inset,
  };
}

/** Matches the original Dan/Phu assembler, including its 1px grid and 3px crop rounding tolerances. */
export function normalizeSheetDpi(
  raw: Image,
  cols: number,
  frames: number,
  options: { readonly resample?: ResampleMethod; readonly defer?: boolean } = {},
): { image: Image; record: SheetPreparation } {
  const method = options.resample ?? 'bilinear';
  validateResample(method);
  if (options.defer && method === 'bilinear') throw new Error('deferred preparation requires lanczos3 or area');
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(frames) || frames <= 0)
    throw new Error('non-reproducible project: cols and frames must be positive integers');
  const rows = Math.ceil(frames / cols);
  let grid = raw;
  let cropTop = 0;
  let cropBottom = raw.height;
  if (Math.abs(raw.width / cols - raw.height / rows) > 1) {
    const blankRow = (y: number) => {
      for (let x = 0; x < raw.width; x++) {
        const i = (y * raw.width + x) * 4;
        if (raw.data[i + 3]! > 0 && raw.data[i]! + raw.data[i + 1]! + raw.data[i + 2]! > 24) return false;
      }
      return true;
    };
    while (cropTop < cropBottom && blankRow(cropTop)) cropTop++;
    while (cropBottom > cropTop && blankRow(cropBottom - 1)) cropBottom--;
    const squareHeight = Math.round((raw.width / cols) * rows);
    if (Math.abs(cropBottom - cropTop - squareHeight) <= 3) {
      cropTop = Math.floor((cropTop + cropBottom - squareHeight) / 2);
      cropBottom = cropTop + squareHeight;
    }
    if (
      cropTop < 0 ||
      cropBottom > raw.height ||
      cropBottom <= cropTop ||
      Math.abs(raw.width / cols - (cropBottom - cropTop) / rows) > 1
    )
      throw new Error(
        `non-reproducible project: non-square cells after blank-row crop ${cropTop}..${cropBottom}; cannot distort anatomy`,
      );
    grid = createImage(raw.width, cropBottom - cropTop);
    grid.data.set(raw.data.subarray(cropTop * raw.width * 4, cropBottom * raw.width * 4));
  }
  const width = cols * CELL_PX,
    height = rows * CELL_PX;
  const image = options.defer
    ? grid
    : method === 'bilinear'
      ? resizeImage(grid, width, height)
      : resampleAffine(
          grid,
          width,
          height,
          { scaleX: width / grid.width, scaleY: height / grid.height, dx: 0, dy: 0 },
          method,
        );
  return {
    image,
    record: {
      ...(method !== 'bilinear' ? { resample: method, ...(options.defer ? { singlePass: true } : {}) } : {}),
      raw: [raw.width, raw.height],
      normalized: [width, height],
      cropTop,
      cropBottom,
      dpiScaleX: width / grid.width,
      dpiScaleY: height / grid.height,
    },
  };
}
