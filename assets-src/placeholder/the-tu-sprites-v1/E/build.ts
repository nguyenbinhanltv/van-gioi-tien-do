import console from 'node:console';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { runProject, writeOutputs, type Project } from '@vgtd/sprite';

const base = dirname(process.argv[1]!);
const project = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8')) as Project;
const partial = process.argv.includes('--partial');
const active = partial ? { ...project, clips: project.clips.filter((c) => existsSync(join(base, c.sheet))) } : project;
const result = runProject(active, base);
console.log(
  JSON.stringify(
    {
      calibration: result.contract.calibration,
      clips: result.contract.clips.map((c) => ({ name: c.name, heights: c.records.map((r) => r?.post.height) })),
      atlas: result.contract.atlas,
      qa: result.contract.qa,
    },
    null,
    2,
  ),
);
const outIndex = process.argv.indexOf('--out');
if (outIndex >= 0) writeOutputs(result, process.argv[outIndex + 1]!);
if (!result.contract.qa.ok) process.exitCode = 1;
