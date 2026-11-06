// Acceptance gate for a character export (D39): rig:measure --strict (0 seam openings, 0 torn silhouettes, 0 stretch)
// AND the in-engine capture of the clips (npm run capture -w client-cocos; exits 1 on a viewer error or a popping loop).
//
//   npm run rig:gate -w @vgtd/rig -- <character> [--dir E] [--src dragonbones/<id> --stem <stem>] [--animations all|a,b]
//                                    [--frames 8] [--out <dir>] [--skip-capture] [--skip-measure]
// The capture sheets land in --out (default: the OS temp dir under vgtd-gate/<character>); attach them to the PR.
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const character = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'kiem-tu';
const dir = opt('dir', 'E');
const out = resolve(opt('out', join(tmpdir(), 'vgtd-gate', character)));
const run = (label, cmd, cmdArgs) => {
  console.log(`\n== ${label}`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: repo,
    stdio: 'inherit',
    shell: cmd === 'npm' && process.platform === 'win32',
  });
  console.log(`== ${label}: ${r.status === 0 ? 'PASS' : 'FAIL'}`);
  return r.status === 0;
};

const results = [];
if (!flag('skip-measure'))
  results.push(
    run('rig:measure --strict', process.execPath, [
      join(here, 'run-ts.mjs'),
      join(here, 'measure.ts'),
      character,
      '--dir',
      dir,
      '--strict',
    ]),
  );
if (!flag('skip-capture')) {
  const capture = [
    'run',
    'capture',
    '-w',
    'client-cocos',
    '--',
    '--out',
    out,
    '--animations',
    opt('animations', 'all'),
    '--frames',
    opt('frames', '8'),
    '--mode',
    'single',
    '--direction',
    dir,
  ];
  const src = opt('src', '');
  if (src) capture.push('--src', src);
  const stem = opt('stem', '');
  if (stem) capture.push('--stem', stem);
  results.push(run(`in-engine capture (${dir}) -> ${out}`, 'npm', capture));
}
console.log(`\ngate: ${results.every(Boolean) ? 'PASS' : 'FAIL'}${results.length ? '' : ' (nothing ran)'}`);
process.exit(results.length && results.every(Boolean) ? 0 : 1);
