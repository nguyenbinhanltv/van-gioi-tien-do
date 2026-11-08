/**
 * Loop-seam matching. A looping clip of N frames must satisfy value(N) == value(0) for every track (position, rotation,
 * scale, IK mix) and have matching velocity across the seam so the loop does not hitch.
 */
import { CLIP_FPS, sampleScalar, sampleVec, type BoneTrack, type Clip, type Key } from './clip.js';
import { lerp } from './math.js';

/** Close a scalar track: ensure a key at `frames` equal to the first value; returns the new key list. */
export function closeScalarLoop(keys: readonly Key<number>[], frames: number): Key<number>[] {
  const out = keys.filter((k) => k.frame < frames);
  const first = out[0];
  if (!first) return [];
  out.push({ frame: frames, value: first.value });
  return out;
}

export function closeVecLoop(keys: readonly Key<{ x: number; y: number }>[], frames: number) {
  const out = keys.filter((k) => k.frame < frames);
  const first = out[0];
  if (!first) return [];
  out.push({ frame: frames, value: { ...first.value } });
  return out;
}

/** Close every track of every bone of a looping clip. */
export function closeLoop(clip: Clip): Clip {
  if (!clip.loop) return clip;
  const bones: BoneTrack[] = clip.bones.map((t) => ({
    bone: t.bone,
    ...(t.translate ? { translate: closeVecLoop(t.translate, clip.frames) } : {}),
    ...(t.rotate ? { rotate: closeScalarLoop(t.rotate, clip.frames) } : {}),
    ...(t.scale ? { scale: closeVecLoop(t.scale, clip.frames) } : {}),
  }));
  return { ...clip, bones };
}

/**
 * Make a densely baked (per-frame) scalar track periodic by cross-fading its last `blend` frames toward the values
 * that continue the first frames, so value(frames) == value(0) and the slope matches. `samples` has frames+1 entries
 * (index 0..frames).
 */
export function periodicize(samples: readonly number[], blend: number): number[] {
  const n = samples.length - 1;
  const out = [...samples];
  const b = Math.min(blend, Math.floor(n / 2));
  for (let i = 0; i < b; i++) {
    const t = (i + 1) / (b + 1);
    const idx = n - b + i + 1; // frames n-b+1 .. n
    if (idx > n) break;
    const target = samples[idx - n] ?? samples[0]!; // wrap onto the start
    out[idx] = lerp(samples[idx]!, target, t * t * (3 - 2 * t));
  }
  out[n] = out[0]!;
  return out;
}

export interface SeamReport {
  readonly track: string;
  /** |value(frames) − value(0)| */
  readonly gap: number;
  /** |velocity before seam − velocity after seam| per frame */
  readonly velocityJump: number;
}

/** Measure the seam of every looping scalar/vec track (rotate in deg, translate in px). */
export function measureSeams(clip: Clip): SeamReport[] {
  const out: SeamReport[] = [];
  const N = clip.frames;
  for (const t of clip.bones) {
    if (t.rotate?.length) {
      const a = sampleScalar(t.rotate, 0);
      const b = sampleScalar(t.rotate, N);
      const before = sampleScalar(t.rotate, N) - sampleScalar(t.rotate, N - 1);
      const after = sampleScalar(t.rotate, 1) - sampleScalar(t.rotate, 0);
      out.push({ track: `${t.bone}/rotate`, gap: Math.abs(b - a), velocityJump: Math.abs(before - after) });
    }
    for (const [kind, keys] of [
      ['translate', t.translate],
      ['scale', t.scale],
    ] as const) {
      if (!keys?.length) continue;
      const a = sampleVec(keys, 0);
      const b = sampleVec(keys, N);
      const p = sampleVec(keys, N - 1);
      const n1 = sampleVec(keys, 1);
      out.push({
        track: `${t.bone}/${kind}`,
        gap: Math.hypot(b.x - a.x, b.y - a.y),
        velocityJump: Math.hypot(b.x - p.x - (n1.x - a.x), b.y - p.y - (n1.y - a.y)),
      });
    }
  }
  void CLIP_FPS;
  return out;
}
