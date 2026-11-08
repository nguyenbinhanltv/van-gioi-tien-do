/** Opt diagnostic projects into D47 without inventing per-frame landmark evidence. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CELL_PX, headLandmarkSize, smoothProjectClipDefaults } from '@vgtd/sprite';

const root = process.argv[2];
if (!root) throw new Error('usage: prepare-head-policy.ts <asset-root>');
const source = JSON.parse(readFileSync(join(root, 'reference/master-source.json'), 'utf8'));
const calibration = JSON.parse(readFileSync(join(root, 'reference/master-calibration.json'), 'utf8'));
const view = source.directions.E;
const factor = (CELL_PX / view.sourceSize[1]) * calibration.scale;
const transform = ([x, y]: [number, number]) => ({
  x: CELL_PX / 2 + (x - view.landmarks.pelvis[0]) * factor,
  y: calibration.ground + (y - view.landmarks.soleY) * factor,
});
const transformedHead = { crown: transform(view.landmarks.crown), chin: transform(view.landmarks.chin) };
const review = JSON.parse(readFileSync(join(root, 'reference/head-boundary-review.json'), 'utf8'));
const masterHash = createHash('sha256')
  .update(readFileSync(join(root, 'reference/E.master.png')))
  .digest('hex');
if (masterHash !== review.masterSha256) throw new Error('Native head-boundary review is stale: master PNG changed');
const masterHead = review.selected;
const size = headLandmarkSize(masterHead, CELL_PX, CELL_PX);
if (size === null) throw new Error('Invalid transformed canonical head landmarks');
for (const name of ['project.diagnostic.json', 'project.candidate-02.json', 'project.full-diagnostic.json']) {
  const path = join(root, 'E', name);
  const project = JSON.parse(readFileSync(path, 'utf8'));
  project.timingProfile = 'smooth-v2';
  project.masterHead = masterHead;
  for (const clip of project.clips) {
    const defaults = smoothProjectClipDefaults(clip.name);
    clip.kind = defaults.kind;
    if (defaults.heightPolicy) clip.heightPolicy = defaults.heightPolicy;
  }
  writeFileSync(path, JSON.stringify(project, null, 2) + '\n');
}
writeFileSync(
  join(root, 'reference/master-head.json'),
  JSON.stringify(
    {
      masterHead,
      sizePx: size,
      transformedHead,
      masterSha256: masterHash,
      method:
        'Manual native semantic-boundary refinement pinned to unchanged E master; original transformed landmarks retained. See head-boundary-review.json for alpha/RGB trace and uncertainty. Secondary ponytail excluded; attached hair rim highlight included.',
      frameEvidenceStatus:
        'Not supplied by this helper. Review each affected aligned output cell; missing evidence must remain a QA failure.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ masterHead, sizePx: size }));
