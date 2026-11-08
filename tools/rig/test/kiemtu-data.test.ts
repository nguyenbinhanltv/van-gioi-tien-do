import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  KIEMTU_CLIPS,
  authorKiemTuSet,
  buildCharacterPackage,
  loadKiemTuData,
  pieceTable,
  type AtlasData,
} from '../src/index.js';
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

  it('has no scabbard piece (its painted sword would double the drawn one; see rig-pipeline.md section 11)', () => {
    for (const [dir, d] of data.byDirection) {
      const bones = [...pieceTable(d.rig).values()].map((p) => p.bone);
      expect(bones, dir).not.toContain('scabbard');
    }
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

/** Where the viewer reads the Kiếm tu package (docs/32 §3). */
const COMMITTED_DIR = join(repoRoot, 'apps/client-cocos/assets/resources/dragonbones/kiem-tu');

/** Relative RIG_EXPORT_DIR is resolved against the repo root (npm runs the tests with cwd = tools/rig). */
const exportDir = process.env.RIG_EXPORT_DIR ? resolve(repoRoot, process.env.RIG_EXPORT_DIR) : undefined;

/** The viewer files generated from the committed rig data and the current animation code. */
function generate() {
  const data = loadKiemTuData(repoRoot);
  return [...data.byDirection].map(([dir, d]) => {
    const name = `${VIEWER_STEM}_${dir}`;
    const atlas: AtlasData = { ...d.atlas, imagePath: `${name}_tex.png` };
    const pkg = buildCharacterPackage([{ rig: d.rig, clips: authorKiemTuSet(d.rig) }], atlas, {
      name,
      armatureName: () => name,
    });
    return { name, pkg, texturePath: d.texturePath };
  });
}

describe('committed viewer export', () => {
  it('matches a fresh export (run `npm run export:kiemtu -w @vgtd/rig` after changing the rig or animations)', () => {
    for (const { name, pkg, texturePath } of generate()) {
      for (const [suffix, json] of [
        ['ske', pkg.export.ske],
        ['tex', pkg.export.tex],
      ] as const) {
        const file = join(COMMITTED_DIR, `${name}_${suffix}.json`);
        expect(existsSync(file), `${file} is missing`).toBe(true);
        expect(JSON.parse(readFileSync(file, 'utf-8')), `${name}_${suffix}.json is stale`).toEqual(json);
      }
      const png = join(COMMITTED_DIR, `${name}_tex.png`);
      expect(existsSync(png), `${png} is missing`).toBe(true);
      expect(readFileSync(png).equals(readFileSync(texturePath)), `${name}_tex.png differs from the atlas`).toBe(true);
    }
  });
});

/**
 * Writes the viewer-ready package (opt-in). The path may be relative to the repo root:
 *   RIG_EXPORT_DIR=apps/client-cocos/assets/resources/dragonbones/kiem-tu npm run export:kiemtu -w @vgtd/rig
 */
(exportDir ? describe : describe.skip)('export Kiếm tu for the Cocos viewer', () => {
  it('writes <stem>_<DIR>_ske.json, _tex.json and _tex.png for S, SE, E, NE, N', async () => {
    mkdirSync(exportDir!, { recursive: true });
    for (const { name, pkg, texturePath } of generate()) {
      writeFileSync(join(exportDir!, `${name}_ske.json`), JSON.stringify(pkg.export.ske));
      writeFileSync(join(exportDir!, `${name}_tex.json`), JSON.stringify(pkg.export.tex));
      copyFileSync(texturePath, join(exportDir!, `${name}_tex.png`));
      if (engineRuntimePath()) {
        const loaded = (await loadRuntime()).load(pkg.export.ske, pkg.export.tex);
        expect(loaded.armatures).toEqual([name]);
        const armature = loaded.build(name);
        expect(armature.animation.animationNames.length).toBe(KIEMTU_CLIPS.length);
      }
    }
  });
});
