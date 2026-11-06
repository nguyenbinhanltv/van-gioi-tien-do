import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng } from '@vgtd/rig';
import { runProject, toPremultiplied, type Project } from '../src/index.js';
import { makeMaster, makeSheet } from './helpers.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vgtd-sprite-'));
  writeFileSync(join(dir, 'master.png'), encodePng(makeMaster(208, 128)));
  // run sheet at 2x the master DPI (raw figure 416 px for a 208 px master): 4 frames, 2 cols; the bounce stays in +-2 %
  const run = makeSheet(
    2,
    2,
    512,
    [0, 1, 2, 3].map((i) => ({ height: 416 + (i % 2) * 4, cx: 256 + i * 2, sole: 480 - (i % 2) * 2, stride: i * 6 })),
  );
  writeFileSync(join(dir, 'run.png'), encodePng(toPremultiplied(run)));
  // idle sheet at 1x
  const idle = makeSheet(
    2,
    1,
    256,
    [0, 1].map((i) => ({ height: 208 + i, cx: 128, sole: 232 })),
  );
  writeFileSync(join(dir, 'idle.png'), encodePng(toPremultiplied(idle)));
  // die sheet at 1x with a collapsing figure
  const die = makeSheet(2, 1, 256, [
    { height: 208, cx: 128, sole: 232 },
    { height: 90, cx: 128, sole: 232 },
  ]);
  writeFileSync(join(dir, 'die.png'), encodePng(toPremultiplied(die)));
  const project: Project = {
    character: 'kiem-tu',
    direction: 'E',
    stem: 'kiemtu',
    master: 'master.png',
    palette: { size: 16, lock: true },
    clips: [
      {
        name: 'run',
        sheet: 'run.png',
        cols: 2,
        frames: 4,
        durationSec: 0.5,
        loop: true,
        tableId: 'run',
        calibration: { referenceFrames: [0, 1, 2, 3] },
      },
      { name: 'idle', sheet: 'idle.png', cols: 2, frames: 2, durationSec: 1, loop: true, tableId: 'idle' },
      {
        name: 'die',
        sheet: 'die.png',
        cols: 2,
        frames: 2,
        durationSec: 0.5,
        loop: false,
        kind: 'free',
        exceptions: { 1: 'die-collapse' },
        calibration: { scale: 1 },
      },
    ],
  };
  return { dir, project };
}

describe('runProject (synthetic end to end)', () => {
  it('slices, calibrates per sheet, aligns, packs, exports and gates', () => {
    const { dir, project } = setup();
    const res = runProject(project, dir);
    const c = res.contract;
    // the run sheet (2x DPI) got ~0.5, the idle sheet the character calibration ~1, die the explicit 1
    const scale = (n: string) => c.clips.find((k) => k.name === n)!.calibration.scale;
    expect(scale('run')).toBeCloseTo(0.5, 1);
    expect(scale('idle')).toBeCloseTo(1, 1);
    expect(scale('die')).toBe(1);
    expect(c.calibration?.scale).toBeCloseTo(1, 1);
    // every frame of a sheet shares its sheet scale (no per-frame fit)
    for (const k of c.clips) for (const r of k.records) expect(r).not.toBeNull();
    // pre/post metrics are recorded; the collapsed die frame keeps its size and is flagged
    const dieRec = c.clips.find((k) => k.name === 'die')!.records[1]!;
    expect(dieRec.exception).toBe('die-collapse');
    expect(dieRec.post.height).toBeLessThan(120);
    expect(dieRec.post.soleY).toBe(232);
    expect(c.atlas.pages).toBe(1);
    expect(c.atlas).not.toHaveProperty('textures');
    expect(c.atlas.regions).toBe(8);
    expect(c.qa.findings.filter((f) => f.gate === 'present')).toHaveLength(0);
    // outputs
    expect([...res.files.keys()].sort()).toEqual([
      'kiemtu_E.sprite.json',
      'kiemtu_E_ske.json',
      'kiemtu_E_tex.json',
      'kiemtu_E_tex.png',
    ]);
    const ske = JSON.parse(res.files.get('kiemtu_E_ske.json') as string) as {
      armature: {
        name: string;
        slot: { name: string }[];
        animation: { name: string; slot?: { displayFrame: unknown[] }[]; frame?: unknown[] }[];
      }[];
    };
    const arm = ske.armature[0]!;
    expect(arm.name).toBe('kiemtu_E');
    expect(arm.slot.map((s) => s.name)).toEqual(['body']);
    expect(arm.animation.map((a) => a.name)).toEqual(['run', 'idle', 'die']);
    expect(arm.animation[0]!.slot![0]!.displayFrame.length).toBeGreaterThan(1);
    expect(arm.animation[0]!.frame?.length).toBeGreaterThan(0); // footstep events of the run table
  });

  it('is deterministic', () => {
    const { dir, project } = setup();
    const a = runProject(project, dir);
    const b = runProject(project, dir);
    for (const [k, v] of a.files)
      expect(Buffer.from(v as string | Buffer).equals(Buffer.from(b.files.get(k) as string | Buffer))).toBe(true);
  });

  it('fails the height gate on an upright clip outside +-3 %', () => {
    const { dir, project } = setup();
    const bad: Project = {
      ...project,
      clips: project.clips.map((c) => (c.name === 'idle' ? { ...c, calibration: { scale: 0.8 } } : c)),
    };
    const res = runProject(bad, dir);
    expect(res.contract.qa.ok).toBe(false);
    expect(
      res.contract.qa.findings.some((f) => f.gate === 'height' && f.clip === 'idle' && f.severity === 'fail'),
    ).toBe(true);
  });
});
