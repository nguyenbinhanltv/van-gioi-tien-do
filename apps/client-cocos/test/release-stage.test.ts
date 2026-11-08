import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { DEV_ONLY, stageReleaseProject, stagedFiles } from '../scripts/release-stage.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'vgtd-stage-test-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const put = (root: string, rel: string, size = 3) => {
  const f = join(root, rel);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, 'x'.repeat(size));
};
const tree = (dir: string, base = dir, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) tree(f, base, out);
    else
      out.push(
        f
          .slice(base.length + 1)
          .split(sep)
          .join('/'),
      );
  }
  return out.sort();
};

describe('release stage', () => {
  it('leaves the dev-only art out and keeps everything the game needs', () => {
    expect(
      stagedFiles([
        'assets/resources/dragonbones/viewer/x.json',
        'assets/resources/dragonbones.meta',
        'assets/resources/dragonbones-extra/keep.json',
        'assets/resources/world/iso-map.json',
        'assets/chibi/chibi-the-tu-s/full/a.png',
        'assets/scripts/Bootstrap.ts',
        'library/ab/x.json',
        'build/web-mobile/index.html',
        'settings/v2/packages/builder.json',
        'package.json',
      ]),
    ).toEqual([
      'assets/resources/dragonbones-extra/keep.json',
      'assets/resources/world/iso-map.json',
      'assets/chibi/chibi-the-tu-s/full/a.png',
      'assets/scripts/Bootstrap.ts',
      'settings/v2/packages/builder.json',
      'package.json',
    ]);
    expect(DEV_ONLY).toContain('assets/resources/dragonbones');
  });

  it('mirrors incrementally, reports the saving, and drops stale files but keeps stage-made metas', () => {
    const root = join(TMP, 'proj');
    const stage = join(TMP, 'stage');
    put(root, 'package.json');
    put(root, 'assets/scripts/A.ts');
    put(root, 'assets/resources/world/m.json');
    put(root, 'assets/resources/dragonbones/v/big.png', 1000);
    put(root, 'library/cache.bin');
    const a = stageReleaseProject(root, stage);
    expect(tree(stage)).toEqual(['assets/resources/world/m.json', 'assets/scripts/A.ts', 'package.json']);
    expect(a.skippedBytes).toBe(1000);
    expect(a.copied).toBe(3);
    // the editor writes a meta in the stage and library/ is the stage's own cache: both survive a re-sync
    put(stage, 'assets/scripts/A.ts.meta');
    put(stage, 'library/own.bin');
    put(stage, 'assets/scripts/Gone.ts');
    const b = stageReleaseProject(root, stage);
    expect(b.copied).toBe(0);
    expect(b.removed).toBe(1);
    expect(tree(stage)).toEqual([
      'assets/resources/world/m.json',
      'assets/scripts/A.ts',
      'assets/scripts/A.ts.meta',
      'library/own.bin',
      'package.json',
    ]);
  });
});
