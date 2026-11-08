/** Audit upright identity without allowing height-policy exceptions to skip similarity. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { runProject, type Project } from '@vgtd/sprite';

const base = resolve('assets-src/placeholder/dan-phu-tu-chibi-v1/SE');
const out = process.argv[2];
if (!out) throw new Error('Pass a temporary output directory');
const bytes = readFileSync(base + '/project.json');
const project = JSON.parse(bytes.toString('utf8')) as Project;
const clips = project.clips
  .filter((clip) => clip.kind === 'upright')
  .map((clip) => ({ ...clip, exceptions: undefined }));
const result = runProject({ ...project, clips }, base);
const findings = result.contract.qa.findings.filter((finding) => finding.gate === 'similarity');
const report = {
  method:
    'Public runProject, with all upright height exceptions omitted in this diagnostic only; threshold unchanged. Height findings remain separate.',
  projectSha256: createHash('sha256').update(bytes).digest('hex'),
  resample: project.resample ?? 'bilinear',
  similarityFailures: findings,
  clips: clips.map((clip) => ({
    name: clip.name,
    frames: clip.frames,
    failedCells: [...new Set(findings.filter((finding) => finding.clip === clip.name).map((finding) => finding.frame))],
  })),
};
mkdirSync(resolve(out), { recursive: true });
writeFileSync(resolve(out, 'unskipped-similarity-audit.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report));
process.exit(findings.length ? 1 : 0);
