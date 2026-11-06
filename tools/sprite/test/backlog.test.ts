import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng } from '@vgtd/rig';
import {
  acceptFindings,
  applyBacklog,
  backlogMarkdown,
  classify,
  emptyBacklog,
  loadBacklog,
  pruneResolved,
  runProject,
  saveBacklog,
  toPremultiplied,
  validateBacklog,
  type Backlog,
  type BacklogEntry,
  type Finding,
  type Project,
} from '../src/index.js';
import { makeMaster, makeSheet } from './helpers.js';

const slide = (clip: string, frame: number, value: number): Finding => ({
  gate: 'footSlide',
  severity: 'fail',
  clip,
  frame,
  metric: 'slide_px_per_frame_R',
  value,
  limit: 3,
  message: `R foot slides ${value}`,
});
const hard: Finding = { gate: 'similarity', severity: 'fail', clip: 'run', frame: 2, message: 'face' };
const info: Finding = {
  gate: 'height',
  severity: 'info',
  clip: 'die',
  frame: 3,
  message: 'exception',
  metric: 'height_excess_px',
  value: 150,
  limit: 201,
};

const entry = (over: Partial<BacklogEntry> = {}): BacklogEntry => ({
  clip: 'run',
  dir: 'E',
  cell: 2,
  gate: 'footSlide',
  metric: 'slide_px_per_frame_R',
  value: 5.1,
  limit: 3,
  note: 'boot lifted',
  status: 'open',
  ...over,
});

describe('classification', () => {
  it('hard gates and upright height failures are hard; foot slide and height warnings are soft; info is info', () => {
    expect(classify(hard)).toBe('hard');
    expect(classify({ gate: 'present', severity: 'fail', clip: 'c', message: '' })).toBe('hard');
    expect(classify({ gate: 'loopSeam', severity: 'fail', clip: 'c', message: '' })).toBe('hard');
    expect(classify({ gate: 'height', severity: 'fail', clip: 'c', message: '' })).toBe('hard');
    expect(classify({ gate: 'height', severity: 'warn', clip: 'c', message: '' })).toBe('soft');
    expect(classify(slide('run', 1, 5))).toBe('soft');
    expect(classify(info)).toBe('info');
  });
});

describe('applyBacklog', () => {
  it('does not accept new non-E ground-projection measurements using old x-only baselines', () => {
    const old: Backlog = { ...emptyBacklog('kiem-tu'), entries: [entry({ dir: 'SE', value: 99 })] };
    const finding = { ...slide('run', 2, 5), metric: 'slide_ground_px_per_frame_R' };
    const report = applyBacklog([finding], 'SE', old);
    expect(report.counts['fail-soft']).toBe(1);
    expect(report.counts.accepted).toBe(0);
    expect(report.resolved).toEqual(old.entries);
  });

  const backlog: Backlog = {
    ...emptyBacklog('kiem-tu'),
    entries: [entry(), entry({ clip: 'walk', cell: 9, value: 4, note: 'old' })],
  };

  it('a listed soft finding passes as accepted while it is no worse than recorded', () => {
    const r = applyBacklog([slide('run', 2, 5.1)], 'E', backlog);
    expect(r.counts.accepted).toBe(1);
    expect(r.ok).toBe(true);
    expect(applyBacklog([slide('run', 2, 5.14)], 'E', backlog).ok).toBe(true); // within 1 %
    expect(applyBacklog([slide('run', 2, 4.0)], 'E', backlog).ok).toBe(true); // better
  });

  it('a worse value is a regression and fails', () => {
    const r = applyBacklog([slide('run', 2, 6.5)], 'E', backlog);
    expect(r.counts.regression).toBe(1);
    expect(r.ok).toBe(false);
  });

  it('an unlisted soft finding fails; another direction or cell is not covered', () => {
    expect(applyBacklog([slide('run', 3, 4)], 'E', backlog).counts['fail-soft']).toBe(1);
    expect(applyBacklog([slide('run', 2, 5)], 'SE', backlog).ok).toBe(false);
  });

  it('hard findings always fail, info passes, resolved entries are reported', () => {
    const r = applyBacklog([hard, info, slide('run', 2, 5)], 'E', backlog);
    expect(r.counts['fail-hard']).toBe(1);
    expect(r.counts.info).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resolved.map((e) => e.clip)).toEqual(['walk']); // walk #9 no longer occurs
  });
});

describe('backlog file', () => {
  it('rejects hard gates, missing notes and duplicates', () => {
    const base = emptyBacklog('c');
    expect(() => validateBacklog({ ...base, entries: [entry({ gate: 'similarity' })] })).toThrow(/hard/);
    expect(() => validateBacklog({ ...base, entries: [entry({ note: '' })] })).toThrow(/note/);
    expect(() => validateBacklog({ ...base, entries: [entry(), entry()] })).toThrow(/duplicate/);
    expect(() => validateBacklog({ ...base, entries: [entry()] })).not.toThrow();
  });

  it('accept appends only unlisted SOFT findings (not hard, not regressions); prune drops resolved; markdown lists them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-backlog-'));
    let b = emptyBacklog('kiem-tu');
    const findings = [slide('run', 2, 5.1), slide('run', 7, 4.2), hard];
    let r = applyBacklog(findings, 'E', b);
    b = acceptFindings(b, r, 'E', { note: 'polish later', owner: '17', added: '2026-11-06' });
    expect(b.entries.map((e) => [e.clip, e.cell, e.value])).toEqual([
      ['run', 2, 5.1],
      ['run', 7, 4.2],
    ]);
    r = applyBacklog(findings, 'E', b);
    expect(r.counts['fail-hard']).toBe(1); // the hard one stays a failure
    expect(r.counts.accepted).toBe(2);
    // a regression is not re-accepted
    const worse = applyBacklog([slide('run', 2, 9)], 'E', b);
    expect(acceptFindings(b, worse, 'E', { note: 'x' }).entries[0]!.value).toBe(5.1);
    // prune
    const fixed = applyBacklog([slide('run', 2, 5.1)], 'E', b);
    expect(acceptFindings(b, fixed, 'E', { note: 'x', prune: true }).entries).toHaveLength(1);
    expect(() => acceptFindings(b, r, 'E', { note: '' })).toThrow();
    // round trip + markdown
    const path = join(dir, 'quality-backlog.json');
    saveBacklog(path, b);
    expect(loadBacklog(path, 'kiem-tu').entries).toHaveLength(2);
    expect(loadBacklog(join(dir, 'missing.json'), 'x').entries).toHaveLength(0);
    expect(backlogMarkdown(b)).toContain(
      '| run | E | 2 | footSlide | slide_px_per_frame_R | 5.1 | 3 | open (17) | polish later |',
    );
  });
});

describe('pruneResolved', () => {
  it('drops resolved entries and adds nothing: a new unlisted soft finding still fails', () => {
    const b: Backlog = {
      ...emptyBacklog('kiem-tu'),
      entries: [entry({ clip: 'walk', cell: 9, note: 'fixed since' })],
    };
    const findings = [slide('run', 4, 6)]; // new, unlisted; the walk #9 entry no longer occurs
    const before = applyBacklog(findings, 'E', b);
    expect(before.resolved).toHaveLength(1);
    expect(before.counts['fail-soft']).toBe(1);
    const pruned = pruneResolved(b, before);
    expect(pruned.entries).toHaveLength(0); // the resolved entry is gone
    const after = applyBacklog(findings, 'E', pruned);
    expect(pruned.entries.some((e) => e.clip === 'run')).toBe(false); // the new finding was NOT added
    expect(after.counts['fail-soft']).toBe(1);
    expect(after.ok).toBe(false);
  });
});

describe('runProject with a backlog', () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-sprite-bl-'));
    writeFileSync(join(dir, 'master.png'), encodePng(makeMaster(208, 128)));
    // a free clip whose second frame is much smaller and has NO declared exception: a soft height warning
    const sheet = makeSheet(2, 1, 256, [
      { height: 208, cx: 128, sole: 232 },
      { height: 150, cx: 128, sole: 232 },
    ]);
    writeFileSync(join(dir, 'hit.png'), encodePng(toPremultiplied(sheet)));
    const project: Project = {
      character: 'kiem-tu',
      direction: 'E',
      stem: 'kiemtu',
      master: 'master.png',
      clips: [
        {
          name: 'hit',
          sheet: 'hit.png',
          cols: 2,
          frames: 2,
          durationSec: 0.4,
          loop: false,
          kind: 'free',
          calibration: { scale: 1 },
        },
      ],
    };
    return { dir, project };
  }

  it('fails on the unlisted soft finding, passes (as accepted) once it is listed, fails on a regression', () => {
    const { dir, project } = setup();
    const first = runProject(project, dir);
    expect(first.contract.qa.ok).toBe(false);
    expect(first.contract.qa.counts['fail-soft']).toBe(1);
    const f = first.contract.qa.judged.find((j) => j.verdict === 'fail-soft')!.finding;
    expect(f.gate).toBe('height');
    const b: Backlog = {
      ...emptyBacklog('kiem-tu'),
      entries: [
        entry({
          clip: 'hit',
          cell: 1,
          gate: 'height',
          metric: 'height_excess_px',
          value: f.value!,
          limit: f.limit!,
          note: 'recoil pose, declare later',
        }),
      ],
    };
    saveBacklog(join(dir, 'quality-backlog.json'), b);
    const second = runProject(project, dir);
    expect(second.contract.qa.ok).toBe(true);
    expect(second.contract.qa.counts.accepted).toBe(1);
    // recorded value lower than the current one: the current finding is worse than accepted
    saveBacklog(join(dir, 'quality-backlog.json'), { ...b, entries: [{ ...b.entries[0]!, value: f.value! - 20 }] });
    expect(runProject(project, dir).contract.qa.counts.regression).toBe(1);
  });
});
