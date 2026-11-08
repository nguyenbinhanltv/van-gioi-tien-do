import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/measure.ts', ...args], {
    cwd: pkgDir,
    encoding: 'utf-8',
  });

describe('rig:measure CLI', () => {
  it('prints the machine-readable table for one direction and fails --strict while seams are open', () => {
    const ok = run('kiem-tu', '--dir', 'E', '--json');
    expect(ok.status, ok.stderr).toBe(0);
    const out = JSON.parse(ok.stdout) as {
      character: string;
      limitPx: number;
      rows: { direction: string; clips: number; seamOpenings: number; vertices: number }[];
      underpaint: Record<string, { extendPx: number }[]>;
    };
    expect(out.character).toBe('kiem-tu');
    expect(out.limitPx).toBe(3);
    expect(out.rows.map((r) => r.direction)).toEqual(['E']);
    expect(out.rows[0]!.clips).toBe(15);
    expect(out.rows[0]!.vertices).toBeGreaterThan(0);
    expect(out.underpaint.E!.length).toBeLessThanOrEqual(8);
    // --strict must agree with the table (clean data exits 0, open seams / torn / stretched exit 1)
    const r = out.rows[0] as (typeof out.rows)[0] & { tornClips: number; stretchEvents: number };
    const dirty = r.seamOpenings > 0 || r.tornClips > 0 || r.stretchEvents > 0;
    expect(run('kiem-tu', '--dir', 'E', '--strict').status).toBe(dirty ? 1 : 0);
  }, 120000);

  it('rejects unknown arguments and characters without data', () => {
    expect(run('--bogus').status).not.toBe(0);
    const none = run('the-tu');
    expect(none.status).not.toBe(0);
    expect(none.stderr).toMatch(/no rig data for 'the-tu'/);
  }, 120000);

  it('human table lists the underpaint rows', () => {
    const r = run('kiem-tu', '--dir', 'S', '--top', '2');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/dir \| clips \| seam openings/);
    expect(r.stdout).toMatch(/underpaint needed/);
    expect(r.stdout).toMatch(/result: NOT clean/);
  }, 120000);
});
