// Bundles the P2 exit scenarios (src/loadtest/scenarios.ts) + their worker threads with esbuild and runs one scenario.
//   npm run p2exit -w @vgtd/server -- flight|badnet|loginstorm|cooldown|soak [options]
// Output goes under node_modules/ (git-ignored, and `ws` resolves from there). --expose-gc gives stable soak heap numbers.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'node_modules', '.vgtd-p2exit');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: {
    scenarios: join(root, 'src/loadtest/scenarios.ts'),
    'bot-worker': join(root, 'src/loadtest/bot-worker.ts'),
    'storm-worker': join(root, 'src/loadtest/storm-worker.ts'),
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
const r = spawnSync(process.execPath, ['--expose-gc', join(outdir, 'scenarios.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
