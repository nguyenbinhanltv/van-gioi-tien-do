import { Color, Graphics, Label, Node, Sprite, UITransform, Vec2, game } from 'cc';
import { combat as cb, core, shared } from './vendor/vgtd.mjs';
import { newNode, tileToWorld } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import type { TilePos } from './Actors';
import type { CombatUi } from './Combat';
import { worldUiLayer } from './OverheadBar';
import { sharedAtlas } from './UiLabel';

interface Btn {
  root: Node;
  bg: Sprite;
  cd: Sprite;
  gcd: Sprite;
  icon: Sprite;
  label: Label;
  cdText: Label;
}

const DIM = new Color(255, 255, 255, 110);

/**
 * Touch skill wheel (docs/05 §2): draws the client-core `TouchController` state in the HUD and, while a skill button is dragged, the aim
 * indicator on the ground (a 2:1 ellipse at the aim point and a line from the character) plus the Cancel zone. The input itself (tap =
 * auto-target cast, drag = aim, drag back / into the Cancel zone = no cast, page swipe) lives in `TouchController`; casts reach the
 * combat HUD through `frame.casts` -> `CombatUi.castFromWheel` (Bootstrap). Shown only in touch input mode; the desktop hotbar is untouched.
 */
export class SkillWheel {
  private readonly root: Node;
  private readonly buttons = new Map<string, Btn>();
  private readonly aimGfx: Graphics;
  private readonly cancelNode: Node;
  private readonly cancelSprite: Sprite;
  private readonly cancelLabel: Label;
  private readonly pageLabel: Label;
  private aimDrawn = false;

  constructor(
    hudParent: Node,
    worldRoot: Node,
    private readonly art: ArtFrames,
    private readonly combat: CombatUi,
    private readonly touch: () => InstanceType<typeof core.TouchController>,
    private readonly isTouchMode: () => boolean,
    private readonly playerPos: () => TilePos,
    private readonly clientToUi: (x: number, y: number) => { x: number; y: number },
  ) {
    this.root = newNode('SkillWheel', hudParent);
    this.root.active = false;
    this.cancelNode = newNode('Cancel', this.root);
    this.cancelNode.addComponent(UITransform);
    this.cancelSprite = this.cancelNode.addComponent(Sprite);
    this.cancelSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.cancelSprite.spriteFrame = art.pixel;
    this.cancelLabel = this.text(this.cancelNode, 'Label', 18, new Color(255, 255, 255, 255));
    this.cancelLabel.string = 'Huy / Cancel';
    this.cancelNode.active = false;
    this.pageLabel = this.text(this.root, 'Page', 14, new Color(255, 255, 255, 200));
    const g = newNode('AimIndicator', worldUiLayer(worldRoot));
    g.addComponent(UITransform);
    this.aimGfx = g.addComponent(Graphics);
    this.aimGfx.lineWidth = 3;
    // automation hook (scripts/touch-aim-smoke.mjs): the live touch state without reading canvas pixels
    (globalThis as unknown as Record<string, unknown>).__vgtdWheel = {
      visual: () => {
        const v = this.touch().visualState();
        return v ? JSON.parse(JSON.stringify(v)) : null;
      },
      shown: () => this.root.active,
      aimDrawn: () => this.aimDrawn,
    };
  }

  private text(parent: Node, name: string, size: number, color: Color): Label {
    const n = newNode(name, parent);
    n.addComponent(UITransform);
    const l = n.addComponent(Label);
    l.fontSize = size;
    l.lineHeight = size + 2;
    l.horizontalAlign = Label.HorizontalAlign.CENTER;
    l.verticalAlign = Label.VerticalAlign.CENTER;
    l.overflow = Label.Overflow.NONE;
    l.color = color;
    sharedAtlas(l);
    return l;
  }

  private radial(sp: Sprite): void {
    sp.type = Sprite.Type.FILLED;
    sp.fillType = Sprite.FillType.RADIAL;
    sp.fillCenter = new Vec2(0.5, 0.5);
    sp.fillStart = 0.25;
    sp.fillRange = 0;
  }

  private button(id: string): Btn {
    let b = this.buttons.get(id);
    if (b) return b;
    const root = newNode(`Btn-${id}`, this.root);
    const mk = (name: string, color: Color): Sprite => {
      const n = newNode(name, root);
      n.addComponent(UITransform);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = this.art.joyBase;
      sp.color = color;
      return sp;
    };
    const bg = mk('Bg', new Color(120, 120, 120, 200));
    const icon = mk('Icon', new Color(255, 255, 255, 255));
    icon.node.active = false;
    const cd = mk('Cd', new Color(0, 0, 0, 175));
    const gcd = mk('Gcd', new Color(255, 255, 255, 75));
    this.radial(cd);
    this.radial(gcd);
    const label = this.text(root, 'Label', 18, new Color(255, 255, 255, 255));
    const cdText = this.text(root, 'CdText', 20, new Color(255, 255, 255, 255));
    b = { root, bg, icon, cd, gcd, label, cdText };
    this.buttons.set(id, b);
    return b;
  }

  /** Per frame, after the input was polled and the combat HUD updated. */
  update(): void {
    const v = this.isTouchMode() ? this.touch().visualState() : null;
    this.root.active = !!v;
    this.aimGfx.clear();
    this.aimDrawn = false;
    if (!v) return;
    const r = game.canvas!.getBoundingClientRect();
    const ui = (x: number, y: number) => this.clientToUi(r.left + x, r.top + y);
    const unit = this.clientToUi(r.left + 1, r.top).x - this.clientToUi(r.left, r.top).x; // design units per css px
    const k = Number.isFinite(unit) && unit > 0 ? unit : 1;
    let aimed: { slot: number } | null = null;
    for (const b of v.buttons) {
      const btn = this.button(b.id);
      const p = ui(b.center.x, b.center.y);
      const size = b.radius * 2 * k;
      btn.root.setPosition(p.x, p.y, 0);
      for (const sp of [btn.bg, btn.cd, btn.gcd]) sp.node.getComponent(UITransform)!.setContentSize(size, size);
      btn.icon.node.getComponent(UITransform)!.setContentSize(size * 0.78, size * 0.78);
      btn.root.setScale(b.pressed ? 1.1 : 1, b.pressed ? 1.1 : 1, 1);
      const view = b.slot === null ? null : this.combat.slotView(b.slot);
      if (b.slot !== null && b.pressed && view) aimed = { slot: b.slot };
      if (view) {
        btn.bg.color = view.castable
          ? view.color
          : new Color(view.color.r * 0.45, view.color.g * 0.45, view.color.b * 0.45, 255);
        btn.label.string = view.icon ? '' : view.label;
        // the Gemini skill icon sits on the element-coloured disc; a passive / unavailable skill is dimmed
        if (view.icon && btn.icon.spriteFrame !== view.icon) btn.icon.spriteFrame = view.icon;
        btn.icon.node.active = !!view.icon;
        btn.icon.color = view.castable ? new Color(255, 255, 255, 255) : new Color(255, 255, 255, 150);
        btn.label.fontSize = b.id === 'attack' ? 24 : 18;
        btn.cd.fillRange = view.cd;
        btn.cd.node.active = view.cd > 0;
        btn.gcd.fillRange = view.gcd;
        btn.gcd.node.active = view.gcd > 0;
        btn.cdText.string = view.cdText;
      } else {
        // dodge / fly (not wired to the server yet) and wheel slots past the 8 hotbar skills: dim, no label for empty ones
        btn.bg.color = DIM;
        btn.label.string = b.id === 'dodge' ? 'NE' : b.id === 'fly' ? 'BAY' : '';
        btn.icon.node.active = false;
        btn.cd.node.active = false;
        btn.gcd.node.active = false;
        btn.cdText.string = '';
      }
      btn.label.fontSize = Math.max(12, Math.round(size * 0.3));
    }
    const centre = v.buttons[0]!.center; // the attack button is the wheel centre
    const pc = ui(centre.x, centre.y - v.buttons[0]!.radius - 14);
    this.pageLabel.string = `${v.page + 1}/${core.SKILL_PAGES}`;
    this.pageLabel.node.setPosition(pc.x, pc.y, 0);

    // Cancel zone + aim indicator, only while a button is dragged for aiming
    this.cancelNode.active = v.cancelVisible && !!v.cancelRect;
    if (this.cancelNode.active && v.cancelRect) {
      const c = v.cancelRect;
      const p = ui(c.x + c.w / 2, c.y + c.h / 2);
      this.cancelNode.setPosition(p.x, p.y, 0);
      this.cancelNode.getComponent(UITransform)!.setContentSize(c.w * k, c.h * k);
      this.cancelSprite.color = v.aim?.overCancel ? new Color(220, 50, 50, 230) : new Color(60, 20, 20, 170);
    }
    if (v.aim && aimed) this.drawAim(aimed.slot, v.aim);
  }

  /** The ground indicator: where the server will anchor the cast (aim pulled back to the skill's range), 2:1 ellipse like the tile grid. */
  private drawAim(slot: number, aim: { tile: TilePos; overCancel: boolean; backAtOrigin: boolean }): void {
    const view = this.combat.slotView(slot);
    if (!view) return;
    this.aimDrawn = true;
    const me = this.playerPos();
    const g = this.aimGfx;
    const dropped = aim.overCancel || aim.backAtOrigin;
    const color = aim.overCancel
      ? new Color(255, 70, 70, 230)
      : aim.backAtOrigin
        ? new Color(160, 160, 160, 200)
        : new Color(255, 245, 160, 235);
    g.strokeColor = color;
    g.fillColor = new Color(color.r, color.g, color.b, 50);
    const from = tileToWorld(me.i, me.j);
    const target = dropped ? me : (cb.clampAimToRange(me, aim.tile, view.rangeTiles) ?? aim.tile);
    const to = tileToWorld(target.i, target.j);
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke();
    // a tile-space circle of radius r is an ellipse of semi-axes r * TILE_WIDTH / sqrt(2) by half of that on screen
    const r = Math.max(0.6, view.shape.radius ?? 0.8);
    const rx = (r * shared.TILE_WIDTH) / Math.SQRT2;
    g.ellipse(to.x, to.y, rx, rx / 2);
    g.fill();
    g.ellipse(to.x, to.y, rx, rx / 2);
    g.stroke();
  }

  destroy(): void {
    this.root.destroy();
    this.aimGfx.node.destroy();
  }
}
