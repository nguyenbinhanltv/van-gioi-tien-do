import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng } from '@vgtd/rig';
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
  checkHeights,
  similarityRegionsForPair,
  measureTemporalSimilarity,
  runQa,
  runProject,
  runBatch,
  reviewHtml,
  type Project,
} from '../src/index.js';
import { makeMaster, makeSheet } from './helpers.js';
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
  it('allows two nonadjacent cells in a ten-frame dash and rejects three in any clip', () => {
    expect(Array.isArray(check(fixture([3, 6], 10), 3))).toBe(false);
    expect(metric(check(fixture([4, 8, 12])))).toBe('head_bracket_budget');
  });
  it('rejects adjacent brackets across the loop seam through the certified-neighbour rule', () => {
    expect(metric(check(fixture([19, 0], 20, true), 0))).toBe('head_bracket_neighbours');
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

describe('D60 real image quality and window-only comparison', () => {
  it('reports an unmeasured bracket with real Lab and both registered temporal pairs', () => {
    const findings = checkHeights(fixture(), options);
    const finding = findings.find((f) => f.frame === 4)!;
    expect(finding).toMatchObject({
      severity: 'info',
      metric: 'head_bracketed',
      measurement: 'unmeasured',
      headEvidence: {
        reason: 'bracketed',
        bracketed: { neighbours: [3, 5], bracketedCount: 1, lab: { head: 0, torso: 0 } },
      },
    });
    expect(finding.headEvidence!.sizePx).toBeUndefined();
    expect(finding.headEvidence!.ratio).toBeUndefined();
    expect(finding.headEvidence!.bracketed!.temporal.map((p) => Math.min(p.head, p.torso))).toEqual([1, 1]);
  });
  it('rebuilds the master and both measured-neighbour windows from visible crowns, using fixed master dimensions', () => {
    const tilted = { crown: { x: 128, y: 24 }, chin: { x: 138, y: 60 } };
    const crops = similarityRegionsForPair(master, master, 208, tilted, bracket);
    const length = Math.hypot(10, 36);
    for (const side of [crops.master, crops.frame]) {
      expect(side.cropRule).toBe('crown-anchored-master-window');
      expect((side.head.left + side.head.right) / 2).toBe(128);
      expect(side.head.right - side.head.left).toBeCloseTo(length * 1.08);
      expect(side.head.bottom - side.head.top).toBeCloseTo(36 * 1.08);
      expect(side.head.top).toBeCloseTo(24 - 36 * 0.04);
      expect(side.torso.top).toBe(side.head.bottom);
      expect(side.torso.right - side.torso.left).toBeCloseTo(208 * 0.44);
    }
    const temporal = measureTemporalSimilarity(master, master, {
      master,
      masterHead: tilted,
      masterHeight: 208,
      firstHead: tilted,
      secondHead: bracket,
    });
    expect(temporal.crops.master).toEqual(crops.master);
    expect(temporal.crops.frame).toEqual(crops.frame);
    expect('chin' in bracket).toBe(false);
  });
  it('preserves D59 span-square dimensions with the same crown-only construction on both sides', () => {
    const rear = {
      kind: 'rear-span-only' as const,
      crown: { x: 128, y: 24 },
      skullBase: { x: 138, y: 60 },
      occludedSide: 'left' as const,
      occluder: 'ribbon over left cap',
    };
    const crops = similarityRegionsForPair(master, master, 208, rear, bracket);
    const span = Math.hypot(10, 36);
    expect(crops.master.head.right - crops.master.head.left).toBeCloseTo(span * 1.08);
    expect(crops.frame.head.bottom - crops.frame.head.top).toBeCloseTo(span * 1.08);
    expect(crops.master.head.top).toBeCloseTo(24 - span * 0.04);
  });
  it('rejects actual palette drift even when a D41 pose would otherwise exempt similarity', () => {
    for (const part of ['head', 'torso']) {
      const wrong = { ...master, data: new Uint8ClampedArray(master.data) };
      for (let y = part === 'head' ? 24 : 64; y < (part === 'head' ? 62 : 116); y++)
        for (let x = 85; x < 170; x++) {
          const p = (y * 256 + x) * 4;
          if (wrong.data[p + 3]! >= 250) wrong.data.set([0, 255, 0, 255], p);
        }
      const clip = fixture();
      const bad = {
        ...clip,
        exceptions: { 4: 'lunge: approved D41 pose' },
        frames: clip.frames.map((f, i) => (i === 4 ? { ...aligned, image: wrong } : f)),
      };
      expect(checkHeights(bad, options).find((f) => f.frame === 4)).toMatchObject({
        severity: 'fail',
        metric: 'head_bracket_palette',
      });
    }
  });
  it.each([3, 5])(
    'rejects low temporal continuity with neighbour%d despite identical palette distributions',
    (index) => {
      const pattern = { ...master, data: new Uint8ClampedArray(master.data) };
      const swap = { ...master, data: new Uint8ClampedArray(master.data) };
      for (let y = 25; y < 61; y++)
        for (let x = 110; x < 146; x++) {
          const p = (y * 256 + x) * 4;
          pattern.data.set(x < 128 ? [20, 20, 20, 255] : [230, 190, 160, 255], p);
          swap.data.set(x < 128 ? [230, 190, 160, 255] : [20, 20, 20, 255], p);
        }
      const clip = fixture();
      const frames = clip.frames.map((f, i) => ({ ...f!, image: i === index ? swap : pattern }));
      const findings = checkHeights({ ...clip, frames }, { ...options, master: pattern });
      expect(findings.find((f) => f.frame === 4)).toMatchObject({ severity: 'fail', metric: 'head_bracket_temporal' });
    },
  );
  it('fails unavailable quality and never uses centroid fallback for a bracket', () => {
    expect(() => similarityRegionsForPair(master, master, 208, undefined, bracket)).toThrow(/certified master/);
    expect(() =>
      measureTemporalSimilarity(master, master, { masterHeight: 208, firstHead: masterHead, secondHead: bracket }),
    ).toThrow(/certified master/);
    const empty = { ...master, data: new Uint8ClampedArray(master.data) };
    for (let y = 63; y < 116; y++)
      for (let x = 80; x < 176; x++) empty.data.fill(0, (y * 256 + x) * 4, (y * 256 + x) * 4 + 4);
    const clip = fixture();
    expect(
      checkHeights(
        { ...clip, frames: clip.frames.map((f, i) => (i === 4 ? { ...aligned, image: empty } : f)) },
        options,
      ).find((f) => f.frame === 4),
    ).toMatchObject({ severity: 'fail', metric: 'head_bracket_quality_unmeasured' });
  });
  it('rejects low torso continuity with the palette unchanged', () => {
    const pattern = { ...master, data: new Uint8ClampedArray(master.data) },
      swap = { ...master, data: new Uint8ClampedArray(master.data) };
    for (let y = 64; y < 114; y++)
      for (let x = 91; x < 165; x++) {
        const p = (y * 256 + x) * 4;
        pattern.data.set(x < 128 ? [20, 20, 20, 255] : [40, 80, 160, 255], p);
        swap.data.set(x < 128 ? [40, 80, 160, 255] : [20, 20, 20, 255], p);
      }
    const clip = fixture();
    const frames = clip.frames.map((f, i) => ({ ...f!, image: i === 5 ? swap : pattern }));
    expect(checkHeights({ ...clip, frames }, { ...options, master: pattern }).find((f) => f.frame === 4)).toMatchObject(
      { severity: 'fail', metric: 'head_bracket_temporal' },
    );
  });
  it('does not waive hard canvas loss', () => {
    const clip = fixture();
    const bad = {
      ...clip,
      frames: clip.frames.map((f, i) => (i === 4 ? { ...f!, record: { ...f!.record, dx: -500 } } : f)),
    };
    const result = runQa([bad], options);
    expect(result.findings.some((f) => f.frame === 4 && f.metric === 'head_bracketed' && f.severity === 'info')).toBe(
      true,
    );
    expect(result.findings.some((f) => f.frame === 4 && f.gate === 'canvasLoss' && f.severity === 'fail')).toBe(true);
    expect(result.ok).toBe(false);
  });
  it('exports two brackets as unmeasured INFO with quality/budget evidence, without invented size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-bracketed-'));
    writeFileSync(join(dir, 'master.png'), encodePng(master));
    writeFileSync(
      join(dir, 'dash.png'),
      encodePng(
        makeSheet(
          4,
          3,
          256,
          Array.from({ length: 10 }, () => ({ height: 208, cx: 128, sole: 232 })),
        ),
      ),
    );
    const clip = fixture([3, 6], 10);
    const project: Project = {
      character: 'test',
      direction: 'E',
      stem: 'test',
      master: 'master.png',
      masterHead,
      scale: 1,
      palette: { lock: false },
      slice: { inset: 0 },
      clips: [
        {
          name: 'dash',
          sheet: 'dash.png',
          cols: 4,
          frames: 10,
          durationSec: 10 / 24,
          loop: false,
          kind: 'upright',
          heightPolicy: 'head-size-v1',
          headEvidence: clip.headEvidence,
        },
      ],
    };
    const result = runProject(project, dir);
    expect(result.contract.qa.judged.filter((j) => j.verdict === 'fail-hard')).toEqual([]);
    const brackets = result.contract.qa.judged.filter((j) => j.finding.metric === 'head_bracketed');
    expect(brackets).toHaveLength(2);
    expect(brackets.every((j) => j.verdict === 'info' && j.finding.measurement === 'unmeasured')).toBe(true);
    expect(brackets.every((j) => j.finding.headEvidence!.sizePx === undefined)).toBe(true);
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
    writeFileSync(join(dir, 'batch.json'), JSON.stringify({ character: 'test', projects: ['project.json'] }));
    const batch = runBatch(join(dir, 'batch.json'), join(dir, 'out'));
    const page = reviewHtml([batch.report]);
    expect(page).toContain('bracketed (unmeasured)');
    expect(page).toContain('budget 2/10 (max2)');
    expect(page).toContain('raised gauntlet over chin');
    expect(page).not.toContain('undefined');
    expect(() => runProject({ ...project, masterHead: bracket as unknown as HeadLandmarks }, dir)).toThrow(
      /invalid master/,
    );
  });
});
