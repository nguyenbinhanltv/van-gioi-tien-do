/**
 * Loader for the committed Kiếm tu rig data (`tools/rig/data/kiem-tu.*.json`, atlases under `assets-src/`). Node only
 * (reads files); the pure toolkit modules never touch the file system.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRAWN_DIRECTIONS, type Direction } from '@vgtd/shared';
import type { AtlasData, RigDocument, RigSet } from './schema.js';
import { validateRigSet, type RigIssue } from './validate.js';
import { KIEMTU_REQUIRED_ROLES } from './kiemtu.js';
import { characterPaths, type CharacterId } from './classes.js';

export interface KiemTuDirectionData {
  readonly direction: Direction;
  readonly rig: RigDocument;
  readonly atlas: AtlasData;
  /** Absolute path of the atlas PNG (premultiplied alpha). */
  readonly texturePath: string;
}

interface AssetsManifest {
  readonly id: string;
  readonly rig: string;
  readonly directions: Readonly<Record<string, { readonly atlas: string; readonly texture: string }>>;
}

/** Read the manifest, the RigSet and the per-direction atlas descriptions under `repoRoot`. Throws on invalid rigs. */
export function loadKiemTuData(repoRoot: string) {
  return loadCharacterData(repoRoot, 'kiem-tu');
}

/** Same loader for any registered character: `tools/rig/data/<id>.assets.json` (see `characterPaths`). */
export function loadCharacterData(
  repoRoot: string,
  character: CharacterId,
): {
  id: string;
  byDirection: Map<Direction, KiemTuDirectionData>;
  issues: RigIssue[];
} {
  const manifestFile = join(repoRoot, characterPaths(character).manifest);
  if (!existsSync(manifestFile))
    throw new Error(`no rig data for '${character}' yet (${characterPaths(character).manifest})`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8')) as AssetsManifest;
  const set = JSON.parse(readFileSync(join(repoRoot, manifest.rig), 'utf-8')) as RigSet;
  const issues = validateRigSet(set, { requireRoles: KIEMTU_REQUIRED_ROLES });
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length)
    throw new Error(`${character} rig set is invalid:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  const byDirection = new Map<Direction, KiemTuDirectionData>();
  for (const d of DRAWN_DIRECTIONS) {
    const rig = set.rigs[d];
    const files = manifest.directions[d];
    if (!rig || !files) continue;
    const atlas = JSON.parse(readFileSync(join(repoRoot, files.atlas), 'utf-8')) as AtlasData;
    byDirection.set(d, { direction: d, rig, atlas, texturePath: join(repoRoot, files.texture) });
  }
  return { id: manifest.id, byDirection, issues };
}
