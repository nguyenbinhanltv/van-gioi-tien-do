import {
  Component,
  ImageAsset,
  JsonAsset,
  Node,
  ResolutionPolicy,
  game,
  Sprite,
  UITransform,
  _decorator,
  resources,
  view,
} from 'cc';
import { shared } from './vendor/vgtd.mjs';
import { newNode, cellCenterToWorld } from './IsoAdapter';
import { buildPlaceholderArt, makeTexture, type ArtFrames } from './PlaceholderArt';
import { WorldView, type TileMapData, type TilesetData } from './WorldView';
import { YSortLayer } from './YSortLayer';
import { PlayerActor, addProp, type TilePos } from './Actors';
import { CameraRig } from './CameraRig';
import { InputBridge } from './InputBridge';
import { PerfHud } from './PerfHud';

const { ccclass } = _decorator;

function load<T extends JsonAsset | ImageAsset>(path: string, type: new () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    resources.load(path, type, (err, asset) => (err || !asset ? reject(err ?? new Error(path)) : resolve(asset))),
  );
}

/** mulberry32: deterministic prop scatter (same map -> same props). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The single component of the single scene (assets/scenes/Bootstrap.scene, attached to its Canvas).
 * Everything else is built here from code: world (L0..L3, L6), player, input, HUD.
 *
 * Layer tree under `World` (matches Asset Matrix layers; only L3 is Y-sorted):
 *   L0_Ground  L1_Decal  L2_Shadow  L3_YSort  (L4 air / L5 weather / L6 world UI: later)
 * Screen UI (L7) is the sibling `Hud` node, outside the camera-moved world.
 */
@ccclass('Bootstrap')
export class Bootstrap extends Component {
  private world!: WorldView;
  private ysort!: YSortLayer;
  private player!: PlayerActor;
  private rig!: CameraRig;
  private input!: InputBridge;
  private hud!: PerfHud;
  private marker!: Node;
  private canvasUi!: UITransform;
  private lastCanvasW = 0;
  private ready = false;

  async start(): Promise<void> {
    console.log('[vgtd] Bootstrap.start');
    try {
      await this.build();
      this.ready = true;
      console.log(`[vgtd] world ready: ${this.world.tileCount} tiles, ${this.ysort.count} L3 objects`);
    } catch (e) {
      console.error('[Bootstrap] failed to build world', e);
    }
  }

  private async build(): Promise<void> {
    view.setDesignResolutionSize(shared.DESIGN_WIDTH, shared.DESIGN_HEIGHT, ResolutionPolicy.FIXED_HEIGHT);
    this.canvasUi = this.getComponent(UITransform)!;

    const [mapAsset, tilesetAsset, tilesetImage] = await Promise.all([
      load('world/iso-map', JsonAsset),
      load('world/iso-tileset', JsonAsset),
      load('world/iso-tileset', ImageAsset),
    ]);
    const map = mapAsset.json as unknown as TileMapData & { seed?: number };
    const tileset = tilesetAsset.json as unknown as TilesetData;
    const tilesetTex = makeTexture(tilesetImage);
    const art: ArtFrames = buildPlaceholderArt();

    const worldRoot = newNode('World', this.node);
    this.world = new WorldView(map, tileset, tilesetTex, worldRoot);
    newNode('L1_Decal', worldRoot);
    const l2 = newNode('L2_Shadow', worldRoot);
    this.ysort = new YSortLayer(worldRoot);

    // blocked tiles (props) on top of terrain walkability
    const blocked = new Uint8Array(map.width * map.height);
    const walkable = (i: number, j: number) => this.world.isTerrainWalkable(i, j) && blocked[j * map.width + i] === 0;

    const spawn = this.findSpawn(Math.floor(map.width / 2), Math.floor(map.height / 2));
    const rand = rng(map.seed ?? 1);
    for (let n = 0; n < 140; n++) {
      const i = Math.floor(rand() * map.width);
      const j = Math.floor(rand() * map.height);
      const k = j * map.width + i;
      if (!this.world.isTerrainWalkable(i, j) || blocked[k] || (Math.abs(i - spawn.i) < 2 && Math.abs(j - spawn.j) < 2))
        continue;
      blocked[k] = 1;
      addProp(this.ysort, art, rand() < 0.7 ? 'tree' : 'rock', i, j);
    }

    this.player = new PlayerActor(this.ysort, l2, art, { i: spawn.i + 0.5, j: spawn.j + 0.5 }, walkable);
    this.rig = new CameraRig(worldRoot, this.canvasUi);

    // destination marker lives on L1 (decal), reused sprite
    this.marker = newNode('Marker', worldRoot.getChildByName('L1_Decal')!);
    this.marker.addComponent(UITransform).setContentSize(shared.TILE_WIDTH, shared.TILE_HEIGHT);
    const msp = this.marker.addComponent(Sprite);
    msp.sizeMode = Sprite.SizeMode.CUSTOM;
    msp.spriteFrame = art.marker;
    this.marker.active = false;

    const hudRoot = newNode('Hud', this.node);
    this.hud = new PerfHud(hudRoot, art);
    this.hud.trackTexture(tilesetImage.width, tilesetImage.height);
    this.hud.trackTexture(art.texture.width, art.texture.height);
    this.hud.extra = () => ({ l3Objects: this.ysort.count });
    this.input = new InputBridge(
      this.rig,
      { width: map.width, height: map.height, isWalkable: walkable },
      this.player,
      art,
      hudRoot,
    );
    this.rig.follow(this.playerScreen());
    this.maybeAutotest();
  }

  /**
   * Debug hook: `#autotest=dx,dy` (URL hash) feeds a synthetic left-click at (canvas centre + dx,dy CSS px) into the
   * real client-core PointerController and logs the player tile before/after, so click-to-move
   * (client->world conversion + A* + movement) can be verified from the console without a mouse.
   */
  private maybeAutotest(): void {
    const q = new URLSearchParams(location.hash.slice(1)).get('autotest');
    console.log(`[vgtd] hash="${location.hash}" autotest=${q}`);
    if (q === null) return;
    const [dx, dy] = q ? q.split(',').map(Number) : [250, 120];
    const r = game.canvas!.getBoundingClientRect();
    const fake = { clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy, button: 0 } as PointerEvent;
    const at = () => `(${this.player.pos.i.toFixed(1)}, ${this.player.pos.j.toFixed(1)})`;
    const log: string[] = [];
    const say = (m: string) => {
      log.push(m);
      this.hud.note = `autotest: ${log.join(' | ')}`;
      console.log(`[vgtd][autotest] ${m}`);
    };
    this.scheduleOnce(() => {
      say(`start ${at()} click +${dx},${dy}px`);
      this.input.input.pointer.pointerDown(fake);
      this.input.input.pointer.pointerUp(fake);
    }, 1);
    this.scheduleOnce(() => say(`+1.5s ${at()}`), 2.5);
    this.scheduleOnce(() => say(`+4s ${at()}`), 5);
    this.scheduleOnce(() => say(`+8s ${at()}`), 9);
  }

  private findSpawn(ci: number, cj: number): TilePos {
    for (let r = 0; r < 32; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++)
          if (Math.max(Math.abs(di), Math.abs(dj)) === r && this.world.isTerrainWalkable(ci + di, cj + dj))
            return { i: ci + di, j: cj + dj };
    return { i: ci, j: cj };
  }

  private playerScreen(): { x: number; y: number } {
    const p = this.player.pos;
    return shared.tileToScreen(p.i, p.j);
  }

  update(dt: number): void {
    if (!this.ready) return;
    dt = Math.min(dt, 0.05);
    const frame = this.input.poll();
    this.player.update(dt, frame);
    this.rig.follow(this.playerScreen());
    this.ysort.sort();
    this.world.update(dt);

    const dest = this.input.destination(frame);
    this.marker.active = !!dest;
    if (dest) this.marker.setPosition(cellCenterToWorld(dest.i, dest.j));
    this.input.updateVisuals();

    const w = this.canvasUi.contentSize.width;
    if (w !== this.lastCanvasW) {
      this.lastCanvasW = w;
      this.hud.layout(w, this.canvasUi.contentSize.height);
    }
    this.hud.update(dt);
  }

  onDestroy(): void {
    this.input?.destroy();
  }
}
