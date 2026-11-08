/** Measure actual alpha lost outside the fixed production cell, without fitting or rescaling poses. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import {
  alignFrame,
  CELL_PX,
  guidesFromMaster,
  measureFigure,
  normalizeSheetDpi,
  selectSheetCells,
  sheetLayout,
  sliceSheet,
} from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const project = JSON.parse(readFileSync(resolve(root, 'E/project.json'), 'utf8'));
const master = decodePng(readFileSync(resolve(root, 'reference/E.master.png')));
const metrics = measureFigure(master)!;
const guides = guidesFromMaster(metrics);
const globalScale = JSON.parse(readFileSync(resolve(root, 'character-calibration.json'), 'utf8')).scale;
const margin = CELL_PX / 2;
const clips = project.clips.map(
  (clip: {
    name: string;
    sheet: string;
    manifest: string;
    cols: number;
    frames: number;
    sheetSelection?: { rows: number; cells: number[] };
    calibration?: { scale: number };
    vertical?: 'sole' | 'keep';
  }) => {
    const layout = sheetLayout(clip);
    const raw = decodePng(readFileSync(resolve(root, 'E', clip.sheet)));
    const normalized = normalizeSheetDpi(raw, clip.cols, layout.frames).image;
    const frames = selectSheetCells(sliceSheet(normalized, layout, project.slice), clip.sheetSelection);
    const manifest = JSON.parse(readFileSync(resolve(root, 'E', clip.manifest), 'utf8'));
    const scale = clip.calibration?.scale ?? globalScale;
    const cells = frames.map((frame, index) => {
      const aligned = alignFrame(frame.image, {
        calibration: {
          scale,
          targetHeight: metrics.height,
          referenceHeight: metrics.height / scale,
          referenceFrames: 0,
        },
        guides: { ...guides, centerX: guides.centerX + margin, ground: guides.ground + margin },
        vertical: clip.vertical ?? 'sole',
        groundY: manifest.guides.ground,
        cell: CELL_PX * 2,
      });
      if (!aligned) throw new Error(`Missing ${clip.name} ${index}`);
      let opaqueLost = 0,
        anyAlphaLost = 0;
      const lostPixels: { x: number; y: number; alpha: number }[] = [];
      for (let y = 0; y < aligned.image.height; y++)
        for (let x = 0; x < aligned.image.width; x++) {
          if (x >= margin && x < margin + CELL_PX && y >= margin && y < margin + CELL_PX) continue;
          const alpha = aligned.image.data[(y * aligned.image.width + x) * 4 + 3]!;
          if (alpha > 0) {
            anyAlphaLost++;
            lostPixels.push({ x: x - margin, y: y - margin, alpha });
          }
          if (alpha >= 128) opaqueLost++;
        }
      return { cell: index, opaqueLost, anyAlphaLost, ...(lostPixels.length ? { lostPixels } : {}) };
    });
    return { clip: clip.name, cells };
  },
);
const findings = clips.flatMap(
  (clip: { clip: string; cells: { cell: number; opaqueLost: number; anyAlphaLost: number }[] }) =>
    clip.cells.filter((cell) => cell.anyAlphaLost).map((cell) => ({ clip: clip.clip, ...cell })),
);
const gate = {
  productionCell: CELL_PX,
  status: findings.length ? 'fail' : 'pass',
  clips,
  findings,
  note: 'Same fixed calibration/translation sampled on a larger diagnostic canvas. Counts every nonzero-alpha pixel outside the production cell; no pose fitting or scaling.',
};
writeFileSync(resolve(root, 'E/canvas-gate.json'), JSON.stringify(gate, null, 2) + '\n');
console.log(JSON.stringify({ status: gate.status, findings }, null, 2));
if (findings.length) process.exitCode = 1;
