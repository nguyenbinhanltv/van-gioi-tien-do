// Local dev server: bundles src/main.ts with esbuild (workspace packages export .ts sources) and runs it.
//   npm run dev -w @vgtd/server            -> http://localhost:8080 (HTTP auth + WS /ws)
// Env: COMBAT / MOBS (default 1 here: server combat and monsters), PORT, HOST, MAP_TILES (default 256 = the Cocos client's Son Mon map), SPAWN_SIDE (default 24 here so local tabs see each other), REGISTER_PER_IP_PER_DAY, CORS_ORIGINS.
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
process.env.MAP_TILES ??= '256';
process.env.SPAWN_SIDE ??= '24';
// local play: monsters and server-authoritative combat on (COMBAT=0 / MOBS=0 turn them off)
process.env.MOBS ??= '1';
process.env.COMBAT ??= '1';
const child = spawn(process.execPath, [join(outdir, 'main.mjs')], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
