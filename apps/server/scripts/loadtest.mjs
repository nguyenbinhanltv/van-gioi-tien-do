// Bundles the TypeScript load-test entry + bot worker with esbuild (workspace packages export .ts sources) and runs it.
// Output goes under node_modules/ (git-ignored, and `ws` resolves from there). Usage:
//   npm run loadtest -w server -- --bots 100 [--duration 30] [--area 96] [--speedhackers 2] [--teleporters 2] [--json]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'node_modules', '.vgtd-loadtest');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { cli: join(root, 'src/loadtest/cli.ts'), 'bot-worker': join(root, 'src/loadtest/bot-worker.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, [join(outdir, 'cli.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
