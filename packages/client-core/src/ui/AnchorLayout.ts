import { Emitter, Vec2 } from '../core/IsoMath.js';
import { TouchLayout } from '../input/TouchController.js';
import { InputMode, Rect } from '../input/types.js';

/**
 * HỆ THỐNG NEO RESPONSIVE
 * ----------------------------------------------------------------------------
 *  - Khung thiết kế logic: 1280 × 720 (ngang) hoặc 720 × 1280 (dọc).
 *  - scale = min(viewportW / refW, viewportH / refH) × userScale: màn hình dài
 *    (19,5:9, 21:9) giữ kích thước HUD theo chiều cao, các cụm bám mép trái / phải.
 *  - Mỗi widget neo vào 1 trong 9 điểm của vùng an toàn (safe area, tai thỏ); offset
 *    và kích thước tính bằng px logic rồi nhân scale.
 *  - Bố cục chọn theo (chế độ nhập × hướng màn hình): pointer-landscape, touch-landscape,
 *    touch-portrait. Đổi chế độ hoặc xoay máy thì tính lại và phát sự kiện 'layout'.
 */
export type Anchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export type Orientation = 'landscape' | 'portrait';
export type ProfileKey = `${InputMode}-${Orientation}`;

export interface WidgetSpec {
  id: string;
  anchor: Anchor;
  /** Px logic. Neo ở mép: khoảng cách vào trong. Neo ở giữa (top, bottom, left, right, center): độ lệch có dấu. */
  offset: [number, number];
  /** Kích thước px logic. */
  size: [number, number];
  /** Kéo giãn ngang hết vùng an toàn, offset[0] là lề hai bên. */
  stretchX?: boolean;
  /** Bỏ qua safe area (nền, hiệu ứng toàn màn hình). */
  ignoreSafeArea?: boolean;
}

export interface Insets { top: number; right: number; bottom: number; left: number }

export interface LayoutResult {
  scale: number;
  orientation: Orientation;
  profile: ProfileKey;
  viewport: { w: number; h: number };
  safe: Rect;
  rects: Map<string, Rect>;   // CSS px, gốc tại góc trên trái phần tử gốc
}

export interface AnchorLayoutOptions {
  refLandscape?: [number, number];
  refPortrait?: [number, number];
  userScale?: number;            // 0,8 – 1,2 theo Cài đặt
  /** Khoảng cách tối thiểu tới safe area cho cụm điều khiển cảm ứng (px logic). */
  touchMargin?: number;
}

const ANCHOR_FACTORS: Record<Anchor, [number, number]> = {
  'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1],
};

export class AnchorLayout extends Emitter<{ layout: LayoutResult }> {
  private profiles: Partial<Record<ProfileKey, WidgetSpec[]>>;
  private mode: InputMode = 'pointer';
  private probe: HTMLDivElement;
  private ro: ResizeObserver;
  private last: LayoutResult | null = null;
  readonly opts: Required<AnchorLayoutOptions>;

  constructor(private readonly root: HTMLElement, profiles = DEFAULT_PROFILES, opts: AnchorLayoutOptions = {}) {
    super();
    this.profiles = profiles;
    this.opts = { refLandscape: [1280, 720], refPortrait: [720, 1280], userScale: 1, touchMargin: 16, ...opts };
    // Phần tử dò safe area: đọc env(safe-area-inset-*) qua padding đã tính
    this.probe = document.createElement('div');
    this.probe.style.cssText =
      'position:fixed;inset:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
    document.body.appendChild(this.probe);
    this.ro = new ResizeObserver(() => this.refresh());
    this.ro.observe(root);
    window.addEventListener('orientationchange', this.refresh);
  }

  setMode(mode: InputMode): void { this.mode = mode; this.refresh(); }
  setUserScale(s: number): void { this.opts.userScale = Math.min(1.2, Math.max(0.8, s)); this.refresh(); }
  get result(): LayoutResult | null { return this.last; }

  readSafeArea(): Insets {
    const cs = getComputedStyle(this.probe);
    const px = (v: string) => parseFloat(v) || 0;
    return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  }

  refresh = (): void => {
    const r = this.root.getBoundingClientRect();
    this.last = AnchorLayout.compute(r.width, r.height, this.readSafeArea(), this.mode, this.profiles, this.opts);
    this.apply(this.last);
    this.emit('layout', this.last);
  };

  /** Tính bố cục thuần (không đụng DOM) – dùng được cả cho renderer canvas của engine. */
  static compute(
    vw: number, vh: number, insets: Insets, mode: InputMode,
    profiles: Partial<Record<ProfileKey, WidgetSpec[]>>, opts: Required<AnchorLayoutOptions>,
  ): LayoutResult {
    const orientation: Orientation = vh > vw * 1.05 ? 'portrait' : 'landscape';
    let profile: ProfileKey = `${mode}-${orientation}`;
    if (!profiles[profile]) profile = `${mode}-landscape`;           // PC không có bố cục dọc
    const [refW, refH] = orientation === 'portrait' && profiles[`${mode}-portrait`] ? opts.refPortrait : opts.refLandscape;
    const scale = Math.min(vw / refW, vh / refH) * opts.userScale;
    const safe: Rect = { x: insets.left, y: insets.top, w: vw - insets.left - insets.right, h: vh - insets.top - insets.bottom };
    const full: Rect = { x: 0, y: 0, w: vw, h: vh };
    const rects = new Map<string, Rect>();

    for (const w of profiles[profile] ?? []) {
      const area = w.ignoreSafeArea ? full : safe;
      const [fx, fy] = ANCHOR_FACTORS[w.anchor];
      let width = w.size[0] * scale;
      const height = w.size[1] * scale;
      const ox = w.offset[0] * scale, oy = w.offset[1] * scale;
      if (w.stretchX) width = area.w - 2 * ox;
      // Điểm neo trong vùng; ở mép thì offset hướng vào trong, ở giữa thì offset là độ lệch có dấu.
      // Pivot của widget trùng phía neo (neo phải dưới -> góc phải dưới của widget).
      const ax = area.x + area.w * fx + (fx === 1 ? -ox : ox);
      const ay = area.y + area.h * fy + (fy === 1 ? -oy : oy);
      const x = w.stretchX ? area.x + ox : ax - width * fx;
      rects.set(w.id, { x: Math.round(x), y: Math.round(ay - height * fy), w: Math.round(width), h: Math.round(height) });
    }
    return { scale, orientation, profile, viewport: { w: vw, h: vh }, safe, rects };
  }

  /** Đặt vị trí cho các phần tử DOM có data-ui="<id>"; phần tử không có trong bố cục bị ẩn. */
  private apply(res: LayoutResult): void {
    this.root.querySelectorAll<HTMLElement>('[data-ui]').forEach((el) => {
      const rect = res.rects.get(el.dataset.ui!);
      if (!rect) { el.style.display = 'none'; return; }
      Object.assign(el.style, {
        display: '', position: 'absolute',
        left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`,
      });
      el.style.setProperty('--ui-scale', String(res.scale));   // CSS bên trong dùng calc(var(--ui-scale) * …)
    });
  }

  destroy(): void {
    this.ro.disconnect();
    window.removeEventListener('orientationchange', this.refresh);
    this.probe.remove();
  }
}

/**
 * Chuyển rect của các widget cảm ứng thành hình học cho TouchController.
 * Widget cần có: 'skill-wheel' (vùng cụm nút) và 'joystick-zone'.
 */
export function touchLayoutFromRects(res: LayoutResult, tilesPerPixel: number): TouchLayout | null {
  const wheel = res.rects.get('skill-wheel');
  const zone = res.rects.get('joystick-zone');
  if (!wheel || !zone) return null;
  const s = res.scale;
  const center: Vec2 = { x: wheel.x + wheel.w - 88 * s, y: wheel.y + wheel.h - 88 * s };
  return {
    joystickZone: zone,
    joystickRadius: 64 * s,
    wheelCenter: center,
    mainRadius: 48 * s,                 // nút 96 px logic
    arcRadius: 128 * s,
    skillRadius: 32 * s,                // nút 64 px logic (≥ 44 pt khi scale ≥ 0,7)
    arcFromDeg: 165,
    arcToDeg: 285,
    dodgeButton: { x: center.x + 4 * s, y: center.y - 196 * s },
    flyButton: { x: center.x - 196 * s, y: center.y + 4 * s },
    smallRadius: 24 * s,
    cancelRect: { x: res.safe.x + res.safe.w - 140 * s, y: res.safe.y + 16 * s, w: 120 * s, h: 52 * s },
    tilesPerPixel: tilesPerPixel / s,
  };
}

/**
 * Bố cục mặc định, khớp tài liệu UI/UX: PC chat cố định góc dưới trái, thanh skill 1–9 ở đáy;
 * Mobile: Joypad trái, Skill Wheel phải dưới, chat thu gọn; dọc: HUD dồn lên trên, điều khiển ở nửa dưới.
 */
export const DEFAULT_PROFILES: Partial<Record<ProfileKey, WidgetSpec[]>> = {
  'pointer-landscape': [
    { id: 'player-frame', anchor: 'top-left', offset: [16, 16], size: [260, 64] },
    { id: 'target-frame', anchor: 'top', offset: [0, 16], size: [300, 56] },
    { id: 'minimap', anchor: 'top-right', offset: [16, 16], size: [200, 200] },
    { id: 'chat', anchor: 'bottom-left', offset: [16, 16], size: [360, 200] },
    { id: 'vitals', anchor: 'bottom', offset: [0, 72], size: [480, 20] },
    { id: 'skill-bar', anchor: 'bottom', offset: [0, 16], size: [464, 48] },
    { id: 'talisman-bar', anchor: 'bottom', offset: [300, 18], size: [92, 20] },
  ],
  'touch-landscape': [
    { id: 'player-frame', anchor: 'top-left', offset: [16, 16], size: [260, 64] },
    { id: 'target-frame', anchor: 'top', offset: [0, 16], size: [280, 52] },
    { id: 'minimap', anchor: 'top-right', offset: [16, 16], size: [160, 160] },
    { id: 'chat-ticker', anchor: 'left', offset: [16, 40], size: [360, 48] },
    { id: 'joystick-zone', anchor: 'bottom-left', offset: [0, 0], size: [512, 400] },
    { id: 'skill-wheel', anchor: 'bottom-right', offset: [16, 16], size: [340, 340] },
    { id: 'vitals', anchor: 'bottom', offset: [0, 16], size: [360, 18] },
  ],
  'touch-portrait': [
    { id: 'player-frame', anchor: 'top-left', offset: [16, 16], size: [300, 72] },
    { id: 'minimap', anchor: 'top-right', offset: [16, 16], size: [180, 180] },
    { id: 'target-frame', anchor: 'top', offset: [0, 104], size: [400, 56] },
    { id: 'chat-ticker', anchor: 'bottom', offset: [16, 560], size: [688, 56], stretchX: true },
    { id: 'joystick-zone', anchor: 'bottom-left', offset: [0, 0], size: [360, 520] },
    { id: 'skill-wheel', anchor: 'bottom-right', offset: [16, 24], size: [340, 340] },
    { id: 'vitals', anchor: 'bottom', offset: [0, 528], size: [560, 20] },
  ],
};
