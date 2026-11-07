/**
 * Batch: build + QA every direction of one character in one go.
 *
 *   batch.json = { "character": "kiem-tu", "projects": ["E/project.json", "SE/project.json", ...] }   (paths relative to it)
 *
 * Writes <out>/<DIR>/<stem>_<DIR>_{ske,tex}.json + _tex.png + .sprite.json for every project and <out>/batch-report.json.
 * Capturing the clips in the Cocos runtime and the review page are layered on top by the CLI (scripts/batch.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { DIRECTIONS, type Direction } from '@vgtd/shared';
import { loadBacklog } from './backlog.js';
import { runProject, writeOutputs, type Project, type ProjectResult } from './project.js';
import { BATCH_FORMAT, type BatchReport, type ClipReport, type ClipStatus, type DirReport } from './review.js';

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** A character id / file stem used to build paths (and delete staged folders): lowercase slug, no separators, no `..`. */
export function assertSlug(value: string, what: string): string {
  if (typeof value !== 'string' || !SLUG.test(value))
    throw new Error(
      `${what} '${String(value)}' is not a valid slug (lowercase letters, digits, '_' and '-', starting with a letter or digit)`,
    );
  return value;
}

/** A drawn direction id of `@vgtd/shared` (S, SE, E, NE, N, NW, W, SW). */
export function assertDirection(value: string, what = 'direction'): Direction {
  if (!(DIRECTIONS as readonly string[]).includes(value))
    throw new Error(`${what} '${String(value)}' is not one of ${DIRECTIONS.join(', ')}`);
  return value as Direction;
}

/** Throw unless `target` resolves to a path strictly inside `root` (guard before any recursive delete). */
export function assertInside(root: string, target: string): string {
  const rel = relative(resolve(root), resolve(target));
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`refusing to touch '${target}': outside '${root}'`);
  return resolve(target);
}

export interface BatchFile {
  readonly character: string;
  /** Project files, relative to the batch file. One per direction. */
  readonly projects: readonly string[];
}

export interface BatchRun {
  readonly report: BatchReport;
  readonly results: readonly { readonly dir: string; readonly project: Project; readonly result: ProjectResult }[];
  readonly outDir: string;
}

/** Status and verdict counts of one clip from the judged findings of its direction. */
function clipReport(project: Project, result: ProjectResult, name: string): ClipReport {
  const c = project.clips.find((x) => x.name === name)!;
  const counts = { hard: 0, soft: 0, regression: 0, accepted: 0, info: 0 };
  const originEvidence = result.contract.qa.judged.flatMap((j) =>
    j.finding.clip === name && j.finding.originEvidence
      ? [{ cell: j.finding.frame!, measurement: j.finding.originEvidence }]
      : [],
  );
  const headEvidence = result.contract.qa.judged.flatMap((j) =>
    j.finding.clip === name && j.finding.headEvidence
      ? [{ cell: j.finding.frame!, measurement: j.finding.headEvidence }]
      : [],
  );
  const unmeasuredFootSlide = result.contract.qa.judged.some(
    (j) => j.finding.clip === name && j.finding.gate === 'footSlide' && j.finding.measurement === 'unmeasured',
  );
  for (const j of result.contract.qa.judged) {
    if (j.finding.clip !== name) continue;
    if (j.verdict === 'fail-hard') counts.hard++;
    else if (j.verdict === 'fail-soft') counts.soft++;
    else if (j.verdict === 'regression') counts.regression++;
    else if (j.verdict === 'accepted') counts.accepted++;
    else counts.info++;
  }
  const status: ClipStatus =
    counts.hard + counts.soft + counts.regression > 0
      ? 'fail'
      : counts.accepted > 0 || unmeasuredFootSlide
        ? 'warn'
        : 'ok';
  return {
    name,
    frames: c.frames,
    durationSec: c.durationSec,
    kind: c.kind ?? 'upright',
    status,
    counts,
    ...(unmeasuredFootSlide ? { unmeasuredFootSlide } : {}),
    ...(originEvidence.length ? { originEvidence } : {}),
    ...(headEvidence.length ? { headEvidence } : {}),
  };
}

/** Run every project of a batch file and write the outputs under `outDir`. */
export function runBatch(batchPath: string, outDir: string): BatchRun {
  const batch = JSON.parse(readFileSync(batchPath, 'utf8')) as BatchFile;
  const base = dirname(resolve(batchPath));
  assertSlug(batch.character, 'batch character');
  const dirs = new Set<string>();
  const results: BatchRun['results'][number][] = [];
  const reports: DirReport[] = [];
  for (const rel of batch.projects) {
    const projectPath = resolve(base, rel);
    const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Project;
    assertSlug(project.stem, `${rel}: stem`);
    assertDirection(project.direction, `${rel}: direction`);
    if (project.character !== batch.character)
      throw new Error(`${rel}: character '${project.character}' differs from the batch character '${batch.character}'`);
    if (dirs.has(project.direction)) throw new Error(`${rel}: direction ${project.direction} is listed twice`);
    dirs.add(project.direction);
    const result = runProject(project, dirname(projectPath));
    const folder = join(outDir, project.direction);
    writeOutputs(result, folder);
    const backlogPath = resolve(dirname(projectPath), project.backlog ?? 'quality-backlog.json');
    const backlog = loadBacklog(backlogPath, project.character);
    const entries = backlog.entries.filter((e) => e.dir === project.direction).length;
    const manual = (backlog.manual ?? []).filter((e) => e.dir === project.direction);
    const c = result.contract;
    reports.push({
      dir: project.direction,
      stem: project.stem,
      ok: c.qa.ok,
      atlas: c.atlas,
      backlogEntries: entries,
      resolvedEntries: c.qa.resolved.length,
      ...(manual.length ? { manual } : {}),
      folder: project.direction,
      clips: project.clips.map((cl) => clipReport(project, result, cl.name)),
    });
    results.push({ dir: project.direction, project, result });
  }
  const report: BatchReport = {
    format: BATCH_FORMAT,
    version: 1,
    character: batch.character,
    ok: reports.every((d) => d.ok),
    dirs: reports,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'batch-report.json'), JSON.stringify(report, null, 2) + '\n');
  return { report, results, outDir };
}
