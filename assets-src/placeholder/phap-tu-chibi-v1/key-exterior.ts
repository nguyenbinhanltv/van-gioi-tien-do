/** Key white backdrop/gaps, preserving enclosed warm skin/cloth regions and their highlights. */
import type { Image } from '@vgtd/rig';
import { KEY_MAGENTA } from '@vgtd/sprite';

export function keyExteriorWhite(source: Image): Image {
  const { width, height } = source;
  const data = new Uint8ClampedArray(source.data);
  const seen = new Uint8Array(width * height);
  const regions: {
    pixels: number[];
    exterior: boolean;
    warm: boolean;
    left: number;
    right: number;
    top: number;
    bottom: number;
  }[] = [];
  for (let start = 0; start < width * height; start++) {
    const queue: number[] = [];
    const push = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const pixel = y * width + x;
      if (seen[pixel]) return;
      seen[pixel] = 1;
      const offset = pixel * 4;
      if (Math.hypot(255 - data[offset]!, 255 - data[offset + 1]!, 255 - data[offset + 2]!) > 150) return;
      queue.push(pixel);
    };
    push(start % width, Math.floor(start / width));
    if (!queue.length) continue;
    let exterior = false;
    let warmCount = 0;
    let left = width,
      right = 0,
      top = height,
      bottom = 0;
    for (let index = 0; index < queue.length; index++) {
      const pixel = queue[index]!;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      exterior ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const offset = pixel * 4;
      if (data[offset]! - data[offset + 1]! > 4 && data[offset + 1]! - data[offset + 2]! > 4) warmCount++;
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
    regions.push({ pixels: queue, exterior, warm: warmCount / queue.length > 0.25, left, right, top, bottom });
  }
  const protectedRegions = regions.filter((region) => !region.exterior && region.warm);
  for (const region of regions) {
    const enclosedHighlight = protectedRegions.some(
      (bounds) =>
        region.left >= bounds.left &&
        region.right <= bounds.right &&
        region.top >= bounds.top &&
        region.bottom <= bounds.bottom,
    );
    if (!region.exterior && (region.warm || enclosedHighlight)) continue;
    for (const pixel of region.pixels) data.set([...KEY_MAGENTA, 255], pixel * 4);
  }
  return { width, height, data };
}
