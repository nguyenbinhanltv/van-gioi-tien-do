/**
 * Procedural stand-in atlas for rigs without art (the reference humanoid): one coloured rounded part per slot, with a
 * lighter strip on the +x edge so the facing is visible. Deterministic; used by tests and demo artifacts.
 */
import type { AtlasData, RigDocument } from '../schema.js';
import { createImage, type Image } from './image.js';
import { fillRect, type Rgba } from './raster.js';
import { loadedAtlas, type LoadedAtlas } from './render.js';

const COLORS: Readonly<Record<string, Rgba>> = {
  wing: [140, 200, 255, 170],
  cape: [120, 70, 170, 255],
  sword_back: [205, 214, 225, 255],
  hair_back: [40, 32, 48, 255],
  body: [45, 91, 179, 255],
  outfit_lower: [32, 62, 130, 255],
  outfit_upper: [60, 110, 200, 255],
  head: [232, 185, 138, 255],
  hair_front: [30, 24, 40, 255],
  headwear: [230, 190, 70, 255],
  arm_L: [232, 185, 138, 255],
  arm_R: [232, 185, 138, 255],
  weapon_R: [205, 214, 225, 255],
};

export function buildReferenceAtlas(rig: RigDocument): { data: AtlasData; atlas: LoadedAtlas; image: Image } {
  const attachments = rig.skins.flatMap((s) => Object.values(s.attachments).flatMap((m) => Object.values(m)));
  const size = 512;
  const image = createImage(size, size, [0, 0, 0, 0]);
  const regions: AtlasData['regions'][number][] = [];
  let x = 2;
  let y = 2;
  let rowH = 0;
  for (const a of attachments) {
    const w = Math.ceil(a.width);
    const h = Math.ceil(a.height);
    if (x + w + 2 > size) {
      x = 2;
      y += rowH + 2;
      rowH = 0;
    }
    const base = COLORS[a.path] ?? [200, 200, 200, 255];
    fillRect(image, x, y, w, h, base);
    fillRect(image, x + Math.floor(w * 0.72), y, Math.ceil(w * 0.28), h, [
      Math.min(255, base[0] + 45),
      Math.min(255, base[1] + 45),
      Math.min(255, base[2] + 45),
      base[3],
    ]);
    fillRect(image, x, y, w, 1, [0, 0, 0, 90]);
    regions.push({ name: a.path, x, y, width: w, height: h });
    x += w + 2;
    rowH = Math.max(rowH, h);
  }
  const data: AtlasData = { imagePath: 'reference.png', width: size, height: size, premultipliedAlpha: true, regions };
  return { data, atlas: loadedAtlas(data, image), image };
}
