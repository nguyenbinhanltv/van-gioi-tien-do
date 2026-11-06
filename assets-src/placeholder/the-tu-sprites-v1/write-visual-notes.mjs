import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!['E', 'SE', 'S', 'NE', 'N'].includes(dir)) throw new Error('Expected one drawn direction');
const notes = JSON.parse(readFileSync(path.join(base, dir, 'quality-visual-notes.json'), 'utf8'));
const target = path.join(base, dir, 'quality-backlog.md');
const marker = '<!-- THE-TU-VISUAL-NOTES -->';
const original = readFileSync(target, 'utf8').split(marker)[0].split('\n## Ghi chú quan sát thủ công')[0].trimEnd();
const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [
  marker,
  '## Ghi chú quan sát thủ công',
  '',
  'Các dòng này bổ sung quan sát hình ảnh; không thay thế verdict QA và không cho phép bỏ qua hard gate.',
  '',
  '| Clip | Hướng | Ô (0-based) | Gate | Metric | Value | Limit | Trạng thái | Ghi chú |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...notes.entries.map((entry) =>
    `| ${[entry.clip, entry.dir, entry.cell, entry.gate, entry.metric, entry.value, entry.limit, entry.status, entry.note].map(cell).join(' | ')} |`,
  ),
];
writeFileSync(target, `${original}\n\n${lines.join('\n')}\n`, 'utf8');
