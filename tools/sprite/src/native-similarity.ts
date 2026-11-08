/** D55 native-pixel SSIM, Wang et al. (2004) Eq13; no scale/rotation registration. */
import type { Image } from '@vgtd/rig';
import type { SimilarityBox } from './similarity-crops.js';
export interface RegisteredSsim {
  readonly score: number;
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
  readonly colour: number;
  readonly alphaIou: number;
}
export const SIMILARITY_TRANSLATION_RADIUS = 3;
const C1 = (0.01 * 255) ** 2,
  C2 = (0.03 * 255) ** 2;
function luma(image: Image): Float32Array {
  const data = new Float32Array(image.width * image.height);
  // BT.601 luma on premultiplied RGB; transparent background stays black.
  for (let i = 0; i < data.length; i++)
    data[i] = 0.299 * image.data[i * 4]! + 0.587 * image.data[i * 4 + 1]! + 0.114 * image.data[i * 4 + 2]!;
  return data;
}
function sample(data: Float32Array, image: Image, box: SimilarityBox, x: number, y: number): number {
  if (
    x < box.left ||
    x >= box.right ||
    y < box.top ||
    y >= box.bottom ||
    x < 0 ||
    y < 0 ||
    x > image.width - 1 ||
    y > image.height - 1
  )
    return 0;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(image.width - 1, x0 + 1),
    y1 = Math.min(image.height - 1, y0 + 1),
    fx = x - x0,
    fy = y - y0;
  return (
    data[y0 * image.width + x0]! * (1 - fx) * (1 - fy) +
    data[y0 * image.width + x1]! * fx * (1 - fy) +
    data[y1 * image.width + x0]! * (1 - fx) * fy +
    data[y1 * image.width + x1]! * fx * fy
  );
}
/** Fixed physical-pixel canvas, centred on each annotated window; never fit one crop to another's dimensions. */
export function registeredNativeSsim(master: Image, frame: Image, m: SimilarityBox, f: SimilarityBox): RegisteredSsim {
  const width = Math.max(2, Math.ceil(Math.max(m.right - m.left, f.right - f.left))),
    height = Math.max(2, Math.ceil(Math.max(m.bottom - m.top, f.bottom - f.top))),
    n = width * height;
  const mx = (m.left + m.right) / 2,
    my = (m.top + m.bottom) / 2,
    fx = (f.left + f.right) / 2,
    fy = (f.top + f.bottom) / 2,
    r = SIMILARITY_TRANSLATION_RADIUS;
  const a = new Float64Array(n),
    extendedWidth = width + 2 * r,
    extended = new Float64Array(extendedWidth * (height + 2 * r)),
    lm = luma(master),
    lf = luma(frame);
  let sumA = 0,
    sumAA = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = sample(lm, master, m, mx + x - (width - 1) / 2, my + y - (height - 1) / 2);
      a[y * width + x] = v;
      sumA += v;
      sumAA += v * v;
    }
  for (let y = 0; y < height + 2 * r; y++)
    for (let x = 0; x < extendedWidth; x++)
      extended[y * extendedWidth + x] = sample(
        lf,
        frame,
        f,
        fx + x - r - (width - 1) / 2,
        fy + y - r - (height - 1) / 2,
      );
  const meanA = sumA / n,
    varA = Math.max(0, (sumAA - (sumA * sumA) / n) / (n - 1));
  let best: RegisteredSsim = { score: -Infinity, dx: 0, dy: 0, width, height, colour: 0, alphaIou: 0 };
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      let sumB = 0,
        sumBB = 0,
        sumAB = 0;
      for (let y = 0; y < height; y++) {
        const start = (y + dy + r) * extendedWidth + dx + r;
        for (let x = 0; x < width; x++) {
          const b = extended[start + x]!;
          sumB += b;
          sumBB += b * b;
          sumAB += a[y * width + x]! * b;
        }
      }
      const meanB = sumB / n,
        varB = Math.max(0, (sumBB - (sumB * sumB) / n) / (n - 1)),
        cov = (sumAB - (sumA * sumB) / n) / (n - 1);
      const score = Math.max(
        0,
        Math.min(
          1,
          ((2 * meanA * meanB + C1) * (2 * cov + C2)) / ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2)),
        ),
      );
      if (
        score > best.score + 1e-12 ||
        (Math.abs(score - best.score) <= 1e-12 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))
      )
        best = { score, dx, dy, width, height, colour: 0, alphaIou: 0 };
    }
  return { ...best, ...appearance(master, frame, m, f, width, height, best.dx, best.dy) };
}

/** Optional diagnostics at the structural registration; no component floors are implied here. */
function appearance(
  master: Image,
  frame: Image,
  m: SimilarityBox,
  f: SimilarityBox,
  width: number,
  height: number,
  dx: number,
  dy: number,
): { colour: number; alphaIou: number } {
  const ma = new Float64Array(48),
    fa = new Float64Array(48),
    mp = new Float64Array(4),
    fp = new Float64Array(4);
  let mn = 0,
    fn = 0,
    intersection = 0,
    union = 0;
  const pixel = (image: Image, box: SimilarityBox, x: number, y: number, out: Float64Array) => {
    out.fill(0);
    if (
      x < box.left ||
      x >= box.right ||
      y < box.top ||
      y >= box.bottom ||
      x < 0 ||
      y < 0 ||
      x > image.width - 1 ||
      y > image.height - 1
    )
      return;
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0,
      x1 = Math.min(image.width - 1, x0 + 1),
      y1 = Math.min(image.height - 1, y0 + 1);
    for (let c = 0; c < 4; c++)
      out[c] =
        image.data[(y0 * image.width + x0) * 4 + c]! * (1 - fx) * (1 - fy) +
        image.data[(y0 * image.width + x1) * 4 + c]! * fx * (1 - fy) +
        image.data[(y1 * image.width + x0) * 4 + c]! * (1 - fx) * fy +
        image.data[(y1 * image.width + x1) * 4 + c]! * fx * fy;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      pixel(master, m, (m.left + m.right) / 2 + x - (width - 1) / 2, (m.top + m.bottom) / 2 + y - (height - 1) / 2, mp);
      pixel(
        frame,
        f,
        (f.left + f.right) / 2 + x - (width - 1) / 2 + dx,
        (f.top + f.bottom) / 2 + y - (height - 1) / 2 + dy,
        fp,
      );
      const a = mp[3]! >= 128,
        b = fp[3]! >= 128;
      if (a || b) union++;
      if (a && b) intersection++;
      if (mp[3]! >= 250) {
        mn++;
        for (let c = 0; c < 3; c++) ma[c * 16 + Math.min(15, Math.floor((mp[c]! * 255) / mp[3]! / 16))]!++;
      }
      if (fp[3]! >= 250) {
        fn++;
        for (let c = 0; c < 3; c++) fa[c * 16 + Math.min(15, Math.floor((fp[c]! * 255) / fp[3]! / 16))]!++;
      }
    }
  let colour = 0;
  if (mn && fn) for (let i = 0; i < 48; i++) colour += Math.sqrt(((ma[i]! / mn) * fa[i]!) / fn) / 3;
  return { colour: Math.min(1, colour), alphaIou: union ? intersection / union : 1 };
}
