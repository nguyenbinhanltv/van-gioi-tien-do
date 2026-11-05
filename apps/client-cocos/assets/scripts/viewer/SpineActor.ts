import { Node, UITransform, resources, sp } from 'cc';
import type { character } from '../vendor/vgtd.mjs';
import { newNode } from '../IsoAdapter';
import type { AnimationId, Direction, SkinName, SlotId } from './ViewerModel';
import { SPINE_SLOTS } from './ViewerModel';

export interface ActorFrame {
  /** Seconds into the current animation (looped / clamped). */
  time: number;
  duration: number;
  /** Sprite-sheet frame index at that time (docs/03 table fps). */
  frame: number;
  frames: number;
}

/**
 * One Spine 4.2 skeleton on screen. `root` carries the mirror (scale.x = ±1, D14: 5 drawn directions + mirror);
 * the skeleton node under it plays the rig of the *drawn* direction (`view.skeletonDirection`).
 * Applies a `CharacterViewState` (from @vgtd/character) to the Skeleton component: rig, mirror, animation,
 * slot visibility, skin, timeScale, mix, pause.
 */
export class SpineActor {
  readonly root: Node;
  private readonly skNode: Node;
  private sk: sp.Skeleton;
  private readonly data = new Map<Direction, sp.SkeletonData>();
  private rigDir: Direction | null = null;
  private loading: Direction | null = null;
  private anim: AnimationId | null = null;
  private loopNow = true;
  private skin: SkinName = 'default';
  private hiddenSig = '';
  private view: character.CharacterViewState | null = null;
  /** Called with the Spine event name for every event that fires (hit, footstep_L, ...). */
  onEvent: ((name: string, time: number) => void) | null = null;
  /** Called whenever a rig finished (re)loading, so the owner can re-apply settings / track textures. */
  /** Called when a rig fails to load / parse. */
  onError: ((message: string) => void) | null = null;
  onRigLoaded: ((dir: Direction, data: sp.SkeletonData) => void) | null = null;

  /** resources/ sub-folder holding rig_<DIR>.json|.skel + .atlas + .png (default: the generated test rig). */
  src = 'viewer';

  constructor(parent: Node, name: string) {
    this.root = newNode(name, parent);
    this.skNode = newNode('Skeleton', this.root);
    this.skNode.addComponent(UITransform);
    this.sk = this.skNode.addComponent(sp.Skeleton);
    this.sk.premultipliedAlpha = true; // atlas pma:true
    this.sk.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.REALTIME); // needed for scrub / mix / live slot edits
    this.sk.setEventListener((_entry, ev) => {
      const name = (ev as unknown as { data?: { name?: string } }).data?.name;
      if (name) this.onEvent?.(name, this.time()?.time ?? 0);
    });
  }

  get skeletonDirection(): Direction | null {
    return this.rigDir;
  }

  /** Setup draw order (slot names, back -> front) of the rig being played. */
  rigSlotOrder(): string[] {
    const d = this.sk.skeletonData?.getRuntimeData?.();
    const slots = (d as unknown as { slots?: { name: string }[] } | undefined)?.slots;
    return slots ? slots.map((s) => s.name) : [];
  }

  private loadRig(dir: Direction): Promise<sp.SkeletonData> {
    const cached = this.data.get(dir);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) =>
      resources.load(`${this.src}/rig_${dir}`, sp.SkeletonData, (err, asset) => {
        if (err || !asset) return reject(err ?? new Error(`rig_${dir}`));
        this.data.set(dir, asset);
        resolve(asset);
      }),
    );
  }

  /**
   * Apply a view state. Safe to call every time settings change: a rig change loads asynchronously and
   * re-applies itself afterwards, keeping the animation time.
   */
  apply(
    view: character.CharacterViewState,
    opts: {
      skin: SkinName;
      timeScale: number;
      mix: number;
      paused: boolean;
      repeat: boolean;
      hidden: ReadonlySet<SlotId>;
    },
  ): void {
    this.view = view;
    this.root.setScale(view.scaleX, 1, 1);
    if (this.rigDir !== view.skeletonDirection) {
      if (this.loading === view.skeletonDirection) return;
      const keepTime = this.time()?.time ?? 0;
      this.loading = view.skeletonDirection;
      void this.loadRig(view.skeletonDirection)
        .catch((e: unknown) => {
          this.loading = null;
          this.onError?.(`rig_${view.skeletonDirection}: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        })
        .then((d) => {
          if (!d) return;
          this.loading = null;
          if (this.view?.skeletonDirection !== view.skeletonDirection) return; // superseded
          this.sk.skeletonData = d;
          this.rigDir = view.skeletonDirection;
          this.anim = null;
          this.skin = 'default';
          this.hiddenSig = '';
          this.onRigLoaded?.(view.skeletonDirection, d);
          this.apply(view, opts);
          this.seek(keepTime);
        });
      return;
    }
    if (this.skin !== opts.skin) {
      this.sk.setSkin(opts.skin);
      this.skin = opts.skin;
      this.hiddenSig = ''; // attachments were swapped: re-hide
    }
    this.sk.timeScale = opts.timeScale;
    const id = view.animation.id;
    const loop = view.animation.loop || opts.repeat;
    if (this.anim !== id || this.loopNow !== loop) {
      if (this.anim && this.anim !== id) this.sk.setMix(this.anim, id, opts.mix);
      this.sk.setAnimation(0, id, loop);
      this.anim = id;
      this.loopNow = loop;
    }
    this.setSlotVisibility(opts.hidden);
    this.sk.paused = opts.paused;
  }

  private setSlotVisibility(hidden: ReadonlySet<SlotId>): void {
    const sig = Array.from(hidden).sort().join(',');
    if (sig === this.hiddenSig) return;
    this.hiddenSig = sig;
    for (const slotName of SPINE_SLOTS) {
      const slot = this.sk.findSlot(slotName);
      if (!slot) continue;
      if (hidden.has(slotName)) slot.setAttachment(null as never);
      else this.sk.setAttachment(slotName, slotName);
    }
  }

  /** Restart the current animation from t = 0 (compare mode "sync"). */
  restart(): void {
    if (!this.anim || !this.view) return;
    this.sk.setAnimation(0, this.anim, this.loopNow);
  }

  time(): ActorFrame | null {
    const e = this.sk.getCurrent(0);
    const v = this.view;
    if (!e || !v) return null;
    const duration = e.animationEnd - e.animationStart || v.animation.durationSec;
    const t = this.loopNow ? e.trackTime % duration : Math.min(e.trackTime, duration);
    return {
      time: t,
      duration,
      frame: Math.min(v.animation.frames - 1, Math.floor((t / duration) * v.animation.frames)),
      frames: v.animation.frames,
    };
  }

  /** Jump to time `t` (s) and render that pose, whether or not the skeleton is paused. */
  seek(t: number): void {
    const e = this.sk.getCurrent(0);
    if (!e) return;
    const wasPaused = this.sk.paused;
    e.trackTime = t;
    this.sk.paused = false;
    this.sk.updateAnimation(0);
    this.sk.paused = wasPaused;
  }
}
