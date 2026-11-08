import { Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { shared } from './vendor/vgtd.mjs';
import { newNode, tileToWorld } from './IsoAdapter';
import { makeFrame } from './PlaceholderArt';

/** Shape of tools/procgen `map.json` (tutien-isomap v1) - only the fields we read. */
export interface TileMapData {
  width: number;
  height: number;
  layers: Array<{ name: string; data: number[] }>;
}
/** Shape of tools/procgen `tileset.json` (tutien-tileset v1). */
export interface TilesetData {
  tiles: Array<{ id: number; name: string; x: number; y: number; w: number; h: number }>;
  animations?: Record<string, { frames: number[]; fps: number }>;
}

/**
 * L0 ground built from the procgen tilemap. Tiles are 128x64 @2x art drawn at 64x32 @1x with the
 * top-centre anchored on the tile's N vertex (shared iso: x=(i-j)*32, y=(i+j)*16, y flipped by
 * IsoAdapter). Draw order = ascending i+j, then liquid -> dirt -> grass (per map.json drawOrder).
 * All tiles share one texture + material, so the whole ground is a single batched draw call.
 *
 * SEAM: replaced by client-world chunk streaming later; keep `isTerrainWalkable` as the contract.
 */
export class WorldView {
  readonly root: Node;
  readonly width: number;
  readonly height: number;
  readonly tileCount: number;
  private readonly walkable: Uint8Array;
  private readonly water: Array<{ sprite: Sprite; variant: number }> = [];
  private readonly waterFrames: SpriteFrame[] = [];
  private waterIds: number[] = [];
  private waterFps = 0;
  private waterClock = 0;
  private waterShown = -1;

  constructor(map: TileMapData, tileset: TilesetData, texture: Texture2D, parent: Node) {
    this.root = newNode('L0_Ground', parent);
    this.width = map.width;
    this.height = map.height;
    const frames = new Map<number, SpriteFrame>();
    for (const t of tileset.tiles) frames.set(t.id, makeFrame(texture, t.x, t.y, t.w, t.h));
    const anim = tileset.animations?.water;
    if (anim) {
      this.waterFps = anim.fps;
      this.waterIds = anim.frames;
      for (const id of anim.frames) this.waterFrames.push(frames.get(id)!);
    }

    const [liquid, dirt, grass] = ['liquid', 'dirt', 'grass'].map((n) => map.layers.find((l) => l.name === n)!.data);
    const layers = [liquid, dirt, grass];
    this.walkable = new Uint8Array(this.width * this.height);
    let count = 0;
    for (let s = 0; s <= this.width + this.height - 2; s++) {
      for (let i = Math.max(0, s - this.height + 1); i <= Math.min(this.width - 1, s); i++) {
        const j = s - i;
        const k = j * this.width + i;
        if (dirt[k] >= 0 || grass[k] >= 0) this.walkable[k] = 1; // water-only cells are blocked
        for (let l = 0; l < layers.length; l++) {
          const id = layers[l][k];
          if (id < 0) continue;
          const n = newNode(`t${i},${j}`, this.root);
          const ui = n.addComponent(UITransform);
          ui.setContentSize(shared.TILE_WIDTH, shared.TILE_HEIGHT);
          ui.setAnchorPoint(0.5, 1);
          const sp = n.addComponent(Sprite);
          sp.sizeMode = Sprite.SizeMode.CUSTOM;
          sp.spriteFrame = frames.get(id)!;
          n.setPosition(tileToWorld(i, j));
          const variant = l === 0 ? this.waterIds.indexOf(id) : -1;
          if (variant >= 0) this.water.push({ sprite: sp, variant });
          count++;
        }
      }
    }
    this.tileCount = count;
  }

  isTerrainWalkable(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.width && j < this.height && this.walkable[j * this.width + i] === 1;
  }

  /** Cycle the 4 water frames at the tileset's fps (same texture -> no extra draw calls). */
  update(dt: number): void {
    if (this.waterFrames.length === 0) return;
    this.waterClock += dt;
    const step = Math.floor(this.waterClock * this.waterFps);
    if (step === this.waterShown) return;
    this.waterShown = step;
    const n = this.waterFrames.length;
    for (const w of this.water) w.sprite.spriteFrame = this.waterFrames[(w.variant + step) % n];
  }
}
