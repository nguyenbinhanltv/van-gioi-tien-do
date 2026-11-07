/** Explicit clip-local order inside a shared sheet. No timing or pose inference. */
import { buildTemplate, type Template } from './template.js';
import type { CellSpec, Guides } from './types.js';

export interface SheetSelection {
  readonly rows: number;
  /** Full-sheet row-major indices, in this clip's playback order. */
  readonly cells: readonly number[];
}

export function sheetLayout(clip: { cols: number; frames: number; sheetSelection?: SheetSelection }) {
  const { cols, frames, sheetSelection: selection } = clip;
  const rows = selection?.rows ?? Math.ceil(frames / cols);
  if (![cols, frames, rows].every((n) => Number.isInteger(n) && n > 0))
    throw new RangeError('sheet cols, frames and rows must be positive integers');
  if (
    selection &&
    (selection.cells.length !== frames ||
      new Set(selection.cells).size !== frames ||
      selection.cells.some((n) => !Number.isInteger(n) || n < 0 || n >= cols * rows))
  )
    throw new RangeError('sheetSelection needs one unique in-range cell per clip frame');
  return { cols, rows, frames: selection ? cols * rows : frames };
}

export function selectSheetCells<T>(items: readonly T[], selection?: SheetSelection): T[] {
  if (!selection) return [...items];
  return selection.cells.map((i) => {
    if (i >= items.length) throw new RangeError(`sheetSelection cell ${i} missing from sheet or manifest`);
    return items[i]!;
  });
}

export interface GroupedTemplate extends Template {
  /** Spread each entry into its project clip; sheet and manifest paths are supplied by the caller. */
  readonly clips: readonly { name: string; frames: number; cols: number; sheetSelection: SheetSelection }[];
}

/** Combine short clips into one maximum 4x4 generation lattice, preserving each clip's guides and order. */
export function buildGroupedTemplate(options: {
  readonly clips: readonly { name: string; frames: number; cells?: readonly CellSpec[] }[];
  readonly guides: Guides;
  readonly cols?: number;
}): GroupedTemplate {
  const cols = options.cols ?? 4;
  const frames = options.clips.reduce((sum, c) => sum + c.frames, 0);
  const rows = Math.ceil(frames / cols);
  if (
    !options.clips.length ||
    new Set(options.clips.map((c) => c.name)).size !== options.clips.length ||
    options.clips.some(
      (c) => !c.name.trim() || !Number.isInteger(c.frames) || c.frames <= 0 || (c.cells && c.cells.length !== c.frames),
    ) ||
    !Number.isInteger(cols) ||
    cols < 1 ||
    cols > 4 ||
    rows > 4
  )
    throw new RangeError('grouped template requires unique named clips, positive counts and at most a 4x4 lattice');
  let start = 0;
  const clips = options.clips.map((c) => {
    const cells = Array.from({ length: c.frames }, (_, i) => start + i);
    start += c.frames;
    return { name: c.name, frames: c.frames, cols, sheetSelection: { rows, cells } };
  });
  const cells = options.clips.flatMap((c) =>
    Array.from(
      { length: c.frames },
      (_, i) => c.cells?.[i] ?? ({ leading: null, tag: `${c.name}_${i}` } satisfies CellSpec),
    ),
  );
  return {
    ...buildTemplate({ clip: options.clips.map((c) => c.name).join('+'), frames, cols, guides: options.guides, cells }),
    clips,
  };
}
