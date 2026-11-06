import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runProject } from '__TEMP__/vgtd-support21-sprite123-1c48569/tools/sprite/src/index.ts';
const projectPath = process.argv[2]!;
const output = process.argv[3]!;
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
mkdirSync(output, { recursive: true });
const reports = [];
let totalArea = 0;
for (const clip of project.clips) {
  const result = runProject({ ...project, clips: [clip] }, output);
  const tex = JSON.parse(result.files.get('danphutu_N_tex.json') as string);
  const widths = tex.SubTexture.map((r) => r.width);
  const area = tex.SubTexture.reduce((sum,r) => sum + r.width * r.height, 0);
  totalArea += area;
  const contract = result.contract;
  reports.push({ clip: clip.name, frames: clip.frames, area, maxWidth: Math.max(...widths), minWidth: Math.min(...widths), qa: contract.qa, heights: contract.clips[0]!.records.map((r) => r?.post.height), hard: contract.qa.judged.filter((j) => j.verdict === 'fail-hard').map((j) => j.finding) });
}
writeFileSync(join(output, 'frame-diagnostic.json'), JSON.stringify({ totalArea, reports }, null, 2));
console.log(JSON.stringify({ totalArea, reports }, null, 2));