/** Gated removal-edit extraction/export: --project <layer-extraction.json> --out <set-root>. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runLayerExtraction, writeLayerExtraction, type LayerExtractionProject } from '../src/index.js';
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`missing --${name}`);
  return args[i + 1]!;
};
const cwd = process.env.INIT_CWD ?? process.cwd(),
  path = resolve(cwd, option('project'));
const result = runLayerExtraction(JSON.parse(readFileSync(path, 'utf8')) as LayerExtractionProject, dirname(path));
writeLayerExtraction(result, resolve(cwd, option('out')));
for (const f of result.report.qa.findings)
  console.log(`${f.severity.toUpperCase()} [${f.gate}] ${f.clip} #${f.frame}: ${f.message}`);
console.log(`layer QA ${result.ok ? 'passed' : 'FAILED'}; ${result.sets.length} runtime sets exported`);
if (!result.ok) process.exitCode = 1;
