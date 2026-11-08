/** D45 browser-safe layer manifests, composition and lazy loading. Coordinates are logical px, y down from the pivot. */
import { DIRECTIONS, SPRITE_SMOOTH_FPS, type Direction } from '@vgtd/shared';
import { SPINE_EVENT_NAMES, SPINE_KEY_FPS, type SpineEventName } from './animations.js';
import { assertVisualSetId, type VisualTint } from './equipment-visuals.js';

export type SpriteLayerRole = 'body' | 'weapon' | 'fx';
export interface SpriteLayerDisplay {
  readonly name: string;
  readonly region: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
}
export interface SpriteLayerFrame {
  /** Integer ticks on the set's frameRate. */
  readonly at: number;
  readonly display: string | null;
  /** Required for every weapon frame, including hidden ones. */
  readonly order?: 'front' | 'back';
}
export interface SpriteLayerClip {
  readonly name: string;
  readonly duration: number;
  readonly loop: boolean;
  readonly frames: readonly SpriteLayerFrame[];
  readonly events: readonly { readonly at: number; readonly name: SpineEventName }[];
}
export interface SpriteLayerSet {
  /** Quality halos name the exact weapon silhouette they were derived from. */
  readonly derivedFromWeapon?: string;
  readonly format: 'vgtd-sprite-layer-set';
  readonly version: 1;
  readonly id: string;
  readonly role: SpriteLayerRole;
  readonly direction: Direction;
  /** Shared T1 motion identity; tiers/cosmetics must retain it. */
  readonly motionId: string;
  readonly frameRate: number;
  readonly canvas: {
    readonly width: number;
    readonly height: number;
    readonly pivotX: number;
    readonly pivotY: number;
  };
  /** Atlas resource stems local to this set's directory, without extensions. */
  readonly textures: readonly string[];
  readonly displays: readonly SpriteLayerDisplay[];
  readonly clips: readonly SpriteLayerClip[];
}

export function validateSpriteLayerSet(set: SpriteLayerSet): void {
  if (
    set.format !== 'vgtd-sprite-layer-set' ||
    set.version !== 1 ||
    !['body', 'weapon', 'fx'].includes(set.role) ||
    !DIRECTIONS.includes(set.direction) ||
    !set.motionId?.trim() ||
    ![SPINE_KEY_FPS, SPRITE_SMOOTH_FPS].includes(set.frameRate)
  )
    throw new Error('invalid sprite layer header/motion clock');
  assertVisualSetId(set.id);
  if (set.derivedFromWeapon !== undefined) {
    if (set.role !== 'fx') throw new Error('only FX sets may declare a source weapon');
    assertVisualSetId(set.derivedFromWeapon);
  }
  if (
    !set.canvas ||
    ![set.canvas.width, set.canvas.height, set.canvas.pivotX, set.canvas.pivotY].every(Number.isFinite) ||
    set.canvas.width <= 0 ||
    set.canvas.height <= 0
  )
    throw new Error('invalid sprite layer canvas');
  if (
    !Array.isArray(set.textures) ||
    !Array.isArray(set.displays) ||
    !Array.isArray(set.clips) ||
    !set.clips.length ||
    new Set(set.textures).size !== set.textures.length ||
    (set.displays.length && !set.textures.length)
  )
    throw new Error('invalid sprite layer lists');
  set.textures.forEach(assertVisualSetId);
  const displays = new Set<string>();
  for (const d of set.displays) {
    assertVisualSetId(d.name);
    assertVisualSetId(d.region);
    if (
      displays.has(d.name) ||
      ![d.x, d.y, d.width, d.height, d.textureWidth, d.textureHeight].every(Number.isFinite) ||
      [d.width, d.height, d.textureWidth, d.textureHeight].some((n) => n <= 0)
    )
      throw new Error('invalid/duplicate layer display');
    displays.add(d.name);
  }
  const clips = new Set<string>();
  for (const clip of set.clips as readonly SpriteLayerClip[]) {
    assertVisualSetId(clip.name);
    if (
      clips.has(clip.name) ||
      !Number.isInteger(clip.duration) ||
      clip.duration <= 0 ||
      typeof clip.loop !== 'boolean' ||
      !Array.isArray(clip.frames) ||
      !clip.frames.length ||
      clip.frames[0]!.at !== 0 ||
      !Array.isArray(clip.events)
    )
      throw new Error('invalid/duplicate layer clip');
    clips.add(clip.name);
    clip.frames.forEach((frame, i) => {
      if (
        !Number.isInteger(frame.at) ||
        frame.at < 0 ||
        frame.at >= clip.duration ||
        (i > 0 && frame.at <= clip.frames[i - 1]!.at) ||
        (frame.display !== null && !displays.has(frame.display)) ||
        (set.role === 'body' && frame.display === null) ||
        (set.role === 'weapon' && !['front', 'back'].includes(frame.order ?? ''))
      )
        throw new Error('invalid layer frame/display/order');
    });
    for (const e of clip.events)
      if (!Number.isInteger(e.at) || e.at < 0 || e.at >= clip.duration || !SPINE_EVENT_NAMES.includes(e.name))
        throw new Error('invalid layer event');
  }
}

/** Stable compatibility value, not a cryptographic provenance hash. */
export function spriteLayerMotionSignature(set: SpriteLayerSet): string {
  validateSpriteLayerSet(set);
  return JSON.stringify({
    motionId: set.motionId,
    direction: set.direction,
    frameRate: set.frameRate,
    canvas: {
      width: set.canvas.width,
      height: set.canvas.height,
      pivotX: set.canvas.pivotX,
      pivotY: set.canvas.pivotY,
    },
    clips: [...set.clips]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((c) => ({
        name: c.name,
        duration: c.duration,
        loop: c.loop,
        ticks: c.frames.map((f) => f.at),
        events: [...c.events]
          .sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          .map((e) => ({ at: e.at, name: e.name })),
      })),
  });
}

export const spriteLayerTexturePrefix = (set: Pick<SpriteLayerSet, 'role' | 'id'>): string => `${set.role}_${set.id}__`;

/** Clone and namespace each atlas page before registering different sets under one texture group. */
export function namespaceSpriteLayerAtlas<
  T extends { readonly name: string; readonly SubTexture: readonly { readonly name: string }[] },
>(atlas: T, set: Pick<SpriteLayerSet, 'role' | 'id'>) {
  const prefix = spriteLayerTexturePrefix(set);
  if (!atlas.name || !Array.isArray(atlas.SubTexture)) throw new Error('invalid layer texture atlas');
  return {
    ...atlas,
    name: `${prefix}${atlas.name}`,
    SubTexture: atlas.SubTexture.map((region) => ({ ...region, name: `${prefix}${region.name}` })),
  };
}

function eventFrames(clip: SpriteLayerClip) {
  const at = new Map<number, string[]>();
  for (const e of clip.events) at.set(e.at, [...(at.get(e.at) ?? []), e.name]);
  const frames: { duration: number; events?: { name: string }[] }[] = [];
  let cursor = 0;
  for (const tick of [...at.keys()].sort((a, b) => a - b)) {
    if (tick > cursor) frames.push({ duration: tick - cursor });
    frames.push({ duration: 1, events: at.get(tick)!.map((name) => ({ name })) });
    cursor = tick + 1;
  }
  if (cursor < clip.duration) frames.push({ duration: clip.duration - cursor });
  return frames;
}

/** One armature and event clock. Quality tint requires an FX layer; omit it for explicitly unlit compositions. */
export function composeSpriteLayers(input: {
  readonly name: string;
  readonly body: SpriteLayerSet;
  readonly weapon: SpriteLayerSet;
  readonly fx?: SpriteLayerSet;
  readonly glowTint?: VisualTint;
}) {
  assertVisualSetId(input.name);
  if (input.fx?.derivedFromWeapon !== undefined && input.fx.derivedFromWeapon !== input.weapon.id)
    throw new Error('quality FX belongs to a different weapon set');
  if (input.glowTint !== undefined && !input.fx) throw new Error('quality glow tint requires an fx layer');
  if (input.body.role !== 'body' || input.weapon.role !== 'weapon' || (input.fx && input.fx.role !== 'fx'))
    throw new Error('layer roles do not match composition slots');
  const sets = input.fx ? [input.fx, input.body, input.weapon] : [input.body, input.weapon];
  const signature = spriteLayerMotionSignature(input.body);
  for (const set of sets)
    if (spriteLayerMotionSignature(set) !== signature) throw new Error(`incompatible sprite motion '${set.id}'`);
  const tint = input.glowTint ?? [1, 1, 1, 1];
  if (tint.length !== 4 || tint.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
    throw new Error('invalid glow tint');
  const displayIndex = (set: SpriteLayerSet, name: string | null) =>
    name === null ? -1 : set.displays.findIndex((d) => d.name === name);
  const bodyIndex = sets.findIndex((set) => set.role === 'body');
  const animations = input.body.clips.map((clock) => {
    const weapon = input.weapon.clips.find((c) => c.name === clock.name)!;
    return {
      name: clock.name,
      duration: clock.duration,
      playTimes: clock.loop ? 0 : 1,
      fadeInTime: 0,
      slot: sets.map((set) => {
        const clip = set.clips.find((c) => c.name === clock.name)!;
        return {
          name: set.role,
          displayFrame: clip.frames.map((f, i) => ({
            duration: (clip.frames[i + 1]?.at ?? clip.duration) - f.at,
            value: displayIndex(set, f.display),
          })),
        };
      }),
      zOrder: {
        frame: weapon.frames.map((f, i) => ({
          duration: (weapon.frames[i + 1]?.at ?? weapon.duration) - f.at,
          zOrder: f.order === 'back' ? [bodyIndex, 1] : [],
        })),
      },
      ...(clock.events.length ? { frame: eventFrames(clock) } : {}),
    };
  });
  const skeleton = {
    version: '5.5',
    compatibleVersion: '5.5',
    frameRate: input.body.frameRate,
    name: input.name,
    armature: [
      {
        name: input.name,
        type: 'Armature',
        frameRate: input.body.frameRate,
        aabb: {
          x: -input.body.canvas.pivotX,
          y: -input.body.canvas.pivotY,
          width: input.body.canvas.width,
          height: input.body.canvas.height,
        },
        bone: [{ name: 'root' }],
        slot: sets.map((set) => ({
          name: set.role,
          parent: 'root',
          displayIndex: displayIndex(
            set,
            set.clips.find((c) => c.name === input.body.clips[0]!.name)!.frames[0]!.display,
          ),
          ...(set.role === 'fx'
            ? {
                blendMode: 'add',
                color: { rM: tint[0]! * 100, gM: tint[1]! * 100, bM: tint[2]! * 100, aM: tint[3]! * 100 },
              }
            : {}),
        })),
        skin: [
          {
            name: '',
            slot: sets.map((set) => ({
              name: set.role,
              display: set.displays.map((d) => ({
                type: 'image',
                name: `${spriteLayerTexturePrefix(set)}${d.name}`,
                path: `${spriteLayerTexturePrefix(set)}${d.region}`,
                transform: { x: d.x, y: d.y, scX: d.width / d.textureWidth, scY: d.height / d.textureHeight },
              })),
            })),
          },
        ],
        animation: animations,
      },
    ],
  };
  return {
    skeleton,
    motionSignature: signature,
    textures: sets.flatMap((set) =>
      set.textures.map((resource) => ({
        setId: set.id,
        role: set.role,
        resource,
        prefix: spriteLayerTexturePrefix(set),
      })),
    ),
  };
}

/** Loads only requested set/direction pairs and deduplicates concurrent callers. Failed requests can be retried. */
export class SpriteLayerCache {
  private readonly entries = new Map<string, Promise<SpriteLayerSet>>();
  constructor(private readonly load: (id: string, direction: Direction) => Promise<SpriteLayerSet>) {}
  get size(): number {
    return this.entries.size;
  }
  get(id: string, direction: Direction): Promise<SpriteLayerSet> {
    assertVisualSetId(id);
    if (!DIRECTIONS.includes(direction)) return Promise.reject(new Error('invalid sprite direction'));
    const key = `${id}:${direction}`;
    const cached = this.entries.get(key);
    if (cached) return cached;
    const pending = Promise.resolve()
      .then(() => this.load(id, direction))
      .then((set) => {
        validateSpriteLayerSet(set);
        if (set.id !== id || set.direction !== direction) throw new Error('loaded sprite set identity mismatch');
        return set;
      })
      .catch((error: unknown) => {
        if (this.entries.get(key) === pending) this.entries.delete(key);
        throw error;
      });
    this.entries.set(key, pending);
    return pending;
  }
  evict(id: string, direction?: Direction): void {
    for (const key of this.entries.keys())
      if (direction ? key === `${id}:${direction}` : key.startsWith(`${id}:`)) this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
}
