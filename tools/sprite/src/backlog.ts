/**
 * Quality backlog (D41, "produce the full set first, improve each asset later"): a per-character JSON file of SOFT findings
 * that are accepted for now. `sprite:build` fails on hard gates always, and on soft findings that are NOT listed; a listed
 * one passes as a warning while its value is no worse than the recorded one (a worse value is a regression and fails).
 *
 *   hard (never listed): frames present, height of upright clips, face/torso similarity, loop seam, export errors
 *   soft (may be listed): foot slide, planted foot not on its template ghost, height warning of a free clip without a
 *                         declared pose exception
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Finding } from './qa.js';

export const BACKLOG_FORMAT = 'vgtd-quality-backlog' as const;

export interface BacklogEntry {
  readonly clip: string;
  readonly dir: string;
  /** Cell (0-based frame) of the finding; -1 for a clip-level finding. */
  readonly cell: number;
  readonly gate: Finding['gate'];
  readonly metric: string;
  /** The measured value accepted for now; the finding may not get worse than this. */
  readonly value: number;
  readonly limit: number;
  readonly note: string;
  readonly status: 'open' | 'planned';
  readonly owner?: string;
  /** ISO date the entry was added. */
  readonly added?: string;
}

export interface Backlog {
  readonly format: typeof BACKLOG_FORMAT;
  readonly version: 1;
  readonly character: string;
  readonly entries: readonly BacklogEntry[];
}

export type FindingClass = 'hard' | 'soft' | 'info';

/** Gates that can never be accepted into the backlog. */
export const HARD_GATES: readonly Finding['gate'][] = ['present', 'loopSeam', 'similarity'];

/** hard / soft / info class of a finding (see the file header). */
export function classify(f: Finding): FindingClass {
  if (f.severity === 'info') return 'info';
  if (HARD_GATES.includes(f.gate)) return 'hard';
  if (f.gate === 'height') return f.severity === 'fail' ? 'hard' : 'soft';
  return 'soft'; // footSlide
}

export type Verdict = 'fail-hard' | 'fail-soft' | 'accepted' | 'regression' | 'info';

export interface JudgedFinding {
  readonly finding: Finding;
  readonly class: FindingClass;
  readonly verdict: Verdict;
  readonly entry?: BacklogEntry;
}

export interface BacklogReport {
  readonly ok: boolean;
  readonly judged: readonly JudgedFinding[];
  /** Backlog entries (of this direction) that no longer occur: fixed, prune them. */
  readonly resolved: readonly BacklogEntry[];
  readonly counts: Readonly<Record<Verdict, number>>;
}

const keyOf = (clip: string, dir: string, cell: number, gate: string, metric: string) =>
  `${clip}|${dir}|${cell}|${gate}|${metric}`;

const entryKey = (e: BacklogEntry) => keyOf(e.clip, e.dir, e.cell, e.gate, e.metric);

const findingKey = (f: Finding, dir: string) => keyOf(f.clip, dir, f.frame ?? -1, f.gate, f.metric ?? '');

/** Validate a parsed backlog; throws with the reason (hard gates cannot be listed, keys must be unique). */
export function validateBacklog(b: Backlog): void {
  if (b.format !== BACKLOG_FORMAT || b.version !== 1) throw new Error(`not a ${BACKLOG_FORMAT} v1 file`);
  const seen = new Set<string>();
  for (const e of b.entries) {
    if (HARD_GATES.includes(e.gate))
      throw new Error(`backlog entry ${entryKey(e)}: gate '${e.gate}' is hard and cannot be accepted`);
    if (e.gate === 'height' && e.metric !== 'height_excess_px')
      throw new Error(`backlog entry ${entryKey(e)}: unexpected metric`);
    if (!e.metric) throw new Error(`backlog entry ${entryKey(e)}: metric is required`);
    if (!e.note) throw new Error(`backlog entry ${entryKey(e)}: a note (why accepted) is required`);
    const k = entryKey(e);
    if (seen.has(k)) throw new Error(`duplicate backlog entry ${k}`);
    seen.add(k);
  }
}

export function emptyBacklog(character: string): Backlog {
  return { format: BACKLOG_FORMAT, version: 1, character, entries: [] };
}

export function loadBacklog(path: string, character: string): Backlog {
  if (!existsSync(path)) return emptyBacklog(character);
  const b = JSON.parse(readFileSync(path, 'utf8')) as Backlog;
  validateBacklog(b);
  return b;
}

function sortEntries(entries: readonly BacklogEntry[]): BacklogEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.clip.localeCompare(b.clip) ||
      a.dir.localeCompare(b.dir) ||
      a.cell - b.cell ||
      a.gate.localeCompare(b.gate) ||
      a.metric.localeCompare(b.metric),
  );
}

export function saveBacklog(path: string, b: Backlog): void {
  validateBacklog(b);
  writeFileSync(path, JSON.stringify({ ...b, entries: sortEntries(b.entries) }, null, 2) + '\n');
}

/** Relative slack of a listed value before it counts as a regression. */
export const REGRESSION_TOLERANCE = 0.01;

/** Judge raw QA findings of direction `dir` against the backlog. */
export function applyBacklog(findings: readonly Finding[], dir: string, backlog: Backlog | null): BacklogReport {
  const entries = new Map((backlog?.entries ?? []).filter((e) => e.dir === dir).map((e) => [entryKey(e), e]));
  const used = new Set<string>();
  const judged: JudgedFinding[] = findings.map((finding) => {
    const cls = classify(finding);
    if (cls === 'info') return { finding, class: cls, verdict: 'info' };
    if (cls === 'hard') return { finding, class: cls, verdict: 'fail-hard' };
    const k = findingKey(finding, dir);
    const entry = entries.get(k);
    if (!entry || finding.value === undefined) return { finding, class: cls, verdict: 'fail-soft' };
    used.add(k);
    const ok = finding.value <= entry.value * (1 + REGRESSION_TOLERANCE) + 1e-9;
    return { finding, class: cls, verdict: ok ? 'accepted' : 'regression', entry };
  });
  const counts: Record<Verdict, number> = { 'fail-hard': 0, 'fail-soft': 0, accepted: 0, regression: 0, info: 0 };
  for (const j of judged) counts[j.verdict]++;
  return {
    ok: counts['fail-hard'] + counts['fail-soft'] + counts.regression === 0,
    judged,
    resolved: [...entries].filter(([k]) => !used.has(k)).map(([, e]) => e),
    counts,
  };
}

export interface AcceptOptions {
  readonly note: string;
  readonly owner?: string;
  readonly added?: string;
  /** Drop the entries that no longer occur. */
  readonly prune?: boolean;
}

/**
 * Add the CURRENT unlisted soft findings of `report` to the backlog (a deliberate act: the caller supplies the note).
 * Hard findings and regressions are never added.
 */
export function acceptFindings(backlog: Backlog, report: BacklogReport, dir: string, o: AcceptOptions): Backlog {
  if (!o.note) throw new Error('accepting findings needs a note (why they are accepted for now)');
  const resolved = new Set(report.resolved.map(entryKey));
  const kept = o.prune ? backlog.entries.filter((e) => !resolved.has(entryKey(e))) : [...backlog.entries];
  const have = new Set(kept.map(entryKey));
  for (const j of report.judged) {
    if (j.verdict !== 'fail-soft') continue;
    const f = j.finding;
    if (f.metric === undefined || f.value === undefined || f.limit === undefined) continue;
    const e: BacklogEntry = {
      clip: f.clip,
      dir,
      cell: f.frame ?? -1,
      gate: f.gate,
      metric: f.metric,
      value: f.value,
      limit: f.limit,
      note: o.note,
      status: 'open',
      ...(o.owner ? { owner: o.owner } : {}),
      ...(o.added ? { added: o.added } : {}),
    };
    if (have.has(entryKey(e))) continue;
    have.add(entryKey(e));
    kept.push(e);
  }
  return { ...backlog, entries: sortEntries(kept) };
}

/**
 * Drop the entries of `report.resolved` (they no longer occur) and add NOTHING: pruning never whitelists a finding.
 */
export function pruneResolved(backlog: Backlog, report: BacklogReport): Backlog {
  const resolved = new Set(report.resolved.map(entryKey));
  return { ...backlog, entries: sortEntries(backlog.entries.filter((e) => !resolved.has(entryKey(e)))) };
}

/** Markdown view of a backlog (generated; never edit by hand). */
export function backlogMarkdown(b: Backlog): string {
  const lines = [
    `# Quality backlog: ${b.character}`,
    '',
    `Generated from \`quality-backlog.json\` (${b.entries.length} accepted soft finding${b.entries.length === 1 ? '' : 's'}). Hard gates (frames, upright height, similarity, loop seam, export) are never listed. A listed finding passes as a warning while its value is no worse than recorded.`,
    '',
  ];
  if (!b.entries.length) return lines.join('\n') + '\nNo accepted findings.\n';
  lines.push(
    '| clip | dir | cell | gate | metric | value | limit | status | note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const e of sortEntries(b.entries))
    lines.push(
      `| ${e.clip} | ${e.dir} | ${e.cell < 0 ? '-' : e.cell} | ${e.gate} | ${e.metric} | ${e.value} | ${e.limit} | ${e.status}${e.owner ? ` (${e.owner})` : ''} | ${e.note.replace(/\|/g, '/')} |`,
    );
  return lines.join('\n') + '\n';
}
