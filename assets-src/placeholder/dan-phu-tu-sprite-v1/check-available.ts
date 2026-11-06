/** Inspect completed clips without treating missing production work as accepted. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProject, writeOutputs, type Project } from '@vgtd/sprite';

const dir = process.argv[2]!;
const out = process.argv[3]!;
mkdirSync(out, { recursive: true });
const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as Project;
const reports = [];
for (const clip of project.clips) {
  if (!existsSync(join(dir, clip.sheet))) continue;
  // A single sheet's calibration is constant across all its cells. Report it explicitly.
  const input = { ...project, clips: [{ ...clip, reference: true }] };
  const result = runProject(input, dir);
  writeOutputs(result, join(out, clip.name));
  const report = {
    clip: clip.name,
    calibration: result.contract.calibration,
    heights: result.contract.clips[0]!.records.map((r) => r?.post.height),
    qa: result.contract.qa,
  };
  reports.push(report);
  console.log(JSON.stringify(report, null, 2));
}
writeFileSync(join(out, 'available-qa.json'), JSON.stringify(reports, null, 2) + '\n');
