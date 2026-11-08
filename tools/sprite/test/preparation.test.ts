import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImage, encodePng } from '@vgtd/rig';
import { describe, expect, it } from 'vitest';
import {
  auditProjectPreparation,
  normalizeSheetDpi,
  preparationScale,
  runProject,
  type Project,
} from '../src/index.js';
import { makeMaster, makeSheet } from './helpers.js';

describe('declared sheet DPI preparation', () => {
  it('matches pre-normalized PNG, atlas and animation bytes with one locked scale', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-preparation-'));
    const raw = makeSheet(2, 1, 512, [
      { height: 416, cx: 256, sole: 464 },
      { height: 416, cx: 256, sole: 464 },
    ]);
    writeFileSync(join(dir, 'master.png'), encodePng(makeMaster(208, 128)));
    writeFileSync(join(dir, 'raw.png'), encodePng(raw));
    writeFileSync(join(dir, 'normalized.png'), encodePng(normalizeSheetDpi(raw, 2, 2).image));
    writeFileSync(join(dir, 'calibration.json'), JSON.stringify({ scale: 1 }));
    const project: Project = {
      character: 'test',
      direction: 'E',
      stem: 'test',
      master: 'master.png',
      preparation: { kind: 'square-cell-dpi-v1', calibration: 'calibration.json' },
      clips: [{ name: 'idle', sheet: 'raw.png', cols: 2, frames: 2, durationSec: 1, loop: true }],
    };
    const mixed = {
      ...project,
      preparation: undefined,
      clips: [...project.clips, { ...project.clips[0]!, name: 'other', sheet: 'normalized.png' }],
    };
    expect(() => auditProjectPreparation(mixed, dir)).toThrow(/non-reproducible project:.*mixed sheet DPI/);
    expect(() => auditProjectPreparation({ ...mixed, preparation: project.preparation }, dir)).not.toThrow();
    const prepared = runProject(project, dir);
    const old = runProject(
      { ...project, preparation: undefined, scale: 1, clips: [{ ...project.clips[0]!, sheet: 'normalized.png' }] },
      dir,
    );
    for (const [name, bytes] of old.files) {
      if (!name.endsWith('.sprite.json')) expect(prepared.files.get(name)).toEqual(bytes);
    }
    expect(prepared.contract.qa).toEqual(old.contract.qa);
    expect(prepared.contract.clips[0]!.sheetSha1).toEqual(old.contract.clips[0]!.sheetSha1);
    expect(prepared.contract.clips[0]!.preparation).toMatchObject({ raw: [1024, 512], normalized: [512, 256] });
    expect(() => runProject({ ...project, scale: 0.5 }, dir)).toThrow(/non-reproducible project/);
    expect(() => preparationScale({ ...project.preparation!, calibration: 'missing.json' }, dir)).toThrow(
      /non-reproducible project/,
    );
    writeFileSync(join(dir, 'calibration.json'), '{"scale":0}');
    expect(() => runProject(project, dir)).toThrow(/positive and finite/);
  });

  it('crops safe external black letterboxing but rejects non-square anatomy grids', () => {
    const raw = createImage(512, 276);
    // Opaque black external bars, coloured content occupying the full square grid.
    for (let i = 3; i < raw.data.length; i += 4) raw.data[i] = 255;
    for (let y = 10; y < 266; y++) for (let x = 0; x < 512; x++) raw.data[(y * 512 + x) * 4] = 100;
    const normalized = normalizeSheetDpi(raw, 2, 2);
    expect(normalized.record).toMatchObject({ cropTop: 10, cropBottom: 266, normalized: [512, 256] });
    expect(normalized.image.data[0]).toBe(100);
    expect(() => normalizeSheetDpi(raw, 1, 1)).toThrow(/cannot distort anatomy/);
    expect(() => normalizeSheetDpi(raw, 0, 1)).toThrow(/positive integers/);
  });
});
