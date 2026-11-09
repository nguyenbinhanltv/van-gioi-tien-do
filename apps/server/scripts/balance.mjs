// Class-balance report (D115): bundles src/balance/main.ts with esbuild (workspace packages export .ts sources) and runs it.
//   npm run balance -w @vgtd/server -- [--quick] [--out <file>|-]      (default out: docs/35-bao-cao-can-bang-dao-lo.md at the repo root)
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '../..');
const outdir = join(root, 'node_modules', '.vgtd-balance');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { balance: join(root, 'src/balance/main.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
const args = process.argv.slice(2);
if (!args.includes('--out')) args.push('--out', join(repo, 'docs/35-bao-cao-can-bang-dao-lo.md'));
const r = spawnSync(process.execPath, [join(outdir, 'balance.mjs'), ...args], { stdio: 'inherit' });
if (r.status === 0) {
  // the generated document is committed: keep it prettier-clean so `format:check` passes and a re-run changes only numbers
  const out = args[args.indexOf('--out') + 1];
  if (out && out !== '-') spawnSync('npx', ['prettier', '--write', out], { stdio: 'inherit', shell: true, cwd: repo });
}
process.exit(r.status ?? 1);
