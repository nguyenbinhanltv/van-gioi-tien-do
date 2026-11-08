import { describe, expect, it } from 'vitest';
import {
  alignFrame,
  checkHeights,
  guidesFromMaster,
  isHeadEvidenceReason,
  isSimilarityExemptReason,
  measureFigure,
  measureHairCapWidth,
  toStraight,
  type AlignedFrame,
  type HeadEvidence,
  type HeadProxyConfig,
  type QaClip,
} from '../src/index.js';
import { makeMaster } from './helpers.js';

const master = makeMaster();
const guides = guidesFromMaster(measureFigure(master)!);
const masterHead = { crown: { x: 128, y: 24 }, chin: { x: 128, y: 61 } };
const headProxy: HeadProxyConfig = {
  hairRgb: [230, 190, 160],
  hairTolerance: 12,
  crop: { dx: -30, dy: -2, width: 60, height: 45 },
};
const options = { master, masterHeight: 208, guides, masterHead, headProxy };
const ROW = 30;
const aligned = alignFrame(toStraight(master), {
  calibration: { scale: 1, targetHeight: 208, referenceHeight: 208, referenceFrames: 1 },
  guides,
})!;
const baseWidth = measureHairCapWidth(aligned.image, masterHead.crown, ROW, headProxy);

/** Copy of the aligned cell with `edit(x, y)` returning true for pixels to clear. */
function altered(clear: (x: number, y: number) => boolean, recolour?: (x: number, y: number) => number[] | null) {
  const data = new Uint8ClampedArray(aligned.image.data);
  for (let y = 0; y < aligned.image.height; y++)
    for (let x = 0; x < aligned.image.width; x++) {
      const i = (y * aligned.image.width + x) * 4;
      if (clear(x, y)) data.fill(0, i, i + 4);
      else if (data[i + 3]! > 0) {
        const c = recolour?.(x, y);
        if (c) data.set(c, i);
      }
    }
  return { ...aligned, image: { ...aligned.image, data } } as AlignedFrame;
}
/** Remove the right `n` columns of the hair cap on rows above the headband only, so just the proxy row narrows. */
const narrowed = (n: number) => altered((x, y) => y >= ROW - 3 && y <= ROW + 3 && x >= 150 - n);
const checker = (_x: number, y: number) =>
  y > 45 ? (((_x >> 1) + (y >> 1)) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]) : null;

const proxy: HeadEvidence = {
  kind: 'clip-relative-proxy',
  crown: { x: 128, y: 24 },
  occluder: 'hunched shoulder hides the nape',
  hiddenEndpoints: ['skullBase'],
  note: 'Reviewed: crown visible, nape physically hidden, headband-top row declared',
};
function fixture(opts: { cell?: AlignedFrame; certified?: number[]; count?: number; name?: string } = {}): QaClip {
  const count = opts.count ?? 12;
  const certified = opts.certified ?? Array.from({ length: count }, (_, i) => i).filter((i) => i !== 4);
  const evidence: Record<number, HeadEvidence> = {};
  const rows: Record<number, number> = {};
  for (let i = 0; i < count; i++) {
    evidence[i] = i === 4 ? proxy : { ...masterHead, note: 'Certified native source landmarks' };
    if (i === 4 || certified.includes(i)) rows[i] = ROW;
  }
  return {
    name: opts.name ?? 'dash',
    kind: 'free',
    direction: 'E',
    expectedFrames: count,
    loop: true,
    frames: Array.from({ length: count }, (_, i) => (i === 4 && opts.cell ? opts.cell : aligned)),
    headEvidence: evidence,
    headbandTopRows: rows,
  };
}
const run = (clip: QaClip, o: Parameters<typeof checkHeights>[1] = options) =>
  checkHeights(clip, o).filter((f) => f.frame === 4 && f.gate === 'height');
const failMetric = (clip: QaClip, o?: Parameters<typeof checkHeights>[1]) =>
  run(clip, o).find((f) => f.severity === 'fail')?.metric;

describe('D61 hair-cap proxy measurement', () => {
  it('measures the solid cap width deterministically', () => {
    expect(baseWidth).toBeGreaterThan(40);
    expect(measureHairCapWidth(aligned.image, masterHead.crown, ROW, headProxy)).toBe(baseWidth);
  });
  it('ignores a thin spike removed by the 3x3 opening and a disjoint blob outside the crown component', () => {
    const spike = altered(() => false);
    for (let x = 150; x < 170; x++) spike.image.data.set([230, 190, 160, 255], (ROW * 256 + x) * 4);
    const wide = { ...headProxy, crop: { ...headProxy.crop, width: 80 } };
    expect(measureHairCapWidth(spike.image, masterHead.crown, ROW, wide)).toBe(baseWidth);
    const blob = altered(() => false);
    for (let y = ROW - 1; y <= ROW + 1; y++)
      for (let x = 160; x < 175; x++) blob.image.data.set([230, 190, 160, 255], (y * 256 + x) * 4);
    expect(measureHairCapWidth(blob.image, masterHead.crown, ROW, wide)).toBe(baseWidth);
  });
  it('rejects a row outside the crop, a missing crown colour and an out-of-image crop', () => {
    expect(() => measureHairCapWidth(aligned.image, masterHead.crown, 5, headProxy)).toThrow(/outside the head crop/);
    expect(() =>
      measureHairCapWidth(aligned.image, masterHead.crown, ROW, { ...headProxy, hairRgb: [0, 0, 0] }),
    ).toThrow(/crown is not a hair-colour/);
    expect(() =>
      measureHairCapWidth(aligned.image, masterHead.crown, ROW, {
        ...headProxy,
        crop: { ...headProxy.crop, dx: -200 },
      }),
    ).toThrow(/leaves the image/);
  });
});

describe('D61 clip-relative proxy gate', () => {
  it('passes within +-3 % of the certified mean as INFO clip-relative, never a measured band pass', () => {
    const findings = run(fixture({ cell: narrowed(1) }));
    expect(findings.find((f) => f.severity === 'fail')).toBeUndefined();
    const finding = findings.find((f) => f.metric === 'head_clip_relative')!;
    expect(finding).toMatchObject({
      severity: 'info',
      measurement: 'unmeasured',
      headEvidence: { kind: 'clip-relative-proxy', reason: 'clip-relative', clipRelative: { bracketed: true } },
    });
    expect(finding.message).toContain('clip-relative');
    expect(finding.headEvidence!.sizePx).toBeUndefined();
    expect(finding.headEvidence!.ratio).toBeUndefined();
    const m = finding.headEvidence!.clipRelative!;
    expect(m.proxyPx).toBe(baseWidth - 1);
    expect(m.certifiedMeanPx).toBe(baseWidth);
    expect(m.certified).toHaveLength(11);
    expect(m.temporal).toHaveLength(2);
  });
  it('fails outside +-3 %', () => {
    expect(failMetric(fixture({ cell: narrowed(4) }))).toBe('head_proxy_band');
  });
  it('fails with fewer than two certified cells', () => {
    expect(failMetric(fixture({ certified: [3] }))).toBe('head_proxy_certified');
    // Exactly two certified cells with declared rows suffice.
    expect(failMetric(fixture({ certified: [3, 5] }))).toBeUndefined();
  });
  it.each(['idle', 'walk', 'emote', 'cast', 'meditate'])('fails on non-dynamic %s clips', (name) => {
    expect(failMetric(fixture({ name }))).toBe('head_proxy_scope');
  });
  it.each([
    { occluder: undefined },
    { occluder: '' },
    { occluder: 'hidden' },
    { hiddenEndpoints: [] },
    { hiddenEndpoints: ['crown'] },
    { note: '' },
    { chin: { x: 128, y: 61 } },
  ])('fails without a concrete occluder declaration: %j', (patch) => {
    const clip = fixture();
    expect(
      failMetric({ ...clip, headEvidence: { ...clip.headEvidence, 4: { ...proxy, ...patch } as HeadEvidence } }),
    ).toBe('head_proxy_invalid');
  });
  it('fails without a crown, headband row or proxy definition', () => {
    const clip = fixture();
    expect(
      failMetric({
        ...clip,
        headEvidence: { ...clip.headEvidence, 4: { ...proxy, crown: { x: 0, y: 0 } } as HeadEvidence },
      }),
    ).toBe('head_proxy_crown');
    const rows = { ...clip.headbandTopRows };
    delete rows[4];
    expect(failMetric({ ...clip, headbandTopRows: rows })).toBe('head_proxy_row');
    expect(failMetric({ ...clip, headbandTopRows: { ...rows, 4: 5 } })).toBe('head_proxy_unmeasured');
    expect(failMetric(clip, { ...options, headProxy: undefined })).toBe('head_proxy_config');
  });
  it('fails when Lab identity fails', () => {
    expect(
      failMetric(
        fixture({
          cell: altered(
            () => false,
            (_x, y) => (y > 45 ? [255, 0, 0, 255] : null),
          ),
        }),
      ),
    ).toBe('head_proxy_palette');
  });
  it('fails when a temporal pair is below 0.45', () => {
    const clip = fixture();
    const broken = altered(() => false, checker);
    const frames = clip.frames.map((f, i) => (i === 3 ? broken : f));
    expect(failMetric({ ...clip, frames })).toBe('head_proxy_temporal');
  });
  it('fails at a nonloop edge and for a master cell', () => {
    expect(failMetric({ ...fixture(), loop: false, frames: fixture().frames })).toBeUndefined();
    const edge = fixture({ count: 12 });
    const evidence = { ...edge.headEvidence, 0: proxy, 4: edge.headEvidence![5]! };
    const found = checkHeights({ ...edge, loop: false, headEvidence: evidence }, options).find((f) => f.frame === 0);
    expect(found?.metric).toBe('head_proxy_neighbours');
    expect(
      checkHeights(fixture(), { ...options, masterHead: proxy as never }).find((f) => f.frame === 4)?.severity,
    ).toBe('fail');
  });
  it('still enforces the bbox height band (D60 fallthrough rule)', () => {
    for (const [kind, severity] of [
      ['free', 'warn'],
      ['upright', 'fail'],
    ] as const) {
      const clip = fixture();
      const findings = checkHeights(
        {
          ...clip,
          kind,
          frames: clip.frames.map((f, i) => (i === 4 && f ? { ...f, metrics: { ...f.metrics, height: 160 } } : f)),
        },
        options,
      );
      expect(findings).toContainEqual(expect.objectContaining({ frame: 4, metric: 'head_clip_relative' }));
      expect(findings).toContainEqual(expect.objectContaining({ frame: 4, metric: 'height_excess_px', severity }));
    }
  });
  it('never treats the proxy reason as a D41 similarity exemption (D54)', () => {
    expect(isHeadEvidenceReason('clip-relative')).toBe(true);
    expect(isHeadEvidenceReason('clip-relative-proxy')).toBe(true);
    expect(isSimilarityExemptReason('clip-relative')).toBe(false);
    expect(isSimilarityExemptReason('clip-relative-proxy')).toBe(false);
  });
});
