/** Animated GIF89a encoder (fixed 6×7×6 colour cube palette, LZW, infinite loop). Frames must share one size. */
import type { Image } from './image.js';

const LEVELS = { r: 6, g: 7, b: 6 };
const PALETTE_SIZE = 256;

function buildPalette(): Uint8Array {
  const pal = new Uint8Array(PALETTE_SIZE * 3);
  let n = 0;
  for (let r = 0; r < LEVELS.r; r++) {
    for (let g = 0; g < LEVELS.g; g++) {
      for (let b = 0; b < LEVELS.b; b++) {
        pal[n * 3] = Math.round((r * 255) / (LEVELS.r - 1));
        pal[n * 3 + 1] = Math.round((g * 255) / (LEVELS.g - 1));
        pal[n * 3 + 2] = Math.round((b * 255) / (LEVELS.b - 1));
        n++;
      }
    }
  }
  return pal;
}

/** Map RGB to the cube index with a 4×4 ordered dither (keeps soft gradients readable at 252 colours). */
function indexFrame(img: Image): Uint8Array {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const out = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const a = img.data[i + 3]! / 255 || 1;
      const t = (bayer[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * 0.4;
      const q = (v: number, levels: number) => {
        const f = (v / a / 255) * (levels - 1) + t;
        return Math.max(0, Math.min(levels - 1, Math.round(f)));
      };
      out[y * img.width + x] =
        (q(img.data[i]!, LEVELS.r) * LEVELS.g + q(img.data[i + 1]!, LEVELS.g)) * LEVELS.b +
        q(img.data[i + 2]!, LEVELS.b);
    }
  }
  return out;
}

function lzw(indices: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const bytes: number[] = [];
  let cur = 0;
  let curBits = 0;
  let size = minCode + 1;
  let dict = new Map<string, number>();
  let next = eoi + 1;
  const emit = (code: number) => {
    cur |= code << curBits;
    curBits += size;
    while (curBits >= 8) {
      bytes.push(cur & 255);
      cur >>>= 8;
      curBits -= 8;
    }
  };
  const reset = () => {
    dict = new Map();
    next = eoi + 1;
    size = minCode + 1;
  };
  emit(clear);
  let prefix = String.fromCharCode(indices[0]!);
  for (let i = 1; i < indices.length; i++) {
    const ch = String.fromCharCode(indices[i]!);
    const key = prefix + ch;
    if (dict.has(key)) {
      prefix = key;
      continue;
    }
    emit(prefix.length === 1 ? prefix.charCodeAt(0) : dict.get(prefix)!);
    dict.set(key, next++);
    // the decoder's table is one entry behind the encoder's: the code width grows once `next` passes 2^size
    if (next > 1 << size && size < 12) size++;
    if (next >= 4096) {
      emit(clear);
      reset();
    }
    prefix = ch;
  }
  emit(prefix.length === 1 ? prefix.charCodeAt(0) : dict.get(prefix)!);
  emit(eoi);
  if (curBits > 0) bytes.push(cur & 255);
  return Uint8Array.from(bytes);
}

/** `delayMs` per frame (GIF resolution is 10 ms). */
export function encodeGif(frames: readonly Image[], delayMs: number): Buffer {
  const first = frames[0];
  if (!first) throw new RangeError('no frames');
  const { width, height } = first;
  const out: number[] = [];
  const w16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  out.push(...Buffer.from('GIF89a', 'ascii'));
  w16(width);
  w16(height);
  out.push(0xf7, 0, 0); // global colour table, 8 bits, no sort
  out.push(...buildPalette());
  out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 3, 1, 0, 0, 0); // loop forever
  const delay = Math.max(2, Math.round(delayMs / 10));
  for (const f of frames) {
    if (f.width !== width || f.height !== height) throw new RangeError('all GIF frames must have the same size');
    out.push(0x21, 0xf9, 4, 0, delay & 255, (delay >> 8) & 255, 0, 0); // graphic control
    out.push(0x2c);
    w16(0);
    w16(0);
    w16(width);
    w16(height);
    out.push(0);
    out.push(8); // LZW min code size
    const data = lzw(indexFrame(f), 8);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      out.push(n, ...data.subarray(i, i + n));
    }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}
