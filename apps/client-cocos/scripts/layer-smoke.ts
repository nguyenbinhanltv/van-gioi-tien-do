/** Procedural integration fixture only; generated resources are ignored, never production art. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { QUALITY_TIERS } from '@vgtd/shared';
import {
  pivotOf,
  VISUAL_TIERS,
  validateSpriteLayerSet,
  type SpriteLayerSet,
  type SpriteLayerRole,
  type EquipmentVisualMapping,
  type VisualTint,
} from '@vgtd/character';
import { CLIP_FPS, createImage, encodePng, exportTextureAtlas, type Image } from '@vgtd/rig';
import { CELL_PX, TEXTURE_SCALE, buildClip, packFrames, qualityGlowLayer } from '../../../tools/sprite/src/index.js';

const out = resolve(process.cwd(), 'assets/resources/dragonbones/_batch-layer-smoke-27');
function rect(img: Image, x0: number, y0: number, x1: number, y1: number, c: number[]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set(c, (y * img.width + x) * 4);
}
function image(role: SpriteLayerRole, variant: number, i: number): Image {
  const img = createImage(CELL_PX, CELL_PX),
    dx = [0, 2, 0, -2][i]!;
  if (role === 'body') {
    rect(img, 92 + dx, 68, 164 + dx, 204, variant ? [50, 150, 60, 255] : [40, 80, 160, 255]);
    rect(img, 104 + dx, 24, 152 + dx, 68, [230, 190, 160, 255]);
    rect(img, 94 + dx, 204, 116 + dx, 232, [60, 60, 70, 255]);
    rect(img, 140 + dx, 204, 162 + dx, 232, [60, 60, 70, 255]);
  } else {
    if (variant) rect(img, 55 + dx, 120, 201 + dx, 134, [230, 90, 210, 255]);
    else rect(img, 120 + dx, 82, 136 + dx, 220, [220, 220, 230, 255]);
  }
  return role === 'fx' ? qualityGlowLayer(img, 6) : img;
}
function writeSet(id: string, role: SpriteLayerRole, variant: number, derivedFromWeapon?: string) {
  const inputs = ['idle', 'attack'].flatMap((clip) =>
    Array.from({ length: 4 }, (_, i) => ({ name: `${clip}_${i}`, image: image(role, variant, i) })),
  );
  // Small fixture pages deliberately exercise multi-page registration in the real client.
  const texture = (i: number) => `${id}_E${i ? `_page${i}` : ''}_tex`;
  const pack = packFrames(inputs, (i) => `${texture(i)}.png`, 256),
    pivot = pivotOf(CELL_PX / TEXTURE_SCALE, CELL_PX / TEXTURE_SCALE);
  const set: SpriteLayerSet = {
    format: 'vgtd-sprite-layer-set',
    version: 1,
    id,
    role,
    direction: 'E',
    motionId: 'procedural-smoke-v1',
    frameRate: CLIP_FPS,
    ...(derivedFromWeapon ? { derivedFromWeapon } : {}),
    canvas: { width: CELL_PX / TEXTURE_SCALE, height: CELL_PX / TEXTURE_SCALE, pivotX: pivot.x, pivotY: pivot.y },
    textures: pack.pages.map((_, i) => texture(i)),
    displays: Array.from(pack.trims, ([name, r]) => ({
      name,
      region: name,
      x: (r.x + r.width / 2) / TEXTURE_SCALE - pivot.x,
      y: (r.y + r.height / 2) / TEXTURE_SCALE - pivot.y,
      width: r.width / TEXTURE_SCALE,
      height: r.height / TEXTURE_SCALE,
      textureWidth: r.width,
      textureHeight: r.height,
    })),
    clips: ['idle', 'attack'].map((name) => {
      const clip = buildClip({
        name,
        frames: inputs.filter((i) => i.name.startsWith(name + '_')).map((i) => i.name),
        durationSec: 1,
        loop: name === 'idle',
        events:
          name === 'attack'
            ? [
                { frame: 12, name: 'hit' },
                { frame: 24, name: 'cancel_window' },
              ]
            : [],
      });
      return {
        name,
        duration: clip.frames,
        loop: clip.loop,
        events: clip.events.map((e) => ({ at: e.frame, name: e.name })),
        frames: clip.slots[0]!.attachment!.map((k, i) => ({
          at: k.frame,
          display: k.value,
          ...(role === 'weapon' ? { order: i < 2 ? ('back' as const) : ('front' as const) } : {}),
        })),
      };
    }),
  };
  validateSpriteLayerSet(set);
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}_E.layer.json`), JSON.stringify(set, null, 2));
  pack.pages.forEach((page, i) => {
    writeFileSync(join(dir, `${texture(i)}.json`), JSON.stringify(exportTextureAtlas(page.data, texture(i))));
    writeFileSync(join(dir, `${texture(i)}.png`), encodePng(page.image, { premultiplied: true }));
  });
}
for (const [id, role, variant, weapon] of [
  ['body_a', 'body', 0],
  ['body_b', 'body', 1],
  ['weapon_a', 'weapon', 0],
  ['weapon_b', 'weapon', 1],
  ['fx_a', 'fx', 0, 'weapon_a'],
  ['fx_b', 'fx', 1, 'weapon_b'],
] as const)
  writeSet(id, role, variant, weapon);
const mapping: EquipmentVisualMapping = {
  format: 'vgtd-equipment-visuals',
  version: 1,
  tiers: Object.fromEntries(
    VISUAL_TIERS.map((tier, i) => [
      tier,
      { body: i % 2 ? 'body_b' : 'body_a', weapon: 'weapon_a', fx: 'fx_a', aura: `aura_${tier}` },
    ]),
  ) as EquipmentVisualMapping['tiers'],
  costumes: { test_costume: { body: 'body_b' } },
  weaponSkins: { test_skin: { weapon: 'weapon_b', fx: 'fx_b' } },
  qualityGlow: Object.fromEntries(
    QUALITY_TIERS.map((q, i) => [q.id, [i % 2 ? 1 : 0.25, i % 3 ? 0.4 : 1, i % 2 ? 0.25 : 1, 1] as VisualTint]),
  ) as EquipmentVisualMapping['qualityGlow'],
};
writeFileSync(
  join(out, 'equipment.json'),
  JSON.stringify(
    {
      format: 'vgtd-equipment-preview',
      version: 1,
      folder: 'dragonbones/_batch-layer-smoke-27',
      mapping,
      appearance: { tier: 'T1', quality: 'white' },
    },
    null,
    2,
  ),
);
console.log(`wrote procedural layered integration fixture: ${out}`);
