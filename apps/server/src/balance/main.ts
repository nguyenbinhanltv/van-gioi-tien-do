/** Entry of the class-balance report (bundled and run by scripts/balance.mjs): `node balance.mjs [--quick] [--out <file>|-]`. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_CONFIG, QUICK_CONFIG, kitRows, runDuels, runParty, runSolo } from './scenarios.js';
import { formatBalanceReport } from './report.js';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : undefined;
const config = quick ? QUICK_CONFIG : DEFAULT_CONFIG;
const t0 = Date.now();
const report = formatBalanceReport({
  config,
  solo: runSolo(config),
  party: runParty(config),
  duels: runDuels(config),
  kits: kitRows(),
});
if (out === '-') process.stdout.write(report);
else {
  const file = resolve(out ?? process.env.BALANCE_OUT ?? 'docs/35-bao-cao-can-bang-dao-lo.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, report);
  console.log(
    `balance report (${quick ? 'quick' : 'full'}) written to ${file} in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}
