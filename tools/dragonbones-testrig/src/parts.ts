import type { Direction } from '@vgtd/shared';
import type { SlotId } from '@vgtd/character';
import type { Bitmap } from './png.js';
import { createBitmap, fillEllipse, fillRect, fillRoundRect, type Rgba } from './raster.js';

/** One drawable placeholder part (a region in the atlas). */
export interface Part {
  /** Atlas region name == attachment path. `slot` for the default skin, `slot_<skin>` for variants. */
  readonly name: string;
  readonly slot: SlotId;
  /** Skin that owns it (default skin = 'default'). */
  readonly skin: string;
  readonly bitmap: Bitmap;
}

export const SKINS = ['default', 'red'] as const;
export type SkinName = (typeof SKINS)[number];

/** Face is visible when the character looks toward the camera (S, SE, E, SW, W); back views show none. */
const FACE_SHIFT: Record<Direction, number> = { S: 0, SE: 5, E: 9, NE: 6, N: 0, NW: -6, W: -9, SW: -5 };
const SHOWS_FACE: Record<Direction, boolean> = {
  S: true,
  SE: true,
  E: true,
  NE: false,
  N: false,
  NW: false,
  W: true,
  SW: true,
};
export const PROFILE: Record<Direction, boolean> = {
  S: false,
  SE: false,
  E: true,
  NE: false,
  N: false,
  NW: false,
  W: true,
  SW: false,
};

const SKIN: Rgba = [232, 185, 138, 255];
const HAIR: Rgba = [40, 32, 48, 255];
const GOLD: Rgba = [230, 190, 70, 255];
const STEEL: Rgba = [205, 214, 225, 255];

const PALETTE: Record<SkinName, { upper: Rgba; lower: Rgba; cape: Rgba }> = {
  default: { upper: [45, 91, 179, 255], lower: [32, 62, 130, 255], cape: [120, 70, 170, 255] },
  red: { upper: [190, 52, 44, 255], lower: [130, 34, 30, 255], cape: [220, 150, 50, 255] },
};

function bmp(w: number, h: number, draw: (b: Bitmap) => void): Bitmap {
  const b = createBitmap(w, h);
  draw(b);
  return b;
}

/** Part sizes (px @1x): the rig attaches them at fixed offsets (see rig.ts). */
export const PART_SIZE = {
  body: { w: 22, h: 30 },
  outfit_lower: { w: 26, h: 26 },
  outfit_upper: { w: 26, h: 26 },
  head: { w: 26, h: 26 },
  hair_back: { w: 30, h: 30 },
  hair_front: { w: 28, h: 12 },
  headwear: { w: 30, h: 10 },
  arm_L: { w: 10, h: 28 },
  arm_R: { w: 10, h: 28 },
  weapon_R: { w: 10, h: 50 },
  wing: { w: 56, h: 44 },
  cape: { w: 28, h: 44 },
  sword_back: { w: 10, h: 52 },
} as const satisfies Partial<Record<SlotId, { w: number; h: number }>>;

/** The 13 Spine slots' placeholder art for one direction (default skin + variant skins). */
export function buildParts(dir: Direction): Part[] {
  const profile = PROFILE[dir];
  const narrow = profile ? 0.65 : 1;
  const parts: Part[] = [];
  const add = (slot: SlotId, skin: SkinName, bitmap: Bitmap) =>
    parts.push({ name: skin === 'default' ? slot : `${slot}_${skin}`, slot, skin, bitmap });

  const s = PART_SIZE;
  add(
    'body',
    'default',
    bmp(s.body.w, s.body.h, (b) => fillRoundRect(b, 0, 0, s.body.w * narrow, s.body.h, 6, SKIN)),
  );
  for (const skin of SKINS) {
    const p = PALETTE[skin];
    const lowerW = Math.round(s.outfit_lower.w * narrow);
    add(
      'outfit_lower',
      skin,
      bmp(s.outfit_lower.w, s.outfit_lower.h, (b) => {
        fillRoundRect(b, (s.outfit_lower.w - lowerW) / 2, 0, lowerW, s.outfit_lower.h, 5, p.lower);
        fillRect(b, (s.outfit_lower.w - lowerW) / 2, 2, lowerW, 3, GOLD); // belt
      }),
    );
    const upperW = Math.round(s.outfit_upper.w * narrow);
    add(
      'outfit_upper',
      skin,
      bmp(s.outfit_upper.w, s.outfit_upper.h, (b) => {
        fillRoundRect(b, (s.outfit_upper.w - upperW) / 2, 0, upperW, s.outfit_upper.h, 6, p.upper);
        fillRect(b, s.outfit_upper.w / 2 - 1, 3, 2, s.outfit_upper.h - 6, GOLD); // front seam
      }),
    );
    add(
      'cape',
      skin,
      bmp(s.cape.w, s.cape.h, (b) => fillRoundRect(b, 0, 0, s.cape.w, s.cape.h, 5, p.cape)),
    );
  }

  add(
    'head',
    'default',
    bmp(s.head.w, s.head.h, (b) => {
      fillEllipse(b, 13, 13, 12.5, 12.5, SKIN);
      if (!SHOWS_FACE[dir]) return;
      const fx = FACE_SHIFT[dir];
      const eye: Rgba = [30, 30, 40, 255];
      if (profile) {
        fillEllipse(b, 13 + fx, 12, 1.6, 2.2, eye);
        fillRect(b, 13 + fx + (fx > 0 ? 2 : -4), 15, 2, 2, [200, 120, 100, 255]); // nose
      } else {
        fillEllipse(b, 13 + fx - 4, 12, 1.6, 2.2, eye);
        fillEllipse(b, 13 + fx + 4, 12, 1.6, 2.2, eye);
      }
    }),
  );
  add(
    'hair_back',
    'default',
    bmp(s.hair_back.w, s.hair_back.h, (b) => fillEllipse(b, 15, 15, 14.5, 14.5, HAIR)),
  );
  add(
    'hair_front',
    'default',
    bmp(s.hair_front.w, s.hair_front.h, (b) => fillRoundRect(b, 0, 0, s.hair_front.w, s.hair_front.h, 5, HAIR)),
  );
  add(
    'headwear',
    'default',
    bmp(s.headwear.w, s.headwear.h, (b) => {
      fillRoundRect(b, 0, 2, s.headwear.w, s.headwear.h - 2, 3, GOLD);
      fillRect(b, s.headwear.w / 2 - 2, 0, 4, 4, [255, 240, 160, 255]);
    }),
  );
  for (const slot of ['arm_L', 'arm_R'] as const) {
    add(
      slot,
      'default',
      bmp(s[slot].w, s[slot].h, (b) => {
        fillRoundRect(b, 0, 0, s[slot].w, s[slot].h - 5, 4, PALETTE.default.upper);
        fillEllipse(b, s[slot].w / 2, s[slot].h - 4, 4.2, 4.2, SKIN); // hand
      }),
    );
  }
  // weapon_R: red tip marks the +y end so mirroring is obvious; guard near the hand.
  add(
    'weapon_R',
    'default',
    bmp(s.weapon_R.w, s.weapon_R.h, (b) => {
      fillRect(b, 3, 0, 4, s.weapon_R.h - 12, STEEL);
      fillRect(b, 3, 0, 4, 6, [220, 60, 60, 255]);
      fillRect(b, 0, s.weapon_R.h - 12, 10, 3, GOLD);
      fillRect(b, 3, s.weapon_R.h - 9, 4, 9, [120, 80, 50, 255]);
    }),
  );
  add(
    'wing',
    'default',
    bmp(s.wing.w, s.wing.h, (b) => {
      fillEllipse(b, 14, 22, 14, 21, [235, 245, 255, 150]);
      fillEllipse(b, 42, 22, 14, 21, [235, 245, 255, 150]);
    }),
  );
  add(
    'sword_back',
    'default',
    bmp(s.sword_back.w, s.sword_back.h, (b) => {
      fillRect(b, 3, 0, 4, s.sword_back.h - 10, STEEL);
      fillRect(b, 0, s.sword_back.h - 10, 10, 3, GOLD);
      fillRect(b, 3, s.sword_back.h - 7, 4, 7, [120, 80, 50, 255]);
    }),
  );
  return parts;
}
