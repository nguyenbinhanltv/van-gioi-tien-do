/** Audit the separate S source/provenance register without rewriting the locked E record. */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const dir = resolve(root, 'S');
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const files = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(resolve(folder, e.name)) : [resolve(folder, e.name)],
  );
for (const file of files(resolve(dir, 'raw')).filter((p) => p.endsWith('.generation.json'))) {
  const entry = JSON.parse(readFileSync(file, 'utf8'));
  const name = file.split(/[\\/]/).at(-1)!;
  const clip = name.split('.attempt')[0]!;
  const selection = JSON.parse(readFileSync(resolve(dir, 'selection.json'), 'utf8'));
  const chosen = selection.attempts[clip] ?? selection.defaultAttempt;
  const selected = Number(name.match(/attempt(\d+)/)![1]) === chosen;
  entry.raw = 'raw/' + name.replace('.generation.json', '.png');
  entry.rawSha256 = hash(resolve(dir, entry.raw));
  entry.utcStart ??= entry.start?.current_time;
  entry.utcRawOutputFileModified ??= statSync(resolve(dir, entry.raw)).mtime.toISOString();
  entry.referenceSnapshots = entry.references.map((p: string) => {
    const path = p.startsWith('templates/') ? 'S/' + p : p;
    return { file: path, sha256: hash(resolve(root, path)) };
  });
  if (!selected) {
    delete entry.selected;
    delete entry.selectedSha256;
    entry.status = 'not selected; retained raw provenance and selection.json rationale';
  } else {
    entry.selected = 'sheets/' + clip + '.png';
    entry.selectedSha256 = hash(resolve(dir, entry.selected));
    if (entry.selectedSha256 !== entry.rawSha256) throw Error('Selected raw hash mismatch: ' + file);
    entry.status = 'selected source; hard sprite gates passed; engine capture recorded separately';
  }
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n');
}
const pngs = files(dir)
  .filter((p) => p.endsWith('.png'))
  .map((file) => ({
    file: relative(root, file).replaceAll('\\', '/'),
    sha256: hash(file),
    bytes: statSync(file).size,
  }));
const runtime = resolve('apps/client-cocos/assets/resources/dragonbones/phap-tu-chibi-v1');
const runtimeFiles = existsSync(runtime)
  ? files(runtime).filter((p) => /^phaptuchibi_S[._]/.test(p.split(/[\\/]/).at(-1)!))
  : [];
const provenance = {
  direction: 'S',
  tool: 'image_gen.imagegen',
  model: 'undisclosed',
  rights: 'Original project art; OpenAI output ownership terms checked in worker25 ASSET-LICENSES section',
  master: {
    file: 'reference/S.master.png',
    sha256: hash(resolve(root, 'reference/S.master.png')),
    anatomicalHeight2x: 216,
  },
  profile: 'smooth-v2',
  frames: 202,
  clips: 15,
  files: pngs,
  runtimeAssets: runtimeFiles.map((file) => ({
    file: relative(resolve('.'), file).replaceAll('\\', '/'),
    sha256: hash(file),
  })),
  generationRecords: 'raw/*.generation.json',
  headReview: 'head-landmarks.review.json',
  engineGate: 'engine-gate.json',
};
writeFileSync(resolve(dir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
const license = resolve('docs/ASSET-LICENSES.md'),
  marker = '<!-- PHAP-TU-CHIBI-S:BEGIN -->';
const rows = [
  ...pngs.map((p) => ({
    file: 'assets-src/placeholder/phap-tu-chibi-v1/' + p.file,
    source: p.file.includes('/templates/')
      ? 'Dẫn xuất xác định từ master; lattice và stencil không đổi cỡ đầu'
      : 'Ảnh gốc dự án; OpenAI imagegen tạo hoặc sửa',
  })),
  ...runtimeFiles.map((file) => ({
    file: relative(resolve('.'), file).replaceAll('\\', '/'),
    source: 'Pipeline dự án / Cocos Creator 3.8.8',
  })),
];
if (!readFileSync(license, 'utf8').includes(marker))
  appendFileSync(
    license,
    '\n' +
      marker +
      '\n\n### Pháp tu semi-chibi S — worker 25\n\nThiết kế gốc dự án, không dùng ảnh thương mại. Quyền đầu ra OpenAI theo điều khoản đã kiểm tra ở mục worker 25; không yêu cầu ghi công. Công cụ `image_gen.imagegen`, model không công bố; prompt, UTC và SHA nằm ở `S/raw/*.generation.json` và `S/provenance.json`. Các bản bị thay thế được giữ để truy vết, không dùng ở runtime. Stencil chỉ hướng dẫn sinh ảnh; cổng D47 vẫn đo từng ô cần bằng chứng.\n\n| Tệp | Nguồn | Quyền |\n| --- | --- | --- |\n' +
      rows.map((r) => '| `' + r.file + '` | ' + r.source + ' | Quyền gốc dự án / đầu ra OpenAI nêu trên |').join('\n') +
      '\n\n<!-- PHAP-TU-CHIBI-S:END -->\n',
  );
else
  for (const row of rows)
    if (!readFileSync(license, 'utf8').includes('`' + row.file + '`'))
      throw Error('Missing per-file rights row: ' + row.file);
console.log(`S audited ${pngs.length} PNGs and ${runtimeFiles.length} runtime files`);
