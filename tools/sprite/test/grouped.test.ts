import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng } from '@vgtd/rig';
import {
  buildGroupedTemplate,
  buildTemplate,
  guidesFromMaster,
  measureFigure,
  runProject,
  selectSheetCells,
  sheetLayout,
  toPremultiplied,
  type Project,
} from '../src/index.js';
import { makeMaster, makeSheet } from './helpers.js';

describe('grouped clip sheets', () => {
  it('builds one bounded generation lattice with exact per-clip mappings and pose cells', () => {
    const guides = guidesFromMaster(measureFigure(makeMaster())!);
    const t = buildGroupedTemplate({
      guides,
      clips: [
        { name: 'hit', frames: 6 },
        { name: 'dash', frames: 10, cells: Array.from({ length: 10 }, () => ({ leading: 'L' as const })) },
      ],
    });
    expect(t.manifest.grid).toEqual({ cols: 4, rows: 4, cell: 256 });
    expect(t.clips[1]!.sheetSelection.cells).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(selectSheetCells(t.manifest.cells, t.clips[1]!.sheetSelection).every((c) => c.leading === 'L')).toBe(true);
    expect(() =>
      buildGroupedTemplate({
        guides,
        clips: [
          { name: 'hit', frames: 6 },
          { name: 'die', frames: 12 },
        ],
      }),
    ).toThrow(/4x4/);
    expect(() =>
      buildGroupedTemplate({
        guides,
        clips: [
          { name: 'hit', frames: 2 },
          { name: 'hit', frames: 2 },
        ],
      }),
    ).toThrow();
  });

  it('rejects incomplete, repeated, fractional, negative and out-of-range selections', () => {
    for (const cells of [[0], [0, 0], [0, 1.5], [-1, 0], [0, 4]])
      expect(() => sheetLayout({ cols: 2, frames: 2, sheetSelection: { rows: 2, cells } })).toThrow();
    expect(() => selectSheetCells(['one'], { rows: 1, cells: [1] })).toThrow(/missing/);
  });

  it('matches separate-sheet pixels, events, QA and records after shared-sheet DPI preparation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-group-'));
    const master = makeMaster();
    writeFileSync(join(dir, 'master.png'), encodePng(master));
    writeFileSync(join(dir, 'calibration.json'), JSON.stringify({ scale: 1 }));
    const figures = [0, 1, 2, 3].map((i) => ({ height: 416, cx: 256, sole: 464, stride: i * 3 }));
    const save = (name: string, cols: number, rows: number, indices: number[]) =>
      writeFileSync(
        join(dir, name),
        encodePng(
          toPremultiplied(
            makeSheet(
              cols,
              rows,
              512,
              indices.map((i) => figures[i]!),
            ),
          ),
        ),
      );
    save('shared.png', 2, 2, [0, 1, 2, 3]);
    save('run.png', 2, 1, [2, 0]);
    save('idle.png', 2, 1, [1, 3]);
    const manifest = buildTemplate({
      clip: 'shared',
      cols: 2,
      frames: 4,
      guides: guidesFromMaster(measureFigure(master)!),
      cells: figures.map((_, i) => ({
        leading: i % 2 ? 'L' : 'R',
        nearFoot: { x: 100 + i * 5, y: 232, planted: true },
      })),
    }).manifest;
    writeFileSync(join(dir, 'shared.json'), JSON.stringify(manifest));
    for (const [name, indices] of [
      ['run', [2, 0]],
      ['idle', [1, 3]],
    ] as const)
      writeFileSync(
        join(dir, `${name}.json`),
        JSON.stringify({
          ...manifest,
          grid: { ...manifest.grid, rows: 1 },
          cells: indices.map((i) => manifest.cells[i]),
          frames: 2,
        }),
      );
    const base: Project = {
      character: 'test',
      direction: 'E',
      stem: 'test',
      master: 'master.png',
      preparation: { kind: 'square-cell-dpi-v1', calibration: 'calibration.json' },
      clips: [
        {
          name: 'run',
          tableId: 'run',
          sheet: 'run.png',
          manifest: 'run.json',
          frames: 2,
          cols: 2,
          loop: true,
          durationSec: 0.5,
        },
        {
          name: 'idle',
          tableId: 'idle',
          sheet: 'idle.png',
          manifest: 'idle.json',
          frames: 2,
          cols: 2,
          loop: true,
          durationSec: 1,
        },
      ],
    };
    const separate = runProject(base, dir);
    const grouped = runProject(
      {
        ...base,
        clips: base.clips.map((c, i) => ({
          ...c,
          sheet: 'shared.png',
          manifest: 'shared.json',
          sheetSelection: { rows: 2, cells: i === 0 ? [2, 0] : [1, 3] },
        })),
      },
      dir,
    );
    for (const [name, value] of separate.files)
      if (!name.endsWith('.sprite.json')) expect(grouped.files.get(name)).toEqual(value);
    expect(grouped.contract.qa).toEqual(separate.contract.qa);
    expect(grouped.contract.clips.map((c) => c.records)).toEqual(separate.contract.clips.map((c) => c.records));
    expect(grouped.contract.clips[0]!.sheetSha1).toBe(grouped.contract.clips[1]!.sheetSha1);
    expect(grouped.contract.clips[0]!.sheetSelection!.cells).toEqual([2, 0]);
  });
});
