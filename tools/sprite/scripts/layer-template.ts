/** Canonical, QA-passed removal-edit references: --project <json> --out <directory>. */
import { resolve } from 'node:path';
import { prepareLayerSources, writeLayerTemplates } from '../src/index.js';
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`missing --${name}`);
  return args[i + 1]!;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const source = prepareLayerSources(resolve(cwd, option('project')));
writeLayerTemplates(source, resolve(cwd, option('out')));
console.log(
  `wrote ${source.templates.length} canonical 4x4 full-pose sheets + layer-inputs.json; use these exact references for body-only image edits`,
);
