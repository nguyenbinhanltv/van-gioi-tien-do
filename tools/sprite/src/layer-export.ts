/** Canonical edit guides and independent body/weapon/quality-glow layer-set exports (D45). */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  assertVisualSetId,
  pivotOf,
  validateSpriteLayerSet,
  type SpriteLayerSet,
  type SpriteLayerRole,
} from '@vgtd/character';
import { createImage, decodePng, encodePng, exportTextureAtlas, type Image } from '@vgtd/rig';
import type { Project } from './project.js';
import { prepareLayerSources } from './layer-guides.js';
import { buildClip, spriteFrameRate, type ClipInput } from './export.js';
import {
  extractWeaponLayer,
  qualityGlowLayer,
  validateExtractionThresholds,
  type ExtractionCell,
  type ExtractionThresholds,
  type ExtractionMetrics,
} from './extract.js';
import { normalizeSheetDpi, type SheetPreparation } from './preparation.js';
import { cellRect, sliceSheet } from './slice.js';
import { toPremultiplied } from './raster.js';
import { packFrames } from './pack.js';
import { TEXTURE_SCALE } from './gait.js';
import { CELL_PX } from './types.js';
import type { Finding } from './qa.js';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const verify = (data: Buffer, expected: string, label: string) => {
  if (!/^[a-f0-9]{64}$/.test(expected) || hash(data) !== expected) throw new Error(`${label}: SHA256 mismatch`);
};
const pad = (i: number) => String(i + 1).padStart(2, '0');
function cellImage(sheet: Image, cols: number, rows: number, index: number): Image {
  const r = cellRect(sheet.width, sheet.height, cols, rows, index),
    out = createImage(r.width, r.height);
  for (let y = 0; y < r.height; y++)
    out.data.set(
      sheet.data.subarray(((r.y + y) * sheet.width + r.x) * 4, ((r.y + y) * sheet.width + r.x + r.width) * 4),
      y * r.width * 4,
    );
  return out;
}
export interface LayerExtractionProject {
  readonly format: 'vgtd-layer-extraction';
  readonly version: 1;
  readonly project: string;
  readonly projectSha256: string;
  readonly masterImageSha256: string;
  readonly motionId: string;
  readonly bodySet: string;
  readonly weaponSet: string;
  readonly fxSet: string;
  readonly glowRadiusPx: number;
  readonly thresholds: ExtractionThresholds;
  readonly clips: readonly {
    readonly name: string;
    readonly templateSha256: string;
    readonly bodySheet: string;
    readonly bodySheetSha256: string;
    readonly weaponMatte: string;
    readonly weaponMatteSha256: string;
    readonly edit: { readonly tool: string; readonly prompt: string };
    readonly cells: readonly ExtractionCell[];
  }[];
}
export interface BuiltLayerSet {
  readonly manifest: SpriteLayerSet;
  readonly files: ReadonlyMap<string, Buffer | string>;
}
export interface ExtractionClipRecord {
  readonly name: string;
  readonly fullSheetSha256: string;
  readonly templateSha256: string;
  readonly bodySheetSha256: string;
  readonly weaponMatteSha256: string;
  readonly bodyPreparation: SheetPreparation;
  readonly mattePreparation: SheetPreparation;
  readonly edit: { readonly tool: string; readonly prompt: string };
  readonly evidence: readonly ExtractionCell[];
  readonly metrics: readonly ExtractionMetrics[];
}

/** Export aligned cells into one independently loadable set; each atlas remains <= the shared page budget. */
export function buildSpriteLayerSet(input: {
  derivedFromWeapon?: string;
  id: string;
  role: SpriteLayerRole;
  direction: Project['direction'];
  motionId: string;
  clips: readonly {
    clock: Omit<ClipInput, 'frames'>;
    images: readonly Image[];
    orders: readonly ('front' | 'back')[];
  }[];
}): BuiltLayerSet {
  assertVisualSetId(input.id);
  const inputs = input.clips.flatMap(({ clock, images }) =>
    images.map((image, i) => ({ name: `${clock.name}_${pad(i)}`, image })),
  );
  const texture = (page: number) => `${input.id}_${input.direction}${page ? `_page${page}` : ''}_tex`;
  const pack = packFrames(inputs, (page) => `${texture(page)}.png`);
  const pivot = pivotOf(CELL_PX / TEXTURE_SCALE, CELL_PX / TEXTURE_SCALE);
  const manifest: SpriteLayerSet = {
    ...(input.derivedFromWeapon ? { derivedFromWeapon: input.derivedFromWeapon } : {}),
    format: 'vgtd-sprite-layer-set',
    version: 1,
    id: input.id,
    role: input.role,
    direction: input.direction,
    motionId: input.motionId,
    frameRate: spriteFrameRate(input.clips.map((c) => c.clock)),
    canvas: { width: CELL_PX / TEXTURE_SCALE, height: CELL_PX / TEXTURE_SCALE, pivotX: pivot.x, pivotY: pivot.y },
    textures: pack.pages.map((_, i) => texture(i)),
    displays: [...pack.trims].map(([name, r]) => ({
      name,
      region: name,
      x: (r.x + r.width / 2) / TEXTURE_SCALE - pivot.x,
      y: (r.y + r.height / 2) / TEXTURE_SCALE - pivot.y,
      width: r.width / TEXTURE_SCALE,
      height: r.height / TEXTURE_SCALE,
      textureWidth: r.width,
      textureHeight: r.height,
    })),
    clips: input.clips.map(({ clock, images, orders }) => {
      if (orders.length !== images.length) throw new Error('layer frame/order count mismatch');
      const clip = buildClip({ ...clock, frames: images.map((_, i) => `${clock.name}_${pad(i)}`) }),
        keys = clip.slots[0]!.attachment!;
      if (keys.length !== images.length) throw new Error('layer export would discard drawn frames on the rig clock');
      return {
        name: clip.name,
        duration: clip.frames,
        loop: clip.loop,
        events: clip.events.map((e) => ({ at: e.frame, name: e.name })),
        frames: keys.map((key, i) => ({
          at: key.frame,
          display: images[i]!.data.some((a, j) => j % 4 === 3 && a > 0) ? key.value : null,
          ...(input.role === 'weapon' ? { order: orders[i]! } : {}),
        })),
      };
    }),
  };
  validateSpriteLayerSet(manifest);
  const files = new Map<string, Buffer | string>();
  pack.pages.forEach((page, i) => {
    files.set(
      `${texture(i)}.json`,
      JSON.stringify(exportTextureAtlas(page.data, `${input.id}_${input.direction}${i ? `_page${i}` : ''}`)),
    );
    files.set(`${texture(i)}.png`, encodePng(page.image, { premultiplied: true }));
  });
  files.set(`${input.id}_${input.direction}.layer.json`, JSON.stringify(manifest, null, 2));
  return { manifest, files };
}

export function runLayerExtraction(spec: LayerExtractionProject, baseDir: string) {
  if (
    spec.format !== 'vgtd-layer-extraction' ||
    spec.version !== 1 ||
    !spec.motionId?.trim() ||
    new Set([spec.bodySet, spec.weaponSet, spec.fxSet]).size !== 3
  )
    throw new Error('invalid layered extraction project');
  [spec.bodySet, spec.weaponSet, spec.fxSet].forEach(assertVisualSetId);
  if (new Set([spec.bodySet, spec.weaponSet, spec.fxSet].map((id) => id.toLowerCase())).size !== 3)
    throw new Error('layer set IDs must not collide on a case-insensitive filesystem');
  validateExtractionThresholds(spec.thresholds);
  const projectPath = resolve(baseDir, spec.project),
    bytes = readFileSync(projectPath);
  verify(bytes, spec.projectSha256, 'source project');
  const source = prepareLayerSources(projectPath);
  verify(
    readFileSync(resolve(dirname(projectPath), source.project.master)),
    spec.masterImageSha256,
    'source master image',
  );
  if (
    spec.clips.length !== source.project.clips.length ||
    new Set(spec.clips.map((c) => c.name)).size !== spec.clips.length
  )
    throw new Error('extraction must cover the complete source clip set');
  const findings: Finding[] = [],
    records: ExtractionClipRecord[] = [];
  const bodyClips: Parameters<typeof buildSpriteLayerSet>[0]['clips'][number][] = [],
    weaponClips: typeof bodyClips = [],
    fxClips: typeof bodyClips = [];
  for (const clip of source.project.clips) {
    const edit = spec.clips.find((c) => c.name === clip.name),
      template = source.templates.find((t) => t.clips.some((c) => c.name === clip.name))!;
    if (!edit || edit.cells.length !== clip.frames || !edit.edit?.tool?.trim() || !edit.edit.prompt?.trim())
      throw new Error(`clip '${clip.name}' needs per-cell evidence and edit provenance`);
    if (template.sha256 !== edit.templateSha256)
      throw new Error(`clip '${clip.name}' canonical template SHA256 mismatch`);
    const bodyBytes = readFileSync(resolve(baseDir, edit.bodySheet)),
      matteBytes = readFileSync(resolve(baseDir, edit.weaponMatte));
    verify(bodyBytes, edit.bodySheetSha256, 'body-only edit');
    verify(matteBytes, edit.weaponMatteSha256, 'weapon matte');
    const preparedBody = normalizeSheetDpi(decodePng(bodyBytes), 4, 16),
      preparedMatte = normalizeSheetDpi(decodePng(matteBytes), 4, 16);
    const keyedBody = sliceSheet(
      preparedBody.image,
      { cols: 4, rows: 4, frames: 16 },
      {
        key: source.project.slice?.key,
        inner: source.project.slice?.inner,
        outer: source.project.slice?.outer,
        inset: 0,
        defringe: false,
        minArea: 0,
        keepFraction: 0,
      },
    );
    const original = decodePng(template.png),
      indices = template.clips.find((c) => c.name === clip.name)!.cells;
    const body: Image[] = [],
      weapon: Image[] = [],
      fx: Image[] = [],
      orders: ('front' | 'back')[] = [];
    const metrics = indices.map((cell, i) => {
      const result = extractWeaponLayer(
        cellImage(original, 4, 4, cell),
        toPremultiplied(keyedBody[cell]!.image),
        cellImage(preparedMatte.image, 4, 4, cell),
        edit.cells[i]!,
        spec.thresholds,
        { clip: clip.name, frame: i },
      );
      body.push(result.body);
      weapon.push(result.weapon);
      fx.push(qualityGlowLayer(result.weapon, spec.glowRadiusPx));
      orders.push(edit.cells[i]!.order);
      findings.push(...result.findings);
      return result.metrics;
    });
    const clock: ClipInput = {
      ...((clip.timingProfile ?? source.project.timingProfile)
        ? { timingProfile: clip.timingProfile ?? source.project.timingProfile }
        : {}),
      name: clip.name,
      frames: indices.map((_, i) => `${clip.name}_${pad(i)}`),
      durationSec: clip.durationSec,
      loop: clip.loop,
      ...(clip.tableId ? { tableId: clip.tableId } : {}),
      ...(clip.phases ? { phases: clip.phases } : {}),
    };
    bodyClips.push({ clock, images: body, orders });
    weaponClips.push({ clock, images: weapon, orders });
    fxClips.push({ clock, images: fx, orders });
    records.push({
      name: clip.name,
      fullSheetSha256: hash(readFileSync(resolve(dirname(projectPath), clip.sheet))),
      templateSha256: template.sha256,
      bodySheetSha256: hash(bodyBytes),
      weaponMatteSha256: hash(matteBytes),
      bodyPreparation: preparedBody.record,
      mattePreparation: preparedMatte.record,
      edit: edit.edit,
      evidence: edit.cells,
      metrics,
    });
  }
  const ok = !findings.some((f) => f.severity === 'fail');
  const sets = ok
    ? [
        buildSpriteLayerSet({
          id: spec.bodySet,
          role: 'body',
          direction: source.project.direction,
          motionId: spec.motionId,
          clips: bodyClips,
        }),
        buildSpriteLayerSet({
          id: spec.weaponSet,
          role: 'weapon',
          direction: source.project.direction,
          motionId: spec.motionId,
          clips: weaponClips,
        }),
        buildSpriteLayerSet({
          id: spec.fxSet,
          role: 'fx',
          derivedFromWeapon: spec.weaponSet,
          direction: source.project.direction,
          motionId: spec.motionId,
          clips: fxClips,
        }),
      ]
    : [];
  return {
    ok,
    sets,
    report: {
      format: 'vgtd-layer-extraction-report',
      version: 1,
      direction: source.project.direction,
      sets: { body: spec.bodySet, weapon: spec.weaponSet, fx: spec.fxSet },
      projectSha256: source.projectSha256,
      masterImageSha256: source.masterImageSha256,
      motionId: spec.motionId,
      thresholds: spec.thresholds,
      glowRadiusPx: spec.glowRadiusPx,
      clips: records,
      qa: { ok, findings },
    },
  };
}

export function writeLayerExtraction(result: ReturnType<typeof runLayerExtraction>, outDir: string): void {
  const reportName = `layer-report_${result.report.direction}.json`;
  if (
    existsSync(join(outDir, reportName)) ||
    Object.values(result.report.sets).some((id) =>
      existsSync(join(outDir, id, `${id}_${result.report.direction}.layer.json`)),
    )
  )
    throw new Error(
      'layer output already contains this direction; use a fresh attempt directory to avoid stale runtime sets',
    );
  mkdirSync(outDir, { recursive: true });
  const report = JSON.stringify(result.report, null, 2);
  writeFileSync(join(outDir, reportName), report);
  writeFileSync(join(outDir, 'layer-report.json'), report);
  if (!result.ok) return; // Diagnostic report is reviewable; failed layers are never published as runtime sets.
  for (const set of result.sets) {
    const dir = join(outDir, set.manifest.id);
    mkdirSync(dir, { recursive: true });
    for (const [file, data] of set.files) writeFileSync(join(dir, file), data);
  }
}
