import { JsonAsset, Node, UITransform, dragonBones, resources } from 'cc';
import { character, shared } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';

type Direction = shared.Direction;

/** Playable semi-chibi classes: URL `?class=<id>` and number keys 1-6 (order below). */
export interface ChibiClass {
  readonly id: string;
  readonly label: string;
  /** `assets/resources/` sub-folder and file stem (`<stem>_<DIR>_ske|tex`, armature `<stem>_<DIR>`). */
  readonly folder: string;
  readonly stem: string;
}
export const CHIBI_CLASSES: readonly ChibiClass[] = [
  { id: 'the-tu', label: 'The tu', folder: 'dragonbones/the-tu-chibi-v1', stem: 'thetuchibi' },
  { id: 'phap-tu', label: 'Phap tu', folder: 'dragonbones/phap-tu-chibi-v1', stem: 'phaptuchibi' },
  { id: 'dan-phu-tu', label: 'Dan Phu tu', folder: 'dragonbones/dan-phu-tu-chibi-v1', stem: 'danphuchibi' },
  { id: 'dao-tu', label: 'Dao tu', folder: 'dragonbones/dao-tu-chibi-v1', stem: 'daotuchibi' },
  { id: 'kiem-tu', label: 'Kiem tu', folder: 'dragonbones/kiem-tu-chibi-v1', stem: 'kiemtuchibi' },
  { id: 'thuong-tu', label: 'Thuong tu', folder: 'dragonbones/thuong-tu-chibi-v1', stem: 'thuongtuchibi' },
];
/** The five authored directions; W/SW/NW are always the mirror of E/SE/NE (D14). */
const AUTHORED: readonly Direction[] = ['E', 'SE', 'S', 'NE', 'N'];
export type MoveState = 'idle' | 'walk' | 'run';
/** Chibi masters are ~208 px tall in a 256 px cell; tiles are 64 px wide, so scale to ~1.3 tiles of height. */
export const CHIBI_SCALE = 0.42;

interface Rig {
  ske: dragonBones.DragonBonesAsset;
  tex: dragonBones.DragonBonesAtlasAsset;
}
export interface ChibiPick {
  /** Authored direction whose armature plays. */
  readonly drawn: Direction;
  readonly scaleX: 1 | -1;
  /** True when the requested facing has no exact authored/mirrored rig (nearest direction used instead). */
  readonly approximate: boolean;
}

/** Mirror partner (W->E, SW->SE, NW->NE) from the shared table; null for directions that are not a mirror. */
const mirrorSource = (d: Direction): Direction | null => shared.MIRRORED_DIRECTIONS[d] ?? null;

/**
 * Pure facing resolution: among the available authored directions `avail` (plus their mirrors) pick the one closest to
 * `want` (45-degree steps); ties prefer the unmirrored rig. Exact when the distance is 0.
 */
export function pickChibiDirection(want: Direction, avail: readonly Direction[]): ChibiPick | null {
  let best: ChibiPick | null = null;
  let bestDist = 99;
  const consider = (shown: Direction, drawn: Direction, scaleX: 1 | -1) => {
    const dist = character.directionDistance(want, shown);
    if (dist < bestDist) {
      bestDist = dist;
      best = { drawn, scaleX, approximate: dist > 0 };
    }
  };
  for (const a of avail) consider(a, a, 1);
  for (const a of avail) {
    for (const d of shared.DIRECTIONS) if (mirrorSource(d) === a) consider(d, a, -1);
  }
  return best;
}

/**
 * One DragonBones chibi armature (REALTIME, one display) as a player body: `root` carries the mirror, `Armature` plays the
 * authored direction. Facing and move state can change every frame; a missing direction falls back to the nearest
 * available one and exposes `note` for the HUD. Plain class (not a Component), driven by `PlayerActor`.
 */
export class ChibiBody {
  readonly root: Node;
  private readonly dbNode: Node;
  private readonly display: dragonBones.ArmatureDisplay;
  private readonly rigs = new Map<string, Promise<Rig>>();
  private cls: ChibiClass = CHIBI_CLASSES[0]!;
  private avail: Direction[] = [];
  private want: Direction = 'S';
  private moveState: MoveState = 'idle';
  private loadedKey = '';
  private loadingKey = '';
  private playing = '';
  private epoch = 0;
  private error = '';
  private lastPick: ChibiPick | null = null;
  /** Called after a rig is installed (class or direction change); used by the capture hook. */
  onInstalled: ((cls: string, drawn: Direction) => void) | null = null;

  constructor(parent: Node) {
    this.root = newNode('ChibiBody', parent);
    this.dbNode = newNode('Armature', this.root);
    this.dbNode.addComponent(UITransform);
    this.display = this.dbNode.addComponent(dragonBones.ArmatureDisplay);
    this.display.premultipliedAlpha = true; // atlas PNGs are premultiplied
    this.display.setAnimationCacheMode(dragonBones.ArmatureDisplay.AnimationCacheMode.REALTIME);
    this.root.setScale(CHIBI_SCALE, CHIBI_SCALE, 1);
  }

  get classInfo(): ChibiClass {
    return this.cls;
  }
  get availableDirections(): readonly Direction[] {
    return this.avail;
  }
  /** Direction/clip currently on screen (for the HUD and the capture hook). */
  get shown(): { drawn: Direction | null; clip: string } {
    return { drawn: this.loadedKey ? (this.loadedKey.split('|')[1] as Direction) : null, clip: this.playing };
  }

  /** HUD line: class, available rigs and any nearest-direction fallback; empty text never hides an error. */
  get note(): string {
    if (this.error) return `chibi ${this.cls.id}: ${this.error}`;
    const have = this.avail.length ? this.avail.join('/') : 'none merged';
    const p = this.lastPick;
    const fb = p?.approximate ? ` | facing ${this.want} -> nearest ${p.scaleX < 0 ? 'mirrored ' : ''}${p.drawn}` : '';
    return `chibi ${this.cls.id} [${have}]${fb}`;
  }

  /** Switch class: detects which authored directions are merged (resources), then reloads. */
  setClass(id: string): boolean {
    const next = CHIBI_CLASSES.find((c) => c.id === id);
    if (!next) return false;
    this.cls = next;
    this.avail = AUTHORED.filter((d) => !!resources.getInfoWithPath(`${next.folder}/${next.stem}_${d}_ske`));
    this.error = this.avail.length ? '' : 'no direction merged yet';
    this.loadedKey = '';
    this.loadingKey = '';
    this.playing = '';
    this.epoch++;
    this.refresh();
    return true;
  }

  face(dir: Direction): void {
    if (dir === this.want) return;
    this.want = dir;
    this.refresh();
  }

  state(s: MoveState): void {
    if (s === this.moveState) return;
    this.moveState = s;
    this.playClip();
  }

  private refresh(): void {
    const pick = pickChibiDirection(this.want, this.avail);
    this.lastPick = pick;
    if (!pick) return;
    const key = `${this.cls.id}|${pick.drawn}`;
    // Mirror only once the matching rig is on screen, so a pending load never shows a flipped wrong-direction rig.
    if (key === this.loadedKey) this.root.setScale(CHIBI_SCALE * pick.scaleX, CHIBI_SCALE, 1);
    if (key === this.loadedKey || key === this.loadingKey) return;
    this.loadingKey = key;
    const epoch = this.epoch;
    void this.loadRig(pick.drawn)
      .then((rig) => {
        if (epoch !== this.epoch || this.loadingKey !== key) return;
        this.loadingKey = '';
        this.install(pick.drawn, rig, key);
      })
      .catch((e: unknown) => {
        if (epoch !== this.epoch) return;
        this.loadingKey = '';
        this.error = `cannot load ${pick.drawn}: ${e instanceof Error ? e.message : String(e)}`;
      });
  }

  private install(dir: Direction, rig: Rig, key: string): void {
    const prev = this.display.armature()?.animation.lastAnimationState;
    const phase = prev && prev.totalTime > 0 ? prev.currentTime / prev.totalTime : 0;
    const d = this.display;
    d.dragonAsset = rig.ske;
    d.dragonAtlasAsset = rig.tex;
    const want = `${this.cls.stem}_${dir}`;
    const names = d.getArmatureNames();
    d.armatureName = names.length === 0 || names.includes(want) ? want : names[0]!;
    this.loadedKey = key;
    this.playing = '';
    if (!d.armature()) this.error = `armature ${d.armatureName} was not built`;
    this.playClip(phase);
    this.onInstalled?.(this.cls.id, dir);
    this.refresh(); // the facing may have changed while loading: apply the mirror or start the next load
  }

  /** Clip for the move state; run falls back to walk, walk to idle if a rig lacks it. */
  private playClip(phase = 0): void {
    const armature = this.display.armature();
    if (!armature) return;
    const order: MoveState[] = this.moveState === 'run' ? ['run', 'walk', 'idle'] : [this.moveState, 'idle'];
    const clip = order.find((c) => armature.animation.hasAnimation(c)) ?? 'idle';
    if (clip === this.playing) return;
    this.playing = clip;
    // The exported SKE already runs at 24 Hz (frameRate 24); timeScale stays 1 so motion is not retimed.
    this.display.timeScale = 1;
    const state = armature.animation.fadeIn(clip, 0.08, 0);
    if (state && phase > 0) state.currentTime = phase * state.totalTime;
  }

  private loadAsset<T>(path: string, type: new () => T): Promise<T> {
    return new Promise((resolve, reject) =>
      resources.load(path, type as never, (err: Error | null, asset: unknown) =>
        err || !asset ? reject(err ?? new Error(`cannot load ${path}`)) : resolve(asset as T),
      ),
    );
  }

  /** Same loading contract as the viewer: `<stem>_<DIR>_ske|tex` plus optional extra atlas pages from `.sprite.json`. */
  private loadRig(dir: Direction): Promise<Rig> {
    const base = `${this.cls.folder}/${this.cls.stem}_${dir}`;
    let hit = this.rigs.get(base);
    if (!hit) {
      hit = (async () => {
        const [ske, tex] = await Promise.all([
          this.loadAsset(`${base}_ske`, dragonBones.DragonBonesAsset),
          this.loadAsset(`${base}_tex`, dragonBones.DragonBonesAtlasAsset),
        ]);
        if (resources.getInfoWithPath(`${base}.sprite`, JsonAsset)) {
          const contract = await this.loadAsset(`${base}.sprite`, JsonAsset);
          const pages: unknown = contract.json?.atlas?.textures;
          if (Array.isArray(pages) && pages.length > 1) {
            const factory = dragonBones.CCFactory.getInstance();
            tex.init(factory);
            const extras = await Promise.all(
              (pages as string[])
                .slice(1)
                .map((page) => this.loadAsset(`${this.cls.folder}/${page}`, dragonBones.DragonBonesAtlasAsset)),
            );
            for (const extra of extras) {
              const data = JSON.parse(extra.atlasJson) as { name: string; imagePath: string };
              const registered = factory.getTextureAtlasData(tex.uuid) ?? [];
              if (!registered.some((p) => p.name === data.name && p.imagePath === data.imagePath))
                factory.parseTextureAtlasData(data, extra.texture, tex.uuid);
            }
          }
        }
        return { ske, tex };
      })();
      this.rigs.set(base, hit);
      hit.catch(() => this.rigs.delete(base));
    }
    return hit;
  }
}
