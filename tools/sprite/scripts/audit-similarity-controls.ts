/** D55 reproducible negative-control matrix. No production assets or annotations are written. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  landmarkSimilarityRegions,
  measureFigure,
  labPaletteDistance,
  measureTemporalSimilarity,
  alignFrame,
  toStraight,
  guidesFromMaster,
  runQa,
  resizeImage,
  CELL_PX,
  HEAD_PALETTE_LAB_MAX,
  TORSO_PALETTE_LAB_MAX,
  TEMPORAL_REVIEW_MIN,
  type Project,
  type FrontHeadLandmarks,
} from '../src/index.js';
import { makeSimilarityControls } from './similarity-controls.js';
const args = process.argv.slice(2),
  cwd = process.env.INIT_CWD ?? process.cwd();
const opt = (key: string, fallback = '') => {
  const i = args.indexOf('--' + key);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
if (!opt('out').endsWith('.json'))
  throw new Error('usage: --out <report.json> [--master-project <json>] [--donor-project <json>]');
const out = resolve(cwd, opt('out')),
  images = out.replace(/\.json$/, '-images'),
  page = out.replace(/\.json$/, '.html');
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const load = (path: string) => {
  const file = resolve(cwd, path),
    p = JSON.parse(readFileSync(file, 'utf8')) as Project;
  if (p.masterHead?.kind && p.masterHead.kind !== 'crown-chin') throw new Error('controls require a front master');
  if (!p.masterHead) throw new Error('controls require reviewed master landmarks');
  const png = resolve(dirname(file), p.master),
    raw = decodePng(readFileSync(png));
  const image = raw.width === CELL_PX && raw.height === CELL_PX ? raw : resizeImage(raw, CELL_PX, CELL_PX);
  return {
    p,
    file,
    png,
    image,
    inputs: [
      { file, sha256: sha(file) },
      { file: png, sha256: sha(png) },
    ],
  };
};
const master = load(opt('master-project', 'assets-src/placeholder/the-tu-chibi-v1/E/project.json'));
const donor = load(opt('donor-project', 'assets-src/placeholder/dan-phu-tu-chibi-v1/E/project.json'));
for (const source of [dirname(master.file), dirname(donor.file), dirname(master.png), dirname(donor.png)]) {
  const r = relative(source, out);
  if (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r))
    throw new Error('control output must be outside inputs');
}
if (existsSync(out) && JSON.parse(readFileSync(out, 'utf8')).format !== 'vgtd-identity-temporal-controls')
  throw new Error('unrelated JSON output');
if (existsSync(page) && !readFileSync(page, 'utf8').includes('<!-- vgtd-identity-temporal-controls -->'))
  throw new Error('unrelated HTML output');
mkdirSync(images, { recursive: true });
const height = measureFigure(master.image)!.height,
  windows = landmarkSimilarityRegions(master.image, master.p.masterHead!, height);
const controls = makeSimilarityControls(
  master.image,
  donor.image,
  windows,
  landmarkSimilarityRegions(donor.image, donor.p.masterHead!, measureFigure(donor.image)!.height),
);
const hue = { ...master.image, data: new Uint8ClampedArray(master.image.data) };
for (let y = Math.ceil(windows.head.top); y < Math.ceil(windows.head.bottom); y++)
  for (let x = Math.ceil(windows.head.left); x < Math.ceil(windows.head.right); x++) {
    const i = (y * hue.width + x) * 4,
      r = hue.data[i]!,
      g = hue.data[i + 1]!,
      b = hue.data[i + 2]!;
    hue.data.set([b, r, g], i);
  }
const all = [...controls, { name: 'hue-head', image: hue }];
const rows = all.map((c) => {
  const head = labPaletteDistance(master.image, c.image, windows.head, windows.head),
    torso = labPaletteDistance(master.image, c.image, windows.torso, windows.torso);
  const options = { masterHeight: height, firstHead: master.p.masterHead!, secondHead: master.p.masterHead! };
  const incoming = measureTemporalSimilarity(master.image, c.image, options),
    outgoing = measureTemporalSimilarity(c.image, master.image, options);
  let scale: unknown = null;
  if (c.name === 'head-scale-85') {
    const t = controls.find((c) => c.name === 'head-scale-85')!.headTransform!,
      guides = guidesFromMaster(measureFigure(master.image)!);
    const frame = alignFrame(toStraight(c.image), {
      guides,
      calibration: { scale: 1, targetHeight: height, referenceHeight: height, referenceFrames: 1 },
    })!;
    const h = master.p.masterHead! as FrontHeadLandmarks;
    const point = (p: { x: number; y: number }) => ({
      x: p.x * t.sx + t.dx + frame.record.dx,
      y: p.y * t.sy + t.dy + frame.record.dy,
    });
    const qa = runQa(
      [
        {
          name: 'idle',
          kind: 'upright',
          loop: false,
          expectedFrames: 1,
          frames: [frame],
          heightPolicy: 'head-size-v1',
          headEvidence: {
            0: {
              crown: point(h.crown),
              chin: point(h.chin),
              note: 'Synthetic constructed patch geometry, never production evidence',
            },
          },
        },
      ],
      { master: master.image, masterHeight: height, masterHead: h, guides },
    );
    scale = { qaOk: qa.ok, headFindings: qa.findings.filter((f) => f.metric === 'head_size_px') };
    if (!qa.findings.some((f) => f.metric === 'head_size_px' && f.severity === 'fail'))
      throw new Error('85% synthetic control was not rejected by the head-size gate');
  }
  const file = basename(images) + '/' + c.name + '.png';
  writeFileSync(resolve(dirname(out), file), encodePng(c.image, { premultiplied: true }));
  return {
    name: c.name,
    designated:
      c.name === 'head-scale-85' ? 'C head-size' : c.name === 'mirrored-head' ? 'B temporal' : 'A Lab palette',
    file,
    palette: { head, torso },
    temporal: { incoming, outgoing },
    scale,
    outcome:
      head.distance > HEAD_PALETTE_LAB_MAX || torso.distance > TORSO_PALETTE_LAB_MAX
        ? 'hard-reject: Lab identity'
        : scale
          ? 'hard-reject: head-size'
          : Math.min(incoming.head, incoming.torso, outgoing.head, outgoing.torso) < TEMPORAL_REVIEW_MIN
            ? 'review-by-eye: temporal flag plus mandatory contact-sheet review'
            : 'not rejected or flagged',
  };
});
const inputs = [...master.inputs, ...donor.inputs];
for (const input of inputs) if (sha(input.file) !== input.sha256) throw new Error('control input changed');
const report = {
  format: 'vgtd-identity-temporal-controls',
  utc: new Date().toISOString(),
  status:
    'D55 approved: A hard Lab ceilings15/23; B diagnostic review-by-eye below0.45 plus mandatory contact-sheet review; C head-size hard. Legacy L1 diagnostic. Synthetic sequence, not production evidence.',
  policy: {
    headLabMax: HEAD_PALETTE_LAB_MAX,
    torsoLabMax: TORSO_PALETTE_LAB_MAX,
    temporalReviewBelow: TEMPORAL_REVIEW_MIN,
  },
  command: [
    'npm run sprite:audit-similarity-controls -w @vgtd/sprite --',
    '--master-project',
    master.file,
    '--donor-project',
    donor.file,
    '--out',
    out,
  ].join(' '),
  inputs,
  controls: rows,
};
writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');
const esc = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
writeFileSync(
  page,
  `<!doctype html><!-- vgtd-identity-temporal-controls --><html><meta charset="utf-8"><title>D55 control matrix</title><style>body{font:16px system-ui;background:#18202c;color:#eef3fa;margin:28px}table{border-collapse:collapse}td,th{padding:12px;border:1px solid #566477}a{color:#7de3cf}img{width:256px;image-rendering:pixelated;background:#30394a}pre{white-space:pre-wrap}</style><h1>D55 A/B/C control matrix</h1><p>${esc(report.status)}</p><table><tr><th>Control</th><th>Designated check</th><th>Lab head / torso</th><th>Temporal head / torso</th><th>Decision</th></tr>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.designated)}</td><td>${r.palette.head.distance.toFixed(4)} / ${r.palette.torso.distance.toFixed(4)}</td><td>${r.temporal.incoming.head.toFixed(4)} / ${r.temporal.incoming.torso.toFixed(4)}</td><td>${esc(r.outcome)}</td></tr>`).join('')}</table>${rows.map((r) => `<h2>${esc(r.name)}</h2><img src="${esc(r.file)}"><pre>${esc(JSON.stringify(r.scale ?? r.palette, null, 2))}</pre>`).join('')}<p><a href="${esc(basename(out))}">Exact values, windows, source hashes and command</a></p></html>`,
  'utf8',
);
console.log(
  JSON.stringify(
    rows.map((r) => ({
      name: r.name,
      headLab: r.palette.head.distance,
      torsoLab: r.palette.torso.distance,
      temporalHead: r.temporal.incoming.head,
      scale: r.scale,
    })),
  ),
);
