import { describe, it, expect } from 'vitest';
import { CameraFilter, HoldGate, PositionSmoother, dampFactor } from '../assets/scripts/Smoothing';

/** Runs `fn` for `seconds` of wall-clock time at `fps`, calling it with the frame dt. */
const run = (seconds: number, fps: number, fn: (dt: number, t: number) => void) => {
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  for (let n = 0; n < frames; n++) fn(dt, n * dt);
};

describe('dampFactor', () => {
  it('is 0 for no time, approaches 1, and composes across frame rates', () => {
    expect(dampFactor(0, 0.1)).toBe(0);
    expect(dampFactor(10, 0.1)).toBeGreaterThan(0.999);
    // two half steps equal one full step: (1-k)^2 = 1-K
    const half = dampFactor(0.05, 0.1);
    expect((1 - half) * (1 - half)).toBeCloseTo(1 - dampFactor(0.1, 0.1), 12);
  });
});

describe('CameraFilter', () => {
  it('snaps on the first sample', () => {
    const f = new CameraFilter(0.1, 2, 480);
    expect(f.update({ x: 500, y: 300 }, 1 / 60)).toEqual({ x: 500, y: 300 });
  });

  it('reports the snapped centre immediately (the streaming warmup reads it before the first follow)', () => {
    const f = new CameraFilter(0.1, 2, 480);
    expect(f.position).toEqual({ x: 0, y: 0 }); // un-snapped: origin, which is why Bootstrap snaps right after creating the rig
    f.snap({ x: 1234, y: 567 });
    expect(f.position).toEqual({ x: 1234, y: 567 });
  });

  it('ignores movement inside the dead-zone', () => {
    const f = new CameraFilter(0.1, 2, 480);
    f.snap({ x: 0, y: 0 });
    expect(f.update({ x: 1.5, y: 0 }, 1 / 60)).toEqual({ x: 0, y: 0 });
  });

  it('snaps instantly past the snap distance (teleport / zone change)', () => {
    const f = new CameraFilter(0.1, 2, 480);
    f.snap({ x: 0, y: 0 });
    expect(f.update({ x: 2000, y: -900 }, 1 / 60)).toEqual({ x: 2000, y: -900 });
  });

  it('converges the same wall-clock time at 30, 60 and 144 fps', () => {
    const at = (fps: number) => {
      const f = new CameraFilter(0.1, 0, 480);
      f.snap({ x: 0, y: 0 });
      run(0.5, fps, (dt) => f.update({ x: 100, y: 0 }, dt));
      return f.position.x;
    };
    expect(at(30)).toBeCloseTo(at(144), 3);
    expect(at(60)).toBeCloseTo(100 * (1 - Math.exp(-5)), 3);
  });

  it('turns 20 Hz stepped input into a motion with no frame-to-frame jump larger than the steady speed', () => {
    const f = new CameraFilter(0.1, 2, 480);
    f.snap({ x: 0, y: 0 });
    let target = 0;
    let last = 0;
    let maxStep = 0;
    run(2, 60, (dt, t) => {
      target = Math.floor(t * 20) * 10; // 10 px every 50 ms = 200 px/s in 20 Hz steps
      const x = f.update({ x: target, y: 0 }, dt).x;
      if (t > 0.5) maxStep = Math.max(maxStep, x - last);
      last = x;
    });
    // raw follow would jump 10 px in a single frame; the filtered camera moves ~3.3 px/frame +- ripple
    expect(maxStep).toBeLessThan(5);
  });
});

describe('PositionSmoother', () => {
  it('snaps a big jump and eases a small one', () => {
    const s = new PositionSmoother(0.07, 3);
    s.update({ i: 0, j: 0 }, 1 / 60);
    expect(s.update({ i: 10, j: 10 }, 1 / 60)).toEqual({ i: 10, j: 10 });
    const p = s.update({ i: 10.2, j: 10 }, 1 / 60);
    expect(p.i).toBeGreaterThan(10);
    expect(p.i).toBeLessThan(10.2);
  });

  it('reports a steady speed for 20 Hz stepped motion (no 0 / 3x flicker) and stands still at rest', () => {
    const s = new PositionSmoother(0.07, 3);
    s.snap(0, 0);
    const speeds: number[] = [];
    run(2, 60, (dt, t) => {
      s.update({ i: Math.floor(t * 20) * 0.225, j: 0 }, dt); // 4.5 tiles/s
      if (t > 1) speeds.push(s.speed);
    });
    expect(Math.min(...speeds)).toBeGreaterThan(2.5);
    expect(Math.max(...speeds)).toBeLessThan(6.5);
    run(1.5, 60, (dt) => s.update({ i: 9, j: 0 }, dt));
    expect(s.speed).toBe(0);
  });
});

describe('HoldGate', () => {
  it('adopts the first value, ignores a short blip, switches after the hold', () => {
    const g = new HoldGate<string>(0.1);
    expect(g.update('walk', 1 / 60)).toBe('walk');
    expect(g.update('idle', 1 / 60)).toBe('walk');
    expect(g.update('walk', 1 / 60)).toBe('walk'); // blip over: pending cleared
    let v = 'walk';
    run(0.2, 60, (dt) => (v = g.update('idle', dt)));
    expect(v).toBe('idle');
  });
});
