import { InputManager } from '../input/InputManager.js';
import { InputMode } from '../input/types.js';

/**
 * TÚI ĐỒ: hai cách tương tác cho hai chế độ nhập, đổi nóng khi InputManager đổi chế độ.
 *  - PC (DragDropStrategy): kéo thả giữa ô túi đồ, ô trang bị, thanh skill, chợ, chat;
 *    chuột phải = dùng; Shift + click = link vào chat; Ctrl + click = tách chồng;
 *    thả ra ngoài = yêu cầu vứt bỏ (luôn hỏi xác nhận ở UI).
 *  - Touch (TapSelectStrategy): chạm = chọn và mở bảng chi tiết; chạm ô khác khi đang chọn
 *    = di chuyển / đổi chỗ; giữ 0,4 s = chọn nhiều; giữ rồi kéo tới ô nhanh = gán ô nhanh.
 * Model và View là interface, nên dùng được với UI DOM hoặc UI vẽ trong engine.
 */
export interface InventoryModel {
  canMove(from: number, to: number): boolean;
  move(from: number, to: number): void;               // gửi yêu cầu lên Economy, chờ xác nhận
  use(slot: number): void;
  split(slot: number): void;
  linkToChat(slot: number): void;
  requestDiscard(slot: number): void;
  assignQuickSlot(slot: number, quick: number): void;
  hasItem(slot: number): boolean;
}

export interface InventoryView {
  readonly root: HTMLElement;
  /** Ô túi đồ / trang bị tại điểm client, hoặc null. */
  slotAt(clientX: number, clientY: number): number | null;
  /** Ô nhanh (thanh skill / ô phù lục) tại điểm client, hoặc null. */
  quickSlotAt(clientX: number, clientY: number): number | null;
  /** Điểm có nằm trong khung cửa sổ túi đồ không (thả ra ngoài = vứt bỏ). */
  insideWindow(clientX: number, clientY: number): boolean;
  showGhost(slot: number, x: number, y: number): void;
  moveGhost(x: number, y: number): void;
  hideGhost(): void;
  setDropHint(slot: number | null, valid: boolean): void;
  setSelection(slots: number[]): void;
  showDetail(slot: number | null): void;
}

interface Strategy { attach(): void; detach(): void }

const DRAG_THRESHOLD_PX = 4;
const LONG_PRESS_MS = 400;

class DragDropStrategy implements Strategy {
  private drag: { slot: number; startX: number; startY: number; active: boolean; pointerId: number } | null = null;
  private off: Array<() => void> = [];
  constructor(private m: InventoryModel, private v: InventoryView) {}

  attach(): void {
    const r = this.v.root;
    const on = (t: EventTarget, type: string, fn: (e: PointerEvent) => void) => {
      const h = (e: Event) => fn(e as PointerEvent);
      t.addEventListener(type, h);
      this.off.push(() => t.removeEventListener(type, h));
    };
    on(r, 'pointerdown', (e) => {
      const slot = this.v.slotAt(e.clientX, e.clientY);
      if (slot === null || !this.m.hasItem(slot)) return;
      if (e.button === 2) { this.m.use(slot); return; }
      if (e.button !== 0) return;
      if (e.shiftKey) { this.m.linkToChat(slot); return; }
      if (e.ctrlKey || e.metaKey) { this.m.split(slot); return; }
      this.drag = { slot, startX: e.clientX, startY: e.clientY, active: false, pointerId: e.pointerId };
      r.setPointerCapture(e.pointerId);
    });
    on(r, 'pointermove', (e) => {
      const d = this.drag;
      if (!d || d.pointerId !== e.pointerId) return;
      if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD_PX) {
        d.active = true;
        this.v.showGhost(d.slot, e.clientX, e.clientY);
      }
      if (!d.active) return;
      this.v.moveGhost(e.clientX, e.clientY);
      const target = this.v.slotAt(e.clientX, e.clientY);
      this.v.setDropHint(target, target !== null && this.m.canMove(d.slot, target));
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.pointerId !== e.pointerId) return;
      this.drag = null;
      this.v.setDropHint(null, false);
      if (!d.active) { this.v.showDetail(d.slot); return; }       // click thường = xem chi tiết
      this.v.hideGhost();
      const target = this.v.slotAt(e.clientX, e.clientY);
      const quick = this.v.quickSlotAt(e.clientX, e.clientY);
      if (target !== null && this.m.canMove(d.slot, target)) this.m.move(d.slot, target);
      else if (quick !== null) this.m.assignQuickSlot(d.slot, quick);
      else if (!this.v.insideWindow(e.clientX, e.clientY)) this.m.requestDiscard(d.slot);
    };
    on(r, 'pointerup', end);
    on(r, 'pointercancel', (e) => { if (this.drag?.pointerId === e.pointerId) { this.drag = null; this.v.hideGhost(); } });
    const ctx = (e: Event) => e.preventDefault();
    r.addEventListener('contextmenu', ctx);
    this.off.push(() => r.removeEventListener('contextmenu', ctx));
  }

  detach(): void {
    this.off.forEach((f) => f());
    this.off = [];
    this.drag = null;
    this.v.hideGhost();
    this.v.setDropHint(null, false);
  }
}

class TapSelectStrategy implements Strategy {
  private selected: number[] = [];
  private press: { slot: number; pointerId: number; timer: number; long: boolean; x: number; y: number } | null = null;
  private off: Array<() => void> = [];
  constructor(private m: InventoryModel, private v: InventoryView) {}

  attach(): void {
    const r = this.v.root;
    const on = (type: string, fn: (e: PointerEvent) => void) => {
      const h = (e: Event) => fn(e as PointerEvent);
      r.addEventListener(type, h);
      this.off.push(() => r.removeEventListener(type, h));
    };
    on('pointerdown', (e) => {
      const slot = this.v.slotAt(e.clientX, e.clientY);
      if (slot === null) return;
      const timer = window.setTimeout(() => {
        if (!this.press) return;
        this.press.long = true;                                   // giữ lâu: bật chọn nhiều
        if (this.m.hasItem(slot) && !this.selected.includes(slot)) this.selected.push(slot);
        this.v.setSelection(this.selected);
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS);
      this.press = { slot, pointerId: e.pointerId, timer, long: false, x: e.clientX, y: e.clientY };
    });
    on('pointermove', (e) => {
      const p = this.press;
      if (!p || p.pointerId !== e.pointerId) return;
      if (!p.long && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(p.timer); this.press = null; return; }
      if (p.long) { this.v.showGhost(p.slot, e.clientX, e.clientY); this.v.moveGhost(e.clientX, e.clientY); }
    });
    on('pointerup', (e) => {
      const p = this.press;
      if (!p || p.pointerId !== e.pointerId) return;
      clearTimeout(p.timer);
      this.press = null;
      if (p.long) {                                               // giữ rồi kéo tới ô nhanh
        this.v.hideGhost();
        const quick = this.v.quickSlotAt(e.clientX, e.clientY);
        if (quick !== null && this.m.hasItem(p.slot)) this.m.assignQuickSlot(p.slot, quick);
        return;
      }
      this.tap(p.slot);
    });
    on('pointercancel', () => { if (this.press) clearTimeout(this.press.timer); this.press = null; this.v.hideGhost(); });
  }

  private tap(slot: number): void {
    if (this.selected.length === 1 && this.selected[0] !== slot && this.m.canMove(this.selected[0], slot)) {
      this.m.move(this.selected[0], slot);                        // chạm ô thứ hai = di chuyển / đổi chỗ
      this.selected = [];
      this.v.setSelection([]);
      this.v.showDetail(null);
      return;
    }
    if (this.selected.length > 1) {                               // đang chọn nhiều: chạm để thêm / bớt
      this.selected = this.selected.includes(slot) ? this.selected.filter((s) => s !== slot) : [...this.selected, slot];
      this.v.setSelection(this.selected);
      return;
    }
    if (!this.m.hasItem(slot)) { this.selected = []; this.v.setSelection([]); this.v.showDetail(null); return; }
    this.selected = this.selected[0] === slot ? [] : [slot];       // chạm lại ô đang chọn = bỏ chọn
    this.v.setSelection(this.selected);
    this.v.showDetail(this.selected[0] ?? null);                   // bảng chi tiết có nút Dùng / Mặc / Bán
  }

  detach(): void {
    this.off.forEach((f) => f());
    this.off = [];
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
    this.selected = [];
    this.v.setSelection([]);
    this.v.hideGhost();
  }
}

export class InventoryController {
  private strategy: Strategy;
  private unsub: () => void;

  constructor(private model: InventoryModel, private view: InventoryView, input: InputManager) {
    this.strategy = this.make(input.mode);
    this.strategy.attach();
    this.unsub = input.on('modeChange', (mode) => {
      this.strategy.detach();
      this.strategy = this.make(mode);
      this.strategy.attach();
    });
  }

  private make(mode: InputMode): Strategy {
    return mode === 'pointer' ? new DragDropStrategy(this.model, this.view) : new TapSelectStrategy(this.model, this.view);
  }

  destroy(): void {
    this.unsub();
    this.strategy.detach();
  }
}
