import { describe, expect, it } from 'vitest';
import { RUN_SPEED_PX_S, WALK_SPEED_PX_S, viewGain, type Image } from '@vgtd/rig';
import {
  checkFootSlide,
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
    for (const dir of ['E', 'SE'] as const) {
      it(`${id} ${frames} cells ${dir}: feet drawn exactly on the planted ghosts produce no foot-slide finding`, () => {
        const speed = groundSpeedPxS(id, dir)!;
        const duration = tableDuration(id);
        const cells = locomotionCells(frames, guides, { halfStride: halfStrideFor(speed, duration), lift: 14 });
        const clip: QaClip = {
          name: id,
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
