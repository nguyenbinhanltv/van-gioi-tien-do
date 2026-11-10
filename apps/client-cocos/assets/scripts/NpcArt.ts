import { Color, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { shared } from './vendor/vgtd.mjs';
import { NPC_HEIGHT_TILES, scaleForHeight } from './WorldScale';
import { footprintSortable, newNode, tileToWorld } from './IsoAdapter';
import { allocSortId } from './Actors';
import { newMotion, stepMotion, type MotionState } from './MobMotion';
import type { NpcSprite, PropArt } from './PropArt';
import type { YSortLayer } from './YSortLayer';
import type { PlacedNpc } from './NpcPlacement';

/**
 * INTERIM Son Mon NPCs: the owner's front-facing concept art (assets-src/concepts/npcs) as static standees with the same idle bob as the
 * mob standees, a ground shadow and a foot pivot, standing on the tile they block. They share the prop atlas page (one texture with the
 * props and mobs, so the Y-sort batching and the 65 draw-call gate are unaffected) and are culled like any L3 node. Keyed `npc_<name>`;
 * the sect system (D98) maps its NPC ids onto these keys. Replaced by animated sprites when they exist.
 */
const SHADOW_W_FRAC = 0.8;
const SHADOW_ASPECT = 0.5;
/** Extra reach (px) above the sprite height for the culling margin. */
const REACH_PAD = 30;

export class NpcStandee {
  readonly node: Node;
  private readonly body: Node;
  private readonly shadow: Node | null;
  private readonly motion: MotionState;
  /** world scale (WorldScale.ts, D123): every NPC stands as tall as the player whatever its concept art size */
  private readonly scale: number;

  constructor(
    readonly key: string,
    readonly tile: { i: number; j: number },
    private readonly entry: NpcSprite,
    frame: SpriteFrame,
    shadowFrame: SpriteFrame | null,
    shadowParent: Node | null,
  ) {
    this.scale = scaleForHeight(NPC_HEIGHT_TILES, entry.h, shared.TILE_WIDTH);
    this.node = newNode(`Npc_${key}`);
    this.body = newNode('body', this.node);
    const ui = this.body.addComponent(UITransform);
    ui.setContentSize(entry.w, entry.h);
    ui.setAnchorPoint(entry.pivot.x, 1 - entry.pivot.y); // Cocos anchor y is up
    this.body.setScale(this.scale, this.scale, 1);
    const sp = this.body.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = frame;
    this.motion = newMotion(tile.i * 31 + tile.j);
    this.node.setPosition(tileToWorld(tile.i + 0.5, tile.j + 0.5));
    if (shadowFrame && shadowParent) {
      const w = entry.w * this.scale * SHADOW_W_FRAC;
      this.shadow = newNode(`NpcShadow_${key}`, shadowParent);
      this.shadow.addComponent(UITransform).setContentSize(w, w * SHADOW_ASPECT);
      const ss = this.shadow.addComponent(Sprite);
      ss.sizeMode = Sprite.SizeMode.CUSTOM;
      ss.spriteFrame = shadowFrame;
      ss.color = new Color(255, 255, 255, 255);
      this.shadow.setPosition(this.node.position.x, this.node.position.y + 2, 0);
    } else this.shadow = null;
  }

  /** How far the art reaches above the foot (the culling margin of the Y-sort entry). */
  get reach(): number {
    return this.entry.h * this.scale + REACH_PAD;
  }

  /** Idle bob only: an NPC never moves and never faces anything (the art is front-facing). */
  update(dt: number): void {
    const o = stepMotion(this.motion, dt, { pos: { i: this.tile.i, j: this.tile.j }, hp: 1, alive: true });
    this.body.setPosition(0, o.bobY, 0);
  }

  destroy(): void {
    this.shadow?.destroy();
  }
}

/** Makes the NPC standees from the sprites `PropArt` loaded (nothing is created when the art was not generated). */
export class NpcArt {
  constructor(private readonly props: PropArt) {}

  /** Creates the standee of `placed`, registers it on the Y-sort layer and returns it; null for a key without art. */
  add(
    ysort: YSortLayer,
    placed: PlacedNpc,
    shadowFrame: SpriteFrame | null,
    shadowParent: Node | null,
  ): NpcStandee | null {
    const sprite = this.props.npc(placed.key);
    if (!sprite) return null;
    const st = new NpcStandee(placed.key, placed, sprite.entry, sprite.frame, shadowFrame, shadowParent);
    const key = footprintSortable(allocSortId(), 0, placed.i, placed.j, 1, 1);
    ysort.add(st.node, () => key, st.reach);
    return st;
  }
}
