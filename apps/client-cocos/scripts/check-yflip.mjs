// CI-safe guard (docs/21 §8): y may only be flipped in assets/scripts/IsoAdapter.ts.
// Flags unary-minus on a y coordinate (e.g. `-p.y`, `y: -y`, `new Vec3(x, -y)`) in every other client script.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/scripts');
const unaryMinusOnY = /(^|[=(,:?*/+\[]|return|\*\s)\s*-\s*[\w.]*\by\b/;
let bad = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.ts') || f === 'IsoAdapter.ts') continue;
  readFileSync(join(dir, f), 'utf8')
    .split('\n')
    .forEach((line, n) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (unaryMinusOnY.test(line)) {
        console.error(`${f}:${n + 1}: y negated outside IsoAdapter: ${line.trim()}`);
        bad++;
      }
    });
}
if (bad) process.exit(1);
console.log('check-yflip: ok (no y negation outside IsoAdapter.ts)');
