import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { prepareLayerSources, runProject, writeLayerTemplates, type Project } from '../src/index.js';
import { makeMaster } from './helpers.js';
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vgtd-layer-guides-'));
  const master = makeMaster(),
    sheet = createImage(512, 256);
  for (let y = 0; y < 256; y++)
    for (const offset of [0, 256])
      sheet.data.set(master.data.subarray(y * 256 * 4, (y + 1) * 256 * 4), (y * 512 + offset) * 4);
  writeFileSync(join(dir, 'master.png'), encodePng(master));
  writeFileSync(join(dir, 'sheet.png'), encodePng(sheet));
  const project: Project = {
    character: 'test',
    direction: 'E',
    stem: 'test',
    master: 'master.png',
    scale: 1,
    slice: { inset: 0 },
    palette: { lock: false },
    clips: [
      {
        name: 'attack',
        tableId: 'attack',
        phases: { hit_frame: 5, combo_window: 7 },
        sheet: 'sheet.png',
        cols: 2,
        frames: 1,
        sheetSelection: { rows: 1, cells: [1] },
        durationSec: 0.6,
        loop: false,
      },
      {
        name: 'idle',
        tableId: 'idle',
        sheet: 'sheet.png',
        cols: 2,
        frames: 1,
        sheetSelection: { rows: 1, cells: [0] },
        durationSec: 1,
        loop: true,
      },
    ],
  };
  const path = join(dir, 'project.json');
  writeFileSync(path, JSON.stringify(project));
  return { dir, path, project };
}
describe('canonical layer edit guides', () => {
  it('copies aligned pixels and grouped mapping exactly, without changing ordinary export bytes', () => {
    const { dir, path, project } = fixture();
    const old = runProject(project, dir),
      retained = runProject(project, dir, { includeAlignedFrames: true });
    expect(old.alignedClips).toBeUndefined();
    expect(retained.files).toEqual(old.files);
    const result = prepareLayerSources(path);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]!.clips).toEqual([
      { name: 'attack', cells: [1] },
      { name: 'idle', cells: [0] },
    ]);
    const guide = decodePng(result.templates[0]!.png);
    expect([guide.width, guide.height]).toEqual([1024, 1024]);
    for (const [name, cell] of [
      ['idle', 0],
      ['attack', 1],
    ] as const) {
      const image = retained.alignedClips!.find((c) => c.name === name)!.frames[0]!;
      for (let y = 0; y < 256; y++)
        expect(guide.data.subarray((y * 1024 + cell * 256) * 4, (y * 1024 + cell * 256 + 256) * 4)).toEqual(
          image.data.subarray(y * 256 * 4, (y + 1) * 256 * 4),
        );
    }
    expect(result.projectSha256).toBe(hash(readFileSync(path)));
    expect(result.templates[0]!.sha256).toBe(hash(result.templates[0]!.png));
    writeLayerTemplates(result, join(dir, 'out'));
    const manifest = JSON.parse(readFileSync(join(dir, 'out/layer-inputs.json'), 'utf8'));
    expect(manifest.grid).toEqual({ cols: 4, rows: 4, cell: 256 });
    expect(manifest.templates[0].png).toBeUndefined();
    const cli = fileURLToPath(new URL('../../rig/scripts/run-ts.mjs', import.meta.url));
    const script = fileURLToPath(new URL('../scripts/layer-template.ts', import.meta.url));
    execFileSync(process.execPath, [cli, script, '--project', path, '--out', join(dir, 'cli')]);
    expect(readFileSync(join(dir, 'cli/layer-inputs.json'))).toEqual(readFileSync(join(dir, 'out/layer-inputs.json')));
  });
  it('rejects sources failing QA and safely shares identical aligned versions of a cell', () => {
    const { path, project } = fixture();
    writeFileSync(
      path,
      JSON.stringify({ ...project, clips: project.clips.map((c) => ({ ...c, calibration: { scale: 1.3 } })) }),
    );
    expect(() => prepareLayerSources(path)).toThrow(/source project fails QA/);
    // Same raw cell with identical placement can be safely shared by two clips.
    writeFileSync(
      path,
      JSON.stringify({
        ...project,
        clips: project.clips.map((c) => ({
          ...c,
          sheetSelection: { rows: 1, cells: [0] },
          vertical: c.name === 'idle' ? 'keep' : 'sole',
        })),
      }),
    );
    // Identical placement remains safely shared.
    expect(prepareLayerSources(path).templates).toHaveLength(1);
    writeFileSync(
      path,
      JSON.stringify({
        ...project,
        clips: project.clips.map((c) => ({
          ...c,
          sheetSelection: { rows: 1, cells: [0] },
          calibration: { scale: c.name === 'idle' ? 0.999 : 1 },
        })),
      }),
    );
    expect(() => prepareLayerSources(path)).toThrow(/conflicting aligned poses/);
  });
});
