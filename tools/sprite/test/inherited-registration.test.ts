import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImage, encodePng } from '@vgtd/rig';
import { describe, expect, it } from 'vitest';
import {
  runProject,
  toPremultiplied,
  verifyInheritedRegistration,
  type InheritedRegistration,
  type Project,
} from '../src/index.js';
import { makeMaster, makeSheet } from './helpers.js';

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vgtd-inherit-'));
  const before = makeSheet(2, 1, 256, [
    { height: 208, cx: 128, sole: 232 },
    { height: 208, cx: 128, sole: 232 },
  ]);
  const after = { ...before, data: new Uint8ClampedArray(before.data) };
  const mask = createImage(512, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 512; x++) {
      const p = (y * 512 + x) * 4;
      const v = x < 256 && y < 115 ? 255 : 0;
      mask.data.set([v, v, v, 255], p);
    }
  // Remove one side of the head and upper torso: the computed centroid changes, the feet do not.
  for (let y = 20; y < 110; y++) for (let x = 100; x < 128; x++) after.data.set([255, 0, 255, 255], (y * 512 + x) * 4);
  const source = encodePng(toPremultiplied(before));
  const edited = encodePng(toPremultiplied(after));
  const maskBytes = encodePng(mask);
  writeFileSync(join(dir, 'before.png'), source);
  writeFileSync(join(dir, 'after.png'), edited);
  writeFileSync(join(dir, 'mask.png'), maskBytes);
  writeFileSync(join(dir, 'master.png'), encodePng(makeMaster()));
  const inherited: InheritedRegistration = {
    kind: 'inherited-registration',
    source: 'before.png',
    sourceSha256: hash(source),
    mask: 'mask.png',
    maskSha256: hash(maskBytes),
    cells: [0],
  };
  const clip = { name: 'idle', sheet: 'after.png', cols: 2, frames: 2, durationSec: 1, loop: true };
  const project: Project = {
    character: 'test',
    direction: 'E',
    stem: 'test',
    master: 'master.png',
    palette: { lock: false },
    slice: { inset: 0 },
    clips: [clip],
  };
  return { dir, source, edited, before, after, mask, inherited, clip, project };
}

describe('D57 inherited registration', () => {
  it('verifies outside-mask RGBA and retains computed origin, scale and aligned feet', () => {
    const f = fixture();
    const baseline = runProject({ ...f.project, clips: [{ ...f.clip, sheet: 'before.png' }] }, f.dir, {
      includeAlignedFrames: true,
    });
    const edited = runProject({ ...f.project, clips: [{ ...f.clip, inheritedRegistration: f.inherited }] }, f.dir, {
      includeAlignedFrames: true,
    });
    const a = baseline.contract.clips[0]!,
      b = edited.contract.clips[0]!;
    expect(b.calibration).toEqual(a.calibration);
    expect(b.records[0]!.dx).toBe(a.records[0]!.dx);
    expect(b.records[0]!.dy).toBe(a.records[0]!.dy);
    expect(b.records[0]!.inheritedRegistration).toMatchObject({
      kind: 'inherited-registration',
      sourceSha256: f.inherited.sourceSha256,
      sourceCell: 0,
    });
    expect(b.records[1]!.inheritedRegistration).toBeUndefined();
    expect(edited.alignedClips![0]!.frames[0]!.data.slice(180 * 256 * 4)).toEqual(
      baseline.alignedClips![0]!.frames[0]!.data.slice(180 * 256 * 4),
    );
    const unpinned = runProject(f.project, f.dir);
    expect(unpinned.contract.clips[0]!.records[0]!.dx).not.toBe(a.records[0]!.dx);
  });

  it('rejects even one changed channel outside the mask, including hidden RGB', () => {
    for (const alpha of [0, 1, 255]) {
      const f = fixture();
      const p = (200 * 512 + 100) * 4;
      f.before.data[p + 3] = f.after.data[p + 3] = alpha;
      f.after.data[p] = f.before.data[p]! + 1;
      // Raw encoding deliberately retains hidden RGB bytes.
      const source = encodePng(f.before, { premultiplied: true });
      const edited = encodePng(f.after, { premultiplied: true });
      writeFileSync(join(f.dir, 'before.png'), source);
      expect(() =>
        verifyInheritedRegistration({ ...f.inherited, sourceSha256: hash(source) }, edited, f.clip, f.dir),
      ).toThrow('RGBA mismatch outside mask');
    }
  });

  it('requires an explicit mask and matching source/mask hashes', () => {
    const f = fixture();
    expect(() => verifyInheritedRegistration({ ...f.inherited, mask: '' }, f.edited, f.clip, f.dir)).toThrow(
      'explicit mask',
    );
    expect(() =>
      verifyInheritedRegistration({ ...f.inherited, sourceSha256: '0'.repeat(64) }, f.edited, f.clip, f.dir),
    ).toThrow('source SHA256');
    expect(() =>
      verifyInheritedRegistration({ ...f.inherited, maskSha256: '0'.repeat(64) }, f.edited, f.clip, f.dir),
    ).toThrow('mask SHA256');
  });

  it('rejects soft masks, transparent masks and vacuous all-white cells', () => {
    for (const pixel of [
      [127, 127, 127, 255],
      [0, 0, 0, 0],
      [255, 255, 255, 255],
    ]) {
      const f = fixture();
      for (let p = 0; p < f.mask.data.length; p += 4) f.mask.data.set(pixel, p);
      const bytes = encodePng(f.mask, { premultiplied: true });
      writeFileSync(join(f.dir, 'mask.png'), bytes);
      expect(() =>
        verifyInheritedRegistration({ ...f.inherited, maskSha256: hash(bytes) }, f.edited, f.clip, f.dir),
      ).toThrow(/mask must/);
    }
  });

  it('uses clip-local mapping for grouped sheets and allows unchanged all-black cells', () => {
    const f = fixture();
    const clip = { ...f.clip, frames: 1, sheetSelection: { rows: 1, cells: [1] } };
    const result = verifyInheritedRegistration(f.inherited, f.edited, clip, f.dir);
    expect(result.verified.get(0)).toEqual({ sourceCell: 1, outsidePixels: 256 * 256 });
    expect(() => verifyInheritedRegistration({ ...f.inherited, cells: [1] }, f.edited, clip, f.dir)).toThrow(
      'clip-local',
    );
  });

  it('replays the computed transform through single-pass DPI preparation', () => {
    const f = fixture();
    writeFileSync(join(f.dir, 'scale.json'), JSON.stringify({ scale: 1 }));
    const project: Project = {
      ...f.project,
      resample: 'lanczos3',
      preparation: { kind: 'square-cell-dpi-v1', calibration: 'scale.json' },
    };
    const baseline = runProject({ ...project, clips: [{ ...f.clip, sheet: 'before.png' }] }, f.dir, {
      includeAlignedFrames: true,
    });
    const edited = runProject({ ...project, clips: [{ ...f.clip, inheritedRegistration: f.inherited }] }, f.dir, {
      includeAlignedFrames: true,
    });
    expect(edited.contract.clips[0]!.records[0]!.dx).toBe(baseline.contract.clips[0]!.records[0]!.dx);
    expect(edited.contract.clips[0]!.records[0]!.dy).toBe(baseline.contract.clips[0]!.records[0]!.dy);
    expect(edited.alignedClips![0]!.frames[0]!.data.slice(180 * 256 * 4)).toEqual(
      baseline.alignedClips![0]!.frames[0]!.data.slice(180 * 256 * 4),
    );
  });

  it('checks outside-mask bytes even in cells not inheriting registration', () => {
    const f = fixture();
    f.after.data[(200 * 512 + 400) * 4] = 99;
    expect(() => verifyInheritedRegistration(f.inherited, encodePng(toPremultiplied(f.after)), f.clip, f.dir)).toThrow(
      'RGBA mismatch outside mask',
    );
  });

  it('retains pre-edit automatic calibration when the edit changes the figure height', () => {
    const f = fixture();
    for (let y = 0; y < 70; y++) for (let x = 0; x < 256; x++) f.after.data.set([255, 0, 255, 255], (y * 512 + x) * 4);
    writeFileSync(join(f.dir, 'after.png'), encodePng(toPremultiplied(f.after)));
    const baseline = runProject({ ...f.project, clips: [{ ...f.clip, sheet: 'before.png' }] }, f.dir);
    const edited = runProject({ ...f.project, clips: [{ ...f.clip, inheritedRegistration: f.inherited }] }, f.dir);
    expect(edited.contract.calibration).toEqual(baseline.contract.calibration);
    expect(
      edited.contract.qa.findings.some((finding) => finding.gate === 'height' && finding.severity === 'fail'),
    ).toBe(true);
  });

  it('rejects competing manual origins and still runs the edited-image QA gates', () => {
    const f = fixture();
    expect(() =>
      runProject(
        { ...f.project, clips: [{ ...f.clip, inheritedRegistration: f.inherited, authoredOrigins: {} }] },
        f.dir,
      ),
    ).toThrow('cannot be combined');
    const result = runProject(
      {
        ...f.project,
        clips: [
          { ...f.clip, inheritedRegistration: f.inherited, heightPolicy: 'head-size-v1', exceptions: { 0: 'posture' } },
        ],
      },
      f.dir,
    );
    expect(result.contract.qa.findings.some((finding) => finding.severity === 'fail')).toBe(true);
  });
});
