/**
 * Review artifacts for the animation set: per-clip contact sheets + GIFs, per-direction overview sheets, the QA
 * report and the exported DragonBones JSON. Opt-in (writes files):
 *
 *   RIG_ARTIFACT_DIR=<out> [RIG_DATA_DIR=<dir with kiem-tu.rig.json and atlas/<DIR>/atlas.json + png>] \
 *     npm run artifacts -w @vgtd/rig
 *
 * Without RIG_DATA_DIR it renders the reference humanoid with the procedural stand-in atlas.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAWN_DIRECTIONS, type Direction } from '@vgtd/shared';
import {
  KIEMTU_CLIPS,
  KIEMTU_REQUIRED_ROLES,
  authorKiemTuSet,
  buildCharacterPackage,
  buildReferenceAtlas,
  buildReferenceHumanoid,
  contactSheet,
  decodePng,
  encodeGif,
  encodePng,
  formatQaReports,
  loadedAtlas,
  renderClip,
  renderPose,
  evalPose,
  specIdForClipName,
  validateRigSet,
  clipSpec,
  runQa,
  type AtlasData,
  type Clip,
  type Image,
  type LoadedAtlas,
  type RigDocument,
} from '../src/index.js';
import { engineRuntimePath, loadRuntime } from './helpers/dbRuntime.js';

const out = process.env.RIG_ARTIFACT_DIR;
const dataDir = process.env.RIG_DATA_DIR;

interface DirectionData {
  readonly rig: RigDocument;
  readonly atlasData: AtlasData;
  readonly atlas: LoadedAtlas;
}

function loadDirections(): { id: string; byDir: Map<Direction, DirectionData> } {
  const byDir = new Map<Direction, DirectionData>();
  if (!dataDir) {
    for (const d of DRAWN_DIRECTIONS) {
      const rig = buildReferenceHumanoid(d);
      const ref = buildReferenceAtlas(rig);
      byDir.set(d, { rig, atlasData: ref.data, atlas: ref.atlas });
    }
    return { id: 'reference-humanoid', byDir };
  }
  const set = JSON.parse(readFileSync(join(dataDir, 'kiem-tu.rig.json'), 'utf-8')) as {
    id: string;
    rigs: Record<string, RigDocument>;
  };
  const issues = validateRigSet(set, { requireRoles: KIEMTU_REQUIRED_ROLES }).filter((i) => i.severity === 'error');
  expect(issues).toEqual([]);
  for (const d of DRAWN_DIRECTIONS) {
    const rig = set.rigs[d];
    if (!rig) continue;
    const dir = join(dataDir, 'atlas', d);
    const atlasData = JSON.parse(readFileSync(join(dir, 'atlas.json'), 'utf-8')) as AtlasData;
    const real = join(dir, 'real.png'); // LFS-smudged copy when the checkout only has pointers
    const png = existsSync(real) ? real : join(dir, atlasData.imagePath);
    const image = decodePng(readFileSync(png), { premultiplied: atlasData.premultipliedAlpha });
    byDir.set(d, { rig, atlasData, atlas: loadedAtlas(atlasData, image) });
  }
  return { id: set.id, byDir };
}

(out ? describe : describe.skip)('animation review artifacts', () => {
  it('authors, QA-gates, renders and exports the Kiếm tu set', async () => {
    mkdirSync(out!, { recursive: true });
    const { id, byDir } = loadDirections();
    const reportLines: string[] = [];
    const clipsByDir = new Map<Direction, Clip[]>();

    for (const [dir, { rig, atlasData }] of byDir) {
      const clips = authorKiemTuSet(rig);
      clipsByDir.set(dir, clips);
      const reports = clips.map((c) => {
        const sid = specIdForClipName(c.name);
        return runQa(rig, c, sid ? { spec: clipSpec(sid) } : {});
      });
      reportLines.push(`## ${id} / ${dir}`, formatQaReports(reports), '');
      expect(
        reports.flatMap((r) => r.issues.filter((i) => i.severity === 'error')),
        dir,
      ).toEqual([]);

      // QA-gated export, one DragonBones package per direction (each direction has its own atlas page)
      const pkg = buildCharacterPackage([{ rig, clips }], atlasData, { name: `${id}_${dir}` });
      writeFileSync(join(out!, `${id}_${dir}.ske.json`), JSON.stringify(pkg.export.ske));
      writeFileSync(join(out!, `${id}_${dir}.tex.json`), JSON.stringify(pkg.export.tex));
      if (engineRuntimePath()) {
        const loaded = (await loadRuntime()).load(pkg.export.ske, pkg.export.tex);
        expect(loaded.armatures).toEqual([dir]);
      }
    }
    writeFileSync(join(out!, 'qa-report.txt'), reportLines.join('\n'));

    // per-clip sheet + GIF for the profile view
    const main = byDir.get('E') ?? [...byDir.values()][0]!;
    for (const clip of clipsByDir.get(main.rig.direction)!) {
      const step = Math.max(1, Math.ceil(clip.frames / 14));
      const sheetFrames = renderClip(main.rig, clip, main.atlas, { scale: 1.5, step, overlay: true });
      writeFileSync(
        join(out!, `${clip.name}_${main.rig.direction}_sheet.png`),
        encodePng(contactSheet(sheetFrames, { columns: 7, step })),
      );
      const gifFrames = renderClip(main.rig, clip, main.atlas, { scale: 2 });
      writeFileSync(join(out!, `${clip.name}_${main.rig.direction}.gif`), encodeGif(gifFrames, 1000 / 30));
    }

    // direction overview for the headline clips: rows = directions, columns = 6 frames
    for (const name of ['idle', 'run', 'attack', 'cast', 'die'] as const) {
      const rows: Image[] = [];
      for (const [dir, { rig, atlas }] of byDir) {
        const clip = clipsByDir.get(dir)!.find((c) => c.name === name)!;
        const picks = [0, 1, 2, 3, 4, 5].map((i) =>
          Math.min(clip.frames - (clip.loop ? 1 : 0), Math.round((i / 5) * clip.frames)),
        );
        rows.push(...picks.map((f) => renderPose(rig, evalPose(rig, clip, f), atlas, { scale: 1 })));
      }
      writeFileSync(join(out!, `directions_${name}.png`), encodePng(contactSheet(rows, { columns: 6 })));
    }
    expect(KIEMTU_CLIPS.length).toBe(15);
  });
});
