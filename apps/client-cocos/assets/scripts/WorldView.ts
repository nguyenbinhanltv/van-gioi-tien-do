import { Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { shared, world as cw } from './vendor/vgtd.mjs';
import { newNode, tileToWorld } from './IsoAdapter';
import { makeFrame } from './PlaceholderArt';

/** Parsed procgen map (@vgtd/client-world `parseProcgenMap`). */
export type ProcgenWorld = cw.ProcgenWorld;

/** Water ground tile of one loaded chunk (animated by WorldView.update). */
interface WaterTile {
  sprite: Sprite;
  variant: number;
}

interface LoadedChunk {
  node: Node;
  water: WaterTile[];
  tiles: number;
  ci: number;
  cj: number;
}

/**
 * L0 ground streamed per 32x32 chunk by @vgtd/client-world (`ChunkStreamer` over `ProcgenChunkLoader`, docs/06 section 5).
 * Only chunks the streamer reports as loaded own scene nodes; unloaded ones are destroyed (after the 30 s hold),
 * so node count and draw calls follow the camera instead of the map size.
 *
 * Tiles are 128x64 @2x art drawn at 64x32 @1x with the top-centre anchored on the tile's N vertex (shared iso:
 * x=(i-j)*32, y=(i+j)*16, y flipped by IsoAdapter). Inside a chunk: ascending i+j, then liquid -> dirt -> grass
 * (map.json drawOrder); chunk nodes are siblings ordered by ci+cj. All tiles share one texture + material, so the
 * ground stays one batch.
 *
 * Contract kept from the previous placeholder: `isTerrainWalkable(i, j)`, `width/height`, `tileCount` (tiles currently
 * alive) and `update`. Walkability reads the parsed map, so it does not depend on which chunks are streamed in.
 */
export class WorldView {
  readonly root: Node;
  readonly width: number;
  readonly height: number;
  private readonly walkable: Uint8Array;
  private readonly frames = new Map<number, SpriteFrame>();
  private readonly waterFrames: SpriteFrame[] = [];
  private waterIds: number[] = [];
  private waterFps = 0;
  private waterClock = 0;
  private waterShown = -1;
  private readonly loaded = new Map<string, LoadedChunk>();
  private readonly streamer: cw.ChunkStreamer;
  private clockMs = 0;
  private sinceStreamMs = Infinity;
  private readonly layerNames: string[];
  private tierName: cw.StreamTier;

  constructor(
    readonly data: ProcgenWorld,
    tilesetAnimations: { water?: { frames: number[]; fps: number } } | undefined,
    texture: Texture2D,
    parent: Node,
    tier: cw.StreamTier = 'medium',
  ) {
    this.root = newNode('L0_Ground', parent);
    this.width = data.width;
    this.height = data.height;
    this.tierName = tier;
    for (const t of data.tileset.tiles) this.frames.set(t.id, makeFrame(texture, t.x, t.y, t.w, t.h));
    const anim = tilesetAnimations?.water;
    if (anim) {
      this.waterFps = anim.fps;
      this.waterIds = anim.frames;
      for (const id of anim.frames) this.waterFrames.push(this.frames.get(id)!);
    }
    // layers keep the procgen draw order (liquid -> dirt -> grass); a cell is walkable when it has land
    this.layerNames = data.layers.map((l) => l.name);
    const dirt = data.layers.find((l) => l.name === 'dirt')?.data;
    const grass = data.layers.find((l) => l.name === 'grass')?.data;
    this.walkable = new Uint8Array(this.width * this.height);
    for (let k = 0; k < this.walkable.length; k++) {
      if ((dirt && dirt[k] >= 0) || (grass && grass[k] >= 0)) this.walkable[k] = 1; // water-only cells are blocked
    }
    this.streamer = new cw.ChunkStreamer(new cw.ProcgenChunkLoader(data), {
      tier,
      onLoaded: (c, d) => this.buildChunk(c, d),
      onUnloaded: (c) => this.destroyChunk(c),
      onError: (c, e) => console.error(`[WorldView] chunk ${c.ci},${c.cj} failed`, e),
    });
  }

  /** Tiles (sprite nodes) currently alive across loaded chunks. */
  get tileCount(): number {
    let n = 0;
    this.loaded.forEach((c) => (n += c.tiles));
    return n;
  }

  get chunkCount(): number {
    return this.loaded.size;
  }

  get tier(): cw.StreamTier {
    return this.tierName;
  }

  setTier(tier: cw.StreamTier): void {
    this.tierName = tier;
    this.streamer.setTier(tier);
  }

  isTerrainWalkable(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.width && j < this.height && this.walkable[j * this.width + i] === 1;
  }

  /**
   * Resolve the visible chunks before the first frame (ProcgenChunkLoader resolves on the microtask queue, so a few
   * awaits are enough). `camera` is a rect in shared screen px (y down), 1x world px.
   */
  async warmup(camera: shared.Rect): Promise<void> {
    this.streamer.update({ camera }, this.clockMs);
    for (let n = 0; n < 64 && !this.streamer.visibleReady(); n++) {
      await Promise.resolve();
      this.streamer.update({ camera }, this.clockMs);
    }
  }

  /** Per frame: cycles the water tiles and (every 200 ms) refreshes the streaming windows around the camera. */
  update(dt: number, camera: shared.Rect, velocity?: shared.Vec2): void {
    this.clockMs += dt * 1000;
    this.sinceStreamMs += dt * 1000;
    if (this.sinceStreamMs >= 200) {
      this.sinceStreamMs = 0;
      this.streamer.update({ camera, velocity }, this.clockMs);
    }
    this.animateWater(dt);
  }

  /** Release every chunk (leaving the map). */
  dispose(): void {
    this.streamer.dispose();
  }

  private buildChunk(c: shared.ChunkCoord, d: cw.ChunkData): void {
    const key = shared.chunkKey(c.ci, c.cj);
    if (this.loaded.has(key)) return;
    const node = newNode(`chunk${c.ci},${c.cj}`, this.root);
    const water: WaterTile[] = [];
    const layers = this.layerNames.map((n) => d.tileLayers[n]);
    const size = shared.CHUNK_SIZE;
    const i0 = c.ci * size;
    const j0 = c.cj * size;
    let tiles = 0;
    for (let s = 0; s <= 2 * (size - 1); s++) {
      for (let li = Math.max(0, s - size + 1); li <= Math.min(size - 1, s); li++) {
        const lj = s - li;
        const i = i0 + li;
        const j = j0 + lj;
        if (i >= this.width || j >= this.height) continue;
        for (let l = 0; l < layers.length; l++) {
          const id = layers[l][lj * size + li];
          if (id < 0) continue;
          const n = newNode(`t${i},${j}`, node);
          const ui = n.addComponent(UITransform);
          ui.setContentSize(shared.TILE_WIDTH, shared.TILE_HEIGHT);
          ui.setAnchorPoint(0.5, 1);
          const sp = n.addComponent(Sprite);
          sp.sizeMode = Sprite.SizeMode.CUSTOM;
          sp.spriteFrame = this.frames.get(id)!;
          n.setPosition(tileToWorld(i, j));
          const variant = this.layerNames[l] === 'liquid' ? this.waterIds.indexOf(id) : -1;
          if (variant >= 0) water.push({ sprite: sp, variant });
          tiles++;
        }
      }
    }
    this.loaded.set(key, { node, water, tiles, ci: c.ci, cj: c.cj });
    this.orderChunks();
  }

  private destroyChunk(c: shared.ChunkCoord): void {
    const key = shared.chunkKey(c.ci, c.cj);
    const ch = this.loaded.get(key);
    if (!ch) return;
    ch.node.destroy();
    this.loaded.delete(key);
  }

  /** Chunk nodes are drawn in ascending ci+cj (then ci) so neighbouring chunks keep the global ground order. */
  private orderChunks(): void {
    // Map iteration via forEach: Cocos' loose Babel transform breaks `[...map.values()]` / `for..of` over iterators
    const ordered: LoadedChunk[] = [];
    this.loaded.forEach((ch) => ordered.push(ch));
    ordered.sort((a, b) => a.ci + a.cj - (b.ci + b.cj) || a.ci - b.ci);
    ordered.forEach((ch, idx) => ch.node.setSiblingIndex(idx));
  }

  /** Cycle the 4 water frames at the tileset's fps (same texture -> no extra draw calls). */
  private animateWater(dt: number): void {
    if (this.waterFrames.length === 0) return;
    this.waterClock += dt;
    const step = Math.floor(this.waterClock * this.waterFps);
    if (step === this.waterShown) return;
    this.waterShown = step;
    const n = this.waterFrames.length;
    this.loaded.forEach((ch) => {
      for (const w of ch.water) w.sprite.spriteFrame = this.waterFrames[(w.variant + step) % n];
    });
  }
}
