import { describe, expect, it } from 'vitest';
import { createImage, type Image } from '@vgtd/rig';
import {
  checkSimilarity,
  guidesFromMaster,
  landmarkSimilarityRegions,
  measureFigure,
  measureSimilarity,
  reviewHtml,
  similarityRegionsForPair,
  alignFrame,
  toStraight,
  type HeadLandmarks,
  type QaClip,
} from '../src/index.js';

function rect(image: Image, x0: number, y0: number, x1: number, y1: number, color: readonly number[]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.data.set(color, (y * image.width + x) * 4);
}
function figure(x: number, lean = false) {
  const image = createImage(256, 256);
  rect(image, x - 25, 30, x + 25, 70, [230, 190, 160, 255]);
  rect(image, x - 28, 70, x + 28, 127, [40, 80, 160, 255]);
  if (lean) rect(image, 20, 90, 150, 232, [60, 60, 70, 255]);
  else rect(image, x - 12, 127, x + 12, 232, [60, 60, 70, 255]);
  return image;
}
const head = (x: number): HeadLandmarks => ({ crown: { x, y: 30 }, chin: { x, y: 70 } });

describe('D55 annotated similarity windows', () => {
  it('finds the leaning head outside the silhouette-centroid crop and preserves identity scores', () => {
    const master = figure(118),
      frame = figure(200, true);
    const old = measureSimilarity(master, frame, { masterHeight: 202, mode: 'legacy' });
    const fresh = measureSimilarity(master, frame, { masterHeight: 202, masterHead: head(118), frameHead: head(200) });
    expect(old.crops.frame.head.right).toBeLessThan(175);
    expect(fresh.crops.frame.head.left).toBeLessThan(200);
    expect(fresh.crops.frame.head.right).toBeGreaterThan(200);
    expect(old.head).toBeLessThan(0.7);
    expect(fresh.head).toBeCloseTo(1);
    expect(fresh.torso).toBeCloseTo(1);
  });
  it('uses provided breadth or the documented1x head-length window with8% total margin', () => {
    const image = figure(118),
      points: HeadLandmarks = {
        crown: { x: 100, y: 20 },
        chin: { x: 120, y: 60 },
        breadth: { left: { x: 95, y: 40 }, right: { x: 125, y: 40 } },
      };
    const before = JSON.stringify(points);
    const r = landmarkSimilarityRegions(image, points, 200);
    expect(r.head).toEqual({ left: 93.8, top: 18.4, right: 126.2, bottom: 61.6 });
    expect(r.torso).toEqual({ left: 76, top: 61.6, right: 164, bottom: 111.6 });
    const proxy = landmarkSimilarityRegions(image, head(118), 200);
    expect(proxy.widthSource).toBe('head-length-window');
    expect(proxy.head.right - proxy.head.left).toBeCloseTo(40 * 1.08);
    expect(JSON.stringify(points)).toBe(before);
  });
  it('labels authorised rear proxies rear-head, caps shoulder extent, and never invents a chin', () => {
    const image = figure(128);
    const breadth = { left: { x: 108, y: 40 }, right: { x: 148, y: 40 } };
    const heads: HeadLandmarks[] = [
      { kind: 'rear-skull-base', crown: { x: 128, y: 20 }, skullBase: { x: 128, y: 62 }, breadth },
      {
        kind: 'rear-crown-shoulder',
        crown: { x: 128, y: 20 },
        shoulderTop: { left: { x: 100, y: 90 }, right: { x: 156, y: 90 } },
        breadth,
      },
      {
        kind: 'rear-crown-shoulder-single',
        crown: { x: 128, y: 20 },
        shoulderTop: { x: 160, y: 78 },
        breadth,
        occludedSide: 'left',
        occluder: 'hair hides left shoulder',
      },
      {
        kind: 'rear-base-ornament',
        ornamentAnchor: { x: 128, y: 28 },
        skullBase: { x: 128, y: 62 },
        breadth,
        anchorDefinition: 'lowest visible rigid ring contact',
      },
    ];
    for (const h of heads) {
      const before = JSON.stringify(h);
      const r = landmarkSimilarityRegions(image, h, 200);
      expect(r.headKind).toBe('rear-head');
      expect(JSON.stringify(h)).toBe(before);
      expect('chin' in h).toBe(false);
      if (h.kind === 'rear-crown-shoulder' || h.kind === 'rear-crown-shoulder-single')
        expect(r.head.bottom).toBeCloseTo(61.6);
    }
  });
  it('flags measured paired centroid fallback and rejects invalid or mismatched supplied annotations', () => {
    const image = figure(118);
    const fallback = similarityRegionsForPair(image, image, 202, head(118));
    expect(fallback).toMatchObject({ method: 'centroid-fallback', reason: 'frame landmarks absent' });
    expect(fallback.master.method).toBe('centroid-fallback');
    const page = reviewHtml([
      {
        format: 'vgtd-sprite-batch',
        version: 1,
        character: 'fixture',
        ok: true,
        dirs: [
          {
            dir: 'E',
            stem: 'fixture',
            ok: true,
            atlas: { pages: 1, width: 256, height: 256, regions: 1 },
            backlogEntries: 0,
            resolvedEntries: 0,
            folder: '.',
            clips: [
              {
                name: 'idle',
                frames: 1,
                durationSec: 1,
                kind: 'upright',
                status: 'ok',
                counts: { hard: 0, soft: 0, regression: 0, accepted: 0, info: 1 },
                similarityCrops: [{ cell: 0, measurement: fallback }],
              },
            ],
          },
        ],
      },
    ]);
    expect(page).toContain('centroid-fallback');
    expect(page).not.toContain('UNMEASURED');
    const bad: HeadLandmarks = { crown: { x: -1, y: 20 }, chin: { x: 118, y: 70 } };
    expect(() => similarityRegionsForPair(image, image, 202, bad)).toThrow();
    expect(() =>
      similarityRegionsForPair(image, image, 202, head(118), {
        kind: 'rear-skull-base',
        crown: { x: 128, y: 20 },
        skullBase: { x: 128, y: 62 },
        breadth: { left: { x: 108, y: 40 }, right: { x: 148, y: 40 } },
      }),
    ).toThrow(/same/);
    const guides = guidesFromMaster(measureFigure(image)!);
    const aligned = alignFrame(toStraight(image), {
      calibration: { scale: 1, targetHeight: 202, referenceHeight: 202, referenceFrames: 1 },
      guides,
    })!;
    const clip: QaClip = { name: 'idle', kind: 'upright', loop: false, expectedFrames: 1, frames: [aligned] };
    expect(checkSimilarity(clip, { master: image, masterHeight: 202, guides })).toContainEqual(
      expect.objectContaining({ severity: 'info', metric: 'centroid_fallback' }),
    );
  });
  it('still fails real colour drift, without modifying pixels', () => {
    const master = figure(118),
      frame = figure(118);
    rect(frame, 93, 30, 143, 70, [0, 255, 0, 255]);
    const before = frame.data.slice();
    expect(
      measureSimilarity(master, frame, { masterHeight: 202, masterHead: head(118), frameHead: head(118) }).head,
    ).toBeLessThan(0.7);
    expect(frame.data).toEqual(before);
  });
});
