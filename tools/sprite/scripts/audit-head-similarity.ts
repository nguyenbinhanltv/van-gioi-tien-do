/** Report-only D54 audit: rerun formerly skipped head-reason cells without any head exception. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isHeadEvidenceReason, runProject, type Project } from '../src/index.js';

const args = process.argv.slice(2);
const opt = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const sourceRoot = resolve(cwd, opt('root', 'assets-src/placeholder'));
const out = opt('out');
if (!out.endsWith('.json')) throw new Error('usage: --root <merged sources> --out <report.json>');
const output = resolve(cwd, out);
// A report must never overwrite an input project, sheet or export tree.
const fromSource = relative(sourceRoot, output);
if (fromSource !== '..' && !fromSource.startsWith('..' + sep) && !isAbsolute(fromSource))
  throw new Error('report output must be outside source root');
if (existsSync(output) && JSON.parse(readFileSync(output, 'utf8')).format !== 'vgtd-head-reason-similarity-audit')
  throw new Error('refusing to overwrite a non-audit JSON file');
const markdownOutput = output.replace(/\.json$/, '.md');
if (
  existsSync(markdownOutput) &&
  !readFileSync(markdownOutput, 'utf8').startsWith('# Head-reason similarity audit (D54)')
)
  throw new Error('refusing to overwrite a non-audit Markdown file');
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const paths = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? paths(join(dir, e.name)) : e.name === 'project.json' ? [join(dir, e.name)] : [],
  );
const projects: {
  project: string;
  character: string;
  direction: string;
  inputs: { file: string; sha256: string }[];
  cells: { clip: string; cell: number; reason: string; status: string; findings: string[] }[];
}[] = [];
for (const path of paths(sourceRoot).sort()) {
  const project = JSON.parse(readFileSync(path, 'utf8')) as Project;
  const affected = project.clips.flatMap((clip) =>
    Object.entries(clip.exceptions ?? {}).flatMap(([cell, reason]) =>
      isHeadEvidenceReason(reason) ? [{ clip: clip.name, cell: Number(cell), reason }] : [],
    ),
  );
  if (!affected.length) continue;
  const base = dirname(path);
  const files = new Set<string>([path, resolve(base, project.master)]);
  const backlog = resolve(base, project.backlog ?? 'quality-backlog.json');
  if (existsSync(backlog)) files.add(backlog);
  if (project.preparation) files.add(resolve(base, project.preparation.calibration));
  // All clips participate in palette/calibration/packing: pin every sheet and manifest, not only affected clips.
  for (const clip of project.clips) {
    files.add(resolve(base, clip.sheet));
    if (clip.manifest) files.add(resolve(base, clip.manifest));
  }
  const inputs = [...files]
    .sort()
    .map((file) => ({ file: relative(cwd, file).replace(/\\/g, '/'), sha256: hash(file) }));
  const auditProject: Project = {
    ...project,
    clips: project.clips.map((clip) => ({
      ...clip,
      exceptions: Object.fromEntries(
        Object.entries(clip.exceptions ?? {}).filter(([, reason]) => !isHeadEvidenceReason(reason)),
      ),
    })),
  };
  const result = runProject(auditProject, base);
  const cells = affected.map((cell) => {
    const findings = result.contract.qa.findings.filter(
      (f) => f.gate === 'similarity' && f.clip === cell.clip && f.frame === cell.cell,
    );
    const record = result.contract.clips.find((c) => c.name === cell.clip)?.records[cell.cell];
    return {
      ...cell,
      status: !record ? 'unmeasured' : findings.length ? 'fail' : 'pass',
      findings: findings.map((f) => f.message),
    };
  });
  for (const input of inputs)
    if (hash(resolve(cwd, input.file)) !== input.sha256) throw new Error(`audit mutated ${input.file}`);
  projects.push({
    project: relative(cwd, path).replace(/\\/g, '/'),
    character: project.character,
    direction: project.direction,
    inputs,
    cells,
  });
  console.log(
    `${project.character} ${project.direction}: ${cells.length} formerly skipped; ${cells.filter((c) => c.status === 'fail').length} similarity failures`,
  );
}
const cells = projects.flatMap((p) => p.cells);
const audit = {
  format: 'vgtd-head-reason-similarity-audit',
  version: 1,
  utc: new Date().toISOString(),
  command: [
    'npm run sprite:audit-head-similarity -w @vgtd/sprite --',
    '--root',
    opt('root', 'assets-src/placeholder'),
    '--out',
    out,
  ].join(' '),
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(),
  gateSourceSha256: hash(resolve(cwd, 'tools/sprite/src/qa.ts')),
  reasonSourceSha256: hash(resolve(cwd, 'tools/sprite/src/head-evidence.ts')),
  method:
    'Read committed-direction projects; identify old exceptions with posture/secondary-overhang/rear-*; remove only those reasons in memory and run the unchanged-source pipeline. No source, export or backlog writes; all input hashes rechecked. Existing D41 free-pose exceptions remain separate. No findings are accepted by this report.',
  totals: {
    projects: projects.length,
    cells: cells.length,
    pass: cells.filter((c) => c.status === 'pass').length,
    fail: cells.filter((c) => c.status === 'fail').length,
    unmeasured: cells.filter((c) => c.status === 'unmeasured').length,
  },
  projects,
};
const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const md = [
  '# Head-reason similarity audit (D54)',
  '',
  `UTC: ${audit.utc}. Git head: ${audit.gitHead}.`,
  '',
  audit.method,
  '',
  `Projects: ${audit.totals.projects}; cells: ${audit.totals.cells}; pass: ${audit.totals.pass}; fail: ${audit.totals.fail}; unmeasured: ${audit.totals.unmeasured}.`,
  '',
  `Full input hashes and reproduction command: [JSON report](${output.split(/[\\/]/).pop()}).`,
  '',
  '| Project / direction | Clip | Local cell | Former head reason | Fresh similarity result |',
  '| --- | --- | --- | --- | --- |',
  ...projects.flatMap((p) =>
    p.cells.map(
      (c) =>
        `| ${escape(p.character)} / ${p.direction} | ${escape(c.clip)} | ${c.cell} | ${escape(c.reason)} | ${c.status.toUpperCase()}${c.findings.length ? ': ' + escape(c.findings.join('; ')) : ''} |`,
    ),
  ),
  '',
].join('\n');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(audit, null, 2) + '\n', 'utf8');
writeFileSync(markdownOutput, md, 'utf8');
console.log(JSON.stringify(audit.totals));
if (audit.totals.unmeasured) process.exitCode = 1;
