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
  type RearOrnamentLandmarks,
  type QaClip,
  type Project,
} from '../src/index.js';
import { makeMaster, figureImage } from './helpers.js';

const master = makeMaster();
const masterHead: RearOrnamentLandmarks = {
  kind: 'rear-base-ornament',
  ornamentAnchor: { x: 128, y: 28 },
  anchorDefinition: 'Lowest visible rigid bun-ring/hair contact <fixed anchor>',
  skullBase: { x: 128, y: 61 },
  breadth: { left: { x: 110, y: 43 }, right: { x: 146, y: 43 } },
};
const head: HeadEvidence = {
  ...masterHead,
  ornamentAnchor: { x: 128, y: 96 },
  skullBase: { x: 128, y: 129 },
  breadth: { left: { x: 110, y: 110 }, right: { x: 146, y: 110 } },
  note: 'Reviewed rigid ring occludes crown; visible nape and fixed ring contact, no projected crown',
};
function fixture() {
  const guides = guidesFromMaster(measureFigure(master)!);
  const source = figureImage({ height: 140, cx: 128, sole: 220 });
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

describe('D52 rear rigid-ornament evidence', () => {
  it('compares base-to-anchor distance and breadth with the locked N master, including tilt', () => {
    const { clip, options } = fixture();
    expect(checkHeights(clip, options)[0]).toMatchObject({
      severity: 'info',
      headEvidence: {
        kind: 'rear-base-ornament',
        direction: 'N',
        masterSizePx: 33,
        sizePx: 33,
        masterBreadthPx: 36,
        breadthPx: 36,
        master: masterHead,
        frame: head,
      },
    });
    const d = 33 / Math.sqrt(2),
      b = 36 / Math.sqrt(2);
    const tilted: HeadEvidence = {
      ...head,
      ornamentAnchor: { x: 100, y: 100 },
      skullBase: { x: 100 + d, y: 100 + d },
      breadth: { left: { x: 110, y: 100 }, right: { x: 110 + b, y: 100 + b } },
    };
    expect(checkHeights({ ...clip, headEvidence: { 0: tilted } }, options)[0]!.severity).toBe('info');
    expect(clip.frames[0]!.record.post.height).toBe(clip.frames[0]!.record.pre.height);
  });

  it('rejects changed anchor identity, fabricated landmarks, missing fields and either size drift', () => {
    const { clip, options } = fixture();
    const cases: [HeadEvidence, string][] = [
      [{ ...head, anchorDefinition: 'A different ring point' }, 'head_anchor_definition'],
      [{ ...head, anchorDefinition: '' }, 'head_evidence_invalid'],
      [{ ...head, anchorDefinition: undefined } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, ornamentAnchor: undefined } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, skullBase: undefined } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, breadth: undefined } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, crown: { x: 128, y: 92 } } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, chin: { x: 128, y: 129 } } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [
        { ...head, shoulderTop: { left: { x: 90, y: 140 }, right: { x: 160, y: 140 } } } as unknown as HeadEvidence,
        'head_evidence_invalid',
      ],
      [{ ...head, ornamentAnchor: { x: -1, y: 96 } }, 'head_evidence_invalid'],
      [{ ...head, ornamentAnchor: { x: 128, y: 129 } }, 'head_evidence_invalid'],
      [{ ...head, skullBase: { x: 128, y: 133 } }, 'head_size_px'],
      [{ ...head, breadth: { left: { x: 110, y: 110 }, right: { x: 150, y: 110 } } }, 'skull_breadth_px'],
      [{ ...head, note: '' }, 'head_evidence_invalid'],
    ];
    for (const [evidence, metric] of cases)
      expect(checkHeights({ ...clip, headEvidence: { 0: evidence } }, options)[0]).toMatchObject({
        severity: 'fail',
        metric,
      });
    const missingMasterDefinition = { ...masterHead, anchorDefinition: undefined } as unknown as RearOrnamentLandmarks;
    expect(checkHeights(clip, { ...options, masterHead: missingMasterDefinition })[0]!.metric).toBe(
      'head_evidence_invalid',
    );
  });

  it('is N-only and retains the existing exception and supplied-evidence rules', () => {
    const { clip, options } = fixture();
    for (const direction of ['E', 'SE', 'S', 'NE'] as const)
      expect(checkHeights({ ...clip, direction }, options)[0]!.metric).toBe('head_evidence_direction');
    expect(
      checkHeights(clip, { ...options, masterHead: { crown: { x: 128, y: 24 }, chin: { x: 128, y: 61 } } })[0]!.metric,
    ).toBe('head_evidence_kind');
    expect(checkHeights({ ...clip, exceptions: {} }, options)[0]!.metric).toBe('head_exception_missing');
    expect(checkHeights({ ...clip, exceptions: { 0: 'airborne' } }, options)[0]!.metric).toBe('head_exception_invalid');
    expect(
      checkHeights(
        {
          ...clip,
          kind: 'free',
          heightPolicy: undefined,
          headEvidence: { 0: { ...head, skullBase: { x: 128, y: 133 } } },
        },
        options,
      )[0]!.metric,
    ).toBe('head_size_px');
  });

  it('retains and escapes the anchor definition in contract/batch/review without changing the master', () => {
    const { source, clip } = fixture(),
      dir = mkdtempSync(join(tmpdir(), 'vgtd-ornament-'));
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
    expect(batch.report.dirs[0]!.clips[0]!.headEvidence![0]!.measurement.master).toEqual(masterHead);
    const html = reviewHtml([batch.report]);
    expect(html).toContain('ornament anchor (128, 96), skull base (128, 129)');
    expect(html).toContain('anchor definition: Lowest visible rigid bun-ring/hair contact &lt;fixed anchor&gt;');
    expect(() => runProject({ ...project, direction: 'NE' }, dir)).toThrow(/only for N direction/);
    expect(() => runProject({ ...project, masterHead: { ...masterHead, anchorDefinition: '' } }, dir)).toThrow(
      /invalid master skull/,
    );
  });
});
