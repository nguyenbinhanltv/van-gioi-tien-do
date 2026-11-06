import { describe, expect, it } from 'vitest';
import { encodePng } from '@vgtd/rig';
import {
  alignFrame,
  buildClip,
  buildTemplate,
  calibrate,
  cellHashes,
  cellRect,
  checkHeights,
  checkLoopSeam,
  checkPresent,
  despillInterior,
  nearestSole,
  soleRuns,
  soleX,
  eventsFromTable,
  guidesFromMaster,
  locomotionCells,
  lockPalette,
  measureFigure,
  packFrames,
  paletteFromMaster,
  repairCell,
  sliceSheet,
  toPremultiplied,
  toStraight,
  type AlignedFrame,
  type QaClip,
} from '../src/index.js';
import { drawFigure, figureImage, makeMaster, makeSheet, MAGENTA } from './helpers.js';

const master = makeMaster(208, 128);
const m = measureFigure(master)!;
const guides = guidesFromMaster(m);

describe('master + template', () => {
  it('measures the master and derives the guides from it (axis = measured pelvis x)', () => {
    expect(m.height).toBe(208);
    expect(m.top).toBe(24);
    expect(m.bottom).toBe(232);
    expect(guides.ground).toBe(232);
    expect(guides.head).toBe(24);
    expect(guides.pelvis).toBeCloseTo(128, 0);
    expect(guides.centerX).toBeCloseTo(m.pelvisX, 5);
    expect(guidesFromMaster(m, 256, 118).centerX).toBe(118);
  });

  it('builds a magenta-keyed grid with guide lines and leading-leg markers, no text', () => {
    const cells = locomotionCells(12, guides, { halfStride: 30, lift: 16 });
    const t = buildTemplate({ clip: 'run', frames: 12, cols: 6, guides, cells });
    expect(t.manifest.grid).toEqual({ cols: 6, rows: 2, cell: 256 });
    expect(t.image.width).toBe(6 * 256);
    expect(t.image.height).toBe(2 * 256);
    expect(t.manifest.cells).toHaveLength(12);
    // the background is the key colour (an interior pixel away from guides)
    const px = (x: number, y: number) =>
      Array.from(t.image.data.slice((y * t.image.width + x) * 4, (y * t.image.width + x) * 4 + 4));
    expect(px(60, 60)).toEqual([255, 0, 255, 255]);
    // the ground line is drawn
    expect(px(40, 232)).not.toEqual([255, 0, 255, 255]);
  });

  it('a locomotion cycle keeps one foot planted (stance half) and lifts the other', () => {
    const cells = locomotionCells(12, guides, { halfStride: 30, lift: 16 });
    expect(cells[0]!.nearFoot?.planted).toBe(true);
    expect(cells.some((c) => c.farFoot && !c.farFoot.planted && c.farFoot.y < guides.ground)).toBe(true);
    expect(new Set(cells.map((c) => c.leading))).toEqual(new Set(['L', 'R']));
  });
});

describe('slice', () => {
  const sheet = makeSheet(2, 1, 100, [
    { height: 60, cx: 50, sole: 90 },
    { height: 70, cx: 50, sole: 92 },
  ]);
  // a speck far from the figure in cell 0 and a soft magenta-ish fringe pixel next to the torso
  for (let y = 8; y < 11; y++)
    for (let x = 8; x < 11; x++) sheet.data.set([20, 200, 20, 255], (y * sheet.width + x) * 4);
  const img = toPremultiplied(sheet);

  it('keys the background, removes the speck, leaves no magenta cast on edges', () => {
    const frames = sliceSheet(img, { cols: 2, rows: 1, frames: 2 });
    expect(frames).toHaveLength(2);
    const f0 = frames[0]!.image;
    expect(f0.data[3]).toBe(0); // corner transparent
    expect(frames[0]!.removedFragments).toBe(1);
    const mm = measureFigure(f0)!;
    expect(mm.height).toBeGreaterThan(55);
    expect(mm.height).toBeLessThan(65);
    for (let i = 0; i < f0.data.length; i += 4) {
      if (f0.data[i + 3]! < 255 || f0.data[i + 3] === 0) continue;
      // opaque pixels are not key coloured
      expect(!(f0.data[i]! > 200 && f0.data[i + 2]! > 200 && f0.data[i + 1]! < 60)).toBe(true);
    }
  });

  it('auto key takes the corner colour', () => {
    const frames = sliceSheet(img, { cols: 2, rows: 1, frames: 1 }, { key: 'auto' });
    expect(frames[0]!.image.data[3]).toBe(0);
  });

  it('cellRect divides the sheet evenly', () => {
    expect(cellRect(200, 100, 2, 1, 1)).toEqual({ x: 100, y: 0, width: 100, height: 100 });
  });
});

describe('align (one scale per character, translation only)', () => {
  const sheet = makeSheet(3, 1, 128, [
    { height: 104, cx: 40, sole: 120 },
    { height: 104, cx: 80, sole: 110 },
    { height: 60, cx: 64, sole: 120 }, // a collapsed pose: must NOT be rescaled to the others
  ]);
  const frames = sliceSheet(toPremultiplied(sheet), { cols: 3, rows: 1, frames: 3 }, { inset: 0 });

  it('calibrates once from reference heights and translates every frame to the guides', () => {
    const heights = frames.slice(0, 2).map((f) => measureFigure(f.image)!.height);
    const cal = calibrate(m.height, heights);
    expect(cal.scale).toBeCloseTo(2, 1);
    const out = frames.map((f, i) =>
      alignFrame(f.image, { calibration: cal, guides, ...(i === 2 ? { exception: 'die-collapse' } : {}) })!,
    );
    for (const a of out) {
      expect(a.metrics.bottom).toBe(232); // sole on the ground line
      expect(Math.abs(a.metrics.pelvisX - guides.centerX)).toBeLessThan(1.5);
      expect(a.record.pre.height).toBeGreaterThan(0);
    }
    // the first two are master height, the third keeps its anatomical (smaller) size and is flagged
    expect(out[0]!.metrics.height).toBeCloseTo(208, -1);
    expect(out[2]!.metrics.height).toBeLessThan(150);
    expect(out[2]!.record.exception).toBe('die-collapse');
    expect(out[0]!.record.exception).toBeUndefined();
    expect(out[0]!.record.post.soleY).toBe(232);
  });

  it('returns null for an empty frame', () => {
    const cal = calibrate(208, [100]);
    const empty = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    expect(alignFrame(empty, { calibration: cal, guides })).toBeNull();
  });
});

describe('repair', () => {
  const orig = toPremultiplied(
    makeSheet(
      3,
      2,
      64,
      Array.from({ length: 6 }, (_, i) => ({ height: 40 + i, cx: 32, sole: 60 })),
    ),
  );
  const edited = toPremultiplied(
    makeSheet(
      3,
      2,
      64,
      Array.from({ length: 6 }, (_, i) => ({ height: 30 + i * 2, cx: 30, sole: 58, body: [200, 50, 50] as const })),
    ),
  );

  it('replaces exactly one cell and leaves every other cell byte-identical', () => {
    const r = repairCell(orig, edited, { cols: 3, rows: 2 }, 4);
    expect(r.changed).toEqual([4]);
    const a = cellHashes(orig, { cols: 3, rows: 2 });
    const b = cellHashes(r.image, { cols: 3, rows: 2 });
    b.forEach((h, i) => (i === 4 ? expect(h).not.toBe(a[i]) : expect(h).toBe(a[i])));
    expect(Buffer.from(r.image.data).equals(Buffer.from(orig.data))).toBe(false);
  });

  it('accepts an edited sheet of another resolution (resized to the original)', () => {
    const big = toPremultiplied(
      makeSheet(
        3,
        2,
        128,
        Array.from({ length: 6 }, () => ({ height: 80, cx: 64, sole: 120 })),
      ),
    );
    const r = repairCell(orig, big, { cols: 3, rows: 2 }, 0);
    expect(r.image.width).toBe(orig.width);
    expect(r.changed.every((c) => c === 0)).toBe(true);
  });

  it('rejects a cell outside the grid', () => {
    expect(() => repairCell(orig, edited, { cols: 3, rows: 2 }, 6)).toThrow(RangeError);
  });
});

describe('palette lock', () => {
  it('pulls drifted colours toward the master palette', () => {
    const pal = paletteFromMaster(master, { size: 8 });
    expect(pal.length).toBeGreaterThan(1);
    const drift = makeSheet(1, 1, 64, [{ height: 50, cx: 32, sole: 60, body: [52, 88, 168] }]);
    const out = lockPalette({ ...drift, data: drift.data }, pal, { strength: 1, maxDistance: 80 });
    expect(out.stats.meanDistanceAfter).toBeLessThan(out.stats.meanDistanceBefore);
    expect(out.stats.moved).toBeGreaterThan(0);
  });
});

describe('pack', () => {
  it('packs trimmed frames with padding + extrude into one pow2 page, no overlaps', () => {
    const frames = [0, 1, 2, 3].map((i) => {
      return { name: `f_${i}`, image: figureImage({ height: 100 + i * 20, cx: 128, sole: 232 }) };
    });
    const pack = packFrames(frames, () => 'tex.png');
    expect(pack.pages).toHaveLength(1);
    const page = pack.pages[0]!;
    expect([64, 128, 256, 512, 1024, 2048]).toContain(page.data.width);
    expect(page.data.premultipliedAlpha).toBe(true);
    const rs = page.data.regions;
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i]!;
        const b = rs[j]!;
        const sep =
          a.x + a.width + 3 <= b.x ||
          b.x + b.width + 3 <= a.x ||
          a.y + a.height + 3 <= b.y ||
          b.y + b.height + 3 <= a.y;
        expect(sep, `${a.name} / ${b.name}`).toBe(true);
      }
    // trim rectangle sits inside its cell
    for (const t of pack.trims.values()) expect(t.x + t.width).toBeLessThanOrEqual(256);
  });

  it('splits into several pages when a page would exceed the limit', () => {
    const frames = Array.from({ length: 6 }, (_, i) => ({
      name: `f_${i}`,
      image: figureImage({ height: 200, cx: 128, sole: 232 }),
    }));
    const pack = packFrames(frames, (p) => `tex${p}.png`, 256);
    expect(pack.pages.length).toBeGreaterThan(1);
  });
});

describe('export clips', () => {
  it('maps sheet frames to stepped 30 fps display keys and table events to clip frames', () => {
    const clip = buildClip({
      name: 'run',
      frames: Array.from({ length: 12 }, (_, i) => `run_${i}`),
      durationSec: 0.5,
      loop: true,
      tableId: 'run',
    });
    expect(clip.frames).toBe(15);
    const keys = clip.slots[0]!.attachment!;
    expect(keys[0]).toMatchObject({ frame: 0, value: 'run_0', curve: 'stepped' });
    expect(keys.map((k) => k.frame)).toEqual([...new Set(keys.map((k) => k.frame))].sort((a, b) => a - b));
    // run table: footstep_L at table frame 2, footstep_R at 7, of 10 frames -> clip frames 3 and 11 (of 15)
    expect(clip.events.map((e) => [e.name, e.frame])).toEqual([
      ['footstep_L', 3],
      ['footstep_R', 11],
    ]);
  });

  it('attack events need the phases of the table', () => {
    expect(() => eventsFromTable('attack', 13)).toThrow();
    const ev = eventsFromTable('attack', 13, { hit_frame: 5, combo_window: 8 });
    expect(ev.map((e) => e.name)).toEqual(['hit', 'cancel_window']);
  });
});

describe('qa gates', () => {
  const cal = calibrate(208, [100]);
  const mk = (h: number, ex?: string): AlignedFrame => {
    return alignFrame(toStraight(figureImage({ height: h, cx: 128, sole: 232 })), {
      calibration: { ...cal, scale: 1 },
      guides,
      ...(ex ? { exception: ex } : {}),
    })!;
  };
  const opts = { masterHeight: 208, master, guides };
  const clip = (frames: AlignedFrame[], over: Partial<QaClip> = {}): QaClip => ({
    name: 'c',
    loop: false,
    kind: 'upright',
    expectedFrames: frames.length,
    frames,
    ...over,
  });

  it('height: upright frames outside +-3 % fail; an exception is only informational', () => {
    expect(checkHeights(clip([mk(208), mk(212)]), opts)).toHaveLength(0);
    expect(checkHeights(clip([mk(208), mk(190)]), opts).map((f) => f.severity)).toEqual(['fail']);
    expect(
      checkHeights(clip([mk(208), mk(190, 'raised-sword')], { exceptions: { 1: 'raised-sword' } }), opts).map(
        (f) => f.severity,
      ),
    ).toEqual(['info']);
    expect(checkHeights(clip([mk(150)], { kind: 'free' }), opts).map((f) => f.severity)).toEqual(['warn']);
  });

  it('present: missing frames fail', () => {
    expect(checkPresent({ ...clip([mk(208)]), expectedFrames: 2 }).map((f) => f.gate)).toEqual(['present']);
    expect(checkPresent({ ...clip([mk(208)]), frames: [null] }).length).toBeGreaterThan(0);
  });

  it('loop seam: a jump from the last to the first frame fails, a smooth cycle passes', () => {
    const smooth = [mk(208), mk(210), mk(212), mk(210)];
    expect(checkLoopSeam(clip(smooth, { loop: true }), opts)).toHaveLength(0);
    const popping = [mk(200), mk(202), mk(204), mk(206), mk(208), mk(150)];
    expect(checkLoopSeam(clip(popping, { loop: true }), opts).length).toBe(1);
  });
});

describe('draws helper sanity', () => {
  it('encodes', () => {
    const s = makeSheet(1, 1, 32, [{ height: 20, cx: 16, sole: 30 }]);
    drawFigure(s, { height: 10, cx: 16, sole: 30 });
    expect(encodePng(toPremultiplied(s)).length).toBeGreaterThan(50);
    expect(MAGENTA).toEqual([255, 0, 255]);
  });
});

describe('interior spill cleanup', () => {
  it('neutralises magenta-tinted opaque pixels inside hair but keeps palette colours (purple cloth)', () => {
    const w = 8;
    const data = new Uint8ClampedArray(w * w * 4);
    const put = (x: number, y: number, c: [number, number, number]) => data.set([...c, 255], (y * w + x) * 4);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) put(x, y, [60, 40, 30]); // dark hair
    put(3, 3, [150, 60, 140]); // strand: key bled into hair
    put(4, 3, [170, 50, 160]);
    put(1, 1, [120, 60, 160]); // legitimate purple cloth (in the palette)
    const img = { width: w, height: w, data };
    const palette = [[120, 60, 160] as const, [60, 40, 30] as const];
    const out = despillInterior(img, { palette });
    const px = (x: number, y: number) => Array.from(out.image.data.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
    expect(out.fixed).toBe(2);
    for (const [x, y] of [
      [3, 3],
      [4, 3],
    ] as const) {
      const [r, g, b] = px(x, y);
      expect(Math.min(r!, b!) - g!).toBeLessThanOrEqual(1);
    }
    expect(px(1, 1)).toEqual([120, 60, 160]); // palette colour untouched
    expect(px(0, 0)).toEqual([60, 40, 30]);
    // without the palette the cloth would be cleaned too
    expect(despillInterior(img).fixed).toBe(3);
  });

  it('is applied by sliceSheet only when asked', () => {
    const sheet = makeSheet(1, 1, 64, [{ height: 40, cx: 32, sole: 60, body: [150, 60, 140] }]);
    const img = toPremultiplied(sheet);
    const plain = sliceSheet(img, { cols: 1, rows: 1, frames: 1 })[0]!.image;
    const clean = sliceSheet(img, { cols: 1, rows: 1, frames: 1 }, { spill: {} })[0]!.image;
    const tint = (s: typeof plain) => {
      let n = 0;
      for (let i = 0; i < s.data.length; i += 4)
        if (s.data[i + 3]! > 0 && Math.min(s.data[i]!, s.data[i + 2]!) - s.data[i + 1]! > 24) n++;
      return n;
    };
    expect(tint(plain)).toBeGreaterThan(0);
    expect(tint(clean)).toBe(0);
  });
});

describe('foot gate diagnostics', () => {
  it('soleRuns keeps two close feet apart and nearestSole picks the nearer one', () => {
    const img = figureImage({ height: 100, cx: 128, sole: 232, stride: 0 });
    const runs = soleRuns(img, 232, 80, 180);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const near = nearestSole(img, 232, 128, 40);
    expect(near).not.toBeNull();
    expect(soleX(img, 232, 128 + 60, 28)).toBeNull(); // nothing within the window
  });
});
