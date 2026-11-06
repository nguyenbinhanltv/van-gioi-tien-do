import { readFileSync, writeFileSync } from 'node:fs';
import { spriteClip } from '__USER_HOME__/.ao/data/worktrees/van-gioi-tien-do/van-gioi-tien-do-21/tools/sprite/src/index.ts';
const path = process.argv[2]!;
const project = JSON.parse(readFileSync(path, 'utf8'));
for (const clip of project.clips) {
  const spec = spriteClip(clip.name);
  clip.durationSec = spec.durationSec;
  clip.loop = spec.loop;
  clip.kind = spec.kind;
  if (spec.phases) clip.phases = spec.phases;
  else delete clip.phases;
}
writeFileSync(path, JSON.stringify(project, null, 2) + '\n');
console.log('SE metadata now uses public phase defaults; drawn layout preserved.');