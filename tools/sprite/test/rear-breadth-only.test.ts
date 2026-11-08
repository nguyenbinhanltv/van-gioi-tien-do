import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImage, encodePng, fillRect } from '@vgtd/rig';
import {
  alignFrame,
  checkHeights,
  checkSimilarity,
  guidesFromMaster,
  measureFigure,
  reviewHtml,
  toStraight,
  runProject,
  type HeadEvidence,
  type QaClip,
  type RearSingleShoulderLandmarks,
  type Project,
  type RearBreadthMasterLandmarks,
  similarityRegionsForPair,
  measureTemporalSimilarity,
} from '../src/index.js';

function fixture() {
  const master = createImage(256, 256);
  fillRect(master, 104, 20, 53, 33, [80, 35, 65, 255]);
  fillRect(master, 90, 53, 70, 180, [75, 30, 60, 255]);
  const masterHead: RearSingleShoulderLandmarks = {
    kind: 'rear-crown-shoulder-single',
    crown: { x: 130, y: 20 },
    shoulderTop: { x: 158, y: 83 },
    breadth: { left: { x: 104, y: 40 }, right: { x: 156, y: 40 } },
    occludedSide: 'left',
    occluder: 'approved fan and hair',
  };
  const source = createImage(256, 256);
  fillRect(source, 110, 80, 53, 34, [80, 35, 65, 255]);
  fillRect(source, 125, 113, 14, 18, [75, 30, 60, 255]);
  fillRect(source, 95, 130, 65, 71, [75, 30, 60, 255]);
  const guides = guidesFromMaster(measureFigure(master)!);
  const frame = alignFrame(toStraight(source), {
    calibration: { scale: 1, targetHeight: 213, referenceHeight: 213, referenceFrames: 1 },
    guides,
  })!;
  const point = (x: number, y: number) => ({ x: x + frame.record.dx, y: y + frame.record.dy });
  const evidence: HeadEvidence = {
    kind: 'rear-breadth-only',
    crown: point(136, 80),
    breadth: { left: point(110, 100), right: point(162, 100) },
    occluder: 'head+earring in deep dash lean <reviewed>',
    note: 'Visible skull-cap hair crown and both breadth endpoints; pins/tassels/earring excluded <source checked>',
  };
  const clip: QaClip = {
    name: 'dash',
    direction: 'NE',
    kind: 'upright',
    loop: false,
    expectedFrames: 1,
    frames: [frame],
    heightPolicy: 'head-size-v1',
    exceptions: { 0: 'posture' },
    headEvidence: { 0: evidence },
  };
  return { source, clip, evidence, frame, options: { master, masterHeight: 213, guides, masterHead } };
}

function breadthMasterFixture() {
  const f = fixture();
  const masterHead: RearBreadthMasterLandmarks = {
    kind: 'rear-breadth-only',
    crown: f.options.masterHead.crown,
    breadth: f.options.masterHead.breadth,
    occlusions: {
      nape: 'long hair and ribbon hide nape',
      leftShoulder: 'fan and hair hide left acromion <reviewed>',
      rightShoulder: 'hair loop hides right acromion',
    },
  };
  return { ...f, options: { ...f.options, masterHead } };
}

describe('D56-master occluded nape and both shoulders', () => {
  it('accepts ordinary rear clips against a visible breadth master, without inventing a span', () => {
    const { clip, options, evidence } = breadthMasterFixture();
    for (const name of ['idle', 'walk', 'emote', 'dash', 'run', 'attack']) {
      const finding = checkHeights({ ...clip, name }, options)[0]!;
      expect(finding).toMatchObject({
        severity: 'info',
        headEvidence: {
          master: { kind: 'rear-breadth-only' },
          breadthRatio: 1,
        },
      });
      expect(finding.headEvidence).not.toHaveProperty('sizePx');
    }
    const inBand = { ...options, masterHeight: clip.frames[0]!.metrics.height };
    expect(checkHeights({ ...clip, name: 'idle', exceptions: undefined }, inBand)[0]!.severity).toBe('info');
    expect(
      checkHeights({ ...clip, headEvidence: { 0: { ...evidence, occluder: undefined } } }, options)[0]!.severity,
    ).toBe('info');
    expect(checkHeights({ ...clip, exceptions: undefined }, options)[0]!.metric).toBe('head_exception_missing');
  });

  it('keeps the breadth band and fails alpha<128 on master crown or endpoints', () => {
    const { clip, options, frame, evidence } = breadthMasterFixture();
    const right = { x: evidence.breadth!.left.x + 54, y: evidence.breadth!.right.y };
    fillRect(frame.image, right.x, right.y, 1, 1, [80, 35, 65, 255]);
    expect(
      checkHeights(
        { ...clip, headEvidence: { 0: { ...evidence, breadth: { left: evidence.breadth!.left, right } } } },
        options,
      )[0],
    ).toMatchObject({ severity: 'fail', metric: 'skull_breadth_px' });
    for (const p of [options.masterHead.crown, options.masterHead.breadth.left, options.masterHead.breadth.right]) {
      const index = (p.y * 256 + p.x) * 4 + 3;
      options.master.data[index] = 127;
      expect(checkHeights(clip, options)[0]).toMatchObject({ severity: 'fail', metric: 'head_evidence_invalid' });
      options.master.data[index] = 255;
    }
  });

  it('uses the same crown-plus-breadth D55 window on master and frame', () => {
    const { clip, options, frame, evidence } = breadthMasterFixture();
    const crops = similarityRegionsForPair(
      options.master,
      frame.image,
      options.masterHeight,
      options.masterHead,
      evidence,
    );
    for (const side of [crops.master, crops.frame]) {
      expect(side.cropRule).toBe('rear-breadth-window');
      expect(side.head.right - side.head.left).toBeCloseTo(52 * 1.08);
      expect(side.head.bottom - side.head.top).toBeCloseTo(52);
    }
    expect(crops.master.head.top).toBeCloseTo(options.masterHead.crown.y);
    const temporal = measureTemporalSimilarity(frame.image, frame.image, {
      masterHeight: options.masterHeight,
      masterHead: options.masterHead,
      firstHead: evidence,
      secondHead: evidence,
    });
    expect(temporal.crops.master.head).toEqual(crops.frame.head);
    expect(temporal.crops.frame.head).toEqual(crops.frame.head);
    fillRect(frame.image, 0, 0, 256, 256, [20, 230, 10, 255]);
    expect(checkSimilarity(clip, options).some((f) => f.severity === 'fail')).toBe(true);
  });

  it('validates all three master occluders at project load, for NE/N only', () => {
    const { source, clip, options } = breadthMasterFixture();
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-breadth-master-'));
    writeFileSync(join(dir, 'master.png'), encodePng(options.master));
    writeFileSync(join(dir, 'dash.png'), encodePng(source));
    const project: Project = {
      character: 'test',
      direction: 'N',
      stem: 'test',
      master: 'master.png',
      masterHead: options.masterHead,
      scale: 1,
      slice: { inset: 0 },
      palette: { lock: false },
      clips: [
        {
          name: 'dash',
          sheet: 'dash.png',
          cols: 1,
          frames: 1,
          durationSec: 1,
          loop: false,
          kind: 'upright',
          heightPolicy: 'head-size-v1',
          exceptions: clip.exceptions,
          headEvidence: clip.headEvidence,
        },
      ],
    };
    for (const direction of ['N', 'NE'] as const) {
      const result = runProject({ ...project, direction }, dir);
      expect(result.contract.master.head).toEqual(options.masterHead);
      expect(result.contract.qa.findings.filter((f) => f.gate === 'height' && f.severity === 'fail')).toEqual([]);
      const html = reviewHtml([
        {
          format: 'vgtd-sprite-batch',
          version: 1,
          character: 'test',
          ok: true,
          dirs: [
            {
              dir: direction,
              stem: 'test',
              ok: true,
              atlas: { pages: 1, width: 256, height: 256, regions: 1 },
              backlogEntries: 0,
              resolvedEntries: 0,
              folder: '.',
              clips: [
                {
                  name: 'dash',
                  frames: 1,
                  durationSec: 1,
                  kind: 'upright',
                  status: 'ok',
                  counts: { hard: 0, soft: 0, regression: 0, accepted: 0, info: 1 },
                  headEvidence: [{ cell: 0, measurement: checkHeights(clip, options)[0]!.headEvidence! }],
                },
              ],
            },
          ],
        },
      ]);
      expect(html).toContain('master occluders: nape long hair');
      expect(html).toContain('&lt;reviewed&gt;');
      expect(html).not.toContain('undefined');
    }
    expect(() => runProject({ ...project, direction: 'S' }, dir)).toThrow(/NE\/N/);
    for (const key of ['nape', 'leftShoulder', 'rightShoulder'] as const) {
      for (const value of [undefined, '', 'hidden', 'unknown']) {
        const masterHead = {
          ...options.masterHead,
          occlusions: { ...options.masterHead.occlusions, [key]: value },
        } as RearBreadthMasterLandmarks;
        expect(() => runProject({ ...project, masterHead }, dir)).toThrow(/invalid master/);
      }
    }
    const { occlusions: _occlusions, ...missing } = options.masterHead;
    expect(() => runProject({ ...project, masterHead: missing as RearBreadthMasterLandmarks }, dir)).toThrow(
      /invalid master/,
    );
  });
});

describe('D56 visible rear breadth with an occluded shoulder', () => {
  it('compares breadth with the unchanged full master, with no fabricated span', () => {
    const { clip, options } = fixture();
    for (const name of ['dash', 'run', 'attack', 'attack_2', 'attack_3']) {
      const finding = checkHeights({ ...clip, name }, options)[0]!;
      expect(finding).toMatchObject({
        severity: 'info',
        metric: 'skull_breadth_px',
        headEvidence: {
          kind: 'rear-breadth-only',
          masterBreadthPx: 52,
          breadthPx: 52,
          breadthRatio: 1,
          master: { kind: 'rear-crown-shoulder-single' },
        },
      });
      expect(finding.headEvidence).not.toHaveProperty('sizePx');
      expect(finding.headEvidence).not.toHaveProperty('masterSizePx');
      expect(finding.headEvidence).not.toHaveProperty('ratio');
    }
    expect(checkHeights({ ...clip, direction: 'N', kind: 'free' }, options)[0]!.severity).toBe('info');
  });

  it('enforces the existing three-percent breadth band', () => {
    for (const width of [50, 51, 53, 54]) {
      const { clip, options, frame, evidence } = fixture();
      const right = { x: evidence.breadth!.left.x + width, y: evidence.breadth!.left.y };
      fillRect(frame.image, right.x, right.y, 1, 1, [80, 35, 65, 255]);
      const finding = checkHeights(
        { ...clip, headEvidence: { 0: { ...evidence, breadth: { left: evidence.breadth!.left, right } } } },
        options,
      )[0]!;
      expect(finding.severity).toBe(width === 51 || width === 53 ? 'info' : 'fail');
      if (finding.severity === 'fail') expect(finding.metric).toBe('skull_breadth_px');
    }
  });

  it('requires a concrete occluder and reviewed note, and refuses extra hidden anchors', () => {
    const { clip, options, evidence } = fixture();
    for (const patch of [
      { occluder: undefined },
      { occluder: '' },
      { occluder: 'hidden' },
      { note: '' },
      { shoulderTop: { x: 180, y: 180 } },
      { chin: { x: 130, y: 130 } },
    ]) {
      const invalid = { ...evidence, ...patch } as HeadEvidence;
      expect(checkHeights({ ...clip, headEvidence: { 0: invalid } }, options)[0]).toMatchObject({
        severity: 'fail',
        metric: 'head_evidence_invalid',
      });
    }
  });

  it('requires visible alpha>=128 crown and breadth endpoints on the actual rasters', () => {
    for (const target of ['crown', 'left', 'right', 'master-left', 'master-right'] as const) {
      const { clip, options, evidence, frame } = fixture();
      const isMaster = target.startsWith('master-');
      const image = isMaster ? options.master : frame.image;
      const p =
        target === 'crown'
          ? evidence.crown
          : isMaster
            ? options.masterHead.breadth[target === 'master-left' ? 'left' : 'right']
            : evidence.breadth![target === 'left' ? 'left' : 'right'];
      const offset = (Math.round(p.y) * image.width + Math.round(p.x)) * 4 + 3;
      image.data[offset] = 128;
      expect(checkHeights(clip, options)[0]!.severity).toBe('info');
      image.data[offset] = 127;
      expect(checkHeights(clip, options)[0]).toMatchObject({ severity: 'fail', metric: 'head_evidence_invalid' });
    }
    const { clip, options, evidence } = fixture();
    const { crown: _crown, ...withoutCrown } = evidence;
    expect(checkHeights({ ...clip, headEvidence: { 0: withoutCrown as HeadEvidence } }, options)[0]!.severity).toBe(
      'fail',
    );
    expect(
      checkHeights({ ...clip, headEvidence: { 0: { ...evidence, crown: { x: 256, y: 100 } } } }, options)[0]!.severity,
    ).toBe('fail');
  });

  it('rejects idle and non-posture or non-rear use even when the bbox is in band', () => {
    const { clip, options } = fixture();
    for (const name of ['idle', 'walk', 'emote', 'cast'])
      expect(checkHeights({ ...clip, name }, options)[0]).toMatchObject({
        severity: 'fail',
        metric: 'head_evidence_scope',
      });
    for (const reason of ['secondary-overhang', 'lunge', undefined])
      expect(checkHeights({ ...clip, exceptions: reason ? { 0: reason } : {} }, options)[0]!.severity).toBe('fail');
    expect(checkHeights({ ...clip, direction: 'S' }, options)[0]).toMatchObject({
      severity: 'fail',
      metric: 'head_evidence_direction',
    });
    expect(checkHeights(clip, { ...options, masterHeight: clip.frames[0]!.metrics.height })[0]!.severity).toBe('info');
    expect(
      checkHeights({ ...clip, name: 'idle' }, { ...options, masterHeight: clip.frames[0]!.metrics.height })[0]!
        .severity,
    ).toBe('fail');
  });

  it('does not exempt a dynamic cell from D54 similarity', () => {
    const { clip, options, frame } = fixture();
    fillRect(frame.image, 0, 0, 256, 256, [20, 230, 10, 255]);
    expect(checkSimilarity(clip, options).some((f) => f.severity === 'fail')).toBe(true);
  });

  it('carries frame-only evidence through the project contract without changing the master kind', () => {
    const { source, clip, options } = fixture();
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-rear-breadth-'));
    writeFileSync(join(dir, 'master.png'), encodePng(options.master));
    writeFileSync(join(dir, 'dash.png'), encodePng(source));
    const project: Project = {
      character: 'test',
      direction: 'NE',
      stem: 'test',
      master: 'master.png',
      masterHead: options.masterHead,
      scale: 1,
      slice: { inset: 0 },
      palette: { lock: false },
      clips: [
        {
          name: 'dash',
          sheet: 'dash.png',
          cols: 1,
          frames: 1,
          durationSec: 1,
          loop: false,
          kind: 'upright',
          heightPolicy: 'head-size-v1',
          exceptions: clip.exceptions,
          headEvidence: clip.headEvidence,
        },
      ],
    };
    const result = runProject(project, dir);
    const finding = result.contract.qa.findings.find(
      (f) => f.gate === 'height' && f.headEvidence?.kind === 'rear-breadth-only',
    );
    expect(finding?.severity).toBe('info');
    expect(finding?.headEvidence?.master.kind).toBe('rear-crown-shoulder-single');
    expect(JSON.parse(JSON.stringify(finding?.headEvidence))).not.toHaveProperty('sizePx');
    expect(result.contract.qa.findings.filter((f) => f.gate === 'height' && f.severity === 'fail')).toEqual([]);
  });

  it('renders the breadth reference and escaped occluder without undefined vertical values', () => {
    const { clip, options } = fixture();
    const measurement = checkHeights(clip, options)[0]!.headEvidence!;
    const html = reviewHtml([
      {
        format: 'vgtd-sprite-batch',
        version: 1,
        character: 'test',
        ok: true,
        dirs: [
          {
            dir: 'NE',
            stem: 'test',
            ok: true,
            atlas: { pages: 1, width: 256, height: 256, regions: 1 },
            backlogEntries: 0,
            resolvedEntries: 0,
            folder: '.',
            clips: [
              {
                name: 'dash',
                frames: 1,
                durationSec: 1,
                kind: 'upright',
                status: 'ok',
                counts: { hard: 0, soft: 0, regression: 0, accepted: 0, info: 1 },
                headEvidence: [{ cell: 0, measurement }],
              },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain('breadth-only (no vertical span)');
    expect(html).toContain('skull breadth 52.00 / master 52.00 px');
    expect(html).toContain('&lt;reviewed&gt;');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });
});
