/** D55 read-only old/new crop audit. Scores every frame; D41 gate exemptions are labelled separately. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  isSimilarityExemptReason,
  measureSimilarity,
  runProject,
  SPRITE_SIMILARITY_MIN,
  type Project,
  type SimilarityCropMeasurement,
} from '../src/index.js';

const args = process.argv.slice(2),
  cwd = process.env.INIT_CWD ?? process.cwd();
const opt = (name: string, fallback = '') => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const sourceRoot = resolve(cwd, opt('root', 'assets-src/placeholder')),
  out = resolve(cwd, opt('out'));
if (!opt('out').endsWith('.json'))
  throw new Error('usage: --root <sources> [--project <extra.json> ...] --out <report.json>');
const extra = args.flatMap((a, i) => (a === '--project' ? [resolve(cwd, args[i + 1]!)] : []));
const inside = (dir: string, file: string) => {
  const r = relative(dir, file);
  return r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r);
};
if ([sourceRoot, ...extra.map(dirname)].some((root) => inside(root, out)))
  throw new Error('report must be outside input source directories');
if (existsSync(out) && JSON.parse(readFileSync(out, 'utf8')).format !== 'vgtd-similarity-crop-audit')
  throw new Error('refusing to overwrite non-audit JSON');
const htmlOut = out.replace(/\.json$/, '.html');
if (existsSync(htmlOut) && !readFileSync(htmlOut, 'utf8').includes('<!-- vgtd-similarity-crop-audit -->'))
  throw new Error('refusing to overwrite non-audit HTML');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name === 'project.json' ? [join(dir, e.name)] : [],
  );
const paths = [...new Set([...walk(sourceRoot), ...extra])].sort();
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const images = out.replace(/\.json$/, '-images');
mkdirSync(images, { recursive: true });
type Scores = { head: number; torso: number };
type Cell = {
  clip: string;
  cell: number;
  d41Exempt: boolean;
  old: Scores;
  fresh: Scores | null;
  method: string;
  headKind?: string;
  category: string;
  error?: string;
  otherHard: string[];
  crops?: SimilarityCropMeasurement;
  oldCrops?: SimilarityCropMeasurement;
  image?: string;
};
const projects: {
  project: string;
  character: string;
  direction: string;
  temporary: boolean;
  masterImage: string;
  inputs: { file: string; sha256: string }[];
  cells: Cell[];
}[] = [];
const esc = (v: unknown) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
for (const [index, path] of paths.entries()) {
  const p = JSON.parse(readFileSync(path, 'utf8')) as Project,
    base = dirname(path);
  const files = new Set([path, resolve(base, p.master)]);
  const backlog = resolve(base, p.backlog ?? 'quality-backlog.json');
  if (existsSync(backlog)) files.add(backlog);
  if (p.preparation) files.add(resolve(base, p.preparation.calibration));
  for (const c of p.clips) {
    files.add(resolve(base, c.sheet));
    if (c.manifest) files.add(resolve(base, c.manifest));
  }
  const inputs = [...files].sort().map((file) => ({ file, sha256: sha(file) }));
  const result = runProject(p, base, { includeAlignedFrames: true }),
    master = decodePng(readFileSync(resolve(base, p.master))),
    masterHeight = result.contract.master.metrics.height;
  const prefix = String(index).padStart(2, '0') + '-' + p.character + '-' + p.direction,
    masterImage = prefix + '-master.png';
  writeFileSync(join(images, masterImage), readFileSync(resolve(base, p.master)));
  const cells: Cell[] = [];
  for (const clip of p.clips) {
    const aligned = result.alignedClips!.find((c) => c.name === clip.name)!;
    for (const [cell, image] of aligned.frames.entries()) {
      if (!image) throw new Error(`missing aligned frame ${path} ${clip.name} ${cell}`);
      const old = measureSimilarity(master, image, { masterHeight, mode: 'legacy' });
      const oldFail = old.head < SPRITE_SIMILARITY_MIN || old.torso < SPRITE_SIMILARITY_MIN;
      const otherHard = result.contract.qa.judged
        .filter(
          (j) =>
            j.verdict === 'fail-hard' &&
            j.finding.gate !== 'similarity' &&
            j.finding.clip === clip.name &&
            (j.finding.frame === undefined || j.finding.frame === cell),
        )
        .map((j) => j.finding.metric ?? j.finding.gate);
      let row: Cell;
      try {
        const fresh = measureSimilarity(master, image, {
          masterHeight,
          ...(p.masterHead ? { masterHead: p.masterHead } : {}),
          ...(clip.headEvidence?.[cell] ? { frameHead: clip.headEvidence[cell] } : {}),
        });
        const newFail = fresh.head < SPRITE_SIMILARITY_MIN || fresh.torso < SPRITE_SIMILARITY_MIN;
        const category =
          fresh.crops.method === 'centroid-fallback' && oldFail
            ? 'unresolved-centroid-fallback'
            : oldFail && !newFail
              ? 'resolved-by-crop'
              : oldFail && newFail
                ? 'persistent-anchored-failure'
                : !oldFail && newFail
                  ? 'new-anchored-failure'
                  : 'pass';
        row = {
          clip: clip.name,
          cell,
          d41Exempt: isSimilarityExemptReason(clip.exceptions?.[cell]),
          old: { head: old.head, torso: old.torso },
          fresh: { head: fresh.head, torso: fresh.torso },
          method: fresh.crops.method,
          headKind: fresh.crops.frame.headKind,
          category,
          otherHard,
        };
        if (!row.d41Exempt && (oldFail || newFail)) {
          row.crops = fresh.crops;
          row.oldCrops = old.crops;
        }
      } catch (error) {
        row = {
          clip: clip.name,
          cell,
          d41Exempt: isSimilarityExemptReason(clip.exceptions?.[cell]),
          old: { head: old.head, torso: old.torso },
          fresh: null,
          method: 'invalid-window',
          category: 'invalid-window',
          error: String(error),
          otherHard,
          oldCrops: old.crops,
        };
      }
      if (!row.d41Exempt && row.category !== 'pass') {
        row.image = prefix + '-' + clip.name + '-' + cell + '.png';
        writeFileSync(join(images, row.image), encodePng(image, { premultiplied: true }));
      }
      cells.push(row);
    }
  }
  for (const input of inputs)
    if (sha(input.file) !== input.sha256) throw new Error('input changed during audit: ' + input.file);
  projects.push({
    project: path,
    character: p.character,
    direction: p.direction,
    temporary: extra.includes(path),
    masterImage,
    inputs,
    cells,
  });
  const active = cells.filter((c) => !c.d41Exempt);
  console.log(
    `${p.character} ${p.direction}${extra.includes(path) ? ' TEMP' : ''}: ${cells.length} scored, ${active.filter((c) => c.category === 'resolved-by-crop').length} crop-resolved, ${active.filter((c) => c.category === 'persistent-anchored-failure' || c.category === 'new-anchored-failure').length} anchored failures, ${active.filter((c) => c.category === 'unresolved-centroid-fallback').length} unresolved fallback`,
  );
}
const all = projects.flatMap((p) => p.cells),
  active = all.filter((c) => !c.d41Exempt);
const count = (category: string) => active.filter((c) => c.category === category).length;
const audit = {
  format: 'vgtd-similarity-crop-audit',
  version: 1,
  utc: new Date().toISOString(),
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(),
  threshold: SPRITE_SIMILARITY_MIN,
  command: [
    'npm run sprite:audit-similarity-crops -w @vgtd/sprite --',
    '--root',
    sourceRoot,
    ...extra.flatMap((p) => ['--project', p]),
    '--out',
    out,
  ].join(' '),
  codeHashes: ['tools/sprite/src/qa.ts', 'tools/sprite/src/similarity-crops.ts'].map((file) => ({
    file,
    sha256: sha(resolve(cwd, file)),
  })),
  policy:
    'Windows are not evidence. Same aligned pixels, no art/export/backlog edits, no annotation synthesis. Score all frames regardless of D41 exemption, but keep those labelled separately. Resolved-by-crop means the old similarity failure clears under approved windows, not that other gates pass. Persistent/new anchored failures require manual source review before being called genuine drift. Centroid fallback is measured but cannot diagnose missing-landmark crop artifacts.',
  totals: {
    projects: projects.length,
    scored: all.length,
    d41Exempt: all.filter((c) => c.d41Exempt).length,
    centroidFallback: all.filter((c) => c.method === 'centroid-fallback').length,
    resolvedByCrop: count('resolved-by-crop'),
    persistentAnchored: count('persistent-anchored-failure'),
    newAnchored: count('new-anchored-failure'),
    unresolvedFallback: count('unresolved-centroid-fallback'),
    invalid: count('invalid-window'),
  },
  projects,
};
writeFileSync(out, JSON.stringify(audit, null, 2) + '\n', 'utf8');
const box = (b: { left: number; top: number; right: number; bottom: number }, color: string, label: string) =>
  `<span title="${esc(label + ' ' + JSON.stringify(b))}" style="position:absolute;left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;border:1px solid ${color};box-sizing:border-box"></span>`;
const visual = (
  file: string,
  old: SimilarityCropMeasurement | undefined,
  fresh: SimilarityCropMeasurement | undefined,
  side: 'master' | 'frame',
) =>
  `<div class="image"><img src="${esc(basename(images) + '/' + file)}" width="256" height="256">${old ? box(old[side].head, '#ff6050', 'D54 legacy head') + box(old[side].torso, '#ffb040', 'D54 torso') : ''}${fresh ? box(fresh[side].head, '#40f0de', 'D55 ' + fresh[side].headKind) + box(fresh[side].torso, '#80aaff', 'D55 torso') : ''}</div>`;
const cards = projects
  .map(
    (p) =>
      `<section><h2>${esc(p.character + ' ' + p.direction + (p.temporary ? ' TEMP' : ''))}</h2><p>${esc(p.project)}</p>${p.cells
        .filter((c) => !c.d41Exempt && c.category !== 'pass')
        .map(
          (c) =>
            `<article><h3>${esc(c.clip)} local${c.cell}: ${esc(c.category)}</h3><p>old ${c.old.head.toFixed(4)} / ${c.old.torso.toFixed(4)}; new ${c.fresh ? c.fresh.head.toFixed(4) + ' / ' + c.fresh.torso.toFixed(4) : esc(c.error)}; ${esc(c.method)} ${esc(c.headKind ?? '')}. Other hard gates: ${esc(c.otherHard.join(',') || 'none')}.</p><div class="pair">${visual(p.masterImage, c.oldCrops, c.crops, 'master')}${visual(c.image!, c.oldCrops, c.crops, 'frame')}</div></article>`,
        )
        .join('')}</section>`,
  )
  .join('');
writeFileSync(
  htmlOut,
  `<!doctype html><!-- vgtd-similarity-crop-audit --><html><meta charset="utf-8"><title>D55 old/new crop audit</title><style>body{font:15px system-ui;background:#141a23;color:#e8edf6;margin:24px}h1,h2{color:#7df0da}section{border-top:1px solid #465266;margin-top:28px}article{display:inline-block;vertical-align:top;border:1px solid #465266;margin:8px;padding:12px;max-width:540px}.pair{display:flex;gap:8px}.image{position:relative;width:256px;height:256px;background:#293140}.image img{image-rendering:pixelated}p{max-width:1000px}a{color:#7df0da}</style><h1>D55 old/new similarity crop audit</h1><p>${esc(audit.policy)}</p><p>Threshold ${audit.threshold}; red/orange = old head/torso; cyan/blue = new head/torso. Left master, right actual aligned cell. Hover a box for coordinates.</p><pre>${esc(JSON.stringify(audit.totals, null, 2))}</pre><a href="${esc(basename(out))}">Full scores, exemptions, input/code hashes and command</a>${cards}</html>`,
  'utf8',
);
console.log(JSON.stringify(audit.totals));
