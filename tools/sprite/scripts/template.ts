/**
 * `npm run sprite:template -w @vgtd/sprite -- --clip run --frames 12 --cols 6 --master <master.png> --out <dir>
 *      [--gait run|walk|none] [--half-stride 26] [--lift 14] [--first R|L] [--center <x>] [--cells <cells.json>]`
 *
 * Writes <out>/<clip>.template.png and <out>/<clip>.template.json (the manifest the build reads). Guides come from the
 * MEASURED master (ground at the pivot row, head top, pelvis, pelvis axis at the master's measured x unless --center).
 * --cells <json> replaces the generated cells with a hand-authored CellSpec[] (flight frames, flags).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  buildTemplate,
  guidesFromMaster,
  locomotionCells,
  measureFigure,
  resizeImage,
  CELL_PX,
  type CellSpec,
} from '../src/index.js';

const args = process.argv.slice(2);
const opt = (n: string, d = '') => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const clip = opt('clip');
const frames = Number(opt('frames'));
const cols = Number(opt('cols', '6'));
if (!clip || !frames || !opt('master') || !opt('out'))
  throw new Error('usage: --clip <name> --frames <n> --cols <n> --master <png> --out <dir>');
let master = decodePng(readFileSync(resolve(cwd, opt('master'))));
if (master.width !== CELL_PX || master.height !== CELL_PX) master = resizeImage(master, CELL_PX, CELL_PX);
const m = measureFigure(master);
if (!m) throw new Error('empty master');
const guides = guidesFromMaster(m, CELL_PX, opt('center') ? Number(opt('center')) : undefined);
const gait = opt('gait', 'none');
let cells: CellSpec[] | undefined;
if (opt('cells')) cells = JSON.parse(readFileSync(resolve(cwd, opt('cells')), 'utf8')) as CellSpec[];
else if (gait !== 'none')
  cells = locomotionCells(frames, guides, {
    halfStride: Number(opt('half-stride', gait === 'run' ? '30' : '22')),
    lift: Number(opt('lift', gait === 'run' ? '16' : '10')),
    first: opt('first', 'R') as 'L' | 'R',
  });
const t = buildTemplate({ clip, frames, cols, guides, ...(cells ? { cells } : {}) });
const out = resolve(cwd, opt('out'));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${clip}.template.png`), encodePng(t.image));
writeFileSync(join(out, `${clip}.template.json`), JSON.stringify(t.manifest, null, 2));
console.log(
  `master ${m.width}x${m.height} px, pelvis x ${m.pelvisX.toFixed(2)}; guides ground ${guides.ground} head ${guides.head} pelvis ${guides.pelvis.toFixed(1)} centre ${guides.centerX.toFixed(2)}`,
);
console.log(
  `wrote ${join(out, `${clip}.template.png`)} (${t.manifest.width}x${t.manifest.height}, ${frames} cells) + .json`,
);
