import { Component, Node, ResolutionPolicy, Sprite, UITransform, _decorator, view } from 'cc';
import { character, shared } from '../vendor/vgtd.mjs';
import { newNode } from '../IsoAdapter';
import { buildPlaceholderArt, type ArtFrames } from '../PlaceholderArt';
import { PerfHud } from '../PerfHud';
import { SpineActor } from './SpineActor';
import { ViewerPanel, type PanelInfo } from './ViewerPanel';
import {
  ALL_DIRECTIONS,
  ANIMATION_IDS,
  defaultSettings,
  drawOrderDelta,
  hiddenSpineSlots,
  viewStateFor,
  type AnimationId,
  type Direction,
} from './ViewerModel';

const { ccclass } = _decorator;

/** World units (px @1x) between the two actors in compare mode, and world zoom (the rig is ~120 px tall). */
const COMPARE_HALF_GAP = 105;
const ZOOM_SINGLE = 2.6;
const ZOOM_COMPARE = 2.1;
/** Feet sit this far below the canvas centre (design units) so the body is centred. */
const FEET_Y = -150;

/**
 * Animation viewer scene (assets/scenes/Viewer.scene; open with `#viewer`).
 * Loads the Spine 4.2 test rig (tools/spine-testrig -> assets/resources/viewer), applies
 * `@vgtd/character` view states to it and offers a DOM control panel (ViewerPanel).
 * Initial state can be set from the URL hash: `#viewer&anim=attack&dir=NE&compare=1&animb=cast&paused=1&skin=red&off=wing+weapon_R&t=0.2&ts=0.5&src=viewer&mobile`
 * (`src` = resources/ sub-folder with the animator's rig_<DIR> export).
 */
@ccclass('ViewerScene')
export class ViewerScene extends Component {
  private settings = defaultSettings();
  private a!: SpineActor;
  private b!: SpineActor;
  private panel!: ViewerPanel;
  private hud!: PerfHud;
  private art!: ArtFrames;
  private world!: Node;
  private canvasUi!: UITransform;
  private dirty = true;
  private lastPanelSig = '';
  private readonly events: string[] = [];
  private readonly texturesSeen = new Set<Direction>();
  private ready = false;
  private lastInfo = 0;
  private rigOrderCache = new Map<Direction, string[]>();

  start(): void {
    try {
      this.init();
    } catch (e) {
      this.fail(e);
    }
  }

  private failed = '';
  private fail(e: unknown): void {
    const msg =
      e instanceof Error
        ? `${e.message}
${e.stack ?? ''}`
        : String(e);
    if (msg === this.failed) return;
    this.failed = msg;
    if (this.panel) this.panel.fail(msg);
    else console.error('[viewer]', msg);
  }

  private init(): void {
    view.setDesignResolutionSize(shared.DESIGN_WIDTH, shared.DESIGN_HEIGHT, ResolutionPolicy.FIXED_HEIGHT);
    this.canvasUi = this.getComponent(UITransform)!;
    this.art = buildPlaceholderArt();
    this.world = newNode('World', this.node);
    this.floors = [this.addFloor(), this.addFloor()];
    this.a = new SpineActor(this.world, 'ActorA');
    this.b = new SpineActor(this.world, 'ActorB');
    for (const [actor, tag] of [
      [this.a, 'A'],
      [this.b, 'B'],
    ] as const) {
      actor.onEvent = (name, t) =>
        this.pushEvent(
          `${tag} ${actor === this.a ? this.settings.animation : this.settings.animationB} ${t.toFixed(2)}s  ${name}`,
        );
      actor.onError = (m) => this.fail(new Error(m));
      actor.onRigLoaded = (dir, data) => {
        if (this.texturesSeen.has(dir)) return;
        this.texturesSeen.add(dir);
        for (const t of data.textures) this.hud.trackTexture(t.width, t.height);
      };
    }
    const hudRoot = newNode('Hud', this.node);
    this.hud = new PerfHud(hudRoot, this.art);
    this.hud.hint = 'Animation viewer (rig: tools/spine-testrig)';
    this.hud.extra = () => ({ l3Objects: this.settings.compare ? 2 : 1 });
    this.readHash();
    this.panel = new ViewerPanel(this.settings, {
      onChange: () => (this.dirty = true),
      onRestart: () => this.restart(),
      onSeek: (norm) => this.seekNorm(norm),
      onStep: (dt) => this.step(dt),
    });
    this.panel.onLayout = () => (this.lastPanelSig = '');
    this.ready = true;
  }

  private floors: Node[] = [];

  private addFloor(): Node {
    const holder = newNode('Floor', this.world);
    for (const [frame, w, h, y] of [
      [this.art.marker, 64 * 1.6, 32 * 1.6, FEET_Y / ZOOM_SINGLE],
      [this.art.shadow, 48, 24, FEET_Y / ZOOM_SINGLE],
    ] as const) {
      const n = newNode('Layer', holder);
      n.addComponent(UITransform).setContentSize(w, h);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = frame;
      n.setPosition(0, y, 0);
    }
    return holder;
  }

  private pushEvent(line: string): void {
    this.events.unshift(line);
    if (this.events.length > 10) this.events.length = 10;
  }

  private readHash(): void {
    const q = new URLSearchParams(location.hash.slice(1).replace(/,/g, '&'));
    const s = this.settings;
    const anim = q.get('anim') as AnimationId | null;
    if (anim && ANIMATION_IDS.includes(anim)) s.animation = anim;
    const animb = q.get('animb') as AnimationId | null;
    if (animb && ANIMATION_IDS.includes(animb)) s.animationB = animb;
    const dir = q.get('dir') as Direction | null;
    if (dir && ALL_DIRECTIONS.includes(dir)) s.direction = dir;
    if (q.has('compare')) s.compare = q.get('compare') !== '0';
    if (q.has('paused')) s.paused = q.get('paused') !== '0';
    if (q.get('skin') === 'red') s.skin = 'red';
    if (q.has('ts')) s.timeScale = Math.min(3, Math.max(0.05, Number(q.get('ts')) || 1));
    const src = q.get('src');
    if (src && /^[\w-]+(\/[\w-]+)*$/.test(src)) this.a.src = this.b.src = src;
    const off = q.get('off');
    if (off) for (const slot of off.split('+')) s.equipped.delete(slot as never);
    const t = Number(q.get('t'));
    if (q.has('t') && Number.isFinite(t)) this.pendingSeek = t;
  }
  private pendingSeek: number | null = null;

  private restart(): void {
    this.a.restart();
    this.b.restart();
    if (this.settings.paused) {
      this.a.seek(0);
      this.b.seek(0);
    }
  }

  private seekNorm(norm: number): void {
    for (const actor of [this.a, this.b]) {
      const f = actor.time();
      if (f) actor.seek(norm * f.duration);
    }
  }

  private step(dt: number): void {
    for (const actor of [this.a, this.b]) {
      const f = actor.time();
      if (!f) continue;
      actor.seek(Math.max(0, f.duration > 0 ? (f.time + dt + f.duration) % f.duration : 0));
    }
  }

  private applyAll(): void {
    const s = this.settings;
    const views = { A: viewStateFor(s, 'A'), B: viewStateFor(s, 'B') };
    const opts = (v: character.CharacterViewState) => ({
      skin: s.skin,
      timeScale: s.timeScale,
      mix: s.mixDuration,
      paused: s.paused,
      repeat: s.repeatOneShots,
      hidden: hiddenSpineSlots(v),
    });
    this.a.apply(views.A, opts(views.A));
    this.b.root.active = s.compare;
    if (s.compare) this.b.apply(views.B, opts(views.B));
    const gap = s.compare ? COMPARE_HALF_GAP : 0;
    this.a.root.setPosition(-gap, FEET_Y / ZOOM_SINGLE, 0);
    this.b.root.setPosition(gap, FEET_Y / ZOOM_SINGLE, 0);
    this.floors[0]!.setPosition(-gap, 0, 0);
    this.floors[1]!.setPosition(gap, 0, 0);
    this.floors[1]!.active = s.compare;
    this.a.root.getChildByName('Skeleton')!.setPosition(0, 0, 0);
    this.layoutWorld();
  }

  /** Centre the actors in the area not covered by the DOM panel. */
  private layoutWorld(): void {
    const s = this.settings;
    const zoom = s.compare ? ZOOM_COMPARE : ZOOM_SINGLE;
    const lay = this.panel.getLayout();
    const rect = (document.getElementById('GameCanvas') ?? document.querySelector('canvas'))!.getBoundingClientRect();
    const unit = this.canvasUi.contentSize.width / rect.width; // design units per css px
    const side = lay.mode === 'side' ? -(lay.sizePx * unit) / 2 : 0;
    const lift = lay.mode === 'bottom' ? (lay.sizePx * unit) / 2 : 0;
    this.world.setScale(zoom, zoom, 1);
    this.world.setPosition(side, lift, 0);
  }

  update(dt: number): void {
    if (!this.ready) return;
    try {
      this.tick(dt);
    } catch (e) {
      this.fail(e);
    }
  }

  private tick(dt: number): void {
    if (this.dirty) {
      this.dirty = false;
      this.applyAll();
    }
    if (this.pendingSeek !== null && this.a.time()) {
      const t = this.pendingSeek;
      this.pendingSeek = null;
      this.a.seek(t);
      this.b.seek(t);
    }
    const w = this.canvasUi.contentSize.width;
    const lay = this.panel.getLayout();
    const sig = `${w}|${lay.mode}|${Math.round(lay.sizePx)}`;
    if (sig !== this.lastPanelSig) {
      this.lastPanelSig = sig;
      this.layoutWorld();
      this.hud.setWidth(Math.min(560, w - 16));
      this.hud.layout(w, this.canvasUi.contentSize.height);
    }
    this.hud.update(dt);

    const now = performance.now();
    if (now - this.lastInfo < 100) return;
    this.lastInfo = now;
    const viewA = viewStateFor(this.settings, 'A');
    const info: PanelInfo = {
      a: this.a.time(),
      b: this.settings.compare ? this.b.time() : null,
      viewA,
      rigDir: this.a.skeletonDirection,
      drawDelta: drawOrderDelta(
        viewA,
        this.a.rigSlotOrder().filter((n) => (character.SPINE_SLOT_IDS as readonly string[]).includes(n)),
      ),
      events: this.events,
    };
    this.panel.refresh(now, info);
  }

  /** Setup slot order of a rig (cached: reading it crosses into wasm). */
  private rigOrder(dir: Direction): string[] {
    let o = this.rigOrderCache.get(dir);
    if (!o) {
      o = this.a.rigSlotOrder();
      this.rigOrderCache.set(dir, o);
    }
    return o;
  }

  onDestroy(): void {
    this.panel?.destroy();
  }
}
