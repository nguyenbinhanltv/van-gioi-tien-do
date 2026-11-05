/**
 * Animation table (docs/03 §3): 13 animations, Sprite Sheet frame counts / fps, loop flags, standard Spine events.
 * Spine is keyed at 30 fps and interpolated on playback.
 */

export type AnimationId =
  | 'idle'
  | 'meditate'
  | 'walk'
  | 'run'
  | 'dash'
  | 'sword_fly'
  | 'attack'
  | 'cast'
  | 'channel'
  | 'hit'
  | 'die'
  | 'tribulation'
  | 'emote';

/** Standard Spine event names. */
export const SPINE_EVENT_NAMES = ['hit', 'vfx_spawn', 'sfx', 'footstep_L', 'footstep_R', 'cancel_window'] as const;
export type SpineEventName = (typeof SPINE_EVENT_NAMES)[number];

/** Where in the animation an event fires: a literal frame from the spec, or a named phase boundary. */
export type EventAnchor = { readonly frame: number } | { readonly phase: 'hit_frame' | 'windup_end' | 'combo_window' };

export interface AnimationEventSpec {
  readonly name: SpineEventName;
  readonly at: EventAnchor;
}

export interface AnimationSpec {
  readonly id: AnimationId;
  /** Spec name (Vietnamese). */
  readonly name: string;
  readonly loop: boolean;
  /** Sprite Sheet frame count. */
  readonly frames: number;
  /** Sprite Sheet fps. */
  readonly fps: number;
  /** Duration in seconds as printed in the spec (rounded to 2 decimals; = frames / fps). */
  readonly durationSec: number;
  /**
   * Default suggestion for the per-animation "draw all 8 directions" flag: silhouette depends on the right-hand
   * weapon / gesture. Individual character definitions override via `drawnInEight`. Not stated in the spec.
   */
  readonly asymmetric: boolean;
  /** Events the spec pins to this animation (frame numbers exactly as written in the spec). */
  readonly events: readonly AnimationEventSpec[];
  readonly note: string;
}

export const ANIMATIONS: readonly AnimationSpec[] = [
  {
    id: 'idle',
    name: 'Idle',
    loop: true,
    frames: 12,
    fps: 12,
    durationSec: 1.0,
    asymmetric: false,
    events: [],
    note: 'Spine: chu kỳ thở 1,5–2 s',
  },
  {
    id: 'meditate',
    name: 'Đả tọa',
    loop: true,
    frames: 8,
    fps: 8,
    durationSec: 1.0,
    asymmetric: false,
    events: [],
    note: 'Nhịp thở chậm, linh khí là VFX riêng',
  },
  {
    id: 'walk',
    name: 'Walk',
    loop: true,
    frames: 8,
    fps: 12,
    durationSec: 0.67,
    asymmetric: false,
    events: [],
    note: 'Độ dài sải bước khớp tốc độ di chuyển, tránh trượt chân',
  },
  {
    id: 'run',
    name: 'Run',
    loop: true,
    frames: 10,
    fps: 20,
    durationSec: 0.5,
    asymmetric: false,
    events: [
      { name: 'footstep_L', at: { frame: 2 } },
      { name: 'footstep_R', at: { frame: 7 } },
    ],
    note: 'Sự kiện bước chân ở frame 2 và 7',
  },
  {
    id: 'dash',
    name: 'Khinh công / dash',
    loop: false,
    frames: 6,
    fps: 24,
    durationSec: 0.25,
    asymmetric: false,
    events: [],
    note: 'Kèm vệt mờ chuyển động',
  },
  {
    id: 'sword_fly',
    name: 'Ngự kiếm bay',
    loop: true,
    frames: 8,
    fps: 12,
    durationSec: 0.67,
    asymmetric: false,
    events: [],
    note: 'Nhấp nhô lên xuống bằng offset, không vẽ vào frame',
  },
  {
    id: 'attack',
    name: 'Đòn đánh thường (mỗi nhịp combo)',
    loop: false,
    frames: 10,
    fps: 24,
    durationSec: 0.42,
    asymmetric: true,
    events: [
      { name: 'hit', at: { phase: 'hit_frame' } },
      { name: 'cancel_window', at: { phase: 'combo_window' } },
    ],
    note: 'Chia 3 pha: lấy đà – trúng đích – thu thế; sự kiện hit ở frame trúng',
  },
  {
    id: 'cast',
    name: 'Thi pháp (cast)',
    loop: false,
    frames: 14,
    fps: 28,
    durationSec: 0.5,
    asymmetric: true,
    events: [{ name: 'vfx_spawn', at: { phase: 'windup_end' } }],
    note: 'Sự kiện sinh VFX ở frame cuối pha lấy đà',
  },
  {
    id: 'channel',
    name: 'Vận công kéo dài (channel)',
    loop: true,
    frames: 8,
    fps: 20,
    durationSec: 0.4,
    asymmetric: true,
    events: [],
    note: 'Nối sau cast cho kỹ năng giữ phím',
  },
  {
    id: 'hit',
    name: 'Trúng đòn',
    loop: false,
    frames: 4,
    fps: 20,
    durationSec: 0.2,
    asymmetric: false,
    events: [],
    note: 'Có thể ngắt mọi animation trừ kỹ năng bất khuất',
  },
  {
    id: 'die',
    name: 'Chết',
    loop: false,
    frames: 12,
    fps: 15,
    durationSec: 0.8,
    asymmetric: false,
    events: [],
    note: 'Giữ frame cuối',
  },
  {
    id: 'tribulation',
    name: 'Độ kiếp (sự kiện)',
    loop: false,
    frames: 24,
    fps: 24,
    durationSec: 1.0,
    asymmetric: false,
    events: [],
    note: 'Tư thế chịu sét, lặp đoạn giữa theo đợt sét',
  },
  {
    id: 'emote',
    name: 'Biểu cảm (emote)',
    loop: false,
    frames: 12,
    fps: 12,
    durationSec: 1.0,
    asymmetric: false,
    events: [],
    note: '—',
  },
];

export const ANIMATION_IDS: readonly AnimationId[] = ANIMATIONS.map((a) => a.id);
export const ANIMATION_COUNT = 13;

export function getAnimation(id: AnimationId): AnimationSpec {
  const a = ANIMATIONS.find((x) => x.id === id);
  if (!a) throw new RangeError(`unknown animation '${id}'`);
  return a;
}

/** Exact duration = frames / fps (the spec prints it rounded). */
export function animationDuration(id: AnimationId): number {
  const a = getAnimation(id);
  return a.frames / a.fps;
}

/** Spine keys at 30 fps; playback rate depends on platform / distance. */
export const SPINE_KEY_FPS = 30;
export const SPINE_PLAYBACK_FPS = { pc: 60, mobileWeb: 30, far: 15 } as const;

/** Sprite-sheet frame index at `timeSec` into the animation (loops, or holds the last frame). */
export function frameAt(id: AnimationId, timeSec: number): number {
  const a = getAnimation(id);
  const raw = Math.floor(Math.max(0, timeSec) * a.fps);
  return a.loop ? raw % a.frames : Math.min(raw, a.frames - 1);
}

/** Animations flagged asymmetric by default (candidates to draw in 8 directions). */
export function defaultAsymmetricAnimations(): AnimationId[] {
  return ANIMATIONS.filter((a) => a.asymmetric).map((a) => a.id);
}
