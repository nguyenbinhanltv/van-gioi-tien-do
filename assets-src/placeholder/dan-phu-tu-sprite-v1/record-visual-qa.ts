/** Count palette evidence on every atlas page; use shared manual-backlog import/rendering. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { backlogMarkdown, loadBacklog, migrateManualFindings, saveBacklog } from '@vgtd/sprite';

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
const regions = pages.flatMap(({ texture }) => texture.SubTexture.map((region) => region.name));
if (regions.length !== contract.atlas.regions || new Set(regions).size !== regions.length)
  throw new Error('Atlas pages do not cover every frame exactly once');
const companionPath = join(root, 'manual-art-findings.json');
const companion = JSON.parse(readFileSync(companionPath, 'utf8'));
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
    // Absence is never an art-review resolution. Keep any earlier observation open.
    if (!count) continue;
    const split = region.name.lastIndexOf('_');
    const clip = region.name.slice(0, split);
    const cell = Number(region.name.slice(split + 1)) - 1;
    const existing = companion.entries.find(
      (e: { dir: string; clip: string; cell: number; metric: string }) =>
        e.dir === direction && e.clip === clip && e.cell === cell && e.metric === 'violet_spill_pixels',
    );
    if (existing) {
      if (existing.status === 'resolved')
        throw new Error(`${direction} ${clip} cell${cell}: art review required for recurring spill`);
      existing.value = count;
    } else {
      companion.entries.push({
        kind: 'key_spill',
        clip,
        dir: direction,
        cell,
        metric: 'violet_spill_pixels',
        value: count,
        limit: 0,
        note: 'Opaque violet pixels after palette lock: R and B exceed G by >25, alpha >=250. Hair key spill / whisk hue drift; cell-local recolor in later pass.',
        severity: 'warn',
        reviewer: 'art-worker',
        status: 'open',
      });
    }
  }
}
const path = join(root, 'quality-backlog.json');
const backlog = migrateManualFindings(loadBacklog(path, contract.character), companion);
// Changed evidence is imported as a new observation; older observations need explicit art review.
saveBacklog(path, backlog);
writeFileSync(companionPath, JSON.stringify(companion, null, 2) + '\n');
writeFileSync(path.replace(/\.json$/, '.md'), backlogMarkdown(backlog));
console.log(
  `${regions.length} regions across ${pages.length} pages; ${backlog.manual?.length ?? 0} manual observations retained`,
);
