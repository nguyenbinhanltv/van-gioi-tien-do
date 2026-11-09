import { Color, Label, Node, Sprite, SpriteFrame, UITransform, game } from 'cc';
import { core } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import { sharedAtlas } from './UiLabel';
import type { UiSlice } from './PropArt';

type Bag = InstanceType<typeof core.BagModel>;

/** What the panel needs from the session (kept as callbacks so it works online, and in the offline `#bagdemo`). */
export interface BagPanelHooks {
  /** the bag model to show, or null when there is none (offline) */
  bag(): Bag | null;
  /** move slot `from` onto `to`; false when it could not be sent */
  move(from: number, to: number): boolean;
  /** claim pending loot; false when it could not be sent */
  claim(): boolean;
  /** use the item in `slot` (a pill); false when it could not be sent */
  use(slot: number): boolean;
  /** use the first stack of item `key` (the quick-use key); false when there is none */
  quickUse(key: string): boolean;
  clientToUi(clientX: number, clientY: number): { x: number; y: number };
  /** item / stone icon by item key (`heal_pill`, `stone_low`, ...), or null when there is no art (the coloured tile stays) */
  icon?(key: string): SpriteFrame | null;
  /** a 9-slice frame (owner-provided UI art) under `parent`, or null when there is none (the flat quads stay) */
  slice?(parent: Node, name: string, key: string, w: number, h: number, scale?: number): UiSlice | null;
}

/** Wallet currencies in display order -> the stone icon of each (hạ / trung / thượng phẩm). */
const WALLET_ICONS = [
  { cur: 'LT_HA', key: 'stone_low' },
  { cur: 'LT_TRUNG', key: 'stone_mid' },
  { cur: 'LT_THUONG', key: 'stone_high' },
] as const;

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
  sharedAtlas(l);
  return l;
}

interface SlotUi {
  outline: Sprite;
  bg: Sprite;
  item: Sprite;
  /** item art (Gemini icon) drawn over the coloured tile; inactive when the key has no icon */
  icon: Sprite;
  quality: Sprite;
  code: Label;
  qty: Label;
}

/**
 * The bag and the stone wallet, drawn from the server's `inv_state` (D79). Key B toggles it; click an item, then another slot to
 * move / swap / merge (the server decides: the new state arrives as `inv_state`); a Claim button appears while loot is pending.
 * Layout, hit testing and click logic live in client-core (`BagPanelLogic`, unit tested); this class only draws them. Look: the
 * owner-provided item icon (coloured tile with a short code when an icon is missing), a quality bar, quantity. No prices or shop.
 */
export class BagPanel {
  private readonly root: Node;
  private readonly slots: SlotUi[] = [];
  private readonly title: Label;
  private readonly wallet: Label;
  /** icon + count per stone currency; used instead of the `wallet` text when the stone icons exist */
  private readonly walletIcons: Array<{ icon: Sprite; count: Label }> = [];
  private readonly hint: Label;
  private readonly toast: Label;
  private readonly claimBtn: Node;
  private readonly claimText: Label;
  private readonly selection = new core.BagSelection();
  private visible: boolean;
  private scale = 1;
  private ui = { w: 1280, h: 720 };
  private lastStates = -1;
  private lastSelected: number | null = null;
  private lastWaiting = -1;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly pointerDown: (e: PointerEvent) => void;
  private readonly contextMenu: (e: MouseEvent) => void;
  /** double-tap / double-click on a usable item uses it (touch has no right-click) */
  private readonly gesture = new core.UseGesture();
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
    // owner-provided jade panel (corners at half size so they stay clear of the header and the footer), else the flat dark panel
    if (!hooks.slice?.(this.root, 'frame', 'panel_jade', this.size.w, this.size.h, 0.5)) {
      quad(this.root, 'bg', art, this.size.w, this.size.h, new Color(18, 20, 28, 240));
      quad(this.root, 'border', art, this.size.w, 2, new Color(120, 110, 80, 255)).node.setPosition(
        0,
        this.size.h / 2 - 1,
        0,
      );
    }
    this.title = label(this.root, 'title', 16, new Color(235, 225, 190, 255));
    this.title.string = 'BAG  [B]';
    this.title.node.setPosition(0, this.size.h / 2 - 16, 0);
    this.wallet = label(this.root, 'wallet', 13, new Color(200, 210, 230, 255));
    this.wallet.node.setPosition(0, this.size.h / 2 - 38, 0);
    WALLET_ICONS.forEach((w, k) => {
      const frame = hooks.icon?.(w.key) ?? null;
      if (!frame) return;
      const cx = (k - 1) * 120;
      const icon = quad(this.root, `walletIcon${k}`, art, 22, 22, new Color(255, 255, 255, 255));
      icon.spriteFrame = frame;
      icon.node.setPosition(cx - 24, this.size.h / 2 - 38, 0);
      const count = sharedAtlas(label(this.root, `walletCount${k}`, 13, new Color(200, 210, 230, 255)), 'dynamic');
      count.node.setPosition(cx + 18, this.size.h / 2 - 38, 0);
      this.walletIcons.push({ icon, count });
    });
    for (let i = 0; i < SLOTS_DRAWN; i++) {
      const r = core.slotRect(i);
      const holder = newNode(`slot${i}`, this.root);
      holder.setPosition(r.x + r.w / 2 - this.size.w / 2, this.size.h / 2 - (r.y + r.h / 2), 0);
      const outline = quad(holder, 'outline', art, r.w + 4, r.h + 4, new Color(255, 230, 90, 255));
      outline.node.active = false;
      const bg = quad(holder, 'bg', art, r.w, r.h, new Color(44, 48, 62, 255));
      // bronze slot frame as a child of bg (it follows the slot's visibility); the flat tile is disabled then
      const framed = !!hooks.slice?.(bg.node, 'frame', 'slot_frame', r.w, r.h, 0.55);
      if (framed) bg.enabled = false; // keep the node (it carries the frame and the slot visibility), drop the flat tile
      const pad = framed ? 14 : 8; // the icon sits in the frame's recess
      const item = quad(holder, 'item', art, r.w - pad, r.h - pad, new Color(255, 255, 255, 255));
      item.node.active = false;
      const icon = quad(holder, 'icon', art, r.w - pad, r.h - pad, new Color(255, 255, 255, 255));
      icon.node.active = false;
      const quality = quad(holder, 'quality', art, r.w - 8, 4, new Color(255, 255, 255, 255));
      quality.node.setPosition(0, (r.h - 8) / 2 - 2, 0);
      quality.node.active = false;
      const code = label(holder, 'code', 14, new Color(255, 255, 255, 255));
      const qty = sharedAtlas(label(holder, 'qty', 11, new Color(255, 255, 255, 255)), 'dynamic'); // stack sizes change with every pickup
      qty.node.setPosition(10, -14, 0);
      this.slots.push({ outline, bg, item, icon, quality, code, qty });
    }
    const cb = core.claimButtonRect(SLOTS_DRAWN);
    this.claimBtn = newNode('claim', this.root);
    this.claimBtn.setPosition(cb.x + cb.w / 2 - this.size.w / 2, this.size.h / 2 - (cb.y + cb.h / 2), 0);
    if (!hooks.slice?.(this.claimBtn, 'frame', 'button_normal', cb.w, cb.h, 0.7))
      quad(this.claimBtn, 'bg', art, cb.w, cb.h, new Color(70, 120, 80, 255));
    this.claimText = sharedAtlas(label(this.claimBtn, 'text', 13, new Color(255, 255, 255, 255)), 'dynamic'); // 'Claim loot (N)'
    this.claimBtn.active = false;
    this.toast = sharedAtlas(label(this.root, 'toast', 12, new Color(255, 170, 120, 255)), 'dynamic');
    this.toast.node.setPosition(60, -this.size.h / 2 + 20, 0);
    this.hint = label(this.root, 'hint', 14, new Color(190, 190, 190, 255));
    this.hint.node.setPosition(0, 0, 0);

    this.root.active = this.visible;
    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyB') this.toggle();
      else if (e.code === core.BAG_USE.quickUseCode) this.hooks.quickUse(core.BAG_USE.quickUseItem);
    };
    window.addEventListener('keydown', this.keyDown);
    // a click on the panel must not also start click-to-move (client-core listens on the same canvas)
    this.pointerDown = (e) => this.onPointer(e);
    game.canvas?.addEventListener('pointerdown', this.pointerDown, { capture: true });
    // a right-click on the panel uses the item (and must not open the browser menu)
    this.contextMenu = (e) => {
      if (!this.visible || !this.insidePanel(e.clientX, e.clientY)) return;
      e.preventDefault();
    };
    game.canvas?.addEventListener('contextmenu', this.contextMenu, { capture: true });
    // automation hook (headless capture): read / drive the panel without touching canvas pixels
    (globalThis as unknown as Record<string, unknown>).__vgtdBag = {
      state: () => this.debugState(),
      toggle: () => this.toggle(),
      use: (slot: number) => this.hooks.use(slot),
      quickUse: () => this.hooks.quickUse(core.BAG_USE.quickUseItem),
      clickSlot: (i: number) => {
        const r = core.slotRect(i);
        return this.click(r.x + r.w / 2, r.y + r.h / 2);
      },
      // CSS-pixel centre of a slot / the claim button / the panel, so a harness can tap them with real touch input
      slotPoint: (i: number) => {
        const r = core.slotRect(i);
        return this.toClient(r.x + r.w / 2, r.y + r.h / 2);
      },
      claimPoint: () => {
        const r = core.claimButtonRect(SLOTS_DRAWN);
        return this.toClient(r.x + r.w / 2, r.y + r.h / 2);
      },
      panelBox: () => {
        const a = this.toClient(0, 0);
        const b = this.toClient(this.size.w, this.size.h);
        return a && b ? { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } : null;
      },
      clickClaim: () => {
        const r = core.claimButtonRect(SLOTS_DRAWN);
        return this.click(r.x + 4, r.y + 4);
      },
    };
  }

  /** Is the panel open (the first-session tracker asks)? */
  get isOpen(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.active = this.visible;
    this.lastStates = -1;
  }

  /**
   * Re-anchor to the canvas size (design units): RIGHT-MIDDLE between the reserved HUD bands (progression HUD + toast on top, hotbar
   * at the bottom). Size and position come from client-core `bagPanelPlacement` (unit tested over a phone / tablet / desktop matrix);
   * on small screens it grows (up to a cap) so slots stay tappable.
   */
  layout(canvasW: number, canvasH: number): void {
    this.ui = { w: canvasW, h: canvasH };
    const cssH = game.canvas?.clientHeight ?? canvasH;
    const p = core.bagPanelPlacement(canvasW, canvasH, SLOTS_DRAWN, cssH / canvasH);
    this.scale = p.scale;
    this.root.setScale(p.scale, p.scale, 1);
    this.root.setPosition(p.cx, p.cy, 0);
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
    if (this.walletIcons.length === WALLET_ICONS.length) {
      this.wallet.string = '';
      WALLET_ICONS.forEach((w, k) => (this.walletIcons[k]!.count.string = String(bag.wallet[w.cur])));
    } else this.wallet.string = core.walletText(bag);
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
        s.icon.node.active = false;
        s.quality.node.active = false;
        s.code.string = '';
        s.qty.string = '';
        continue;
      }
      const st = core.itemStyle(it);
      const frame = (it.key && this.hooks.icon?.(it.key)) || null;
      s.icon.node.active = !!frame;
      if (frame) s.icon.spriteFrame = frame;
      // no icon for this key (older art / a newer server's item): keep the coloured tile with its short code
      s.item.node.active = !frame;
      s.item.color = rgb(st.color);
      s.quality.node.active = true;
      s.quality.color = rgb(st.quality);
      s.code.string = frame ? '' : st.code;
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
    s.icon.node.active = false;
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

  /** Panel-local point (design units, origin top-left, y down) of a client point. */
  private toLocal(clientX: number, clientY: number): { lx: number; ly: number } {
    const ui = this.hooks.clientToUi(clientX, clientY);
    const rp = this.root.position;
    return { lx: (ui.x - rp.x) / this.scale + this.size.w / 2, ly: this.size.h / 2 - (ui.y - rp.y) / this.scale };
  }
  private insidePanel(clientX: number, clientY: number): boolean {
    const { lx, ly } = this.toLocal(clientX, clientY);
    return core.insidePanel(lx, ly, SLOTS_DRAWN);
  }

  private onPointer(e: PointerEvent): void {
    if (!this.visible) return;
    const { lx, ly } = this.toLocal(e.clientX, e.clientY);
    if (!core.insidePanel(lx, ly, SLOTS_DRAWN)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const slot = core.slotAtPoint(lx, ly, SLOTS_DRAWN);
    if (e.button === 2) {
      if (slot !== null) this.hooks.use(slot); // right-click uses the item
      return;
    }
    if (e.button !== 0) return;
    // a second tap on the same usable item within BAG_USE.doubleTapMs uses it (the first tap selected it)
    const bag = this.bag();
    if (slot !== null && bag?.canUse(slot) && this.gesture.tap(slot, performance.now())) {
      this.hooks.use(slot);
      this.selection.selected = null;
      this.lastSelected = -2;
      return;
    }
    if (slot === null || !bag?.canUse(slot)) this.gesture.reset();
    this.click(lx, ly);
  }

  /** Panel-local point (design units, y down) to CSS px on the page, or null without a canvas. */
  private toClient(lx: number, ly: number): { x: number; y: number } | null {
    const c = game.canvas;
    if (!c) return null;
    const rc = c.getBoundingClientRect();
    const rp = this.root.position;
    const ux = rp.x + (lx - this.size.w / 2) * this.scale;
    const uy = rp.y + (this.size.h / 2 - ly) * this.scale;
    return {
      x: rc.left + ((ux + this.ui.w / 2) / this.ui.w) * rc.width,
      y: rc.top + ((this.ui.h / 2 - uy) / this.ui.h) * rc.height,
    };
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
      // read from the model, not from the drawn labels: an item with an icon has no code text (D90 smoke checks use this)
      slots: Array.from({ length: bag?.slotCount ?? 0 }, (_, i) => {
        const it = bag?.itemAt(i);
        return it ? `${i}:${it.key ?? it.defId}${it.kind === 'stack' && it.qty > 1 ? `x${it.qty}` : ''}` : '';
      }).filter((x) => x),
    };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    game.canvas?.removeEventListener('pointerdown', this.pointerDown, { capture: true });
    game.canvas?.removeEventListener('contextmenu', this.contextMenu, { capture: true });
    this.root.destroy();
  }
}
