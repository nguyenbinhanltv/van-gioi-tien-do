// Local dev server: bundles src/main.ts with esbuild (workspace packages export .ts sources) and runs it.
//   npm run dev -w @vgtd/server            -> http://localhost:8080 (HTTP auth + WS /ws)
// Env: PORT, HOST, MAP_TILES (default 32 here = the Cocos client's procgen map), REGISTER_PER_IP_PER_DAY, CORS_ORIGINS.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'node_modules', '.vgtd-dev');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { main: join(root, 'src/main.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
process.env.MAP_TILES ??= '32';
const child = spawn(process.execPath, [join(outdir, 'main.mjs')], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
