import { describe, expect, it } from 'vitest';
import { RUN_SPEED_PX_S, WALK_SPEED_PX_S, viewGain, type Image } from '@vgtd/rig';
import {
  applyContacts,
  checkFootSlide,
  facingGroundVector,
  groundPxPerFrame,
  groundSpeedPxS,
  guidesFromMaster,
  halfStrideFor,
  locomotionCells,
  measureFigure,
  tableDuration,
  type AlignedFrame,
  type CellSpec,
  type QaClip,
} from '../src/index.js';
import { figureImage, makeMaster } from './helpers.js';

const master = makeMaster(208, 128);
const guides = guidesFromMaster(measureFigure(master)!);

/** An aligned frame whose only drawn feet are small boots on the template ghosts (exactly where the artist was told). */
function footFrame(cell: CellSpec): AlignedFrame {
  const img: Image = figureImage({ height: 100, cx: 128, sole: 232 });
  const data = new Uint8ClampedArray(img.data.length); // drop the body, keep only the feet
  for (const ghost of [cell.nearFoot, cell.farFoot]) {
    if (!ghost) continue;
    const gx = Math.round(ghost.x);
    const gy = Math.round(ghost.y);
    for (let y = gy - 5; y < gy; y++)
      for (let x = gx - 6; x < gx + 6; x++) {
        const o = (y * 256 + x) * 4;
        data.set([60, 60, 70, 255], o);
      }
  }
  const image: Image = { width: 256, height: 256, data };
  const m = measureFigure(image)!;
  return {
    image,
    source: m,
    metrics: m,
    record: { pre: { height: 0, pelvisX: 0, soleY: 0 }, post: { height: 0, pelvisX: 0, soleY: 0 }, dx: 0, dy: 0 },
  };
}

describe('template ghosts agree with the foot-slide gate', () => {
  it('derives the half stride from the table ground speed (run 37.5, walk 26.7 px @2x in E)', () => {
    expect(halfStrideFor(groundSpeedPxS('run', 'E')!, tableDuration('run'))).toBeCloseTo(37.5, 5);
    expect(halfStrideFor(groundSpeedPxS('walk', 'E')!, tableDuration('walk'))).toBeCloseTo(26.67, 1);
    expect(groundSpeedPxS('run', 'E')).toBe(RUN_SPEED_PX_S * viewGain('E'));
    expect(groundSpeedPxS('walk', 'SE')).toBe(WALK_SPEED_PX_S * viewGain('SE'));
    expect(groundSpeedPxS('idle', 'E')).toBeNull();
  });

  for (const [id, frames] of [
    ['run', 12],
    ['run', 10],
    ['run', 8],
    ['walk', 12],
  ] as const) {
    for (const dir of ['E', 'SE', 'S', 'NE', 'N'] as const) {
      it(`${id} ${frames} cells ${dir}: feet drawn exactly on the planted ghosts produce no foot-slide finding`, () => {
        const speed = groundSpeedPxS(id, dir)!;
        const duration = tableDuration(id);
        const cells = locomotionCells(frames, guides, {
          direction: dir,
          halfStride: halfStrideFor(speed, duration),
          lift: 14,
        });
        const clip: QaClip = {
          name: id,
          direction: dir,
          loop: true,
          kind: 'upright',
          expectedFrames: frames,
          frames: cells.map(footFrame),
          cells,
          groundPxPerFrame: groundPxPerFrame(speed, duration, frames),
        };
        expect(checkFootSlide(clip, { masterHeight: 208, master, guides })).toEqual([]);
      });
    }
  }

  it('a template with a wrong stride (the old hard-coded 30 for an 8-cell run) IS caught by the gate', () => {
    const speed = groundSpeedPxS('run', 'E')!;
    const cells = locomotionCells(8, guides, { halfStride: 30, lift: 14 });
    const clip: QaClip = {
      name: 'run',
      loop: true,
      kind: 'upright',
      expectedFrames: 8,
      frames: cells.map(footFrame),
      cells,
      groundPxPerFrame: groundPxPerFrame(speed, tableDuration('run'), 8),
    };
    expect(checkFootSlide(clip, { masterHeight: 208, master, guides }).length).toBeGreaterThan(0);
  });
});

describe('directional ground travel', () => {
  const cases = [
    ['E', 1, 0],
    ['SE', 2, 1],
    ['S', 0, 1],
    ['NE', 2, -1],
    ['N', 0, -1],
  ] as const;
  for (const [direction, x, y] of cases) {
    it(`${direction}: ghosts follow the y-down isometric axis and the table speed`, () => {
      const axis = facingGroundVector(direction);
      expect(axis.x).toBeCloseTo(x / Math.hypot(x, y));
      expect(axis.y).toBeCloseTo(y / Math.hypot(x, y));
      const speed = groundSpeedPxS('run', direction)!;
      const duration = tableDuration('run');
      const cells = locomotionCells(12, guides, { direction, halfStride: halfStrideFor(speed, duration), lift: 14 });
      const a = cells[0]!.nearFoot!,
        b = cells[1]!.nearFoot!;
      const step = groundPxPerFrame(speed, duration, 12);
      expect(b.x - a.x).toBeCloseTo(-step * axis.x);
      expect(b.y - a.y).toBeCloseTo(-step * axis.y);
      // Leading labels follow the gait phase even in vertical views and while the swing foot is lifted.
      expect(cells[0]!.leading).toBe('R');
      expect(cells[6]!.leading).toBe('L');
    });

    for (const mode of ['stationary', 'reversed'] as const) {
      it(`${direction}: detects ${mode} planted travel`, () => {
        const speed = groundSpeedPxS('run', direction)!;
        const duration = tableDuration('run');
        const cells = locomotionCells(12, guides, { direction, halfStride: halfStrideFor(speed, duration), lift: 14 });
        const frames = cells.map((c, i) =>
          footFrame({
            ...c,
            farFoot: undefined,
            nearFoot: cells[mode === 'stationary' ? 2 : i === 2 ? 3 : 2]!.nearFoot,
          }),
        );
        const clip: QaClip = {
          name: 'run',
          direction,
          loop: true,
          kind: 'upright',
          expectedFrames: 12,
          frames,
          cells: cells.map((c, i) => ({
            ...c,
            farFoot: undefined,
            nearFoot: { ...c.nearFoot!, planted: i === 2 || i === 3 },
          })),
          groundPxPerFrame: groundPxPerFrame(speed, duration, 12),
        };
        const findings = checkFootSlide(clip, { masterHeight: 208, master, guides });
        const metric = direction === 'E' ? 'slide_px_per_frame_R' : 'slide_ground_px_per_frame_R';
        expect(findings.some((f) => f.metric === metric && f.value! > 3)).toBe(true);
      });
    }
  }
});

describe('stance and annotated contacts', () => {
  it('a sprint stance (1/3 of the cycle) has flight cells and still matches the gate speed', () => {
    const speed = groundSpeedPxS('run', 'E')!;
    const duration = tableDuration('run');
    const stance = 1 / 3;
    const cells = locomotionCells(12, guides, { halfStride: halfStrideFor(speed, duration, stance), lift: 14, stance });
    expect(cells.some((c) => !c.nearFoot?.planted && !c.farFoot?.planted)).toBe(true); // both feet airborne
    const clip: QaClip = {
      name: 'run',
      loop: true,
      kind: 'upright',
      expectedFrames: 12,
      frames: cells.map(footFrame),
      cells,
      groundPxPerFrame: groundPxPerFrame(speed, duration, 12),
    };
    expect(checkFootSlide(clip, { masterHeight: 208, master, guides })).toEqual([]);
    expect(() => locomotionCells(12, guides, { halfStride: 20, lift: 5, stance: 0.8 })).toThrow(RangeError);
  });

  it('applyContacts replaces the template planted flags by the annotation and keeps the ghosts', () => {
    const cells = locomotionCells(12, guides, { halfStride: 37.5, lift: 14 });
    const out = applyContacts(cells, { R: [0, 1], L: [6] });
    expect(out.map((c) => c.nearFoot?.planted)).toEqual(cells.map((_, i) => [0, 1].includes(i)));
    expect(out.map((c) => c.farFoot?.planted)).toEqual(cells.map((_, i) => i === 6));
    expect(out[3]!.nearFoot?.x).toBe(cells[3]!.nearFoot?.x);
  });

  it('a planted foot that is not on its ghost is reported, not silently skipped', () => {
    const speed = groundSpeedPxS('run', 'E')!;
    const cells = locomotionCells(12, guides, { halfStride: halfStrideFor(speed, tableDuration('run')), lift: 14 });
    const frames = cells.map((c, i) =>
      footFrame(i === 2 ? { ...c, nearFoot: { ...c.nearFoot!, x: c.nearFoot!.x - 60 } } : c),
    );
    const clip: QaClip = {
      name: 'run',
      loop: true,
      kind: 'upright',
      expectedFrames: 12,
      frames,
      cells,
      groundPxPerFrame: groundPxPerFrame(speed, tableDuration('run'), 12),
    };
    const f = checkFootSlide(clip, { masterHeight: 208, master, guides });
    expect(f.some((x) => x.frame === 2 && x.severity === 'warn' && /not on the template/.test(x.message))).toBe(true);
  });
});
