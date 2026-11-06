import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFootSlideAlignment, type Project, type TemplateManifest } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const paths = execFileSync('git', ['ls-files', 'assets-src/**/project.json'], { cwd: root, encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

describe('committed sprite project alignment compatibility', () => {
  it('finds the committed project inventory', () => expect(paths.length).toBeGreaterThan(0));
  for (const path of paths) {
    it(`${path}: every measured clip preserves y travel or explicitly declares it unmeasured`, () => {
      const file = resolve(root, path);
      const project = JSON.parse(readFileSync(file, 'utf8')) as Project;
      for (const clip of project.clips) {
        const cells = clip.manifest
          ? (JSON.parse(readFileSync(resolve(dirname(file), clip.manifest), 'utf8')) as TemplateManifest).cells
          : undefined;
        expect(() => validateFootSlideAlignment(project, clip, cells), `${path}: ${clip.name}`).not.toThrow();
      }
    });
  }
});
