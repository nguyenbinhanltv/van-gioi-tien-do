import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createImage, encodePng } from '@vgtd/rig';
import { type Project } from '../src/index.js';
import { makeMaster } from './helpers.js';

describe('D54 report-only head similarity audit', () => {
  it('reports pass/fail per formerly skipped cell, preserves sources and protects non-report outputs', () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-head-audit-'));
    const inputs = join(dir, 'inputs');
    mkdirSync(inputs);
    const master = makeMaster();
    const wrong = createImage(256, 256);
    for (let i = 0; i < wrong.data.length; i += 4) wrong.data.set([0, 255, 0, 255], i);
    writeFileSync(join(inputs, 'master.png'), encodePng(master));
    writeFileSync(join(inputs, 'wrong.png'), encodePng(wrong));
    const project: Project = {
      character: 'audit-fixture',
      direction: 'E',
      stem: 'audit',
      master: 'master.png',
      scale: 1,
      clips: [
        {
          name: 'idle',
          frames: 1,
          cols: 1,
          durationSec: 1,
          loop: false,
          kind: 'upright',
          sheet: 'master.png',
          exceptions: { 0: 'posture' },
        },
        {
          name: 'bad',
          frames: 1,
          cols: 1,
          durationSec: 1,
          loop: false,
          kind: 'free',
          sheet: 'wrong.png',
          exceptions: { 0: 'rear-skull-base' },
        },
        {
          name: 'emote',
          frames: 1,
          cols: 1,
          durationSec: 1,
          loop: false,
          kind: 'upright',
          sheet: 'wrong.png',
          exceptions: { 0: 'bow: neck and torso incline' },
        },
      ],
    };
    const projectPath = join(inputs, 'project.json');
    writeFileSync(projectPath, JSON.stringify(project));
    const originals = ['master.png', 'wrong.png', 'project.json'].map((file) => ({
      file,
      bytes: readFileSync(join(inputs, file)),
    }));
    const run = (out: string) =>
      execFileSync(
        process.execPath,
        [
          join(repo, 'tools/rig/scripts/run-ts.mjs'),
          join(repo, 'tools/sprite/scripts/audit-head-similarity.ts'),
          '--root',
          inputs,
          '--out',
          out,
        ],
        { cwd: repo, env: { ...process.env, INIT_CWD: repo }, stdio: 'pipe' },
      );
    const output = join(dir, 'audit.json');
    run(output);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(report.totals).toEqual({ projects: 1, cells: 2, pass: 1, fail: 1, unmeasured: 0 });
    expect(report.selection).toEqual({ oldSkippedCells: 3, newlyCheckedCells: 2, retainedD41PoseCells: 1 });
    expect(report.retainedD41PoseExemptions).toEqual([
      expect.objectContaining({ clip: 'emote', cell: 0, kind: 'upright', reason: 'bow: neck and torso incline' }),
    ]);
    expect(report.projects[0].cells).toEqual([
      { clip: 'idle', cell: 0, reason: 'posture', status: 'pass', findings: [] },
      expect.objectContaining({ clip: 'bad', cell: 0, reason: 'rear-skull-base', status: 'fail' }),
    ]);
    expect(readFileSync(output.replace(/\.json$/, '.md'), 'utf8')).toContain(
      '| audit-fixture / E | bad | 0 | rear-skull-base | FAIL',
    );
    expect(() => run(projectPath)).toThrow();
    const protectedOutput = join(dir, 'other.json');
    writeFileSync(protectedOutput, '{"keep":true}');
    expect(() => run(protectedOutput)).toThrow();
    expect(readFileSync(protectedOutput, 'utf8')).toBe('{"keep":true}');
    for (const { file, bytes } of originals) expect(readFileSync(join(inputs, file))).toEqual(bytes);
  }, 30000);
});
