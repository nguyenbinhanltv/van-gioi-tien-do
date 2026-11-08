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
  type RearSingleShoulderLandmarks,
  type QaClip,
  type Project,
} from '../src/index.js';
import { makeMaster, figureImage } from './helpers.js';

const master = makeMaster();
const masterHead: RearSingleShoulderLandmarks = {
  kind: 'rear-crown-shoulder-single',
  crown: { x: 140, y: 16 },
  shoulderTop: { x: 161, y: 78 },
  breadth: { left: { x: 111, y: 42 }, right: { x: 165, y: 42 } },
  occludedSide: 'left',
  occluder: 'approved fan, hair and ribbon hide left shoulder <no projection>',
};
const head: HeadEvidence = {
  ...masterHead,
  crown: { x: 128, y: 92 },
  shoulderTop: { x: 149, y: 154 },
  breadth: { left: { x: 101, y: 115 }, right: { x: 155, y: 115 } },
  note: 'Visible right shoulder and skull sides reviewed; left remains hidden <source checked>',
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
    direction: 'NE',
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

describe('D53 one visible rear shoulder', () => {
  it('compares vertical crown-to-shoulder distance, separately from mandatory Euclidean breadth', () => {
    const { clip, options } = fixture();
    for (const direction of ['NE', 'N'] as const)
      expect(checkHeights({ ...clip, direction }, options)[0]).toMatchObject({
        severity: 'info',
        headEvidence: {
          kind: 'rear-crown-shoulder-single',
          direction,
          masterSizePx: 62,
          sizePx: 62,
          masterBreadthPx: 54,
          breadthPx: 54,
          frame: { occludedSide: 'left', shoulderTop: { x: 149, y: 154 } },
        },
      });
    // A diagonal metric would fail: only the vertical distance is authorized by D53.
    expect(
      checkHeights({ ...clip, headEvidence: { 0: { ...head, shoulderTop: { x: 220, y: 154 } } } }, options)[0]!
        .severity,
    ).toBe('info');
    // A tilted breadth with the same Euclidean length remains valid.
    const d = 54 / Math.sqrt(2);
    expect(
      checkHeights(
        {
          ...clip,
          headEvidence: { 0: { ...head, breadth: { left: { x: 100, y: 100 }, right: { x: 100 + d, y: 100 + d } } } },
        },
        options,
      )[0]!.severity,
    ).toBe('info');
  });

  it('rejects size/breadth drift, projected anatomy, invalid points and generic/missing occlusion reasons', () => {
    const { clip, options } = fixture();
    const invalid = (patch: object) => ({ ...head, ...patch }) as HeadEvidence;
    const cases: [HeadEvidence, string][] = [
      [invalid({ shoulderTop: { x: 149, y: 156 } }), 'head_size_px'],
      [invalid({ shoulderTop: { x: 149, y: 152 } }), 'head_size_px'],
      [invalid({ breadth: { left: { x: 101, y: 115 }, right: { x: 157, y: 115 } } }), 'skull_breadth_px'],
      [invalid({ breadth: undefined }), 'head_evidence_invalid'],
      [invalid({ breadth: { left: { x: 101, y: 115 }, right: { x: 101, y: 115 } } }), 'head_evidence_invalid'],
      [invalid({ shoulderTop: undefined }), 'head_evidence_invalid'],
      [invalid({ shoulderTop: { x: -1, y: 154 } }), 'head_evidence_invalid'],
      [invalid({ shoulderTop: { x: 149, y: NaN } }), 'head_evidence_invalid'],
      [invalid({ shoulderTop: { x: 149, y: 92 } }), 'head_evidence_invalid'],
      [invalid({ shoulderTop: { x: 149, y: 80 } }), 'head_evidence_invalid'],
      [invalid({ shoulderTop: { left: { x: 107, y: 154 }, right: { x: 149, y: 154 } } }), 'head_evidence_invalid'],
      [invalid({ chin: { x: 128, y: 140 } }), 'head_evidence_invalid'],
      [invalid({ skullBase: { x: 128, y: 140 } }), 'head_evidence_invalid'],
      [invalid({ ornamentAnchor: { x: 128, y: 140 } }), 'head_evidence_invalid'],
      [invalid({ occluder: '' }), 'head_evidence_invalid'],
      [invalid({ occluder: 'hidden' }), 'head_evidence_invalid'],
      [invalid({ occluder: 'unknown obstruction' }), 'head_evidence_invalid'],
      [invalid({ occluder: undefined }), 'head_evidence_invalid'],
      [invalid({ note: '' }), 'head_evidence_invalid'],
      [invalid({ occludedSide: 'right' }), 'head_evidence_occluded_side'],
    ];
    for (const [evidence, metric] of cases)
      expect(
        checkHeights({ ...clip, headEvidence: { 0: evidence } }, options)[0],
        JSON.stringify(evidence),
      ).toMatchObject({
        severity: 'fail',
        metric,
      });
    expect(checkHeights({ ...clip, direction: 'E' }, options)[0]!.metric).toBe('head_evidence_direction');
    expect(checkHeights(clip, { ...options, masterHead: { ...masterHead, occluder: 'hidden' } })[0]!.metric).toBe(
      'head_evidence_invalid',
    );
    expect(
      checkHeights(clip, {
        ...options,
        masterHead: { ...masterHead, occludedSide: undefined } as unknown as RearSingleShoulderLandmarks,
      })[0]!.severity,
    ).toBe('fail');
    expect(
      checkHeights(clip, {
        ...options,
        masterHead: {
          kind: 'rear-crown-shoulder',
          crown: masterHead.crown,
          shoulderTop: { left: { x: 100, y: 78 }, right: { x: 161, y: 78 } },
          breadth: masterHead.breadth,
        },
      })[0]!.metric,
    ).toBe('head_evidence_kind');
  });

  it('retains occlusion evidence and master values in reports without editing the approved master', () => {
    const { source, clip } = fixture(),
      dir = mkdtempSync(join(tmpdir(), 'vgtd-single-shoulder-'));
    const masterBytes = encodePng(master);
    writeFileSync(join(dir, 'master.png'), masterBytes);
    writeFileSync(join(dir, 'dash.png'), encodePng(source));
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
    expect(batch.report.dirs[0]!.clips[0]!.headEvidence![0]!.measurement).toMatchObject({
      kind: 'rear-crown-shoulder-single',
      masterSizePx: 62,
      sizePx: 62,
      masterBreadthPx: 54,
      master: { occludedSide: 'left', occluder: masterHead.occluder },
      frame: { shoulderTop: head.shoulderTop },
    });
    const html = reviewHtml([batch.report]);
    expect(html).toContain('visible shoulder (vertical distance) (149, 154)');
    expect(html).toContain('visible right shoulderTop (149, 154); occludedSide left');
    expect(html).toContain('master crown (140, 16)');
    expect(html).toContain('&lt;no projection&gt;');
    expect(html).toContain('&lt;source checked&gt;');
    expect(() => runProject({ ...project, direction: 'E' }, dir)).toThrow(/only for NE\/N/);
    expect(() => runProject({ ...project, masterHead: { ...masterHead, occluder: 'hidden' } }, dir)).toThrow(
      /invalid master/,
    );
  });
});
