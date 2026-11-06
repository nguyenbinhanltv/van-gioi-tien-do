/**
 * `npm run sprite:build -w @vgtd/sprite -- --project <project.json> --out <dir> [--allow-errors]`
 *
 * slice -> palette lock -> calibration -> align -> pack -> export -> QA for one character direction. Writes
 * <out>/<stem>_<DIR>_{ske,tex}.json, _tex.png and <stem>_<DIR>.sprite.json (the pipeline contract: calibration, per-frame
 * pre / post metrics, atlas, QA findings). Exits 1 on a failing QA gate unless --allow-errors.
 * The output folder can be copied into apps/client-cocos/assets/resources/dragonbones/<name>/ and captured with
 * `npm run capture -w client-cocos -- --src dragonbones/<name> --stem <stem> --direction <DIR> --mode single --gif`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runProject, writeOutputs, type Project } from '../src/index.js';

const args = process.argv.slice(2);
const opt = (n: string, d = '') => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const projectPath = resolve(cwd, opt('project'));
if (!opt('project') || !opt('out')) throw new Error('usage: --project <project.json> --out <dir>');
const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Project;
const res = runProject(project, dirname(projectPath));
const c = res.contract;
if (c.calibration)
  console.log(
    `character calibration: scale ${c.calibration.scale.toFixed(5)} (target ${c.calibration.targetHeight} px / median raw ${c.calibration.referenceHeight.toFixed(1)} px, ${c.calibration.referenceFrames} reference frames)`,
  );
for (const k of c.clips)
  console.log(
    `  ${k.name}: scale ${k.calibration.scale.toFixed(5)} (raw ${k.calibration.referenceHeight.toFixed(1)} px -> ${k.calibration.targetHeight} px)`,
  );
console.log(
  `atlas: ${c.atlas.pages} page ${c.atlas.width}x${c.atlas.height}, ${c.atlas.regions} regions; palette ${c.palette.size} colours${c.palette.locked ? ' (locked)' : ''}`,
);
for (const f of c.qa.findings)
  console.log(
    `  ${f.severity.toUpperCase()} [${f.gate}] ${f.clip}${f.frame === undefined ? '' : ` #${f.frame}`}: ${f.message}`,
  );
writeOutputs(res, resolve(cwd, opt('out')));
console.log(`QA ${c.qa.ok ? 'passed' : 'FAILED'}; wrote ${res.files.size} files to ${resolve(cwd, opt('out'))}`);
if (!c.qa.ok && !args.includes('--allow-errors')) process.exit(1);
