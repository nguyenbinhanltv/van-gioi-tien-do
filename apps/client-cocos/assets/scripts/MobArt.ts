import { Color, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { combat as cb, core } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import type { MobSprite, PropArt } from './PropArt';
import { mobDefIdOfName, newMotion, stepMotion, type MotionState } from './MobMotion';

/**
 * INTERIM mob visuals. Until animated mob sprites exist, every mob in `MOB_DEFS` is a static "standee": the owner-provided
 * Gemini concept art (assets-src/concepts/mobs, faces LEFT) keyed and trimmed by `npm run gen:gemini -w @vgtd/procgen` into ONE
 * atlas page shared with the props, scaled to the mob's canvas by footprint (docs/03 section 6: normal 128, elite 192, boss 2x2 256,
 * boss 4x4 512 design px, longest side), foot pivot, flipped to face its movement, with a tiny idle bob, a hit flash and a fade on
 * death. Replace this file's visuals (not the hook in Combat.ts) when real animations land.
 */
/** Shadow width as a fraction of the sprite width, and its height / width (the placeholder shadow art is 2:1). */
const SHADOW_W_FRAC = 0.62;
const SHADOW_ASPECT = 0.5;

/** A mob's node in the L3 Y-sort layer (`node`, anchored at the foot) plus its visual state. */
export class MobStandee {
  readonly node: Node;
  private readonly body: Node;
  private readonly sprite: Sprite;
  private readonly motion: MotionState;
  /** sprite height above the foot (design px): where an overhead bar goes */
  readonly heightPx: number;
  /** false once the death fade finished (hide the node) */
  visible = true;

  private shadow: Node | null = null;
  private shadowSprite: Sprite | null = null;
  private readonly entry: MobSprite;

  constructor(id: number, entry: MobSprite, frame: SpriteFrame) {
    this.entry = entry;
    this.node = newNode(`Mob${id}`);
    this.body = newNode('body', this.node);
    const ui = this.body.addComponent(UITransform);
    ui.setContentSize(entry.w, entry.h);
    ui.setAnchorPoint(entry.pivot.x, 1 - entry.pivot.y); // Cocos anchor y is up
    this.sprite = this.body.addComponent(Sprite);
    this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.sprite.spriteFrame = frame;
    this.motion = newMotion(id);
    this.heightPx = entry.h * entry.pivot.y;
  }

  /** Soft ground shadow under the mob, in the shadow layer (placeholder atlas, like the player's): call once after `create`. */
  attachShadow(frame: SpriteFrame, parent: Node): void {
    if (this.shadow) return;
    const w = this.entry.w * SHADOW_W_FRAC;
    this.shadow = newNode(`MobShadow${this.node.name}`, parent);
    this.shadow.addComponent(UITransform).setContentSize(w, w * SHADOW_ASPECT);
    this.shadowSprite = this.shadow.addComponent(Sprite);
    this.shadowSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.shadowSprite.spriteFrame = frame;
  }

  /** The shadow node (to destroy with the mob), if one was attached. */
  get shadowNode(): Node | null {
    return this.shadow;
  }

  /**
   * Per frame: `pos` in tiles, `hp` absolute (a drop = a hit), `alive` from the backend; `face` = the player's tile position
   * (an idle mob turns to it).
   */
  update(
    dt: number,
    e: { pos: { i: number; j: number }; hp: number; alive: boolean },
    face?: { i: number; j: number },
  ): void {
    const o = stepMotion(this.motion, dt, e, face);
    this.visible = o.visible;
    if (this.shadow && this.shadowSprite) {
      this.shadow.active = o.visible;
      this.shadow.setPosition(this.node.position.x, this.node.position.y + 2, 0);
      this.shadowSprite.color = new Color(255, 255, 255, o.alpha);
    }
    this.body.setScale(o.scaleX, 1, 1);
    this.body.setPosition(0, o.bobY, 0);
    this.sprite.color = o.flashing ? new Color(255, 90, 90, o.alpha) : new Color(255, 255, 255, o.alpha);
  }
}

/**
 * Makes standees by mob wire id from the sprites `PropArt` loaded (same atlas page / Texture2D as the props, so props and mobs
 * batch together in the Y-sort). Null when the art was not generated: the placeholder sprite stays.
 */
export class MobArt {
  constructor(private readonly props: PropArt) {}

  /** A standee for the backend enemy: by `defId` (EnemyView.defId), else by a `Mob <id>` name; null for anything else. */
  create(entityId: number, name: string, defId?: number): MobStandee | null {
    const id = defId ?? mobDefIdOfName(name);
    const m = id === null ? undefined : this.props.mob(id);
    return m ? new MobStandee(entityId, m.entry, m.frame) : null;
  }
}

/**
 * `?combat=1&mobdemo=1`: the offline mock combat with all 14 mobs around the spawn (near to far), for screenshots and art review.
 * Dummies: stationary, nobody fights back.
 */
export function createMobDemoBackend(
  classId: string,
  pathOfClass: (classId: string) => string,
  spawn: { i: number; j: number },
  walkable: (i: number, j: number) => boolean,
  rand: () => number,
): InstanceType<typeof cb.MockCombat> {
  const specs: Array<{ name: string; defId: number; pos: { i: number; j: number } }> = [];
  for (let id = 1; id <= 14; id++) {
    // spiral outwards: 14 mobs on three rings, then the first free walkable tile near that spot
    const ring = 4 + Math.floor((id - 1) / 5) * 3.2;
    const a = ((id - 1) % 5) * 1.26 + (id > 10 ? 0.6 : id > 5 ? 0.3 : 0);
    let pos = { i: spawn.i + Math.cos(a) * ring, j: spawn.j + Math.sin(a) * ring };
    for (let r = 0; r < 6 && !walkable(Math.floor(pos.i), Math.floor(pos.j)); r++) {
      pos = {
        i: spawn.i + Math.cos(a + r * 0.3) * (ring + r * 0.8),
        j: spawn.j + Math.sin(a + r * 0.3) * (ring + r * 0.8),
      };
    }
    specs.push({ name: core.t('combat.mob.fallback_name', { id }), defId: id, pos });
  }
  return new cb.MockCombat({
    path: pathOfClass(classId) as never,
    enemies: specs,
    rand,
    playerPos: spawn,
  });
}
