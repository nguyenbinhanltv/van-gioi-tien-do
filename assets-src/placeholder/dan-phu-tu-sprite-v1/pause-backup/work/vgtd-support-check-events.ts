import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventsFromTable, spriteClip } from '__USER_HOME__/.ao/data/worktrees/van-gioi-tien-do/van-gioi-tien-do-21/tools/sprite/src/index.ts';
const root = process.argv[2]!;
const project = JSON.parse(readFileSync(join(root, 'assets-src/placeholder/dan-phu-tu-sprite-v1/E/project.json'), 'utf8'));
const ske = JSON.parse(readFileSync(join(root, 'apps/client-cocos/assets/resources/dragonbones/danphutu-sprite-v1/danphutu_E_ske.json'), 'utf8'));
for (const clip of project.clips) {
  const spec = spriteClip(clip.name);
  assert.deepEqual(clip.phases, spec.phases, `${clip.name} manifest phases`);
  const animation = ske.armature[0].animation.find((a) => a.name === clip.name);
  let tick = 0;
  const actual = [];
  for (const frame of animation.frame ?? []) {
    for (const event of frame.events ?? []) actual.push({ frame: tick, name: event.name });
    tick += frame.duration;
  }
  const expected = eventsFromTable(spec.tableId, animation.duration, spec.phases).sort((a,b) => a.frame - b.frame);
  assert.deepEqual(actual, expected, `${clip.name} exported events`);
  if (actual.length) console.log(clip.name, JSON.stringify(actual));
}
console.log('All 15 manifests and serialized event timelines match public clip-table defaults.');