import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createImage, decodePng, encodePng, type Image } from '@vgtd/rig';
import { composeSpriteLayers } from '@vgtd/character';
import { BUDGETS } from '@vgtd/shared';
import {
  prepareLayerSources,
  runLayerExtraction,
  toPremultiplied,
  writeLayerExtraction,
  buildSpriteLayerSet,
  CELL_PX,
  SMOOTH_CLIP_FPS,
  type ExtractionCell,
  type ExtractionThresholds,
  type LayerExtractionProject,
  type Project,
} from '../src/index.js';
import { makeMaster, makeSheet } from './helpers.js';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const thresholds: ExtractionThresholds = {
  differenceThreshold: 1,
  maxOutsideChangedPixels: 0,
  maxInpaintAreaPixels: 16,
  maxReconstructionChangedPixels: 0,
  maxMatteError: 1,
  minWeaponPixels: 1,
  maxAnchorDistancePx: 12,
  anchorRadiusPx: 2,
};
const evidence = (point = { x: 30, y: 30 }): ExtractionCell => ({
  order: 'front',
  visibility: 'visible',
  attachment: 'held',
  requiredAnchors: ['hand_R'],
  anchors: [{ name: 'hand_R', source: point, body: point, weapon: { x: point.x + 1, y: point.y } }],
  inpaint: [],
  note: 'Reviewed synthetic hand/contact and weapon order',
});
function rect(image: Image, x0: number, y0: number, x1: number, y1: number, rgba: number[]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.data.set(rgba, (y * image.width + x) * 4);
}
function projectFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vgtd-layers-'));
  writeFileSync(join(dir, 'master.png'), encodePng(makeMaster()));
  const sheet = makeSheet(
    2,
    1,
    256,
    [0, 1].map(() => ({ height: 208, cx: 128, sole: 232 })),
  );
  for (const col of [0, 1])
    for (let y = 160; y < 200; y++)
      for (let x = 172; x < 190; x++) sheet.data.set([180, 180, 190, 255], (y * 512 + col * 256 + x) * 4);
  writeFileSync(join(dir, 'full.png'), encodePng(toPremultiplied(sheet)));
  const project: Project = {
    character: 'test',
    direction: 'E',
    stem: 'test',
    master: 'master.png',
    scale: 1,
    palette: { lock: false },
    clips: [
      {
        name: 'attack',
        tableId: 'attack',
        phases: { windup_end: 3, hit_frame: 5, combo_window: 7 },
        sheet: 'full.png',
        cols: 2,
        frames: 1,
        sheetSelection: { rows: 1, cells: [1] },
        durationSec: 0.6,
        loop: false,
        kind: 'upright',
      },
      {
        name: 'idle',
        tableId: 'idle',
        sheet: 'full.png',
        cols: 2,
        frames: 1,
        sheetSelection: { rows: 1, cells: [0] },
        durationSec: 1,
        loop: false,
        kind: 'upright',
      },
    ],
  };
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
  const source = prepareLayerSources(join(dir, 'project.json'));
  const body = decodePng(source.templates[0]!.png),
    matte = createImage(body.width, body.height);
  for (const cell of [0, 1]) {
    rect(body, cell * 256 + 172, 160, cell * 256 + 190, 200, [0, 0, 0, 0]);
    rect(matte, cell * 256 + 172, 160, cell * 256 + 190, 200, [255, 255, 255, 255]);
  }
  const bodyBytes = encodePng(body),
    matteBytes = encodePng(matte);
  writeFileSync(join(dir, 'body.png'), bodyBytes);
  writeFileSync(join(dir, 'matte.png'), matteBytes);
  const contact: ExtractionCell = {
    ...evidence({ x: 164, y: 170 }),
    anchors: [{ name: 'hand_R', source: { x: 164, y: 170 }, body: { x: 164, y: 170 }, weapon: { x: 172, y: 170 } }],
  };
  const spec: LayerExtractionProject = {
    format: 'vgtd-layer-extraction',
    version: 1,
    project: 'project.json',
    projectSha256: source.projectSha256,
    masterImageSha256: source.masterImageSha256,
    motionId: 'test-t1-v2',
    bodySet: 'body_t1',
    weaponSet: 'weapon_t1',
    fxSet: 'weapon_t1_glow',
    glowRadiusPx: 2,
    thresholds,
    clips: project.clips.map((c) => ({
      name: c.name,
      templateSha256: source.templates[0]!.sha256,
      bodySheet: 'body.png',
      bodySheetSha256: sha(bodyBytes),
      weaponMatte: 'matte.png',
      weaponMatteSha256: sha(matteBytes),
      edit: { tool: 'synthetic-fixture', prompt: 'Remove weapon and preserve body pose/camera' },
      cells: [contact],
    })),
  };
  return { dir, project, spec, source };
}

describe('canonical layer authoring/export', () => {
  it('uses the same exact smooth clock for independent layers', () => {
    const image = createImage(1, 1);
    image.data.fill(255);
    const clips = [
      {
        clock: { name: 'idle', durationSec: 16 / SMOOTH_CLIP_FPS, loop: true, timingProfile: 'smooth-v2' as const },
        images: Array.from({ length: 16 }, () => image),
        orders: Array.from({ length: 16 }, () => 'front' as const),
      },
    ];
    const sets = (['body', 'weapon', 'fx'] as const).map((role) => {
      const result = buildSpriteLayerSet({ id: `test_${role}`, role, direction: 'E', motionId: 'test', clips });
      expect(result.manifest.frameRate).toBe(24);
      expect(result.manifest.clips[0]!.duration).toBe(16);
      expect(result.manifest.clips[0]!.loop).toBe(true);
      expect(result.manifest.clips[0]!.frames.map((f) => f.at)).toEqual(Array.from({ length: 16 }, (_, i) => i));
      return result.manifest;
    });
    const composed = composeSpriteLayers({ name: 'smooth', body: sets[0]!, weapon: sets[1]!, fx: sets[2]! });
    expect(composed.skeleton.frameRate).toBe(24);
    expect(composed.skeleton.armature[0]!.frameRate).toBe(24);
    expect(composed.skeleton.armature[0]!.animation[0]!.duration).toBe(16);
  });
  it('packs multiple budgeted pages without dropping drawings, and preserves hidden weapon keys', () => {
    const image = createImage(CELL_PX, CELL_PX);
    image.data.fill(255);
    const clips = ['idle', 'walk', 'run', 'cast'].map((name) => ({
      clock: { name, durationSec: 16 / SMOOTH_CLIP_FPS, loop: true },
      images: Array.from({ length: 16 }, () => image),
      orders: Array.from({ length: 16 }, () => 'front' as const),
    }));
    const body = buildSpriteLayerSet({ id: 'body_full', role: 'body', direction: 'E', motionId: 'test', clips });
    expect(body.manifest.textures.length).toBeGreaterThan(1);
    expect(body.manifest.clips.flatMap((c) => c.frames)).toHaveLength(64);
    for (const texture of body.manifest.textures) {
      const atlas = JSON.parse(body.files.get(`${texture}.json`) as string);
      expect(atlas.premultipliedAlpha).toBe(true);
      expect(atlas.width).toBeLessThanOrEqual(BUDGETS.ATLAS_MAX_WEB_MOBILE);
      expect(atlas.height).toBeLessThanOrEqual(BUDGETS.ATLAS_MAX_WEB_MOBILE);
    }
    expect(() =>
      buildSpriteLayerSet({
        id: 'too_fast',
        role: 'body',
        direction: 'E',
        motionId: 'test',
        clips: [{ ...clips[0]!, clock: { ...clips[0]!.clock, durationSec: 0.01 } }],
      }),
    ).toThrow(/discard drawn frames/);
    const hidden = buildSpriteLayerSet({
      id: 'hidden',
      role: 'weapon',
      direction: 'E',
      motionId: 'test',
      clips: [
        {
          clock: { name: 'idle', durationSec: 1, loop: true },
          images: [createImage(CELL_PX, CELL_PX), image],
          orders: ['back', 'front'],
        },
      ],
    });
    expect(hidden.manifest.clips[0]!.frames).toEqual([
      { at: 0, display: null, order: 'back' },
      { at: 15, display: 'idle_02', order: 'front' },
    ]);
  });
  it('preserves grouped cells and exports three compatible sets with the source event clock', () => {
    const { dir, spec, source } = projectFixture();
    expect(source.templates).toHaveLength(1);
    expect(source.templates[0]!.clips[0]!.cells).toEqual([1]);
    expect(decodePng(source.templates[0]!.png).width).toBe(1024);
    const result = runLayerExtraction(spec, dir);
    expect(result.ok).toBe(true);
    expect(result.sets).toHaveLength(3);
    const composed = composeSpriteLayers({
      name: 'export_check',
      body: result.sets[0]!.manifest,
      weapon: result.sets[1]!.manifest,
      fx: result.sets[2]!.manifest,
      glowTint: [1, 0, 0, 1],
    });
    expect(
      composed.skeleton.armature[0]!.animation[0]!.frame!.flatMap((f) => f.events ?? []).map((e) => e.name),
    ).toEqual(['hit', 'cancel_window']);
    expect(result.report.clips[0]!.evidence[0]!.anchors[0]!.name).toBe('hand_R');
    const out = join(dir, 'out');
    writeLayerExtraction(result, out);
    expect(existsSync(join(out, 'body_t1/body_t1_E.layer.json'))).toBe(true);
    expect(existsSync(join(out, 'weapon_t1_glow/weapon_t1_glow_E_tex.png'))).toBe(true);
  });
  it('pins references and writes diagnostics without runtime sets when extraction QA fails', () => {
    const { dir, spec } = projectFixture();
    expect(() => runLayerExtraction({ ...spec, projectSha256: '0'.repeat(64) }, dir)).toThrow(/SHA256/);
    expect(() => runLayerExtraction({ ...spec, masterImageSha256: '0'.repeat(64) }, dir)).toThrow(
      /source master image: SHA256/,
    );
    expect(() => runLayerExtraction({ ...spec, weaponSet: spec.bodySet.toUpperCase() }, dir)).toThrow(
      /case-insensitive/,
    );
    const masterBytes = readFileSync(join(dir, 'master.png')),
      changedMaster = decodePng(masterBytes);
    changedMaster.data[(40 * 256 + 128) * 4] = 100;
    writeFileSync(join(dir, 'master.png'), encodePng(changedMaster));
    expect(() => runLayerExtraction(spec, dir)).toThrow(/source master image: SHA256/);
    writeFileSync(join(dir, 'master.png'), masterBytes);
    expect(() =>
      runLayerExtraction({ ...spec, clips: spec.clips.map((c) => ({ ...c, bodySheetSha256: '0'.repeat(64) })) }, dir),
    ).toThrow(/body-only edit: SHA256/);
    expect(() =>
      runLayerExtraction({ ...spec, clips: spec.clips.map((c) => ({ ...c, weaponMatteSha256: '0'.repeat(64) })) }, dir),
    ).toThrow(/weapon matte: SHA256/);
    expect(() =>
      runLayerExtraction({ ...spec, clips: spec.clips.map((c) => ({ ...c, templateSha256: '0'.repeat(64) })) }, dir),
    ).toThrow(/template SHA256/);
    const body = decodePng(readFileSync(join(dir, 'body.png')));
    rect(body, 125, 100, 126, 101, [0, 0, 0, 255]);
    const bytes = encodePng(body);
    writeFileSync(join(dir, 'body.png'), bytes);
    const bad = runLayerExtraction(
      { ...spec, clips: spec.clips.map((c) => ({ ...c, bodySheetSha256: sha(bytes) })) },
      dir,
    );
    expect(bad.ok).toBe(false);
    expect(bad.sets).toEqual([]);
    const out = join(dir, 'bad');
    writeLayerExtraction(bad, out);
    expect(existsSync(join(out, 'layer-report.json'))).toBe(true);
    expect(existsSync(join(out, 'body_t1'))).toBe(false);
    expect(() => writeLayerExtraction(bad, out)).toThrow(/fresh attempt/);
  });
  it('runs both canonical-template and gated-export CLIs', () => {
    const { dir, spec } = projectFixture(),
      cwd = fileURLToPath(new URL('../', import.meta.url));
    const invoke = (script: string, args: string[]) =>
      execFileSync(process.execPath, [join(cwd, '../rig/scripts/run-ts.mjs'), script, ...args], {
        cwd,
        encoding: 'utf8',
      });
    invoke('scripts/layer-template.ts', ['--project', join(dir, 'project.json'), '--out', join(dir, 'guides')]);
    expect(existsSync(join(dir, 'guides/layer-inputs.json'))).toBe(true);
    writeFileSync(join(dir, 'extract.json'), JSON.stringify(spec));
    expect(
      invoke('scripts/layers.ts', ['--project', join(dir, 'extract.json'), '--out', join(dir, 'cli-out')]),
    ).toContain('3 runtime sets exported');
  });
});
