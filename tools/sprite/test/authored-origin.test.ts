import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createImage, encodePng } from '@vgtd/rig';
import {
  authoredOriginPoint,
  validateAuthoredOrigins,
  runProject,
  runBatch,
  reviewHtml,
  type Project,
  type AuthoredOrigin,
} from '../src/index.js';
import { figureImage, makeMaster } from './helpers.js';

const origin: AuthoredOrigin = {
  pelvisX: 128,
  reason: 'Wide lunge uses the reviewed authored axis',
  evidence: 'source frame reviewed: root axis128; no body scale change <review>',
};
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vgtd-origin-'));
  const source = figureImage({ height: 208, cx: 190, sole: 232 });
  // Thin extended weapon fits the raw cell; centering the distant torso clips its left end.
  for (let y = 90; y < 94; y++) for (let x = 4; x < 245; x++) source.data.set([40, 80, 160, 255], (y * 256 + x) * 4);
  writeFileSync(join(dir, 'master.png'), encodePng(makeMaster()));
  const sheet = createImage(512, 256);
  for (let y = 0; y < 256; y++)
    sheet.data.set(source.data.subarray(y * 256 * 4, (y + 1) * 256 * 4), (y * 512 + 256) * 4);
  writeFileSync(join(dir, 'sheet.png'), encodePng(sheet));
  const project: Project = {
    character: 'test',
    direction: 'E',
    stem: 'test',
    master: 'master.png',
    scale: 1,
    palette: { lock: false },
    slice: { inset: 0, defringe: false },
    clips: [
      {
        name: 'attack',
        sheet: 'sheet.png',
        cols: 2,
        frames: 1,
        sheetSelection: { rows: 1, cells: [1] },
        durationSec: 0.6,
        loop: false,
        kind: 'free',
      },
    ],
  };
  return { dir, project };
}
describe('reviewed authored origins', () => {
  it('preserves a wide grouped source without changing scale and retains INFO in contract/batch/review', () => {
    const { dir, project } = setup();
    const old = runProject(project, dir);
    expect(old.contract.qa.findings.some((f) => f.gate === 'canvasLoss')).toBe(true);
    const edited: Project = { ...project, clips: project.clips.map((c) => ({ ...c, authoredOrigins: { 0: origin } })) };
    const result = runProject(edited, dir);
    expect(result.contract.qa.findings.filter((f) => f.gate === 'canvasLoss')).toEqual([]);
    expect(result.contract.clips[0]!.calibration.scale).toBe(1);
    expect(result.contract.clips[0]!.records[0]!.dx).toBe(-0.5);
    expect(result.contract.clips[0]!.authoredOrigins).toEqual({ 0: origin });
    expect(result.contract.qa.judged.find((j) => j.finding.gate === 'authoredOrigin')?.verdict).toBe('info');
    writeFileSync(join(dir, 'project.json'), JSON.stringify(edited));
    writeFileSync(join(dir, 'batch.json'), JSON.stringify({ character: 'test', projects: ['project.json'] }));
    const batch = runBatch(join(dir, 'batch.json'), join(dir, 'out'));
    expect(batch.report.dirs[0]!.clips[0]!.originEvidence?.[0]!.measurement.pelvisX).toBe(128);
    const html = reviewHtml([batch.report]);
    expect(html).toContain('Authored-origin INFO evidence');
    expect(html).toContain('&lt;review&gt;');
    // An explicit but incorrect origin still fails the hard canvas gate.
    const wrong = runProject(
      { ...edited, clips: edited.clips.map((c) => ({ ...c, authoredOrigins: { 0: { ...origin, pelvisX: 190 } } })) },
      dir,
    );
    expect(wrong.contract.qa.findings.some((f) => f.gate === 'canvasLoss')).toBe(true);
  });
  it('accepts a fixed reviewed lattice root and rejects chasing the moving pelvis', () => {
    const e: AuthoredOrigin = {
      ...origin,
      kind: 'lattice-root',
      reason: 'preserve authored root travel',
      evidence: 'Reviewed source/T1 lattice axis128, anatomical pelvis moves independently',
    };
    expect(() => validateAuthoredOrigins({ frames: 2, authoredOrigins: { 0: e, 1: e } })).not.toThrow();
    expect(() => validateAuthoredOrigins({ frames: 2, authoredOrigins: { 0: e, 1: { ...e, pelvisX: 140 } } })).toThrow(
      /fixed registration/,
    );
    expect(() => validateAuthoredOrigins({ frames: 2, authoredOrigins: { 0: e } })).toThrow(/every clip cell/);
    expect(() =>
      validateAuthoredOrigins({ frames: 1, authoredOrigins: { 0: { ...e, reason: 'recenter pelvis' } } }),
    ).toThrow(/preserve authored root travel/);
    const { dir, project } = setup();
    const p: Project = { ...project, clips: project.clips.map((c) => ({ ...c, authoredOrigins: { 0: e } })) };
    writeFileSync(join(dir, 'project.json'), JSON.stringify(p));
    writeFileSync(join(dir, 'batch.json'), JSON.stringify({ character: 'test', projects: ['project.json'] }));
    const batch = runBatch(join(dir, 'batch.json'), join(dir, 'out'));
    expect(batch.report.dirs[0]!.clips[0]!.originEvidence![0]!.measurement.kind).toBe('lattice-root');
    expect(reviewHtml([batch.report])).toContain('lattice-root');
    expect(runProject(p, dir).contract.qa.findings.find((f) => f.gate === 'authoredOrigin')?.message).toContain(
      'lattice-root',
    );
  });
  it('requires reviewed clip-local evidence and rejects per-frame/custom sole ground fitting', () => {
    const invalid: Record<string, AuthoredOrigin>[] = [
      { 1: origin },
      { '01': origin },
      { 0: { ...origin, pelvisX: NaN } },
      { 0: { ...origin, evidence: ' ' } },
      { 0: { ...origin, reason: '' } },
    ];
    for (const authoredOrigins of invalid)
      expect(() => validateAuthoredOrigins({ frames: 1, authoredOrigins })).toThrow(/origin/);
    expect(() => validateAuthoredOrigins({ frames: 1, authoredOrigins: { 0: { ...origin, groundY: 232 } } })).toThrow(
      /keep/,
    );
    expect(() =>
      validateAuthoredOrigins({
        frames: 2,
        vertical: 'keep',
        authoredOrigins: { 0: { ...origin, groundY: 232 }, 1: { ...origin, groundY: 233 } },
      }),
    ).toThrow(/fixed/);
    expect(() =>
      validateAuthoredOrigins({ frames: 2, vertical: 'keep', authoredOrigins: { 0: { ...origin, groundY: 232 } } }),
    ).toThrow(/every clip cell/);
    expect(authoredOriginPoint({ ...origin, groundY: 232 }, 512, 512, 5, 470)).toEqual({ x: 251, y: 459 });
    expect(authoredOriginPoint(origin, 512, 512, 5, 470)).toEqual({ x: 251, y: 470 });
    expect(() => authoredOriginPoint({ ...origin, pelvisX: 0 }, 512, 512, 5, 470)).toThrow(/outside/);
  });
});
