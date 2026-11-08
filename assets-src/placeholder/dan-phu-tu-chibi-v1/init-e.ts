/** Initialize E smooth-v2 generation inputs from the landmarked master and public clip table. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng, type Image } from '@vgtd/rig';
import {
  SMOOTH_SPRITE_CLIPS,
  smoothProjectClipDefaults,
  smoothPoseTags,
  guidesFromMaster,
  measureFigure,
  buildTemplate,
  buildGroupedTemplate,
  locomotionCells,
  groundSpeedPxS,
  halfStrideFor,
  resizeImage,
} from '@vgtd/sprite';
const root = process.argv[2]!;
const out = join(root, 'E');
for (const folder of ['templates', 'raw', 'provenance']) mkdirSync(join(out, folder), { recursive: true });
const master = decodePng(readFileSync(join(root, 'reference/E.corrected-master.png')));
const metrics = measureFigure(master);
if (!metrics) throw new Error('Empty master');
const guides = guidesFromMaster(metrics);
function stampFullGuide(name: string, base: Image, frames: number) {
  const guide = { ...base, data: new Uint8ClampedArray(base.data) };
  const cols = base.width / master.width;
  for (let index = 0; index < frames; index++) {
    const ox = (index % cols) * master.width;
    const oy = Math.floor(index / cols) * master.height;
    for (let y = 0; y < master.height; y++)
      for (let x = 0; x < master.width; x++) {
        const source = (y * master.width + x) * 4;
        const alpha = master.data[source + 3]! / 255;
        const target = ((oy + y) * guide.width + ox + x) * 4;
        for (let channel = 0; channel < 3; channel++)
          guide.data[target + channel] = Math.round(
            master.data[source + channel]! + guide.data[target + channel]! * (1 - alpha),
          );
        guide.data[target + 3] = 255;
      }
  }
  writeFileSync(join(out, 'templates', name + '.master-guide.png'), encodePng(guide));
  writeFileSync(
    join(out, 'templates', name + '.master-guide.json'),
    JSON.stringify(
      {
        master: '../../reference/E.corrected-master.png',
        scale: 1,
        frames,
        note: 'Full unscaled canonical master copied into INPUT cells only. Output poses are AI image edits; no generated frame is scaled, cloned or repainted by code.',
      },
      null,
      2,
    ) + '\n',
  );
}
interface HeadPose {
  dx: number;
  dy: number;
  angle: number;
}
function posesFor(name: string, frames: number): HeadPose[] {
  const zero = () => ({ dx: 0, dy: 0, angle: 0 });
  if (name === 'run') {
    // Input-only neck attachment intentions, converted back to the source plane; not output head evidence.
    const dx = [10, 16, 16, 25, 16, 9, 13, 13, 7, 10, 16, 24, 6, 11, 12, 12];
    const dy = [12, 13, 12, 10, 10, 9, 8, 9, 12, 13, 12, 12, 10, 9, 8, 9];
    return dx.map((x, i) => ({ dx: x, dy: dy[i]!, angle: 0 }));
  }
  if (name === 'meditate') return Array.from({ length: frames }, () => ({ dx: 0, dy: 64, angle: 0 }));
  if (name.startsWith('attack')) {
    const tags = smoothPoseTags(name);
    const strikeCount = tags.filter((tag) => tag === 'strike').length;
    const followCount = tags.filter((tag) => tag === 'follow_through').length;
    let strike = 0;
    let follow = 0;
    const reach = name === 'attack_3' ? 28 : 24;
    const depth = name === 'attack_3' ? 22 : name === 'attack_2' ? 10 : 14;
    return tags.map((tag) => {
      if (tag === 'anticipation') return { dx: -4, dy: 2, angle: -3 };
      if (tag === 'strike') {
        const t = ++strike / strikeCount;
        return { dx: reach * t, dy: depth * t, angle: 10 * t };
      }
      if (tag === 'impact' || tag === 'impact_hold') return { dx: reach, dy: depth, angle: 10 };
      const t = 1 - ++follow / followCount;
      return { dx: reach * t, dy: depth * t, angle: 10 * t };
    });
  }
  if (name === 'die') {
    const dx = [0, -2, -5, -10, -15, -20, -23, -25, -27, -27, -27, -27];
    const dy = [0, 4, 17, 40, 64, 88, 106, 126, 132, 134, 134, 134];
    const angle = [0, -8, -15, -25, -40, -55, -70, -80, -90, -90, -90, -90];
    return dx.map((x, i) => ({ dx: x, dy: dy[i]!, angle: angle[i]! }));
  }
  if (name === 'tribulation')
    return [0, 4, 10, 20, 30, 44, 50, 52, 52, 50, 42, 30, 20, 10, 4, 0].map((dy) => ({ dx: 0, dy, angle: 0 }));
  if (name === 'hit')
    return [0, 4, 9, 7, 3, 0].map((dy, i) => ({
      dx: [0, -4, -8, -8, -4, 0][i]!,
      dy,
      angle: [0, -4, -8, -6, -3, 0][i]!,
    }));
  if (name === 'dash') {
    // Actual source-plane neck attachment intentions; canonical head remains unscaled and looks ahead.
    const dx = [0, 17, 36, 46, 96, 41, 47, 28, 4, 0];
    const dy = [0, 27, 26, 26, 47, 15, 27, 29, 14, 0];
    return dx.map((x, i) => ({ dx: x, dy: dy[i]!, angle: 0 }));
  }
  if (name === 'sword_fly' || name === 'channel')
    return [0, -0.5, -1, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 1, 0.5].map((dy) => ({ dx: 0, dy, angle: 0 }));
  return Array.from({ length: frames }, zero);
}
function stampGuide(name: string, base: Image, poses: HeadPose[]) {
  const guide = { ...base, data: new Uint8ClampedArray(base.data) };
  const cols = base.width / master.width;
  poses.forEach((pose, index) => {
    const ox = (index % cols) * master.width;
    const oy = Math.floor(index / cols) * master.height;
    const radians = (pose.angle * Math.PI) / 180;
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    for (let y = 0; y < master.height; y++)
      for (let x = 0; x < master.width; x++) {
        const dx = x - 135 - pose.dx;
        const dy = y - 68 - pose.dy;
        const sx = Math.round(c * dx + s * dy + 135);
        const sy = Math.round(-s * dx + c * dy + 68);
        if (sx < 95 || sx >= 156 || sy < 3 || sy >= 71 || (sy > 54 && sx < 109)) continue;
        const source = (sy * master.width + sx) * 4;
        const alpha = master.data[source + 3]! / 255;
        const target = ((oy + y) * guide.width + ox + x) * 4;
        for (let channel = 0; channel < 3; channel++)
          guide.data[target + channel] = Math.round(
            master.data[source + channel]! + guide.data[target + channel]! * (1 - alpha),
          );
        guide.data[target + 3] = 255;
      }
  });
  writeFileSync(join(out, 'templates', name + '.head-guide.png'), encodePng(guide));
  writeFileSync(
    join(out, 'templates', name + '.head-guide.json'),
    JSON.stringify(
      {
        master: '../../reference/E.corrected-master.png',
        scale: 1,
        poses,
        stencil: { left: 95, right: 156, top: 3, bottom: 71 },
        note: 'Authoring intentions only, not measured output annotations. Unscaled master-head stencil transformed in input guide only; generated artwork is never scaled or repainted by code. Review actual output landmarks independently.',
      },
      null,
      2,
    ) + '\n',
  );
}
writeFileSync(
  join(root, 'reference/E.corrected-master4x.png'),
  encodePng(resizeImage(master, master.width * 4, master.height * 4)),
);
const projectClips = SMOOTH_SPRITE_CLIPS.map((clip) => {
  const cells =
    clip.name === 'walk' || clip.name === 'run'
      ? locomotionCells(clip.sheet.frames, guides, {
          direction: 'E',
          halfStride: halfStrideFor(
            groundSpeedPxS(clip.tableId, 'E')!,
            clip.durationSec,
            clip.name === 'run' ? 0.35 : 0.5,
          ),
          stance: clip.name === 'run' ? 0.35 : 0.5,
          lift: clip.name === 'run' ? 16 : 10,
        })
      : smoothPoseTags(clip.name).map((tag) => ({ leading: null, tag }));
  const clipGuides = clip.name === 'meditate' ? { ...guides, head: 66, pelvis: 170 } : guides;
  const template = buildTemplate({
    clip: clip.name,
    frames: clip.sheet.frames,
    cols: clip.sheet.cols,
    guides: clipGuides,
    cells,
  });
  writeFileSync(join(out, 'templates', clip.name + '.template.png'), encodePng(template.image));
  writeFileSync(
    join(out, 'templates', clip.name + '.template.json'),
    JSON.stringify(template.manifest, null, 2) + '\n',
  );
  if (clip.name !== 'walk') stampGuide(clip.name, template.image, posesFor(clip.name, clip.sheet.frames));
  if (['idle', 'walk', 'run', 'channel'].includes(clip.name))
    stampFullGuide(clip.name, template.image, clip.sheet.frames);
  return {
    ...smoothProjectClipDefaults(clip.name),
    sheet: 'raw/' + clip.name + '.attempt1.png',
    manifest: 'templates/' + clip.name + '.template.json',
  };
});
const group = buildGroupedTemplate({
  clips: ['hit', 'dash'].map((name) => ({
    name,
    frames: SMOOTH_SPRITE_CLIPS.find((clip) => clip.name === name)!.sheet.frames,
  })),
  guides,
});
writeFileSync(join(out, 'templates/hit-dash.template.png'), encodePng(group.image));
writeFileSync(join(out, 'templates/hit-dash.template.json'), JSON.stringify(group.manifest, null, 2) + '\n');
writeFileSync(join(out, 'templates/hit-dash.clips.json'), JSON.stringify(group.clips, null, 2) + '\n');
stampGuide('hit-dash', group.image, [...posesFor('hit', 6), ...posesFor('dash', 10)]);
// Historical input reconstruction: preserve the initial hit/dash authoring poses before the v3 stencil revision.
const originalDash = [0, 8, 20, 30, 36, 34, 26, 16, 7, 0].map((dy, i) => ({
  dx: [0, 4, 12, 18, 23, 25, 20, 12, 6, 0][i]!,
  dy,
  angle: [0, 4, 9, 12, 14, 12, 9, 5, 2, 0][i]!,
}));
stampGuide('hit-dash-v1', group.image, [...posesFor('hit', 6), ...originalDash]);
for (const mapping of group.clips) {
  const clip = projectClips.find((entry) => entry.name === mapping.name)!;
  Object.assign(clip, mapping, { sheet: 'raw/hit-dash.attempt1.png', manifest: 'templates/hit-dash.template.json' });
}
if (!existsSync(join(out, 'project.json')))
  writeFileSync(
    join(out, 'project.json'),
    JSON.stringify(
      {
        character: 'dan-phu-tu-chibi-v1',
        direction: 'E',
        stem: 'danphuchibi',
        master: '../reference/E.corrected-master.png',
        backlog: '../quality-backlog.json',
        preparation: { kind: 'square-cell-dpi-v1', calibration: '../motion-calibration.json' },
        clips: projectClips,
      },
      null,
      2,
    ) + '\n',
  );
if (!existsSync(join(root, 'motion-calibration.json')))
  writeFileSync(
    join(root, 'motion-calibration.json'),
    JSON.stringify(
      {
        scale: 1,
        status: 'initial locked logical-cell scale; review against first upright generation before all motion sheets',
        method:
          'Whole-sheet DPI normalization to public CELL_PX; one logical character scale across all clips/directions, never per-frame fitting.',
      },
      null,
      2,
    ) + '\n',
  );
console.log(
  JSON.stringify(
    {
      guides,
      master: metrics,
      clips: projectClips.map(({ name, frames, durationSec }) => ({ name, frames, durationSec })),
    },
    null,
    2,
  ),
);
