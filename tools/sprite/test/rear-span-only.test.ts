import { describe, expect, it } from 'vitest';
import {
  alignFrame,
  checkHeights,
  checkSimilarity,
  guidesFromMaster,
  measureFigure,
  toStraight,
  type HeadEvidence,
  type HeadLandmarks,
  type QaClip,
  similarityRegionsForPair,
  measureTemporalSimilarity,
  runProject,
  runBatch,
  reviewHtml,
  type Project,
} from '../src/index.js';
import { createImage, encodePng } from '@vgtd/rig';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeMaster } from './helpers.js';

const master = makeMaster();
const guides = guidesFromMaster(measureFigure(master)!);
const masterHead: HeadLandmarks = {
  kind: 'rear-span-only',
  crown: { x: 128, y: 24 },
  skullBase: { x: 128, y: 61 },
  occludedSide: 'left',
  occluder: 'headband ribbon over left skull contour',
};
const options = { master, masterHeight: 208, guides, masterHead };
function fixture(patch: Record<string, unknown> = {}): QaClip {
  const frame = alignFrame(toStraight(master), {
    calibration: { scale: 1, targetHeight: 208, referenceHeight: 208, referenceFrames: 1 },
    guides,
  })!;
  return {
    name: 'run',
    direction: 'NE',
    loop: false,
    kind: 'upright',
    heightPolicy: 'head-size-v1',
    expectedFrames: 1,
    frames: [frame],
    exceptions: { 0: 'posture' },
    headEvidence: {
      0: {
        ...masterHead,
        note: 'Reviewed main cap and visible nape; ribbon hides left skull contour',
        ...patch,
      } as HeadEvidence,
    },
  };
}

describe('D59 rear span with an occluded breadth endpoint', () => {
  it.each([0.97, 1, 1.03])('accepts same-direction span ratio %s without inventing breadth', (ratio) => {
    const findings = checkHeights(fixture({ skullBase: { x: 128, y: 24 + 37 * ratio } }), options);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'info', headEvidence: { kind: 'rear-span-only', masterSizePx: 37 } });
    expect(findings[0]!.headEvidence!.masterBreadthPx).toBeUndefined();
  });
  it.each([0.969, 1.031])('rejects span ratio %s beyond the unchanged band', (ratio) => {
    expect(checkHeights(fixture({ skullBase: { x: 128, y: 24 + 37 * ratio } }), options)[0]).toMatchObject({
      severity: 'fail',
      metric: 'head_size_px',
    });
  });
  it.each([
    { occluder: undefined },
    { occluder: '' },
    { occluder: 'hidden' },
    { occludedSide: undefined },
    { occludedSide: 'both-visible' },
    { breadth: { left: { x: 110, y: 40 }, right: { x: 146, y: 40 } } },
    { chin: { x: 128, y: 61 } },
    { shoulderTop: { x: 128, y: 61 } },
  ])('rejects absent occlusion or fabricated/redundant endpoints: %j', (patch) => {
    expect(checkHeights(fixture(patch), options)[0]).toMatchObject({
      severity: 'fail',
      metric: 'head_evidence_invalid',
    });
  });
  it('requires the same occluded side and concrete occluder on master and frame', () => {
    expect(checkHeights(fixture({ occludedSide: 'right' }), options)[0]!.metric).toBe('head_evidence_occluder');
    expect(checkHeights(fixture({ occluder: 'hair over left contour' }), options)[0]!.metric).toBe(
      'head_evidence_occluder',
    );
    expect(checkHeights({ ...fixture(), direction: 'S' }, options)[0]!.metric).toBe('head_evidence_direction');
  });
  it('does not exempt Lab similarity or alter the frame pixels', () => {
    const clip = fixture();
    const before = Buffer.from(clip.frames[0]!.image.data);
    const wrong = createImage(256, 256);
    for (let i = 0; i < wrong.data.length; i += 4) wrong.data.set([0, 255, 0, 255], i);
    const changed = { ...clip, frames: [{ ...clip.frames[0]!, image: wrong }] };
    expect(
      checkSimilarity(changed, options).some((f) => f.severity === 'fail' && f.metric !== 'palette_unmeasured'),
    ).toBe(true);
    expect(Buffer.from(clip.frames[0]!.image.data)).toEqual(before);
  });
  const visible: HeadEvidence = {
    kind: 'rear-skull-base',
    crown: { x: 128, y: 24 },
    skullBase: { x: 128, y: 61 },
    breadth: { left: { x: 110, y: 40 }, right: { x: 146, y: 40 } },
    note: 'Reviewed both visible cap contours and nape',
  };
  it('accepts exactly D59 master to D48 frame, reporting visible breadth without a master ratio', () => {
    const clip = { ...fixture(), headEvidence: { 0: visible } };
    const finding = checkHeights(clip, options)[0]!;
    expect(finding).toMatchObject({
      severity: 'info',
      headEvidence: { kind: 'rear-skull-base', sizePx: 37, breadthPx: 36 },
    });
    expect(finding.headEvidence!.masterBreadthPx).toBeUndefined();
    expect(finding.headEvidence!.breadthRatio).toBeUndefined();
    expect(checkHeights(fixture(), { ...options, masterHead: visible })[0]!.metric).toBe('head_evidence_kind');
    expect(
      checkHeights({ ...clip, headEvidence: { 0: { ...visible, skullBase: { x: 128, y: 63 } } } }, options)[0]!.metric,
    ).toBe('head_size_px');
  });
  it('rejects invisible or out-of-head breadth endpoints in the mixed case', () => {
    for (const right of [
      { x: 200, y: 40 },
      { x: 128, y: 90 },
      { x: 149, y: 10 },
    ]) {
      const clip = { ...fixture(), headEvidence: { 0: { ...visible, breadth: { left: { x: 110, y: 40 }, right } } } };
      expect(checkHeights(clip, options)[0]!.metric).toBe('head_breadth_invalid');
    }
  });
  it('uses a span-length square plus total8% margin for both windows, including tilted D48 frames', () => {
    const frame = { ...visible, skullBase: { x: 140, y: 59 } }; // 12/35/37 triangle.
    const crops = similarityRegionsForPair(master, master, 208, masterHead, frame);
    for (const side of [crops.master, crops.frame]) {
      expect(side.headKind).toBe('rear-head');
      expect(side.cropRule).toBe('rear-span-window');
      expect(side.widthSource).toBe('head-length-window');
      expect(side.head.right - side.head.left).toBeCloseTo(37 * 1.08);
      expect(side.head.bottom - side.head.top).toBeCloseTo(37 * 1.08);
    }
    expect((crops.frame.head.right + crops.frame.head.left) / 2).toBe(134);
    expect((crops.frame.head.top + crops.frame.head.bottom) / 2).toBe(41.5);
    expect(frame.breadth).toEqual(visible.breadth); // Window does not create or mutate evidence.
    expect(() => similarityRegionsForPair(master, master, 208, visible, masterHead)).toThrow(/same master\/frame/);
    const temporal = measureTemporalSimilarity(master, master, {
      masterHeight: 208,
      firstHead: masterHead,
      secondHead: visible,
    });
    expect(temporal.crops.master.cropRule).toBe('rear-span-window');
    expect(temporal.crops.frame.cropRule).toBe('rear-span-window');
    const visiblePair = measureTemporalSimilarity(master, master, {
      masterHeight: 208,
      masterHead,
      firstHead: visible,
      secondHead: visible,
    });
    expect(visiblePair.crops.master.cropRule).toBe('rear-span-window');
    expect(visiblePair.crops.frame.cropRule).toBe('rear-span-window');
  });
  it('preserves span-only master and mixed-frame INFO in exported review without a fabricated breadth ratio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-rear-span-'));
    writeFileSync(join(dir, 'master.png'), encodePng(master));
    const project: Project = {
      character: 'test',
      direction: 'NE',
      stem: 'test',
      master: 'master.png',
      masterHead,
      scale: 1,
      slice: { inset: 0 },
      palette: { lock: false },
      clips: [
        {
          name: 'run',
          sheet: 'master.png',
          cols: 1,
          frames: 1,
          durationSec: 1,
          loop: false,
          kind: 'upright',
          heightPolicy: 'head-size-v1',
          exceptions: { 0: 'posture' },
          headEvidence: { 0: visible },
        },
      ],
    };
    const result = runProject(project, dir);
    expect(result.contract.master.head).toEqual(masterHead);
    expect(result.contract.qa.judged.find((j) => j.finding.headEvidence)?.verdict).toBe('info');
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
    writeFileSync(join(dir, 'batch.json'), JSON.stringify({ character: 'test', projects: ['project.json'] }));
    const batch = runBatch(join(dir, 'batch.json'), join(dir, 'out'));
    const html = reviewHtml([batch.report]);
    expect(html).toContain('rear-span-only');
    expect(html).toContain('headband ribbon over left skull contour');
    expect(html).toContain('skull breadth 36.00 / master occluded (no ratio)');
    expect(html).not.toContain('undefined');
  });
});
