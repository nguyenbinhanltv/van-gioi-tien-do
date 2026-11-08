/**
 * `npm run sprite:template -w @vgtd/sprite -- --clip run [--frames 12 --cols 6] --master <master.png> --out <dir>
 *      [--gait run|walk|none (default: the clip name when it is run or walk)] [--direction E] [--duration <s>] [--stance <0..0.5>] [--half-stride <px>] [--lift 14] [--first R|L]
 *      [--center <x>] [--stance-width <px @2x, default 0>] [--cells <cells.json>]`
 *
 * Writes <out>/<clip>.template.png and <out>/<clip>.template.json (the manifest the build reads). Guides come from the
 * MEASURED master (ground at the pivot row, head top, pelvis, pelvis axis at the master's measured x unless --center).
 * --gait run|walk: the half stride is DERIVED from the table ground speed (RUN/WALK_SPEED_PX_S x viewGain(--direction) x
 * --duration, default the animation table duration), so the ghosts match the foot-slide gate exactly; --half-stride overrides.
 * --cells <json> replaces the generated cells with a hand-authored CellSpec[] (flight frames, flags).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  buildTemplate,
  guidesFromMaster,
  locomotionCells,
  SPRITE_CLIPS,
  SMOOTH_SPRITE_CLIPS,
  smoothPoseTags,
  measureFigure,
  resizeImage,
  CELL_PX,
  groundSpeedPxS,
  halfStrideFor,
  tableDuration,
  assertDirection,
  type CellSpec,
} from '../src/index.js';

const args = process.argv.slice(2);
const opt = (n: string, d = '') => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const clip = opt('clip');
const profile = opt('profile', 'legacy');
if (!['legacy', 'smooth-v2'].includes(profile)) throw new Error('--profile must be legacy or smooth-v2');
// frames / cols default to the clip table of the pipeline (SPRITE_CLIPS) when the clip is one of the 15
const tableClip = (profile === 'smooth-v2' ? SMOOTH_SPRITE_CLIPS : SPRITE_CLIPS).find((c) => c.name === clip);
if (profile === 'smooth-v2' && !tableClip) throw new Error(`unknown smooth-v2 clip '${clip}'`);
const frames = Number(opt('frames', String(tableClip?.sheet.frames ?? 0)));
const cols = Number(opt('cols', String(tableClip?.sheet.cols ?? 6)));
if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(cols) || cols < 1)
  throw new Error('frames and cols must be positive integers');
if (profile === 'smooth-v2' && (frames !== tableClip!.sheet.frames || cols > 4 || Math.ceil(frames / cols) > 4))
  throw new Error('smooth-v2 requires the official frame count and at most a 4x4 lattice');
if (!clip || !frames || !opt('master') || !opt('out'))
  throw new Error('usage: --clip <name> --frames <n> --cols <n> --master <png> --out <dir>');
let master = decodePng(readFileSync(resolve(cwd, opt('master'))));
if (master.width !== CELL_PX || master.height !== CELL_PX) master = resizeImage(master, CELL_PX, CELL_PX);
const m = measureFigure(master);
if (!m) throw new Error('empty master');
const guides = guidesFromMaster(m, CELL_PX, opt('center') ? Number(opt('center')) : undefined);
// the gait defaults to the clip name for run / walk, so new templates always follow the table ground speed
const gait = opt('gait', clip === 'run' || clip === 'walk' ? clip : 'none');
const stance = Number(opt('stance', '0.5'));
const direction = assertDirection(opt('direction', 'E'));
const derivedHalfStride = () => {
  const id = gait as 'run' | 'walk';
  const speed = groundSpeedPxS(id, direction);
  if (speed === null) throw new Error(`--gait ${gait} has no table ground speed`);
  return halfStrideFor(
    speed,
    opt('duration') ? Number(opt('duration')) : (tableClip?.durationSec ?? tableDuration(id)),
    stance,
  );
};
let cells: CellSpec[] | undefined;
if (opt('cells')) cells = JSON.parse(readFileSync(resolve(cwd, opt('cells')), 'utf8')) as CellSpec[];
else if (gait !== 'none')
  cells = locomotionCells(frames, guides, {
    direction,
    stanceWidth: Number(opt('stance-width', '0')),
    halfStride: opt('half-stride') ? Number(opt('half-stride')) : derivedHalfStride(),
    lift: Number(opt('lift', gait === 'run' ? '16' : '10')),
    first: opt('first', 'R') as 'L' | 'R',
    stance,
  });
if (profile === 'smooth-v2' && !cells) cells = smoothPoseTags(clip).map((tag) => ({ leading: null, tag }));
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
