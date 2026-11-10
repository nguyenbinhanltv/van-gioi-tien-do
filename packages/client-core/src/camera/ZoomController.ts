import { CAMERA_ZOOM_DEFAULT, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, CAMERA_ZOOM_STEP } from '@vgtd/shared';

/** Clamp a zoom factor to [CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX]; non-finite input falls back to the default. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return CAMERA_ZOOM_DEFAULT;
  return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, z));
}

/** Parse a `?zoom=<n>` value: clamped to the allowed range; missing / invalid -> the default zoom. */
export function parseZoomParam(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === '') return CAMERA_ZOOM_DEFAULT;
  return clampZoom(Number(raw));
}

/** Pixels of wheel `deltaY` that make up one notch (a classic mouse wheel click reports 100). */
const WHEEL_PX_PER_NOTCH = 100;
const WHEEL_LINE_PX = WHEEL_PX_PER_NOTCH / 3; // 3 lines per notch
const WHEEL_PAGE_PX = 800;

/**
 * Zoom change from one wheel event: `CAMERA_ZOOM_STEP` per notch, wheel up (deltaY < 0) zooms in.
 * Trackpads send many tiny deltas, so the change is proportional; one event never exceeds 1 notch.
 * `deltaMode`: 0 = pixel, 1 = line, 2 = page (WheelEvent).
 */
export function wheelZoomDelta(deltaY: number, deltaMode = 0): number {
  const px = deltaY * (deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1);
  const notches = Math.max(-1, Math.min(1, -px / WHEEL_PX_PER_NOTCH));
  return notches * CAMERA_ZOOM_STEP;
}

/** Zoom after a pinch: `startZoom` scaled by the finger-distance ratio, clamped. Degenerate distances keep startZoom. */
export function pinchZoom(startZoom: number, startDist: number, dist: number): number {
  if (!(startDist > 0) || !Number.isFinite(dist)) return clampZoom(startZoom);
  return clampZoom(startZoom * (dist / startDist));
}

/** Time constant-ish rate (1/s) of the exponential approach to the target zoom. */
const SMOOTH_RATE = 14;

/**
 * Camera zoom state: a clamped `target` set by wheel / pinch / URL, and a smoothed `current`
 * (frame-rate independent exponential lerp) that the camera rig renders with.
 * Engine-free; the Cocos CameraRig only reads `current` each frame after `update(dt)`.
 */
export class ZoomController {
  private _target: number;
  private _current: number;
  private pinchBase: { zoom: number; dist: number } | null = null;

  constructor(initial = CAMERA_ZOOM_DEFAULT) {
    this._target = this._current = clampZoom(initial);
  }

  get target(): number {
    return this._target;
  }
  get current(): number {
    return this._current;
  }
  get pinching(): boolean {
    return this.pinchBase !== null;
  }

  /** Set the target (clamped); `immediate` also jumps `current` (initial value, tests). */
  setTarget(z: number, immediate = false): void {
    this._target = clampZoom(z);
    if (immediate) this._current = this._target;
  }

  wheel(deltaY: number, deltaMode = 0): void {
    this._target = clampZoom(this._target + wheelZoomDelta(deltaY, deltaMode));
  }

  pinchStart(dist: number): void {
    this.pinchBase = dist > 0 ? { zoom: this._target, dist } : null;
  }

  pinchUpdate(dist: number): void {
    if (this.pinchBase) this._target = pinchZoom(this.pinchBase.zoom, this.pinchBase.dist, dist);
  }

  pinchEnd(): void {
    this.pinchBase = null;
  }

  /** Advance the smoothing by `dt` seconds; returns the current zoom. */
  update(dt: number): number {
    const k = 1 - Math.exp(-SMOOTH_RATE * Math.max(0, dt));
    this._current += (this._target - this._current) * k;
    if (Math.abs(this._target - this._current) < 1e-3) this._current = this._target;
    return this._current;
  }
}

// ---------------------------------------------------------------- zoom-aware view math (no y-flip here)

/**
 * Round a camera offset (design units) to a whole number of DEVICE pixels. `pxPerUnit` = device px per design
 * unit (canvas backing-store width / design width). At non-integer zoom the world root is drawn at
 * `world * zoom + offset`; keeping the offset on the device pixel grid stops the whole map from shimmering as
 * the camera moves. Non-positive / non-finite `pxPerUnit` falls back to whole design units.
 */
export function snapToDevicePx(v: number, pxPerUnit = 1): number {
  const k = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 1;
  return Math.round(v * k) / k;
}

/** Inverse of `world * zoom + offset`: a UI-space coordinate (one axis) -> world coordinate at 1x. */
export function viewToWorldAxis(ui: number, offset: number, zoom: number): number {
  return (ui - offset) / zoom;
}

/** Size of the world area (1x px) visible through a `canvas` sized view at `zoom`. */
export function visibleWorldSize(canvasW: number, canvasH: number, zoom: number): { w: number; h: number } {
  return { w: canvasW / zoom, h: canvasH / zoom };
}
