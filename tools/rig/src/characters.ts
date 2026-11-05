/**
 * Per-character viewer export: the same path / naming convention for every class (docs/32 §3):
 * `apps/client-cocos/assets/resources/dragonbones/<id>/<stem>_<DIR>_{ske,tex}.json + _tex.png`,
 * opened with `#viewer&src=dragonbones/<id>&stem=<stem>`.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { authorClassSet } from './class-clips.js';
import { characterPaths, getClass, type CharacterId } from './classes.js';
import { loadCharacterData } from './data.js';
import { buildCharacterPackage, type PackageResult } from './pipeline.js';
import type { AtlasData } from './schema.js';

export interface ViewerFile {
  readonly name: string;
  readonly package: PackageResult;
  readonly texturePath: string;
}

/** Author the class set for every direction of the committed data and export it (QA-gated). */
export function buildViewerPackage(repoRoot: string, id: CharacterId): ViewerFile[] {
  const cls = getClass(id);
  const data = loadCharacterData(repoRoot, id);
  return [...data.byDirection].map(([dir, d]) => {
    const name = `${cls.stem}_${dir}`;
    const atlas: AtlasData = { ...d.atlas, imagePath: `${name}_tex.png` };
    const clips = authorClassSet(id, d.rig);
    return {
      name,
      texturePath: d.texturePath,
      package: buildCharacterPackage([{ rig: d.rig, clips }], atlas, {
        name,
        armatureName: () => name,
        qa: { weapon: cls.weapon.slot ? 'one' : 'none' },
      }),
    };
  });
}

/** Write the viewer package; `outDir` is resolved against the repo root (default: the character's viewer folder). */
export function writeViewerPackage(repoRoot: string, id: CharacterId, outDir?: string): string {
  const dir = resolve(repoRoot, outDir ?? characterPaths(id).viewerDir);
  mkdirSync(dir, { recursive: true });
  for (const f of buildViewerPackage(repoRoot, id)) {
    writeFileSync(join(dir, `${f.name}_ske.json`), JSON.stringify(f.package.export.ske));
    writeFileSync(join(dir, `${f.name}_tex.json`), JSON.stringify(f.package.export.tex));
    copyFileSync(f.texturePath, join(dir, `${f.name}_tex.png`));
  }
  return dir;
}
