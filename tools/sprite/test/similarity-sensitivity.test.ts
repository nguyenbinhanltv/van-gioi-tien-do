import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePng } from '@vgtd/rig';
import {
  landmarkSimilarityRegions,
  measureFigure,
  labPaletteDistance,
  measureTemporalSimilarity,
  alignFrame,
  toStraight,
  guidesFromMaster,
  runQa,
  checkSimilarity,
  type Project,
  type FrontHeadLandmarks,
} from '../src/index.js';
import { makeSimilarityControls } from '../scripts/similarity-controls.js';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const load = (name: string) => {
  const path = resolve(repo, 'assets-src/placeholder', name, 'E/project.json'),
    p = JSON.parse(readFileSync(path, 'utf8')) as Project;
  return { p, image: decodePng(readFileSync(resolve(dirname(path), p.master))) };
};
const master = load('the-tu-chibi-v1'),
  donor = load('dan-phu-tu-chibi-v1'),
  height = measureFigure(master.image)!.height;
const windows = landmarkSimilarityRegions(master.image, master.p.masterHead!, height);
const controls = makeSimilarityControls(
  master.image,
  donor.image,
  windows,
  landmarkSimilarityRegions(donor.image, donor.p.masterHead!, measureFigure(donor.image)!.height),
);

describe('D55 owner-approved A/B/C control matrix', () => {
  const guides = guidesFromMaster(measureFigure(master.image)!);
  const fixture = (image: typeof master.image) =>
    alignFrame(toStraight(image), {
      guides,
      calibration: { scale: 1, targetHeight: height, referenceHeight: height, referenceFrames: 1 },
    })!;
  const evidence = (frame: ReturnType<typeof fixture>) => {
    const h = master.p.masterHead! as FrontHeadLandmarks;
    return {
      crown: { x: h.crown.x + frame.record.dx, y: h.crown.y + frame.record.dy },
      chin: { x: h.chin.x + frame.record.dx, y: h.chin.y + frame.record.dy },
      note: 'Synthetic frozen control geometry, not production evidence',
    };
  };
  it.each(['other-class-head', 'wrong-torso'])('rejects %s through hard Lab identity', (name) => {
    const frame = fixture(controls.find((c) => c.name === name)!.image);
    const findings = checkSimilarity(
      {
        name: 'idle',
        kind: 'upright',
        loop: false,
        expectedFrames: 1,
        frames: [frame],
        headEvidence: { 0: evidence(frame) },
      },
      { master: master.image, masterHeight: height, masterHead: master.p.masterHead!, guides },
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'fail',
        metric: name === 'wrong-torso' ? 'palette_torso_lab' : 'palette_head_lab',
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ severity: 'info', metric: 'legacy_l1_diagnostic' }));
  });
  it('flags a mirrored drawing for eye review without making temporal SSIM a hard failure', () => {
    const first = fixture(master.image),
      mirror = fixture(controls.find((c) => c.name === 'mirrored-head')!.image);
    const report = runQa(
      [
        {
          name: 'idle',
          kind: 'upright',
          loop: false,
          expectedFrames: 3,
          frames: [first, mirror, first],
          heightPolicy: 'head-size-v1',
          headEvidence: { 0: evidence(first), 1: evidence(mirror), 2: evidence(first) },
        },
      ],
      { master: master.image, masterHeight: height, masterHead: master.p.masterHead!, guides },
    );
    expect(report.findings).toContainEqual(
      expect.objectContaining({ severity: 'info', metric: 'temporal_review_by_eye' }),
    );
    expect(report.findings.filter((f) => f.severity === 'fail' && f.gate === 'similarity')).toEqual([]);
  });
  it('reports palette changes for head/torso swaps and temporal change for a mirrored head', () => {
    for (const c of controls.filter((c) => c.name !== 'head-scale-85')) {
      const part = c.name === 'wrong-torso' ? 'torso' : 'head';
      const palette = labPaletteDistance(master.image, c.image, windows[part], windows[part]);
      const temporal = measureTemporalSimilarity(master.image, c.image, {
        masterHeight: height,
        firstHead: master.p.masterHead!,
        secondHead: master.p.masterHead!,
      });
      expect(Number.isFinite(palette.distance)).toBe(true);
      if (c.name === 'mirrored-head') {
        expect(palette.distance).toBeLessThan(2);
        expect(temporal.head).toBeLessThan(0.5);
      } else expect(palette.distance).toBeGreaterThan(2);
    }
  });
  it('rejects the 85% head through the full QA head-size band, regardless of similarity score', () => {
    const control = controls.find((c) => c.name === 'head-scale-85')!,
      transform = control.headTransform!;
    const guides = guidesFromMaster(measureFigure(master.image)!);
    const frame = alignFrame(toStraight(control.image), {
      guides,
      calibration: { scale: 1, targetHeight: height, referenceHeight: height, referenceFrames: 1 },
    })!;
    const h = master.p.masterHead! as FrontHeadLandmarks;
    const point = (p: { x: number; y: number }) => ({
      x: p.x * transform.sx + transform.dx + frame.record.dx,
      y: p.y * transform.sy + transform.dy + frame.record.dy,
    });
    // Synthetic fixture geometry from the declared patch transform, never written as production evidence.
    const report = runQa(
      [
        {
          name: 'idle',
          kind: 'upright',
          loop: false,
          expectedFrames: 1,
          frames: [frame],
          heightPolicy: 'head-size-v1',
          headEvidence: {
            0: {
              crown: point(h.crown),
              chin: point(h.chin),
              note: 'Synthetic scale control; exact constructed transform',
            },
          },
        },
      ],
      { master: master.image, masterHeight: height, masterHead: h, guides },
    );
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ severity: 'fail', metric: 'head_size_px' }));
  });
});
