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
  /** INTERIM mob standees (MobArt.ts), packed into the SAME pages as the props so the Y-sort batches them together */
  mobs?: Record<string, MobSprite>;
  /** INTERIM Son Mon NPC standees by key (npc_<name>), same atlas page; front-facing, not flipped */
  npcs?: Record<string, NpcSprite & { f2: AtlasFrame; f1: AtlasFrame }>;
  /** 9-slice UI frames (panel_jade, button_normal, button_disabled, slot_frame): size and slice insets in @1x design px */
  ui?: Record<
    string,
    { w: number; h: number; inset: [number, number, number, number]; f2: AtlasFrame; f1: AtlasFrame }
  >;
}
export interface NpcSprite {
  w: number;
  h: number;
  pivot: { x: number; y: number };
}
export interface MobSprite {
  id: number;
  w: number;
  h: number;
  pivot: { x: number; y: number };
  f2: AtlasFrame;
  f1: AtlasFrame;
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
  private readonly mobById = new Map<number, { entry: MobSprite; frame: SpriteFrame }>();
  private readonly npcByKey = new Map<string, { entry: NpcSprite; frame: SpriteFrame }>();
  private readonly uiFrames = new Map<string, SpriteFrame>();
  /** node scale that maps the UI atlas page's pixels to design px: 0.5 on the @2x page, 1 on the @1x page */
  private uiK = 0.5;

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
      // mob standees: same page (same Texture2D) as the props
      for (const m of Object.values(meta.mobs ?? {})) {
        const f = low ? m.f1 : m.f2;
        art.mobById.set(m.id, { entry: m, frame: makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h) });
      }
      for (const [key, n] of Object.entries(meta.npcs ?? {})) {
        const f = low ? n.f1 : n.f2;
        art.npcByKey.set(key, { entry: n, frame: makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h) });
      }
      // 9-slice UI frames: insets are in the frame's own pixels (x2 on the @2x page)
      art.uiK = low ? 1 : 0.5;
      for (const [key, u] of Object.entries(meta.ui ?? {})) {
        const f = low ? u.f1 : u.f2;
        const sf = makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h);
        const k = low ? 1 : 2;
        sf.insetLeft = u.inset[0] * k;
        sf.insetTop = u.inset[1] * k;
        sf.insetRight = u.inset[2] * k;
        sf.insetBottom = u.inset[3] * k;
        art.uiFrames.set(key, sf);
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

  /** INTERIM mob standee sprite by mob wire id (MOB_DEFS id), or undefined. */
  mob(id: number): { entry: MobSprite; frame: SpriteFrame } | undefined {
    return this.mobById.get(id);
  }

  /** INTERIM NPC standee sprite by key (npc_chuong_mon, ...), or undefined. */
  npc(key: string): { entry: NpcSprite; frame: SpriteFrame } | undefined {
    return this.npcByKey.get(key);
  }

  /** node scale mapping the UI atlas page to design px (0.5 on the @2x page) */
  get uiScale(): number {
    return this.uiK;
  }

  /** A 9-slice frame by key (`panel_jade`, `button_normal`, `button_disabled`, `slot_frame`), or null when the art is missing. */
  uiFrame(key: string): SpriteFrame | null {
    return this.uiFrames.get(key) ?? null;
  }

  /**
   * Adds a 9-slice frame node under `parent` covering `w` x `h` design px, centred on the parent's origin. `scale` shrinks the border
   * ornaments (0.5 = half size). Cocos draws slice borders at native pixels, so the node runs at `uiK * scale` with a content size
   * enlarged by the inverse. Returns null when the frame is not available (callers keep their flat quad).
   */
  slice(parent: Node, name: string, key: string, w: number, h: number, scale = 1): UiSlice | null {
    const frame = this.uiFrame(key);
    return frame ? new UiSlice(parent, name, frame, this, w, h, scale) : null;
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
    ysort.add(n, () => key, Math.max(h, w / 2) + 30);
    return n;
  }
}

/** A 9-slice UI frame instance (see `PropArt.slice`). */
export class UiSlice {
  readonly node: Node;
  private readonly sprite: Sprite;
  private readonly s: number;

  constructor(
    parent: Node,
    name: string,
    frame: SpriteFrame,
    private readonly art: PropArt,
    w: number,
    h: number,
    scale: number,
  ) {
    this.s = art.uiScale * scale;
    this.node = newNode(name, parent);
    this.node.setScale(this.s, this.s, 1);
    const ui = this.node.addComponent(UITransform);
    ui.setContentSize(w / this.s, h / this.s);
    this.sprite = this.node.addComponent(Sprite);
    this.sprite.type = Sprite.Type.SLICED;
    this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.sprite.spriteFrame = frame;
  }

  /** Swap to another frame of the family (e.g. button_normal <-> button_disabled) without changing the size. */
  setKey(key: string): void {
    const f = this.art.uiFrame(key);
    if (f) this.sprite.spriteFrame = f;
  }

  setSize(w: number, h: number): void {
    this.node.getComponent(UITransform)!.setContentSize(w / this.s, h / this.s);
  }
}
