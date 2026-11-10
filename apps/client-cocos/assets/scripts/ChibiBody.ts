import { Node, UITransform, dragonBones } from 'cc';
import { character, shared } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import {
  chibiTierFor,
  loadChibiGroup,
  loadChibiIndex,
  loadChibiRig,
  type ChibiGroup,
  type ChibiIndex,
  type ChibiRig,
  type ChibiTier,
} from './ChibiAssets';

type Direction = shared.Direction;

/** Playable semi-chibi classes: URL `?class=<id>` and number keys 1-6 (order below). */
export interface ChibiClass {
  readonly id: string;
  /** Source export folder (viewer / tools) and file stem (`<stem>_<DIR>_ske|tex`, armature `<stem>_<DIR>`). Runtime bundles are `chibi-<id>-<dir>` (D71). */
  readonly folder: string;
  readonly stem: string;
}
export const CHIBI_CLASSES: readonly ChibiClass[] = [
  { id: 'the-tu', folder: 'dragonbones/the-tu-chibi-v1', stem: 'thetuchibi' },
  { id: 'phap-tu', folder: 'dragonbones/phap-tu-chibi-v1', stem: 'phaptuchibi' },
  { id: 'dan-phu-tu', folder: 'dragonbones/dan-phu-tu-chibi-v1', stem: 'danphuchibi' },
  { id: 'dao-tu', folder: 'dragonbones/dao-tu-chibi-v1', stem: 'daotuchibi' },
  { id: 'kiem-tu', folder: 'dragonbones/kiem-tu-chibi-v1', stem: 'kiemtuchibi' },
  { id: 'thuong-tu', folder: 'dragonbones/thuong-tu-chibi-v1', stem: 'thuongtuchibi' },
];
/** The five authored directions; W/SW/NW are always the mirror of E/SE/NE (D14). */
const AUTHORED: readonly Direction[] = ['E', 'SE', 'S', 'NE', 'N'];
/** Chibi class id of each playable class path (D82): the server decides the class, the client only maps it to art. */
const CHIBI_OF_PATH: Readonly<Record<string, string>> = {
  kiem: 'kiem-tu',
  phap: 'phap-tu',
  the: 'the-tu',
  dan_phu: 'dan-phu-tu',
  thuong: 'thuong-tu',
  dao: 'dao-tu',
};
/** `CHIBI_CLASSES` id of a class path id (`'kiem'` -> `'kiem-tu'`), or undefined for anything else. */
export function chibiIdOfPath(path: string): string | undefined {
  return CHIBI_OF_PATH[path];
}
/** Class path id of a chibi class id (`'kiem-tu'` -> `'kiem'`), or undefined. */
export function pathOfChibiId(id: string): string | undefined {
  return Object.keys(CHIBI_OF_PATH).find((p) => CHIBI_OF_PATH[p] === id);
}

export type MoveState = 'idle' | 'walk' | 'run';
/** Chibi masters are ~208 px tall in a 256 px cell; tiles are 64 px wide, so scale to ~1.3 tiles of height. */
export const CHIBI_SCALE = 0.42;

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
  private index: ChibiIndex | null = null;
  private rig: ChibiRig | null = null;
  /** Download priority: 0 = local player (loads immediately), >= 1 = background (NPCs, prefetch). */
  readonly priority: number;
  readonly tier: ChibiTier;
  private cls: ChibiClass = CHIBI_CLASSES[0]!;
  private avail: Direction[] = [];
  private want: Direction = 'S';
  private moveState: MoveState = 'idle';
  private seated = false;
  private loadedKey = '';
  private loadingKey = '';
  private playing = '';
  private epoch = 0;
  private error = '';
  private lastPick: ChibiPick | null = null;
  /** Called after a rig is installed (class or direction change); used by the capture hook. */
  onInstalled: ((cls: string, drawn: Direction) => void) | null = null;

  constructor(parent: Node, opts: { local?: boolean; tier?: ChibiTier; priority?: number } = {}) {
    this.tier = opts.tier ?? chibiTierFor(opts.local ?? false);
    this.priority = opts.priority ?? (opts.local ? 0 : 1);
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
    const have = this.avail.length ? this.avail.join('/') : this.index ? 'none merged' : 'loading';
    const p = this.lastPick;
    const fb = p?.approximate ? ` | facing ${this.want} -> nearest ${p.scaleX < 0 ? 'mirrored ' : ''}${p.drawn}` : '';
    return `chibi ${this.cls.id} ${this.tier} [${have}]${fb}`;
  }

  /** Switch class: reads which authored directions have runtime bundles (chibi-index), then loads the one in view. */
  setClass(id: string): boolean {
    const next = CHIBI_CLASSES.find((c) => c.id === id);
    if (!next) return false;
    this.cls = next;
    this.avail = [];
    this.error = '';
    this.rig = null;
    this.loadedKey = '';
    this.loadingKey = '';
    this.playing = '';
    const epoch = ++this.epoch;
    void loadChibiIndex()
      .then((idx) => {
        if (epoch !== this.epoch) return;
        this.index = idx;
        const dirs = idx.classes[next.id]?.directions ?? {};
        this.avail = AUTHORED.filter((d) => !!dirs[d]);
        this.error = this.avail.length ? '' : 'no direction merged yet';
        this.refresh();
      })
      .catch((e: unknown) => {
        if (epoch === this.epoch) this.error = `index: ${e instanceof Error ? e.message : String(e)}`;
      });
    return true;
  }

  face(dir: Direction): void {
    if (dir === this.want) return;
    this.want = dir;
    this.refresh();
  }

  /** Server says the character is meditating: play the seated `meditate` clip (when the rig has it) until cleared. */
  setSeated(on: boolean): void {
    if (on === this.seated) return;
    this.seated = on;
    // `meditate` is in the lazy `rest` clip group: until its atlas pages are registered its frames render blank, so keep the
    // current clip and switch once the group is in (ensureGroup also rebuilds the armature).
    if (on && this.rig && !this.rig.groups.has('rest')) {
      void this.ensureGroup('rest').then(() => {
        if (this.seated) {
          this.playing = '';
          this.playClip();
        }
      });
      return;
    }
    this.playing = '';
    this.playClip();
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
    if (!this.index) return;
    this.loadingKey = key;
    const epoch = this.epoch;
    void loadChibiRig(this.index, this.cls.id, pick.drawn, this.tier, this.priority)
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

  private install(dir: Direction, rig: ChibiRig, key: string): void {
    this.rig = rig;
    const prev = this.display.armature()?.animation.lastAnimationState;
    const phase = prev && prev.totalTime > 0 ? prev.currentTime / prev.totalTime : 0;
    const d = this.display;
    // atlas first: setting the skeleton builds the armature, which needs its atlas (else "No armature data" warnings)
    d.dragonAtlasAsset = rig.tex;
    d.dragonAsset = rig.ske;
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
    const seated = this.seated && !!this.rig?.groups.has('rest');
    const order: string[] = seated
      ? ['meditate', 'idle']
      : this.moveState === 'run'
        ? ['run', 'walk', 'idle']
        : [this.moveState, 'idle'];
    const clip = order.find((c) => armature.animation.hasAnimation(c)) ?? 'idle';
    if (clip === this.playing) return;
    this.playing = clip;
    // The exported SKE already runs at 24 Hz (frameRate 24); timeScale stays 1 so motion is not retimed.
    this.display.timeScale = 1;
    const state = armature.animation.fadeIn(clip, 0.08, 0);
    if (state && phase > 0) state.currentTime = phase * state.totalTime;
  }

  /**
   * Loads a clip group on demand (`rest`: combat, emote, ...), then rebuilds the armature so its frames render. Until then
   * only `loco` clips (idle/walk/run) can play. Resolves false when no rig is shown yet.
   */
  async ensureGroup(group: ChibiGroup): Promise<boolean> {
    const rig = this.rig;
    if (!rig) return false;
    if (!rig.groups.has(group)) await loadChibiGroup(rig, group, this.priority);
    if (this.rig === rig && this.loadedKey) this.install(this.shown.drawn!, rig, this.loadedKey);
    return true;
  }

  /** Queues the other authored directions of this class (background priority) so facing changes do not hitch. */
  prefetchDirections(): void {
    if (!this.index) return;
    for (const d of this.avail)
      void loadChibiRig(this.index, this.cls.id, d, this.tier, Math.max(1, this.priority)).catch(() => undefined);
  }
}
