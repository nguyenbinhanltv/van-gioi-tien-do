import { JsonAsset, dragonBones, resources } from 'cc';
import { character } from '../vendor/vgtd.mjs';
import type { Direction } from './ViewerModel';

export interface LayeredRigAssets {
  readonly ske: dragonBones.DragonBonesAsset;
  readonly tex: dragonBones.DragonBonesAtlasAsset;
  readonly textures: readonly dragonBones.DragonBonesAtlasAsset[];
  readonly armatureName?: string;
  readonly owned?: boolean;
  readonly motionId?: string;
}
interface AtlasJson {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly premultipliedAlpha?: boolean;
  readonly SubTexture: readonly { readonly name: string }[];
}
let serial = 0;

export function validateLayerResourceFolder(folder: string): void {
  if (!/^[\w-]+(?:\/[\w-]+)*$/.test(folder)) throw new Error('invalid layered resource folder');
}
function loadAsset<T>(path: string, type: new () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    resources.load(path, type as never, (error: Error | null, asset: unknown) =>
      error || !asset ? reject(error ?? new Error(`cannot load ${path}`)) : resolve(asset as T),
    ),
  );
}
/** Only manually composed assets belong to this loader; original resources remain managed by Cocos. */
export function disposeLayeredRig(rig: LayeredRigAssets | null): void {
  if (!rig?.owned) return;
  rig.ske.destroy();
  rig.tex.destroy();
}

/** Selected sets only. Manifest promises are deduplicated; Cocos resources own the shared source textures. */
export class LayeredSpriteAssets {
  private readonly cache: character.SpriteLayerCache;
  constructor(readonly folder: string) {
    validateLayerResourceFolder(folder);
    this.cache = new character.SpriteLayerCache(async (id, direction) => {
      const asset = await loadAsset(`${folder}/${id}/${id}_${direction}.layer`, JsonAsset);
      return asset.json as character.SpriteLayerSet;
    });
  }
  get cacheEntries(): number {
    return this.cache.size;
  }
  clear(): void {
    this.cache.clear();
  }

  async compose(selection: character.ResolvedEquipmentVisuals, direction: Direction): Promise<LayeredRigAssets> {
    const [body, weapon, fx] = await Promise.all([
      this.cache.get(selection.bodySet, direction),
      this.cache.get(selection.weaponSet, direction),
      selection.fxSet ? this.cache.get(selection.fxSet, direction) : Promise.resolve(undefined),
    ]);
    const name = `vgtd_layers_${++serial}_${direction}`;
    const composition = character.composeSpriteLayers({
      name,
      body,
      weapon,
      ...(fx ? { fx, glowTint: selection.glowTint } : {}),
    });
    const sets = [body, weapon, ...(fx ? [fx] : [])];
    const pages = await Promise.all(
      composition.textures.map(async (page) => {
        const asset = await loadAsset(
          `${this.folder}/${page.setId}/${page.resource}`,
          dragonBones.DragonBonesAtlasAsset,
        );
        const texture = asset.texture;
        if (!texture) throw new Error(`layer texture missing: ${page.resource}`);
        const raw = JSON.parse(asset.atlasJson) as AtlasJson;
        if (raw.premultipliedAlpha !== true || raw.width !== texture.width || raw.height !== texture.height)
          throw new Error(`invalid PMA layer atlas dimensions: ${page.resource}`);
        const set = sets.find((s) => s.id === page.setId && s.role === page.role)!;
        return { asset, texture, data: character.namespaceSpriteLayerAtlas(raw, set) };
      }),
    );
    if (!pages.length) throw new Error('layer composition has no texture pages');
    const regions = pages.flatMap((page) => page.data.SubTexture.map((r) => r.name));
    if (new Set(regions).size !== regions.length) throw new Error('duplicate namespaced layer texture regions');
    const lookup = new Set(regions);
    for (const set of sets)
      for (const display of set.displays)
        if (!lookup.has(`${character.spriteLayerTexturePrefix(set)}${display.region}`))
          throw new Error(`missing layer texture region: ${set.id}/${display.region}`);
    const tex = new dragonBones.DragonBonesAtlasAsset(),
      ske = new dragonBones.DragonBonesAsset();
    try {
      tex.atlasJson = JSON.stringify({ ...pages[0]!.data, name });
      tex.texture = pages[0]!.texture;
      const factory = dragonBones.CCFactory.getInstance();
      tex.init(factory);
      for (const page of pages.slice(1)) factory.parseTextureAtlasData(page.data, page.texture, tex.uuid);
      ske.dragonBonesJson = JSON.stringify(composition.skeleton);
      return {
        ske,
        tex,
        textures: pages.map((p) => p.asset),
        armatureName: name,
        owned: true,
        motionId: body.motionId,
      };
    } catch (error) {
      ske.destroy();
      tex.destroy();
      throw error;
    }
  }
}
