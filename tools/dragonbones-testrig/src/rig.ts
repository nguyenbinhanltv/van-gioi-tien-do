import type { Direction } from '@vgtd/shared';
import { packAtlas, type Atlas } from './atlas.js';
import { exportAtlas, exportSkeleton } from './dragonbones.js';
import { buildNeutralRig, type NeutralRig } from './neutral.js';
import { buildParts } from './parts.js';
import { encodePng } from './png.js';

export interface GeneratedRig {
  readonly direction: Direction;
  /** Armature / file stem, e.g. `rig_S` -> `rig_S_ske.json`, `rig_S_tex.json`, `rig_S_tex.png`. */
  readonly name: string;
  /** DragonBones 5.5 skeleton data (`*_ske.json`). */
  readonly ske: string;
  /** DragonBones texture atlas data (`*_tex.json`). */
  readonly tex: string;
  /** Premultiplied-alpha atlas page (`*_tex.png`). */
  readonly png: Uint8Array;
  readonly atlasInfo: Atlas;
  readonly neutral: NeutralRig;
}

/** One armature + atlas for one real direction (docs/21 section 9: one skeleton per drawn direction). */
export function generateRig(direction: Direction): GeneratedRig {
  const neutral = buildNeutralRig(direction);
  const atlas = packAtlas(buildParts(direction));
  return {
    direction,
    name: neutral.name,
    ske: exportSkeleton(neutral),
    tex: exportAtlas(neutral, atlas.page.width, atlas.regions),
    png: encodePng(atlas.page),
    atlasInfo: atlas,
    neutral,
  };
}
