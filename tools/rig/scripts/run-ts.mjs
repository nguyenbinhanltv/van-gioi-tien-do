// Run a TypeScript script of this package with plain `node`: bundle it (and the workspace TS packages it imports)
// with esbuild into a temp file and import that. Usage: node scripts/run-ts.mjs scripts/<name>.ts [args...]
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('usage: node scripts/run-ts.mjs <script.ts> [args...]');
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), 'vgtd-rig-'));
const outfile = join(dir, 'script.mjs');
try {
  await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    outfile,
    logLevel: 'error',
    // some bundled dependencies (ajv) are CommonJS and call require()
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  process.argv = [process.argv[0], resolve(entry), ...args];
  await import(pathToFileURL(outfile).href);
} finally {
  // the script may still hold the file open on Windows until exit: clean up on exit
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}
