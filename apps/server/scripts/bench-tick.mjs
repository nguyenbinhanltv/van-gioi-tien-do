// Bundles the in-process tick benchmark (src/loadtest/tick-bench.ts) with esbuild and runs it. Flags go straight to the benchmark;
// `--cpu-prof` writes a V8 CPU profile next to the bundle (node_modules/.vgtd-bench) for finding hot spots.
//   npm run bench:tick -w @vgtd/server -- --players 200 --runs 3 [--hash] [--cpu-prof]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'node_modules', '.vgtd-bench');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { bench: join(root, 'src/loadtest/tick-bench.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: 'inline',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
const args = process.argv.slice(2);
const prof = args.includes('--cpu-prof');
const rest = args.filter((a) => a !== '--cpu-prof');
const nodeArgs = prof ? ['--cpu-prof', `--cpu-prof-dir=${outdir}`] : [];
const r = spawnSync(process.execPath, [...nodeArgs, join(outdir, 'bench.mjs'), ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
