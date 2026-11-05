import { describe, expect, it } from 'vitest';
import { DRAWN_DIRECTIONS } from '@vgtd/shared';
import { buildReferenceHumanoid, evalPose, validateRig, validateRigSet, worldPoint } from '../src/index.js';

describe('reference rig', () => {
  it.each(DRAWN_DIRECTIONS)('is a valid rig for %s', (d) => {
    const rig = buildReferenceHumanoid(d);
    const errors = validateRig(rig).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('rest pose: feet on the ground, head near y=92, legs have their lengths', () => {
    const rig = buildReferenceHumanoid('E');
    const pose = evalPose(rig, null, 0);
    expect(worldPoint(pose, 'foot_L').y).toBeCloseTo(0, 3);
    expect(worldPoint(pose, 'head', 'tip').y).toBeCloseTo(94, 3);
    expect(worldPoint(pose, 'hand_R').y).toBeCloseTo(45, 3);
  });

  it('rejects bad references and paperdoll order', () => {
    const rig = buildReferenceHumanoid('S');
    const bad = { ...rig, slots: [...rig.slots].reverse() };
    expect(validateRig(bad).some((i) => i.message.includes('paperdoll slot order'))).toBe(true);
    const bad2 = { ...rig, roles: { ...rig.roles, head: 'nope' } };
    expect(validateRig(bad2).some((i) => i.message.includes("unknown bone 'nope'"))).toBe(true);
    expect(validateRig({ foo: 1 }).length).toBeGreaterThan(0);
  });
});

describe('RigSet envelope', () => {
  it('accepts per-direction documents and flags mismatches', () => {
    const rigs = Object.fromEntries(DRAWN_DIRECTIONS.map((d) => [d, buildReferenceHumanoid(d)]));
    expect(validateRigSet({ id: 'kiem-tu', rigs }).filter((i) => i.severity === 'error')).toEqual([]);
    const bad = validateRigSet({ id: 'x', rigs: { S: buildReferenceHumanoid('E') } });
    expect(bad.some((i) => i.message.includes("does not match key 'S'"))).toBe(true);
    expect(validateRigSet({ nope: 1 }).length).toBe(1);
  });
});
