// Generates the DragonBones 5.5 test rig into tools/dragonbones-testrig/out/ (or the dir given as argv[2]):
//   rig_<DIR>_ske.json / rig_<DIR>_tex.json / rig_<DIR>_tex.png (DragonBones 5.5) for the 8 directions.
// The TypeScript sources are bundled on the fly with esbuild so this runs on any Node >= 18.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(root, 'out'));
const bundle = join(tmpdir(), `vgtd-spine-testrig-${process.pid}.mjs`);
await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'error',
});
const { generateAllRigs } = await import(pathToFileURL(bundle).href);
mkdirSync(outDir, { recursive: true });
for (const rig of generateAllRigs()) {
  writeFileSync(join(outDir, `${rig.name}_ske.json`), rig.ske);
  writeFileSync(join(outDir, `${rig.name}_tex.json`), rig.tex);
  writeFileSync(join(outDir, `${rig.name}_tex.png`), rig.png);
}
console.log(`dragonbones-testrig: wrote 8 rigs to ${outDir}`);
