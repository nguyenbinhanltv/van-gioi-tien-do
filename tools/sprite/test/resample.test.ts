import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImage, encodePng } from '@vgtd/rig';
import { describe, expect, it } from 'vitest';
import {
  alignFrame,
  cellRect,
  normalizeSheetDpi,
  resampleAffine,
  runProject,
  sliceSheet,
  solid,
  toPremultiplied,
  type Project,
} from '../src/index.js';
import { drawFigure, makeMaster } from './helpers.js';

describe('opt-in resampling', () => {
  it('integrates area coverage, filters checkerboards, and never creates non-premultiplied halos', () => {
    const src = createImage(4, 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const p = (y * 4 + x) * 4;
        if ((x + y) % 2 === 0) {
          src.data[p] = 255;
          src.data[p + 3] = 255;
        }
      }
    for (const method of ['area', 'lanczos3'] as const) {
      const transform = { scaleX: 0.25, scaleY: 0.25, dx: 0, dy: 0 };
      const out = resampleAffine(src, 1, 1, transform, method);
      expect(out.data).toEqual(resampleAffine(src, 1, 1, transform, method).data);
      expect(out.data[0]).toBe(out.data[3]);
      if (method === 'area') expect([...out.data]).toEqual([128, 0, 0, 128]);
      const edge = resampleAffine(src, 9, 9, { scaleX: 1.3, scaleY: 1.3, dx: -1.2, dy: 0.4 }, method);
      for (let p = 0; p < edge.data.length; p += 4)
        for (let k = 0; k < 3; k++) expect(edge.data[p + k]).toBeLessThanOrEqual(edge.data[p + 3]!);
    }
    expect(() => resampleAffine(src, 1, 1, { scaleX: 0, scaleY: 1, dx: 0, dy: 0 }, 'area')).toThrow();
  });

  it('defers DPI pixels and combines fractional grouped-cell DPI with alignment exactly once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-resample-'));
    const raw = solid(627, 627, [255, 0, 255]);
    for (let i = 0; i < 4; i++) {
      const r = cellRect(627, 627, 2, 2, i);
      const cell = solid(r.width, r.height, [255, 0, 255]);
      drawFigure(cell, { height: 265, cx: 156, sole: 285, stride: i });
      for (let y = 0; y < r.height; y++)
        for (let x = 0; x < r.width; x++)
          raw.data.set(
            cell.data.subarray((y * r.width + x) * 4, (y * r.width + x + 1) * 4),
            ((y + r.y) * 627 + x + r.x) * 4,
          );
    }
    writeFileSync(join(dir, 'master.png'), encodePng(makeMaster()));
    writeFileSync(join(dir, 'raw.png'), encodePng(toPremultiplied(raw)));
    writeFileSync(join(dir, 'scale.json'), JSON.stringify({ scale: 0.964 }));
    const project: Project = {
      character: 'test',
      direction: 'E',
      stem: 'test',
      master: 'master.png',
      palette: { lock: false },
      preparation: { kind: 'square-cell-dpi-v1', calibration: 'scale.json' },
      clips: [
        {
          name: 'idle',
          sheet: 'raw.png',
          cols: 2,
          frames: 2,
          durationSec: 1,
          loop: true,
          vertical: 'keep',
          sheetSelection: { rows: 2, cells: [3, 1] },
          authoredOrigins: {
            0: {
              kind: 'lattice-root',
              pelvisX: 128,
              groundY: 232,
              reason: 'preserve authored root travel',
              evidence: 'test lattice',
            },
            1: {
              kind: 'lattice-root',
              pelvisX: 128,
              groundY: 232,
              reason: 'preserve authored root travel',
              evidence: 'test lattice',
            },
          },
        },
      ],
    };
    const legacy = runProject(project, dir);
    expect(runProject({ ...project, resample: 'bilinear' }, dir).files).toEqual(legacy.files);
    for (const method of ['lanczos3', 'area'] as const) {
      const prepared = normalizeSheetDpi(toPremultiplied(raw), 2, 4, { resample: method, defer: true });
      expect(prepared.image.width).toBe(627);
      expect(prepared.image.data).toEqual(toPremultiplied(raw).data);
      expect(prepared.record.normalized).toEqual([512, 512]);
      expect(normalizeSheetDpi(toPremultiplied(raw), 2, 4, { resample: method }).image.width).toBe(512);
      const result = runProject({ ...project, resample: method }, dir, { includeAlignedFrames: true });
      expect(result.files).toEqual(runProject({ ...project, resample: method }, dir).files);
      expect(result.contract.clips[0]!.preparation).toMatchObject({ resample: method, singlePass: true });
      const source = sliceSheet(toPremultiplied(raw), { cols: 2, rows: 2, frames: 4 });
      for (const [i, cell] of [3, 1].entries()) {
        const r = cellRect(627, 627, 2, 2, cell),
          n = cellRect(512, 512, 2, 2, cell),
          dpi = 512 / 627;
        const expected = alignFrame(source[cell]!.image, {
          calibration: result.contract.clips[0]!.calibration,
          guides: result.contract.master.guides,
          vertical: 'keep',
          referenceOrigin: { x: 125, y: 229 },
          resample: method,
          sourceTransform: { scaleX: dpi, scaleY: dpi, dx: (r.x + 3) * dpi - n.x - 3, dy: (r.y + 3) * dpi - n.y - 3 },
        });
        expect(result.alignedClips![0]!.frames[i]).toEqual(expected!.image);
        const scale = 0.964 * dpi;
        const direct = resampleAffine(
          toPremultiplied(source[cell]!.image),
          256,
          256,
          {
            scaleX: scale,
            scaleY: scale,
            dx: result.contract.master.guides.centerX - ((128 + n.x) / dpi - r.x - 3) * scale,
            dy: result.contract.master.guides.ground - ((232 + n.y) / dpi - r.y - 3) * scale,
          },
          method,
        );
        expect(result.alignedClips![0]!.frames[i]).toEqual(direct);
        expect(expected!.image.width).toBe(256);
        expect(expected!.record.dx).toBe(result.contract.master.guides.centerX - 125 * 0.964);
        expect(expected!.record.dy).toBe(result.contract.master.guides.ground - 229 * 0.964);
      }
    }
    expect(() => runProject({ ...project, resample: 'nearest' as 'area' }, dir)).toThrow(/unknown resampling/);
  });
});
