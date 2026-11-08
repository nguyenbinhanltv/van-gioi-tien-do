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
  data: cw.ChunkData;
  layers: Int16Array[];
  /** Next anti-diagonal (i+j within the chunk) to create; the tree is complete when it passes LAST_DIAGONAL. */
  s: number;
  buildMs: number;
}

const LAST_DIAGONAL = 2 * (shared.CHUNK_SIZE - 1);

/**
 * L0 ground streamed per 32x32 chunk by @vgtd/client-world (`ChunkStreamer` over `ProcgenChunkLoader`, docs/06 section 5).
 * Two levels: the streamer keeps chunk DATA for its load/prefetch/keep windows (cheap typed arrays), but sprite node trees
 * (about 2000 nodes per chunk) are built only for chunks inside the camera rect inflated by RENDER_MARGIN_PX, one build per
 * 100 ms sync, and destroyed as soon as they leave it. Node count and draw calls follow the camera, not the load window.
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
  /** Chunks with a node tree (rendered). */
  private readonly loaded = new Map<string, LoadedChunk>();
  /** Chunk data the streamer currently holds (loaded, maybe not rendered). */
  private readonly chunkData = new Map<string, cw.ChunkData>();
  private sinceRenderMs = Infinity;
  /** Node trees are built this many px before a chunk enters the view (hides the build behind the walk). */
  static readonly RENDER_MARGIN_PX = 192;
  /** Sprite creations per frame while a tree is being filled (a full chunk is ~2000, so ~7 frames). */
  static readonly TILES_PER_FRAME = 300;
  private readonly streamer: cw.ChunkStreamer;
  private clockMs = 0;
  private sinceStreamMs = Infinity;
  private readonly layerNames: string[];
  private tierName: cw.StreamTier;
  /** Streaming counters for the perf harness (chunk node-tree build cost, loads, unloads). */
  readonly streamStats = { built: 0, unloaded: 0, buildMsTotal: 0, buildMsMax: 0, stepMsMax: 0, notReadyUpdates: 0 };

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
      onLoaded: (c, d) => this.chunkData.set(shared.chunkKey(c.ci, c.cj), d),
      onUnloaded: (c) => {
        this.chunkData.delete(shared.chunkKey(c.ci, c.cj));
        this.destroyChunk(c);
      },
      onError: (c, e) => console.error(`[WorldView] chunk ${c.ci},${c.cj} failed`, e),
    });
  }

  /** Tiles (sprite nodes) currently alive across loaded chunks. */
  get tileCount(): number {
    let n = 0;
    this.loaded.forEach((c) => (n += c.tiles));
    return n;
  }

  /** Zero the streaming counters (the perf harness calls this when the measured window starts). */
  resetStreamStats(): void {
    const st = this.streamStats;
    st.built = st.unloaded = st.buildMsTotal = st.buildMsMax = st.stepMsMax = st.notReadyUpdates = 0;
  }

  /** True when every chunk in the camera view is resolved (otherwise the player would see missing ground). */
  get visibleReady(): boolean {
    return this.streamer.visibleReady();
  }

  /** Chunks with a node tree (rendered). */
  get chunkCount(): number {
    return this.loaded.size;
  }

  /** Chunks whose data the streamer holds. */
  get loadedChunkCount(): number {
    return this.chunkData.size;
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
    this.syncRender(camera, Infinity);
    this.continueBuildingAll();
  }

  private continueBuildingAll(): void {
    while (!this.buildIdle) this.continueBuilding(Infinity);
  }

  /** Per frame: cycles the water tiles and (every 200 ms) refreshes the streaming windows around the camera. */
  update(dt: number, camera: shared.Rect, velocity?: shared.Vec2): void {
    this.clockMs += dt * 1000;
    this.sinceStreamMs += dt * 1000;
    this.sinceRenderMs += dt * 1000;
    if (this.sinceStreamMs >= 200) {
      this.sinceStreamMs = 0;
      this.streamer.update({ camera, velocity }, this.clockMs);
    }
    if (this.sinceRenderMs >= 100) {
      this.sinceRenderMs = 0;
      this.syncRender(camera, this.buildIdle ? 1 : 0);
    }
    this.continueBuilding(WorldView.TILES_PER_FRAME);
    this.animateWater(dt);
  }

  /** Release every chunk (leaving the map). */
  dispose(): void {
    this.streamer.dispose();
  }

  /**
   * Build node trees for loaded chunks entering the (inflated) view, at most `maxBuilds` per call, and destroy the trees of
   * chunks that left it. Counts a `notReadyUpdate` when a chunk inside the real view has no tree yet.
   */
  private syncRender(camera: shared.Rect, maxBuilds: number): void {
    const m = WorldView.RENDER_MARGIN_PX;
    const near = cw.chunksInRect({
      x: camera.x - m,
      y: camera.y - m,
      width: camera.width + 2 * m,
      height: camera.height + 2 * m,
    });
    const nearKeys = new Set<string>();
    let builds = 0;
    for (const c of near) {
      const key = shared.chunkKey(c.ci, c.cj);
      nearKeys.add(key);
      const d = this.chunkData.get(key);
      if (d && !this.loaded.has(key) && builds < maxBuilds) {
        this.buildChunk(c, d);
        builds++;
      }
    }
    const drop: shared.ChunkCoord[] = [];
    this.loaded.forEach((ch) => {
      if (!nearKeys.has(shared.chunkKey(ch.ci, ch.cj))) drop.push({ ci: ch.ci, cj: ch.cj });
    });
    for (const c of drop) this.destroyChunk(c);
    for (const c of cw.chunksInRect(camera)) {
      const key = shared.chunkKey(c.ci, c.cj);
      // the view lacks ground when a chunk that exists (anything but `missing` = outside the map) has no data yet
      // (queued / loading / failed) or has data but no complete node tree
      const status = this.streamer.status(c);
      if (status === 'missing') continue;
      const have = this.loaded.get(key);
      if (status !== 'loaded' || !have || have.s <= LAST_DIAGONAL) {
        this.streamStats.notReadyUpdates++;
        break;
      }
    }
  }

  /** Creates the (empty) node tree of a chunk; `continueChunk` fills it diagonal by diagonal within a per-frame tile budget. */
  private buildChunk(c: shared.ChunkCoord, d: cw.ChunkData): void {
    const key = shared.chunkKey(c.ci, c.cj);
    if (this.loaded.has(key)) return;
    const node = newNode(`chunk${c.ci},${c.cj}`, this.root);
    this.loaded.set(key, {
      node,
      water: [],
      tiles: 0,
      ci: c.ci,
      cj: c.cj,
      data: d,
      layers: this.layerNames.map((n) => d.tileLayers[n]),
      s: 0,
      buildMs: 0,
    });
    this.orderChunks();
  }

  /** True when no tree is still being filled. */
  private get buildIdle(): boolean {
    let idle = true;
    this.loaded.forEach((ch) => {
      if (ch.s <= LAST_DIAGONAL) idle = false;
    });
    return idle;
  }

  /** Spend up to `budgetTiles` sprite creations on the first unfinished tree (Infinity = finish it all). */
  private continueBuilding(budgetTiles: number): void {
    let target: LoadedChunk | null = null;
    this.loaded.forEach((ch) => {
      if (ch.s <= LAST_DIAGONAL && (!target || ch.ci + ch.cj < target.ci + target.cj)) target = ch;
    });
    const ch = target as LoadedChunk | null;
    if (!ch) return;
    const t0 = performance.now();
    const size = shared.CHUNK_SIZE;
    const i0 = ch.ci * size;
    const j0 = ch.cj * size;
    let made = 0;
    while (ch.s <= LAST_DIAGONAL && made < budgetTiles) {
      const s = ch.s++;
      for (let li = Math.max(0, s - size + 1); li <= Math.min(size - 1, s); li++) {
        const lj = s - li;
        const i = i0 + li;
        const j = j0 + lj;
        if (i >= this.width || j >= this.height) continue;
        for (let l = 0; l < ch.layers.length; l++) {
          const id = ch.layers[l][lj * size + li];
          if (id < 0) continue;
          const n = newNode(`t${i},${j}`, ch.node);
          const ui = n.addComponent(UITransform);
          ui.setContentSize(shared.TILE_WIDTH, shared.TILE_HEIGHT);
          ui.setAnchorPoint(0.5, 1);
          const sp = n.addComponent(Sprite);
          sp.sizeMode = Sprite.SizeMode.CUSTOM;
          sp.spriteFrame = this.frames.get(id)!;
          n.setPosition(tileToWorld(i, j));
          const variant = this.layerNames[l] === 'liquid' ? this.waterIds.indexOf(id) : -1;
          if (variant >= 0) ch.water.push({ sprite: sp, variant });
          ch.tiles++;
          made++;
        }
      }
    }
    const ms = performance.now() - t0;
    ch.buildMs += ms;
    const st = this.streamStats;
    if (ms > st.stepMsMax) st.stepMsMax = ms; // worst single-frame slice of tree building
    if (ch.s > LAST_DIAGONAL) {
      st.built++;
      st.buildMsTotal += ch.buildMs; // whole-chunk cost, spread over several frames
      if (ch.buildMs > st.buildMsMax) st.buildMsMax = ch.buildMs;
    }
  }

  private destroyChunk(c: shared.ChunkCoord): void {
    const key = shared.chunkKey(c.ci, c.cj);
    const ch = this.loaded.get(key);
    if (!ch) return;
    ch.node.destroy();
    this.loaded.delete(key);
    this.streamStats.unloaded++; // node trees destroyed (leaving the view)
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
