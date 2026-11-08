import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
describe('D55 reproducible control report', () => {
  it('reports all five controls, proves full-QA scale rejection, and protects unrelated output', () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url)),
      dir = mkdtempSync(join(tmpdir(), 'vgtd-controls-'));
    const run = (out: string) =>
      execFileSync(
        process.execPath,
        [
          join(repo, 'tools/rig/scripts/run-ts.mjs'),
          join(repo, 'tools/sprite/scripts/audit-similarity-controls.ts'),
          '--out',
          out,
        ],
        { cwd: repo, env: { ...process.env, INIT_CWD: repo }, stdio: 'pipe' },
      );
    const out = join(dir, 'controls.json');
    run(out);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(report.controls.map((c: { name: string }) => c.name)).toEqual([
      'other-class-head',
      'wrong-torso',
      'mirrored-head',
      'head-scale-85',
      'hue-head',
    ]);
    expect(report.controls.find((c: { name: string }) => c.name === 'head-scale-85').scale.headFindings).toContainEqual(
      expect.objectContaining({ metric: 'head_size_px', severity: 'fail' }),
    );
    const protectedOutput = join(dir, 'other.json');
    writeFileSync(protectedOutput, '{"keep":true}', 'utf8');
    expect(() => run(protectedOutput)).toThrow();
    expect(readFileSync(protectedOutput, 'utf8')).toBe('{"keep":true}');
    expect(report.inputs).toHaveLength(4);
    expect(report.controls.map((c: { outcome: string }) => c.outcome)).toEqual([
      'hard-reject: Lab identity',
      'hard-reject: Lab identity',
      'review-by-eye: temporal flag plus mandatory contact-sheet review',
      'hard-reject: head-size',
      'hard-reject: Lab identity',
    ]);
  }, 30000);
});
