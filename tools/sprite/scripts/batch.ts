/**
 * `npm run sprite:batch -w @vgtd/sprite -- --batch <batch.json> --out <dir> [--capture] [--keep-staged] [--allow-errors]`
 *
 * Builds + QAs every direction of a character (batch.json = { character, projects: [<dir>/project.json, ...] }), writes
 * <out>/<DIR>/... and <out>/batch-report.json, and an owner review page <out>/index.html.
 * --capture additionally stages each direction into apps/client-cocos/assets/resources/dragonbones/_batch-<character>-<DIR>
 * (git-ignored), builds the Cocos web player once, captures every clip at 2x with midpoint sampling into
 * <out>/<DIR>/capture/<clip>.gif and removes the staged folders (unless --keep-staged). Needs Cocos Creator 3.8.8 and Chrome.
 * Exit code 1 when a direction fails QA (hard gate, unlisted soft finding or regression) unless --allow-errors.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInside, runBatch, reviewHtml, type BatchReport } from '../src/index.js';

const args = process.argv.slice(2);
const opt = (n: string, d = '') => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
if (!opt('batch') || !opt('out')) throw new Error('usage: --batch <batch.json> --out <dir> [--capture]');
const out = resolve(cwd, opt('out'));
const run = runBatch(resolve(cwd, opt('batch')), out);
let report: BatchReport = run.report;
for (const d of report.dirs)
  console.log(
    `${report.character} ${d.dir}: ${d.ok ? 'OK' : 'FAILED'}; ` +
      d.clips.map((c) => `${c.name}=${c.status}`).join(' ') +
      `; backlog ${d.backlogEntries}`,
  );

if (args.includes('--capture')) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const client = join(repoRoot, 'apps/client-cocos');
  const resources = join(client, 'assets/resources/dragonbones');
  const staged = run.results.map((r) => ({
    dir: r.dir,
    stem: r.project.stem,
    name: `_batch-${report.character}-${r.dir}`,
  }));
  for (const s of staged) {
    const target = assertInside(resources, join(resources, s.name));
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const name = `${s.stem}_${s.dir}`;
    for (const f of [`${name}_ske.json`, `${name}_tex.json`, `${name}_tex.png`])
      cpSync(join(out, s.dir, f), join(target, f));
  }
  const build = spawnSync(process.execPath, [join(client, 'scripts/build-web.mjs')], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error('Cocos web build failed (see the log above)');
  for (const s of staged) {
    const captureDir = join(out, s.dir, 'capture');
    const cap = spawnSync(
      process.execPath,
      [
        join(client, 'scripts/capture.mjs'),
        '--skip-build',
        '--out',
        captureDir,
        '--mode',
        'single',
        '--direction',
        s.dir,
        '--src',
        `dragonbones/${s.name}`,
        '--stem',
        s.stem,
        '--animations',
        'all',
        '--frames',
        '12',
        '--zoom',
        '2',
        '--sample',
        'midpoint',
        '--gif',
      ],
      { stdio: 'inherit' },
    );
    if (cap.status !== 0)
      console.log(`capture of ${s.dir} reported problems (exit ${cap.status}); GIFs that exist are still listed`);
  }
  if (!args.includes('--keep-staged'))
    for (const s of staged) {
      rmSync(assertInside(resources, join(resources, s.name)), { recursive: true, force: true });
      rmSync(assertInside(resources, join(resources, `${s.name}.meta`)), { force: true });
    }
  report = {
    ...report,
    dirs: report.dirs.map((d) => ({
      ...d,
      clips: d.clips.map((c) => {
        const gif = `${d.dir}/capture/${c.name}.gif`;
        return existsSync(join(out, gif)) ? { ...c, gif } : c;
      }),
    })),
  };
  writeFileSync(join(out, 'batch-report.json'), JSON.stringify(report, null, 2) + '\n');
}
writeFileSync(join(out, 'index.html'), reviewHtml([report], `Sprite review: ${report.character}`));
console.log(`report ${join(out, 'batch-report.json')}; review page ${join(out, 'index.html')}`);
if (!report.ok && !args.includes('--allow-errors')) process.exit(1);
