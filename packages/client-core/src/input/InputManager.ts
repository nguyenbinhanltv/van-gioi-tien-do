import { Emitter, TilePos, Vec2, encodeDir } from '../core/IsoMath.js';
import { IsoPathfinder, WalkGrid } from './IsoPathfinder.js';
import { PointerController } from './PointerController.js';
import { TouchController, TouchLayout } from './TouchController.js';
import type { ZoomController } from '../camera/ZoomController.js';
import {
  CameraLike,
  FLAG_DODGE,
  FLAG_FLY_TOGGLE,
  FLAG_QINGGONG,
  InputFrame,
  InputMode,
  PlayerLocator,
  emptyFrame,
} from './types.js';

export interface InputManagerOptions {
  grid: WalkGrid;
  camera: CameraLike;
  player: PlayerLocator;
  /** true nếu điểm (client px) nằm trên một thành phần UI (túi đồ, chat…): khi đó không điều khiển nhân vật. */
  uiHitTest?: (clientX: number, clientY: number) => boolean;
  /** Chọn thực thể dưới con trỏ (PC). */
  pickEntity?: (world: TilePos) => number | null;
  /** Ép chế độ (Cài đặt của người chơi); null = tự động. */
  forcedMode?: InputMode | null;
  /** Camera zoom: mouse wheel, and a two-finger pinch by touches the joystick / skill wheel did not claim. */
  zoom?: ZoomController;
}

/** Gói input gửi server: khớp bảng "Gói input" trong tài liệu kiến trúc server. */
export interface InputPacketFields {
  dir: number;
  mag: number;
  flags: number;
}

/**
 * Lớp trừu tượng input cho PC, Mobile và Web:
 *  - Một nguồn sự kiện duy nhất: Pointer Events (chuột, bút, cảm ứng) + bàn phím.
 *  - Chế độ chọn theo CÁCH NHẬP, không theo thiết bị; Web hybrid tự chuyển khi người
 *    chơi đổi giữa chạm và chuột/phím, và phát sự kiện 'modeChange' để UI đổi bố cục.
 *  - Mỗi frame trả về một InputFrame giống nhau ở mọi nền tảng; game chỉ đọc InputFrame.
 */
export class InputManager extends Emitter<{ modeChange: InputMode }> {
  readonly pathfinder: IsoPathfinder;
  readonly pointer: PointerController;
  readonly touch: TouchController;
  private _mode: InputMode;
  private forced: InputMode | null;
  private readonly disposers: Array<() => void> = [];
  private readonly claimedTouches = new Set<number>();
  /** Touches nobody claimed (not joystick / wheel / UI): candidates for a pinch. clientX/Y in CSS px. */
  private readonly freeTouches = new Map<number, Vec2>();
  private readonly pinchIds = new Set<number>();

  constructor(
    private readonly el: HTMLElement,
    private readonly opts: InputManagerOptions,
  ) {
    super();
    this.pathfinder = new IsoPathfinder(opts.grid);
    this.pointer = new PointerController(opts.camera, opts.player, this.pathfinder, opts.pickEntity);
    this.touch = new TouchController(opts.player, () => this.origin());
    this.forced = opts.forcedMode ?? null;
    this._mode = this.forced ?? InputManager.detectInitialMode();

    el.style.touchAction = 'none'; // tự xử lý cử chỉ, không để trình duyệt cuộn / zoom
    el.style.userSelect = 'none';
    this.listen(el, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.listen(el, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen(el, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen(el, 'pointercancel', (e) => this.onUp(e as PointerEvent));
    this.listen(el, 'wheel', (e) => this.onWheel(e as WheelEvent));
    this.listen(el, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => {
      this.pointer.reset();
      this.touch.reset();
    });
  }

  static detectInitialMode(): InputMode {
    if (typeof window === 'undefined' || !window.matchMedia) return 'pointer';
    return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(hover: hover)').matches
      ? 'touch'
      : 'pointer';
  }

  get mode(): InputMode {
    return this._mode;
  }

  forceMode(mode: InputMode | null): void {
    this.forced = mode;
    if (mode) this.switchMode(mode);
  }

  setTouchLayout(layout: TouchLayout): void {
    this.touch.setLayout(layout);
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void): void {
    t.addEventListener(type, fn, { passive: false });
    this.disposers.push(() => t.removeEventListener(type, fn));
  }

  private origin(): Vec2 {
    const r = this.el.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  private switchMode(next: InputMode): void {
    if (next === this._mode) return;
    this._mode = next;
    this.pointer.reset();
    this.touch.reset();
    this.claimedTouches.clear();
    this.endPinch();
    this.emit('modeChange', next);
  }

  private modeFromPointer(e: PointerEvent): InputMode {
    return e.pointerType === 'touch' ? 'touch' : 'pointer'; // 'mouse' và 'pen' dùng bố cục PC
  }

  private onWheel(e: WheelEvent): void {
    if (!this.opts.zoom) return;
    if (this.opts.uiHitTest?.(e.clientX, e.clientY)) return;
    this.opts.zoom.wheel(e.deltaY, e.deltaMode);
    e.preventDefault();
  }

  /** Track an unclaimed touch; the second one starts a pinch. Returns true when the touch joined a pinch. */
  private trackFreeTouch(e: PointerEvent): boolean {
    const zoom = this.opts.zoom;
    if (!zoom || e.pointerType !== 'touch') return false;
    this.freeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.freeTouches.size === 2) {
      for (const id of this.freeTouches.keys()) this.pinchIds.add(id);
      this.pointer.reset(); // a first finger that already started a click-to-move must not fire it
      zoom.pinchStart(this.freeDistance());
    }
    return this.pinchIds.has(e.pointerId);
  }

  private freeDistance(): number {
    const [a, b] = Array.from(this.freeTouches.values());
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private endPinch(): void {
    this.freeTouches.clear();
    this.pinchIds.clear();
    this.opts.zoom?.pinchEnd();
  }

  private onDown(e: PointerEvent): void {
    if (!this.forced) this.switchMode(this.modeFromPointer(e));
    if (this._mode === 'touch') {
      // Cụm Joystick / Skill Wheel được ưu tiên trước UI khác nằm cùng vùng
      if (this.touch.pointerDown(e)) {
        this.claimedTouches.add(e.pointerId);
        this.el.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (this.trackFreeTouch(e)) {
        this.el.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
      return;
    }
    if (this.opts.uiHitTest?.(e.clientX, e.clientY)) return;
    if (this.trackFreeTouch(e)) {
      // 2nd finger in pointer mode: pinch, not a click
      this.el.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    this.el.setPointerCapture(e.pointerId);
    this.pointer.pointerDown(e);
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    const free = this.freeTouches.get(e.pointerId);
    if (free) {
      free.x = e.clientX;
      free.y = e.clientY;
      if (this.pinchIds.has(e.pointerId)) this.opts.zoom!.pinchUpdate(this.freeDistance());
    }
    if (this._mode === 'touch') {
      if (this.claimedTouches.has(e.pointerId)) this.touch.pointerMove(e);
      return;
    }
    if (e.pointerType !== 'touch') this.pointer.pointerMove(e);
  }

  private onUp(e: PointerEvent): void {
    if (this.freeTouches.delete(e.pointerId)) {
      const wasPinch = this.pinchIds.delete(e.pointerId);
      if (this.pinchIds.size < 2) this.opts.zoom?.pinchEnd();
      if (wasPinch) {
        if (this.pinchIds.size === 0) this.freeTouches.clear(); // lone leftover finger must not re-pinch
        return;
      }
    }
    if (this._mode === 'touch') {
      if (this.claimedTouches.delete(e.pointerId)) this.touch.pointerUp(e);
      return;
    }
    this.pointer.pointerUp(e);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // đang gõ chat
    const modifierOnly = ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key);
    if (down && !modifierOnly && !this.forced) this.switchMode('pointer'); // tablet cắm bàn phím
    if (this._mode === 'pointer' && this.pointer.key(e, down)) e.preventDefault();
  }

  /** Gọi mỗi frame trước khi mô phỏng dự đoán phía client. */
  poll(): InputFrame {
    const f = emptyFrame();
    if (this._mode === 'pointer') this.pointer.update(f);
    else this.touch.update(f);
    return f;
  }

  /** Đóng gói phần di chuyển của InputFrame thành các trường của gói input. */
  static toPacket(f: InputFrame): InputPacketFields {
    const moving = f.magnitude > 0;
    return {
      dir: moving ? encodeDir(f.move.i, f.move.j) : 255,
      mag: moving ? Math.max(1, Math.round(f.magnitude * 15)) : 0,
      flags: (f.dodge ? FLAG_DODGE : 0) | (f.flyToggle ? FLAG_FLY_TOGGLE : 0) | (f.qinggong ? FLAG_QINGGONG : 0),
    };
  }

  destroy(): void {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
  }
}
