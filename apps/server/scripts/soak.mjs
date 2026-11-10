// Bundles the P5 soak / load-test entry + the gameplay-bot worker with esbuild and runs it with --expose-gc (heap numbers are taken after a GC).
//   npm run soak -w @vgtd/server -- --bots 200 --minutes 30        short soak
//   npm run soak -w @vgtd/server -- --bots 200 --hours 24 --out soak-24h   long soak (by hand)
//   npm run soak -w @vgtd/server -- --ci                           CI smoke (20 bots, 60 s)
// Options and exit codes: see src/loadtest/soak.ts and docs/35-p5-load-test.md.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'node_modules', '.vgtd-soak');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: {
    soak: join(root, 'src/loadtest/soak.ts'),
    'game-worker': join(root, 'src/loadtest/game-worker.ts'),
    'soak-backup': join(root, 'src/loadtest/soak-backup.ts'),
  },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, ['--expose-gc', join(outdir, 'soak.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
