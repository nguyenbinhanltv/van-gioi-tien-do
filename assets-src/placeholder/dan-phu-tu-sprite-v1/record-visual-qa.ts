/** Record visible palette defects without changing pixels or accepting hard QA failures. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { backlogMarkdown } from '@vgtd/sprite';

const root = process.argv[2]!;
const runtime = process.argv[3]!;
const direction = process.argv[4]!;
const contract = JSON.parse(readFileSync(join(runtime, `danphutu_${direction}.sprite.json`), 'utf8'));
const textureNames: string[] = contract.atlas.textures ?? [`danphutu_${direction}_tex`];
if (textureNames.length !== contract.atlas.pages) throw new Error('Missing atlas texture list');
const pages = textureNames.map((name) => ({
  atlas: decodePng(readFileSync(join(runtime, `${name}.png`))),
  texture: JSON.parse(readFileSync(join(runtime, `${name}.json`), 'utf8')) as {
    SubTexture: { name: string; x: number; y: number; width: number; height: number }[];
  },
}));
const regionNames = pages.flatMap(({ texture }) => texture.SubTexture.map((region) => region.name));
if (regionNames.length !== contract.atlas.regions || new Set(regionNames).size !== regionNames.length)
  throw new Error('Atlas pages do not cover every frame exactly once');
const path = join(root, 'quality-backlog.json');
const backlog = JSON.parse(readFileSync(path, 'utf8'));
// Visual-only metrics are deliberately retained: the automated gate does not emit them.
const manual = backlog.entries.filter(
  (e: { gate: string; metric: string }) => e.gate === 'palette' || e.metric === 'weak_leg_reversal_cells',
);
backlog.entries = backlog.entries.filter(
  (e: { gate: string; metric: string }) => e.gate !== 'palette' && e.metric !== 'weak_leg_reversal_cells',
);
backlog.visualFindings = [...(backlog.visualFindings ?? []), ...manual].filter(
  (e: { dir: string; metric: string }) => e.dir !== direction || e.metric !== 'violet_spill_pixels',
);
for (const { atlas, texture } of pages) {
  for (const region of texture.SubTexture) {
    let count = 0;
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        const i = (y * atlas.width + x) * 4;
        if (
          atlas.data[i + 3]! >= 250 &&
          atlas.data[i]! > atlas.data[i + 1]! + 25 &&
          atlas.data[i + 2]! > atlas.data[i + 1]! + 25
        )
          count++;
      }
    }
    if (!count) continue;
    const split = region.name.lastIndexOf('_');
    backlog.visualFindings.push({
      clip: region.name.slice(0, split),
      dir: direction,
      cell: Number(region.name.slice(split + 1)) - 1,
      gate: 'palette',
      metric: 'violet_spill_pixels',
      value: count,
      limit: 0,
      note: 'Opaque violet pixels remain after palette lock (R and B exceed G by >25, alpha >=250). Includes hair key spill / whisk-handle hue drift; cell-local recolor in later pass.',
      status: 'open',
      added: '2026-11-06',
    });
  }
}
if (direction === 'E') {
  for (const cell of [1, 8]) {
    if (
      backlog.visualFindings.some(
        (e: { clip: string; dir: string; cell: number; metric: string }) =>
          e.clip === 'attack_3' && e.dir === direction && e.cell === cell && e.metric === 'gray_talisman_cells',
      )
    )
      continue;
    backlog.visualFindings.push({
      clip: 'attack_3',
      dir: direction,
      cell,
      gate: 'palette',
      metric: 'gray_talisman_cells',
      value: 1,
      limit: 0,
      note: 'Visual review: held paper talisman is gray rather than master warm gold; recolor only this cell in later pass.',
      status: 'open',
      added: '2026-11-06',
    });
  }
}
writeFileSync(path, JSON.stringify(backlog, null, 2) + '\n');
const visualRows = backlog.visualFindings.map(
  (e: {
    clip: string;
    dir: string;
    cell: number;
    gate: string;
    metric: string;
    value: number;
    limit: number;
    status: string;
    note: string;
  }) =>
    `| ${e.clip} | ${e.dir} | ${e.cell} | ${e.gate} | ${e.metric} | ${e.value} | ${e.limit} | ${e.status} | ${e.note} |`,
);
writeFileSync(
  path.replace(/\.json$/, '.md'),
  backlogMarkdown(backlog) +
    '\n## Manual visual findings\n\nThese are open observations in the same per-cell field format. Automated gates do not emit them; never infer that they are resolved from absence in QA output.\n\n| clip | dir | cell | gate | metric | value | limit | status | note |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    visualRows.join('\n') +
    '\n',
);
console.log(
  `${backlog.visualFindings.length} manual visual findings retained separately from ${backlog.entries.length} automated measurements`,
);
