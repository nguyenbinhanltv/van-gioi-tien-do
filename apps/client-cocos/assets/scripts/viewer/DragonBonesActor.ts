import { Color, JsonAsset, Node, UITransform, dragonBones, resources } from 'cc';
import type { character } from '../vendor/vgtd.mjs';
import { newNode } from '../IsoAdapter';
import type { ActorFrame, ApplyOptions, CacheMode, CharacterActor, RigSource, SeamMetric } from './CharacterActor';
import type { Direction, SlotId } from './ViewerModel';
import { SPINE_SLOTS } from './ViewerModel';

const CACHE_ENUM: Record<CacheMode, number> = {
  realtime: dragonBones.ArmatureDisplay.AnimationCacheMode.REALTIME,
  shared: dragonBones.ArmatureDisplay.AnimationCacheMode.SHARED_CACHE,
  private: dragonBones.ArmatureDisplay.AnimationCacheMode.PRIVATE_CACHE,
};

/**
 * Independent blink clock: an eyes-only looping clip (`authorBlinkCycle` in @vgtd/rig, 3-5 s between blinks) played on its
 * own animation layer and group next to the body clip (the default fade-out mode only touches the same layer+group, so the body clip is never faded out by it), so 0.5-1 s body loops still blink at a natural rate. It is an auxiliary clip:
 * not a user-facing body animation (see `clipNames`). REALTIME mode only (layers need the live animation state).
 */
const BLINK_CLIP = 'blink_cycle';
const BLINK_LAYER = 1;
const BLINK_GROUP = 'blink';
/** Body clips that own the eyes or must not blink (eyes closed / pain / dead). */
const BLINK_OFF: ReadonlySet<string> = new Set(['meditate', 'die', 'hit']);

interface RigAssets {
  ske: dragonBones.DragonBonesAsset;
  tex: dragonBones.DragonBonesAtlasAsset;
  textures: readonly dragonBones.DragonBonesAtlasAsset[];
}

/**
 * One DragonBones armature on screen (Cocos built-in `dragon-bones` module, `ArmatureDisplay`, REALTIME by default).
 * `root` carries the mirror (scale.x = +-1, D14: 5 drawn directions + mirror); the child plays the armature of the *drawn*
 * direction (`view.skeletonDirection`). Applies a `CharacterViewState` (from @vgtd/character).
 *
 * Realtime mode supports everything (fadeIn mix, seek, per-slot display); SHARED_CACHE / PRIVATE_CACHE bake frames at 1/60 s:
 * no mix, no scrub, no live slot edits (the viewer greys those out) but cheaper per frame.
 */
export class DragonBonesActor implements CharacterActor {
  readonly root: Node;
  source: RigSource = { folder: 'dragonbones/viewer', stem: 'rig' };
  onEvent: ((name: string, time: number) => void) | null = null;
  onRigLoaded: ((dir: Direction, texturePixels: number) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private readonly dbNode: Node;
  private readonly display: dragonBones.ArmatureDisplay;
  private readonly assets = new Map<Direction, RigAssets>();
  private rigDir: Direction | null = null;
  /** Direction whose assets are being loaded (so a second apply() does not start a duplicate load). */
  private loadingDir: Direction | null = null;
  /** Latest requested state: applied when a load completes, whatever was requested when it started. */
  private latestView: character.CharacterViewState | null = null;
  private latestOpts: ApplyOptions | null = null;
  private anim: string | null = null;
  private loopNow = true;
  private cache: CacheMode = 'realtime';
  private hiddenSig = '';
  private slotNames: string[] = [];

  constructor(parent: Node, name: string) {
    this.root = newNode(name, parent);
    this.dbNode = newNode('Armature', this.root);
    this.dbNode.addComponent(UITransform);
    this.display = this.dbNode.addComponent(dragonBones.ArmatureDisplay);
    this.display.premultipliedAlpha = true; // atlas PNG is stored premultiplied
    this.display.setAnimationCacheMode(dragonBones.ArmatureDisplay.AnimationCacheMode.REALTIME);
    this.display.addEventListener(
      dragonBones.EventObject.FRAME_EVENT,
      (e: dragonBones.EventObject) => this.onEvent?.(e.name, this.time()?.time ?? 0),
      this,
    );
  }

  get skeletonDirection(): Direction | null {
    return this.rigDir;
  }

  get canSeek(): boolean {
    return this.cache === 'realtime' && !!this.display.armature();
  }

  setTint(r: number, g: number, b: number, a: number): void {
    this.display.color = new Color(r, g, b, a);
  }

  setVisible(v: boolean): void {
    this.root.active = v;
  }

  slotOrder(): string[] {
    return this.slotNames;
  }

  clipNames(): string[] {
    const a = this.display.armature();
    return a ? a.animation.animationNames.filter((n) => n !== BLINK_CLIP) : [];
  }

  private loadAsset<T>(path: string, type: new () => T): Promise<T> {
    return new Promise((resolve, reject) =>
      resources.load(path, type as never, (err: Error | null, asset: unknown) =>
        err || !asset ? reject(err ?? new Error(`cannot load ${path}`)) : resolve(asset as T),
      ),
    );
  }

  private async loadRig(dir: Direction): Promise<RigAssets> {
    const cached = this.assets.get(dir);
    if (cached) return cached;
    const base = `${this.source.folder}/${this.source.stem}_${dir}`;
    const [ske, tex] = await Promise.all([
      this.loadAsset(`${base}_ske`, dragonBones.DragonBonesAsset),
      this.loadAsset(`${base}_tex`, dragonBones.DragonBonesAtlasAsset),
    ]);
    let textures = [tex];
    // Legacy rigs without a sprite contract retain the original single-atlas path.
    if (resources.getInfoWithPath(`${base}.sprite`, JsonAsset)) {
      const contract = await this.loadAsset(`${base}.sprite`, JsonAsset);
      const pages: unknown = contract.json?.atlas?.textures;
      if (pages !== undefined) {
        const primary = `${this.source.stem}_${dir}_tex`;
        if (
          !Array.isArray(pages) ||
          pages.length < 2 ||
          pages[0] !== primary ||
          pages.some((p) => typeof p !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(p)) ||
          new Set(pages).size !== pages.length
        )
          throw new Error('invalid sprite texture-page list');
        textures = [
          tex,
          ...(await Promise.all(
            pages
              .slice(1)
              .map((page) => this.loadAsset(`${this.source.folder}/${page}`, dragonBones.DragonBonesAtlasAsset)),
          )),
        ];
        const factory = dragonBones.CCFactory.getInstance();
        tex.init(factory);
        for (const extra of textures.slice(1)) {
          const data = JSON.parse(extra.atlasJson) as { name: string; imagePath: string };
          // Multiple actors share factory data; register each extra page only once under the primary UUID.
          const registered = factory.getTextureAtlasData(tex.uuid) ?? [];
          if (!registered.some((page) => page.name === data.name && page.imagePath === data.imagePath))
            factory.parseTextureAtlasData(data, extra.texture, tex.uuid);
        }
      }
    }
    const rig = { ske, tex, textures };
    this.assets.set(dir, rig);
    return rig;
  }

  apply(view: character.CharacterViewState, opts: ApplyOptions): void {
    this.latestView = view;
    this.latestOpts = opts;
    this.root.setScale(view.scaleX, 1, 1);
    if (this.rigDir !== view.skeletonDirection) {
      this.ensureRig(view.skeletonDirection);
      return;
    }
    this.applyLoaded(view, opts);
  }

  private ensureRig(dir: Direction): void {
    if (this.loadingDir === dir) return;
    this.loadingDir = dir;
    const keepTime = this.time()?.time ?? 0;
    void this.loadRig(dir)
      .then((rig) => {
        if (this.loadingDir === dir) this.loadingDir = null;
        const latest = this.latestView;
        if (!latest || !this.latestOpts) return;
        if (latest.skeletonDirection !== dir) {
          this.apply(latest, this.latestOpts); // the request moved on while loading: follow it
          return;
        }
        this.installRig(dir, rig);
        this.applyLoaded(latest, this.latestOpts);
        this.seek(keepTime);
      })
      .catch((e: unknown) => {
        if (this.loadingDir === dir) this.loadingDir = null;
        this.onError?.(
          `${this.source.folder}/${this.source.stem}_${dir}: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  }

  private installRig(dir: Direction, rig: RigAssets): void {
    const d = this.display;
    d.dragonAsset = rig.ske;
    d.dragonAtlasAsset = rig.tex;
    // getArmatureNames() can be empty at runtime (it is built for the editor): fall back to the <stem>_<DIR> convention.
    const want = `${this.source.stem}_${dir}`;
    const names = d.getArmatureNames();
    d.armatureName = names.length === 0 || names.includes(want) ? want : names[0]!;
    this.rigDir = dir;
    this.anim = null;
    this.hiddenSig = '';
    const armature = d.armature();
    if (!armature)
      this.onError?.(
        `armature '${d.armatureName}' was not built from ${this.source.folder}/${this.source.stem}_${dir}_ske (names: ${names.join(',') || 'none'})`,
      );
    this.slotNames = armature ? armature.getSlots().map((s) => s.name) : [];
    this.onRigLoaded?.(
      dir,
      rig.textures.reduce((n, page) => n + (page.texture ? page.texture.width * page.texture.height : 0), 0),
    );
  }

  private applyLoaded(view: character.CharacterViewState, opts: ApplyOptions): void {
    const d = this.display;
    if (d.enableBatch !== opts.batch) d.enableBatch = opts.batch;
    if (opts.cache !== this.cache) {
      this.cache = opts.cache;
      d.setAnimationCacheMode(CACHE_ENUM[opts.cache]);
      this.anim = null;
      this.hiddenSig = '';
    }
    let id: string = opts.clip ?? view.animation.id;
    const armatureNow = d.armature();
    if (armatureNow && !armatureNow.animation.hasAnimation(id)) {
      this.onError?.(
        `clip '${id}' is not in ${this.source.folder}/${this.source.stem}_${view.skeletonDirection} (playing ${view.animation.id})`,
      );
      id = view.animation.id;
    }
    const loop = view.animation.loop || opts.repeat;
    const armature = d.armature();
    if (this.cache !== 'realtime' || !armature) {
      // cached modes: playAnimation + component timeScale only
      if (this.anim !== id || this.loopNow !== loop) {
        d.playAnimation(id, loop ? 0 : 1);
        this.anim = id;
        this.loopNow = loop;
      }
      d.timeScale = opts.paused ? 0 : opts.timeScale;
      return;
    }
    this.syncBlink(armature, id);
    if (this.anim !== id || this.loopNow !== loop) {
      // no fade while paused: the fade clock is frozen at timeScale 0 and the old animation would keep dominating
      armature.animation.fadeIn(id, this.anim && this.anim !== id && !opts.paused ? opts.mix : 0, loop ? 0 : 1);
      this.anim = id;
      this.loopNow = loop;
    }
    armature.animation.timeScale = opts.paused ? 0 : opts.timeScale;
    this.setSlotDisplays(armature, opts);
  }

  /**
   * Keep the blink clip running on its own layer while the body clip does not own the eyes. Started BEFORE the body clip is
   * faded in, so the body clip stays `lastAnimationState` (time(), seek() and the seam metric read that state).
   */
  private syncBlink(armature: dragonBones.Armature, bodyClip: string): void {
    const anim = armature.animation;
    if (!anim.hasAnimation(BLINK_CLIP)) return;
    const state = anim.getState(BLINK_CLIP);
    if (BLINK_OFF.has(bodyClip)) {
      if (state) {
        // a blink may be mid-way (closed): show the open display first; a body clip that owns the eyes (meditate) keys its own
        const eyes = armature.getSlot('eyes');
        if (eyes) eyes.displayIndex = 0;
        anim.stop(BLINK_CLIP);
      }
      return;
    }
    if (!state || !state.isPlaying) anim.fadeIn(BLINK_CLIP, 0, 0, BLINK_LAYER, BLINK_GROUP);
  }

  /** Hide / show slots and pick the paperdoll variant (extra display index) for slots that ship one. */
  private setSlotDisplays(armature: dragonBones.Armature, opts: ApplyOptions): void {
    const sig = `${opts.skinIndex}|${Array.from(opts.hidden).sort().join(',')}`;
    if (sig === this.hiddenSig) return;
    this.hiddenSig = sig;
    for (const name of SPINE_SLOTS) {
      const slot = armature.getSlot(name);
      if (!slot) continue;
      const variants = slot.displayList.length;
      slot.displayIndex = opts.hidden.has(name as SlotId) ? -1 : Math.min(opts.skinIndex, Math.max(0, variants - 1));
    }
  }

  time(): ActorFrame | null {
    const armature = this.cache === 'realtime' ? this.display.armature() : null;
    const v = this.latestView;
    const st = armature?.animation.lastAnimationState;
    if (!armature || !st || !v) return null;
    const duration = st.totalTime || v.animation.durationSec;
    const t = this.loopNow ? st.currentTime % duration : Math.min(st.currentTime, duration);
    const frames = v.animation.frames;
    return { time: t, duration, frame: Math.min(frames - 1, Math.floor((t / duration) * frames)), frames };
  }

  seek(t: number): void {
    const armature = this.canSeek ? this.display.armature() : null;
    const st = armature?.animation.lastAnimationState;
    if (!armature || !st) return;
    st.currentTime = t;
    armature.advanceTime(0);
  }

  restart(): void {
    const armature = this.display.armature();
    if (!armature || !this.anim) return;
    if (this.cache === 'realtime') armature.animation.play(this.anim, this.loopNow ? 0 : 1);
    else this.display.playAnimation(this.anim, this.loopNow ? 0 : 1);
  }

  blinkProbe(): { playing: boolean; eyes: string | null; time: number } | null {
    const armature = this.cache === 'realtime' ? this.display.armature() : null;
    if (!armature || !armature.animation.hasAnimation(BLINK_CLIP)) return null;
    const st = armature.animation.getState(BLINK_CLIP);
    const shown = armature.getSlot('eyes')?.displayIndex ?? -1;
    // display index in the exported order of the eyes slot (eyes_open, eyes_half, eyes_closed)
    return { playing: !!st && st.isPlaying, eyes: shown >= 0 ? `display ${shown}` : null, time: st?.currentTime ?? 0 };
  }

  seamMetric(): SeamMetric | null {
    const armature = this.canSeek ? this.display.armature() : null;
    const st = armature?.animation.lastAnimationState;
    if (!armature || !st) return null;
    const bones = armature.getBones();
    const dur = st.totalTime;
    const n = Math.max(2, Math.round(dur * 30));
    const keep = st.currentTime;
    const sample = (i: number): number[] => {
      st.currentTime = (i / n) * dur;
      armature.advanceTime(0);
      // deg -> px weight 1.7 (about the arc length of a 100 px lever per degree)
      return bones.flatMap((b) => [b.global.x, b.global.y, ((b.global.rotation * 180) / Math.PI) * 1.7]);
    };
    const dist = (a: number[], b: number[]) => a.reduce((s, v, k) => s + Math.abs(v - b[k]!), 0);
    const poses = Array.from({ length: n }, (_, i) => sample(i));
    let sum = 0;
    for (let i = 1; i < n; i++) sum += dist(poses[i - 1]!, poses[i]!);
    const meanStep = sum / (n - 1);
    const seamStep = dist(poses[n - 1]!, poses[0]!);
    st.currentTime = keep;
    armature.advanceTime(0);
    return {
      specLoop: this.latestView?.animation.loop ?? false,
      loop: this.loopNow,
      meanStep,
      seamStep,
      ratio: meanStep > 1e-6 ? seamStep / meanStep : 0,
    };
  }
}
