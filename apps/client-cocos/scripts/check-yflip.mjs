// CI-safe guard (docs/21 §8): y may only be flipped in assets/scripts/IsoAdapter.ts.
// Flags in every other client script: (1) unary minus on a y coordinate (`-p.y`, `y: -y`, `new Vec3(x, -y)`);
// (2) subtraction-based flips where a constant/height is minus a y-ish value (`0.5 - (clientY - ...)`, `h - y`).
// Limits: a textual heuristic. It cannot see flips hidden behind other names/helpers (e.g. `const dy = -delta`)
// or arithmetic like `size.height - top`; review such code by hand. Coordinate differences (`a.y - b.y`) are allowed.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/scripts');
const unaryMinusOnY = /(^|[=(,:?*/+\[]|return|\*\s)\s*-\s*[\w.]*\by\b/;
const subtractionFlip = /(0\.5|1|height|h|H)\s*-\s*\(?\s*[\w.]*(y|clientY|\.top)/;
let bad = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.ts') || f === 'IsoAdapter.ts') continue;
  readFileSync(join(dir, f), 'utf8')
    .split('\n')
    .forEach((line, n) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (unaryMinusOnY.test(line) || subtractionFlip.test(line)) {
        console.error(`${f}:${n + 1}: y negated outside IsoAdapter: ${line.trim()}`);
        bad++;
      }
    });
}
if (bad) process.exit(1);
console.log('check-yflip: ok (no y negation outside IsoAdapter.ts)');
