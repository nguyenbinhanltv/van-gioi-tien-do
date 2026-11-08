import console from 'node:console';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { inspectText } from '../../the-tu-continuous-v1/verify-provenance.mjs';

export function inspectSpriteText(bytes) {
  const errors = inspectText(bytes);
  if (/[\u00c3\u00c6]|\u00e1\u00bb|\u00e2\u20ac/u.test(Buffer.from(bytes).toString('utf8')))
    errors.push('double-encoded-text');
  return errors;
}

if (process.argv.includes('--self-test')) {
  for (const sample of ['\u00c3', '\u00c6\u00a1', '\u00e1\u00bb', '\u00e2\u20ac']) {
    if (!inspectSpriteText(Buffer.from(sample, 'utf8')).includes('double-encoded-text'))
      throw new Error('Mojibake fixture was not rejected');
  }
  if (inspectSpriteText(Buffer.from('Thể tu A Sơn Môn Hộ Vệ', 'utf8')).length)
    throw new Error('Valid Vietnamese text was rejected');
  console.log('Mojibake guard self-test PASS: 4 corrupt fixtures rejected, valid Vietnamese accepted');
  process.exit(0);
}

const directionIndex = process.argv.indexOf('--dir');
const direction = directionIndex >= 0 ? process.argv[directionIndex + 1] : 'E';
if (!['E', 'SE', 'S', 'NE', 'N'].includes(direction)) throw new Error('Expected one drawn direction');
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', direction);
const repo = path.resolve(base, '../../../..');
function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(folder, e.name);
    return e.isDirectory() ? walk(file) : [file];
  });
}
const failures = [];
const licenseIndex = process.argv.indexOf('--license');
const licenseOverride = licenseIndex >= 0 ? process.argv[licenseIndex + 1] : undefined;
if (licenseIndex >= 0 && !licenseOverride) throw new Error('--license requires a file path');
const log = readFileSync(
  licenseOverride ? path.resolve(licenseOverride) : path.join(repo, 'docs/ASSET-LICENSES.md'),
  'utf8',
);
const section = log.slice(
  log.indexOf(`<!-- THE-TU-SPRITES-${direction}:START -->`),
  log.indexOf(`<!-- THE-TU-SPRITES-${direction}:END -->`),
);
const lines = section.split(/\r?\n/);
const tableHeader = lines.findIndex((line) => line.startsWith('|') && line.includes('Phát hành?'));
if (tableHeader < 0 || !/^\|(?:\s*[-:]+\s*\|){7}$/.test(lines[tableHeader + 1] || ''))
  failures.push('License file table must have a contiguous Markdown header/separator');
for (const file of [
  ...walk(base),
  path.join(repo, 'docs/art/the-tu.md'),
  path.join(repo, 'docs/ASSET-LICENSES.md'),
].filter((f) => /\.(json|md|ts|mjs)$/.test(f))) {
  for (const error of inspectSpriteText(readFileSync(file))) {
    if (error === 'lossy-question-marks' && /\.(ts|mjs)$/.test(file)) continue;
    failures.push(`${path.relative(repo, file)}: ${error}`);
  }
}
const inventory = JSON.parse(readFileSync(path.join(base, 'provenance-index.json'), 'utf8'));
const project = JSON.parse(readFileSync(path.join(base, 'project.json'), 'utf8'));
const frozen = JSON.parse(readFileSync(path.join(base, 'calibration.json'), 'utf8'));
const contract = JSON.parse(readFileSync(path.join(base, `export/thetu_${direction}.sprite.json`), 'utf8'));
for (const clip of project.clips) {
  const png = readFileSync(path.join(base, clip.sheet));
  const cellHeight = png.readUInt32BE(20) / Math.ceil(clip.frames / clip.cols);
  if (Math.abs(clip.calibration.referenceHeight / cellHeight - frozen.normalizedReferenceHeight) > 1e-10)
    failures.push(`${clip.name}: sheet DPI diverges from frozen character scale`);
  const exported = contract.clips.find((c) => c.name === clip.name);
  if (!exported || Math.abs(exported.calibration.referenceHeight - clip.calibration.referenceHeight) > 1e-10)
    failures.push(`${clip.name}: export calibration mismatch`);
}
const covered = new Set();
for (const group of inventory.groups) {
  const row = log.split('\n').find((line) => line.startsWith('|') && line.includes(group.id));
  for (const key of ['source', 'utc', 'toolModel', 'interimOwner', 'status']) {
    if (!row?.includes(group[key])) failures.push(`${group.id}: missing ${key}`);
  }
  if (group.release !== 'no' || !/\| no\s*\|$/.test(row || '')) failures.push(`${group.id}: release must be no`);
  for (const file of group.files) {
    covered.add(file.path);
    if (
      createHash('sha256')
        .update(readFileSync(path.join(repo, file.path)))
        .digest('hex') !== file.sha256
    )
      failures.push(`${file.path}: hash mismatch`);
  }
}
for (const file of walk(base).filter((f) => f.endsWith('.png'))) {
  const key = path.relative(repo, file).split(path.sep).join('/');
  if (!covered.has(key)) failures.push(`${key}: missing license coverage`);
}
for (const file of walk(path.join(repo, 'apps/client-cocos/assets/resources/dragonbones/the-tu-sprites'))) {
  if (
    !path.basename(file).startsWith(`thetu_${direction}_`) &&
    !path.basename(file).startsWith(`thetu_${direction}.sprite.json`)
  )
    continue;
  if (!/^thetu_(E|SE|S|NE|N)(?:_(?:ske\.json|tex\.json|tex\.png)|\.sprite\.json)(\.meta)?$/.test(path.basename(file)))
    failures.push(`${file}: non-runtime authoring file in resources`);
}
for (const file of walk(base).filter((f) => f.endsWith('.generation.json'))) {
  const m = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['prompt', 'tool', 'model', 'cli', 'utcStart', 'originalImageId'])
    if (!m[key]) failures.push(`${file}: missing ${key}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(`The tu ${direction} provenance PASS: ${covered.size} files, full prompts/UTF-8/privacy/license hashes`);
