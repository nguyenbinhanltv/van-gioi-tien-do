import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createImage, encodePng } from '@vgtd/rig';
import {
  alignFrame,
  applyBacklog,
  checkHeights,
  checkSimilarity,
  emptyBacklog,
  guidesFromMaster,
  measureFigure,
  reviewHtml,
  runBatch,
  runQa,
  smoothProjectClipDefaults,
  spriteClip,
  toStraight,
  type HeadEvidence,
  type Project,
  type QaClip,
} from '../src/index.js';
import { makeMaster } from './helpers.js';

const master = makeMaster();
const guides = guidesFromMaster(measureFigure(master)!);
const masterHead = { crown: { x: 128, y: 24 }, chin: { x: 128, y: 61 } };
const evidence: HeadEvidence = {
  crown: { x: 128, y: 92 },
  chin: { x: 128, y: 129 },
  note: 'Reviewed dynamic posture, fixed skull size <script>unsafe</script>',
};
function dynamic() {
  const image = createImage(256, 256);
  const rect = (x0: number, y0: number, x1: number, y1: number, color: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.data.set(color, (y * 256 + x) * 4);
  };
  rect(110, 80, 146, 117, [230, 190, 160, 255]);
  rect(100, 117, 156, 170, [40, 80, 160, 255]);
  rect(100, 170, 156, 220, [60, 60, 70, 255]);
  return image;
}
const aligned = (image = dynamic()) =>
  alignFrame(toStraight(image), {
    calibration: { scale: 1, targetHeight: 208, referenceHeight: 208, referenceFrames: 1 },
    guides,
  })!;
const clip = (patch: Partial<QaClip> = {}): QaClip => ({
  name: 'run',
  loop: false,
  kind: 'upright',
  heightPolicy: 'head-size-v1',
  expectedFrames: 1,
  frames: [aligned()],
  exceptions: { 0: 'posture' },
  headEvidence: { 0: evidence },
  ...patch,
});
const options = { masterHeight: 208, master, guides, masterHead };

describe('D47 head-size evidence', () => {
  it.each(['posture', 'secondary-overhang', 'rear-skull-base', ' rear-base-ornament '])(
    'does not let head reason %s skip bad similarity on upright or free clips (D54)',
    (reason) => {
      const wrong = createImage(256, 256);
      for (let i = 0; i < wrong.data.length; i += 4) wrong.data.set([0, 255, 0, 255], i);
      for (const kind of ['upright', 'free'] as const) {
        const c = clip({ kind, frames: [aligned(wrong)], exceptions: { 0: reason } });
        expect(checkSimilarity(c, options).some((f) => f.severity === 'fail')).toBe(true);
      }
    },
  );
  it('keeps similarity independent even when posture head-size evidence passes (D54)', () => {
    const wrong = createImage(256, 256);
    for (let i = 0; i < wrong.data.length; i += 4) wrong.data.set([0, 255, 0, 255], i);
    const c = clip({ frames: [aligned(wrong)] });
    expect(checkHeights(c, options)[0]!.severity).toBe('info');
    expect(runQa([c], options).findings.some((f) => f.gate === 'similarity' && f.severity === 'fail')).toBe(true);
  });
  it('preserves D41 pose exemptions on upright and free clips even with head evidence (D54)', () => {
    const wrong = createImage(256, 256);
    for (let i = 0; i < wrong.data.length; i += 4) wrong.data.set([0, 255, 0, 255], i);
    const c = clip({ frames: [aligned(wrong)], exceptions: { 0: 'die-collapse: prone, top-20% crop not head' } });
    expect(checkSimilarity(c, options)).toEqual([]);
    expect(checkSimilarity({ ...c, kind: 'free' }, options)).toEqual([]);
    expect(checkSimilarity({ ...c, exceptions: { 0: 'bow: neck and torso incline' } }, options)).toEqual([]);
    expect(checkSimilarity({ ...c, exceptions: { 0: 'posture' } }, options).length).toBeGreaterThan(0);
    // D54 changes head reasons only; it does not add validation for legacy non-head strings.
    expect(checkSimilarity({ ...c, kind: 'free', exceptions: { 0: '  ' } }, options)).toEqual([]);
  });
  it('does not reuse head reasons as legacy free-pose height exceptions (D54)', () => {
    const c = clip({ kind: 'free', heightPolicy: undefined, headEvidence: {} });
    expect(checkHeights(c, options)[0]!.severity).toBe('warn');
    expect(checkHeights({ ...c, exceptions: { 0: 'die-collapse: prone' } }, options)[0]!.severity).toBe('info');
  });
  it('accepts dynamic posture as INFO without fitting the body to the bbox band', () => {
    const c = clip(),
      before = c.frames[0]!.metrics.height;
    const findings = checkHeights(c, options);
    expect(before).toBeLessThan(208 * 0.97);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'info',
      headEvidence: { reason: 'posture', masterSizePx: 37, sizePx: 37, bboxHeightPx: before },
    });
    expect(c.frames[0]!.metrics.height).toBe(before);
  });
  it('allows ordinary in-band cells without evidence and validates any evidence supplied', () => {
    expect(checkHeights(clip({ frames: [aligned(master)], exceptions: {}, headEvidence: {} }), options)).toEqual([]);
    expect(
      checkHeights(
        clip({
          frames: [aligned(master)],
          exceptions: {},
          headEvidence: { 0: { ...evidence, chin: { x: 128, y: 145 } } },
        }),
        options,
      )[0]!.severity,
    ).toBe('fail');
    expect(
      checkHeights(
        clip({ heightPolicy: undefined, headEvidence: { 0: { ...evidence, chin: { x: 128, y: 145 } } } }),
        options,
      )[0]!.severity,
    ).toBe('fail');
  });
  it.each(['airborne', 'lunge', 'crouch'])('rejects generic upright exception %s even with evidence', (reason) => {
    expect(checkHeights(clip({ exceptions: { 0: reason } }), options)[0]).toMatchObject({
      severity: 'fail',
      metric: 'head_exception_invalid',
    });
  });
  it('requires valid master/frame evidence and a reason for out-of-band cells', () => {
    expect(checkHeights(clip({ headEvidence: {} }), options)[0]!.metric).toBe('head_evidence_missing');
    expect(checkHeights(clip({ exceptions: {} }), options)[0]!.metric).toBe('head_exception_missing');
    expect(checkHeights(clip(), { ...options, masterHead: undefined })[0]!.metric).toBe('head_evidence_invalid');
    expect(checkHeights(clip({ headEvidence: { 0: { ...evidence, note: '' } } }), options)[0]!.severity).toBe('fail');
    expect(
      checkHeights(clip({ headEvidence: { 3: evidence } }), options).some((f) => f.metric === 'head_evidence_index'),
    ).toBe(true);
  });
  it('uses Euclidean skull size for tilted heads and fails real scale drift', () => {
    const tilted = {
      ...evidence,
      crown: { x: 100, y: 100 },
      chin: { x: 100 + 37 / Math.sqrt(2), y: 100 + 37 / Math.sqrt(2) },
    };
    expect(checkHeights(clip({ headEvidence: { 0: tilted } }), options)[0]!.severity).toBe('info');
    expect(
      checkHeights(clip({ headEvidence: { 0: { ...evidence, chin: { x: 128, y: 132 } } } }), options)[0],
    ).toMatchObject({ severity: 'fail', metric: 'head_size_px' });
    expect(checkHeights(clip({ exceptions: { 0: 'secondary-overhang' } }), options)[0]!.severity).toBe('info');
  });
  it('retains foot errors and legacy behavior while opting smooth dash into upright head policy', () => {
    const c = clip({
      frames: [aligned(), aligned()],
      expectedFrames: 2,
      exceptions: { 0: 'posture', 1: 'posture' },
      headEvidence: { 0: evidence, 1: evidence },
      cells: [0, 1].map(() => ({ leading: 'R', nearFoot: { x: 20, y: 232, planted: true } })),
      groundPxPerFrame: 10,
    });
    const qa = runQa([c], options);
    expect(qa.findings.some((f) => f.gate === 'height' && f.severity === 'info')).toBe(true);
    expect(qa.findings.some((f) => f.gate === 'footSlide' && f.severity !== 'info')).toBe(true);
    expect(applyBacklog(qa.findings, 'E', emptyBacklog('test')).ok).toBe(false);
    expect(
      checkHeights(
        clip({ heightPolicy: undefined, headEvidence: undefined, exceptions: { 0: 'legacy-airborne' } }),
        options,
      )[0]!.severity,
    ).toBe('info');
    expect(smoothProjectClipDefaults('dash')).toMatchObject({ kind: 'upright', heightPolicy: 'head-size-v1' });
    expect(spriteClip('dash').kind).toBe('free');
  });
  it('persists clip-local evidence through a grouped sheet into batch/review INFO', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-head-'));
    writeFileSync(join(dir, 'master.png'), encodePng(master));
    const sheet = createImage(512, 256),
      images = [dynamic(), master];
    images.forEach((image, col) => {
      for (let y = 0; y < 256; y++)
        sheet.data.set(image.data.subarray(y * 256 * 4, (y + 1) * 256 * 4), (y * 512 + col * 256) * 4);
    });
    writeFileSync(join(dir, 'shared.png'), encodePng(sheet));
    const project: Project = {
      character: 'test',
      direction: 'E',
      stem: 'test',
      master: 'master.png',
      masterHead,
      scale: 1,
      clips: [
        {
          name: 'dash',
          sheet: 'shared.png',
          cols: 2,
          frames: 1,
          sheetSelection: { rows: 1, cells: [0] },
          durationSec: 1,
          loop: false,
          kind: 'upright',
          heightPolicy: 'head-size-v1',
          exceptions: { 0: 'posture' },
          headEvidence: { 0: evidence },
        },
        {
          name: 'idle',
          sheet: 'shared.png',
          cols: 2,
          frames: 1,
          sheetSelection: { rows: 1, cells: [1] },
          durationSec: 1,
          loop: false,
          kind: 'upright',
          heightPolicy: 'head-size-v1',
        },
      ],
    };
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
    writeFileSync(join(dir, 'batch.json'), JSON.stringify({ character: 'test', projects: ['project.json'] }));
    const batch = runBatch(join(dir, 'batch.json'), join(dir, 'out'));
    expect(batch.report.ok).toBe(true);
    expect(batch.report.dirs[0]!.clips[0]!.headEvidence![0]!.cell).toBe(0);
    expect(batch.results[0]!.result.contract.master.head).toEqual(masterHead);
    const html = reviewHtml([batch.report]);
    expect(html).toContain('Head-size INFO evidence');
    expect(html).toContain('posture');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe</script>');
    const cwd = fileURLToPath(new URL('../', import.meta.url));
    const backlog = execFileSync(
      process.execPath,
      [join(cwd, '../rig/scripts/run-ts.mjs'), 'scripts/backlog.ts', '--project', join(dir, 'project.json')],
      { cwd, encoding: 'utf8' },
    );
    expect(backlog).toContain('INFO [height] dash #0');
    expect(backlog).toContain('skull 37.00 px / master 37.00 px');
  });
});
