/** One reviewed lattice root for the shared hit/dash sheet, never fitted per frame. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { CELL_PX, guidesFromMaster, measureFigure, median, normalizeSheetDpi, sliceSheet } from '@vgtd/sprite';
const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const path = resolve(root, 'S/project.json');
const project = JSON.parse(readFileSync(path, 'utf8'));
const source = existsSync(resolve(root, 'S/raw/hit-dash.attempt2.png'))
  ? 'raw/hit-dash.attempt2.png'
  : 'raw/hit-dash.attempt1.png';
const raw = decodePng(readFileSync(resolve(root, 'S/sheets/hit-dash.png')));
const normalized = normalizeSheetDpi(raw, 4, 16).image;
const frames = sliceSheet(normalized, { cols: 4, rows: 4, frames: 16 }, project.slice);
const inset = Math.round(CELL_PX * (project.slice.inset ?? 0.01));
const neutralCells = [0, 5, 6, 15];
const floors = neutralCells.map((i) => measureFigure(frames[i]!.image)!.bottom + inset);
const groundY = median(floors);
const guides = guidesFromMaster(measureFigure(decodePng(readFileSync(resolve(root, 'reference/S.master.png'))))!);
const anchor = {
  kind: 'lattice-root',
  pelvisX: guides.centerX,
  groundY,
  reason: 'preserve authored root travel',
  evidence: `Reviewed S/templates/hit-dash.head-guide.png and ${source}: fixed normalized source lattice X=${guides.centerX}; neutral T1 ready cells${neutralCells.join(',')} have floors${floors.join(',')}; one median ground=${groundY}. Both hit and dash retain source pelvis/forward-depth and hair travel; same root on every local cell, no fitting or rescaling.`,
};
for (const clip of project.clips.filter((c: { name: string }) => ['hit', 'dash'].includes(c.name))) {
  clip.vertical = 'keep';
  clip.authoredOrigins = Object.fromEntries(Array.from({ length: clip.frames }, (_, i) => [i, anchor]));
}
writeFileSync(path, JSON.stringify(project, null, 2) + '\n');
writeFileSync(
  resolve(root, 'S/group-registration.review.json'),
  JSON.stringify(
    {
      sheet: 'sheets/hit-dash.png',
      neutralGlobalCells: neutralCells,
      sourceFloorsBeforeInset: floors,
      anchor,
      scale: JSON.parse(readFileSync(resolve(root, 'character-calibration.json'), 'utf8')).scale,
      note: 'A single fixed lattice X and neutral-source ground for the whole shared sheet. All canvas/head/foot thresholds unchanged.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ floors, anchor }));
