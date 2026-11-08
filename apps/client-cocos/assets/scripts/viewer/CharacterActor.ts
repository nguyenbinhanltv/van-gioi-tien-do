import type { Node } from 'cc';
import type { character } from '../vendor/vgtd.mjs';
import type { Direction, SlotId } from './ViewerModel';

/** Where a character's armature data comes from: `resources/<folder>/<stem>_<DIR>_ske.json|_tex.json|_tex.png`. */
export interface RigSource {
  /** Sub-folder of assets/resources (default `dragonbones/viewer`). */
  folder: string;
  /** File stem before `_<DIR>` (default `rig`). */
  stem: string;
}

export type CacheMode = 'realtime' | 'shared' | 'private';

export interface ActorFrame {
  /** Seconds into the current animation (looped / clamped). */
  time: number;
  duration: number;
  /** Frame index at the animation table's fps. */
  frame: number;
  frames: number;
}

export interface ApplyOptions {
  /** Paperdoll variant (0 = default, 1 = red) for slots that ship variants. */
  skinIndex: number;
  timeScale: number;
  /** Fade-in / mix duration (s) when the animation changes. */
  mix: number;
  paused: boolean;
  /** Loop one-shots while viewing. */
  repeat: boolean;
  /** Clip (animation name in the rig) to play; defaults to the view state's animation id. */
  clip?: string;
  cache: CacheMode;
  /** Let armatures that share a texture draw in one batch (ArmatureDisplay.enableBatch). */
  batch: boolean;
  /** Slots whose display must be hidden. */
  hidden: ReadonlySet<SlotId>;
}

/** Loop seam quality of one animation: how big the wrap step is compared with a normal frame step. */
export interface SeamMetric {
  /** The animation loops per the animation table (docs/03): only these must wrap seamlessly. */
  specLoop: boolean;
  /** Currently played as a loop (spec loop, or a one-shot with `repeat one-shots`): the sampling is the same either way. */
  loop: boolean;
  /** Mean per-frame motion of all bones (px + deg-weighted). */
  meanStep: number;
  /** Motion between the last and the first frame (the loop wrap). */
  seamStep: number;
  /** seamStep / meanStep (about 1 = seamless; > 2.5 = visible pop). */
  ratio: number;
}

/**
 * The viewer talks to characters only through this interface. DragonBones (Cocos built-in module, D35) is the one
 * implementation; a Spine adapter could be added post-MVP if licensed (docs/32 section 6).
 */
export interface CharacterActor {
  setEquipmentVisuals?(
    folder: string,
    mapping: character.EquipmentVisualMapping,
    appearance: character.EquipmentAppearance,
  ): void;
  clearEquipmentVisuals?(): void;
  equipmentState?(): {
    requested: character.ResolvedEquipmentVisuals | null;
    installed: character.ResolvedEquipmentVisuals | null;
    loading: boolean;
    cacheEntries: number;
    slots: readonly { name: string; display: number; visible: boolean }[];
  };
  onEquipmentFx?: ((selection: character.ResolvedEquipmentVisuals | null) => void) | null;
  dispose?(): void;

  /** Node carrying position / mirror (scale.x = +-1). */
  readonly root: Node;
  /** Rig source folder / stem (may be changed before the first apply). */
  source: RigSource;
  /** Direction of the rig currently loaded (null while loading). */
  readonly skeletonDirection: Direction | null;
  /** Runtime features the active cache mode allows (scrub / mix / slot toggles need realtime). */
  readonly canSeek: boolean;
  onEvent: ((name: string, time: number) => void) | null;
  onRigLoaded: ((dir: Direction, texturePixels: number) => void) | null;
  onError: ((message: string) => void) | null;
  /** Apply the view state (rig, mirror, animation, visibility, speed). Cheap when nothing changed. */
  apply(view: character.CharacterViewState, opts: ApplyOptions): void;
  /** Time info (null while loading or in cached modes). */
  time(): ActorFrame | null;
  /** Jump to `t` seconds and render that pose. */
  seek(t: number): void;
  /** Restart the current animation. */
  restart(): void;
  /** Names of the clips in the loaded armature (empty when unknown). */
  clipNames(): string[];
  /** Current slot order, including per-frame z-order (back -> front). */
  slotOrder(): string[];
  /** RGBA tint (0..255) for ghost / onion-skin copies. */
  setTint(r: number, g: number, b: number, a: number): void;
  setVisible(v: boolean): void;
  /** Sample the current animation to measure the loop seam (realtime only). */
  seamMetric(): SeamMetric | null;
  /** Auxiliary blink layer: whether it plays and which eyes display is showing (null when the rig has none). */
  blinkProbe?(): { playing: boolean; eyes: string | null; time: number } | null;
}
