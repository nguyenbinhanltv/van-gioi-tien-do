/* global console, structuredClone */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runProject } from '@vgtd/sprite';
import { SPRITE_SMOOTH_FPS } from '@vgtd/shared';

const base = resolve('assets-src/placeholder/dao-tu-chibi-v1/SE');
const runtime = resolve('apps/client-cocos/assets/resources/dragonbones/dao-tu-chibi-v1');
const project = JSON.parse(readFileSync(resolve(base, 'project.json'), 'utf8'));
const correction = JSON.parse(readFileSync(resolve(base, 'head-evidence-correction.json'), 'utf8'));
const beforeProject = structuredClone(project);
const beforeRun = beforeProject.clips.find((c) => c.name === 'run');
for (const cell of correction.changedCells) beforeRun.headEvidence[cell] = correction.original[cell];
const before = runProject(beforeProject, base);
const result = runProject(project, base);
const contractName = 'daotuchibi_SE.sprite.json';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const renderInputs = [];
for (const [name, bytes] of result.files) {
  if (name === contractName) continue;
  const baseline = readFileSync(resolve(runtime, name));
  if (sha(baseline) !== sha(bytes)) throw new Error('Evidence-only update changed render input: ' + name);
  renderInputs.push({ file: name, sha256: sha(bytes), unchanged: true });
}
if (!result.contract.qa.ok) throw new Error('Current hard/unlisted/regression QA must pass before contract refresh');
const ske = JSON.parse(readFileSync(resolve(runtime, 'daotuchibi_SE_ske.json'), 'utf8'));
if (ske.frameRate !== SPRITE_SMOOTH_FPS) throw new Error('Expected the unchanged D58 smooth clock baseline');
const bytes = result.files.get(contractName);
if (!bytes) throw new Error('Missing pipeline contract');
// The only runtime write: annotations and current QA. No render input is rewritten.
writeFileSync(resolve(runtime, contractName), bytes);
writeFileSync(
  resolve(base, 'head-evidence-qa.json'),
  JSON.stringify(
    {
      scope: 'Evidence-only contract refresh; no rendered art/timing writes.',
      projectSha256: sha(readFileSync(resolve(base, 'project.json'))),
      contractSha256: sha(bytes),
      qa: result.contract.qa.counts,
      headBandFailures: result.contract.qa.judged.filter(
        (j) => j.verdict === 'fail-hard' && j.finding.gate === 'height',
      ),
      paletteHardFailures: result.contract.qa.judged.filter(
        (j) => j.verdict === 'fail-hard' && j.finding.gate === 'similarity',
      ),
      headBandBefore: before.contract.qa.judged.filter((j) => j.verdict === 'fail-hard' && j.finding.gate === 'height'),
      clock: { timingProfile: project.timingProfile, frameRate: ske.frameRate, unchanged: true },
      temporalReview: result.contract.qa.findings.filter((f) => f.metric === 'temporal_review_by_eye'),
      renderInputs,
    },
    null,
    2,
  ) + '\n',
);
console.log('Refreshed SE contract only; all render inputs byte-identical; QA', result.contract.qa.counts);
