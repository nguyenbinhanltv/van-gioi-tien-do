/* eslint-disable */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { loadKiemTuData, removePieces, type RigSet } from '../src/index.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
(process.env.RIG_APPLY_DATA ? it : it.skip)('apply data surgery', () => {
  const file = join(root, 'tools/rig/data/kiem-tu.rig.json');
  const set = JSON.parse(readFileSync(file, 'utf-8')) as RigSet;
  const rigs: Record<string, any> = {};
  for (const [dir, rig] of Object.entries(set.rigs)) {
    const r = removePieces(rig!, { remove: (slot, bone) => slot === 'outfit_lower' && bone === 'scabbard' });
    console.log('REMOVED', dir, r.removed);
    rigs[dir] = r.rig;
  }
  writeFileSync(file, JSON.stringify({ ...set, rigs }) + '\n');
  loadKiemTuData(root);
});
