/** Read-only source QA; aligned review images go only to the explicitly supplied output directory. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { blit, createImage, encodePng } from '@vgtd/rig';
import { runProject, type Project } from '@vgtd/sprite';

const args = process.argv.slice(2);
const option = (name: string, fallback = '') => {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const root = dirname(resolve(process.argv[1]!));
const direction = option('direction', 'E');
if (!['E', 'SE', 'S', 'NE', 'N'].includes(direction) || !option('out'))
  throw new Error('usage: --direction E|SE|S|NE|N --out <review-directory>');
const out = resolve(option('out'));
const rel = relative(root, out);
if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
  throw new Error('review output must be outside the source package');
const base = resolve(root, direction);
const bytes = readFileSync(resolve(base, 'project.json'));
const project = JSON.parse(bytes.toString('utf8')) as Project;
const result = runProject(project, base, { includeAlignedFrames: true });
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'contract.json'), JSON.stringify(result.contract, null, 2) + '\n');
for (const clip of result.alignedClips ?? []) {
  const contact = createImage(1024, Math.ceil(clip.frames.length / 4) * 256);
  clip.frames.forEach((frame, i) => {
    if (!frame) return;
    blit(contact, frame, (i % 4) * 256, Math.floor(i / 4) * 256);
    writeFileSync(resolve(out, `${clip.name}-${i}.png`), encodePng(frame));
  });
  writeFileSync(resolve(out, clip.name + '-contact.png'), encodePng(contact));
}
console.log(
  JSON.stringify(
    {
      direction,
      resample: project.resample ?? 'bilinear',
      projectSha256: createHash('sha256').update(bytes).digest('hex'),
      clips: result.contract.clips.length,
      frames: result.contract.clips.reduce((n, clip) => n + clip.frames, 0),
      counts: result.contract.qa.counts,
      ok: result.contract.qa.ok,
    },
    null,
    2,
  ),
);
