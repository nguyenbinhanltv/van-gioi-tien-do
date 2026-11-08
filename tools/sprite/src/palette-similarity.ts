/** D55 palette gate: marginal CIELab(D65) transport over current opaque pixels. */
import type { Image } from '@vgtd/rig';
import type { SimilarityBox } from './similarity-crops.js';
/** D55 owner-calibrated hard distance ceilings; lower is better. */
export const HEAD_PALETTE_LAB_MAX = 15;
export const TORSO_PALETTE_LAB_MAX = 23;

/** sRGB -> linear RGB -> XYZ D65 -> CIELab relative to D65. Values are Lab units, not CSS lab(D50). */
export function srgbLabD65(r: number, g: number, b: number): readonly [number, number, number] {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = linear(r),
    G = linear(g),
    B = linear(b);
  const f = (v: number) => (v > 216 / 24389 ? Math.cbrt(v) : ((24389 / 27) * v + 16) / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
type Palette = { channels: Float64Array[]; opaque: number };
function palette(image: Image, box: SimilarityBox): Palette {
  const channels = [new Float64Array(101), new Float64Array(256), new Float64Array(256)];
  let opaque = 0;
  for (let y = Math.max(0, Math.ceil(box.top)); y < Math.min(image.height, Math.ceil(box.bottom)); y++)
    for (let x = Math.max(0, Math.ceil(box.left)); x < Math.min(image.width, Math.ceil(box.right)); x++) {
      const i = (y * image.width + x) * 4,
        alpha = image.data[i + 3]!;
      if (alpha < 250) continue;
      const lab = srgbLabD65(
        (image.data[i]! * 255) / alpha,
        (image.data[i + 1]! * 255) / alpha,
        (image.data[i + 2]! * 255) / alpha,
      );
      opaque++;
      for (let c = 0; c < 3; c++) {
        const bin = Math.max(0, Math.min(channels[c]!.length - 1, Math.round(lab[c]! + (c ? 128 : 0))));
        channels[c]![bin]!++;
      }
    }
  if (!opaque) throw new Error('Lab palette window has no opaque pixels');
  for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i]! /= opaque;
  return { channels, opaque };
}
export interface LabPaletteDistance {
  readonly distance: number;
  readonly chroma: number;
  readonly lightness: number;
  readonly axes: readonly [number, number, number];
  readonly opaqueMaster: number;
  readonly opaqueFrame: number;
}
/** Per-axis 1-Wasserstein distance on 1-Lab-unit histograms; Euclidean combination of the three marginal distances. */
export function labPaletteDistance(
  master: Image,
  frame: Image,
  m: SimilarityBox,
  f: SimilarityBox,
): LabPaletteDistance {
  const a = palette(master, m),
    b = palette(frame, f);
  const axes = a.channels.map((channel, c) => {
    let cumulative = 0,
      distance = 0;
    for (let i = 0; i < channel.length - 1; i++) {
      cumulative += channel[i]! - b.channels[c]![i]!;
      distance += Math.abs(cumulative);
    }
    return distance;
  }) as [number, number, number];
  return {
    distance: Math.hypot(...axes),
    chroma: Math.hypot(axes[1], axes[2]),
    lightness: axes[0],
    axes,
    opaqueMaster: a.opaque,
    opaqueFrame: b.opaque,
  };
}
