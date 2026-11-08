import { Color, Label, Node, Sprite, UITransform, game } from 'cc';
import { core } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';

type Bag = InstanceType<typeof core.BagModel>;

/** What the panel needs from the session (kept as callbacks so it works online, and in the offline `#bagdemo`). */
export interface BagPanelHooks {
  /** the bag model to show, or null when there is none (offline) */
  bag(): Bag | null;
  /** move slot `from` onto `to`; false when it could not be sent */
  move(from: number, to: number): boolean;
  /** claim pending loot; false when it could not be sent */
  claim(): boolean;
  clientToUi(clientX: number, clientY: number): { x: number; y: number };
}

const SLOTS_DRAWN = 40;
const rgb = (c: readonly [number, number, number], a = 255): Color => new Color(c[0], c[1], c[2], a);

function quad(parent: Node, name: string, art: ArtFrames, w: number, h: number, color: Color): Sprite {
  const n = newNode(name, parent);
  n.addComponent(UITransform).setContentSize(w, h);
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = art.pixel;
  sp.color = color;
  return sp;
}
function label(parent: Node, name: string, size: number, color: Color): Label {
  const n = newNode(name, parent);
  n.addComponent(UITransform);
  const l = n.addComponent(Label);
  l.fontSize = size;
  l.lineHeight = size + 2;
  l.horizontalAlign = Label.HorizontalAlign.CENTER;
  l.verticalAlign = Label.VerticalAlign.CENTER;
  l.overflow = Label.Overflow.NONE;
  l.color = color;
  return l;
}

interface SlotUi {
  outline: Sprite;
  bg: Sprite;
  item: Sprite;
  quality: Sprite;
  code: Label;
  qty: Label;
}

/**
 * The bag and the stone wallet, drawn from the server's `inv_state` (D79). Key B toggles it; click an item, then another slot to
 * move / swap / merge (the server decides: the new state arrives as `inv_state`); a Claim button appears while loot is pending.
 * Layout, hit testing and click logic live in client-core (`BagPanelLogic`, unit tested); this class only draws them. Placeholder
 * look: coloured tiles with a short code, a quality bar, quantity. No item art, prices or shop.
 */
export class BagPanel {
  private readonly root: Node;
  private readonly slots: SlotUi[] = [];
  private readonly title: Label;
  private readonly wallet: Label;
  private readonly hint: Label;
  private readonly toast: Label;
  private readonly claimBtn: Node;
  private readonly claimText: Label;
  private readonly selection = new core.BagSelection();
  private visible: boolean;
  private scale = 1;
  private lastStates = -1;
  private lastSelected: number | null = null;
  private lastWaiting = -1;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly pointerDown: (e: PointerEvent) => void;
  private readonly size = core.bagPanelSize(SLOTS_DRAWN);

  constructor(
    parent: Node,
    art: ArtFrames,
    private readonly hooks: BagPanelHooks,
    startVisible = false,
  ) {
    this.visible = startVisible;
    this.root = newNode('BagPanel', parent);
    this.root.addComponent(UITransform).setContentSize(this.size.w, this.size.h);
    quad(this.root, 'bg', art, this.size.w, this.size.h, new Color(18, 20, 28, 240));
    quad(this.root, 'border', art, this.size.w, 2, new Color(120, 110, 80, 255)).node.setPosition(
      0,
      this.size.h / 2 - 1,
      0,
    );
    this.title = label(this.root, 'title', 16, new Color(235, 225, 190, 255));
    this.title.string = 'BAG  [B]';
    this.title.node.setPosition(0, this.size.h / 2 - 16, 0);
    this.wallet = label(this.root, 'wallet', 13, new Color(200, 210, 230, 255));
    this.wallet.node.setPosition(0, this.size.h / 2 - 38, 0);
    for (let i = 0; i < SLOTS_DRAWN; i++) {
      const r = core.slotRect(i);
      const holder = newNode(`slot${i}`, this.root);
      holder.setPosition(r.x + r.w / 2 - this.size.w / 2, this.size.h / 2 - (r.y + r.h / 2), 0);
      const outline = quad(holder, 'outline', art, r.w + 4, r.h + 4, new Color(255, 230, 90, 255));
      outline.node.active = false;
      const bg = quad(holder, 'bg', art, r.w, r.h, new Color(44, 48, 62, 255));
      const item = quad(holder, 'item', art, r.w - 8, r.h - 8, new Color(255, 255, 255, 255));
      item.node.active = false;
      const quality = quad(holder, 'quality', art, r.w - 8, 4, new Color(255, 255, 255, 255));
      quality.node.setPosition(0, (r.h - 8) / 2 - 2, 0);
      quality.node.active = false;
      const code = label(holder, 'code', 14, new Color(255, 255, 255, 255));
      const qty = label(holder, 'qty', 11, new Color(255, 255, 255, 255));
      qty.node.setPosition(10, -14, 0);
      this.slots.push({ outline, bg, item, quality, code, qty });
    }
    const cb = core.claimButtonRect(SLOTS_DRAWN);
    this.claimBtn = newNode('claim', this.root);
    this.claimBtn.setPosition(cb.x + cb.w / 2 - this.size.w / 2, this.size.h / 2 - (cb.y + cb.h / 2), 0);
    quad(this.claimBtn, 'bg', art, cb.w, cb.h, new Color(70, 120, 80, 255));
    this.claimText = label(this.claimBtn, 'text', 13, new Color(255, 255, 255, 255));
    this.claimBtn.active = false;
    this.toast = label(this.root, 'toast', 12, new Color(255, 170, 120, 255));
    this.toast.node.setPosition(60, -this.size.h / 2 + 20, 0);
    this.hint = label(this.root, 'hint', 14, new Color(190, 190, 190, 255));
    this.hint.node.setPosition(0, 0, 0);

    this.root.active = this.visible;
    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyB') this.toggle();
    };
    window.addEventListener('keydown', this.keyDown);
    // a click on the panel must not also start click-to-move (client-core listens on the same canvas)
    this.pointerDown = (e) => this.onPointer(e);
    game.canvas?.addEventListener('pointerdown', this.pointerDown, { capture: true });
    // automation hook (headless capture): read / drive the panel without touching canvas pixels
    (globalThis as unknown as Record<string, unknown>).__vgtdBag = {
      state: () => this.debugState(),
      toggle: () => this.toggle(),
      clickSlot: (i: number) => {
        const r = core.slotRect(i);
        return this.click(r.x + r.w / 2, r.y + r.h / 2);
      },
      clickClaim: () => {
        const r = core.claimButtonRect(SLOTS_DRAWN);
        return this.click(r.x + 4, r.y + 4);
      },
    };
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.active = this.visible;
    this.lastStates = -1;
  }

  /** Re-anchor to the canvas size (design units): centred, shrunk to fit. */
  layout(canvasW: number, canvasH: number): void {
    this.scale = Math.min(1, (canvasW - 20) / this.size.w, (canvasH - 40) / this.size.h);
    this.root.setScale(this.scale, this.scale, 1);
    this.root.setPosition(0, 0, 0);
  }

  private bag(): Bag | null {
    const b = this.hooks.bag();
    return b && b.ready ? b : null;
  }

  update(_dt: number): void {
    if (!this.visible) return;
    const bag = this.bag();
    this.hint.node.active = !bag;
    if (!bag) {
      this.hint.string = this.hooks.bag() ? 'waiting for the server...' : 'bag needs ?online=1';
      this.wallet.string = '';
      for (const s of this.slots) this.hideSlot(s);
      this.claimBtn.active = false;
      this.lastStates = -1;
      return;
    }
    if (
      bag.states === this.lastStates &&
      this.selection.selected === this.lastSelected &&
      bag.waitingCount === this.lastWaiting
    )
      return;
    this.lastStates = bag.states;
    this.lastSelected = this.selection.selected;
    this.lastWaiting = bag.waitingCount;
    this.selection.validate(bag);
    this.wallet.string = core.walletText(bag);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (i >= bag.slotCount) {
        this.hideSlot(s);
        continue;
      }
      s.bg.node.active = true;
      s.outline.node.active = this.selection.selected === i;
      const it = bag.itemAt(i);
      if (!it) {
        s.item.node.active = false;
        s.quality.node.active = false;
        s.code.string = '';
        s.qty.string = '';
        continue;
      }
      const st = core.itemStyle(it);
      s.item.node.active = true;
      s.item.color = rgb(st.color);
      s.quality.node.active = true;
      s.quality.color = rgb(st.quality);
      s.code.string = st.code;
      s.qty.string =
        it.kind === 'stack' && it.qty > 1
          ? String(it.qty)
          : it.durability !== null
            ? `${core.durabilityPercent(it)}%`
            : '';
    }
    this.claimBtn.active = bag.pending.length > 0;
    this.claimText.string = `Claim loot (${bag.pendingTotal})`;
    const last = bag.lastResult;
    this.toast.string = last && last.reason !== 0 ? core.invReasonText(last.reason) : '';
  }

  private hideSlot(s: SlotUi): void {
    s.outline.node.active = false;
    s.bg.node.active = false;
    s.item.node.active = false;
    s.quality.node.active = false;
    s.code.string = '';
    s.qty.string = '';
  }

  /** Panel-local click (design units, origin top-left, y down). Returns what happened. */
  private click(lx: number, ly: number): string {
    const bag = this.bag();
    if (!bag) return 'none';
    const c = this.selection.click(lx, ly, bag);
    if (c.type === 'move') this.hooks.move(c.from, c.to);
    else if (c.type === 'claim') this.hooks.claim();
    this.lastSelected = -2; // force a redraw of the selection outline
    return c.type;
  }

  private onPointer(e: PointerEvent): void {
    if (!this.visible) return;
    const ui = this.hooks.clientToUi(e.clientX, e.clientY);
    const rp = this.root.position;
    const lx = (ui.x - rp.x) / this.scale + this.size.w / 2;
    const ly = this.size.h / 2 - (ui.y - rp.y) / this.scale;
    if (!core.insidePanel(lx, ly, SLOTS_DRAWN)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.button === 0) this.click(lx, ly);
  }

  private debugState(): unknown {
    const bag = this.hooks.bag();
    return {
      visible: this.visible,
      ready: !!bag && bag.ready,
      states: bag?.states ?? 0,
      selected: this.selection.selected,
      wallet: bag?.wallet ?? null,
      pending: bag?.pendingTotal ?? 0,
      waiting: bag?.waitingCount ?? 0,
      lastResult: bag?.lastResult ?? null,
      slots: this.slots
        .map((s, i) => (s.code.string ? `${i}:${s.code.string}${s.qty.string ? `x${s.qty.string}` : ''}` : ''))
        .filter((x) => x),
    };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    game.canvas?.removeEventListener('pointerdown', this.pointerDown, { capture: true });
    this.root.destroy();
  }
}
