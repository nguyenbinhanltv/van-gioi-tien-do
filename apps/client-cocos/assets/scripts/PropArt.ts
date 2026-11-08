import { ImageAsset, JsonAsset, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
import { footprintSortable, newNode, tileToWorld } from './IsoAdapter';
import { allocSortId } from './Actors';
import { makeFrame, makeTexture } from './PlaceholderArt';
import type { YSortLayer } from './YSortLayer';
import type { PlacedProp, PropDef } from './PropPlacement';

/** One packed frame of the sidecar written by tools/procgen `gen:gemini` (px in the atlas page). */
interface AtlasFrame {
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PropEntry {
  w2: number;
  h2: number;
  /** Foot point as fractions of the sprite (x from the left, y from the top). */
  pivot: { x: number; y: number };
  block: Array<[number, number]>;
  biomes: string[];
  weight: number;
  spacing?: number;
  f2: AtlasFrame;
  f1: AtlasFrame;
}
interface Sidecar {
  props: Record<string, PropEntry>;
  icons: Record<string, { f2: AtlasFrame; f1: AtlasFrame }>;
  /** skill icons by skill id (packages/shared skills.json) */
  skills?: Record<string, { path: string; index: number; f2: AtlasFrame; f1: AtlasFrame }>;
}

function loadAsset<T extends JsonAsset | ImageAsset>(path: string, type: new () => T): Promise<T | null> {
  return new Promise((resolve) => resources.load(path, type, (err, asset) => resolve(err || !asset ? null : asset)));
}

let current: PropArt | null = null;

/**
 * Skill icon for the hotbar / skill UI: `getSkillIcon('kiem_khi_tram')` -> SpriteFrame (square tile, 64 design px) or null
 * (art not generated, or an id without an icon): the caller keeps its text / colour fallback. Available once `PropArt.load`
 * has resolved (Bootstrap does that before the HUD is built).
 */
export function getSkillIcon(id: string): SpriteFrame | null {
  return current?.skill(id) ?? null;
}

/**
 * Owner-provided Gemini props (D-less art asset: assets-src/gemini, ASSET-LICENSES.md) and item icons, packed by
 * `npm run gen:gemini -w @vgtd/procgen` into `resources/world/` (generated, git-ignored). Props are ONE atlas page so
 * the whole L3 prop set batches. `tier low` uses the @1x page (drawn 1:1), medium / high the @2x page drawn at 0.5
 * (sharp at the 1.5x-2.0x camera zoom, D81). Everything is optional: `load()` resolves null when the assets were not
 * generated (no LFS / `--allow-missing`) and the caller falls back to the placeholder tree / rock.
 */
export class PropArt {
  private readonly frames = new Map<string, SpriteFrame>();
  private readonly iconFrames = new Map<string, SpriteFrame>();
  private readonly skillFrames = new Map<string, SpriteFrame>();

  private constructor(
    private readonly meta: Sidecar,
    /** frame px -> design px */
    private readonly k: number,
    private readonly use2x: boolean,
  ) {}

  static async load(low: boolean): Promise<PropArt | null> {
    const sidecar = await loadAsset('world/gemini', JsonAsset);
    if (!sidecar) return null;
    const meta = sidecar.json as unknown as Sidecar;
    const art = new PropArt(meta, low ? 1 : 0.5, !low);
    const pageOf = (f: AtlasFrame) => `world/${f.file.replace(/\.png$/, '')}`;
    const textures = new Map<string, ReturnType<typeof makeTexture>>();
    const texture = async (page: string) => {
      let t = textures.get(page);
      if (!t) {
        const img = await loadAsset(page, ImageAsset);
        if (!img) throw new Error(`missing atlas page ${page}`);
        t = makeTexture(img);
        textures.set(page, t);
      }
      return t;
    };
    try {
      for (const [name, p] of Object.entries(meta.props)) {
        const f = low ? p.f1 : p.f2;
        art.frames.set(name, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
      }
      // item icons: always the @2x page (512 px, 1 MB); icons are drawn at <= 64 design px
      for (const [key, ic] of Object.entries(meta.icons)) {
        art.iconFrames.set(key, makeFrame(await texture(pageOf(ic.f2)), ic.f2.x, ic.f2.y, ic.f2.w, ic.f2.h));
      }
      // skill icons (hotbar): the @2x page (1024 px, 4 MB) is drawn at <= 64 design px; `tier low` takes the @1x page
      for (const [id, sk] of Object.entries(meta.skills ?? {})) {
        const f = low ? sk.f1 : sk.f2;
        art.skillFrames.set(id, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
      }
    } catch (e) {
      console.warn('[vgtd] gemini art unavailable, using placeholders:', e);
      return null;
    }
    current = art;
    return art;
  }

  /** Block / biome data in the shape `placeProps` takes. */
  defs(): Record<string, PropDef> {
    const out: Record<string, PropDef> = {};
    for (const [n, p] of Object.entries(this.meta.props))
      out[n] = { block: p.block, biomes: p.biomes, weight: p.weight, spacing: p.spacing };
    return out;
  }

  /** Skill icon by skill id (e.g. `kiem_khi_tram`), or null when missing. Square; draw it at 64 design px. */
  skill(id: string): SpriteFrame | null {
    return this.skillFrames.get(id) ?? null;
  }

  /** Item icon (key = item key such as `heal_pill`, `stone_low`), or null when missing. */
  icon(key: string): SpriteFrame | null {
    return this.iconFrames.get(key) ?? null;
  }

  /** Sprite size in design px (the 1x tile is 64 px wide). */
  sizeOf(name: string): { w: number; h: number } {
    const p = this.meta.props[name]!;
    return { w: (this.use2x ? p.w2 : p.w2 / 2) * this.k, h: (this.use2x ? p.h2 : p.h2 / 2) * this.k };
  }

  /** Creates the sprite node of a placed prop on the Y-sort layer. */
  add(ysort: YSortLayer, placed: PlacedProp): Node {
    const p = this.meta.props[placed.name]!;
    const { w, h } = this.sizeOf(placed.name);
    const n = newNode(`${placed.name}${placed.i},${placed.j}`);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(w, h);
    ui.setAnchorPoint(p.pivot.x, 1 - p.pivot.y); // Cocos anchor y is up
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = this.frames.get(placed.name)!;
    // foot = centre of the blocked footprint (anchor tile centre when it blocks nothing or is symmetric)
    let mi = 0,
      mj = 0;
    for (const [di, dj] of p.block) {
      mi += di;
      mj += dj;
    }
    const c = p.block.length || 1;
    n.setPosition(tileToWorld(placed.i + 0.5 + mi / c, placed.j + 0.5 + mj / c));
    // draw order: the blocked footprint when it is small (<= 2x2); wide objects (the gate) sort by their anchor tile
    // so a walker in the passage is drawn behind the lintel when north of it and in front when south
    let i0 = placed.i,
      j0 = placed.j,
      fw = 1,
      fh = 1;
    if (p.block.length) {
      const is = p.block.map((b) => b[0]),
        js = p.block.map((b) => b[1]);
      const bw = Math.max(...is) - Math.min(...is) + 1,
        bh = Math.max(...js) - Math.min(...js) + 1;
      if (bw <= 2 && bh <= 2) {
        i0 = placed.i + Math.min(...is);
        j0 = placed.j + Math.min(...js);
        fw = bw;
        fh = bh;
      }
    }
    const key = footprintSortable(allocSortId(), 0, i0, j0, fw, fh);
    ysort.add(n, () => key);
    return n;
  }
}
