#!/usr/bin/env -S npx tsx
/**
 * Generates the chibi runtime bundles (D71) from the exported DragonBones armatures.
 *   npx tsx pipeline/chibi_runtime.mts --src <dragonbones dir> --out <bundles dir> [--classes a,b] [--dirs E,SE]
 * Writes <out>/chibi-<class>-<dir>/{full,1x}/... and <out>/chibi-runtime.json (sizes per file). Source art is read only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildBundle, discoverSources, planBundle } from '../src/runtime/chibi.mjs';

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const src = arg('src');
const out = arg('out');
if (!src || !out) {
  console.error('usage: chibi_runtime.mts --src <dragonbones dir> --out <bundles dir> [--classes a,b] [--dirs E,SE]');
  process.exit(1);
}
const classes = arg('classes')?.split(',');
const dirs = arg('dirs')?.split(',');
const manifest: Record<string, Array<{ file: string; bytes: number }>> = {};
for (const s of discoverSources(src)) {
  if ((classes && !classes.includes(s.classId)) || (dirs && !dirs.includes(s.dir))) continue;
  const plan = planBundle(s);
  fs.rmSync(path.join(out, plan.bundle), { recursive: true, force: true });
  manifest[plan.bundle] = buildBundle(s, plan, out);
  console.log(`${plan.bundle}: ${manifest[plan.bundle]!.length} files`);
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'chibi-runtime.json'), JSON.stringify(manifest, null, 1));
