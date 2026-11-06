/**
 * Atlas packer: trims every aligned frame to its opaque bounds, packs the trims into pages of at most 2048 px
 * (BUDGETS.ATLAS_MAX_WEB_MOBILE), with the project padding (2 px) and extrude (1 px) and premultiplied colour (the PMA
 * policy of the rest of the toolchain: the PNG is written premultiplied, the tex file says `premultipliedAlpha: true`).
 */
import { BUDGETS } from '@vgtd/shared';
import { createImage, type AtlasData, type Image } from '@vgtd/rig';

export const PACK_PADDING = BUDGETS.ATLAS_PADDING_PX;
export const PACK_EXTRUDE = 1;
export const PACK_MAX_PAGE = BUDGETS.ATLAS_MAX_WEB_MOBILE;

export interface PackInput {
  /** Region name, unique. */
  readonly name: string;
  /** Premultiplied cell image. */
  readonly image: Image;
}

/** Where the trimmed rectangle of a frame sits inside its cell (px, y down). */
export interface Trim {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PackedPage {
  readonly image: Image;
  readonly data: AtlasData;
}

export interface PackResult {
  readonly pages: readonly PackedPage[];
  /** Trim rectangle per region name. */
  readonly trims: ReadonlyMap<string, Trim>;
  /** Page index per region name. */
  readonly pageOf: ReadonlyMap<string, number>;
}

/** Opaque bounds (alpha >= 1) of a premultiplied image; a 1x1 transparent rect for an empty one. */
export function trimRect(img: Image): Trim {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function nextPow2(n: number): number {
  let p = 64;
  while (p < n) p *= 2;
  return p;
}

/**
 * Shelf-pack `inputs` (sorted by height, then name: deterministic) into as few pages as needed. Each page is the
 * smallest power-of-two square that holds its shelf layout, never above `maxPage`.
 */
export function packFrames(
  inputs: readonly PackInput[],
  imagePath: (page: number) => string,
  maxPage: number = PACK_MAX_PAGE,
): PackResult {
  const slot = PACK_PADDING + PACK_EXTRUDE; // space around every trim
  const items = inputs
    .map((i) => ({ ...i, trim: trimRect(i.image) }))
    .sort((a, b) => b.trim.height - a.trim.height || (a.name < b.name ? -1 : 1));
  for (const it of items)
    if (it.trim.width + 2 * slot > maxPage || it.trim.height + 2 * slot > maxPage)
      throw new RangeError(`frame ${it.name} (${it.trim.width}x${it.trim.height}) does not fit a ${maxPage}px page`);

  // greedy page assignment: fill a page until its shelf layout exceeds maxPage
  const placePage = (list: typeof items, size: number) => {
    let x = slot;
    let y = slot;
    let row = 0;
    const out: { name: string; x: number; y: number; item: (typeof items)[number] }[] = [];
    for (const it of list) {
      const w = it.trim.width;
      const h = it.trim.height;
      if (x + w + slot > size) {
        x = slot;
        y += row + 2 * slot;
        row = 0;
      }
      if (y + h + slot > size) return null;
      out.push({ name: it.name, x, y, item: it });
      x += w + 2 * slot;
      row = Math.max(row, h);
    }
    return out;
  };

  const groups: (typeof items)[] = [];
  let rest = items;
  while (rest.length) {
    let take = rest.length;
    // largest prefix of `rest` that fits one maxPage page
    while (take > 1 && !placePage(rest.slice(0, take), maxPage)) take = Math.floor(take * 0.9) || 1;
    while (take < rest.length && placePage(rest.slice(0, take + 1), maxPage)) take++;
    groups.push(rest.slice(0, take));
    rest = rest.slice(take);
  }

  const trims = new Map<string, Trim>();
  const pageOf = new Map<string, number>();
  const pages: PackedPage[] = groups.map((g, pi) => {
    let size = 64;
    let layout = placePage(g, size);
    while (!layout) {
      size = nextPow2(size + 1);
      layout = placePage(g, size);
    }
    const image = createImage(size, size);
    const regions: AtlasData['regions'][number][] = [];
    for (const p of layout) {
      const t = p.item.trim;
      const src = p.item.image;
      // copy the trim, then extrude its border by PACK_EXTRUDE px (premultiplied edge replicate)
      for (let yy = -PACK_EXTRUDE; yy < t.height + PACK_EXTRUDE; yy++)
        for (let xx = -PACK_EXTRUDE; xx < t.width + PACK_EXTRUDE; xx++) {
          const sx = t.x + Math.min(t.width - 1, Math.max(0, xx));
          const sy = t.y + Math.min(t.height - 1, Math.max(0, yy));
          const o = (sy * src.width + sx) * 4;
          const d = ((p.y + yy) * size + (p.x + xx)) * 4;
          for (let k = 0; k < 4; k++) image.data[d + k] = src.data[o + k]!;
        }
      regions.push({ name: p.name, x: p.x, y: p.y, width: t.width, height: t.height });
      trims.set(p.name, t);
      pageOf.set(p.name, pi);
    }
    return {
      image,
      data: { imagePath: imagePath(pi), width: size, height: size, premultipliedAlpha: true, regions },
    };
  });
  return { pages, trims, pageOf };
}
