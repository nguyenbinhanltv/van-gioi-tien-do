/** Diagnostic registration from the original authoring lattice, never from fitted output bounds. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { validateAuthoredOrigins, type Project } from '@vgtd/sprite';

const root = process.argv[2];
if (!root) throw new Error('usage: prepare-authored-origins.ts <direction-root>');
const project = JSON.parse(readFileSync(join(root, 'project.full-diagnostic.json'), 'utf8')) as Project;
const runReviewPath = join(root, 'run-selection.review.json');
const runReview = existsSync(runReviewPath)
  ? (JSON.parse(readFileSync(runReviewPath, 'utf8')) as {
      sourceSha256: string;
      masterSha256: string;
      masterHead: Project['masterHead'];
      clip: Project['clips'][number];
    })
  : null;
if (runReview) {
  const sourceHash = createHash('sha256')
    .update(readFileSync(join(root, runReview.clip.sheet)))
    .digest('hex');
  const masterHash = createHash('sha256')
    .update(readFileSync(join(root, '../reference/E.master.png')))
    .digest('hex');
  if (
    sourceHash !== runReview.sourceSha256 ||
    masterHash !== runReview.masterSha256 ||
    JSON.stringify(project.masterHead) !== JSON.stringify(runReview.masterHead)
  )
    throw new Error('Reviewed run source/master/head reference is stale');
  validateAuthoredOrigins(runReview.clip);
}
const dashReviewPath = join(root, 'dash-selection.review.json');
const dashReview = existsSync(dashReviewPath)
  ? (JSON.parse(readFileSync(dashReviewPath, 'utf8')) as NonNullable<typeof runReview>)
  : null;
if (dashReview) {
  const sourceHash = createHash('sha256')
    .update(readFileSync(join(root, dashReview.clip.sheet)))
    .digest('hex');
  const masterHash = createHash('sha256')
    .update(readFileSync(join(root, '../reference/E.master.png')))
    .digest('hex');
  if (
    sourceHash !== dashReview.sourceSha256 ||
    masterHash !== dashReview.masterSha256 ||
    JSON.stringify(project.masterHead) !== JSON.stringify(dashReview.masterHead)
  )
    throw new Error('Reviewed dash source/master/head reference is stale');
  validateAuthoredOrigins(dashReview.clip);
}
const walkReviewPath = join(root, 'walk-selection.review.json');
const walkReview = existsSync(walkReviewPath)
  ? (JSON.parse(readFileSync(walkReviewPath, 'utf8')) as NonNullable<typeof runReview>)
  : null;
if (walkReview) {
  const sourceHash = createHash('sha256')
    .update(readFileSync(join(root, walkReview.clip.sheet)))
    .digest('hex');
  const masterHash = createHash('sha256')
    .update(readFileSync(join(root, '../reference/E.master.png')))
    .digest('hex');
  if (
    sourceHash !== walkReview.sourceSha256 ||
    masterHash !== walkReview.masterSha256 ||
    JSON.stringify(project.masterHead) !== JSON.stringify(walkReview.masterHead)
  )
    throw new Error('Reviewed walk source/master/head reference is stale');
  validateAuthoredOrigins(walkReview.clip);
}
const poseReview = JSON.parse(readFileSync(join(root, 'free-pose-review.json'), 'utf8')) as {
  clips: Record<string, { source: string; sourceSha256: string; cells: Record<string, { reason: string }> }>;
};
const clips = project.clips.map((clip) => {
  if (clip.name === 'run' && runReview) return runReview.clip;
  if (clip.name === 'dash' && dashReview) return dashReview.clip;
  if (clip.name === 'walk' && walkReview) return walkReview.clip;
  if (clip.name === 'hit' && dashReview) {
    const groupedHit = {
      ...clip,
      vertical: 'keep' as const,
      sheet: dashReview.clip.sheet,
      authoredOrigins: Object.fromEntries(
        Array.from({ length: clip.frames }, (_, index) => [
          String(index),
          dashReview.clip.authoredOrigins![String(index)],
        ]),
      ),
    };
    validateAuthoredOrigins(groupedHit);
    return groupedHit;
  }
  const sheet =
    clip.name === 'idle'
      ? 'sheets/idle.attempt-02.raw.png'
      : clip.name === 'meditate'
        ? 'sheets/meditate.attempt-02.raw.png'
        : ['attack', 'attack_3'].includes(clip.name)
          ? `sheets/${clip.name}.repaired.png`
          : clip.sheet;
  const review = poseReview.clips[clip.name];
  const exceptions = { ...clip.exceptions };
  if (review) {
    if (
      clip.kind !== 'free' ||
      review.source !== sheet ||
      createHash('sha256')
        .update(readFileSync(join(root, sheet)))
        .digest('hex') !== review.sourceSha256
    )
      throw new Error(`${clip.name}: free-pose source review is stale or not a free clip`);
    for (const [cell, evidence] of Object.entries(review.cells)) exceptions[cell] = evidence.reason;
  }
  const reviewedClip = { ...clip, sheet, ...(Object.keys(exceptions).length ? { exceptions } : {}) };
  if (!['dash', 'attack', 'attack_2', 'attack_3', 'die'].includes(clip.name)) return reviewedClip;
  if (!clip.manifest) throw new Error(`${clip.name}: original authoring manifest required`);
  const manifest = JSON.parse(readFileSync(join(root, clip.manifest), 'utf8'));
  const authoredOrigins = Object.fromEntries(
    Array.from({ length: clip.frames }, (_, index) => [
      String(index),
      {
        kind: 'lattice-root' as const,
        pelvisX: manifest.guides.centerX,
        reason: 'preserve authored root travel',
        evidence: `Original ${clip.manifest} guides.centerX=${manifest.guides.centerX}. prepare-edit-guides.ts copies the pinned E master whole-cell without translation over this lattice. This is the authored registration line, distinct from anatomical pelvis X128. Full-pose dynamic source reviewed; per-cell head/foot/pose acceptance remains pending.`,
      },
    ]),
  );
  const result = { ...reviewedClip, authoredOrigins };
  validateAuthoredOrigins(result);
  return result;
});
const final = process.argv.includes('--final');
const output: Project & { diagnosticOnly?: string } = {
  ...project,
  backlog: '../quality-backlog.json',
  resample: 'lanczos3',
  slice: { ...project.slice, spill: { ...project.slice?.spill, asymmetric: { maxImbalance: 80, edgeRadius: 2 } } },
  stem: final ? 'kiemtuchibi' : 'kiemtu_chibi_t1_lattice_diagnostic',
  clips,
};
if (final) delete output.diagnosticOnly;
writeFileSync(
  join(root, final ? 'project.json' : 'project.lattice-diagnostic.json'),
  JSON.stringify(output, null, 2) + '\n',
);
console.log('Wrote reviewed source selection with fixed original template registration; no gate waivers.');
