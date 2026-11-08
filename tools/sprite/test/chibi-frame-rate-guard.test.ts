import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guard: every committed `*-chibi-v1` sprite project must use the smooth-v2 timing profile and its exported
 * runtime skeleton must run at 24 fps. Thuong tu E once shipped at 30 fps; this prevents recurrence.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const runtimeDir = 'apps/client-cocos/assets/resources/dragonbones';
const projects = execFileSync('git', ['ls-files', 'assets-src/placeholder/*-chibi-v1/*/project.json'], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

interface ChibiProject {
  readonly stem: string;
  readonly direction: string;
  readonly timingProfile?: string;
  readonly clips: readonly { readonly name: string; readonly timingProfile?: string }[];
}

describe('chibi-v1 timing guard (smooth-v2, 24 fps)', () => {
  it('finds the committed chibi project inventory', () => expect(projects.length).toBeGreaterThan(0));
  for (const path of projects) {
    it(`${path}: smooth-v2 project and 24 fps runtime SKE`, () => {
      const project = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as ChibiProject;
      expect(project.timingProfile, `${path} timingProfile`).toBe('smooth-v2');
      for (const clip of project.clips)
        if (clip.timingProfile !== undefined)
          expect(clip.timingProfile, `${path} clip ${clip.name} timingProfile`).toBe('smooth-v2');
      const character = dirname(dirname(path)).split('/').pop()!;
      const ske = `${runtimeDir}/${character}/${project.stem}_${project.direction}_ske.json`;
      expect(existsSync(resolve(root, ske)), `${ske} must exist (exported runtime SKE)`).toBe(true);
      const armatures = JSON.parse(readFileSync(resolve(root, ske), 'utf8')) as {
        frameRate?: number;
        armature?: { frameRate?: number }[];
      };
      expect(armatures.frameRate, `${ske} frameRate`).toBe(24);
      for (const a of armatures.armature ?? [])
        if (a.frameRate !== undefined) expect(a.frameRate, `${ske} armature frameRate`).toBe(24);
    });
  }
});
