/**
 * `npm run sprite:backlog -w @vgtd/sprite -- --project <project.json> [--accept --note "<why>" [--owner 17] [--prune]] [--md]`
 *
 * Runs the project's QA and judges it against its quality backlog (`quality-backlog.json` beside the project, or
 * project.backlog). Without flags it only reports. --accept appends the CURRENT unlisted soft findings (never hard
 * findings, never regressions) with the given note; --prune drops entries that no longer occur and NEVER adds anything
 * (with --accept it prunes and accepts). The generated
 * `quality-backlog.md` is rewritten on every write (--md writes it without touching the JSON).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  acceptFindings,
  applyBacklog,
  backlogMarkdown,
  loadBacklog,
  migrateManualFindings,
  pruneResolved,
  runProject,
  saveBacklog,
  type Project,
} from '../src/index.js';

const args = process.argv.slice(2);
const opt = (n: string, d = '') => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
if (opt('import-manual')) {
  if (!opt('backlog') || ['project', 'accept', 'prune'].some((flag) => args.includes(`--${flag}`)))
    throw new Error(
      'usage: --backlog <quality-backlog.json> --import-manual <companion.json> (no project/accept/prune)',
    );
  if (!opt('backlog').endsWith('.json')) throw new Error('--backlog must end in .json');
  const path = resolve(cwd, opt('backlog'));
  const source: unknown = JSON.parse(readFileSync(resolve(cwd, opt('import-manual')), 'utf8'));
  const character = (source as { character?: unknown } | null)?.character;
  if (typeof character !== 'string' || !character.trim()) throw new Error('manual companion needs character');
  const backlog = migrateManualFindings(loadBacklog(path, character), source);
  saveBacklog(path, backlog);
  writeFileSync(path.replace(/\.json$/, '.md'), backlogMarkdown(backlog));
  console.log(
    `${backlog.character}: ${backlog.entries.length} metric entries; ${backlog.manual?.length ?? 0} manual art findings (${backlog.manual?.filter((e) => e.status === 'resolved').length ?? 0} art-worker resolved); wrote ${path}`,
  );
  process.exit(0);
}
const projectPath = resolve(cwd, opt('project'));
if (!opt('project')) throw new Error('usage: --project <project.json> [--accept --note <why>] [--prune] [--md]');
const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Project;
const baseDir = dirname(projectPath);
const backlogPath = resolve(baseDir, project.backlog ?? 'quality-backlog.json');
const res = runProject(project, baseDir);
let backlog = loadBacklog(backlogPath, project.character);
let report = applyBacklog(res.contract.qa.findings, project.direction, backlog);
console.log(
  `${project.character} ${project.direction}: ${JSON.stringify(report.counts)}; ${report.resolved.length} resolved metric entries; ${report.manual.length} manual art findings (${report.manual.filter((e) => e.status === 'resolved').length} art-worker resolved)`,
);
for (const e of report.manual)
  console.log(
    `  MANUAL [${e.kind}] ${e.clip} ${e.dir} cells ${e.cells.join(',') || 'all'} [${e.severity}/${e.status ?? 'open'}] ${e.reviewer}: ${e.note}`,
  );
for (const j of report.judged.filter(
  (x) =>
    x.verdict !== 'info' ||
    x.finding.measurement === 'unmeasured' ||
    x.finding.headEvidence ||
    x.finding.similarityCrop?.method === 'centroid-fallback' ||
    x.finding.originEvidence,
))
  console.log(
    `  ${j.verdict.toUpperCase()} [${j.finding.gate}] ${j.finding.clip}${j.finding.frame === undefined ? '' : ` #${j.finding.frame}`}: ${j.finding.message}`,
  );
for (const e of report.resolved)
  console.log(`  RESOLVED ${e.clip} #${e.cell} ${e.metric}: no longer occurs (use --prune)`);
if (args.includes('--accept') || args.includes('--prune')) {
  // only --accept (with a note) adds entries; --prune alone just drops the resolved ones
  backlog = args.includes('--accept')
    ? acceptFindings(backlog, report, project.direction, {
        note: opt('note'),
        ...(opt('owner') ? { owner: opt('owner') } : {}),
        added: new Date().toISOString().slice(0, 10),
        prune: args.includes('--prune'),
      })
    : pruneResolved(backlog, report);
  saveBacklog(backlogPath, backlog);
  report = applyBacklog(res.contract.qa.findings, project.direction, backlog);
  console.log(`wrote ${backlogPath} (${backlog.entries.length} entries); now ${JSON.stringify(report.counts)}`);
}
if (args.includes('--md') || args.includes('--accept') || args.includes('--prune'))
  writeFileSync(backlogPath.replace(/\.json$/, '.md'), backlogMarkdown(backlog));
process.exit(report.ok ? 0 : 1);
