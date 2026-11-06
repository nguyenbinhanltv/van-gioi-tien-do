/**
 * `npm run sprite:repair -w @vgtd/sprite -- --sheet <original.png> --edited <edited.png> --cell <index> --cols <n> --rows <n> --out <fixed.png>`
 *
 * Copies ONLY cell <index> (0-based, reading order) of the edited sheet into the original and writes the result. Every
 * other cell is verified byte-identical (per-cell sha1) before writing; the command fails if any other cell changed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { cellHashes, repairCell } from '../src/index.js';

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const need = (n: string) => {
  const v = opt(n);
  if (v === undefined) throw new Error(`missing --${n}`);
  return v;
};
const grid = { cols: Number(need('cols')), rows: Number(need('rows')) };
const cell = Number(need('cell'));
const original = decodePng(readFileSync(resolve(cwd, need('sheet'))));
const edited = decodePng(readFileSync(resolve(cwd, need('edited'))));
const res = repairCell(original, edited, grid, cell);
const same = cellHashes(res.image, grid).filter((h, i) => i !== cell && h === cellHashes(original, grid)[i]).length;
writeFileSync(resolve(cwd, need('out')), encodePng(res.image));
console.log(
  `cell ${cell} replaced (${res.changed.length ? 'changed' : 'identical to the original'}); ${same}/${grid.cols * grid.rows - 1} other cells byte-identical`,
);
