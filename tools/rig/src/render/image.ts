/**
 * Minimal RGBA raster + PNG codec (Node built-in zlib only, no native deps). Pixels are stored **premultiplied** so
 * compositing is `out = src + dst·(1 − srcA)` and additive blends are a plain add.
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bit, premultiplied alpha. */
  readonly data: Uint8ClampedArray;
}

export function createImage(
  width: number,
  height: number,
  fill: readonly [number, number, number, number] = [0, 0, 0, 0],
): Image {
  const data = new Uint8ClampedArray(width * height * 4);
  const a = fill[3] / 255;
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0] * a;
    data[i * 4 + 1] = fill[1] * a;
    data[i * 4 + 2] = fill[2] * a;
    data[i * 4 + 3] = fill[3];
  }
  return { width, height, data };
}

// ------------------------------------------------------------------ PNG
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export interface EncodeOptions {
  /**
   * Write the premultiplied colour as it is (a premultiplied atlas page: `premultipliedAlpha: true` in the tex file).
   * Default false: the PNG is straight alpha (colour un-premultiplied), the usual file format.
   */
  readonly premultiplied?: boolean;
}

/** Encode as an RGBA PNG: straight alpha by default, or raw premultiplied colour with `{ premultiplied: true }`. */
export function encodePng(img: Image, opts: EncodeOptions = {}): Buffer {
  const { width, height, data } = img;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3]!;
      const o = y * (width * 4 + 1) + 1 + x * 4;
      const un = opts.premultiplied ? 1 : a === 0 ? 0 : 255 / a; // un-premultiply unless writing a premultiplied page
      raw[o] = Math.min(255, Math.round(data[i]! * un));
      raw[o + 1] = Math.min(255, Math.round(data[i + 1]! * un));
      raw[o + 2] = Math.min(255, Math.round(data[i + 2]! * un));
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface DecodeOptions {
  /** The file already stores premultiplied colour (atlas flag `premultipliedAlpha`): do not multiply again. */
  readonly premultiplied?: boolean;
}

/** Decode 8-bit non-interlaced PNG (grey, RGB, palette, grey+alpha, RGBA) into a premultiplied `Image`. */
export function decodePng(buf: Buffer, opts: DecodeOptions = {}): Image {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error(`unsupported PNG bit depth ${body[8]}`);
      colorType = body[9]!;
      if (body[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'tRNS') trns = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? px[row + x - channels]! : 0;
      const b = y > 0 ? px[row - stride + x]! : 0;
      const c = x >= channels && y > 0 ? px[row - stride + x - channels]! : 0;
      let out: number;
      if (f === 0) out = v;
      else if (f === 1) out = v + a;
      else if (f === 2) out = v + b;
      else if (f === 3) out = v + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[row + x] = out & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r: number;
    let g: number;
    let b: number;
    let a = 255;
    const o = i * channels;
    if (colorType === 6) [r, g, b, a] = [px[o]!, px[o + 1]!, px[o + 2]!, px[o + 3]!];
    else if (colorType === 2) [r, g, b] = [px[o]!, px[o + 1]!, px[o + 2]!];
    else if (colorType === 0) r = g = b = px[o]!;
    else if (colorType === 4) {
      r = g = b = px[o]!;
      a = px[o + 1]!;
    } else {
      const idx = px[o]!;
      if (!palette) throw new Error('palette PNG without PLTE');
      [r, g, b] = [palette[idx * 3]!, palette[idx * 3 + 1]!, palette[idx * 3 + 2]!];
      if (trns && idx < trns.length) a = trns[idx]!;
    }
    const m = opts.premultiplied ? 1 : a / 255;
    data[i * 4] = r * m;
    data[i * 4 + 1] = g * m;
    data[i * 4 + 2] = b * m;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}
