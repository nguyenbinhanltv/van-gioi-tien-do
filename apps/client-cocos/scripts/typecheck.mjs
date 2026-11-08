// Type-checks assets/scripts against the engine typings. The `cc` declarations only exist after
// Cocos Creator has opened/built the project (temp/), so on CI (no editor) this is skipped.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(resolve(root, 'temp/tsconfig.cocos.json'))) {
  console.log('client-cocos typecheck skipped: temp/ missing (run build:web once to generate engine typings).');
  process.exit(0);
}
const tsc = resolve(root, '../../node_modules/typescript/bin/tsc');
const r = spawnSync(process.execPath, [tsc, '-p', resolve(root, 'tsconfig.json'), '--noEmit'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
