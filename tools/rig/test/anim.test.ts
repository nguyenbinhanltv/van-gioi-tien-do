import { describe, expect, it } from 'vitest';
import {
  ClipBuilder,
  EASE,
  anticipation,
  arc,
  bakeSecondaryMotion,
  buildReferenceHumanoid,
  closeLoop,
  clipSpec,
  cubicBezierEase,
  evalPose,
  hold,
  measureSeams,
  overlap,
  periodicize,
  planFeet,
  runQa,
  sampleScalar,
  settle,
  simplifyScalar,
  type Clip,
  type Key,
} from '../src/index.js';

const rig = buildReferenceHumanoid('E');
const keys = (...v: [number, number][]): Key<number>[] => v.map(([frame, value]) => ({ frame, value }));

describe('easing and sampling', () => {
  it('bezier endpoints and monotonic ease-in-out', () => {
    expect(cubicBezierEase(0.42, 0, 0.58, 1, 0)).toBe(0);
    expect(cubicBezierEase(0.42, 0, 0.58, 1, 1)).toBe(1);
    expect(cubicBezierEase(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 3);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = cubicBezierEase(0.42, 0, 0.58, 1, i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('samples linear, stepped and bezier segments and holds outside the keys', () => {
    const lin = keys([2, 10], [4, 20]);
    expect(sampleScalar(lin, 0)).toBe(10);
    expect(sampleScalar(lin, 3)).toBe(15);
    expect(sampleScalar(lin, 9)).toBe(20);
    expect(
      sampleScalar(
        [
          { frame: 0, value: 0, curve: 'stepped' },
          { frame: 4, value: 8 },
        ],
        3.9,
      ),
    ).toBe(0);
    expect(
      sampleScalar(
        [
          { frame: 0, value: 0, curve: EASE.inOut },
          { frame: 10, value: 10 },
        ],
        5,
      ),
    ).toBeCloseTo(5, 2);
  });
});

describe('ClipBuilder', () => {
  it('resolves roles and rejects typos and bad keys', () => {
    const c = new ClipBuilder(rig, { name: 'x', frames: 10, loop: false });
    expect(c.bone('hand_R')).toBe('hand_R');
    expect(() => c.bone('hand_X')).toThrow(/no bone or role/);
    c.rotate('head', [
      [0, 0],
      [3, 5],
      [3, 6],
    ]);
    expect(() => c.build()).toThrow(/strictly increase/);
    const d = new ClipBuilder(rig, { name: 'x', frames: 10, loop: false });
    d.event(11, 'hit');
    expect(() => d.build()).toThrow(/outside/);
  });
});

describe('principles', () => {
  it('anticipation dips opposite to the action before the strike', () => {
    const k = anticipation(0, 80, 8, { lead: 3, amount: 10 });
    expect(k.map((x) => x.frame)).toEqual([2, 5, 8]);
    expect(k[1]!.value).toBe(-10);
    expect(k[2]!.value).toBe(80);
  });

  it('settle overshoots, damps and ends exactly on the target', () => {
    const k = settle(50, 10, { overshoot: 8, span: 9, bounces: 2 });
    expect(k[0]!.value).toBe(50);
    expect(k[1]!.value).toBe(58);
    expect(k[2]!.value).toBe(46);
    expect(k[k.length - 1]).toMatchObject({ frame: 19, value: 50 });
  });

  it('overlap delays and scales; hold freezes; arc peaks at the middle', () => {
    const o = overlap(keys([0, 0], [4, 20], [8, 0]), 2, 0.5, { maxFrame: 12 });
    expect(o.find((x) => x.frame === 6)!.value).toBe(10);
    const h = hold(keys([0, 0], [4, 10], [8, 0]), 4, 3);
    expect(h.map((x) => x.frame)).toEqual([0, 4, 7, 11]);
    const a = arc({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 8, 6);
    expect(a[2]!.value.y).toBeCloseTo(6, 6);
    expect(a[0]!.value.y).toBe(0);
  });
});

describe('loop seams', () => {
  it('periodicize makes value(N) equal value(0)', () => {
    const s = Array.from({ length: 31 }, (_, i) => Math.sin(i / 7));
    const p = periodicize(s, 6);
    expect(p[30]).toBeCloseTo(p[0]!, 9);
  });

  it('closeLoop appends the first value and measureSeams reports no gap', () => {
    const c = new ClipBuilder(rig, { name: 'l', frames: 12, loop: true });
    c.rotate('head', [
      [0, 0],
      [6, 10],
      [11, 2],
    ]);
    const closed = closeLoop(c.build());
    expect(measureSeams(closed).every((s) => s.gap < 1e-9)).toBe(true);
    expect(measureSeams(c.build()).some((s) => s.gap > 1)).toBe(true);
  });
});

describe('secondary motion', () => {
  const sway = (loop: boolean): Clip => {
    const c = new ClipBuilder(rig, { name: 'sway', frames: 24, loop });
    c.rotate('spine_upper', [
      [0, 0, EASE.inOut],
      [12, 14, EASE.inOut],
      [24, 0],
    ]);
    c.translate('hips', [
      [0, 0, 0, EASE.inOut],
      [12, 6, 0, EASE.inOut],
      [24, 0, 0],
    ]);
    return closeLoop(c.build());
  };

  it('is deterministic and adds rotate tracks for chain bones', () => {
    const a = bakeSecondaryMotion(rig, sway(true));
    const b = bakeSecondaryMotion(rig, sway(true));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const names = a.bones.map((t) => t.bone);
    for (const bone of ['hair_1', 'hair_2', 'hair_3', 'sash_1', 'sash_2', 'sash_3']) expect(names).toContain(bone);
  });

  it('baked loops are seamless and bounded; gain 0 is a no-op', () => {
    const a = bakeSecondaryMotion(rig, sway(true));
    for (const t of a.bones.filter((x) => x.bone.startsWith('hair') || x.bone.startsWith('sash'))) {
      expect(Math.abs(sampleScalar(t.rotate!, 24) - sampleScalar(t.rotate!, 0))).toBeLessThan(1e-6);
      for (const k of t.rotate!) expect(Math.abs(k.value)).toBeLessThan(95);
    }
    expect(bakeSecondaryMotion(rig, sway(true), { gain: 0 })).toEqual(sway(true));
  });

  it('chains react when their root accelerates', () => {
    const c = new ClipBuilder(rig, { name: 'jerk', frames: 20, loop: false });
    c.translate('hips', [
      [0, 0, 0],
      [4, 14, 0, EASE.inOut],
      [20, 14, 0],
    ]);
    const baked = bakeSecondaryMotion(rig, c.build());
    const hair = baked.bones.find((t) => t.bone === 'hair_3')!.rotate!;
    expect(Math.max(...hair.map((k) => Math.abs(k.value - sampleScalar(hair, 0))))).toBeGreaterThan(0.5);
  });

  it('simplifyScalar keeps the shape within tolerance', () => {
    const dense: Key<number>[] = Array.from({ length: 31 }, (_, f) => ({ frame: f, value: Math.sin(f / 5) * 10 }));
    const s = simplifyScalar(dense, 0.2);
    expect(s.length).toBeLessThan(dense.length);
    for (const k of dense) expect(Math.abs(sampleScalar(s, k.frame) - k.value)).toBeLessThanOrEqual(0.21);
  });
});

describe('locomotion planner', () => {
  it('planted feet stay put in the world while the body moves', () => {
    const g = { frames: 15, speed: 150, duty: 0.42, footLift: 9, phase: -0.2, crouch: 9 } as const;
    const plan = planFeet(rig, g);
    const L = plan.tracks[0]!.translate!;
    const v = g.speed / 30;
    for (let f = 0; f < g.frames; f++) {
      if (!plan.planted.L[f] || !plan.planted.L[f + 1]) continue;
      expect(L[f + 1]!.value.x - L[f]!.value.x).toBeCloseTo(-v, 6);
      expect(L[f]!.value.y).toBe(0);
    }
    expect(plan.planted.L.filter(Boolean).length).toBeGreaterThan(5);
  });
});

describe('QA catches real problems', () => {
  const base = (over: { name?: string; frames?: number; loop?: boolean } = {}) =>
    new ClipBuilder(rig, { name: 'bad', frames: 12, loop: false, ...over });

  it('loop seam gap', () => {
    const c = base({ loop: true });
    c.rotate('head', [
      [0, 0],
      [12, 30],
    ]);
    const r = runQa(rig, c.build());
    expect(r.issues.some((i) => i.check === 'loop-seam' && i.severity === 'error')).toBe(true);
  });

  it('foot slide when the claimed ground speed does not match the feet', () => {
    const plan = planFeet(rig, { frames: 15, speed: 150, duty: 0.42, footLift: 9, crouch: 9 });
    const c = new ClipBuilder(rig, {
      name: 'moonwalk',
      frames: 15,
      loop: true,
      motion: { speed: 300, planted: { foot_L: plan.planted.L, foot_R: plan.planted.R } },
    });
    c.merge(plan.tracks);
    const r = runQa(rig, closeLoop(c.build()));
    expect(r.issues.some((i) => i.check === 'foot-slide')).toBe(true);
  });

  it('stretched bones, angular spikes and jitter', () => {
    const c = base();
    c.translate('head', [
      [0, 0, 0],
      [12, 6, 0],
    ]);
    c.rotate('upper_arm_R', [
      [0, 0],
      [1, 150],
    ]);
    c.rotate(
      'upper_arm_L',
      Array.from({ length: 13 }, (_, f): [number, number] => [f, f % 2 ? 3 : -3]),
    );
    const checks = new Set(runQa(rig, c.build()).issues.map((i) => i.check));
    expect(checks.has('bone-length')).toBe(true);
    expect(checks.has('angular-velocity')).toBe(true);
    expect(checks.has('jitter')).toBe(true);
  });

  it('missing events and wrong duration against the spec', () => {
    const c = base({ name: 'attack', frames: 20 });
    const msgs = runQa(rig, c.build(), { spec: clipSpec('attack') })
      .issues.map((i) => i.message)
      .join('\n');
    expect(msgs).toMatch(/phase 'hit_frame'/);
    expect(msgs).toMatch(/table says 13/);
  });

  it('unknown slot or attachment in slot tracks', () => {
    const c = base();
    c.attachment('weapon_R', [[0, 'sword_9']]);
    c.attachment('nope', [[0, null]]);
    expect(runQa(rig, c.build()).issues.filter((i) => i.check === 'slot-order').length).toBe(2);
  });

  it('IK target out of reach is flagged and the solver clamps instead of stretching the leg', () => {
    const c = base();
    c.translate('ik_foot_L', [
      [0, 0, 0],
      [12, 0, -30],
    ]);
    const clip = c.build();
    expect(runQa(rig, clip).issues.some((i) => i.check === 'ik-reach')).toBe(true);
    const pose = evalPose(rig, clip, 12);
    const hip = pose.byName.get('thigh_L')!.pos;
    const ankle = pose.byName.get('foot_L')!.pos;
    expect(Math.hypot(hip.x - ankle.x, hip.y - ankle.y)).toBeLessThanOrEqual(34.001);
  });
});

describe('robustness guards', () => {
  it('rejects events at frame == frames (never reached) and bad slot / IK keys at build time', () => {
    const c = new ClipBuilder(rig, { name: 'e', frames: 10, loop: false });
    c.event(10, 'hit');
    expect(() => c.build()).toThrow(/outside 0\.\.9/);
    const s = new ClipBuilder(rig, { name: 's', frames: 10, loop: false });
    s.attachment('weapon_R', [
      [3, 'weapon_R'],
      [3, null],
    ]);
    expect(() => s.build()).toThrow(/slot weapon_R/);
    const k = new ClipBuilder(rig, { name: 'k', frames: 10, loop: false });
    k.ikMix('ik_leg_L', [
      [0, 1],
      [12, 0],
    ]);
    expect(() => k.build()).toThrow(/ik ik_leg_L/);
  });

  it('QA flags a looping rotation that wraps more than 180° across the seam', () => {
    const c = new ClipBuilder(rig, { name: 'spin', frames: 12, loop: true });
    c.rotate('head', [
      [0, 0],
      [4, 120],
      [8, 240],
      [12, 0],
    ]);
    const r = runQa(rig, c.build());
    expect(r.issues.some((i) => i.check === 'keys' && /seam/.test(i.message))).toBe(true);
  });
});
