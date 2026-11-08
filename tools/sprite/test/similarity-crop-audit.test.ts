import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { type Project } from '../src/index.js';
import { makeMaster } from './helpers.js';

describe('D55 read-only crop audit', () => {
  it('uses production master normalization and protects input and unrelated output files', () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-crop-audit-'));
    const inputs = join(dir, 'inputs');
    mkdirSync(inputs);
    const master = makeMaster(),
      doubled = createImage(512, 512);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const i = (Math.floor(y / 2) * 256 + Math.floor(x / 2)) * 4;
        doubled.data.set(master.data.subarray(i, i + 4), (y * 512 + x) * 4);
      }
    writeFileSync(join(inputs, 'master.png'), encodePng(doubled));
    writeFileSync(join(inputs, 'idle.png'), encodePng(master));
    const walk = createImage(512, 256);
    for (let y = 0; y < 256; y++)
      for (let cell = 0; cell < 2; cell++)
        walk.data.set(master.data.subarray(y * 256 * 4, (y + 1) * 256 * 4), (y * 512 + cell * 256) * 4);
    writeFileSync(join(inputs, 'walk.png'), encodePng(walk));
    const project: Project = {
      character: 'normalization-fixture',
      direction: 'E',
      stem: 'fixture',
      master: 'master.png',
      scale: 1,
      clips: [
        { name: 'idle', frames: 1, cols: 1, durationSec: 1, loop: false, kind: 'upright', sheet: 'idle.png' },
        { name: 'walk', frames: 2, cols: 2, durationSec: 1, loop: true, kind: 'upright', sheet: 'walk.png' },
      ],
    };
    const projectPath = join(inputs, 'project.json');
    writeFileSync(projectPath, JSON.stringify(project), 'utf8');
    const originals = ['master.png', 'idle.png', 'walk.png', 'project.json'].map((file) => ({
      file,
      bytes: readFileSync(join(inputs, file)),
    }));
    const run = (out: string, extra: string[] = []) =>
      execFileSync(
        process.execPath,
        [
          join(repo, 'tools/rig/scripts/run-ts.mjs'),
          join(repo, 'tools/sprite/scripts/audit-similarity-crops.ts'),
          '--root',
          inputs,
          '--out',
          out,
          ...extra,
        ],
        { cwd: repo, env: { ...process.env, INIT_CWD: repo }, stdio: 'pipe' },
      );
    const out = join(dir, 'report.json');
    run(out);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(report.totals.projects).toBe(1);
    expect(report.totals.scored).toBe(3);
    expect(report.totals.invalid).toBe(0);
    const p = report.projects[0];
    const normalized = decodePng(readFileSync(join(dir, 'report-images', p.masterImage)));
    expect(normalized.width).toBe(256);
    expect(normalized.height).toBe(256);
    expect(normalized.data).toEqual(master.data);
    expect(p.self.head).toBeCloseTo(1);
    expect(p.cells[0].fresh.head).toBeCloseTo(1);
    expect(p.cells[0].fresh.torso).toBeCloseTo(1);
    expect(p.cells[0].method).toBe('centroid-fallback');
    expect(p.temporal).toEqual([
      expect.objectContaining({
        clip: 'walk',
        from: 0,
        to: 1,
        loopSeam: false,
        result: expect.objectContaining({ head: 1, torso: 1 }),
      }),
      expect.objectContaining({
        clip: 'walk',
        from: 1,
        to: 0,
        loopSeam: true,
        result: expect.objectContaining({ head: 1, torso: 1 }),
      }),
    ]);
    expect(() => run(projectPath)).toThrow();
    const protectedOutput = join(dir, 'unrelated.json');
    writeFileSync(protectedOutput, '{"keep":true}', 'utf8');
    expect(() => run(protectedOutput)).toThrow();
    expect(readFileSync(protectedOutput, 'utf8')).toBe('{"keep":true}');
    const missing = join(dir, 'missing-baseline.json'),
      incomplete = join(dir, 'incomplete.json');
    writeFileSync(
      missing,
      JSON.stringify({ projects: [{ project: projectPath, cells: [{ clip: 'idle', cell: 99, status: 'fail' }] }] }),
      'utf8',
    );
    expect(() => run(incomplete, ['--baseline', missing])).toThrow();
    expect(existsSync(incomplete)).toBe(false);
    for (const { file, bytes } of originals) expect(readFileSync(join(inputs, file))).toEqual(bytes);
  }, 30000);
});
