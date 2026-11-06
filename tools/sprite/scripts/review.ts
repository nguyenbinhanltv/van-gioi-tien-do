/**
 * `npm run sprite:review -w @vgtd/sprite -- --out <dir> --reports <a/batch-report.json> [<b/batch-report.json> ...]`
 *
 * One owner review page for several characters: copies the GIFs and contract files of every batch report into
 * <out>/<character>/<DIR>/ and writes <out>/index.html listing all characters / directions / clips with their 2x GIFs and
 * QA status.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertDirection, assertSlug, reviewHtml, type BatchReport } from '../src/index.js';

const args = process.argv.slice(2);
const cwd = process.env.INIT_CWD ?? process.cwd();
const oi = args.indexOf('--out');
const ri = args.indexOf('--reports');
if (oi < 0 || ri < 0) throw new Error('usage: --out <dir> --reports <batch-report.json> [...]');
const out = resolve(cwd, args[oi + 1]!);
const reportFiles: string[] = [];
for (let i = ri + 1; i < args.length && !args[i]!.startsWith('--'); i++) reportFiles.push(args[i]!);
const reports: BatchReport[] = [];
for (const rel of reportFiles) {
  const file = resolve(cwd, rel);
  const src = JSON.parse(readFileSync(file, 'utf8')) as BatchReport;
  const root = dirname(file);
  assertSlug(src.character, `${rel}: character`);
  for (const d of src.dirs) assertDirection(d.dir, `${rel}: direction`);
  const dirs = src.dirs.map((d) => {
    const target = join(out, src.character, d.dir);
    mkdirSync(target, { recursive: true });
    for (const f of readdirSync(join(root, d.folder))) {
      if (f.endsWith('.sprite.json')) copyFileSync(join(root, d.folder, f), join(target, f));
    }
    const clips = d.clips.map((c) => {
      if (!c.gif || !existsSync(join(root, c.gif))) return { ...c, gif: undefined };
      const dest = join(target, `${c.name}.gif`);
      copyFileSync(join(root, c.gif), dest);
      return { ...c, gif: `${src.character}/${d.dir}/${c.name}.gif` };
    });
    return { ...d, folder: `${src.character}/${d.dir}`, clips };
  });
  reports.push({ ...src, dirs });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), reviewHtml(reports, 'Sprite review: all characters'));
console.log(`review page ${join(out, 'index.html')} (${reports.length} characters)`);
