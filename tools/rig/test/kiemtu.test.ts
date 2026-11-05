import { describe, expect, it } from 'vitest';
import { DRAWN_DIRECTIONS } from '@vgtd/shared';
import {
  KIEMTU_CLIPS,
  KIEMTU_REQUIRED_ROLES,
  authorKiemTuSet,
  buildReferenceHumanoid,
  clipSpec,
  formatQaReports,
  runQa,
  validateRig,
} from '../src/index.js';

describe('Kiếm tu set on the reference rig', () => {
  it.each(DRAWN_DIRECTIONS)('passes QA in %s', (dir) => {
    const rig = buildReferenceHumanoid(dir);
    expect(validateRig(rig, { requireRoles: KIEMTU_REQUIRED_ROLES }).filter((i) => i.severity === 'error')).toEqual([]);
    const clips = authorKiemTuSet(rig);
    expect(clips.map((c) => c.name)).toEqual([...KIEMTU_CLIPS]);
    const reports = clips.map((c) =>
      runQa(rig, c, { spec: clipSpec(c.name.startsWith('attack') ? 'attack' : (c.name as 'idle')) }),
    );
    const text = formatQaReports(reports);
    expect(
      reports.flatMap((r) => r.issues.filter((i) => i.severity === 'error')),
      text,
    ).toEqual([]);
  });
});

describe('buildCharacterPackage', () => {
  it('QA-gates and exports; refuses broken clips', async () => {
    const { buildCharacterPackage, ClipBuilder } = await import('../src/index.js');
    const rig = buildReferenceHumanoid('E');
    const atlas = {
      imagePath: 'a.png',
      width: 512,
      height: 512,
      premultipliedAlpha: true,
      regions: rig.slots.map((s, i) => ({ name: s.name, x: i * 20, y: 0, width: 18, height: 18 })),
    };
    const good = buildCharacterPackage([{ rig, clips: authorKiemTuSet(rig) }], atlas, { name: 'kiemtu' });
    expect(good.reports.every((r) => r.errors === 0)).toBe(true);
    expect(good.export.ske.version).toBe('5.5');

    const bad = new ClipBuilder(rig, { name: 'idle', frames: 30, loop: true })
      .rotate('head', [
        [0, 0],
        [30, 40],
      ])
      .build();
    expect(() => buildCharacterPackage([{ rig, clips: [bad] }], atlas, { name: 'x' })).toThrow(/QA failed/);
    expect(
      buildCharacterPackage([{ rig, clips: [bad] }], atlas, { name: 'x', allowErrors: true }).reports[0]!.errors,
    ).toBeGreaterThan(0);
  });
});
