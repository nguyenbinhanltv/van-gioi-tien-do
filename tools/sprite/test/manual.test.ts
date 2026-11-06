import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acceptFindings,
  applyBacklog,
  backlogMarkdown,
  emptyBacklog,
  loadBacklog,
  migrateManualFindings,
  pruneResolved,
  saveBacklog,
  validateBacklog,
  type ManualArtFinding,
  type Backlog,
  type Finding,
} from '../src/index.js';

const manual: ManualArtFinding = {
  kind: 'carry_change',
  clip: 'run',
  dir: 'E',
  cells: [2, 3],
  note: 'Sword carry changes <visibly>',
  severity: 'warn',
  reviewer: 'art-worker',
};
const legacy = {
  format: 'vgtd-manual-art-findings',
  version: 1,
  character: 'kiem-tu',
  cellConvention: '0based;-1wholeclip',
  entries: [
    {
      clip: 'run',
      dir: 'E',
      cell: -1,
      kind: 'leg_reversal',
      metric: 'ambiguous_half_cycles',
      value: 2,
      limit: 0,
      severity: 'warn',
      status: 'open',
      note: 'Both half cycles unclear',
    },
    { clip: 'idle', dir: 'E', cell: 0, kind: 'key_spill', severity: 'info', note: 'Unconfirmed tint' },
  ],
};

describe('manual art backlog', () => {
  it('never accepts a metric, synthesizes footSlide, or resolves/prunes a manual finding', () => {
    const b: Backlog = { ...emptyBacklog('kiem-tu'), manual: [manual] };
    const slide: Finding = {
      gate: 'footSlide',
      clip: 'run',
      frame: 2,
      severity: 'fail',
      metric: 'slide_px_per_frame_R',
      value: 5,
      limit: 3,
      message: 'slide',
    };
    const report = applyBacklog([slide], 'E', b);
    expect(report.judged).toHaveLength(1);
    expect(report.judged[0]!.verdict).toBe('fail-soft');
    expect(report.resolved).toEqual([]);
    expect(report.manual).toEqual([manual]);
    const noMetrics = applyBacklog([], 'E', b);
    expect(noMetrics.judged).toEqual([]);
    expect(noMetrics.resolved).toEqual([]);
    expect(noMetrics.ok).toBe(true);
    expect(pruneResolved(b, noMetrics).manual).toEqual([manual]);
    expect(acceptFindings(b, report, 'E', { note: 'measured acceptance', prune: true }).manual).toEqual([manual]);
    expect(applyBacklog([], 'SE', b).manual).toEqual([]);
  });

  it('roundtrips manual-only and existing v1 metric backlogs and counts manual markdown entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-manual-'));
    const path = join(dir, 'quality-backlog.json');
    const b = { ...emptyBacklog('kiem-tu'), manual: [manual] };
    saveBacklog(path, b);
    expect(loadBacklog(path, 'kiem-tu')).toEqual(b);
    expect(backlogMarkdown(b)).toContain('Manual art findings (1)');
    expect(backlogMarkdown(b)).toContain('carry_change | warn | art-worker');
    expect(() => validateBacklog(emptyBacklog('old-v1'))).not.toThrow();
  });

  it('preserves explicit art resolutions without resolving or accepting any metric finding', () => {
    const source = { ...legacy, entries: [{ ...legacy.entries[0], status: 'resolved', value: 0 }] };
    const b = migrateManualFindings(emptyBacklog('kiem-tu'), source);
    const report = applyBacklog([], 'E', b);
    expect(report.manual[0]!.status).toBe('resolved');
    expect(report.resolved).toEqual([]);
    expect(report.counts.accepted).toBe(0);
    expect(pruneResolved(b, report).manual).toEqual(b.manual);
    expect(backlogMarkdown(b)).toContain('art-worker | resolved');
  });

  it('rejects malformed observations and metric fields in the manual collection', () => {
    for (const over of [
      { kind: 'footSlide' },
      { reviewer: 'engine' },
      { status: 'auto-resolved' },
      { cells: [-1] },
      { cells: [1, 1] },
      { cells: [0.5] },
      { cells: '1' },
      { note: '' },
      { severity: '' },
      { dir: 'bad' },
      { clip: '' },
      { gate: 'footSlide' },
      { metric: 'slide' },
      { value: 5 },
      { limit: 3 },
      { cell: 2 },
    ]) {
      const b = { ...emptyBacklog('c'), manual: [{ ...manual, ...over }] } as Backlog;
      expect(() => validateBacklog(b), JSON.stringify(over)).toThrow(/manual finding/);
    }
  });

  it('migrates worker17 aliases, retains diagnostics as prose and is idempotent', () => {
    const migrated = migrateManualFindings(emptyBacklog('kiem-tu'), legacy);
    expect(migrated.entries).toEqual([]);
    expect(migrated.manual?.map((e) => [e.kind, e.cells, e.severity, e.reviewer])).toEqual([
      ['weak_reversal', [], 'warn', 'art-worker'],
      ['hair_spill', [0], 'info', 'art-worker'],
    ]);
    expect(migrated.manual?.[0]?.note).toContain('value=2');
    const unknown = migrateManualFindings(emptyBacklog('kiem-tu'), {
      ...legacy,
      entries: [{ ...legacy.entries[0], kind: 'contact_phase' }],
    });
    expect(unknown.manual?.[0]?.kind).toBe('other');
    expect(unknown.manual?.[0]?.note).toContain('contact_phase');
    expect(migrateManualFindings(migrated, legacy)).toEqual(migrated);
    expect(applyBacklog([], 'E', migrated).resolved).toEqual([]);
    expect(() => migrateManualFindings(emptyBacklog('other'), legacy)).toThrow(/character/);
    expect(() => migrateManualFindings(emptyBacklog('kiem-tu'), { ...legacy, cellConvention: 'unknown' })).toThrow(
      /convention/,
    );
    expect(() =>
      migrateManualFindings(emptyBacklog('kiem-tu'), { ...legacy, entries: [{ ...legacy.entries[0], cell0based: 1 }] }),
    ).toThrow(/conflicting/);
  });

  it('imports a companion through sprite:backlog without needing sprite art or a project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-manual-cli-'));
    const source = join(dir, 'companion.json'),
      target = join(dir, 'quality-backlog.json');
    writeFileSync(source, JSON.stringify(legacy));
    const output = execFileSync(
      process.execPath,
      [
        resolve('../rig/scripts/run-ts.mjs'),
        resolve('scripts/backlog.ts'),
        '--backlog',
        target,
        '--import-manual',
        source,
      ],
      { encoding: 'utf8' },
    );
    expect(output).toContain('0 metric entries; 2 manual art findings');
    expect(loadBacklog(target, 'kiem-tu').manual).toHaveLength(2);
    expect(readFileSync(join(dir, 'quality-backlog.md'), 'utf8')).toContain('Manual art findings (2)');
  });
});
