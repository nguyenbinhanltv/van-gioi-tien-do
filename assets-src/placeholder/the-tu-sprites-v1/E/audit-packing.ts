import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { PACK_PADDING, PACK_EXTRUDE, runProject, type Project } from '@vgtd/sprite';
const base = dirname(process.argv[1]!);
const project = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8')) as Project;
const clips = project.clips.map((clip) => {
  const result = runProject({ ...project, clips: [clip] }, base);
  const tex = JSON.parse(result.files.get('thetu_E_tex.json') as string) as {
    SubTexture: { name: string; width: number; height: number }[];
  };
  return {
    clip: clip.name,
    records: result.contract.clips[0]!.records,
    qa: result.contract.qa,
    trims: tex.SubTexture,
    paddedArea: tex.SubTexture.reduce((n, r) => {
      const margin = 2 * (PACK_PADDING + PACK_EXTRUDE);
      return n + (r.width + margin) * (r.height + margin);
    }, 0),
  };
});
const output = { character: 'the-tu', dir: 'E', clips, paddedArea: clips.reduce((n, c) => n + c.paddedArea, 0) };
const out = process.argv[2]!;
writeFileSync(out, JSON.stringify(output, null, 2) + '\n');
console.log(
  JSON.stringify(
    { paddedArea: output.paddedArea, clips: clips.map((c) => ({ clip: c.clip, area: c.paddedArea, qa: c.qa.counts })) },
    null,
    2,
  ),
);
