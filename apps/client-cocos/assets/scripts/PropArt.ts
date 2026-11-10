import { ImageAsset, JsonAsset, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
import { footprintSortable, newNode, tileToWorld } from './IsoAdapter';
import { allocSortId } from './Actors';
import { makeFrame, makeTexture } from './PlaceholderArt';
import type { YSortLayer } from './YSortLayer';
import type { PlacedProp, PropDef } from './PropPlacement';
import { itemIconKey } from './ArtRegistry';
import { setDomIconProvider } from './DomIcons';

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
  zones?: string[];
  f2: AtlasFrame;
  f1: AtlasFrame;
}
interface Sidecar {
  props: Record<string, PropEntry>;
  /** item icons (PART 1 items, PART 3 manuals / alchemy): keyed by icon id */
  icons: Record<string, { f2: AtlasFrame; f1: AtlasFrame }>;
  /** skill icons by skill id (packages/shared skills.json) */
  skills?: Record<string, { path: string; index: number; f2: AtlasFrame; f1: AtlasFrame }>;
  /** INTERIM mob standees (MobArt.ts), packed into the SAME pages as the props so the Y-sort batches them together */
  mobs?: Record<string, MobSprite>;
  /** INTERIM Son Mon NPC standees by key (npc_<name>), same atlas page; front-facing, not flipped */
  npcs?: Record<string, NpcSprite & { f2: AtlasFrame; f1: AtlasFrame }>;
  /** boss skins taken at HP thresholds (phase = the NEW phase index of the boss_phase message), same atlas page */
  mobPhases?: Record<string, MobSprite & { phase: number }>;
  /** status icons by status id (tools/procgen manifest.json "status.ids"), PART 2 */
  status?: Record<string, { index: number; f2: AtlasFrame; f1: AtlasFrame }>;
  /** realm badges, keys realm_0 .. realm_8 (0 = Luyen Khi, REALM_NAMES order), PART 2 */
  realms?: Record<string, { index: number; f2: AtlasFrame; f1: AtlasFrame }>;
  /** HUD / social icons by id (`HUD_ICON_IDS` in ArtRegistry.ts), PART 3 group P */
  hud?: Record<string, { index: number; f2: AtlasFrame; f1: AtlasFrame }>;
  /** particle textures by name (ArtRegistry.ts), PART 2 */
  particles?: Record<string, { f2: AtlasFrame; f1: AtlasFrame }>;
  /** PART 3 R: tribulation effects by name (ArtRegistry FX_NAMES), a LAZY page; `pivotY` = ground contact of the strike, fraction of the height */
  fx?: Record<string, { w: number; h: number; pivotY?: number; mode: string; f2: AtlasFrame; f1: AtlasFrame }>;
  /** PART 3 S: equipment icons by weapon type / slot (ArtRegistry EQUIP_ICON_IDS), a LAZY page */
  equip?: Record<string, { index: number; f2: AtlasFrame; f1: AtlasFrame }>;
  /** PART 3 T: minimap markers by id (ArtRegistry MINIMAP_ICON_IDS) */
  mapIcons?: Record<string, { index: number; f2: AtlasFrame; f1: AtlasFrame }>;
  /** PART 3 T: the parchment world map, one texture per tier, loaded when the map panel opens */
  worldMap?: { f2: { file: string; w: number; h: number }; f1: { file: string; w: number; h: number } };
  /** login backdrop + emblem: single textures next to the atlas pages */
  keyArt?: {
    backdrop: { file: string; w: number; h: number };
    emblem: { f2: { file: string; w: number; h: number }; f1: { file: string; w: number; h: number } };
  };
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

/** Login screen art as plain image URLs for the DOM class picker (see `PropArt.keyArt`). */
export interface KeyArtUrls {
  backdrop: string;
  emblem: string;
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

/** URL a DOM <img> / CSS background can use for a loaded image asset (the decoded <img> element's src, else the native URL). */
function imageUrl(img: ImageAsset): string | null {
  const data = img.data as unknown;
  if (typeof HTMLImageElement !== 'undefined' && data instanceof HTMLImageElement && data.src) return data.src;
  const url = (img as unknown as { nativeUrl?: string }).nativeUrl;
  return url || null;
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
 * Status icon for the HUD status row: `getStatusIcon('root')` -> SpriteFrame (round, draw at 32 design px) or null (art not
 * generated, or an id without an icon; the caller keeps its text fallback). Ids: root, slow, poison, burn, stun, shield, meditate,
 * regen, atk_up, def_up, invulnerable, breakthrough_buff (`STATUS_ICON_IDS` in ArtRegistry.ts). Available once `PropArt.load` has resolved.
 */
export function getStatusIcon(id: string): SpriteFrame | null {
  return current?.status(id) ?? null;
}

/**
 * Realm badge for the progression HUD: `getRealmBadge(0)` = Luyen Khi ... `getRealmBadge(8)` = Do Kiep (index into REALM_NAMES, i.e.
 * the server's 1-based realm minus 1), or null. Square frame, draw at 28-40 design px.
 */
export function getRealmBadge(realmIndex: number): SpriteFrame | null {
  return current?.realm(realmIndex) ?? null;
}

/**
 * HUD / social icon (`HUD_ICON_IDS` in ArtRegistry.ts: friend_add, leader, online, close, ...) -> SpriteFrame, round on a dark backing
 * disc (draw at 24-48 design px), or null when the art was not generated. Available once `PropArt.load` has resolved.
 */
export function getHudIcon(id: string): SpriteFrame | null {
  return current?.hud(id) ?? null;
}

/** Particle texture by name (`PARTICLE_NAMES` in ArtRegistry.ts), or null. White / coloured glow, alpha = luminance. */
export function getParticleFrame(name: string): SpriteFrame | null {
  return current?.particle(name) ?? null;
}

/** Start loading the particle textures (see `PropArt.ensureParticles`); resolves at once when the art is not available. */
export function preloadParticles(): Promise<void> {
  return current?.ensureParticles() ?? Promise.resolve();
}

/** Tribulation effect frame by name (`FX_NAMES`): strike / cloud (alpha = luminance) or warning / scorch decal. Null until `preloadFx` resolved. */
export function getFxFrame(name: string): SpriteFrame | null {
  return current?.fx(name) ?? null;
}
/** Size (@1x design px) and ground-contact fraction of an effect frame. */
export function getFxInfo(name: string): { w: number; h: number; pivotY: number } | null {
  return current?.fxInfo(name) ?? null;
}
/** Start loading the tribulation effect page (first Lôi Kiếp / Tâm Ma); resolves at once when the art is not available. */
export function preloadFx(): Promise<void> {
  return current?.ensureFx() ?? Promise.resolve();
}
/** Equipment icon by weapon type or slot id (`EQUIP_ICON_IDS`), neutral art (the UI draws the quality frame). Null until `preloadEquipIcons` resolved. */
export function getEquipIcon(id: string): SpriteFrame | null {
  return current?.equip(id) ?? null;
}
export function preloadEquipIcons(): Promise<void> {
  return current?.ensureEquip() ?? Promise.resolve();
}
/** Minimap marker by id (`MINIMAP_ICON_IDS`), loaded with the initial art; round, draw at 16-24 design px. */
export function getMinimapIcon(id: string): SpriteFrame | null {
  return current?.mapIcon(id) ?? null;
}
/** URL of the parchment world map image for the DOM map panel (loaded on the first call, cached); null when the art was not generated. Aspect ~1:1. */
export function loadWorldMapUrl(): Promise<string | null> {
  return current?.worldMap() ?? Promise.resolve(null);
}
/**
 * The minimap marker sheet for a 2D canvas (the minimap and the map panel are DOM overlays, so they cost no draw call of the world): the
 * decoded page image and the frame of every marker id, or null when the art is not there.
 */
export function getMinimapSheet(): {
  image: CanvasImageSource;
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
} | null {
  return current?.mapSheet() ?? null;
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
  private readonly statusFrames = new Map<string, SpriteFrame>();
  private readonly realmFrames = new Map<string, SpriteFrame>();
  private readonly particleFrames = new Map<string, SpriteFrame>();
  private readonly fxFrames = new Map<string, SpriteFrame>();
  private readonly equipFrames = new Map<string, SpriteFrame>();
  private readonly mapIconFrames = new Map<string, SpriteFrame>();
  private fxLoader: (() => Promise<void>) | null = null;
  private equipLoader: (() => Promise<void>) | null = null;
  private worldMapLoader: (() => Promise<string | null>) | null = null;
  private mapSheetData: {
    image: CanvasImageSource;
    frames: Record<string, { x: number; y: number; w: number; h: number }>;
  } | null = null;
  private readonly hudFrames = new Map<string, SpriteFrame>();
  /** decoded atlas pages (for the DOM icon data URLs) and the data URLs already made */
  private readonly pageImages = new Map<string, ImageAsset>();
  private readonly urlCache = new Map<string, string | null>();
  /** loads the particle page on first use (not at start: particles are VFX, kept out of the initial download) */
  private particleLoader: (() => Promise<void>) | null = null;
  private mobPhaseLoader: (() => Promise<void>) | null = null;
  private mobPhasePromise: Promise<void> | null = null;
  private readonly mobById = new Map<number, { entry: MobSprite; frame: SpriteFrame }>();
  private readonly npcByKey = new Map<string, { entry: NpcSprite; frame: SpriteFrame }>();
  /** mob wire id -> phase -> skin (phase 0 = the base standee) */
  private readonly mobSkinsById = new Map<number, Map<number, { entry: MobSprite; frame: SpriteFrame }>>();
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
        art.pageImages.set(page, img);
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
        const skin = { entry: m, frame: makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h) };
        art.mobById.set(m.id, skin);
        art.mobSkinsById.set(m.id, new Map([[0, skin]]));
      }
      for (const [key, n] of Object.entries(meta.npcs ?? {})) {
        const f = low ? n.f1 : n.f2;
        art.npcByKey.set(key, { entry: n, frame: makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h) });
      }
      // boss phase skins: their own @1x page (both tiers), loaded on first need (`mobSkins`), not in the initial download
      art.mobPhaseLoader = async () => {
        for (const m of Object.values(meta.mobPhases ?? {})) {
          const skins = art.mobSkinsById.get(m.id);
          if (skins)
            skins.set(m.phase, {
              entry: m,
              frame: makeFrame(await texture(pageOf(m.f1)), m.f1.x, m.f1.y, m.f1.w, m.f1.h),
            });
        }
      };
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
      // status icons / realm badges / particles (PART 2): small pages, @2x unless `tier low`
      for (const [id, s] of Object.entries(meta.status ?? {})) {
        const f = low ? s.f1 : s.f2;
        art.statusFrames.set(id, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
      }
      for (const [key, s] of Object.entries(meta.realms ?? {})) {
        const f = low ? s.f1 : s.f2;
        art.realmFrames.set(key, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
      }
      // HUD / social icons (PART 3 group P): small pages, @2x unless `tier low`
      for (const [id, h] of Object.entries(meta.hud ?? {})) {
        const f = low ? h.f1 : h.f2;
        art.hudFrames.set(id, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
      }
      // particles: loaded on demand (`ensureParticles`), not here
      art.particleLoader = async () => {
        for (const [name, s] of Object.entries(meta.particles ?? {})) {
          const f = low ? s.f1 : s.f2;
          art.particleFrames.set(name, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
        }
      };
      // PART 3: minimap markers with the initial art (a 125 KB page); tribulation effects and equipment icons are lazy pages
      for (const [id, s] of Object.entries(meta.mapIcons ?? {})) {
        const f = low ? s.f1 : s.f2;
        art.mapIconFrames.set(id, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
      }
      {
        // the same page as a plain image for the 2D-canvas minimap
        const first = Object.values(meta.mapIcons ?? {})[0];
        const page = first ? (low ? first.f1 : first.f2) : null;
        const img = page ? await loadAsset(pageOf(page), ImageAsset) : null;
        const data = img?.data as unknown;
        if (img && data && typeof data === 'object') {
          const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
          for (const [id, s] of Object.entries(meta.mapIcons ?? {})) {
            const f = low ? s.f1 : s.f2;
            frames[id] = { x: f.x, y: f.y, w: f.w, h: f.h };
          }
          art.mapSheetData = { image: data as CanvasImageSource, frames };
        }
      }
      art.fxLoader = async () => {
        for (const [name, s] of Object.entries(meta.fx ?? {})) {
          const f = low ? s.f1 : s.f2;
          art.fxFrames.set(name, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
        }
      };
      art.equipLoader = async () => {
        for (const [id, s] of Object.entries(meta.equip ?? {})) {
          const f = low ? s.f1 : s.f2;
          art.equipFrames.set(id, makeFrame(await texture(pageOf(f)), f.x, f.y, f.w, f.h));
        }
      };
      art.worldMapLoader = async () => {
        const w = meta.worldMap;
        if (!w) return null;
        const f = low ? w.f1 : w.f2;
        const img = await loadAsset(`world/${f.file.replace(/\.png$/, '')}`, ImageAsset);
        return img ? imageUrl(img) : null;
      };
    } catch (e) {
      console.warn('[vgtd] gemini art unavailable, using placeholders:', e);
      return null;
    }
    current = art;
    // DOM panels (friends, party, sect, chat) draw the same icons as <img> data URLs
    setDomIconProvider((kind, id) => (kind === 'hud' ? art.hudUrl(id) : art.itemUrl(id)));
    return art;
  }

  /** Block / biome data in the shape `placeProps` takes. */
  defs(): Record<string, PropDef> {
    const out: Record<string, PropDef> = {};
    for (const [n, p] of Object.entries(this.meta.props))
      out[n] = { block: p.block, biomes: p.biomes, zones: p.zones, weight: p.weight, spacing: p.spacing };
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

  /** Every skin of a mob by phase (0 = base standee, then the boss phase skins), or undefined for an unknown mob. */
  mobSkins(id: number): ReadonlyMap<number, { entry: MobSprite; frame: SpriteFrame }> | undefined {
    // the phase page loads once, on the first request for a mob that has phase skins; the map fills in when it resolves
    if (Object.values(this.meta.mobPhases ?? {}).some((m) => m.id === id))
      this.mobPhasePromise ??= (this.mobPhaseLoader?.() ?? Promise.resolve()).catch((e) => {
        console.warn('[vgtd] boss phase skins unavailable:', e);
      });
    return this.mobSkinsById.get(id);
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

  /** Status icon by id (see `getStatusIcon`), or null. */
  status(id: string): SpriteFrame | null {
    return this.statusFrames.get(id) ?? null;
  }

  /** Realm badge by realm index (0 = Luyen Khi), or null. */
  realm(realmIndex: number): SpriteFrame | null {
    return this.realmFrames.get(`realm_${Math.trunc(realmIndex)}`) ?? null;
  }

  /**
   * Loads the particle textures (once; later calls return the same promise). Particles are not part of the initial download:
   * VFX code calls this ahead of time (see LevelUpFx) and `getParticleFrame` returns null until it has resolved.
   */
  ensureParticles(): Promise<void> {
    this.particlesPromise ??= (this.particleLoader?.() ?? Promise.resolve()).catch((e) => {
      console.warn('[vgtd] particle textures unavailable:', e);
    });
    return this.particlesPromise;
  }
  private particlesPromise: Promise<void> | null = null;

  /** Tribulation effect frame (see `getFxFrame`). */
  fx(name: string): SpriteFrame | null {
    return this.fxFrames.get(name) ?? null;
  }
  fxInfo(name: string): { w: number; h: number; pivotY: number } | null {
    const e = this.meta.fx?.[name];
    return e ? { w: e.w, h: e.h, pivotY: e.pivotY ?? 0.5 } : null;
  }
  ensureFx(): Promise<void> {
    this.fxPromise ??= (this.fxLoader?.() ?? Promise.resolve()).catch((e) => {
      console.warn('[vgtd] tribulation effects unavailable:', e);
    });
    return this.fxPromise;
  }
  private fxPromise: Promise<void> | null = null;

  equip(id: string): SpriteFrame | null {
    return this.equipFrames.get(id) ?? null;
  }
  ensureEquip(): Promise<void> {
    this.equipPromise ??= (this.equipLoader?.() ?? Promise.resolve()).catch((e) => {
      console.warn('[vgtd] equipment icons unavailable:', e);
    });
    return this.equipPromise;
  }
  private equipPromise: Promise<void> | null = null;

  mapIcon(id: string): SpriteFrame | null {
    return this.mapIconFrames.get(id) ?? null;
  }
  mapSheet(): {
    image: CanvasImageSource;
    frames: Record<string, { x: number; y: number; w: number; h: number }>;
  } | null {
    return this.mapSheetData;
  }
  worldMap(): Promise<string | null> {
    this.worldMapPromise ??= (this.worldMapLoader?.() ?? Promise.resolve(null)).catch((e) => {
      console.warn('[vgtd] world map unavailable:', e);
      return null;
    });
    return this.worldMapPromise;
  }
  private worldMapPromise: Promise<string | null> | null = null;

  /** Particle texture by name, or null. */
  particle(name: string): SpriteFrame | null {
    return this.particleFrames.get(name) ?? null;
  }

  /**
   * Login backdrop + emblem as image URLs for the DOM class picker, or null when the art was not generated / cannot be turned into
   * a URL. Loaded on demand (2 MB of PNG, only needed on the first online login of an account); the result is cached.
   */
  keyArt(): Promise<KeyArtUrls | null> {
    this.keyArtPromise ??= this.loadKeyArt();
    return this.keyArtPromise;
  }
  private keyArtPromise: Promise<KeyArtUrls | null> | null = null;
  private async loadKeyArt(): Promise<KeyArtUrls | null> {
    const k = this.meta.keyArt;
    if (!k) return null;
    const emblem = this.use2x ? k.emblem.f2 : k.emblem.f1;
    const [bg, em] = await Promise.all([
      loadAsset(`world/${k.backdrop.file.replace(/\.png$/, '')}`, ImageAsset),
      loadAsset(`world/${emblem.file.replace(/\.png$/, '')}`, ImageAsset),
    ]);
    const backdrop = bg ? imageUrl(bg) : null;
    const emblemUrl = em ? imageUrl(em) : null;
    return backdrop && emblemUrl ? { backdrop, emblem: emblemUrl } : null;
  }

  /** Item icon (key = item key such as `heal_pill`, `stone_low`, or an alchemy pill via `ITEM_ICON_ALIASES`), or null when missing. */
  icon(key: string): SpriteFrame | null {
    return this.iconFrames.get(key) ?? this.iconFrames.get(itemIconKey(key)) ?? null;
  }

  /** HUD / social icon by id (see `getHudIcon`), or null. */
  hud(id: string): SpriteFrame | null {
    return this.hudFrames.get(id) ?? null;
  }

  /** `data:` URL of a HUD icon for a DOM <img> (made once, cached), or null. */
  hudUrl(id: string): string | null {
    const m = this.meta.hud?.[id];
    return m ? this.frameUrl(`hud:${id}`, this.use2x ? m.f2 : m.f1) : null;
  }

  /** `data:` URL of an item icon (by item key or icon id) for a DOM <img>, or null. */
  itemUrl(key: string): string | null {
    const m = this.meta.icons[key] ?? this.meta.icons[itemIconKey(key)];
    return m ? this.frameUrl(`item:${key}`, m.f2) : null;
  }

  /** Cuts one atlas frame out of its decoded page into a PNG data URL; null when the page cannot be drawn (no DOM image data). */
  private frameUrl(cacheKey: string, f: AtlasFrame): string | null {
    if (this.urlCache.has(cacheKey)) return this.urlCache.get(cacheKey) ?? null;
    let url: string | null = null;
    try {
      const page = this.pageImages.get(`world/${f.file.replace(/\.png$/, '')}`);
      const data = page?.data as unknown as CanvasImageSource | undefined;
      if (data && typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = f.w;
        c.height = f.h;
        c.getContext('2d')!.drawImage(data, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        url = c.toDataURL('image/png');
      }
    } catch {
      url = null; // a tainted / undecodable page: the caller keeps its text glyph
    }
    this.urlCache.set(cacheKey, url);
    return url;
  }

  /** Sprite size in design px (the 1x tile is 64 px wide). `x1only` props (the sect buildings) are @1x pixels in both pages: w2 / h2 are their virtual @2x size, so this is the same in every tier. */
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
