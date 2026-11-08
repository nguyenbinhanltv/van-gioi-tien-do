import {
  Component,
  director,
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
import { combat as cb, core, shared, world as cw } from './vendor/vgtd.mjs';
import { newNode, cellCenterToWorld } from './IsoAdapter';
import { buildPlaceholderArt, makeTexture, type ArtFrames } from './PlaceholderArt';
import { WorldView } from './WorldView';
import { RouteWalker } from './Route';
import { BagPanel } from './BagPanel';
import { PropArt } from './PropArt';
import { placeProps } from './PropPlacement';
import { CombatUi, createMockBackend } from './Combat';
import { NpcCrowd, chibiNpcBody, placeholderBody } from './Npcs';
import { YSortLayer } from './YSortLayer';
import { PlayerActor, addProp, type TilePos } from './Actors';
import { CameraRig } from './CameraRig';
import { chibiStreamer } from './ChibiAssets';
import { CHIBI_CLASSES, ChibiBody, chibiIdOfPath, pathOfChibiId } from './ChibiBody';
import { InputBridge } from './InputBridge';
import { PerfHud } from './PerfHud';
import { OnlineSession, onlineRequested } from './OnlineSession';
import { SkillWheel } from './SkillWheel';
import { ProgressionHud } from './ProgressionHud';
import { pickClass, rememberClass, rememberedClass } from './ClassPicker';

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
  private npcs: NpcCrowd | null = null;
  private route: RouteWalker | null = null;
  /** `?combat=1`: combat HUD skeleton + offline mock combat loop (P3 client groundwork). */
  private combat: CombatUi | null = null;
  /** Touch input: the skill wheel (drawn from client-core's TouchController) + drag-to-aim; built once the combat HUD exists. */
  private wheel: SkillWheel | null = null;
  private wheelTouch: boolean | null = null;
  private combatOn = false;
  /** the bag (key B): the server's inventory when online, a local sample with `#bagdemo` */
  private bagPanel: BagPanel | null = null;
  /** owner-provided Gemini props + item icons (null = placeholders) */
  private propArt: PropArt | null = null;
  private player!: PlayerActor;
  private rig!: CameraRig;
  private input!: InputBridge;
  private hud!: PerfHud;
  private marker!: Node;
  private chibi!: ChibiBody;
  /** only with `?online=1`; offline play stays the default */
  private online: OnlineSession | null = null;
  /** tu vi panel (D76), only online: the server owns the progression state */
  private progressionHud: ProgressionHud | null = null;
  /** online: the server's class for this character has been applied (body art, hotbar); until then nothing class-specific is built */
  private classApplied = false;
  private uiRoot: Node | null = null;
  private worldRootNode: Node | null = null;
  private artFrames: ArtFrames | null = null;
  private keyHandlers: { down: (e: KeyboardEvent) => void; up: (e: KeyboardEvent) => void } | null = null;
  /** `#chibiwalk=E,S,NE`: scripted facing sequence for headless captures (1.5 s per direction). */
  private scriptedWalk: shared.Direction[] | null = null;
  private scriptedT = 0;
  private canvasUi!: UITransform;
  private lastCanvasW = 0;
  private ready = false;

  async start(): Promise<void> {
    // `#viewer` opens the animation viewer scene instead of the world demo
    if (/(^|[#&,])viewer(?![\w])/.test(location.hash)) {
      director.loadScene('Viewer');
      return;
    }
    console.log('[vgtd] Bootstrap.start');
    try {
      await this.build();
      this.ready = true;
      console.log(
        `[vgtd] world ready: ${this.world.tileCount} tiles in ${this.world.chunkCount} chunks, ${this.ysort.count} L3 objects`,
      );
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
    const map = mapAsset.json as unknown as { width: number; height: number; seed?: number };
    const tilesetJson = tilesetAsset.json as unknown as { animations?: { water?: { frames: number[]; fps: number } } };
    const data = cw.parseProcgenMap(tilesetJson, mapAsset.json);
    const tilesetTex = makeTexture(tilesetImage);
    const art: ArtFrames = buildPlaceholderArt();

    const worldRoot = newNode('World', this.node);
    // `?tier=low|medium|high` picks the chunk-streaming window (D63); default medium
    const params = new URLSearchParams(location.search);
    const tierParam = params.get('tier');
    const tier: cw.StreamTier = tierParam === 'low' || tierParam === 'high' ? tierParam : 'medium';
    this.world = new WorldView(data, tilesetJson.animations, tilesetTex, worldRoot, tier);
    newNode('L1_Decal', worldRoot);
    const l2 = newNode('L2_Shadow', worldRoot);
    this.ysort = new YSortLayer(worldRoot);

    // blocked tiles (props) on top of terrain walkability
    const blocked = new Uint8Array(map.width * map.height);
    const walkable = (i: number, j: number) => this.world.isTerrainWalkable(i, j) && blocked[j * map.width + i] === 0;

    const spawn = this.findSpawn(Math.floor(map.width / 2), Math.floor(map.height / 2));
    // Owner-provided Gemini props (one atlas, Y-sorted with the actors); falls back to the placeholder tree / rock when the
    // assets were not generated (`npm run prepare:assets` needs the LFS sources in assets-src/gemini)
    this.propArt = await PropArt.load(tier === 'low');
    if (this.propArt) {
      // courtyard + biome scatter around the spawn (L3 objects are not chunk-streamed yet; every one is sorted each frame)
      const placed = placeProps({
        width: map.width,
        height: map.height,
        seed: map.seed ?? 1,
        spawn,
        terrain: (i, j) => this.world.terrainAt(i, j),
        defs: this.propArt.defs(),
        count: 110,
        radius: 40,
      });
      for (const [i, j] of placed.blocked) blocked[j * map.width + i] = 1;
      for (const p of placed.courtyard) this.propArt.add(this.ysort, p);
      for (const p of placed.props) this.propArt.add(this.ysort, p);
    } else {
      const rand = rng(map.seed ?? 1);
      // props are scattered around the spawn only (L3 objects are not chunk-streamed yet; every one is sorted each frame)
      const PROP_RADIUS = 40;
      for (let n = 0; n < 140; n++) {
        const i = Math.floor(spawn.i + (rand() * 2 - 1) * PROP_RADIUS);
        const j = Math.floor(spawn.j + (rand() * 2 - 1) * PROP_RADIUS);
        if (i < 0 || j < 0 || i >= map.width || j >= map.height) continue;
        const k = j * map.width + i;
        if (
          !this.world.isTerrainWalkable(i, j) ||
          blocked[k] ||
          (Math.abs(i - spawn.i) < 2 && Math.abs(j - spawn.j) < 2)
        )
          continue;
        blocked[k] = 1;
        addProp(this.ysort, art, rand() < 0.7 ? 'tree' : 'rock', i, j);
      }
    }

    this.chibi = new ChibiBody(newNode('ChibiHolder'), { local: true });
    // D71: the first download is the player's own class locomotion; once it is on screen the background queue opens (NPC
    // classes, the player's other directions, rest clips).
    this.chibi.onInstalled = () => {
      if (chibiStreamer.backgroundOpen) return;
      chibiStreamer.openBackground();
      this.chibi.prefetchDirections();
    };
    this.chibi.setClass(this.initialClass());
    this.player = new PlayerActor(this.ysort, l2, art, { i: spawn.i + 0.5, j: spawn.j + 0.5 }, walkable, this.chibi);
    this.bindPlayTestKeys();
    this.maybeScriptedWalk();
    // D81: default zoom 1.5x, wheel / pinch 1.0-2.0x; `?zoom=<n>` overrides the start value (clamped)
    this.rig = new CameraRig(
      worldRoot,
      this.canvasUi,
      new core.ZoomController(core.parseZoomParam(params.get('zoom'))),
    );
    // P1 perf harness: `?npcs=N` wandering NPCs around the spawn (default 20 = the exit-criterion crowd, 0 = none)
    const npcParam = params.get('npcs');
    const npcCount = npcParam === null ? 20 : Math.max(0, Math.min(200, Math.floor(Number(npcParam)) || 0));
    if (npcCount > 0) {
      this.npcs = new NpcCrowd(
        npcCount,
        this.ysort,
        l2,
        art,
        walkable,
        { i: spawn.i + 0.5, j: spawn.j + 0.5 },
        rng(7),
        24,
        params.get('npcart') === 'placeholder' ? placeholderBody : chibiNpcBody,
      );
    }
    // P1 streaming measurement: `?route=1` walks a scripted loop over the whole map (A* legs planned up front)
    if (params.get('route') !== null) {
      const grid = { width: map.width, height: map.height, isWalkable: walkable };
      this.route = new RouteWalker(grid, { i: spawn.i + 0.5, j: spawn.j + 0.5 }, Math.min(map.width, map.height) * 0.3);
      if (this.route.empty) {
        console.warn('[vgtd] route: no reachable waypoint from the spawn (isolated?), route disabled');
        this.route = null;
      } else console.log(`[vgtd] route planned: ${this.route.length} path points`);
    }
    await this.world.warmup(this.cameraRect());

    // destination marker lives on L1 (decal), reused sprite
    this.marker = newNode('Marker', worldRoot.getChildByName('L1_Decal')!);
    this.marker.addComponent(UITransform).setContentSize(shared.TILE_WIDTH, shared.TILE_HEIGHT);
    const msp = this.marker.addComponent(Sprite);
    msp.sizeMode = Sprite.SizeMode.CUSTOM;
    msp.spriteFrame = art.marker;
    this.marker.active = false;

    const hudRoot = newNode('Hud', this.node);
    this.uiRoot = hudRoot;
    this.worldRootNode = worldRoot;
    this.artFrames = art;
    this.combatOn = ['1', 'true'].includes(params.get('combat') ?? '');
    this.hud = new PerfHud(hudRoot, art);
    this.hud.trackTexture(tilesetImage.width, tilesetImage.height);
    this.hud.trackTexture(art.texture.width, art.texture.height);
    this.hud.extra = () => ({
      l3Objects: this.ysort.count,
      chunks: this.world.chunkCount,
      npcs: this.npcs?.count ?? 0,
      zoom: Math.round(this.rig.zoom * 100) / 100,
      chunksLoaded: this.world.loadedChunkCount,
      stream: this.world.streamStats,
    });
    this.hud.onReset = () => this.world.resetStreamStats();
    this.hud.note = `tier ${this.world.tier}`;
    // online (`?online=1`) is created first: with `&combat=1` the HUD then talks to the server instead of the offline mock
    if (onlineRequested()) this.online = new OnlineSession(this.ysort, l2, art);
    if (this.combatOn && !this.online) {
      // offline: the local mock combat runs for the class the player picked with ?class= (or the default body class)
      this.makeCombatUi(
        createMockBackend(this.chibi.classInfo.id, { i: spawn.i + 0.5, j: spawn.j + 0.5 }, walkable, rng(11)),
      );
    }
    // online + combat: the HUD is built once the server has told us this character's class (`applyServerClass`, D82)
    this.bagPanel = this.makeBagPanel(hudRoot, art);
    this.input = new InputBridge(
      this.rig,
      { width: map.width, height: map.height, isWalkable: walkable },
      this.player,
      art,
      hudRoot,
      this.combatOn ? (tile) => this.combat?.pick(tile) ?? null : undefined,
    );
    if (this.online)
      this.progressionHud = new ProgressionHud(hudRoot, art, this.online.net, (x, y) => this.rig.clientToUi(x, y));
    this.rig.follow(this.playerScreen());
    if (this.online) void this.startOnline();
    this.maybeAutotest();
  }

  private makeCombatUi(backend: cb.CombatBackend): void {
    this.combat = new CombatUi(
      this.uiRoot!,
      this.worldRootNode!,
      this.ysort,
      this.artFrames!,
      backend,
      () => this.player.pos,
      (x, y) => this.rig.clientToUi(x, y),
      (x, y) => this.rig.clientToWorld(x, y),
    );
    this.combat.layout(this.canvasUi.contentSize.width, this.canvasUi.contentSize.height);
  }

  /**
   * Online start (D82): decide which class to ASK for (`?class=` > what this browser used for the account > the picker), then log in.
   * The class is a character property the server keeps: whatever it answers in `hello_ack` is what we apply.
   */
  private async startOnline(): Promise<void> {
    const online = this.online!;
    const q =
      new URLSearchParams(location.search).get('class') ?? new URLSearchParams(location.hash.slice(1)).get('class');
    const fromUrl = q ? (shared.parseClass(pathOfChibiId(q) ?? q) ?? null) : null;
    const asked = fromUrl ?? rememberedClass(online.accountKey) ?? (await pickClass());
    online.net.classRequest = shared.classWireId(asked);
    online.connect();
  }

  /** The server told us the class (hello_ack): remember it, draw the body with its art and build the combat HUD with its kit. */
  private applyServerClass(): void {
    const online = this.online;
    if (!online || this.classApplied || online.net.classId <= 0) return;
    const path = shared.pathOfClassWireId(online.net.classId);
    if (!path) return;
    this.classApplied = true;
    rememberClass(online.accountKey, path);
    const chibiId = chibiIdOfPath(path);
    if (chibiId) this.chibi.setClass(chibiId);
    if (this.combatOn && !this.combat) {
      const sc = new cb.ServerCombat({ path, send: (m) => online.sendCast(m) });
      online.attachCombat(sc);
      this.makeCombatUi(sc);
    }
  }

  /**
   * The bag panel (D79). Online it shows the server's inventory (`net.bag`) and sends moves / claims through the net client; with `#bagdemo`
   * (no server needed) it shows a local sample and applies swaps locally, only to check the panel in a headless capture.
   */
  private makeBagPanel(hudRoot: Node, art: ArtFrames): BagPanel {
    const demo = /(^|[#&,])bagdemo(?![w])/.test(location.hash) ? makeDemoBag() : null;
    const online = this.online;
    return new BagPanel(
      hudRoot,
      art,
      {
        bag: () => (demo ? demo.bag : (online?.net.bag ?? null)),
        move: (from, to) => (demo ? demo.move(from, to) : (online?.net.sendBagMove(from, to) ?? false)),
        claim: () => (demo ? demo.claim() : (online?.net.sendBagClaim() ?? false)),
        clientToUi: (x, y) => this.rig.clientToUi(x, y),
        icon: (key) => this.propArt?.icon(key) ?? null,
      },
      !!demo,
    );
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

  /** `?class=the-tu|phap-tu|dan-phu-tu|dao-tu|kiem-tu|thuong-tu` (also `#class=...`); default the-tu. */
  private initialClass(): string {
    const q =
      new URLSearchParams(location.search).get('class') ?? new URLSearchParams(location.hash.slice(1)).get('class');
    return q && CHIBI_CLASSES.some((c) => c.id === q) ? q : CHIBI_CLASSES[0]!.id;
  }

  /** Keys 1-6 switch class; holding Shift walks instead of runs. Also exposes a small debug hook for captures. */
  private bindPlayTestKeys(): void {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') this.player.walkMode = true;
      const n = !this.combatOn && !this.online && /^[1-6]$/.test(e.key) ? Number(e.key) : 0; // digits are hotbar keys in combat mode; online the server owns the class
      if (n && !e.ctrlKey && !e.metaKey && !e.altKey) this.chibi.setClass(CHIBI_CLASSES[n - 1]!.id);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') this.player.walkMode = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.keyHandlers = { down, up };
    (window as unknown as Record<string, unknown>).__vgtdChibi = {
      setClass: (id: string) => this.chibi.setClass(id),
      body: this.chibi,
      streamLog: () => chibiStreamer.log,
      state: () => ({
        cls: this.chibi.classInfo.id,
        available: this.chibi.availableDirections,
        shown: this.chibi.shown,
        note: this.chibi.note,
        pos: { ...this.player.pos },
      }),
    };
  }

  private maybeScriptedWalk(): void {
    const q = new URLSearchParams(location.hash.slice(1)).get('chibiwalk');
    if (q === null) return;
    const dirs = (q || 'E,S,SE,N')
      .split(',')
      .filter((d): d is shared.Direction => (shared.DIRECTIONS as readonly string[]).includes(d));
    if (dirs.length) this.scriptedWalk = dirs;
  }

  private findSpawn(ci: number, cj: number): TilePos {
    for (let r = 0; r < 32; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++)
          if (Math.max(Math.abs(di), Math.abs(dj)) === r && this.world.isTerrainWalkable(ci + di, cj + dj))
            return { i: ci + di, j: cj + dj };
    return { i: ci, j: cj };
  }

  /** Camera view in shared screen px (y down, 1x world px) for chunk streaming; centred on the player. */
  private cameraRect(): shared.Rect {
    const c = this.playerScreen();
    // streamZoom = min(current, target): while zooming out the rect already covers the area about to be visible
    const { w, h } = core.visibleWorldSize(
      this.canvasUi.contentSize.width,
      this.canvasUi.contentSize.height,
      this.rig.streamZoom,
    );
    return { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h };
  }

  private playerScreen(): { x: number; y: number } {
    const p = this.player.pos;
    return shared.tileToScreen(p.i, p.j);
  }

  /**
   * Touch input mode: the wheel replaces the bottom hotbar, and the casts the TouchController produced (tap = auto-target, drag = aim point)
   * go to the combat HUD. Pointer mode (desktop) never reads `frame.casts`: keys 1-8 and the hotbar are handled by CombatUi itself.
   */
  private updateSkillWheel(frame: ReturnType<InputBridge['poll']>): void {
    const combat = this.combat;
    if (!combat) return;
    const touch = this.input.input.mode === 'touch';
    if (touch !== this.wheelTouch) {
      this.wheelTouch = touch;
      combat.setTouchMode(touch);
    }
    if (!this.wheel)
      this.wheel = new SkillWheel(
        this.uiRoot!,
        this.worldRootNode!,
        this.artFrames!,
        combat,
        () => this.input.input.touch,
        () => this.input.input.mode === 'touch',
        () => this.player.pos,
        (x, y) => this.rig.clientToUi(x, y),
      );
    (globalThis as unknown as Record<string, unknown>).__vgtdZoom = () => this.rig.zoom; // automation: pinch check
    if (touch) for (const c of frame.casts) combat.castFromWheel(c.slot, c.aimTile);
    this.wheel.update();
  }

  update(dt: number): void {
    if (!this.ready) return;
    dt = Math.min(dt, 0.05);
    let frame = this.input.poll();
    if (this.scriptedWalk) {
      const dirs = this.scriptedWalk;
      const d = dirs[Math.floor(this.scriptedT / 1.5) % dirs.length]!;
      this.scriptedT += dt;
      const [di, dj] = shared.DIRECTION_TILE_VECTORS[d];
      const len = Math.hypot(di, dj) || 1;
      frame = { ...frame, move: { i: di / len, j: dj / len }, magnitude: 1 };
    }
    if (this.route) frame = { ...frame, ...this.route.step(this.player.pos) };
    if (this.online?.waiting) {
      // connecting: stand still until the server tells us where we are
      this.player.update(dt, { move: { i: 0, j: 0 }, magnitude: 0 });
    } else if (this.online?.active) {
      const p = this.online.step(dt, frame, this.player.walkMode);
      if (p) this.player.followNet(p, dt);
    } else {
      this.player.update(dt, frame); // offline (default), or the connection failed / dropped
    }
    this.applyServerClass();
    this.combat?.update(dt, frame.target);
    this.updateSkillWheel(frame);
    if (this.progressionHud) {
      this.progressionHud.update();
      this.chibi.setSeated(this.progressionHud.view.state?.meditating ?? false);
    }
    this.rig.follow(this.playerScreen(), dt);
    this.ysort.sort();
    this.npcs?.update(dt);
    this.world.update(dt, this.cameraRect());

    const dest = this.input.destination(frame);
    this.marker.active = !!dest;
    if (dest) this.marker.setPosition(cellCenterToWorld(dest.i, dest.j));
    this.input.updateVisuals();

    const w = this.canvasUi.contentSize.width;
    if (w !== this.lastCanvasW) {
      this.lastCanvasW = w;
      this.hud.layout(w, this.canvasUi.contentSize.height);
      this.combat?.layout(w, this.canvasUi.contentSize.height);
      this.progressionHud?.layout(w, this.canvasUi.contentSize.height);
      this.bagPanel?.layout(w, this.canvasUi.contentSize.height);
    }
    if (!/autotest/.test(location.hash))
      this.hud.note = this.online
        ? `${this.online.note()} | ${this.chibi.note}`
        : this.combatOn
          ? `${this.chibi.note} | combat mock: 1-8 skills, Tab/click target, Esc clear`
          : `${this.chibi.note} | keys 1-6 class, Shift walk`;
    this.bagPanel?.update(dt);
    this.hud.update(dt);
  }

  onDestroy(): void {
    this.input?.destroy();
    this.online?.destroy();
    this.combat?.destroy();
    this.progressionHud?.destroy();
    this.bagPanel?.destroy();
    if (this.keyHandlers) {
      window.removeEventListener('keydown', this.keyHandlers.down);
      window.removeEventListener('keyup', this.keyHandlers.up);
    }
  }
}

/** Local stand-in for the server in `#bagdemo`: a sample bag where a move swaps the two slots and claim empties the pending queue. */
function makeDemoBag(): {
  bag: InstanceType<typeof core.BagModel>;
  move: (a: number, b: number) => boolean;
  claim: () => boolean;
} {
  const bag = new core.BagModel();
  const slots: Array<unknown> = Array.from({ length: 40 }, () => null);
  slots[0] = { kind: 'stack', defId: 1, quality: 2, qty: 12 };
  slots[1] = { kind: 'stack', defId: 6, quality: 0, qty: 240 };
  slots[2] = { kind: 'instance', defId: 5, quality: 5, durability: 8200, bound: false };
  slots[3] = { kind: 'instance', defId: 4, quality: 3, durability: 10000, bound: false };
  slots[9] = { kind: 'stack', defId: 2, quality: 4, qty: 2 };
  let pending: Array<{ defId: number; quality: number; qty: number }> = [{ defId: 6, quality: 0, qty: 30 }];
  const push = (): void =>
    bag.applyState({ type: 'inv_state', wallet: [1234, 12, 1], slots, pending } as unknown as Parameters<
      typeof bag.applyState
    >[0]);
  push();
  return {
    bag,
    move: (a, b) => {
      const tmp = slots[a];
      slots[a] = slots[b] ?? null;
      slots[b] = tmp ?? null;
      push();
      return true;
    },
    claim: () => {
      if (pending.length === 0) return false;
      const free = slots.findIndex((s) => s === null);
      slots[free] = { kind: 'stack', defId: 6, quality: 0, qty: 30 };
      pending = [];
      push();
      return true;
    },
  };
}
