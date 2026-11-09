// Content audit report (D114): prints the docs/10 §4 roster as the code ships it, per zone, with what the real MobManager spawns
// BEFORE (every mob in its main element: the D74 behaviour) and AFTER (normal packs alternate between the two elements: D114).
//
//   npm run content:audit -w @vgtd/server
//
// The checks themselves are the vitest file apps/server/tests/content-audit.test.ts (it parses the doc table); this script only
// renders the numbers as Markdown for a PR / review.
import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'node_modules', '.vgtd-dev');
mkdirSync(outdir, { recursive: true });
await build({
  stdin: {
    contents:
      "export { MobManager, defaultMobZones } from './src/index.ts'; export { MOB_DEFS, ZONE_SPAWN_TABLES, mobAttacksOf, mobPhasesOf } from '@vgtd/shared'; export { TileGrid } from '@vgtd/sim';",
    resolveDir: root,
    sourcefile: 'audit-entry.ts',
    loader: 'ts',
  },
  outfile: join(outdir, 'audit.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
const mod = await import(pathToFileURL(join(outdir, 'audit.mjs')).href);
const { MobManager, defaultMobZones, MOB_DEFS, ZONE_SPAWN_TABLES, mobAttacksOf, mobPhasesOf, TileGrid } = mod;

const N = 256;
const rows = Array.from({ length: N }, () => '.'.repeat(N));
const m = new MobManager({ seed: 5, zones: defaultMobZones(N), grid: TileGrid.fromRows(rows) });
const infos = Array.from({ length: m.size }, (_, k) => m.info(1_000_000 + k));
const art = join(root, '../../tools/procgen/out/gemini/mobs_1x');

console.log(
  '| def | zone | tier | elements (main / variant) | level | fp | skills | phases | spawned before | spawned after | art |',
);
console.log(
  '| --- | ---- | ---- | ------------------------- | ----- | -- | ------ | ------ | -------------- | ------------- | --- |',
);
for (const d of MOB_DEFS) {
  const mine = infos.filter((i) => i.def.key === d.key);
  const after = d.elements.map((e) => `${e} ${mine.filter((i) => i.element === e).length}`).join(' / ');
  const before = `${d.elements[0]} ${mine.length}`;
  const skills = mobAttacksOf(d).filter((a) => a.kind === 'skill').length;
  const hasArt = existsSync(art) ? (existsSync(join(art, `${d.key}.png`)) ? 'yes' : 'NO') : 'n/a';
  console.log(
    `| ${d.key} | ${d.zone} | ${d.tier} | ${d.elements.join(' / ')} | ${d.levelMin}-${d.levelMax} | ${d.footprint} | ${skills} | ${mobPhasesOf(d).length} | ${before} | ${after} | ${hasArt} |`,
  );
}
const count = (t) => MOB_DEFS.filter((d) => d.tier === t).length;
console.log(`\ndefs: ${count('normal')} normal + ${count('elite')} elite + ${count('boss')} boss = ${MOB_DEFS.length}`);
for (const t of ZONE_SPAWN_TABLES) {
  const total = t.groups.reduce((a, g) => a + g.count, 0);
  console.log(`zone ${t.zone}: ${t.groups.map((g) => `${g.def} x${g.count}`).join(', ')} (${total} mobs at density 1)`);
}
console.log(`spawned on a ${N}x${N} map: ${m.size} mobs`);
const variantsAfter = new Set(infos.filter((i) => i.def.tier === 'normal').map((i) => `${i.def.key}:${i.element}`))
  .size;
console.log(`normal variants (def x element) spawned: before 8, after ${variantsAfter}`);
