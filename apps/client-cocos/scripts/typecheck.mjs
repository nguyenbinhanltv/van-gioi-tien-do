// Type-checks assets/scripts against the engine typings. The `cc` declarations only exist after
// Cocos Creator has opened/built the project (temp/). Without them (CI, no editor) a full check is impossible, so a STRUCTURAL check
// runs instead: `cc` is stubbed as an untyped module and only errors that do not depend on the engine typings fail the run (syntax
// errors, a block-scoped name declared twice, a duplicate object-literal property, duplicate identifiers). That is what a bad merge of
// two branches produces, and it would otherwise only show up when someone builds the client (`npm run play`).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = resolve(root, '../../node_modules/typescript/bin/tsc');

if (existsSync(resolve(root, 'temp/tsconfig.cocos.json'))) {
  const r = spawnSync(process.execPath, [tsc, '-p', resolve(root, 'tsconfig.json'), '--noEmit'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

// TS1xxx = syntax / grammar, TS1117 duplicate property, TS2300 duplicate identifier, TS2393 duplicate function, TS2451 redeclared block-scoped
const STRUCTURAL = /error TS(1\d{3}|2300|2393|2451):/;
const r = spawnSync(
  process.execPath,
  [tsc, '-p', resolve(root, 'tsconfig.structural.json'), '--noEmit', '--pretty', 'false'],
  {
    encoding: 'utf8',
  },
);
const bad = `${r.stdout}${r.stderr}`.split('\n').filter((l) => STRUCTURAL.test(l));
if (bad.length > 0) {
  console.error(bad.join('\n'));
  console.error(
    `client-cocos structural check FAILED (${bad.length} error(s)); the full typecheck needs the engine typings (temp/).`,
  );
  process.exit(1);
}
console.log(
  'client-cocos: engine typings (temp/) missing, structural check passed (syntax, duplicate declarations / properties).',
);
