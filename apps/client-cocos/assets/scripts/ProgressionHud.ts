import { Color, Label, Node, Sprite, UITransform, game } from 'cc';
import { core } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import { sharedAtlas } from './UiLabel';

/**
 * Progression panel (D76 wire): stage label, tu vi bar, "Đả tọa [M]" and "Đột phá [N]" buttons and a toast line. Everything it shows
 * is the server's last `char_state` (client-core `ProgressionView`); a click or key only sends an intent and waits for the answer.
 *
 * Layout contract (shared with the other HUD panels): anchored to the TOP-RIGHT corner of the canvas, 8 px margin, `PANEL_W` x `PANEL_H`
 * design units (the toast hangs below it). The hotbar owns the bottom centre, the target frame the top centre, the perf HUD the top-left,
 * so this panel never overlaps them. A pointer press on a button is consumed here and must not also start click-to-move.
 */
export const PANEL_W = 300;
export const PANEL_H = 92;
const MARGIN = 8;
const BAR_W = PANEL_W - 24;
const BAR_H = 14;
const BTN_W = (PANEL_W - 36) / 2;
const BTN_H = 28;

const COL = {
  panel: new Color(10, 12, 20, 150),
  barBack: new Color(30, 30, 40, 220),
  bar: new Color(90, 190, 230, 255),
  barReady: new Color(250, 205, 70, 255),
  btnOn: new Color(70, 140, 90, 255),
  btnMeditating: new Color(200, 160, 50, 255),
  btnBreak: new Color(160, 80, 200, 255),
  btnOff: new Color(70, 70, 78, 255),
  text: new Color(240, 240, 245, 255),
  textOff: new Color(150, 150, 160, 255),
  good: new Color(120, 230, 140, 255),
  bad: new Color(255, 120, 110, 255),
  info: new Color(240, 220, 150, 255),
};

function quad(parent: Node, name: string, art: ArtFrames, w: number, h: number, color: Color, ax = 0.5): Sprite {
  const n = newNode(name, parent);
  const ui = n.addComponent(UITransform);
  ui.setContentSize(w, h);
  ui.setAnchorPoint(ax, 0.5);
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = art.pixel;
  sp.color = color;
  return sp;
}

function label(parent: Node, name: string, size: number, align: number): Label {
  const n = newNode(name, parent);
  n.addComponent(UITransform);
  const l = n.addComponent(Label);
  l.fontSize = size;
  l.lineHeight = size + 2;
  l.horizontalAlign = align;
  l.verticalAlign = Label.VerticalAlign.CENTER;
  l.overflow = Label.Overflow.NONE;
  l.color = COL.text;
  sharedAtlas(l);
  return l;
}

interface Button {
  root: Node;
  bg: Sprite;
  text: Label;
  /** centre in panel-local coordinates (origin = panel top-right corner, x <= 0, y <= 0) */
  x: number;
  y: number;
}

export class ProgressionHud {
  readonly view: InstanceType<typeof core.ProgressionView>;
  private readonly root: Node;
  private readonly title: Label;
  private readonly barFill: Sprite;
  private readonly barText: Label;
  private readonly meditate: Button;
  private readonly breakthrough: Button;
  private readonly toast: Label;
  private scale = 1;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly pointerDown: (e: PointerEvent) => void;

  constructor(
    hudParent: Node,
    private readonly art: ArtFrames,
    private readonly net: InstanceType<typeof core.NetClient>,
    private readonly clientToUi: (x: number, y: number) => { x: number; y: number },
  ) {
    this.view = new core.ProgressionView({
      now: () => performance.now(),
      newRequestId: () => core.requestIdFrom(Math.random),
    });
    // a separate hook object: combat replaces `net.events` wholesale when it attaches
    net.progressionEvents = {
      onCharState: (m) => this.view.applyCharState(m),
      onMeditateResult: (m) => this.view.applyMeditateResult(m),
      onBreakthroughResult: (m) => this.view.applyBreakthroughResult(m),
    };

    this.root = newNode('ProgressionHud', hudParent);
    const bg = quad(this.root, 'Panel', art, PANEL_W, PANEL_H, COL.panel);
    bg.node.setPosition(-PANEL_W / 2, -PANEL_H / 2, 0);
    this.title = label(this.root, 'Stage', 17, Label.HorizontalAlign.LEFT);
    this.title.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    this.title.node.setPosition(-PANEL_W + 12, -16, 0);
    const back = quad(this.root, 'BarBack', art, BAR_W, BAR_H, COL.barBack);
    back.node.setPosition(-PANEL_W / 2, -38, 0);
    this.barFill = quad(this.root, 'BarFill', art, 0, BAR_H - 4, COL.bar, 0);
    this.barFill.node.setPosition(-PANEL_W + 12 + 2, -38, 0);
    this.barText = sharedAtlas(label(this.root, 'BarText', 12, Label.HorizontalAlign.CENTER), 'dynamic'); // tu vi grows every tick
    this.barText.node.setPosition(-PANEL_W / 2, -38, 0);
    this.meditate = this.button('Meditate', -PANEL_W + 12 + BTN_W / 2, -70, 'Đả tọa [M]');
    this.breakthrough = this.button('Breakthrough', -12 - BTN_W / 2, -70, 'Đột phá [N]');
    this.toast = sharedAtlas(label(this.root, 'Toast', 14, Label.HorizontalAlign.RIGHT), 'dynamic');
    this.toast.node.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
    this.toast.node.setPosition(0, -PANEL_H - 14, 0);

    this.keyDown = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyDown);
    // press on a button: act, and keep client-core from also starting click-to-move on the same canvas
    this.pointerDown = (e) => this.onPointer(e);
    game.canvas?.addEventListener('pointerdown', this.pointerDown, { capture: true });
    this.layout(1280, 720);
    // automation hook (scripts/progression-online-smoke.mjs): the view state without touching the DOM / canvas pixels
    (globalThis as unknown as Record<string, unknown>).__vgtdProgression = {
      state: () => ({
        ...(this.view.state ?? {}),
        loaded: this.view.state !== null,
        toast: this.view.currentToast(),
        canMeditate: this.view.canMeditate(),
        canBreakthrough: this.view.canBreakthrough(),
      }),
    };
  }

  private button(name: string, x: number, y: number, caption: string): Button {
    const root = newNode(name, this.root);
    root.setPosition(x, y, 0);
    const bg = quad(root, 'Bg', this.art, BTN_W, BTN_H, COL.btnOff);
    const text = label(root, 'Text', 15, Label.HorizontalAlign.CENTER);
    text.string = caption;
    return { root, bg, text, x, y };
  }

  /** Re-anchor to the canvas size (design units): top-right corner, 8 px margin. */
  layout(canvasW: number, canvasH: number): void {
    this.scale = Math.min(1, (canvasW - 2 * MARGIN) / PANEL_W);
    this.root.setScale(this.scale, this.scale, 1);
    this.root.setPosition(canvasW / 2 - MARGIN, canvasH / 2 - MARGIN, 0);
  }

  update(): void {
    const v = this.view;
    const s = v.state;
    this.title.string = s ? s.label : 'Tu luyện…';
    const frac = s ? s.fraction : 0;
    this.barFill.node.getComponent(UITransform)!.setContentSize(Math.max(0, (BAR_W - 4) * frac), BAR_H - 4);
    this.barFill.color = s?.ready ? COL.barReady : COL.bar;
    this.barText.string = !s
      ? ''
      : s.maxStage
        ? 'cảnh giới cao nhất'
        : `${Math.floor(s.tuVi)} / ${Math.floor(s.tuViReq)}`;
    this.setButton(
      this.meditate,
      s?.meditating ? 'Dừng [M]' : 'Đả tọa [M]',
      v.canMeditate(),
      s?.meditating ? COL.btnMeditating : COL.btnOn,
    );
    this.setButton(this.breakthrough, 'Đột phá [N]', v.canBreakthrough(), COL.btnBreak);
    const t = v.currentToast();
    this.toast.string = t?.text ?? '';
    this.toast.color = t ? COL[t.tone] : COL.text;
  }

  private setButton(b: Button, caption: string, enabled: boolean, on: Color): void {
    b.text.string = caption;
    b.text.color = enabled ? COL.text : COL.textOff;
    b.bg.color = enabled ? on : COL.btnOff;
  }

  private send = (m: core.ProgressionCommand): boolean =>
    m.type === 'breakthrough_start'
      ? this.net.sendBreakthrough(m.requestId)
      : this.net.sendMeditate(m.type === 'meditate_start', m.requestId);

  private onKey(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') this.view.toggleMeditate(this.send);
    else if (e.key === 'n' || e.key === 'N') this.view.attemptBreakthrough(this.send);
  }

  private onPointer(e: PointerEvent): void {
    if (e.button !== 0) return;
    const ui = this.clientToUi(e.clientX, e.clientY);
    const lx = (ui.x - this.root.position.x) / this.scale;
    const ly = (ui.y - this.root.position.y) / this.scale;
    const hit = (b: Button) => Math.abs(lx - b.x) <= BTN_W / 2 && Math.abs(ly - b.y) <= BTN_H / 2;
    if (hit(this.meditate)) this.view.toggleMeditate(this.send);
    else if (hit(this.breakthrough)) this.view.attemptBreakthrough(this.send);
    else return;
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    game.canvas?.removeEventListener('pointerdown', this.pointerDown, { capture: true });
  }
}
