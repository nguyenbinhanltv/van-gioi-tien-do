/** Optional single geometric resampling pass on premultiplied pixels. */
import { createImage, type Image } from '@vgtd/rig';

export type ResampleMethod = 'bilinear' | 'lanczos3' | 'area';

export function validateResample(value: string): asserts value is ResampleMethod {
  if (!['bilinear', 'lanczos3', 'area'].includes(value)) throw new Error(`unknown resampling method '${value}'`);
}

interface Tap {
  readonly index: number;
  readonly weight: number;
}
const sinc = (x: number) => (Math.abs(x) < 1e-10 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

function weights(length: number, scale: number, offset: number, method: Exclude<ResampleMethod, 'bilinear'>): Tap[][] {
  return Array.from({ length }, (_, out) => {
    const center = (out + 0.5 - offset) / scale;
    const taps: Tap[] = [];
    if (method === 'area') {
      const left = (out - offset) / scale,
        right = (out + 1 - offset) / scale;
      for (let i = Math.floor(left); i < Math.ceil(right); i++) {
        const weight = Math.max(0, Math.min(right, i + 1) - Math.max(left, i)) / (right - left);
        if (weight > 0) taps.push({ index: i, weight });
      }
    } else {
      const cutoff = Math.min(1, scale),
        radius = 3 / cutoff;
      let sum = 0;
      for (let i = Math.ceil(center - radius - 0.5); i <= Math.floor(center + radius - 0.5); i++) {
        const d = (i + 0.5 - center) * cutoff;
        const weight = Math.abs(d) < 3 ? sinc(d) * sinc(d / 3) : 0;
        taps.push({ index: i, weight });
        sum += weight;
      }
      return taps.map((t) => ({ index: t.index, weight: t.weight / sum }));
    }
    return taps;
  });
}

/** Pixel edges map as output = source * scale + offset; outside pixels are transparent. */
export function resampleAffine(
  src: Image,
  width: number,
  height: number,
  transform: { readonly scaleX: number; readonly scaleY: number; readonly dx: number; readonly dy: number },
  method: Exclude<ResampleMethod, 'bilinear'>,
): Image {
  validateResample(method);
  const { scaleX, scaleY, dx, dy } = transform;
  if (
    ![scaleX, scaleY].every((v) => Number.isFinite(v) && v > 0) ||
    ![dx, dy].every(Number.isFinite) ||
    ![width, height].every((v) => Number.isSafeInteger(v) && v > 0)
  )
    throw new RangeError('invalid resampling transform');
  const xs = weights(width, scaleX, dx, method),
    ys = weights(height, scaleY, dy, method);
  // Separable convolution keeps floating-point rows, not a resized/quantized intermediate image.
  const rows = new Map<number, Float64Array>();
  const row = (y: number) => {
    let cached = rows.get(y);
    if (cached) return cached;
    cached = new Float64Array(width * 4);
    for (let x = 0; x < width; x++)
      for (const t of xs[x]!) {
        if (t.index < 0 || t.index >= src.width) continue;
        const p = (y * src.width + t.index) * 4;
        for (let k = 0; k < 4; k++) cached[x * 4 + k]! += src.data[p + k]! * t.weight;
      }
    rows.set(y, cached);
    return cached;
  };
  const out = createImage(width, height);
  for (let y = 0; y < height; y++) {
    const sum = new Float64Array(width * 4);
    for (const t of ys[y]!) {
      if (t.index < 0 || t.index >= src.height) continue;
      const r = row(t.index);
      for (let i = 0; i < sum.length; i++) sum[i]! += r[i]! * t.weight;
    }
    for (let x = 0; x < width; x++) {
      const p = x * 4,
        o = (y * width + x) * 4;
      const alpha = Math.round(Math.max(0, Math.min(255, sum[p + 3]!)));
      out.data[o + 3] = alpha;
      for (let k = 0; k < 3; k++) out.data[o + k] = Math.round(Math.max(0, Math.min(alpha, sum[p + k]!)));
    }
  }
  return out;
}
