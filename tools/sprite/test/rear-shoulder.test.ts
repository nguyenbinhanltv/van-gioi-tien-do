import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng } from '@vgtd/rig';
import {
  alignFrame,
  checkHeights,
  guidesFromMaster,
  measureFigure,
  runProject,
  runBatch,
  reviewHtml,
  toStraight,
  type HeadEvidence,
  type RearShoulderLandmarks,
  type QaClip,
  type Project,
} from '../src/index.js';
import { makeMaster, figureImage } from './helpers.js';
const master = makeMaster();
const masterHead: RearShoulderLandmarks = {
  kind: 'rear-crown-shoulder',
  crown: { x: 128, y: 24 },
  shoulderTop: { left: { x: 100, y: 80 }, right: { x: 156, y: 80 } },
  breadth: { left: { x: 110, y: 43 }, right: { x: 146, y: 43 } },
};
const head: HeadEvidence = {
  ...masterHead,
  crown: { x: 128, y: 92 },
  shoulderTop: { left: { x: 88, y: 140 }, right: { x: 168, y: 156 } },
  breadth: { left: { x: 110, y: 110 }, right: { x: 146, y: 110 } },
  note: 'Approved long hair hides nape; visible shoulder line reviewed <no guessed base>',
};
function fixture() {
  const guides = guidesFromMaster(measureFigure(master)!),
    source = figureImage({ height: 140, cx: 128, sole: 220 });
  const frame = alignFrame(toStraight(source), {
    calibration: { scale: 1, targetHeight: 208, referenceHeight: 208, referenceFrames: 1 },
    guides,
  })!;
  const clip: QaClip = {
    name: 'dash',
    direction: 'N',
    loop: false,
    kind: 'upright',
    heightPolicy: 'head-size-v1',
    expectedFrames: 1,
    frames: [frame],
    exceptions: { 0: 'posture' },
    headEvidence: { 0: head },
  };
  return { source, clip, options: { masterHeight: 208, master, guides, masterHead } };
}
describe('D50 crown-to-shoulder evidence', () => {
  it('uses the visible shoulder midpoint and Euclidean length, not either endpoint', () => {
    const { clip, options } = fixture();
    for (const direction of ['NE', 'N'] as const)
      expect(checkHeights({ ...clip, direction }, options)[0]).toMatchObject({
        severity: 'info',
        headEvidence: { kind: 'rear-crown-shoulder', direction, masterSizePx: 56, sizePx: 56, breadthPx: 36 },
      });
    const d = 56 / Math.sqrt(2);
    const tilted: HeadEvidence = {
      ...head,
      crown: { x: 100, y: 100 },
      shoulderTop: { left: { x: 100 + d - 28, y: 100 + d }, right: { x: 100 + d + 28, y: 100 + d } },
    };
    expect(checkHeights({ ...clip, headEvidence: { 0: tilted } }, options)[0]!.severity).toBe('info');
  });
  it('rejects guessing hidden anatomy, invalid shoulders, drift and wrong direction/kind', () => {
    const { clip, options } = fixture();
    expect(checkHeights({ ...clip, direction: 'E' }, options)[0]!.metric).toBe('head_evidence_direction');
    const wrongMaster = {
      kind: 'rear-skull-base' as const,
      crown: masterHead.crown,
      skullBase: { x: 128, y: 80 },
      breadth: masterHead.breadth,
    };
    expect(checkHeights(clip, { ...options, masterHead: wrongMaster })[0]!.metric).toBe('head_evidence_kind');
    const cases: [HeadEvidence, string][] = [
      [{ ...head, shoulderTop: { left: { x: 100, y: 155 }, right: { x: 156, y: 155 } } }, 'head_size_px'],
      [{ ...head, breadth: { left: { x: 110, y: 110 }, right: { x: 150, y: 110 } } }, 'skull_breadth_px'],
      [{ ...head, breadth: undefined } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, skullBase: { x: 128, y: 129 } } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, chin: { x: 128, y: 129 } } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, shoulderTop: undefined } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, shoulderTop: { left: { x: 128, y: 148 }, right: { x: 128, y: 148 } } }, 'head_evidence_invalid'],
      [{ ...head, shoulderTop: { left: { x: -1, y: 148 }, right: { x: 156, y: 148 } } }, 'head_evidence_invalid'],
    ];
    for (const [evidence, metric] of cases)
      expect(checkHeights({ ...clip, headEvidence: { 0: evidence } }, options)[0]).toMatchObject({
        severity: 'fail',
        metric,
      });
  });
  it('records endpoints/midpoint and per-direction master values without editing the approved master', () => {
    const { source, clip } = fixture(),
      dir = mkdtempSync(join(tmpdir(), 'vgtd-shoulder-'));
    const masterBytes = encodePng(master);
    writeFileSync(join(dir, 'master.png'), masterBytes);
    writeFileSync(join(dir, 'dash.png'), encodePng(source));
    const project: Project = {
      character: 'test',
      direction: 'N',
      stem: 'test',
      master: 'master.png',
      masterHead,
      scale: 1,
      slice: { inset: 0 },
      palette: { lock: false },
      clips: [
        {
          name: 'dash',
          sheet: 'dash.png',
          cols: 1,
          frames: 1,
          durationSec: 1,
          loop: false,
          kind: 'upright',
          heightPolicy: 'head-size-v1',
          exceptions: clip.exceptions,
          headEvidence: clip.headEvidence,
        },
      ],
    };
    const result = runProject(project, dir);
    expect(result.contract.master.head).toEqual(masterHead);
    expect(result.contract.clips[0]!.calibration.scale).toBe(1);
    expect(readFileSync(join(dir, 'master.png'))).toEqual(masterBytes);
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
    writeFileSync(join(dir, 'batch.json'), JSON.stringify({ character: 'test', projects: ['project.json'] }));
    const batch = runBatch(join(dir, 'batch.json'), join(dir, 'out'));
    expect(batch.report.dirs[0]!.clips[0]!.headEvidence![0]!.measurement.kind).toBe('rear-crown-shoulder');
    const html = reviewHtml([batch.report]);
    expect(html).toContain('shoulder midpoint (128, 148)');
    expect(html).toContain('shoulderTop left (88, 140), right (168, 156)');
    expect(html).toContain('&lt;no guessed base&gt;');
    expect(() => runProject({ ...project, direction: 'E' }, dir)).toThrow(/only for NE\/N/);
  });
});
