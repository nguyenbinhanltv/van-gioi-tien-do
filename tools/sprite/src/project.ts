/**
 * The whole pipeline for one character direction, driven by a project description:
 *   master + raw sheets -> slice -> palette lock -> ONE calibration -> align -> pack -> export -> QA -> contract JSON.
 * Pure of the file system except for reading the inputs named in the project (relative to `baseDir`) and, in `writeOutputs`,
 * writing the results; every number is deterministic.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type AnimationId } from '@vgtd/character';
import { decodePng, encodePng, type Image } from '@vgtd/rig';
import type { Direction } from '@vgtd/shared';
import { alignFrame, calibrate, type AlignedFrame, type Calibration, type FrameRecord } from './align.js';
import { buildArmature, type ClipInput, type TimingProfile } from './export.js';
import { selectSheetCells, sheetLayout, type SheetSelection } from './grouped.js';
import { facingGroundVector, groundPxPerFrame, groundSpeedPxS } from './gait.js';
import { guidesFromMaster, measureFigure } from './master.js';
import { packFrames } from './pack.js';
import { lockPalette, paletteFromMaster, type Color3, type LockOptions, type PaletteOptions } from './palette.js';
import { applyBacklog, loadBacklog, type BacklogReport } from './backlog.js';
import { runQa, type Finding, type QaClip } from './qa.js';
import { resizeImage } from './repair.js';
import {
  nativeCellTransform,
  normalizeSheetDpi,
  preparationScale,
  type ProjectPreparation,
  type SheetPreparation,
} from './preparation.js';
import { toPremultiplied } from './raster.js';
import { cellRect, sliceSheet, type SliceOptions } from './slice.js';
import { applyContacts, type Contacts } from './template.js';
import { CELL_PX, type CellSpec, type Guides, type MasterMetrics, type TemplateManifest } from './types.js';
import { auditProjectVariant, type VariantProject, type VariantReference, type VariantAudit } from './variant.js';
import {
  headLandmarkSize,
  validRearBreadthMaster,
  type HeadEvidence,
  type HeadLandmarks,
  type HeightPolicy,
} from './head-evidence.js';

import { authoredOriginPoint, validateAuthoredOrigins, type AuthoredOrigin } from './authored-origin.js';
import { validateResample, type ResampleMethod } from './resample.js';
import { verifyInheritedRegistration, type InheritedRegistration } from './inherited-registration.js';

export interface ProjectClip {
  readonly inheritedRegistration?: InheritedRegistration;
  readonly timingProfile?: TimingProfile;
  readonly authoredOrigins?: Readonly<Record<string, AuthoredOrigin>>;
  readonly heightPolicy?: HeightPolicy;
  /** Clip-local frame indices; coordinates in the aligned 256px output cell. */
  readonly headEvidence?: Readonly<Record<string, HeadEvidence>>;
  readonly variant?: VariantReference;
  /** Armature animation name. */
  readonly name: string;
  /** Raw sheet PNG, relative to the project file. */
  readonly sheet: string;
  readonly cols: number;
  /** Frames (cells in use). */
  readonly frames: number;
  /** Explicit cells from a shared sheet; absent preserves the legacy contiguous layout. */
  readonly sheetSelection?: SheetSelection;
  /** Template manifest JSON of this sheet (foot ghosts, leading legs); optional. */
  readonly manifest?: string;
  readonly tableId?: AnimationId;
  /** Table frame numbers of the named phases (hit_frame, combo_window ...). */
  readonly phases?: Readonly<Record<string, number>>;
  readonly durationSec: number;
  readonly loop: boolean;
  /** `upright` clips are height-gated; `free` clips (die, hit, cast ...) declare their exceptions. Default upright. */
  readonly kind?: 'upright' | 'free';
  /** Use this clip's frames for the character calibration (default: every upright clip without its own `calibration`). */
  readonly reference?: boolean;
  /**
   * A FIXED scale for every frame of THIS sheet (a sheet may be generated at another DPI than the others). One of:
   * `scale` (raw px -> canvas px), `referenceHeight` (raw px of the upright figure: scale = master height / it), or
   * `referenceFrames` (indices of upright frames whose median raw height is that reference). Never per-frame.
   */
  readonly calibration?: {
    readonly scale?: number;
    readonly referenceHeight?: number;
    readonly referenceFrames?: readonly number[];
  };
  /** Frame index -> documented pose exception ('die-collapse', 'raised-sword' ...). Never rescaled. */
  readonly exceptions?: Readonly<Record<string, string>>;
  /** `sole` (default) or `keep` (airborne: keep the height above the template ground line). */
  readonly vertical?: 'sole' | 'keep';
  /** The ACTUAL planted-foot frames of the drawings; replaces the template's planted flags in the foot-slide gate. */
  readonly contacts?: Contacts;
  /** Ground speed (px/s, 1x screen) of the clip; default from the table for run / walk, none otherwise. */
  readonly groundSpeedPxS?: number;
  /** Explicit migration opt-out: report foot slide as unmeasured, preserving old baselines. */
  readonly footSlideUnmeasuredReason?: string;
}

export interface Project {
  /** Explicit smooth-v2 clock for every clip; legacy projects omit this. */
  readonly timingProfile?: TimingProfile;
  /** Omitted/bilinear preserves the legacy two-pass path byte-for-byte. */
  readonly resample?: ResampleMethod;
  /** Direction-specific skull landmarks on the resized256px master; excludes secondary hair. */
  readonly masterHead?: HeadLandmarks;
  readonly variant?: VariantProject;
  readonly character: string;
  readonly direction: Direction;
  /** Quality backlog file (accepted soft findings), relative to the project file. Default `quality-backlog.json` beside it. */
  readonly backlog?: string;
  /** Output stem: files are `<stem>_<DIR>_ske.json` ... */
  readonly stem: string;
  /** Master image (any square size; resized to the 256 cell). */
  readonly master: string;
  readonly palette?: PaletteOptions & LockOptions & { readonly lock?: boolean };
  readonly slice?: SliceOptions;
  /** Explicit calibration scale; default: from the reference clips. */
  readonly scale?: number;
  /** Explicit whole-grid DPI normalization followed by a locked character scale. */
  readonly preparation?: ProjectPreparation;
  readonly clips: readonly ProjectClip[];
}

export interface ClipContract {
  readonly inheritedRegistration?: InheritedRegistration;
  readonly authoredOrigins?: Readonly<Record<string, AuthoredOrigin>>;
  readonly heightPolicy?: HeightPolicy;
  readonly headEvidence?: Readonly<Record<string, HeadEvidence>>;
  readonly name: string;
  readonly frames: number;
  readonly kind: 'upright' | 'free';
  readonly sheetSha1: string;
  readonly sheetSelection?: SheetSelection;
  /** Present only for explicitly prepared source sheets. */
  readonly preparation?: SheetPreparation & { readonly rawSha1: string };
  /** The fixed scale this sheet was aligned with (the character calibration unless the sheet has its own). */
  readonly calibration: Calibration;
  readonly records: readonly (FrameRecord | null)[];
  readonly regions: readonly string[];
}

export interface Contract {
  readonly resample?: ResampleMethod;
  readonly variant?: VariantAudit;
  readonly format: 'vgtd-sprite-contract';
  readonly version: 1;
  readonly character: string;
  readonly direction: Direction;
  readonly stem: string;
  readonly master: {
    readonly sha1: string;
    readonly metrics: MasterMetrics;
    readonly guides: Guides;
    readonly head?: HeadLandmarks;
  };
  /** Character-wide calibration (null when every sheet carries its own). */
  readonly calibration: Calibration | null;
  readonly palette: { readonly size: number; readonly locked: boolean };
  readonly atlas: {
    readonly pages: number;
    readonly width: number;
    readonly height: number;
    readonly regions: number;
    /** Resource stems (without .json/.png), primary first. Present only for multi-page exports. */
    readonly textures?: readonly string[];
  };
  readonly clips: readonly ClipContract[];
  /** `ok` = no hard failure, no unlisted soft finding, no regression of a listed one (see backlog.ts). */
  readonly qa: {
    readonly ok: boolean;
    readonly findings: readonly Finding[];
    readonly judged: BacklogReport['judged'];
    readonly resolved: BacklogReport['resolved'];
    readonly counts: BacklogReport['counts'];
  };
}

export interface ProjectResult {
  /** Opt-in in-memory aligned pixels; never serialized to the contract. */
  readonly alignedClips?: readonly { readonly name: string; readonly frames: readonly (Image | null)[] }[];
  readonly contract: Contract;
  readonly files: ReadonlyMap<string, Buffer | string>;
}

const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');
const pad = (i: number) => String(i + 1).padStart(2, '0');

/** Validate configuration without loading images; also used by the committed-project audit. */
export function validateFootSlideAlignment(
  project: Pick<Project, 'direction'>,
  clip: ProjectClip,
  cells?: readonly CellSpec[],
): void {
  if (clip.footSlideUnmeasuredReason !== undefined) {
    if (typeof clip.footSlideUnmeasuredReason !== 'string' || !clip.footSlideUnmeasuredReason.trim())
      throw new Error(`clip '${clip.name}': footSlideUnmeasuredReason must be a nonempty explanation`);
    return;
  }
  const speed = clip.groundSpeedPxS ?? groundSpeedPxS(clip.tableId, project.direction) ?? undefined;
  if (facingGroundVector(project.direction).y !== 0 && cells?.length && speed !== undefined && clip.vertical !== 'keep')
    throw new Error(
      `clip '${clip.name}' (${project.direction}): measured ground travel has a y component; set vertical: "keep" to preserve it`,
    );
}

export function runProject(
  project: Project,
  baseDir: string,
  options: { readonly includeAlignedFrames?: boolean } = {},
): ProjectResult {
  const resample = project.resample ?? 'bilinear';
  validateResample(resample);
  for (const clip of project.clips)
    if (clip.heightPolicy !== undefined && clip.heightPolicy !== 'head-size-v1')
      throw new Error(`unknown height policy '${clip.heightPolicy}'`);
  for (const clip of project.clips) validateAuthoredOrigins(clip);
  const variant = auditProjectVariant(project, baseDir);
  const scale = project.preparation ? preparationScale(project.preparation, baseDir) : project.scale;
  if (project.preparation && project.scale !== undefined && project.scale !== scale)
    throw new Error('non-reproducible project: explicit scale conflicts with preparation calibration');
  const masterBuf = readFileSync(resolve(baseDir, project.master));
  let master: Image = decodePng(masterBuf);
  if (master.width !== CELL_PX || master.height !== CELL_PX) master = resizeImage(master, CELL_PX, CELL_PX);
  const m = measureFigure(master);
  if (!m) throw new Error('the master image is empty');
  if (project.masterHead?.kind === 'rear-base-ornament' && project.direction !== 'N')
    throw new Error('rear ornament master is allowed only for N direction projects');
  if (
    (project.masterHead?.kind === 'rear-skull-base' ||
      project.masterHead?.kind === 'rear-breadth-only' ||
      project.masterHead?.kind === 'rear-span-only' ||
      project.masterHead?.kind === 'rear-crown-shoulder' ||
      project.masterHead?.kind === 'rear-crown-shoulder-single') &&
    !['NE', 'N'].includes(project.direction)
  )
    throw new Error('rear skull master is allowed only for NE/N direction projects');
  if (
    project.masterHead !== undefined &&
    (project.masterHead.kind === 'rear-breadth-only'
      ? !validRearBreadthMaster(project.masterHead, master)
      : headLandmarkSize(project.masterHead, master.width, master.height) === null)
  )
    throw new Error('invalid master skull landmarks/breadth');
  const guides = guidesFromMaster(m);
  const palette: Color3[] = paletteFromMaster(master, project.palette);
  const lock = project.palette?.lock !== false;

  // 1. slice + palette lock every sheet (spill cleanup keeps the master palette colours)
  const sliceOptions: SliceOptions | undefined = project.slice?.spill
    ? { ...project.slice, spill: { palette, ...project.slice.spill } }
    : project.slice;
  const sliced = project.clips.map((c) => {
    const buf = readFileSync(resolve(baseDir, c.sheet));
    const inherited = c.inheritedRegistration
      ? verifyInheritedRegistration(c.inheritedRegistration, buf, c, baseDir)
      : undefined;
    if (inherited && (project.variant || c.variant))
      throw new Error('inherited-registration cannot be combined with variants');
    const raw = decodePng(buf);
    const grid = sheetLayout(c);
    const deferred = !!project.preparation && resample !== 'bilinear';
    const prepared = project.preparation
      ? normalizeSheetDpi(raw, grid.cols, grid.frames, deferred ? { resample, defer: true } : {})
      : undefined;
    // The original assembler writes then reads a PNG: retain its PMA quantization exactly.
    const preparedBuf = prepared ? encodePng(prepared.image) : buf;
    const sheet = prepared ? decodePng(preparedBuf) : raw;
    const frames = selectSheetCells(sliceSheet(sheet, grid, sliceOptions), c.sheetSelection).map((f) =>
      lock ? { ...f, image: lockPalette(f.image, palette, project.palette).image } : f,
    );
    const referencePrepared =
      inherited && project.preparation
        ? normalizeSheetDpi(
            decodePng(inherited.source),
            grid.cols,
            grid.frames,
            deferred ? { resample, defer: true } : {},
          )
        : undefined;
    if (referencePrepared && JSON.stringify(referencePrepared.record) !== JSON.stringify(prepared!.record))
      throw new Error('inherited-registration: preparation/crop changed');
    const referenceFrames = inherited
      ? selectSheetCells(
          sliceSheet(
            referencePrepared ? decodePng(encodePng(referencePrepared.image)) : decodePng(inherited.source),
            grid,
            sliceOptions,
          ),
          c.sheetSelection,
        ).map((f) => (lock ? { ...f, image: lockPalette(f.image, palette, project.palette).image } : f))
      : undefined;
    // Only declared inherited cells may contribute their pre-edit measurements.
    const calibrationFrames = frames.map((frame, i) => (inherited?.verified.has(i) ? referenceFrames![i]! : frame));
    const rows = grid.rows;
    const logicalWidth = deferred ? prepared!.record.normalized[0] : sheet.width;
    const logicalHeight = deferred ? prepared!.record.normalized[1] : sheet.height;
    const r0 = cellRect(logicalWidth, logicalHeight, c.cols, rows, 0);
    const inset = Math.round(Math.min(r0.width, r0.height) * (project.slice?.inset ?? 0.01));
    const transforms = deferred
      ? (c.sheetSelection?.cells ?? Array.from({ length: c.frames }, (_, i) => i)).map((i) =>
          nativeCellTransform(
            sheet.width,
            sheet.height,
            logicalWidth,
            logicalHeight,
            c.cols,
            rows,
            i,
            project.slice?.inset,
          ),
        )
      : undefined;
    const groundY = (guides.ground / CELL_PX) * r0.height - inset;
    return {
      clip: c,
      inherited,
      referenceFrames,
      calibrationFrames,
      frames,
      sheetSha1: sha1(preparedBuf),
      groundY,
      sourceCell: { width: r0.width, height: r0.height, inset },
      transforms,
      preparation: prepared ? { ...prepared.record, rawSha1: sha1(buf) } : undefined,
    };
  });

  // 2. calibration: one per character, unless a sheet declares its own FIXED scale (different generation DPI)
  const own = (c: ProjectClip) => c.calibration !== undefined;
  const refs = sliced.filter((s) => !own(s.clip) && (s.clip.reference ?? (s.clip.kind ?? 'upright') === 'upright'));
  const rawHeight = (f: { image: Parameters<typeof measureFigure>[0] }) => measureFigure(f.image)?.height ?? 0;
  let character: Calibration | null = null;
  if (scale !== undefined) {
    character = {
      scale,
      targetHeight: m.height,
      referenceHeight: m.height / scale,
      referenceFrames: 0,
    };
  } else if (sliced.some((s) => !own(s.clip))) {
    character = calibrate(
      m.height,
      refs.flatMap((s) => s.calibrationFrames.map((f) => rawHeight(f) * (s.transforms?.[0]?.scaleY ?? 1))),
    );
  }
  const sheetCalibration = (s: (typeof sliced)[number]): Calibration => {
    const c = s.clip.calibration;
    if (!c) return character!;
    if (c.scale !== undefined)
      return { scale: c.scale, targetHeight: m.height, referenceHeight: m.height / c.scale, referenceFrames: 0 };
    if (c.referenceHeight !== undefined) return calibrate(m.height, [c.referenceHeight]);
    const idx = c.referenceFrames ?? [];
    const hs = idx
      .map((i) => s.calibrationFrames[i])
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => rawHeight(f) * (s.transforms?.[0]?.scaleY ?? 1));
    if (!hs.length)
      throw new RangeError(`clip '${s.clip.name}': calibration needs scale, referenceHeight or referenceFrames`);
    return calibrate(m.height, hs);
  };

  // 3. align (translation only) + records
  const aligned = sliced.map((s) => {
    const sourceManifest: TemplateManifest | null = s.clip.manifest
      ? (JSON.parse(readFileSync(resolve(baseDir, s.clip.manifest), 'utf8')) as TemplateManifest)
      : null;
    if (
      sourceManifest &&
      s.clip.sheetSelection &&
      (sourceManifest.grid.cols !== s.clip.cols || sourceManifest.grid.rows !== s.clip.sheetSelection.rows)
    )
      throw new Error(`clip '${s.clip.name}': shared manifest grid does not match sheetSelection`);
    const manifest =
      sourceManifest && s.clip.sheetSelection
        ? {
            ...sourceManifest,
            cells: selectSheetCells(sourceManifest.cells, s.clip.sheetSelection),
            frames: s.clip.frames,
          }
        : sourceManifest;
    const speed = s.clip.groundSpeedPxS ?? groundSpeedPxS(s.clip.tableId, project.direction) ?? undefined;
    validateFootSlideAlignment(project, s.clip, manifest?.cells);
    const calibration = sheetCalibration(s);
    const origins = variant?.clips.find((c) => c.name === s.clip.name)?.alignmentOrigins;
    return {
      ...s,
      manifest,
      speed,
      calibration,
      aligned: s.frames.map((f, i): AlignedFrame | null => {
        const authored = s.clip.authoredOrigins?.[i];
        const transform = s.transforms?.[i];
        const originOf = (image: typeof f.image) => {
          const metrics = authored ? measureFigure(toPremultiplied(image)) : null;
          return authored && metrics
            ? authoredOriginPoint(
                authored,
                s.sourceCell.width,
                s.sourceCell.height,
                s.sourceCell.inset,
                (s.clip.vertical ?? 'sole') === 'sole'
                  ? metrics.bottom * (transform?.scaleY ?? 1) + (transform?.dy ?? 0)
                  : s.groundY,
              )
            : undefined;
        };
        const origin = originOf(f.image);
        const inheritedCell = s.inherited?.verified.get(i);
        // D57 + authored origin: a repaired cell must inherit the SAME declared origin as its pre-edit source cell.
        const sourceAuthored = inheritedCell && authored ? originOf(s.referenceFrames![i]!.image) : undefined;
        if (
          inheritedCell &&
          authored &&
          (!origin || !sourceAuthored || origin.x !== sourceAuthored.x || origin.y !== sourceAuthored.y)
        )
          throw new Error(
            `inherited-registration: authored origin of cell ${i} differs from its pre-edit source cell` +
              (origin && sourceAuthored
                ? ` (edited ${origin.x},${origin.y}; source ${sourceAuthored.x},${sourceAuthored.y})`
                : ''),
          );
        const reference = inheritedCell
          ? alignFrame(s.referenceFrames![i]!.image, {
              ...(sourceAuthored ? { referenceOrigin: sourceAuthored } : {}),
              ...(resample !== 'bilinear' ? { resample } : {}),
              ...(transform ? { sourceTransform: transform } : {}),
              calibration,
              guides,
              vertical: s.clip.vertical ?? 'sole',
              groundY: s.groundY,
            })
          : undefined;
        if (inheritedCell && !reference) throw new Error('inherited-registration: empty source cell');
        const inheritedOrigin = sourceAuthored
          ? sourceAuthored
          : reference
            ? {
                x: reference.source.pelvisX,
                y: (s.clip.vertical ?? 'sole') === 'sole' ? reference.source.bottom : s.groundY,
              }
            : undefined;
        const result = alignFrame(f.image, {
          ...(resample !== 'bilinear' ? { resample } : {}),
          ...(transform ? { sourceTransform: transform } : {}),
          calibration,
          guides,
          vertical: s.clip.vertical ?? 'sole',
          groundY: s.groundY,
          ...(inheritedOrigin
            ? { referenceOrigin: inheritedOrigin }
            : origins
              ? { referenceOrigin: { x: origins[i]!.x / calibration.scale, y: origins[i]!.y / calibration.scale } }
              : origin
                ? { referenceOrigin: origin }
                : {}),
          ...(s.clip.exceptions?.[i] ? { exception: s.clip.exceptions[i]! } : {}),
        });
        if (!result || !inheritedCell || !inheritedOrigin) return result;
        return {
          ...result,
          record: {
            ...result.record,
            inheritedRegistration: {
              kind: 'inherited-registration',
              sourceSha256: s.inherited!.sourceSha256,
              maskSha256: s.inherited!.maskSha256,
              editedSha256: s.inherited!.editedSha256,
              ...inheritedCell,
              origin: inheritedOrigin,
              scale: calibration.scale,
              vertical: s.clip.vertical ?? 'sole',
            },
          },
        };
      }),
    };
  });

  // 4. pack + export
  const inputs = aligned.flatMap((s) =>
    s.aligned.flatMap((a, i) => (a ? [{ name: `${s.clip.name}_${pad(i)}`, image: a.image }] : [])),
  );
  const name = `${project.stem}_${project.direction}`;
  const textureStem = (page: number) => (page === 0 ? `${name}_tex` : `${name}_page${page}_tex`);
  const pack = packFrames(inputs, (page) => `${textureStem(page)}.png`);
  const clipInputs: ClipInput[] = aligned.map((s) => ({
    ...((s.clip.timingProfile ?? project.timingProfile)
      ? { timingProfile: s.clip.timingProfile ?? project.timingProfile }
      : {}),
    name: s.clip.name,
    frames: s.aligned.flatMap((a, i) => (a ? [`${s.clip.name}_${pad(i)}`] : [])),
    durationSec: s.clip.durationSec,
    loop: s.clip.loop,
    ...(s.clip.tableId ? { tableId: s.clip.tableId } : {}),
    ...(s.clip.phases ? { phases: s.clip.phases } : {}),
  }));
  const built = buildArmature({
    id: `${project.character}_${project.direction}`,
    direction: project.direction,
    clips: clipInputs,
    pack,
    name,
  });

  // 5. QA
  const qaClips: QaClip[] = aligned.map((s) => {
    const { manifest, speed } = s;
    const cells: readonly CellSpec[] | undefined =
      manifest && s.clip.contacts ? applyContacts(manifest.cells, s.clip.contacts) : manifest?.cells;
    return {
      name: s.clip.name,
      ...(s.clip.heightPolicy ? { heightPolicy: s.clip.heightPolicy } : {}),
      ...(s.clip.headEvidence ? { headEvidence: s.clip.headEvidence } : {}),
      ...(s.clip.authoredOrigins ? { authoredOrigins: s.clip.authoredOrigins } : {}),
      direction: project.direction,
      ...(s.clip.footSlideUnmeasuredReason !== undefined
        ? { footSlideUnmeasuredReason: s.clip.footSlideUnmeasuredReason }
        : {}),
      loop: s.clip.loop,
      kind: s.clip.kind ?? 'upright',
      expectedFrames: s.clip.frames,
      frames: s.aligned,
      exceptions: Object.fromEntries(Object.entries(s.clip.exceptions ?? {}).map(([k, v]) => [Number(k), v])),
      ...(cells ? { cells } : {}),
      ...(speed !== undefined ? { groundPxPerFrame: groundPxPerFrame(speed, s.clip.durationSec, s.clip.frames) } : {}),
    };
  });
  const rawQa = runQa(qaClips, {
    masterHeight: m.height,
    master,
    guides,
    ...(project.masterHead ? { masterHead: project.masterHead } : {}),
  });
  const backlog = loadBacklog(resolve(baseDir, project.backlog ?? 'quality-backlog.json'), project.character);
  const originFindings: Finding[] = aligned.flatMap((s) =>
    s.aligned.flatMap((f, i) => {
      const e = s.clip.authoredOrigins?.[i];
      if (!e || !f) return [];
      const source = {
        x: (guides.centerX - f.record.dx) / s.calibration.scale,
        y: (guides.ground - f.record.dy) / s.calibration.scale,
      };
      return [
        {
          gate: 'authoredOrigin' as const,
          severity: 'info' as const,
          clip: s.clip.name,
          frame: i,
          originEvidence: { ...e, source, scale: s.calibration.scale, dx: f.record.dx, dy: f.record.dy },
          message: `reviewed authored origin (${e.kind ?? 'anatomical-pelvis'}): ${e.reason}; ${e.evidence}; source (${source.x}, ${source.y}), scale ${s.calibration.scale}, dx ${f.record.dx}, dy ${f.record.dy}`,
        },
      ];
    }),
  );
  const findings = [...rawQa.findings, ...originFindings, ...(variant?.findings ?? [])];
  const verdict = applyBacklog(findings, project.direction, backlog);
  const qa = {
    ok: verdict.ok,
    findings,
    judged: verdict.judged,
    resolved: verdict.resolved,
    counts: verdict.counts,
  };

  const page = built.atlas;
  const contract: Contract = {
    ...(resample !== 'bilinear' ? { resample } : {}),
    format: 'vgtd-sprite-contract',
    version: 1,
    ...(variant ? { variant } : {}),
    character: project.character,
    direction: project.direction,
    stem: project.stem,
    master: { sha1: sha1(masterBuf), metrics: m, guides, ...(project.masterHead ? { head: project.masterHead } : {}) },
    calibration: character,
    palette: { size: palette.length, locked: lock },
    atlas: {
      pages: pack.pages.length,
      width: page.width,
      height: page.height,
      regions: pack.pages.reduce((n, p) => n + p.data.regions.length, 0),
      ...(pack.pages.length > 1 ? { textures: pack.pages.map((_, i) => textureStem(i)) } : {}),
    },
    clips: aligned.map((s) => ({
      ...(s.clip.inheritedRegistration ? { inheritedRegistration: s.clip.inheritedRegistration } : {}),
      ...(s.clip.heightPolicy ? { heightPolicy: s.clip.heightPolicy } : {}),
      ...(s.clip.headEvidence ? { headEvidence: s.clip.headEvidence } : {}),
      ...(s.clip.authoredOrigins ? { authoredOrigins: s.clip.authoredOrigins } : {}),
      name: s.clip.name,
      frames: s.clip.frames,
      kind: s.clip.kind ?? 'upright',
      sheetSha1: s.sheetSha1,
      ...(s.clip.sheetSelection ? { sheetSelection: s.clip.sheetSelection } : {}),
      ...(s.preparation ? { preparation: s.preparation } : {}),
      calibration: s.calibration,
      records: s.aligned.map((a) => a?.record ?? null),
      regions: s.aligned.flatMap((a, i) => (a ? [`${s.clip.name}_${pad(i)}`] : [])),
    })),
    qa,
  };
  const files = new Map<string, Buffer | string>();
  files.set(`${name}_ske.json`, JSON.stringify(built.export.ske));
  pack.pages.forEach((p, i) => {
    files.set(`${textureStem(i)}.json`, JSON.stringify(built.textures[i]));
    files.set(`${textureStem(i)}.png`, encodePng(p.image, { premultiplied: true }));
  });
  files.set(`${name}.sprite.json`, JSON.stringify(contract, null, 2));
  return {
    contract,
    files,
    ...(options.includeAlignedFrames
      ? { alignedClips: aligned.map((s) => ({ name: s.clip.name, frames: s.aligned.map((f) => f?.image ?? null) })) }
      : {}),
  };
}

/** Write the result files into `outDir`. */
export function writeOutputs(result: ProjectResult, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const [file, data] of result.files) writeFileSync(join(outDir, file), data);
}
