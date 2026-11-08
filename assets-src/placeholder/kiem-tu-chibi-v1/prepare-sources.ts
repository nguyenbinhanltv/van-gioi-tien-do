/** Explicit whole-grid DPI prep, then ONE declared source-plane translation for every cell of a sheet. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { CELL_PX, measureFigure, normalizeSheetDpi, placeScaled, sliceSheet, toPremultiplied } from '@vgtd/sprite';

const root = process.argv[2];
if (!root) throw new Error('usage: prepare-sources.ts <direction-root>');
const inventory = JSON.parse(readFileSync(join(root, 'motion-inventory.json'), 'utf8')) as {
  clips: {
    name: string;
    sheet: string;
    cols: number;
    frames: number;
    sheetSelection?: { rows: number; cells: number[] };
  }[];
};
const planes = JSON.parse(readFileSync(join(root, 'source-planes.json'), 'utf8')) as Record<
  string,
  {
    source: string;
    measuredPlane: number;
    targetPlane: number;
    note: string;
  }
>;
const selected = new Map<string, { source: string; cols: number; frames: number; stem: string }>();
for (const clip of inventory.clips) {
  const stem = clip.sheet.split('/').at(-1)!.replace('.raw.png', '');
  const override = planes[stem];
  selected.set(stem, {
    stem,
    source: override?.source ?? clip.sheet,
    cols: clip.cols,
    frames: clip.sheetSelection ? clip.sheetSelection.rows * clip.cols : clip.frames,
  });
}
const out = join(root, 'prepared');
mkdirSync(out, { recursive: true });
const records = [];
for (const item of selected.values()) {
  const input = readFileSync(join(root, item.source));
  const raw = decodePng(input);
  const normalized = normalizeSheetDpi(raw, item.cols, item.frames);
  const grid = { cols: item.cols, rows: Math.ceil(item.frames / item.cols), frames: item.frames };
  const frames = sliceSheet(decodePng(encodePng(normalized.image)), grid, { inset: 0, key: 'auto', spill: {} });
  const plane = planes[item.stem];
  const dy = plane ? plane.targetPlane - plane.measuredPlane : 0;
  const sheet = createImage(grid.cols * CELL_PX, grid.rows * CELL_PX);
  const cells = frames.map((frame, index) => {
    const source = toPremultiplied(frame.image);
    const before = measureFigure(source);
    if (!before) throw new Error(`${item.stem} #${index}: missing drawing`);
    if (before.top + dy < 0 || before.bottom + dy > CELL_PX)
      throw new Error(`${item.stem} #${index}: source-plane correction would clip art; repair source instead`);
    const translated = placeScaled(source, 1, 0, 0, 0, dy, CELL_PX);
    for (let y = 0; y < CELL_PX; y++)
      sheet.data.set(
        translated.data.subarray(y * CELL_PX * 4, (y + 1) * CELL_PX * 4),
        ((Math.floor(index / grid.cols) * CELL_PX + y) * sheet.width + (index % grid.cols) * CELL_PX) * 4,
      );
    return { index, before, after: measureFigure(translated) };
  });
  const output = encodePng(sheet);
  writeFileSync(join(out, `${item.stem}.png`), output);
  records.push({
    stem: item.stem,
    source: item.source,
    inputSha256: createHash('sha256').update(input).digest('hex'),
    outputSha256: createHash('sha256').update(output).digest('hex'),
    normalization: normalized.record,
    translation: {
      dx: 0,
      dy,
      measuredPlane: plane?.measuredPlane ?? null,
      targetPlane: plane?.targetPlane ?? null,
      note: plane?.note ?? 'DPI normalization only; original cell origin retained.',
    },
    order:
      'whole-sheet DPI normalization -> key/defringe -> identical whole-cell translation -> same-grid reassembly; no per-frame fitting',
    cells,
  });
}
writeFileSync(join(root, 'source-preparation.json'), JSON.stringify({ records }, null, 2) + '\n');
console.log(`Prepared ${records.length} source sheets; original raw drawings/guides untouched.`);
