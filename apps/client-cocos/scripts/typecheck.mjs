// Type-checks assets/scripts against the engine typings. The `cc` declarations only exist after
// Cocos Creator has opened/built the project (temp/). Without them (CI, no editor) a full check is impossible, so a STRUCTURAL check
// runs instead: `cc` is stubbed as an untyped module and only errors that do not depend on the engine typings fail the run (syntax
// errors, a bad config, a block-scoped name declared twice, a duplicate object-literal property, duplicate identifiers). That is what a
// bad merge of two branches produces, and it would otherwise only show up when someone builds the client (`npm run play`).
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

// Everything is fatal EXCEPT the semantic errors that only exist because `cc` is stubbed untyped: TS2xxx (missing members / names on
// engine types) and TS7xxx (implicit any), plus TS18046-18049 ("is of type unknown / possibly null"). The structural TS2xxx codes below
// stay fatal. So syntax errors (TS1xxx, including the duplicate property TS1117), a bad config (TS5xxx / TS6xxx), "no inputs found"
// (TS18003), a duplicate identifier / function (TS2300 / TS2393) and a redeclared block-scoped variable (TS2451) all fail the run.
const ERROR_LINE = /error TS(\d+):/;
const NOISE = /^(2\d{3}|7\d{3}|1804[6-9])$/;
const STRUCTURAL_TS2 = new Set(['2300', '2393', '2451']);
const isFatal = (line) => {
  const m = ERROR_LINE.exec(line);
  if (!m) return false;
  return STRUCTURAL_TS2.has(m[1]) || !NOISE.test(m[1]);
};

const r = spawnSync(
  process.execPath,
  [tsc, '-p', resolve(root, 'tsconfig.structural.json'), '--noEmit', '--pretty', 'false'],
  { encoding: 'utf8' },
);
// the check must really have run: a spawn failure or a signal is a failure, never a pass
if (r.error || r.status === null) {
  console.error(
    `client-cocos structural check could not run tsc: ${r.error ? r.error.message : `killed by ${r.signal}`}`,
  );
  process.exit(1);
}
const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
const bad = lines.filter(isFatal);
// tsc failed (exit != 0) with nothing recognisable (a crash, an unexpected message): also a failure
const unexplained = r.status !== 0 && !lines.some((l) => ERROR_LINE.test(l));
if (bad.length > 0 || unexplained) {
  console.error(bad.length > 0 ? bad.join('\n') : lines.join('\n'));
  console.error(
    `client-cocos structural check FAILED (${bad.length} error(s)); the full typecheck needs the engine typings (temp/).`,
  );
  process.exit(1);
}
console.log(
  'client-cocos: engine typings (temp/) missing, structural check passed (syntax, config, duplicate declarations / properties).',
);
