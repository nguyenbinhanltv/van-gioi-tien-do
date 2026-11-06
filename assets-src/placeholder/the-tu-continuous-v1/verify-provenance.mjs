import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const pack = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(pack, '../../..');
const relative = (file) => path.relative(repo, file).split(path.sep).join('/');
function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

/** Validate UTF-8 text without depending on any character or rig format. */
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
  const files = walk(pack);
  const licenses = readFileSync(path.join(repo, 'docs/ASSET-LICENSES.md'), 'utf8');
  for (const file of [
    ...files,
    path.join(repo, 'docs/ASSET-LICENSES.md'),
    path.join(repo, 'docs/art/the-tu-shared-art.md'),
  ]) {
    if (!/\.(?:json|md|mjs)$/.test(file)) continue;
    for (const error of inspectText(readFileSync(file))) failures.push(`${relative(file)}: ${error}`);
  }
  const manifest = JSON.parse(readFileSync(path.join(pack, 'derived-outputs.json'), 'utf8'));
  const covered = new Set();
  for (const group of manifest.groups) {
    const row = licenses.split('\n').find((line) => line.startsWith('|') && line.includes(group.id));
    for (const field of ['source', 'toolModel', 'utc', 'interimOwner', 'status']) {
      if (!group[field] || !row?.includes(group[field])) failures.push(`${group.id}: missing ${field}`);
    }
    if (group.release !== 'no' || !/\| no\s*\|$/.test(row?.trim() || ''))
      failures.push(`${group.id}: release must be no`);
    for (const file of group.files) {
      covered.add(file.path);
      const hash = createHash('sha256')
        .update(readFileSync(path.join(repo, file.path)))
        .digest('hex');
      if (hash !== file.sha256) failures.push(`${file.path}: SHA256 mismatch`);
    }
  }
  for (const file of files.filter((file) => file.endsWith('.png'))) {
    if (!covered.has(relative(file))) failures.push(`${relative(file)}: missing license coverage`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`The tu shared art: UTF-8/privacy/license PASS (${covered.size} inventoried files)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
