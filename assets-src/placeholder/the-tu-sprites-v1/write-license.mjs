import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const direction = process.argv[2] ?? 'E';
if (!['E', 'SE', 'S', 'NE', 'N'].includes(direction)) throw new Error('Expected one drawn direction');
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), direction);
const repo = path.resolve(base, '../../../..');
const relative = (file) => path.relative(repo, file).split(path.sep).join('/');
function walk(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(folder, e.name);
    return e.isDirectory() ? walk(file) : [file];
  });
}
const manifestFile = path.join(base, 'provenance-index.json');
const recordedAtUtc = new Date().toISOString();
const runtime = path.join(repo, 'apps/client-cocos/assets/resources/dragonbones/the-tu-sprites');
const status = 'AI-generated, placeholder, needs hand-polish + license review before release';
const root = relative(base);
const specifications = [
  {
    id: `THES-${direction}-GEN`,
    glob: `${root}/raw/*`,
    source:
      'Original image_gen outputs, adjacent full prompt/UTC/image-ID records; deterministic recovery repair proof',
    files: walk(path.join(base, 'raw')),
  },
  {
    id: `THES-${direction}-SHEET`,
    glob: `${root}/sheets/*; ${root}/templates/*; ${root}/qa-templates/*`,
    source: `THES-${direction}-GEN; public @vgtd/sprite template and cell-local repair; frozen character calibration`,
    files: [
      ...walk(path.join(base, 'sheets')),
      ...walk(path.join(base, 'templates')),
      ...walk(path.join(base, 'qa-templates')),
    ],
  },
  {
    id: `THES-${direction}-QA`,
    glob: `${root}/*.json; ${root}/quality-backlog.md; ${root}/export/*; assets-src/placeholder/the-tu-sprites-v1/batch-${direction}.json`,
    source: `THES-${direction}-SHEET; project clip-table timing, calibration, quality backlog and sprite export contract`,
    files: [
      ...walk(base).filter((f) => path.dirname(f) === base && /\.(json|md)$/.test(f) && f !== manifestFile),
      ...walk(path.join(base, 'export')),
      path.resolve(base, `../batch-${direction}.json`),
    ],
  },
  {
    id: `THES-${direction}-RUNTIME`,
    glob: `apps/client-cocos/assets/resources/dragonbones/the-tu-sprites/thetu_${direction}_*; apps/client-cocos/assets/resources/dragonbones/the-tu-sprites/thetu_${direction}.sprite.json*; apps/client-cocos/assets/resources/dragonbones/the-tu-sprites.meta`,
    source: `THES-${direction}-SHEET; @vgtd/sprite PMA atlas and DragonBones display-swap exporter, Cocos Creator metadata`,
    files: [
      ...walk(runtime).filter(
        (f) =>
          path.basename(f).startsWith(`thetu_${direction}_`) ||
          path.basename(f).startsWith(`thetu_${direction}.sprite.json`),
      ),
      ...(existsSync(`${runtime}.meta`) ? [`${runtime}.meta`] : []),
    ],
  },
  {
    id: `THES-${direction}-REF`,
    glob: `assets-src/placeholder/the-tu-continuous-v1/reference/${direction}.master4x.png`,
    source: 'Preserved The tu master from PR #113; see upstream concept/master provenance in the same license log',
    files: [path.resolve(base, `../../the-tu-continuous-v1/reference/${direction}.master4x.png`)],
  },
];
const groups = specifications.map((s) => ({
  id: s.id,
  glob: s.glob,
  source: s.source,
  utc: recordedAtUtc,
  toolModel:
    'image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8',
  interimOwner: 'Người dùng (interim art owner)',
  status,
  release: 'no',
  files: s.files
    .sort()
    .map((f) => ({ path: relative(f), sha256: createHash('sha256').update(readFileSync(f)).digest('hex') })),
}));
writeFileSync(
  manifestFile,
  JSON.stringify(
    {
      recordedAtUtc,
      utcMeaning: 'Inventory UTC; original generation times remain in raw metadata',
      indexSelfCoveredBy: `THES-${direction}-QA (no recursive self hash)`,
      groups,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
const start = `<!-- THE-TU-SPRITES-${direction}:START -->`;
const end = `<!-- THE-TU-SPRITES-${direction}:END -->`;
const section = [
  start,
  `## Thể tu ${direction} — sprite sheet từng frame (D41)`,
  'Ảnh gốc giữ đầy đủ prompt/tool/model/CLI/UTC và image ID trong metadata. Không tạo lại mốc UTC chưa đo được; timestamp tệp gốc và thời điểm quan sát kết thúc được ghi riêng. UTC trong bảng dưới là lúc lập inventory, không phải lần sinh ảnh mới. Attribution chưa xác minh; không tuyên bố CC0/MIT cho ảnh. Mọi tệp là placeholder, phát hành `no`.',
  [
    '| Tệp / glob | Nguồn | UTC | Công cụ / mô hình | Chủ art tạm | Trạng thái | Phát hành? |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...groups.map(
      (g) =>
        `| ${g.id}: \`${g.glob}\` | ${g.source} | ${g.utc} | ${g.toolModel} | ${g.interimOwner} | ${g.status} | no |`,
    ),
  ].join('\n'),
  ...walk(path.join(base, 'raw'))
    .filter((f) => f.endsWith('.generation.json'))
    .sort()
    .flatMap((f) => [`### ${path.basename(f)}`, '```json', readFileSync(f, 'utf8').trim(), '```']),
  end,
].join('\n\n');
const fragmentIndex = process.argv.indexOf('--fragment');
if (fragmentIndex >= 0) {
  const target = process.argv[fragmentIndex + 1];
  if (!target) throw new Error('--fragment requires an output path');
  writeFileSync(path.resolve(target), `${section}\n`, 'utf8');
  process.exit(0);
}
const licenseFile = path.join(repo, 'docs/ASSET-LICENSES.md');
const old = readFileSync(licenseFile, 'utf8');
const a = old.indexOf(start);
const b = old.indexOf(end);
writeFileSync(
  licenseFile,
  a >= 0 && b >= a ? old.slice(0, a) + section + old.slice(b + end.length) : old.trimEnd() + '\n\n' + section + '\n',
  'utf8',
);
