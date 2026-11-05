import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KIEMTU_CLIPS, authorKiemTuSet, buildCharacterPackage, loadKiemTuData, type AtlasData } from '../src/index.js';
import { engineRuntimePath, loadRuntime } from './helpers/dbRuntime.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** File naming contract of the Cocos viewer (docs/32 §3): <stem>_<DIR>_ske.json / _tex.json / _tex.png. */
export const VIEWER_STEM = 'kiemtu';

describe('real Kiếm tu data (tools/rig/data)', () => {
  const data = loadKiemTuData(repoRoot);

  it('is a valid RigSet for all 5 drawn directions', () => {
    expect([...data.byDirection.keys()]).toEqual(['S', 'SE', 'E', 'NE', 'N']);
    expect(data.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('every clip of the set passes QA on every direction and exports to DragonBones', () => {
    for (const [dir, d] of data.byDirection) {
      const clips = authorKiemTuSet(d.rig);
      expect(clips.map((c) => c.name)).toEqual([...KIEMTU_CLIPS]);
      const name = `${VIEWER_STEM}_${dir}`;
      const pkg = buildCharacterPackage(
        [{ rig: d.rig, clips }],
        { ...d.atlas, imagePath: `${name}_tex.png` },
        { name, armatureName: () => name },
      );
      expect(
        pkg.reports.every((r) => r.errors === 0),
        dir,
      ).toBe(true);
      const arm = (pkg.export.ske.armature as { name: string; animation: unknown[] }[])[0]!;
      expect(arm.name).toBe(name);
      expect(arm.animation.length).toBe(KIEMTU_CLIPS.length);
    }
  });
});

const exportDir = process.env.RIG_EXPORT_DIR;

/**
 * Writes the viewer-ready package (opt-in): RIG_EXPORT_DIR=apps/client-cocos/assets/resources/dragonbones/kiem-tu
 *   npm run export:kiemtu -w @vgtd/rig
 */
(exportDir ? describe : describe.skip)('export Kiếm tu for the Cocos viewer', () => {
  it('writes <stem>_<DIR>_ske.json, _tex.json and _tex.png for S, SE, E, NE, N', async () => {
    const data = loadKiemTuData(repoRoot);
    mkdirSync(exportDir!, { recursive: true });
    for (const [dir, d] of data.byDirection) {
      const clips = authorKiemTuSet(d.rig);
      const name = `${VIEWER_STEM}_${dir}`;
      const atlas: AtlasData = { ...d.atlas, imagePath: `${name}_tex.png` };
      const pkg = buildCharacterPackage([{ rig: d.rig, clips }], atlas, { name, armatureName: () => name });
      writeFileSync(join(exportDir!, `${name}_ske.json`), JSON.stringify(pkg.export.ske));
      writeFileSync(join(exportDir!, `${name}_tex.json`), JSON.stringify(pkg.export.tex));
      copyFileSync(d.texturePath, join(exportDir!, `${name}_tex.png`));
      if (engineRuntimePath()) {
        const loaded = (await loadRuntime()).load(pkg.export.ske, pkg.export.tex);
        expect(loaded.armatures).toEqual([name]);
        const armature = loaded.build(name);
        expect(armature.animation.animationNames.length).toBe(KIEMTU_CLIPS.length);
      }
    }
  });
});
