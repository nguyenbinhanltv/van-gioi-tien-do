import { describe, expect, it } from 'vitest';
import { createImage } from '@vgtd/rig';
import { registeredNativeSsim, SIMILARITY_TRANSLATION_RADIUS } from '../src/index.js';

function pattern(dx = 0, dy = 0) {
  const image = createImage(64, 64);
  for (let y = 15; y < 43; y++)
    for (let x = 15; x < 41; x++) {
      const value = (x * 31 + y * 47 + x * y * 13) % 256;
      image.data.set([value, value, value, 255], ((y + dy) * 64 + x + dx) * 4);
    }
  return image;
}
const box = { left: 8, top: 8, right: 52, bottom: 52 };

describe('D55 native SSIM registration', () => {
  it('reads changed pixel buffers instead of reusing stale image-object measurements', () => {
    const master = pattern(),
      frame = pattern();
    expect(registeredNativeSsim(master, frame, box, box).score).toBeCloseTo(1);
    frame.data.fill(0);
    expect(registeredNativeSsim(master, frame, box, box).score).toBeLessThan(0.7);
  });
  it('recovers an integer translation inside the authorized window without changing pixels', () => {
    const master = pattern(),
      frame = pattern(3, -2);
    const before = frame.data.slice();
    const result = registeredNativeSsim(master, frame, box, box);
    expect(result.score).toBeCloseTo(1, 10);
    expect(result.dx).toBe(3);
    expect(result.dy).toBe(-2);
    expect(result.width).toBe(44);
    expect(result.height).toBe(44);
    expect(frame.data).toEqual(before);
  });
  it('does not extend registration beyond three pixels to fit a displaced pattern', () => {
    const result = registeredNativeSsim(pattern(), pattern(7, 0), box, box);
    expect(SIMILARITY_TRANSLATION_RADIUS).toBe(3);
    expect(Math.abs(result.dx)).toBeLessThanOrEqual(3);
    expect(Math.abs(result.dy)).toBeLessThanOrEqual(3);
    expect(result.score).toBeLessThan(0.7);
  });
});
