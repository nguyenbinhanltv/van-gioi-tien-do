import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const project = JSON.parse(readFileSync(path.join(base, 'project.json'), 'utf8'));
const calibration = JSON.parse(readFileSync(path.join(base, 'calibration.json'), 'utf8'));
for (const clip of project.clips) {
  const sheet = path.join(base, clip.sheet);
  if (!existsSync(sheet)) continue;
  const png = readFileSync(sheet);
  const height = png.readUInt32BE(20);
  const rows = Math.ceil(clip.frames / clip.cols);
  clip.calibration = { referenceHeight: calibration.normalizedReferenceHeight * (height / rows) };
}
writeFileSync(path.join(base, 'project.json'), JSON.stringify(project, null, 2) + '\n');
