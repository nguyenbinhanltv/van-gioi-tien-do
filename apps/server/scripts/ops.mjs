// Operator commands for the file store (D99): bundles src/ops/main.ts with esbuild (workspace packages export .ts sources) and runs it.
//   npm run backup  -w @vgtd/server -- [--data-dir D] [--backup-dir B] [--keep N]
//   npm run verify  -w @vgtd/server -- [--from latest|<id>|<path>] [--backup-dir B]     (or --data-dir D for the live documents)
//   npm run restore -w @vgtd/server -- --from latest|<id>|<path> --yes [--force] [--data-dir D]
//   npm run backups -w @vgtd/server                                                      (list)
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'node_modules', '.vgtd-ops');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { ops: join(root, 'src/ops/main.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, [join(outdir, 'ops.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
