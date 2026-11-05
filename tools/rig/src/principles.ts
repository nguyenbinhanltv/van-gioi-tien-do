/**
 * Animation principles as key-list helpers (pure functions: keys in → keys out). They are the vocabulary agents use
 * to avoid "robotic" motion: anticipation, follow-through / settle, overlap (drag), holds and arcs.
 */
import type { Curve, Key } from './clip.js';
import { EASE } from './dsl.js';
import type { Vec2 } from './math.js';

function sortDedupe<T>(keys: Key<T>[]): Key<T>[] {
  const byFrame = new Map<number, Key<T>>();
  for (const k of keys) byFrame.set(k.frame, k); // later keys win
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

/**
 * Anticipation: before the action key at `frame` (value `to`) insert a counter-movement key `lead` frames earlier at
 * `from − amount·sign(to − from)`, easing in, then the strike with the `whip` curve.
 */
export function anticipation(
  from: number,
  to: number,
  frame: number,
  opts: { lead: number; amount: number; startFrame?: number },
): Key<number>[] {
  const dir = Math.sign(to - from) || 1;
  const start = opts.startFrame ?? Math.max(0, frame - opts.lead * 2);
  const peak = frame - opts.lead;
  return sortDedupe<number>([
    { frame: start, value: from, curve: EASE.inOut },
    { frame: peak, value: from - dir * opts.amount, curve: EASE.whip },
    { frame, value: to },
  ]);
}

/**
 * Follow-through / settle: after reaching `target` at `frame`, overshoot by `overshoot` and damp out over `span`
 * frames with `bounces` half-oscillations (alternating sign, decaying 0.5× each).
 */
export function settle(
  target: number,
  frame: number,
  opts: { overshoot: number; span: number; bounces?: number; dir?: 1 | -1 },
): Key<number>[] {
  const n = opts.bounces ?? 2;
  const dir = opts.dir ?? 1;
  const keys: Key<number>[] = [{ frame, value: target, curve: EASE.out }];
  let amp = opts.overshoot * dir;
  for (let i = 1; i <= n; i++) {
    const f = Math.round(frame + (opts.span * i) / (n + 1));
    keys.push({ frame: f, value: target + amp, curve: EASE.inOut });
    amp *= -0.5;
  }
  keys.push({ frame: frame + opts.span, value: target });
  return sortDedupe(keys);
}

/**
 * Overlap / drag: a copy of a track delayed by `delay` frames and scaled by `gain` — apply to child bones (forearm,
 * hand, hair roots) so they lag the parent. Keys pushed past `maxFrame` are dropped (non-loop) or wrapped (loop).
 */
export function overlap(
  keys: readonly Key<number>[],
  delay: number,
  gain: number,
  opts: { maxFrame: number; loop?: boolean },
): Key<number>[] {
  const first = keys[0]?.value ?? 0;
  const shifted = keys.map((k) => ({ ...k, frame: k.frame + delay, value: first + (k.value - first) * gain }));
  if (opts.loop) {
    const wrapped = shifted
      .map((k) => ({ ...k, frame: ((k.frame % opts.maxFrame) + opts.maxFrame) % opts.maxFrame }))
      .sort((a, b) => a.frame - b.frame);
    return sortDedupe(wrapped);
  }
  const kept = shifted.filter((k) => k.frame <= opts.maxFrame);
  // keep a key at 0 so the delayed track starts from the rest value
  if (!kept.some((k) => k.frame === 0)) kept.unshift({ frame: 0, value: first, curve: keys[0]?.curve });
  return sortDedupe(kept);
}

/** Hold: freeze the value at `frame` for `len` frames (stepped), then continue. */
export function hold<T>(keys: readonly Key<T>[], frame: number, len: number): Key<T>[] {
  const out: Key<T>[] = [];
  for (const k of keys) {
    if (k.frame > frame) out.push({ ...k, frame: k.frame + len });
    else out.push(k);
    if (k.frame === frame) out.push({ frame: frame + len, value: k.value, ...(k.curve ? { curve: k.curve } : {}) });
  }
  return sortDedupe(out);
}

/** Parabolic arc between two points over [startFrame, endFrame] (peak `height` px above the straight line). */
export function arc(
  from: Vec2,
  to: Vec2,
  startFrame: number,
  endFrame: number,
  height: number,
  steps = 4,
  curve: Curve = 'linear',
): Key<Vec2>[] {
  const keys: Key<Vec2>[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    keys.push({
      frame: Math.round(startFrame + (endFrame - startFrame) * t),
      value: {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t + 4 * height * t * (1 - t),
      },
      curve,
    });
  }
  return sortDedupe(keys);
}

/** Scale a scalar track's deviation from its first value (e.g. dial an action up/down). */
export function amplify(keys: readonly Key<number>[], gain: number): Key<number>[] {
  const first = keys[0]?.value ?? 0;
  return keys.map((k) => ({ ...k, value: first + (k.value - first) * gain }));
}

/** Time-shift a track by whole frames (wrapping is the caller's job). */
export function shift<T>(keys: readonly Key<T>[], frames: number): Key<T>[] {
  return keys.map((k) => ({ ...k, frame: k.frame + frames }));
}
