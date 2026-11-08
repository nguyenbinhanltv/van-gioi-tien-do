/** Canonical D45 image-edit references from exact QA-passed aligned frames. */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createImage, encodePng, type Image } from '@vgtd/rig';
import { runProject, type Project } from './project.js';
import { sheetLayout } from './grouped.js';
import { CELL_PX } from './types.js';
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export interface LayerTemplate {
  readonly file: string;
  readonly sha256: string;
  readonly png: Buffer;
  readonly clips: readonly { readonly name: string; readonly cells: readonly number[] }[];
}
export interface LayerSources {
  readonly project: Project;
  readonly projectSha256: string;
  readonly masterImageSha256: string;
  readonly templates: readonly LayerTemplate[];
}

/** Uses the original passed QA and exact aligned frames; grouping changes only cell storage, never pose scale. */
export function prepareLayerSources(projectPath: string): LayerSources {
  const bytes = readFileSync(projectPath),
    project = JSON.parse(bytes.toString('utf8')) as Project;
  const result = runProject(project, dirname(projectPath), { includeAlignedFrames: true });
  if (!result.contract.qa.ok)
    throw new Error('source project fails QA; resolve hard/unlisted/regression findings before layer authoring');
  const groups = new Map<
    string,
    { image: Image; clips: { name: string; cells: number[] }[]; occupied: Map<number, string> }
  >();
  for (const clip of project.clips) {
    const grid = sheetLayout(clip);
    if (grid.cols * grid.rows > 16) throw new Error(`clip '${clip.name}' source group exceeds a 4x4 layer guide`);
    const key = JSON.stringify([resolve(dirname(projectPath), clip.sheet), grid.cols, grid.rows]);
    let group = groups.get(key);
    if (!group) {
      group = { image: createImage(4 * CELL_PX, 4 * CELL_PX), clips: [], occupied: new Map() };
      groups.set(key, group);
    }
    const cells = [...(clip.sheetSelection?.cells ?? Array.from({ length: clip.frames }, (_, i) => i))];
    const frames = result.alignedClips!.find((c) => c.name === clip.name)!.frames;
    frames.forEach((image, i) => {
      if (!image) throw new Error('source frame missing after passed QA');
      const cell = cells[i]!,
        digest = hash(Buffer.from(image.data));
      if (group!.occupied.has(cell) && group!.occupied.get(cell) !== digest)
        throw new Error('shared source cell has conflicting aligned poses');
      group!.occupied.set(cell, digest);
      for (let y = 0; y < CELL_PX; y++)
        group!.image.data.set(
          image.data.subarray(y * CELL_PX * 4, (y + 1) * CELL_PX * 4),
          ((Math.floor(cell / 4) * CELL_PX + y) * group!.image.width + (cell % 4) * CELL_PX) * 4,
        );
    });
    group.clips.push({ name: clip.name, cells });
  }
  return {
    project,
    projectSha256: hash(bytes),
    masterImageSha256: hash(readFileSync(resolve(dirname(projectPath), project.master))),
    templates: [...groups.values()].map((g, i) => {
      const png = encodePng(g.image);
      return { file: `source-${i}.full.png`, sha256: hash(png), png, clips: g.clips };
    }),
  };
}

export function writeLayerTemplates(source: LayerSources, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const t of source.templates) writeFileSync(join(outDir, t.file), t.png);
  writeFileSync(
    join(outDir, 'layer-inputs.json'),
    JSON.stringify(
      {
        projectSha256: source.projectSha256,
        masterImageSha256: source.masterImageSha256,
        grid: { cols: 4, rows: 4, cell: CELL_PX },
        templates: source.templates.map((t) => ({ file: t.file, sha256: t.sha256, clips: t.clips })),
      },
      null,
      2,
    ),
  );
}
