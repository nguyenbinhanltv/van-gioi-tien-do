import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { smoothSpriteClip, type Project } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(resolve(root, p));
const report = JSON.parse(read('docs/art/smooth-clock-migration.json').toString('utf8')) as {
  directions: { project: string; skeleton: string }[];
};
describe('D58 committed smooth runtime clocks', () => {
  for (const entry of report.directions) {
    it(`${entry.skeleton}: every drawing lasts exactly one runtime tick`, () => {
      const project = JSON.parse(read(entry.project).toString('utf8')) as Project;
      const bytes = read(entry.skeleton);
      const ske = JSON.parse(bytes.toString('utf8'));
      expect(project.timingProfile).toBe('smooth-v2');
      expect(ske.frameRate).toBe(24);
      expect(ske.armature).toHaveLength(1);
      const a = ske.armature[0];
      expect(a.frameRate).toBe(24);
      expect(a.animation).toHaveLength(15);
      for (const c of project.clips) {
        const animation = a.animation.find((x: { name: string }) => x.name === c.name);
        expect(animation.duration).toBe(c.frames);
        expect(animation.duration / 24).toBe(c.durationSec);
        expect(animation.playTimes).toBe(c.loop ? 0 : 1);
        expect(animation.slot[0].displayFrame.map((f: { duration: number }) => f.duration)).toEqual(
          Array.from({ length: c.frames }, () => 1),
        );
        expect(c.frames).toBe(smoothSpriteClip(c.name).sheet.frames);
      }
    });
  }
});
