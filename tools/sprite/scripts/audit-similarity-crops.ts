/** D55 read-only old/new crop audit. Scores every frame; D41 gate exemptions are labelled separately. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { decodePng, encodePng, createImage, type Image } from '@vgtd/rig';
import {
  isSimilarityExemptReason,
  measureSimilarity,
  runProject,
  SPRITE_SIMILARITY_MIN,
  CELL_PX,
  resizeImage,
  labPaletteDistance,
  measureTemporalSimilarity,
  HEAD_PALETTE_LAB_MAX,
  TORSO_PALETTE_LAB_MAX,
  TEMPORAL_REVIEW_MIN,
  type LabPaletteDistance,
  type Project,
  type SimilarityCropMeasurement,
  type SimilarityFrameHead,
  type HeadLandmarks,
  type RegisteredSsim,
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
const baselinePath = opt('baseline') ? resolve(cwd, opt('baseline')) : undefined;
const baseline = baselinePath
  ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      projects: { project: string; cells: { clip: string; cell: number; status: string }[] }[];
    })
  : undefined;
const sensitivityPath = opt('sensitivity-report') ? resolve(cwd, opt('sensitivity-report')) : undefined;
const controlPath = opt('control-matrix') ? resolve(cwd, opt('control-matrix')) : undefined;
const controlMatrix = controlPath
  ? (JSON.parse(readFileSync(controlPath, 'utf8')) as unknown)
  : { status: 'not supplied' };
const sensitivity = sensitivityPath
  ? (JSON.parse(readFileSync(sensitivityPath, 'utf8')) as {
      threshold: number;
      status: string;
      controls: { name: string; head: number; torso: number; failed: boolean }[];
    })
  : undefined;
if (sensitivity && sensitivity.threshold !== SPRITE_SIMILARITY_MIN) throw new Error('sensitivity threshold mismatch');
const supplementaryInputs = [baselinePath, sensitivityPath, controlPath]
  .filter((p): p is string => p !== undefined)
  .map((file) => ({ file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }));
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
const codeHashes = [
  'tools/sprite/scripts/audit-similarity-crops.ts',
  'tools/sprite/src/qa.ts',
  'tools/sprite/src/similarity-crops.ts',
  'tools/sprite/src/native-similarity.ts',
  'tools/sprite/src/palette-similarity.ts',
  'tools/sprite/src/temporal-similarity.ts',
  'tools/sprite/src/project.ts',
  'tools/sprite/src/repair.ts',
].map((file) => ({ file, sha256: sha(resolve(cwd, file)) }));
const images = out.replace(/\.json$/, '-images');
mkdirSync(images, { recursive: true });
type Scores = { head: number; torso: number };
type Cell = {
  currentHard: { gate: string; metric: string; message: string }[];
  paletteError?: string;
  palette?: { head: LabPaletteDistance; torso: LabPaletteDistance };
  components?: { head: RegisteredSsim; torso: RegisteredSsim };
  annotations?: SimilarityFrameHead;
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
type TemporalPair = {
  review?: 'review-by-eye' | 'ok';
  clip: string;
  from: number;
  to: number;
  loopSeam: boolean;
  d41Exempt: boolean;
  result?: ReturnType<typeof measureTemporalSimilarity>;
  error?: string;
};
const projects: {
  temporal: TemporalPair[];
  masterAnnotations?: HeadLandmarks;
  project: string;
  character: string;
  direction: string;
  temporary: boolean;
  masterImage: string;
  inputs: { file: string; sha256: string }[];
  cells: Cell[];
  self: ReturnType<typeof measureSimilarity>;
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
  const result = runProject(p, base, { includeAlignedFrames: true });
  const nativeMaster = decodePng(readFileSync(resolve(base, p.master)));
  // Match runProject's declared master normalization, never a per-frame scale fit.
  const master =
    nativeMaster.width === CELL_PX && nativeMaster.height === CELL_PX
      ? nativeMaster
      : resizeImage(nativeMaster, CELL_PX, CELL_PX);
  const masterHeight = result.contract.master.metrics.height;
  const prefix = String(index).padStart(2, '0') + '-' + p.character + '-' + p.direction,
    masterImage = prefix + '-master.png';
  writeFileSync(join(images, masterImage), encodePng(master, { premultiplied: true }));
  const cells: Cell[] = [];
  const temporal: TemporalPair[] = [];
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
      const currentHard = result.contract.qa.judged
        .filter(
          (j) =>
            j.verdict === 'fail-hard' &&
            j.finding.clip === clip.name &&
            (j.finding.frame === undefined || j.finding.frame === cell),
        )
        .map((j) => ({ gate: j.finding.gate, metric: j.finding.metric ?? j.finding.gate, message: j.finding.message }));
      let row: Cell;
      try {
        const fresh = measureSimilarity(master, image, {
          masterHeight,
          ...(p.masterHead ? { masterHead: p.masterHead } : {}),
          ...(clip.headEvidence?.[cell] ? { frameHead: clip.headEvidence[cell] } : {}),
        });
        const newFail = fresh.head < SPRITE_SIMILARITY_MIN || fresh.torso < SPRITE_SIMILARITY_MIN;
        let palette: Cell['palette'];
        let paletteError: string | undefined;
        try {
          palette = {
            head: labPaletteDistance(master, image, fresh.crops.master.head, fresh.crops.frame.head),
            torso: labPaletteDistance(master, image, fresh.crops.master.torso, fresh.crops.frame.torso),
          };
        } catch (error) {
          paletteError = String(error);
        }
        const category =
          fresh.crops.method === 'centroid-fallback' && oldFail
            ? 'unresolved-centroid-fallback'
            : fresh.crops.method === 'centroid-fallback' && newFail
              ? 'new-centroid-fallback-failure'
              : oldFail && !newFail
                ? 'resolved-by-anchored-metric'
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
          ...(fresh.components ? { components: fresh.components } : {}),
          ...(palette ? { palette } : { paletteError: paletteError! }),
          method: fresh.crops.method,
          headKind: fresh.crops.frame.headKind,
          category,
          otherHard,
          currentHard,
        };
        if (!row.d41Exempt && (oldFail || newFail || currentHard.some((f) => f.metric.startsWith('palette_')))) {
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
          currentHard,
          oldCrops: old.crops,
        };
      }
      if (clip.headEvidence?.[cell]) row.annotations = clip.headEvidence[cell];
      if (!row.d41Exempt && (row.category !== 'pass' || row.currentHard.some((f) => f.metric.startsWith('palette_')))) {
        row.image = prefix + '-' + clip.name + '-' + cell + '.png';
        writeFileSync(join(images, row.image), encodePng(image, { premultiplied: true }));
      }
      cells.push(row);
    }
    const pairs = aligned.frames.slice(1).map((_, i) => ({ from: i, to: i + 1, loopSeam: false }));
    if (clip.loop && aligned.frames.length > 1) pairs.push({ from: aligned.frames.length - 1, to: 0, loopSeam: true });
    for (const pair of pairs) {
      const entry: TemporalPair = {
        clip: clip.name,
        ...pair,
        d41Exempt:
          isSimilarityExemptReason(clip.exceptions?.[pair.from]) ||
          isSimilarityExemptReason(clip.exceptions?.[pair.to]),
      };
      try {
        entry.result = measureTemporalSimilarity(aligned.frames[pair.from]!, aligned.frames[pair.to]!, {
          masterHeight,
          ...(clip.headEvidence?.[pair.from] ? { firstHead: clip.headEvidence[pair.from] } : {}),
          ...(clip.headEvidence?.[pair.to] ? { secondHead: clip.headEvidence[pair.to] } : {}),
        });
        entry.review = Math.min(entry.result.head, entry.result.torso) < TEMPORAL_REVIEW_MIN ? 'review-by-eye' : 'ok';
      } catch (error) {
        entry.error = String(error);
      }
      temporal.push(entry);
    }
  }
  for (const input of inputs)
    if (sha(input.file) !== input.sha256) throw new Error('input changed during audit: ' + input.file);
  projects.push({
    project: path,
    character: p.character,
    direction: p.direction,
    temporary: extra.includes(path),
    ...(p.masterHead ? { masterAnnotations: p.masterHead } : {}),
    masterImage,
    inputs,
    cells,
    temporal,
    self: measureSimilarity(master, master, {
      masterHeight,
      ...(p.masterHead ? { masterHead: p.masterHead, frameHead: p.masterHead } : {}),
    }),
  });
  const active = cells.filter((c) => !c.d41Exempt);
  console.log(
    `${p.character} ${p.direction}${extra.includes(path) ? ' TEMP' : ''}: ${cells.length} scored, ${active.filter((c) => c.category === 'resolved-by-anchored-metric').length} metric-resolved, ${active.filter((c) => c.category === 'persistent-anchored-failure' || c.category === 'new-anchored-failure').length} anchored failures, ${active.filter((c) => c.category === 'unresolved-centroid-fallback' || c.category === 'new-centroid-fallback-failure').length} fallback failures`,
  );
}
const all = projects.flatMap((p) => p.cells),
  active = all.filter((c) => !c.d41Exempt);
const baselineKeys = new Set(
  baseline?.projects.flatMap((p) =>
    p.cells.filter((c) => c.status === 'fail').map((c) => resolve(cwd, p.project) + '|' + c.clip + '|' + c.cell),
  ) ?? [],
);
const baselineCells = projects.flatMap((p) =>
  p.cells.filter((c) => baselineKeys.has(p.project + '|' + c.clip + '|' + c.cell)),
);
const stats = (numbers: number[]) => {
  const values = [...numbers].sort((a, b) => a - b);
  return {
    n: values.length,
    min: values[0] ?? null,
    max: values.at(-1) ?? null,
    median: values.length
      ? values.length % 2
        ? values[Math.floor(values.length / 2)]!
        : (values[values.length / 2 - 1]! + values[values.length / 2]!) / 2
      : null,
  };
};
const distribution = (cells: Cell[]) => ({
  cells: cells.length,
  old: {
    head: stats(cells.map((c) => c.old.head)),
    torso: stats(cells.map((c) => c.old.torso)),
    minimum: stats(cells.map((c) => Math.min(c.old.head, c.old.torso))),
  },
  fresh: {
    head: stats(cells.flatMap((c) => (c.fresh ? [c.fresh.head] : []))),
    torso: stats(cells.flatMap((c) => (c.fresh ? [c.fresh.torso] : []))),
    minimum: stats(cells.flatMap((c) => (c.fresh ? [Math.min(c.fresh.head, c.fresh.torso)] : []))),
  },
  components: {
    headColour: stats(cells.flatMap((c) => (c.components ? [c.components.head.colour] : []))),
    torsoColour: stats(cells.flatMap((c) => (c.components ? [c.components.torso.colour] : []))),
    headAlpha: stats(cells.flatMap((c) => (c.components ? [c.components.head.alphaIou] : []))),
    torsoAlpha: stats(cells.flatMap((c) => (c.components ? [c.components.torso.alphaIou] : []))),
  },
  lab: {
    head: stats(cells.flatMap((c) => (c.palette ? [c.palette.head.distance] : []))),
    torso: stats(cells.flatMap((c) => (c.palette ? [c.palette.torso.distance] : []))),
    headChroma: stats(cells.flatMap((c) => (c.palette ? [c.palette.head.chroma] : []))),
    torsoChroma: stats(cells.flatMap((c) => (c.palette ? [c.palette.torso.chroma] : []))),
  },
});
const temporalStats = (pairs: TemporalPair[]) => ({
  pairs: pairs.length,
  invalid: pairs.filter((p) => p.error).length,
  head: stats(pairs.flatMap((p) => (p.result ? [p.result.head] : []))),
  torso: stats(pairs.flatMap((p) => (p.result ? [p.result.torso] : []))),
  minimum: stats(pairs.flatMap((p) => (p.result ? [Math.min(p.result.head, p.result.torso)] : []))),
  fallback: pairs.filter((p) => p.result?.crops.method === 'centroid-fallback').length,
  reviewByEye: pairs.filter((p) => p.review === 'review-by-eye').length,
});
const mergedPairs = projects.filter((p) => !p.temporary).flatMap((p) => p.temporal);
const oldPass = (c: Cell) => c.old.head >= SPRITE_SIMILARITY_MIN && c.old.torso >= SPRITE_SIMILARITY_MIN;
const count = (category: string) => active.filter((c) => c.category === category).length;
const audit = {
  format: 'vgtd-similarity-crop-audit',
  version: 1,
  utc: new Date().toISOString(),
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(),
  threshold: SPRITE_SIMILARITY_MIN,
  sensitivity: sensitivity ?? { status: 'not supplied' },
  controlMatrix,
  activePolicy: {
    headLabMax: HEAD_PALETTE_LAB_MAX,
    torsoLabMax: TORSO_PALETTE_LAB_MAX,
    temporalReviewBelow: TEMPORAL_REVIEW_MIN,
    temporal: 'diagnostic; mandatory visual review',
    legacyL1: 'diagnostic',
    scale: 'existing head-size band',
  },
  baselineReevaluation: {
    cells: baselineCells.length,
    paletteFailures: baselineCells.filter((c) => c.currentHard.some((f) => f.metric.startsWith('palette_'))).length,
    headFailures: baselineCells.filter((c) => c.currentHard.some((f) => f.metric.startsWith('head_'))).length,
    anyHardFailures: baselineCells.filter((c) => c.currentHard.length).length,
  },
  supplementaryInputs,
  distributions: {
    baselineFailures: distribution(baselineCells),
    baselineExpected: baselineKeys.size,
    normalAnchored: distribution(active.filter((c) => oldPass(c) && c.method === 'landmarks')),
    normalFallback: distribution(active.filter((c) => oldPass(c) && c.method === 'centroid-fallback')),
    normalAll: distribution(active.filter(oldPass)),
  },
  calibration: {
    redesign: {
      status:
        'Approved D55: Lab palette hard15/23, temporal diagnostic review-by-eye below0.45, existing head-size hard; legacy L1 diagnostic.',
      temporalAll: temporalStats(mergedPairs),
      temporalNonExempt: temporalStats(mergedPairs.filter((p) => !p.d41Exempt)),
      temporalKnownGood: temporalStats(
        mergedPairs.filter((p) => !p.d41Exempt && ['idle', 'walk', 'emote'].includes(p.clip)),
      ),
      temporalAnchoredKnownGood: temporalStats(
        mergedPairs.filter(
          (p) => !p.d41Exempt && ['idle', 'walk', 'emote'].includes(p.clip) && p.result?.crops.method === 'landmarks',
        ),
      ),
      temporalLoops: temporalStats(mergedPairs.filter((p) => !p.d41Exempt && p.loopSeam)),
    },
    poses: ['idle', 'walk', 'emote'],
    status:
      'D55 owner decision: Lab hard15/23; temporal review-by-eye below0.45; static-master SSIM retired; head band unchanged',
    nonExempt: distribution(
      projects
        .filter((p) => !p.temporary)
        .flatMap((p) => p.cells.filter((c) => ['idle', 'walk', 'emote'].includes(c.clip) && !c.d41Exempt)),
    ),
    includingD41: distribution(
      projects
        .filter((p) => !p.temporary)
        .flatMap((p) => p.cells.filter((c) => ['idle', 'walk', 'emote'].includes(c.clip))),
    ),
    anchoredNonExempt: distribution(
      projects
        .filter((p) => !p.temporary)
        .flatMap((p) =>
          p.cells.filter((c) => ['idle', 'walk', 'emote'].includes(c.clip) && !c.d41Exempt && c.method === 'landmarks'),
        ),
    ),
    masterSelf: {
      head: stats(projects.filter((p) => !p.temporary).map((p) => p.self.head)),
      torso: stats(projects.filter((p) => !p.temporary).map((p) => p.self.torso)),
    },
  },
  command: [
    'npm run sprite:audit-similarity-crops -w @vgtd/sprite --',
    '--root',
    sourceRoot,
    ...extra.flatMap((p) => ['--project', p]),
    ...(baselinePath ? ['--baseline', baselinePath] : []),
    ...(sensitivityPath ? ['--sensitivity-report', sensitivityPath] : []),
    ...(controlPath ? ['--control-matrix', controlPath] : []),
    '--out',
    out,
  ].join(' '),
  codeHashes,
  policy:
    'D55 Lab hard15/23; temporal review below0.45 is diagnostic, legacy L1/static-master SSIM diagnostic; alpha IoU diagnostic. Translation-only +/-3px, no scale/rotation fit. Windows are not evidence. Same aligned pixels, no art/export/backlog edits, no annotation synthesis. Score all frames regardless of D41 exemption, but label those separately. Metric-resolved is not proof that other gates pass. Persistent/new anchored failures require native source/annotation review before being called genuine drift. Centroid fallback is measured but cannot diagnose missing-landmark crop artifacts.',
  totals: {
    projects: projects.length,
    scored: all.length,
    d41Exempt: all.filter((c) => c.d41Exempt).length,
    centroidFallback: all.filter((c) => c.method === 'centroid-fallback').length,
    resolvedByMetric: count('resolved-by-anchored-metric'),
    persistentAnchored: count('persistent-anchored-failure'),
    newAnchored: count('new-anchored-failure'),
    unresolvedFallback: count('unresolved-centroid-fallback'),
    newFallback: count('new-centroid-fallback-failure'),
    invalid: count('invalid-window'),
    invalidIncludingD41: all.filter((c) => c.category === 'invalid-window').length,
    paletteUnavailable: all.filter((c) => c.paletteError).length,
    paletteUnavailableNonExempt: active.filter((c) => c.paletteError).length,
    mergedPaletteHardCells: projects
      .filter((p) => !p.temporary)
      .flatMap((p) => p.cells)
      .filter((c) => c.currentHard.some((f) => f.metric.startsWith('palette_'))).length,
  },
  projects,
};
for (const input of supplementaryInputs)
  if (sha(input.file) !== input.sha256) throw new Error('supplementary audit input changed');
for (const code of codeHashes)
  if (sha(resolve(cwd, code.file)) !== code.sha256)
    throw new Error('audit code changed during evaluation: ' + code.file);
writeFileSync(out, JSON.stringify(audit, null, 2) + '\n', 'utf8');
const box = (b: { left: number; top: number; right: number; bottom: number }, color: string, label: string) =>
  `<span title="${esc(label + ' ' + JSON.stringify(b))}" style="position:absolute;left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;border:1px solid ${color};box-sizing:border-box"></span>`;
const marks = (value: unknown, label = ''): string => {
  if (!value || typeof value !== 'object') return '';
  const data = value as Record<string, unknown>;
  if (typeof data.x === 'number' && typeof data.y === 'number')
    return `<i title="${esc(label + ' ' + data.x + ',' + data.y)}" style="position:absolute;left:${data.x - 2}px;top:${data.y - 2}px;width:4px;height:4px;background:#fff454;border-radius:50%"></i>`;
  return Object.entries(data)
    .map(([key, v]) => marks(v, label ? label + '.' + key : key))
    .join('');
};
const visual = (
  file: string,
  old: SimilarityCropMeasurement | undefined,
  fresh: SimilarityCropMeasurement | undefined,
  side: 'master' | 'frame',
  annotations?: SimilarityFrameHead,
) =>
  `<div class="image"><img src="${esc(basename(images) + '/' + file)}" width="256" height="256">${old ? box(old[side].head, '#ff6050', 'D54 legacy head') + box(old[side].torso, '#ffb040', 'D54 torso') : ''}${fresh ? box(fresh[side].head, '#40f0de', 'D55 ' + fresh[side].headKind) + box(fresh[side].torso, '#80aaff', 'D55 torso') : ''}${marks(annotations)}</div>`;
const cards = projects
  .map(
    (p) =>
      `<section><h2>${esc(p.character + ' ' + p.direction + (p.temporary ? ' TEMP' : ''))}</h2><p>${esc(p.project)}</p>${p.cells
        .filter((c) => !c.d41Exempt && c.category !== 'pass')
        .map(
          (c) =>
            `<article><h3>${esc(c.clip)} local${c.cell}: ${esc(c.category)}</h3><p>old ${c.old.head.toFixed(4)} / ${c.old.torso.toFixed(4)}; new ${c.fresh ? c.fresh.head.toFixed(4) + ' / ' + c.fresh.torso.toFixed(4) : esc(c.error)}; ${esc(c.method)} ${esc(c.headKind ?? '')}. Other hard gates: ${esc(c.otherHard.join(',') || 'none')}.</p><div class="pair">${visual(p.masterImage, c.oldCrops, c.crops, 'master', p.masterAnnotations)}${visual(c.image!, c.oldCrops, c.crops, 'frame', c.annotations)}</div></article>`,
        )
        .join('')}</section>`,
  )
  .join('');
writeFileSync(
  htmlOut,
  `<!doctype html><!-- vgtd-similarity-crop-audit --><html><meta charset="utf-8"><title>D55 old/new crop audit</title><style>body{font:15px system-ui;background:#141a23;color:#e8edf6;margin:24px}h1,h2{color:#7df0da}section{border-top:1px solid #465266;margin-top:28px}article{display:inline-block;vertical-align:top;border:1px solid #465266;margin:8px;padding:12px;max-width:540px}.pair{display:flex;gap:8px}.image{position:relative;width:256px;height:256px;background:#293140}.image img{image-rendering:pixelated}p{max-width:1000px}a{color:#7df0da}</style><h1>D55 identity and temporal diagnostics</h1><p>Active D55: A Lab palette hard15/23; C head-size hard. B temporal below0.45 is review-by-eye INFO plus mandatory contact-sheet review. Legacy L1 and static-master SSIM are diagnostic only. The static-SSIM cards below are the retired experiment; current hard results and original33 re-evaluation are in the active policy data.</p><h2>Active policy and D54 re-evaluation</h2><pre>${esc(JSON.stringify({ policy: audit.activePolicy, original33: audit.baselineReevaluation }, null, 2))}</pre><p><a href="${esc(basename(out).replace(/\.json$/, '-palette-findings.html'))}">Owner inspection: merged Lab hard findings and exact crops</a></p><h2>A/B/C control matrix</h2><pre>${esc(JSON.stringify(audit.controlMatrix, null, 2))}</pre><h2>Sensitivity acceptance</h2><pre>${esc(JSON.stringify(audit.sensitivity, null, 2))}</pre><p><a href="similarity-sensitivity.html">Sensitivity control images</a></p><p>${esc(audit.policy)}</p><p>Historical L1/static-SSIM diagnostic threshold ${audit.threshold}; red/orange = old head/torso; cyan/blue = new head/torso; yellow points = actual stored annotations. Left master, right actual aligned cell. Hover a box for coordinates.</p><pre>${esc(JSON.stringify(audit.totals, null, 2))}</pre><h2>Known-good calibration (provisional)</h2><pre>${esc(JSON.stringify(audit.calibration, null, 2))}</pre><h2>Old/new distributions</h2><pre>${esc(JSON.stringify(audit.distributions, null, 2))}</pre><a href="${esc(basename(out))}">Full scores, exemptions, input/code hashes and command</a>${cards}</html>`,
  'utf8',
);
console.log(JSON.stringify(audit.totals));

// Dedicated owner-inspection artifact: exact pixel crops, never fitted/rescaled production frames.
const palettePage = out.replace(/\.json$/, '-palette-findings.html');
const paletteJson = out.replace(/\.json$/, '-palette-findings.json');
if (existsSync(palettePage) && !readFileSync(palettePage, 'utf8').includes('<!-- vgtd-palette-findings -->'))
  throw new Error('unrelated palette HTML output');
if (existsSync(paletteJson) && JSON.parse(readFileSync(paletteJson, 'utf8')).format !== 'vgtd-palette-findings')
  throw new Error('unrelated palette JSON output');
const cut = (image: Image, box: { left: number; top: number; right: number; bottom: number }) => {
  const x = Math.max(0, Math.floor(box.left)),
    y = Math.max(0, Math.floor(box.top));
  const w = Math.max(1, Math.min(image.width, Math.ceil(box.right)) - x),
    h = Math.max(1, Math.min(image.height, Math.ceil(box.bottom)) - y);
  const crop = createImage(w, h);
  for (let row = 0; row < h; row++)
    crop.data.set(
      image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + w) * 4),
      row * w * 4,
    );
  return crop;
};
const paletteFindings = projects
  .filter((p) => !p.temporary)
  .flatMap((p) =>
    p.cells
      .filter((c) => c.currentHard.some((f) => f.metric === 'palette_head_lab' || f.metric === 'palette_torso_lab'))
      .map((c) => {
        if (!c.image || !c.crops || !c.palette) throw new Error('missing palette finding inspection data');
        const master = decodePng(readFileSync(join(images, p.masterImage))),
          frame = decodePng(readFileSync(join(images, c.image)));
        const parts = (['head', 'torso'] as const).filter((part) =>
          c.currentHard.some((f) => f.metric === `palette_${part}_lab`),
        );
        const crops = parts.map((part) => {
          const a = cut(master, c.crops!.master[part]),
            b = cut(frame, c.crops!.frame[part]);
          const masterFile = c.image!.replace('.png', `-palette-${part}-master.png`),
            frameFile = c.image!.replace('.png', `-palette-${part}-cell.png`);
          writeFileSync(join(images, masterFile), encodePng(a, { premultiplied: true }));
          writeFileSync(join(images, frameFile), encodePng(b, { premultiplied: true }));
          return {
            part,
            masterFile,
            frameFile,
            masterBox: c.crops!.master[part],
            frameBox: c.crops!.frame[part],
            masterWidth: a.width,
            masterHeight: a.height,
            frameWidth: b.width,
            frameHeight: b.height,
            masterSha256: sha(join(images, masterFile)),
            frameSha256: sha(join(images, frameFile)),
          };
        });
        return {
          project: p.project,
          character: p.character,
          direction: p.direction,
          clip: c.clip,
          cell: c.cell,
          palette: c.palette,
          hard: c.currentHard,
          masterImage: p.masterImage,
          frameImage: c.image,
          crops,
        };
      }),
  );
writeFileSync(
  paletteJson,
  JSON.stringify(
    { format: 'vgtd-palette-findings', audit: basename(out), policy: audit.activePolicy, findings: paletteFindings },
    null,
    2,
  ) + '\n',
  'utf8',
);
const cropImg = (file: string, w: number, h: number) =>
  `<img src="${esc(basename(images) + '/' + file)}" width="${w * 3}" height="${h * 3}">`;
writeFileSync(
  palettePage,
  `<!doctype html><!-- vgtd-palette-findings --><html><meta charset="utf-8"><title>D55 palette hard findings</title><style>body{font:16px system-ui;background:#18202c;color:#eef3fa;margin:28px}article{border-top:1px solid #59687c;margin:24px 0;padding:18px 0}.pair{display:flex;gap:20px;align-items:flex-start}img{image-rendering:pixelated;background:#303a4b}pre{white-space:pre-wrap}a{color:#7de3cf}</style><h1>D55: ${paletteFindings.length} merged palette hard failures</h1><p>Head ceiling15 / torso23. Rebuild-blocking until repaired or justified by a follow-up owner decision. No art or annotations were changed. Left master, right aligned cell. Crops are exact source pixels (floor/ceil window bounds), displayed3x uniformly; production frames are never fitted.</p><a href="${esc(basename(paletteJson))}">Coordinates, hashes and values</a>${paletteFindings.map((f) => `<article><h2>${esc(f.character + ' ' + f.direction + ' ' + f.clip + ' local' + f.cell)}</h2><div class="pair">${cropImg(f.masterImage, 256 / 3, 256 / 3)}${cropImg(f.frameImage, 256 / 3, 256 / 3)}</div>${f.crops.map((c) => `<h3>${esc(c.part)}: Lab ${f.palette[c.part].distance.toFixed(6)}</h3><div class="pair">${cropImg(c.masterFile, c.masterWidth, c.masterHeight)}${cropImg(c.frameFile, c.frameWidth, c.frameHeight)}</div><pre>${esc(JSON.stringify({ master: c.masterBox, cell: c.frameBox }, null, 2))}</pre>`).join('')}</article>`).join('')}</html>`,
  'utf8',
);
