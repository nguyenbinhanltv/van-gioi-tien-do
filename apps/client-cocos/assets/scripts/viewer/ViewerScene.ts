import {
  Color,
  Component,
  JsonAsset,
  Label,
  Node,
  ResolutionPolicy,
  Sprite,
  UITransform,
  _decorator,
  resources,
  view,
} from 'cc';
import { character, shared } from '../vendor/vgtd.mjs';
import { newNode } from '../IsoAdapter';
import { buildPlaceholderArt, type ArtFrames } from '../PlaceholderArt';
import { PerfHud } from '../PerfHud';
import type { ApplyOptions, CharacterActor } from './CharacterActor';
import { DragonBonesActor } from './DragonBonesActor';
import { ViewerPanel, type PanelInfo } from './ViewerPanel';
import {
  ALL_DIRECTIONS,
  ANIMATION_IDS,
  ALL_CLIPS,
  EXTRA_CLIPS,
  defaultSettings,
  drawOrderDelta,
  hiddenSpineSlots,
  skinIndex,
  viewStateFor,
  type ClipId,
  type Direction,
} from './ViewerModel';

const { ccclass } = _decorator;

/** Feet sit this far below the canvas centre (design units) so the body is centred. */
const FEET_Y = -150;
/** Review grid order (row-major, 4 columns): the 5 drawn directions and the 3 mirrored ones. */
const REVIEW_ORDER: readonly Direction[] = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
const ONION_FRAMES = 2;
const KEY_FPS = 30;

interface Slot {
  actor: CharacterActor;
  /** Rig direction the last apply() asked for (ready() waits until it is loaded). */
  want: Direction | null;
  floor: Node;
  label: Label | null;
}

/** Public hook for headless capture (scripts/capture.mjs) and tests: `window.__vgtdViewer`. */
export interface ViewerHook {
  ready(): boolean;
  setEquipment(patch: Partial<character.EquipmentAppearance>): void;
  equipment(): ReturnType<NonNullable<CharacterActor['equipmentState']>> | null;
  events(clear?: boolean): readonly string[];
  /** Last error shown in the panel (empty string = none): lets scripts fail fast. */
  error(): string;
  /** Merge a partial settings object (mode, direction, animation, paused, ...) and re-apply. */
  set(patch: Record<string, unknown>): void;
  /** Pause and seek every actor to normalised time 0..1 of its animation. */
  seekNorm(norm: number): void;
  /** Clock info for A (or the review clock), frame count at 30 fps, loaded rig direction. */
  info(): { time: number; duration: number; frames: number; rig: string | null; mode: string; source: string };
  /** Loop seam of the current animation (realtime rigs). */
  seam(): { loop: boolean; meanStep: number; seamStep: number; ratio: number } | null;
  /** Blink layer of the main actor: playing flag and the eyes display now shown (headless blink verification). */
  blink(): { playing: boolean; eyes: string | null; time: number } | null;
  /** Show / hide the DOM panel and the HUD (clean frames for capture). */
  chrome(visible: boolean): void;
  animations: readonly string[];
  directions: readonly string[];
}

/**
 * Animation viewer scene (assets/scenes/Viewer.scene; open with `#viewer`).
 * Loads DragonBones 5.5 armatures (tools/dragonbones-testrig -> assets/resources/dragonbones/viewer, or your own
 * folder via `src`), applies `@vgtd/character` view states through the `CharacterActor` adapter and offers a DOM
 * control panel (ViewerPanel). Initial state from the URL hash, e.g.
 * `#viewer&anim=attack&dir=NE&mode=review&animb=cast&paused=1&skin=red&off=wing+weapon_R&t=0.2&ts=0.5&src=dragonbones/viewer&stem=rig&cache=shared&onion=1&mobile`.
 */
@ccclass('ViewerScene')
export class ViewerScene extends Component {
  private settings = defaultSettings();
  private panel!: ViewerPanel;
  private hud!: PerfHud;
  private art!: ArtFrames;
  private world!: Node;
  private canvasUi!: UITransform;
  private dirty = true;
  private lastPanelSig = '';
  private ready = false;
  private lastInfo = 0;
  private failed = '';
  private pendingSeek: number | null = null;
  private pendingNorm: number | null = null;
  private reviewT = 0;
  private lastT = 0;
  private lastWrap = 0;
  private src = { folder: 'dragonbones/viewer', stem: 'rig' };
  private crowdStagger = 0;
  private equipmentLoading = false;
  private equipmentPath: string | null = null;
  private equipmentConfig: {
    folder: string;
    mapping: character.EquipmentVisualMapping;
    appearance: character.EquipmentAppearance;
  } | null = null;
  /** Directions that have a rig file in the source folder (empty = unknown). */
  private rigDirs = new Set<Direction>();
  private readonly events: string[] = [];
  private readonly texturesSeen = new Set<string>();
  private readonly slots = new Map<string, Slot>();
  private readonly seamCache = new Map<string, ReturnType<CharacterActor['seamMetric']>>();
  private readonly rigOrderCache = new Map<Direction, string[]>();

  start(): void {
    try {
      this.init();
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
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
    const hudRoot = newNode('Hud', this.node);
    this.hud = new PerfHud(hudRoot, this.art);
    // default character: the Kiem tu export when it is in the project, else the generated test rig
    if (resources.getInfoWithPath('dragonbones/kiem-tu/kiemtu_S_ske'))
      this.src = { folder: 'dragonbones/kiem-tu', stem: 'kiemtu' };
    this.hud.extra = () => ({ l3Objects: this.activeCount() });
    this.readHash();
    for (const d of ALL_DIRECTIONS) {
      if (resources.getInfoWithPath(`${this.src.folder}/${this.src.stem}_${d}_ske`)) this.rigDirs.add(d);
    }
    this.hud.hint = `DragonBones viewer: ${this.src.folder}/${this.src.stem}_<DIR>`;
    this.panel = new ViewerPanel(this.settings, {
      onChange: () => (this.dirty = true),
      onRestart: () => this.restart(),
      onSeek: (norm) => this.seekNorm(norm),
      onStep: (dt) => this.step(dt),
    });
    this.panel.onLayout = () => (this.lastPanelSig = '');
    (globalThis as unknown as { __vgtdViewer?: ViewerHook }).__vgtdViewer = this.makeHook();
    this.ready = true;
    if (this.equipmentPath) void this.loadEquipment(this.equipmentPath).catch((e) => this.fail(e));
  }

  private makeHook(): ViewerHook {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      ready: () =>
        this.ready &&
        !this.equipmentLoading &&
        !this.failed &&
        !this.dirty &&
        this.all().length > 0 &&
        Array.from(this.slots.values()).every(
          (sl) => !sl.actor.root.active || (sl.want !== null && sl.actor.skeletonDirection === sl.want),
        ),
      error: () => this.failed,
      setEquipment: (patch) => this.setEquipment(patch),
      equipment: () => (this.equipmentConfig ? (this.mainActor().equipmentState?.() ?? null) : null),
      events: (clear = false) => {
        const result = [...this.events];
        if (clear) this.events.length = 0;
        return result;
      },
      set: (patch) => {
        Object.assign(this.settings, patch);
        this.dirty = true;
        this.panel.sync();
      },
      seekNorm: (norm) => {
        this.settings.paused = true;
        this.dirty = true;
        this.pendingNorm = norm;
        this.panel.sync();
      },
      info: () => {
        const a = this.mainActor().time();
        return {
          time: this.settings.mode === 'review' ? this.reviewT : (a?.time ?? 0),
          duration: a?.duration ?? 0,
          frames: a ? Math.round(a.duration * KEY_FPS) : 0,
          rig: this.mainActor().skeletonDirection,
          mode: this.settings.mode,
          source: this.equipmentConfig ? this.equipmentConfig.folder : `${this.src.folder}/${this.src.stem}`,
        };
      },
      seam: () => this.mainActor().seamMetric(),
      blink: () => this.mainActor().blinkProbe?.() ?? null,
      chrome: (visible) => {
        this.panel.setVisible(visible);
        this.hud.setVisible(visible);
        this.lastPanelSig = '';
      },
      get animations() {
        const clips = self.mainActor().clipNames();
        return [...ANIMATION_IDS, ...EXTRA_CLIPS.filter((c) => clips.includes(c))];
      },
      directions: ALL_DIRECTIONS,
    };
  }

  /**
   * View state of an actor. If the animation would be 'drawn in 8' but the rig folder has no rig for that direction
   * (e.g. only the 5 drawn directions are shipped), fall back to the drawn rig + mirror instead of failing to load.
   */
  private vs(which: 'A' | 'B', dir: Direction = this.settings.direction): character.CharacterViewState {
    const v = viewStateFor(this.settings, which, dir);
    if (this.rigDirs.size > 0 && !this.rigDirs.has(v.skeletonDirection) && this.settings.drawnInEight === null) {
      return viewStateFor({ ...this.settings, drawnInEight: false }, which, dir);
    }
    return v;
  }

  private mainActor(): CharacterActor {
    const m = this.settings.mode;
    return this.slot(m === 'review' ? 'R:S' : m === 'crowd' ? 'C:0' : 'A').actor;
  }

  /** Actor slot by key ('A', 'B', 'R:<dir>', 'G-', 'G+'), created on first use. */
  private slot(key: string): Slot {
    let s = this.slots.get(key);
    if (s) return s;
    const floor = newNode(`Floor_${key}`, this.world);
    for (const [frame, w, h] of [
      [this.art.marker, 64 * 1.6, 32 * 1.6],
      [this.art.shadow, 48, 24],
    ] as const) {
      const n = newNode('Layer', floor);
      n.addComponent(UITransform).setContentSize(w, h);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = frame;
    }
    const actor = new DragonBonesActor(this.world, `Actor_${key}`);
    actor.source = { ...this.src };
    if (this.equipmentConfig)
      actor.setEquipmentVisuals(
        this.equipmentConfig.folder,
        this.equipmentConfig.mapping,
        this.equipmentConfig.appearance,
      );
    actor.onError = (m) => this.fail(new Error(m));
    actor.onRigLoaded = (dir, px) => {
      const k = `${this.src.folder}/${dir}`;
      if (this.texturesSeen.has(k)) return;
      this.texturesSeen.add(k);
      this.hud.trackTexture(px, 1);
    };
    if (key === 'A' || key === 'B') {
      actor.onEvent = (name, t) =>
        this.pushEvent(
          `${key} ${key === 'A' ? this.settings.animation : this.settings.animationB} ${t.toFixed(2)}s  ${name}`,
        );
    }
    let label: Label | null = null;
    if (key.startsWith('R:')) {
      const ln = newNode(`Label_${key}`, this.world);
      ln.addComponent(UITransform).setContentSize(140, 20);
      label = ln.addComponent(Label);
      label.fontSize = 13;
      label.lineHeight = 15;
      label.color = new Color(220, 230, 255, 255);
      label.string = key.slice(2);
    }
    s = { actor, floor, label, want: null };
    this.slots.set(key, s);
    return s;
  }

  private activeCount(): number {
    return this.all().length;
  }

  private pushEvent(line: string): void {
    this.events.unshift(line);
    if (this.events.length > 10) this.events.length = 10;
  }

  private readHash(): void {
    const q = new URLSearchParams(location.hash.slice(1).replace(/,/g, '&'));
    const s = this.settings;
    this.equipmentPath = q.get('equipment');
    this.equipmentLoading = !!this.equipmentPath;
    const anim = q.get('anim') as ClipId | null;
    if (anim && ALL_CLIPS.includes(anim)) s.animation = anim;
    const animb = q.get('animb') as ClipId | null;
    if (animb && ALL_CLIPS.includes(animb)) s.animationB = animb;
    const dir = q.get('dir') as Direction | null;
    if (dir && ALL_DIRECTIONS.includes(dir)) s.direction = dir;
    const mode = q.get('mode');
    if (mode === 'compare' || mode === 'review' || mode === 'single' || mode === 'crowd') s.mode = mode;
    const n = Number(q.get('n'));
    if (q.has('n') && Number.isFinite(n)) s.crowd = Math.min(60, Math.max(1, Math.round(n)));
    if (q.get('compare') === '1') s.mode = 'compare'; // legacy flag
    if (q.has('paused')) s.paused = q.get('paused') !== '0';
    if (q.get('skin') === 'red') s.skin = 'red';
    if (q.get('onion') === '1') s.onion = true;
    if (q.get('batch') === '1') s.batch = true;
    const cache = q.get('cache');
    if (cache === 'shared' || cache === 'private' || cache === 'realtime') s.cache = cache;
    if (q.has('ts')) s.timeScale = Math.min(3, Math.max(0.05, Number(q.get('ts')) || 1));
    const src = q.get('src');
    if (q.get('rig') === 'test') this.src = { folder: 'dragonbones/viewer', stem: 'rig' }; // the generated test rig
    if (src && /^[\w-]+(\/[\w-]+)*$/.test(src)) this.src = { folder: src, stem: 'rig' };
    const stem = q.get('stem');
    if (stem && /^[\w-]+$/.test(stem)) this.src.stem = stem;
    const off = q.get('off');
    if (off) for (const slot of off.split('+')) s.equipped.delete(slot as never);
    const t = Number(q.get('t'));
    if (q.has('t') && Number.isFinite(t)) this.pendingSeek = t;
  }

  private async loadEquipment(path: string): Promise<void> {
    if (!/^[\w-]+(?:\/[\w.-]+)*$/.test(path) || path.includes('..'))
      throw new Error('invalid equipment preview resource');
    const asset = await new Promise<JsonAsset>((resolve, reject) =>
      resources.load(path, JsonAsset, (error, asset) =>
        error || !asset ? reject(error ?? new Error('equipment config missing')) : resolve(asset),
      ),
    );
    const config = asset.json as {
      format: string;
      version: number;
      folder: string;
      mapping: character.EquipmentVisualMapping;
      appearance: character.EquipmentAppearance;
    };
    if (config.format !== 'vgtd-equipment-preview' || config.version !== 1)
      throw new Error('invalid equipment preview config');
    character.resolveEquipmentVisuals(config.mapping, config.appearance);
    this.equipmentConfig = { folder: config.folder, mapping: config.mapping, appearance: config.appearance };
    const q = new URLSearchParams(location.hash.slice(1).replace(/,/g, '&'));
    const patch: Record<string, unknown> = {};
    for (const [key, param] of [
      ['tier', 'tier'],
      ['quality', 'quality'],
      ['costume', 'costume'],
      ['weaponSkin', 'weapon-skin'],
    ] as const)
      if (q.has(param)) patch[key] = q.get(param) || null;
    if (q.has('hide-costume')) patch.hideCostume = q.get('hide-costume') !== '0';
    this.setEquipment(patch as Partial<character.EquipmentAppearance>);
    this.equipmentLoading = false;
  }

  private setEquipment(patch: Partial<character.EquipmentAppearance>): void {
    const config = this.equipmentConfig;
    if (!config) throw new Error('no equipment preview config loaded');
    const appearance = { ...config.appearance, ...patch };
    const selected = character.resolveEquipmentVisuals(config.mapping, appearance);
    config.appearance = appearance;
    this.settings.cache = 'realtime';
    this.rigDirs.clear();
    for (const d of ALL_DIRECTIONS)
      if (resources.getInfoWithPath(`${config.folder}/${selected.bodySet}/${selected.bodySet}_${d}.layer`, JsonAsset))
        this.rigDirs.add(d);
    for (const slot of Array.from(this.slots.values()))
      slot.actor.setEquipmentVisuals?.(config.folder, config.mapping, appearance);
    this.seamCache.clear();
    this.rigOrderCache.clear();
    this.dirty = true;
    this.panel.sync();
  }

  // ------------------------------------------------------------------ actions

  private all(): CharacterActor[] {
    return Array.from(this.slots.values())
      .filter((s) => s.actor.root.active)
      .map((s) => s.actor);
  }

  private restart(): void {
    this.reviewT = 0;
    for (const a of this.all()) {
      a.restart();
      if (this.settings.paused) a.seek(0);
    }
  }

  private seekNorm(norm: number): void {
    if (this.settings.mode === 'review') {
      this.reviewT = norm * (this.mainActor().time()?.duration ?? 1);
      return;
    }
    for (const a of this.all()) {
      const f = a.time();
      if (f) a.seek(norm * f.duration);
    }
  }

  private step(dt: number): void {
    if (this.settings.mode === 'review') {
      const d = this.mainActor().time()?.duration ?? 1;
      this.reviewT = (this.reviewT + dt + d) % d;
      return;
    }
    for (const a of this.all()) {
      const f = a.time();
      if (f) a.seek(f.duration > 0 ? (f.time + dt + f.duration) % f.duration : 0);
    }
  }

  // ------------------------------------------------------------------ apply / layout

  private opts(hidden: ReadonlySet<string>, paused: boolean, clip?: string): ApplyOptions {
    const s = this.settings;
    return {
      skinIndex: skinIndex(s.skin),
      timeScale: s.timeScale,
      mix: s.mixDuration,
      paused,
      repeat: s.repeatOneShots,
      cache: s.cache,
      batch: s.batch,
      ...(clip ? { clip } : {}),
      hidden: hidden as ReadonlySet<never>,
    };
  }

  private applyAll(): void {
    const s = this.settings;
    const viewA = this.vs('A');
    const hidden = hiddenSpineSlots(viewA);
    const active = new Set<string>();
    const place = (
      key: string,
      x: number,
      y: number,
      v: character.CharacterViewState,
      paused: boolean,
      label?: string,
      clip: string = s.animation,
    ) => {
      const sl = this.slot(key);
      active.add(key);
      sl.actor.setVisible(true);
      sl.actor.setTint(255, 255, 255, 255);
      sl.actor.root.setPosition(x, y, 0);
      sl.floor.setPosition(x, y, 0);
      sl.floor.active = true;
      if (sl.label) {
        sl.label.string = label ?? key.slice(2);
        sl.label.node.setPosition(x, y - 30, 0);
      }
      sl.want = v.skeletonDirection;
      sl.actor.apply(v, this.opts(hiddenSpineSlots(v), paused, clip));
    };
    const baseY = FEET_Y / this.zoom();
    if (s.mode === 'review') {
      REVIEW_ORDER.forEach((d, i) => {
        const v = this.vs('A', d);
        const tag = v.mirrored
          ? ` (mirror of ${v.skeletonDirection})`
          : v.skeletonDirection !== v.direction
            ? ` (rig ${v.skeletonDirection})`
            : '';
        place(`R:${d}`, ((i % 4) - 1.5) * 150, i < 4 ? 28 : -112, v, true, `${d}${tag}`);
      });
    } else if (s.mode === 'crowd') {
      const cols = 6;
      for (let i = 0; i < s.crowd; i++) {
        const key = `C:${i}`;
        place(key, ((i % cols) - (cols - 1) / 2) * 135, 150 - Math.floor(i / cols) * 95, viewA, s.paused);
        this.slot(key).floor.active = false;
      }
      // stagger the start phases so the copies are not in lockstep
      this.crowdStagger++;
      const mine = this.crowdStagger;
      for (let i = 0; i < s.crowd; i++) {
        this.scheduleOnce(
          () => {
            if (mine === this.crowdStagger && this.settings.mode === 'crowd') this.slot(`C:${i}`).actor.restart();
          },
          0.3 + i * 0.037,
        );
      }
    } else {
      const gap = s.mode === 'compare' ? 105 : 0;
      place('A', -gap, baseY, viewA, s.paused);
      if (s.mode === 'compare') place('B', gap, baseY, this.vs('B'), s.paused, undefined, s.animationB);
      if (s.onion) {
        for (const [key, tint] of [
          ['G-', [90, 140, 255, 150]],
          ['G+', [255, 90, 90, 150]],
        ] as const) {
          const sl = this.slot(key);
          active.add(key);
          sl.actor.setVisible(true);
          sl.actor.root.setPosition(-gap, baseY, 0);
          sl.floor.active = false;
          sl.want = viewA.skeletonDirection;
          sl.actor.apply(viewA, this.opts(hidden, true, s.animation));
          sl.actor.setTint(tint[0], tint[1], tint[2], tint[3]);
          // behind A: ghosts only show where the pose differs
          sl.actor.root.setSiblingIndex(this.slot('A').actor.root.getSiblingIndex());
        }
      }
    }
    for (const [key, sl] of this.slots) {
      const on = active.has(key);
      if (!on) {
        sl.actor.setVisible(false);
        sl.floor.active = false;
      }
      if (sl.label) sl.label.node.active = on;
    }
    this.seamCache.clear();
    this.layoutWorld();
  }

  private zoom(): number {
    return this.settings.mode === 'single'
      ? 2.6
      : this.settings.mode === 'compare'
        ? 2.1
        : this.settings.mode === 'crowd'
          ? 0.8
          : 1.4;
  }

  /** Centre the actors in the area not covered by the DOM panel. */
  private layoutWorld(): void {
    const zoom = this.zoom();
    const lay = this.panel.getLayout();
    const canvas = document.getElementById('GameCanvas') ?? document.querySelector('canvas');
    const rect = canvas!.getBoundingClientRect();
    const unit = this.canvasUi.contentSize.width / rect.width; // design units per css px
    const side = lay.mode === 'side' ? -(lay.sizePx * unit) / 2 : 0;
    const lift = lay.mode === 'bottom' ? (lay.sizePx * unit) / 2 : 0;
    this.world.setScale(zoom, zoom, 1);
    this.world.setPosition(side, lift, 0);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    if (!this.ready || this.equipmentLoading) return;
    try {
      this.tick(dt);
    } catch (e) {
      this.fail(e);
    }
  }

  private tick(dt: number): void {
    const s = this.settings;
    if (this.dirty) {
      this.dirty = false;
      this.applyAll();
    }
    const main = this.mainActor();
    if (this.pendingSeek !== null && main.time()) {
      const t = this.pendingSeek;
      this.pendingSeek = null;
      this.reviewT = t;
      for (const x of this.all()) x.seek(t);
    }
    if (this.pendingNorm !== null && main.time()) {
      const n = this.pendingNorm;
      this.pendingNorm = null;
      this.seekNorm(n);
    }
    if (s.mode === 'review') this.driveReview(dt);
    else if (s.onion) this.driveOnion();

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
    const viewA = this.vs('A');
    const ta = main.time();
    const rigDir = main.skeletonDirection;
    if (ta && this.lastT > ta.time + 0.01) this.lastWrap = now;
    this.lastT = ta?.time ?? 0;
    const seamKey = `${s.animation}|${rigDir}|${s.cache}|${s.repeatOneShots}`;
    let seam = this.seamCache.get(seamKey);
    if (seam === undefined && ta) {
      seam = main.seamMetric();
      this.seamCache.set(seamKey, seam);
    }
    const info: PanelInfo = {
      a: ta,
      b: s.mode === 'compare' ? this.slot('B').actor.time() : null,
      viewA,
      rigDir,
      drawDelta: rigDir ? drawOrderDelta(viewA, this.rigOrder(rigDir, main)) : [],
      events: this.events,
      seam: seam ?? null,
      canSeek: main.canSeek,
      rigSource: `${this.src.folder}/${this.src.stem}_<DIR>`,
      clips: main.clipNames(),
      wrapAt: this.lastWrap,
    };
    this.panel.refresh(now, info);
  }

  /** Review: one clock drives all 8 actors, so frame-stepping and the loop seam are identical everywhere. */
  private driveReview(dt: number): void {
    const s = this.settings;
    const ref = this.mainActor().time();
    if (!ref) return;
    if (!s.paused) this.reviewT += dt * s.timeScale;
    const loop = s.repeatOneShots || this.vs('A').animation.loop;
    const dur = ref.duration;
    if (loop && this.reviewT >= dur) {
      this.lastWrap = performance.now();
      this.reviewT %= dur;
    }
    const t = loop ? this.reviewT : Math.min(Math.max(this.reviewT, 0), dur);
    for (const d of REVIEW_ORDER) this.slot(`R:${d}`).actor.seek(t);
  }

  /** Onion skin: ghosts of A two frames before / after, following A's time. */
  private driveOnion(): void {
    const a = this.slot('A').actor.time();
    if (!a) return;
    const d = ONION_FRAMES / KEY_FPS;
    this.slot('G-').actor.seek((((a.time - d) % a.duration) + a.duration) % a.duration);
    this.slot('G+').actor.seek((a.time + d) % a.duration);
  }

  private rigOrder(dir: Direction, actor: CharacterActor): string[] {
    let o = this.rigOrderCache.get(dir);
    if (!o) {
      o = actor.slotOrder().filter((n) => (character.SPINE_SLOT_IDS as readonly string[]).includes(n));
      if (o.length) this.rigOrderCache.set(dir, o);
    }
    return o;
  }

  onDestroy(): void {
    this.panel?.destroy();
    for (const slot of Array.from(this.slots.values())) slot.actor.dispose?.();
  }
}
