import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { characterPaths, decodePng, loadCharacterData, nonPremultipliedPixels, CHARACTER_IDS } from '../src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Every atlas page whose tex file says `premultipliedAlpha: true` must hold premultiplied colour in the PNG itself
 * (colour <= alpha). A straight-alpha page read as premultiplied is the bright halo bug.
 */
describe('exported atlas pages are premultiplied', () => {
  it('the committed registry textures (the source of the viewer export) hold premultiplied colour', () => {
    for (const id of CHARACTER_IDS) {
      const m = join(repoRoot, characterPaths(id).manifest);
      if (!existsSync(m)) continue;
      const data = loadCharacterData(repoRoot, id);
      for (const [dir, d] of data.byDirection) {
        expect(d.atlas.premultipliedAlpha).toBe(true);
        const img = decodePng(readFileSync(d.texturePath), { premultiplied: true });
        expect(nonPremultipliedPixels(img), `${id}/${dir}`).toBe(0);
      }
    }
  });

  it('every committed viewer export page that declares premultipliedAlpha is premultiplied', () => {
    const base = join(repoRoot, 'apps/client-cocos/assets/resources/dragonbones');
    let checked = 0;
    for (const folder of readdirSync(base, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const dir = join(base, folder.name);
      for (const f of readdirSync(dir).filter((x) => x.endsWith('_tex.json'))) {
        const tex = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { premultipliedAlpha?: boolean };
        const png = join(dir, f.replace(/_tex\.json$/, '_tex.png'));
        if (!tex.premultipliedAlpha || !existsSync(png)) continue;
        const buf = readFileSync(png);
        if (buf.subarray(1, 4).toString('ascii') !== 'PNG') continue; // Git LFS pointer in a shallow checkout
        expect(nonPremultipliedPixels(decodePng(buf, { premultiplied: true })), `${folder.name}/${f}`).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
