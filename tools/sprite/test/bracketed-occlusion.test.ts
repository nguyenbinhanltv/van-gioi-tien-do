import { describe, expect, it } from 'vitest';
import {
  alignFrame,
  bracketedPreconditions,
  guidesFromMaster,
  isSimilarityExemptReason,
  measureFigure,
  toStraight,
  type HeadEvidence,
  type HeadLandmarks,
  type QaClip,
} from '../src/index.js';
import { makeMaster } from './helpers.js';
const master = makeMaster();
const guides = guidesFromMaster(measureFigure(master)!);
const masterHead = { crown: { x: 128, y: 24 }, chin: { x: 128, y: 61 } };
const options = { master, masterHeight: 208, guides, masterHead };
const aligned = alignFrame(toStraight(master), {
  calibration: { scale: 1, targetHeight: 208, referenceHeight: 208, referenceFrames: 1 },
  guides,
})!;
const bracket: HeadEvidence = {
  kind: 'bracketed-occlusion',
  crown: { x: 128, y: 24 },
  occluder: 'raised gauntlet over chin',
  hiddenEndpoints: ['chin'],
  note: 'Reviewed crown visible; chin physically hidden, no projected endpoint',
};
function fixture(indices = [4], count = 20, loop = false): QaClip {
  const evidence: Record<number, HeadEvidence> = {};
  for (let i = 0; i < count; i++)
    evidence[i] = indices.includes(i) ? bracket : { ...masterHead, note: 'Certified native source landmarks' };
  return {
    name: 'run',
    kind: 'upright',
    heightPolicy: 'head-size-v1',
    direction: 'E',
    expectedFrames: count,
    loop,
    frames: Array.from({ length: count }, () => aligned),
    headEvidence: evidence,
  };
}
const check = (clip = fixture(), frame = 4) => bracketedPreconditions(clip, options, frame, 0.03);
const metric = (result: ReturnType<typeof check>) => (Array.isArray(result) ? result[0]!.metric : undefined);
describe('D60 metadata and direct measured brackets', () => {
  it('requires two direct actually measured neighbours', () => {
    expect(check()).toEqual({ neighbours: [3, 5], count: 1 });
    expect(check(fixture([0], 20, true), 0)).toEqual({ neighbours: [19, 1], count: 1 });
    expect(metric(check(fixture([0]), 0))).toBe('head_bracket_neighbours');
    expect(metric(check(fixture([19]), 19))).toBe('head_bracket_neighbours');
  });
  it.each(['dash', 'run', 'attack', 'attack_2', 'attack_3', 'hit'])('allows dynamic %s scope', (name) => {
    expect(Array.isArray(check({ ...fixture(), name }))).toBe(false);
  });
  it.each(['idle', 'walk', 'emote', 'cast', 'meditate', 'tribulation', 'sword_fly'])('rejects %s scope', (name) => {
    expect(metric(check({ ...fixture(), name }))).toBe('head_bracket_scope');
  });
  it.each([
    { occluder: undefined },
    { occluder: '' },
    { occluder: 'hidden' },
    { hiddenEndpoints: [] },
    { hiddenEndpoints: ['crown'] },
    { hiddenEndpoints: ['chin', 'chin'] },
    { note: '' },
    { chin: { x: 128, y: 61 } },
    { breadth: { left: { x: 110, y: 40 }, right: { x: 146, y: 40 } } },
  ])('rejects missing declarations and fabricated measurable endpoints: %j', (patch) => {
    const clip = fixture();
    expect(
      metric(check({ ...clip, headEvidence: { ...clip.headEvidence, 4: { ...bracket, ...patch } as HeadEvidence } })),
    ).toBe('head_bracket_invalid');
  });
  it('rejects an invisible, nonfinite or out-of-image crown', () => {
    for (const crown of [
      { x: 0, y: 0 },
      { x: NaN, y: 24 },
      { x: 256, y: 24 },
    ]) {
      const clip = fixture();
      expect(metric(check({ ...clip, headEvidence: { ...clip.headEvidence, 4: { ...bracket, crown } } }))).toBe(
        'head_bracket_crown',
      );
    }
  });
  it('enforces the literal15% clip budget without rounding a ten-frame dash up to two', () => {
    expect(Array.isArray(check(fixture([4, 8, 12])))).toBe(false); //3/20 exactly15%.
    expect(metric(check(fixture([4, 8, 12, 16])))).toBe('head_bracket_budget');
    expect(metric(check(fixture([3, 6], 10), 3))).toBe('head_bracket_budget');
  });
  it('rejects three consecutive cells, including across the loop seam', () => {
    expect(metric(check(fixture([4, 5, 6])))).toBe('head_bracket_consecutive');
    expect(metric(check(fixture([19, 0, 1], 20, true), 0))).toBe('head_bracket_consecutive');
  });
  it('does not bootstrap adjacent bracketed cells from one another', () => {
    expect(metric(check(fixture([4, 5])))).toBe('head_bracket_neighbours');
  });
  it('rejects a missing or drifting measured neighbour and a bracketed master', () => {
    const clip = fixture();
    expect(metric(check({ ...clip, frames: clip.frames.map((f, i) => (i === 3 ? null : f)) }))).toBe(
      'head_bracket_neighbours',
    );
    const evidence = { ...clip.headEvidence };
    delete evidence[3];
    expect(metric(check({ ...clip, headEvidence: evidence }))).toBe('head_bracket_neighbours');
    expect(
      metric(
        check({
          ...clip,
          headEvidence: {
            ...clip.headEvidence,
            3: { ...masterHead, chin: { x: 128, y: 70 }, note: 'Actual scale drift' },
          },
        }),
      ),
    ).toBe('head_bracket_neighbours');
    expect(
      metric(bracketedPreconditions(clip, { ...options, masterHead: bracket as unknown as HeadLandmarks }, 4, 0.03)),
    ).toBe('head_bracket_master');
  });
  it('never treats a bracketed reason as a D41 similarity exemption', () => {
    expect(isSimilarityExemptReason('bracketed')).toBe(false);
    expect(isSimilarityExemptReason('bracketed-occlusion')).toBe(false);
    expect(isSimilarityExemptReason('die-collapse: prone')).toBe(true);
  });
});
