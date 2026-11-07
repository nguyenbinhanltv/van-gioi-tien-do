/** Select the AI-edited E panel; preserve all other directions byte-for-byte in RGBA. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
const root = process.argv[2]!;
const baseBytes = readFileSync(join(root, 'raw/turnaround.attempt4.png'));
const editBytes = readFileSync(join(root, 'raw/turnaround.attempt5.png'));
const base = decodePng(baseBytes);
const edit = decodePng(editBytes);
if (base.width !== edit.width || base.height !== edit.height)
  throw new Error('Sheet dimensions changed; no implicit rescale');
const selected = createImage(base.width, base.height);
selected.data.set(base.data);
const boundary = Math.round(base.width / 5);
for (let y = 0; y < base.height; y++) {
  const start = y * base.width * 4;
  selected.data.set(edit.data.subarray(start, start + boundary * 4), start);
}
const panelHash = (image: typeof base, index: number) => {
  const hash = createHash('sha256');
  const left = Math.round((base.width * index) / 5);
  const right = Math.round((base.width * (index + 1)) / 5);
  for (let y = 0; y < base.height; y++)
    hash.update(image.data.subarray((y * base.width + left) * 4, (y * base.width + right) * 4));
  return hash.digest('hex');
};
const proof = ['E', 'SE', 'S', 'NE', 'N'].map((direction, i) => {
  const sourceHash = panelHash(i === 0 ? edit : base, i);
  const selectedHash = panelHash(selected, i);
  if (sourceHash !== selectedHash) throw new Error('Panel selection mismatch');
  return {
    direction,
    source: i === 0 ? 'raw/turnaround.attempt5.png' : 'raw/turnaround.attempt4.png',
    sourceHash,
    selectedHash,
  };
});
writeFileSync(join(root, 'turnaround.corrected.png'), encodePng(selected));
writeFileSync(
  join(root, 'turnaround-selection.json'),
  JSON.stringify(
    {
      baseSha256: createHash('sha256').update(baseBytes).digest('hex'),
      editSha256: createHash('sha256').update(editBytes).digest('hex'),
      boundary,
      proof,
      method:
        'Native whole-panel selection only; no pixel repaint, no rescaling; all four unselected directions preserve original RGBA.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(proof, null, 2));
