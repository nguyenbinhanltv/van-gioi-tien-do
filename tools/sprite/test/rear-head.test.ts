import { mkdtempSync, writeFileSync } from 'node:fs';
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
  type RearHeadLandmarks,
  type QaClip,
  type Project,
} from '../src/index.js';
import { makeMaster, figureImage } from './helpers.js';
const master = makeMaster();
const masterHead: RearHeadLandmarks = {
  kind: 'rear-skull-base',
  crown: { x: 128, y: 24 },
  skullBase: { x: 128, y: 61 },
  breadth: { left: { x: 110, y: 43 }, right: { x: 146, y: 43 } },
};
const head: HeadEvidence = {
  ...masterHead,
  crown: { x: 128, y: 92 },
  skullBase: { x: 128, y: 129 },
  breadth: { left: { x: 110, y: 98 }, right: { x: 146, y: 98 } },
  note: 'Reviewed visible occipital junction and maximum skull breadth; no projected chin <rear>',
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
  return { clip, source, options: { masterHeight: 208, master, guides, masterHead } };
}
describe('D47 rear skull evidence', () => {
  it('compares crown-to-visible skull base and breadth to the same-direction master without rescaling', () => {
    const { clip, options } = fixture();
    for (const direction of ['N', 'NE'] as const) {
      const findings = checkHeights({ ...clip, direction }, options);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'info',
        headEvidence: {
          kind: 'rear-skull-base',
          direction,
          masterSizePx: 37,
          sizePx: 37,
          masterBreadthPx: 36,
          breadthPx: 36,
          breadthRatio: 1,
        },
      });
    }
  });
  it('rejects wrong kind/direction, hidden-chin fabrication and missing or drifting breadth', () => {
    const { clip, options } = fixture();
    expect(checkHeights({ ...clip, direction: 'E' }, options)[0]!.metric).toBe('head_evidence_direction');
    const front = { crown: masterHead.crown, chin: masterHead.skullBase };
    expect(checkHeights(clip, { ...options, masterHead: front })[0]!.metric).toBe('head_evidence_kind');
    const cases: [HeadEvidence, string][] = [
      [{ ...head, skullBase: { x: 128, y: 135 } }, 'head_size_px'],
      [{ ...head, breadth: { left: { x: 110, y: 98 }, right: { x: 150, y: 98 } } }, 'skull_breadth_px'],
      [{ ...head, breadth: undefined } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, chin: { x: 128, y: 117 } } as unknown as HeadEvidence, 'head_evidence_invalid'],
      [{ ...head, breadth: { left: { x: -1, y: 98 }, right: { x: 146, y: 98 } } }, 'head_evidence_invalid'],
    ];
    for (const [evidence, metric] of cases)
      expect(checkHeights({ ...clip, headEvidence: { 0: evidence } }, options)[0]).toMatchObject({
        severity: 'fail',
        metric,
      });
    // Supplied evidence is checked even in-band, with no exception.
    expect(
      checkHeights(
        {
          ...clip,
          frames: [
            alignFrame(toStraight(master), {
              calibration: { scale: 1, targetHeight: 208, referenceHeight: 208, referenceFrames: 1 },
              guides: options.guides,
            })!,
          ],
          exceptions: {},
          headEvidence: { 0: cases[1]![0] },
        },
        options,
      )[0]!.metric,
    ).toBe('skull_breadth_px');
  });
  it('persists master reference values, kind and breadth through contract/backlog/review', () => {
    const { source, clip } = fixture(),
      dir = mkdtempSync(join(tmpdir(), 'vgtd-rear-head-'));
    writeFileSync(join(dir, 'master.png'), encodePng(master));
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
    expect(result.contract.qa.judged.find((j) => j.finding.headEvidence)?.verdict).toBe('info');
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
    writeFileSync(join(dir, 'batch.json'), JSON.stringify({ character: 'test', projects: ['project.json'] }));
    const batch = runBatch(join(dir, 'batch.json'), join(dir, 'out'));
    expect(batch.report.dirs[0]!.clips[0]!.headEvidence![0]!.measurement.masterBreadthPx).toBe(36);
    const html = reviewHtml([batch.report]);
    expect(html).toContain('rear-skull-base');
    expect(html).toContain('skull base');
    expect(html).toContain('skull breadth 36.00 / master 36.00');
    expect(html).toContain('&lt;rear&gt;');
    expect(() => runProject({ ...project, direction: 'E' }, dir)).toThrow(/only for NE\/N/);
  });
});
