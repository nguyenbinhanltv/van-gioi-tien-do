/** Edit-from-master provenance and pre-alignment pose/face gates. No image model is invoked here. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import type { Project, ProjectClip } from './project.js';
import type { Finding } from './qa.js';
import { normalizeSheetDpi, preparationScale } from './preparation.js';
import { toStraight, toPremultiplied, type Straight } from './raster.js';
import { cellRect, crop, keyOut, sliceSheet } from './slice.js';
import { CELL_PX } from './types.js';
import { sheetLayout, selectSheetCells } from './grouped.js';
import type { TemplateManifest, Guides } from './types.js';
import { guidesFromMaster, measureFigure } from './master.js';
import { resizeImage } from './repair.js';

export const POSE_JOINTS = [
  'crown',
  'chin',
  'shoulder_L',
  'shoulder_R',
  'elbow_L',
  'elbow_R',
  'hand_L',
  'hand_R',
  'pelvis',
  'knee_L',
  'knee_R',
  'foot_L',
  'foot_R',
] as const;
export type PoseJoints = Readonly<Record<(typeof POSE_JOINTS)[number], { readonly x: number; readonly y: number }>>;
export interface VariantCellAnnotation {
  /** Coordinates in normalized 256px source cells, before inset, palette lock or alignment. */
  readonly master: PoseJoints;
  readonly edited: PoseJoints;
  readonly face:
    | { readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }
    | { readonly occluded: string };
}
export interface VariantReference {
  readonly masterSheetSha256: string;
  /** JSON array of VariantCellAnnotation in clip-local playback order. */
  readonly annotations: string;
}
export interface VariantProject {
  readonly kind: 'edit-from-master-v1';
  readonly category: 'tier' | 'costume';
  readonly id: string;
  readonly masterProject: string;
  readonly masterProjectSha256: string;
  readonly masterImageSha256: string;
  /** Required when the source master uses an external preparation calibration file. */
  readonly masterCalibrationSha256?: string;
  readonly edit: { readonly tool: string; readonly prompt: string };
  /** Explicit production thresholds, never inferred or silently accepted via a backlog. */
  readonly thresholds: {
    readonly minSilhouetteIou: number;
    readonly maxJointDistancePx: number;
    readonly minFaceSimilarity: number;
  };
}
export interface VariantMetrics {
  readonly cell: number;
  readonly silhouetteIou: number;
  readonly maxJointDistancePx: number;
  readonly faceSimilarity: number | null;
  readonly faceOcclusion?: string;
}
export interface VariantAudit {
  readonly source: VariantProject;
  readonly clips: readonly {
    readonly name: string;
    readonly masterSheetSha256: string;
    readonly editedSheetSha256: string;
    readonly annotationsSha256: string;
    /** T1 alignment origins in output pixel units; variants must reuse these anchors. */
    readonly alignmentOrigins: readonly { readonly x: number; readonly y: number }[];
    readonly metrics: readonly VariantMetrics[];
  }[];
  readonly findings: readonly Finding[];
}

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
function verifyHash(data: Buffer, expected: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(expected) || hash(data) !== expected) throw new Error(`${label}: SHA256 mismatch`);
}

function canonical(value: unknown): string {
  const ordered = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordered)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, item]) => [k, ordered(item)]),
          )
        : v;
  return JSON.stringify(ordered(value));
}

/** Storage/provenance may differ; every other present or future clip control stays locked. */
function motionControls(c: ProjectClip): string {
  const storage = new Set(['sheet', 'cols', 'sheetSelection', 'manifest', 'variant', 'calibration']);
  return canonical({
    ...Object.fromEntries(Object.entries(c).filter(([key]) => !storage.has(key))),
    kind: c.kind ?? 'upright',
    vertical: c.vertical ?? 'sole',
    phases: c.phases ?? {},
    calibrationOptions: Object.fromEntries(Object.entries(c.calibration ?? {}).filter(([key]) => key !== 'scale')),
  });
}

function templateControls(c: ProjectClip, baseDir: string): string {
  if (!c.manifest) return canonical(null);
  const m = JSON.parse(readFileSync(resolve(baseDir, c.manifest), 'utf8')) as TemplateManifest;
  const grid = sheetLayout(c);
  if (m.grid.cols !== grid.cols || m.grid.rows !== grid.rows) throw new Error('variant template grid mismatch');
  return canonical({ guides: m.guides, cells: selectSheetCells(m.cells, c.sheetSelection) });
}
function validatePoint(p: { x: number; y: number } | undefined): void {
  if (!p || ![p.x, p.y].every((n) => Number.isFinite(n) && n >= 0 && n < CELL_PX))
    throw new Error('variant annotations: joint outside normalized source cell');
}

/** Deterministic per-cell metrics. Joint locations are human annotations, not an automatic anatomical detector. */
export function compareVariantCell(
  master: Straight,
  edited: Straight,
  annotation: VariantCellAnnotation,
  cell: number,
): VariantMetrics {
  if ([master, edited].some((s) => s.width !== CELL_PX || s.height !== CELL_PX))
    throw new Error('variant QA needs normalized source cells');
  let intersection = 0,
    union = 0;
  for (let i = 3; i < master.data.length; i += 4) {
    const a = master.data[i]! >= 128,
      b = edited.data[i]! >= 128;
    if (a || b) union++;
    if (a && b) intersection++;
  }
  if (!union) throw new Error('variant QA: empty silhouette');
  let maxJointDistancePx = 0;
  for (const joint of POSE_JOINTS) {
    const a = annotation.master?.[joint],
      b = annotation.edited?.[joint];
    validatePoint(a);
    validatePoint(b);
    maxJointDistancePx = Math.max(maxJointDistancePx, Math.hypot(a!.x - b!.x, a!.y - b!.y));
  }
  if ('occluded' in annotation.face) {
    if (!annotation.face.occluded.trim()) throw new Error('variant QA: face occlusion needs a reason');
    return {
      cell,
      silhouetteIou: intersection / union,
      maxJointDistancePx,
      faceSimilarity: null,
      faceOcclusion: annotation.face.occluded,
    };
  }
  const r = annotation.face.rect;
  if (
    !r ||
    ![r.x, r.y, r.width, r.height].every(Number.isInteger) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width <= 0 ||
    r.height <= 0 ||
    r.x + r.width > CELL_PX ||
    r.y + r.height > CELL_PX
  )
    throw new Error('variant QA: face rectangle outside source cell');
  let difference = 0,
    pixels = 0,
    masterOpaque = 0,
    editedOpaque = 0;
  for (let y = r.y; y < r.y + r.height; y++)
    for (let x = r.x; x < r.x + r.width; x++) {
      const i = (y * CELL_PX + x) * 4,
        a = master.data[i + 3]! / 255,
        b = edited.data[i + 3]! / 255;
      if (a > 0) masterOpaque++;
      if (b > 0) editedOpaque++;
      if (!a && !b) continue;
      pixels++;
      for (let k = 0; k < 3; k++) difference += Math.abs(master.data[i + k]! * a - edited.data[i + k]! * b);
      difference += Math.abs(a - b) * 255;
    }
  const faceSimilarity = !masterOpaque || !editedOpaque ? 0 : 1 - difference / (pixels * 4 * 255);
  return { cell, silhouetteIou: intersection / union, maxJointDistancePx, faceSimilarity };
}

function sourceCells(project: Project, clip: ProjectClip, baseDir: string, guides?: Guides) {
  const bytes = readFileSync(resolve(baseDir, clip.sheet));
  const raw = decodePng(bytes);
  const grid = sheetLayout(clip);
  const normalized = normalizeSheetDpi(raw, grid.cols, grid.frames).image;
  const straight = toStraight(normalized);
  const indices = clip.sheetSelection?.cells ?? Array.from({ length: clip.frames }, (_, i) => i);
  const cells = indices.map((i) => {
    const r = cellRect(straight.width, straight.height, clip.cols, grid.rows, i);
    return keyOut(crop(straight, r.x, r.y, r.width, r.height), project.slice);
  });
  // Fixed authored scale must agree in output cell units even when raw sheets have different DPI.
  if (clip.calibration && clip.calibration.scale === undefined)
    throw new Error('variant QA needs explicit fixed calibration.scale, not inferred reference frames/heights');
  const scale =
    clip.calibration?.scale ?? (project.preparation ? preparationScale(project.preparation, baseDir) : project.scale);
  if (scale === undefined || !Number.isFinite(scale) || scale <= 0)
    throw new Error('variant QA needs a locked explicit scale');
  const renderSheet = project.preparation ? decodePng(encodePng(normalized)) : raw;
  const first = cellRect(renderSheet.width, renderSheet.height, grid.cols, grid.rows, 0);
  const inset = Math.round(Math.min(first.width, first.height) * (project.slice?.inset ?? 0.01));
  const alignmentOrigins = guides
    ? selectSheetCells(sliceSheet(renderSheet, grid, project.slice), clip.sheetSelection).map((f) => {
        const m = measureFigure(toPremultiplied(f.image));
        if (!m) throw new Error('variant master alignment frame is empty');
        return {
          x: m.pelvisX * scale,
          y:
            ((clip.vertical ?? 'sole') === 'sole' ? m.bottom : (guides.ground / CELL_PX) * first.height - inset) *
            scale,
        };
      })
    : [];
  return {
    bytes,
    cells,
    alignmentOrigins,
    outputCell: scale * (project.preparation ? CELL_PX : raw.width / clip.cols),
  };
}

/** Validates every variant clip, pins master bytes, and records all passing/failing metrics. */
export function auditProjectVariant(project: Project, baseDir: string): VariantAudit | undefined {
  const v = project.variant;
  if (!v) {
    if (project.clips.some((c) => c.variant)) throw new Error('variant references require project.variant');
    return undefined;
  }
  const t = v.thresholds;
  if (
    v.kind !== 'edit-from-master-v1' ||
    !['tier', 'costume'].includes(v.category) ||
    !v.id?.trim() ||
    !v.edit?.tool?.trim() ||
    !v.edit.prompt?.trim() ||
    !t ||
    ![t.minSilhouetteIou, t.minFaceSimilarity].every((n) => Number.isFinite(n) && n > 0 && n <= 1) ||
    !Number.isFinite(t.maxJointDistancePx) ||
    t.maxJointDistancePx < 0
  )
    throw new Error('variant project requires edit provenance and explicit finite QA thresholds');
  const masterPath = resolve(baseDir, v.masterProject);
  const masterBytes = readFileSync(masterPath);
  verifyHash(masterBytes, v.masterProjectSha256, 'master project');
  const master = JSON.parse(masterBytes.toString('utf8')) as Project;
  const masterImageBytes = readFileSync(resolve(dirname(masterPath), master.master));
  verifyHash(masterImageBytes, v.masterImageSha256, 'T1 master image');
  verifyHash(readFileSync(resolve(baseDir, project.master)), v.masterImageSha256, 'variant master image');
  const decodedMaster = decodePng(masterImageBytes);
  const normalizedMaster =
    decodedMaster.width === CELL_PX && decodedMaster.height === CELL_PX
      ? decodedMaster
      : resizeImage(decodedMaster, CELL_PX, CELL_PX);
  const masterMetrics = measureFigure(normalizedMaster);
  if (!masterMetrics) throw new Error('variant master image is empty');
  const guides = guidesFromMaster(masterMetrics);
  if (master.preparation)
    verifyHash(
      readFileSync(resolve(dirname(masterPath), master.preparation.calibration)),
      v.masterCalibrationSha256 ?? '',
      'master calibration',
    );
  if (master.variant || master.character !== project.character || master.direction !== project.direction)
    throw new Error('variant source must be the same character/direction T1 master project');
  if (canonical(project.slice ?? {}) !== canonical(master.slice ?? {}))
    throw new Error('variant changed master slicing controls');
  if (
    project.clips.length !== master.clips.length ||
    new Set(project.clips.map((c) => c.name)).size !== project.clips.length ||
    master.clips.some((c) => !project.clips.some((v) => v.name === c.name))
  )
    throw new Error('variant changed master clip set');
  const findings: Finding[] = [];
  const clips = project.clips.map((clip) => {
    const ref = clip.variant;
    const sources = master.clips.filter((c) => c.name === clip.name);
    if (!ref || sources.length !== 1)
      throw new Error(`variant '${clip.name}' needs one master clip and a hashed reference`);
    const source = sources[0]!;
    if (
      motionControls(source) !== motionControls(clip) ||
      templateControls(source, dirname(masterPath)) !== templateControls(clip, baseDir)
    )
      throw new Error(`variant '${clip.name}' changed master motion/timing`);
    const a = sourceCells(master, source, dirname(masterPath), guides),
      b = sourceCells(project, clip, baseDir);
    verifyHash(a.bytes, ref.masterSheetSha256, `master sheet '${clip.name}'`);
    if (Math.abs(a.outputCell - b.outputCell) > 1e-9)
      throw new Error(`variant '${clip.name}' changed locked output scale`);
    const annotationBytes = readFileSync(resolve(baseDir, ref.annotations));
    const annotations = JSON.parse(annotationBytes.toString('utf8')) as VariantCellAnnotation[];
    if (!Array.isArray(annotations) || annotations.length !== clip.frames)
      throw new Error(`variant '${clip.name}' needs annotations for every cell`);
    const metrics = a.cells.map((image, i) => {
      const m = compareVariantCell(image, b.cells[i]!, annotations[i]!, i);
      const fail = (gate: 'poseLock' | 'faceLock', metric: string, value: number, limit: number) =>
        findings.push({
          gate,
          severity: 'fail',
          clip: clip.name,
          frame: i,
          metric,
          value,
          limit,
          message: `variant ${metric}: ${value} (limit ${limit})`,
        });
      if (m.silhouetteIou < t.minSilhouetteIou) fail('poseLock', 'silhouette_iou', m.silhouetteIou, t.minSilhouetteIou);
      if (m.maxJointDistancePx > t.maxJointDistancePx)
        fail('poseLock', 'joint_distance_px', m.maxJointDistancePx, t.maxJointDistancePx);
      if (m.faceSimilarity === null) {
        if (!['N', 'NE'].includes(project.direction))
          throw new Error('face occlusion only supported for rear-facing N/NE cells');
        findings.push({
          gate: 'faceLock',
          severity: 'info',
          clip: clip.name,
          frame: i,
          measurement: 'unmeasured',
          message: `face occluded: ${m.faceOcclusion}`,
        });
      } else if (m.faceSimilarity < t.minFaceSimilarity)
        fail('faceLock', 'face_similarity', m.faceSimilarity, t.minFaceSimilarity);
      return m;
    });
    return {
      name: clip.name,
      masterSheetSha256: hash(a.bytes),
      editedSheetSha256: hash(b.bytes),
      annotationsSha256: hash(annotationBytes),
      alignmentOrigins: a.alignmentOrigins,
      metrics,
    };
  });
  return { source: v, clips, findings };
}
