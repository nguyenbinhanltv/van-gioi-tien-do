// Closed-beta invite codes (D111): bundles src/invites/main.ts with esbuild (workspace packages export .ts sources) and runs it.
//   npm run invites -w @vgtd/server -- mint --count 5 --days 14
//   npm run invites -w @vgtd/server -- list
//   npm run invites -w @vgtd/server -- revoke <id>
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'node_modules', '.vgtd-invites');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { invites: join(root, 'src/invites/main.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, [join(outdir, 'invites.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
