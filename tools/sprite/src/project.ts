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
import { buildArmature, type ClipInput } from './export.js';
import { facingGroundVector, groundPxPerFrame, groundSpeedPxS } from './gait.js';
import { guidesFromMaster, measureFigure } from './master.js';
import { packFrames } from './pack.js';
import { lockPalette, paletteFromMaster, type Color3, type LockOptions, type PaletteOptions } from './palette.js';
import { applyBacklog, loadBacklog, type BacklogReport } from './backlog.js';
import { runQa, type Finding, type QaClip } from './qa.js';
import { resizeImage } from './repair.js';
import { cellRect, sliceSheet, type SliceOptions } from './slice.js';
import { applyContacts, type Contacts } from './template.js';
import { CELL_PX, type CellSpec, type Guides, type MasterMetrics, type TemplateManifest } from './types.js';

export interface ProjectClip {
  /** Armature animation name. */
  readonly name: string;
  /** Raw sheet PNG, relative to the project file. */
  readonly sheet: string;
  readonly cols: number;
  /** Frames (cells in use). */
  readonly frames: number;
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
  readonly clips: readonly ProjectClip[];
}

export interface ClipContract {
  readonly name: string;
  readonly frames: number;
  readonly kind: 'upright' | 'free';
  readonly sheetSha1: string;
  /** The fixed scale this sheet was aligned with (the character calibration unless the sheet has its own). */
  readonly calibration: Calibration;
  readonly records: readonly (FrameRecord | null)[];
  readonly regions: readonly string[];
}

export interface Contract {
  readonly format: 'vgtd-sprite-contract';
  readonly version: 1;
  readonly character: string;
  readonly direction: Direction;
  readonly stem: string;
  readonly master: { readonly sha1: string; readonly metrics: MasterMetrics; readonly guides: Guides };
  /** Character-wide calibration (null when every sheet carries its own). */
  readonly calibration: Calibration | null;
  readonly palette: { readonly size: number; readonly locked: boolean };
  readonly atlas: { readonly pages: number; readonly width: number; readonly height: number; readonly regions: number };
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

export function runProject(project: Project, baseDir: string): ProjectResult {
  const masterBuf = readFileSync(resolve(baseDir, project.master));
  let master: Image = decodePng(masterBuf);
  if (master.width !== CELL_PX || master.height !== CELL_PX) master = resizeImage(master, CELL_PX, CELL_PX);
  const m = measureFigure(master);
  if (!m) throw new Error('the master image is empty');
  const guides = guidesFromMaster(m);
  const palette: Color3[] = paletteFromMaster(master, project.palette);
  const lock = project.palette?.lock !== false;

  // 1. slice + palette lock every sheet (spill cleanup keeps the master palette colours)
  const sliceOptions: SliceOptions | undefined = project.slice?.spill
    ? { ...project.slice, spill: { palette, ...project.slice.spill } }
    : project.slice;
  const sliced = project.clips.map((c) => {
    const buf = readFileSync(resolve(baseDir, c.sheet));
    const sheet = decodePng(buf);
    const frames = sliceSheet(
      sheet,
      { cols: c.cols, rows: Math.ceil(c.frames / c.cols), frames: c.frames },
      sliceOptions,
    ).map((f) => (lock ? { ...f, image: lockPalette(f.image, palette, project.palette).image } : f));
    const rows = Math.ceil(c.frames / c.cols);
    const r0 = cellRect(sheet.width, sheet.height, c.cols, rows, 0);
    const inset = Math.round(Math.min(r0.width, r0.height) * (project.slice?.inset ?? 0.01));
    const groundY = (guides.ground / CELL_PX) * r0.height - inset;
    return { clip: c, frames, sheetSha1: sha1(buf), groundY };
  });

  // 2. calibration: one per character, unless a sheet declares its own FIXED scale (different generation DPI)
  const own = (c: ProjectClip) => c.calibration !== undefined;
  const refs = sliced.filter((s) => !own(s.clip) && (s.clip.reference ?? (s.clip.kind ?? 'upright') === 'upright'));
  const rawHeight = (f: { image: Parameters<typeof measureFigure>[0] }) => measureFigure(f.image)?.height ?? 0;
  let character: Calibration | null = null;
  if (project.scale !== undefined) {
    character = {
      scale: project.scale,
      targetHeight: m.height,
      referenceHeight: m.height / project.scale,
      referenceFrames: 0,
    };
  } else if (sliced.some((s) => !own(s.clip))) {
    character = calibrate(
      m.height,
      refs.flatMap((s) => s.frames.map(rawHeight)),
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
      .map((i) => s.frames[i])
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map(rawHeight);
    if (!hs.length)
      throw new RangeError(`clip '${s.clip.name}': calibration needs scale, referenceHeight or referenceFrames`);
    return calibrate(m.height, hs);
  };

  // 3. align (translation only) + records
  const aligned = sliced.map((s) => {
    const manifest: TemplateManifest | null = s.clip.manifest
      ? (JSON.parse(readFileSync(resolve(baseDir, s.clip.manifest), 'utf8')) as TemplateManifest)
      : null;
    const speed = s.clip.groundSpeedPxS ?? groundSpeedPxS(s.clip.tableId, project.direction) ?? undefined;
    validateFootSlideAlignment(project, s.clip, manifest?.cells);
    const calibration = sheetCalibration(s);
    return {
      ...s,
      manifest,
      speed,
      calibration,
      aligned: s.frames.map((f, i): AlignedFrame | null =>
        alignFrame(f.image, {
          calibration,
          guides,
          vertical: s.clip.vertical ?? 'sole',
          groundY: s.groundY,
          ...(s.clip.exceptions?.[i] ? { exception: s.clip.exceptions[i]! } : {}),
        }),
      ),
    };
  });

  // 4. pack + export
  const inputs = aligned.flatMap((s) =>
    s.aligned.flatMap((a, i) => (a ? [{ name: `${s.clip.name}_${pad(i)}`, image: a.image }] : [])),
  );
  const name = `${project.stem}_${project.direction}`;
  const pack = packFrames(inputs, () => `${name}_tex.png`);
  const clipInputs: ClipInput[] = aligned.map((s) => ({
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
  const rawQa = runQa(qaClips, { masterHeight: m.height, master, guides });
  const backlog = loadBacklog(resolve(baseDir, project.backlog ?? 'quality-backlog.json'), project.character);
  const verdict = applyBacklog(rawQa.findings, project.direction, backlog);
  const qa = {
    ok: verdict.ok,
    findings: rawQa.findings,
    judged: verdict.judged,
    resolved: verdict.resolved,
    counts: verdict.counts,
  };

  const page = built.atlas;
  const contract: Contract = {
    format: 'vgtd-sprite-contract',
    version: 1,
    character: project.character,
    direction: project.direction,
    stem: project.stem,
    master: { sha1: sha1(masterBuf), metrics: m, guides },
    calibration: character,
    palette: { size: palette.length, locked: lock },
    atlas: { pages: pack.pages.length, width: page.width, height: page.height, regions: page.regions.length },
    clips: aligned.map((s) => ({
      name: s.clip.name,
      frames: s.clip.frames,
      kind: s.clip.kind ?? 'upright',
      sheetSha1: s.sheetSha1,
      calibration: s.calibration,
      records: s.aligned.map((a) => a?.record ?? null),
      regions: s.aligned.flatMap((a, i) => (a ? [`${s.clip.name}_${pad(i)}`] : [])),
    })),
    qa,
  };
  const files = new Map<string, Buffer | string>();
  files.set(`${name}_ske.json`, JSON.stringify(built.export.ske));
  files.set(`${name}_tex.json`, JSON.stringify(built.export.tex));
  files.set(`${name}_tex.png`, encodePng(pack.pages[0]!.image, { premultiplied: true }));
  files.set(`${name}.sprite.json`, JSON.stringify(contract, null, 2));
  return { contract, files };
}

/** Write the result files into `outDir`. */
export function writeOutputs(result: ProjectResult, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const [file, data] of result.files) writeFileSync(join(outDir, file), data);
}
