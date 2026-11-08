import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng } from '@vgtd/rig';
import {
  alignFrame,
  applyBacklog,
  checkCanvasLoss,
  checkHeights,
  emptyBacklog,
  guidesFromMaster,
  measureFigure,
  runProject,
  runQa,
  toStraight,
  type QaClip,
  type Project,
} from '../src/index.js';
import { figureImage, makeMaster } from './helpers.js';

function fixture() {
  const master = makeMaster(227),
    source = figureImage({ height: 227, cx: 128, sole: 246 });
  // The anatomy is unchanged; only a secondary hair tuft extends the source bbox upward.
  for (let y = 5; y < 19; y++) for (let x = 124; x < 132; x++) source.data.set([30, 30, 40, 255], (y * 256 + x) * 4);
  const guides = guidesFromMaster(measureFigure(master)!);
  const frame = alignFrame(toStraight(source), {
    calibration: { scale: 1, targetHeight: 227, referenceHeight: 227, referenceFrames: 1 },
    guides,
  })!;
  const head = { crown: { x: 128, y: 5 }, chin: { x: 128, y: 46 } };
  const clip: QaClip = {
    name: 'idle',
    kind: 'upright',
    heightPolicy: 'head-size-v1',
    expectedFrames: 1,
    frames: [frame],
    loop: true,
    exceptions: { 0: 'secondary-overhang' },
    headEvidence: { 0: { ...head, note: 'Reviewed fixed skull; secondary hair must not be clipped' } },
  };
  return { master, source, frame, clip, options: { masterHeight: 227, master, guides, masterHead: head } };
}
describe('non-waivable canvas loss', () => {
  it('catches the real241px source→232px output case despite valid head/bbox evidence', () => {
    const { frame, clip, options } = fixture();
    expect(frame.record.pre.height).toBe(241);
    expect(frame.record.post.height).toBe(232);
    expect(frame.record.dy).toBe(-14);
    expect(checkHeights(clip, options)[0]!.severity).toBe('info');
    const canvas = checkCanvasLoss(clip);
    expect(canvas[0]).toMatchObject({ gate: 'canvasLoss', severity: 'fail', value: 9, limit: 0 });
    const qa = runQa([clip], options);
    expect(qa.ok).toBe(false);
    expect(applyBacklog(qa.findings, 'E', emptyBacklog('test')).ok).toBe(false);
  });
  it('passes complete bounds and rejects horizontal loss and invalid calibration records', () => {
    const { master, clip, options } = fixture();
    const good = alignFrame(toStraight(master), {
      calibration: { scale: 1, targetHeight: 227, referenceHeight: 227, referenceFrames: 1 },
      guides: options.guides,
    })!;
    expect(checkCanvasLoss({ ...clip, frames: [good] })).toEqual([]);
    expect(checkCanvasLoss({ ...clip, frames: [{ ...good, record: { ...good.record, dx: -100 } }] })[0]!.gate).toBe(
      'canvasLoss',
    );
    expect(
      checkCanvasLoss({
        ...clip,
        frames: [{ ...good, record: { ...good.record, pre: { ...good.record.pre, height: 0 } } }],
      })[0]!.metric,
    ).toBe('canvas_transform_invalid');
  });
  it('keeps clipped source projects in a failing QA state', () => {
    const { master, source, clip, options } = fixture(),
      dir = mkdtempSync(join(tmpdir(), 'vgtd-canvas-'));
    writeFileSync(join(dir, 'master.png'), encodePng(master));
    writeFileSync(join(dir, 'idle.png'), encodePng(source));
    const project: Project = {
      character: 'test',
      direction: 'E',
      stem: 'test',
      master: 'master.png',
      masterHead: options.masterHead,
      scale: 1,
      clips: [
        {
          name: 'idle',
          sheet: 'idle.png',
          cols: 1,
          frames: 1,
          durationSec: 1,
          loop: true,
          kind: 'upright',
          heightPolicy: 'head-size-v1',
          exceptions: { 0: 'secondary-overhang' },
          headEvidence: clip.headEvidence,
        },
      ],
    };
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
    const result = runProject(project, dir);
    expect(result.contract.qa.findings.some((f) => f.gate === 'canvasLoss')).toBe(true);
    expect(result.contract.qa.ok).toBe(false);
  });
});
