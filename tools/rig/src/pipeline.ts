/**
 * One call from "rigs + authored clips + packed atlas" to a DragonBones package, with the QA gate in between:
 * nothing is exported while a clip has QA errors (unless `allowErrors`), so agents cannot ship a foot-sliding run.
 */
import { ANIMATION_IDS, type AnimationId } from '@vgtd/character';
import { clipSpec } from './animset.js';
import { exportDragonBones, type DragonBonesExport, type ExportEntry, type ExportOptions } from './dragonbones.js';
import { formatQaReports, runQa, type QaOptions, type QaReport } from './qa.js';
import { validateRig } from './validate.js';
import type { AtlasData } from './schema.js';

export interface PackageResult {
  readonly export: DragonBonesExport;
  readonly reports: readonly QaReport[];
}

export interface PackageOptions extends ExportOptions {
  /** Export even if QA reports errors (the reports are still returned). Default false. */
  readonly allowErrors?: boolean;
  readonly qa?: Omit<QaOptions, 'spec'>;
}

/** `attack_2` → `attack`; ids of the 13-animation table map to themselves; other names have no spec. */
export function specIdForClipName(name: string): AnimationId | null {
  const base = name.replace(/_\d+$/, '');
  return (ANIMATION_IDS as readonly string[]).includes(base) ? (base as AnimationId) : null;
}

export function buildCharacterPackage(
  entries: readonly ExportEntry[],
  atlas: AtlasData,
  opts: PackageOptions,
): PackageResult {
  const reports: QaReport[] = [];
  for (const { rig, clips } of entries) {
    const rigErrors = validateRig(rig).filter((i) => i.severity === 'error');
    if (rigErrors.length) {
      throw new Error(
        `rig '${rig.id}' (${rig.direction}) is invalid:\n${rigErrors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
      );
    }
    for (const clip of clips) {
      const id = specIdForClipName(clip.name);
      reports.push(runQa(rig, clip, { ...opts.qa, ...(id ? { spec: clipSpec(id) } : {}) }));
    }
  }
  if (!opts.allowErrors && reports.some((r) => r.errors > 0)) {
    throw new Error(`QA failed:\n${formatQaReports(reports.filter((r) => r.errors > 0))}`);
  }
  return { export: exportDragonBones(entries, atlas, opts), reports };
}
