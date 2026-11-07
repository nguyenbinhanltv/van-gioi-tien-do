/** --group <json> --master <png> --out <directory>; group JSON is buildGroupedTemplate's clips/cols input. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { buildGroupedTemplate, CELL_PX, guidesFromMaster, measureFigure, resizeImage } from '../src/index.js';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`missing --${name}`);
  return args[i + 1]!;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const group = JSON.parse(readFileSync(resolve(cwd, option('group')), 'utf8')) as Omit<
  Parameters<typeof buildGroupedTemplate>[0],
  'guides'
>;
let master = decodePng(readFileSync(resolve(cwd, option('master'))));
if (master.width !== CELL_PX || master.height !== CELL_PX) master = resizeImage(master, CELL_PX, CELL_PX);
const measured = measureFigure(master);
if (!measured) throw new Error('empty master');
const template = buildGroupedTemplate({ ...group, guides: guidesFromMaster(measured) });
const out = resolve(cwd, option('out'));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'group.template.png'), encodePng(template.image));
writeFileSync(join(out, 'group.template.json'), JSON.stringify(template.manifest, null, 2));
writeFileSync(join(out, 'group.clips.json'), JSON.stringify(template.clips, null, 2));
console.log(`wrote grouped template and ${template.clips.length} clip cell mappings to ${out}`);
