/** Reproduce Thuong tu source keying and the single anatomical master calibration. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  crop,
  defringe,
  guidesFromMaster,
  keyOut,
  measureFigure,
  placeScaled,
  removeFragments,
  toPremultiplied,
  toStraight,
} from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/thuong-tu-chibi-v1');
const anatomy = JSON.parse(readFileSync(resolve(root, 'reference/anatomy-landmarks.json'), 'utf8'));
const input = readFileSync(resolve(root, anatomy.source));
const raw = decodePng(input);
if (raw.width !== anatomy.sourceDimensions[0] || raw.height !== anatomy.sourceDimensions[1])
  throw new Error('Turnaround dimensions changed; review native crop and anatomical landmarks first.');
const keyed = removeFragments(defringe(keyOut(toStraight(raw))));
const scale = anatomy.targetHeight / anatomy.referenceHeight;
const records = [];
writeFileSync(resolve(root, 'reference/T1-turnaround.png'), encodePng(toPremultiplied(keyed.image)));
for (const view of anatomy.views) {
  const [left, right] = view.panel;
  const panel = crop(keyed.image, left, 0, right - left, raw.height);
  const native = toPremultiplied(panel);
  const sourceMetrics = measureFigure(native);
  if (!sourceMetrics) throw new Error('Empty direction ' + view.direction);
  if (
    sourceMetrics.left <= 0 ||
    sourceMetrics.right >= panel.width ||
    sourceMetrics.top <= 0 ||
    sourceMetrics.bottom >= panel.height
  )
    throw new Error('Native crop touches opaque content: ' + view.direction);
  const guides = guidesFromMaster({ ...sourceMetrics, height: anatomy.targetHeight }, CELL_PX, anatomy.axis);
  const image = placeScaled(native, scale, view.pelvisX, view.soleY, guides.centerX, guides.ground, CELL_PX);
  const dx = guides.centerX - view.pelvisX * scale;
  const dy = guides.ground - view.soleY * scale;
  const bounds = {
    left: sourceMetrics.left * scale + dx,
    right: sourceMetrics.right * scale + dx,
    top: sourceMetrics.top * scale + dy,
    bottom: sourceMetrics.bottom * scale + dy,
  };
  if (bounds.left < 0 || bounds.top < 0 || bounds.right > CELL_PX || bounds.bottom > CELL_PX)
    throw new Error('Master canvas loss: ' + view.direction);
  const h = (view.soleY - view.crown.y) * scale;
  if (Math.abs(h - anatomy.targetHeight) > anatomy.targetHeight * anatomy.heightTolerance)
    throw new Error('Anatomical height drift: ' + view.direction);
  const point = (p: { x: number; y: number }) => ({ x: p.x * scale + dx, y: p.y * scale + dy });
  const head =
    view.headKind === 'rear-crown-shoulder'
      ? {
          kind: view.headKind,
          crown: point(view.crown),
          shoulderTop: {
            left: point(view.shoulderTop.left),
            right: point(view.shoulderTop.right),
          },
          breadth: { left: point(view.breadth.left), right: point(view.breadth.right) },
        }
      : { crown: point(view.crown), chin: point(view.chin) };
  writeFileSync(resolve(root, 'reference/' + view.direction + '.master-native.png'), encodePng(native));
  writeFileSync(resolve(root, 'reference/' + view.direction + '.master.png'), encodePng(image));
  records.push({
    direction: view.direction,
    sourceMetrics,
    alphaMetrics: measureFigure(image),
    anatomicalHeight: h,
    masterHead: head,
    registration: { pelvisX: view.pelvisX, soleY: view.soleY, scale, dx, dy },
    unclippedBounds: bounds,
    note: view.note,
  });
}
mkdirSync(resolve(root, 'E'), { recursive: true });
writeFileSync(
  resolve(root, 'character-calibration.json'),
  JSON.stringify(
    {
      character: 'thuong-tu-chibi-v1',
      source: anatomy.source,
      sourceSha256: createHash('sha256').update(input).digest('hex'),
      operation:
        'keyOut -> defringe -> removeFragments -> whitespace-separated native panel crops -> one placeScaled calibration',
      removedFragments: keyed.removed,
      scale,
      targetHeight: anatomy.targetHeight,
      referenceHeight: anatomy.referenceHeight,
      shoulderLock: anatomy.shoulderLock,
      cell: CELL_PX,
      measurementMethod:
        'Manual main-hair crown/sole landmarks, not alpha bounds or an anatomy detector. Weapon excluded from H.',
      resampling: 'One fixed reference scale for all five views; no per-view height fitting or painted anatomy.',
      directions: records,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ scale, directions: records }, null, 2));
