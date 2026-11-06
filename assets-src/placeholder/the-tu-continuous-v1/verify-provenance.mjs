import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const pack = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(pack, '../../..');
const relative = (file) => path.relative(repo, file).split(path.sep).join('/');
const runtime = path.join(repo, 'apps/client-cocos/assets/resources/dragonbones/the-tu-continuous');

function walk(folder) {
  return readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

/** Detect lossy encoding as well as valid UTF-8 containing replacement text or private local paths. */
export function inspectText(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return ['invalid-utf8'];
  }
  const errors = [];
  if (text.includes('\uFFFD')) errors.push('replacement-character');
  const withoutUrls = text.replace(/https?:\/\/\S+/g, '');
  if (/(?:\p{L}\?\p{L}|\?{2,}|Th\? tu)/u.test(withoutUrls)) errors.push('lossy-question-marks');
  if (/\b[A-Za-z]:[\\/]|\/(?:Users|home)\//.test(text)) errors.push('absolute-local-path');
  return errors;
}

function main() {
  const failures = [];
  const licenses = path.join(repo, 'docs/ASSET-LICENSES.md');
  const files = [
    ...walk(pack),
    ...walk(runtime),
    `${runtime}.meta`,
    licenses,
    path.join(repo, 'docs/art/the-tu-continuous.md'),
  ];
  for (const file of files.filter((file) => /\.(?:json|md|mjs|meta)$/.test(file))) {
    for (const error of inspectText(readFileSync(file))) failures.push(`${relative(file)}: ${error}`);
  }
  const log = readFileSync(licenses, 'utf8');
  if (!log.includes('TT1 / tham chiếu upstream Thể tu A')) failures.push('Missing readable upstream heading');
  if (!log.includes('Nguồn do chủ dự án cung cấp, đã lưu đúng byte')) failures.push('Missing readable upstream source');
  if (!log.includes('Prompt upstream đầy đủ:')) failures.push('Missing readable upstream prompt label');

  const manifest = JSON.parse(readFileSync(path.join(pack, 'derived-outputs.json'), 'utf8'));
  const covered = new Set();
  for (const group of manifest.groups) {
    const row = log.split('\n').find((line) => line.startsWith('|') && line.includes(group.id));
    if (!row || !row.includes(group.status) || !/\| no\s*\|$/.test(row.trim())) {
      failures.push(`${group.id}: missing license table row/status/release=no`);
    }
    for (const field of ['source', 'toolModel', 'utc', 'interimOwner']) {
      if (!row?.includes(group[field])) failures.push(`${group.id}: missing license table field ${field}`);
    }
    if (!group.source || !group.toolModel || !group.utc || !group.interimOwner || group.release !== 'no') {
      failures.push(`${group.id}: incomplete provenance fields`);
    }
    for (const file of group.files) {
      covered.add(file.path);
      const hash = createHash('sha256')
        .update(readFileSync(path.join(repo, file.path)))
        .digest('hex');
      if (hash !== file.sha256) failures.push(`${file.path}: provenance SHA256 mismatch`);
    }
  }
  const requested = [
    ...walk(runtime),
    `${runtime}.meta`,
    ...walk(path.join(pack, 'rig')),
    ...['E', 'S', 'SE', 'NE', 'N', 'icons', 'vfx', 'portrait', 'reference', 'keyposes'].flatMap((dir) =>
      walk(path.join(pack, dir)).filter((file) => file.endsWith('.png')),
    ),
  ];
  for (const file of requested)
    if (!covered.has(relative(file))) failures.push(`${relative(file)}: missing license coverage`);
  for (const file of walk(runtime)) {
    if (!/^thetu_(?:E|S|SE|NE|N)_(?:ske\.json|tex\.json|tex\.png)(?:\.meta)?$/.test(path.basename(file))) {
      failures.push(`${relative(file)}: non-runtime file in Cocos resources`);
    }
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      `The tu provenance: UTF-8/privacy/license coverage PASS (${covered.size} derived files); runtime-only resources`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
