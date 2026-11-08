import { Color, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { combat as cb } from './vendor/vgtd.mjs';
import { newNode, tileToWorld } from './IsoAdapter';

const W = 44;
const H = 6;
const TONE: Record<string, Color> = {
  self: new Color(80, 210, 110, 255),
  ally: new Color(90, 190, 255, 255),
  enemy: new Color(215, 60, 60, 255),
  target: new Color(255, 150, 60, 255),
};

/** The world-UI layer (L6) of the world root, created on first use; bars and floating numbers live in it, above the Y-sorted entities. */
export function worldUiLayer(worldRoot: Node): Node {
  return worldRoot.getChildByName('L6_WorldUI') ?? newNode('L6_WorldUI', worldRoot);
}

/**
 * Overhead HP bar of one entity (mob, other player, or the local player). What it shows is decided by `cb.overheadBar` (engine-free,
 * tested): hidden at full HP unless targeted, a few seconds after a hit for others, always while hurt for the own bar, never when dead.
 * It watches the HP it is fed to know when the entity was last hurt.
 */
export class OverheadBar {
  private readonly root: Node;
  private readonly back: Sprite;
  private readonly fill: Sprite;
  private lastHp = -1;
  private sinceHurtMs = Infinity;

  constructor(
    parent: Node,
    pixel: SpriteFrame,
    private readonly lift: number,
  ) {
    this.root = newNode('OverheadBar', parent);
    this.root.active = false;
    const mk = (name: string, w: number, h: number, ax: number): Sprite => {
      const n = newNode(name, this.root);
      const ui = n.addComponent(UITransform);
      ui.setContentSize(w, h);
      ui.setAnchorPoint(ax, 0.5);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = pixel;
      return sp;
    };
    this.back = mk('Back', W + 2, H + 2, 0.5);
    this.fill = mk('Fill', W, H, 0);
    this.fill.node.setPosition(-W / 2, 0, 0);
  }

  get visible(): boolean {
    return this.root.active;
  }

  /** Place the bar above a tile, in the world-UI layer. */
  place(i: number, j: number): void {
    const p = tileToWorld(i, j);
    this.root.setPosition(p.x, p.y + this.lift, 0);
  }

  update(
    dtMs: number,
    s: { hp: number; hpMax: number; alive?: boolean; kind: 'self' | 'ally' | 'enemy'; targeted?: boolean },
  ): void {
    if (this.lastHp >= 0 && s.hp < this.lastHp) this.sinceHurtMs = 0;
    else this.sinceHurtMs += dtMs;
    this.lastHp = s.hp;
    const st = cb.overheadBar({ ...s, sinceHurtMs: this.sinceHurtMs });
    this.root.active = st.visible;
    if (!st.visible) return;
    this.fill.node.getComponent(UITransform)!.setContentSize(W * st.fraction, H);
    const c = TONE[st.tone]!;
    this.fill.color = new Color(c.r, c.g, c.b, Math.round(255 * st.alpha));
    this.back.color = new Color(0, 0, 0, Math.round(190 * st.alpha));
  }

  destroy(): void {
    this.root.destroy();
  }
}
