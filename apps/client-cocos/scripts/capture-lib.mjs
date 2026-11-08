// Tiny dependency-free image helpers for scripts/capture.mjs: PNG decode / box-resize / encode, contact sheets, GIF encoder.
import { deflateSync, inflateSync } from 'node:zlib';

/** Decode an 8-bit, non-interlaced PNG (grey, RGB, RGBA) to {width, height, data: RGBA}. */
export function decodePng(buf) {
  let o = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error('unsupported PNG (need 8-bit, non-interlaced)');
      ct = body[9];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!bpp) throw new Error(`unsupported PNG colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const data = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h; i++) {
    if (bpp === 4) px.copy(data, i * 4, i * 4, i * 4 + 4);
    else if (bpp === 3) px.copy(data, i * 4, i * 3, i * 3 + 3);
    else {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = px[i * bpp];
      if (bpp === 2) data[i * 4 + 3] = px[i * 2 + 1];
    }
  }
  return { width: w, height: h, data };
}

/** Box-filter downscale by an integer factor. */
export function downscale(img, k) {
  const w = Math.floor(img.width / k);
  const h = Math.floor(img.height / k);
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let dy = 0; dy < k; dy++)
          for (let dx = 0; dx < k; dx++) s += img.data[((y * k + dy) * img.width + x * k + dx) * 4 + c];
        data[(y * w + x) * 4 + c] = Math.round(s / (k * k));
      }
    }
  }
  return { width: w, height: h, data };
}

let table;
function crc32(buf) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(img) {
  const { width: w, height: h, data } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Tiles in reading order on a dark background, `cols` per row. */
export function contactSheet(imgs, cols) {
  const tw = imgs[0].width;
  const th = imgs[0].height;
  const rows = Math.ceil(imgs.length / cols);
  const sheet = { width: cols * tw, height: rows * th, data: Buffer.alloc(cols * tw * rows * th * 4) };
  for (let i = 0; i < sheet.data.length; i += 4) sheet.data.writeUInt32BE(0x0b0e17ff, i);
  imgs.forEach((im, n) => {
    const ox = (n % cols) * tw;
    const oy = Math.floor(n / cols) * th;
    for (let y = 0; y < th; y++)
      im.data.copy(sheet.data, ((oy + y) * sheet.width + ox) * 4, y * tw * 4, (y + 1) * tw * 4);
    // 1 px tile border + a small index mark so frames can be referred to by number
    for (let x = 0; x < tw; x++)
      for (const y of [0, th - 1]) sheet.data.writeUInt32BE(0x2c3550ff, ((oy + y) * sheet.width + ox + x) * 4);
    for (let y = 0; y < th; y++)
      for (const x of [0, tw - 1]) sheet.data.writeUInt32BE(0x2c3550ff, ((oy + y) * sheet.width + ox + x) * 4);
    for (let k = 0; k <= n % 24; k++) {
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 2; dx++)
          sheet.data.writeUInt32BE(0xffe36bff, ((oy + 4 + dy) * sheet.width + ox + 4 + k * 4 + dx) * 4);
    }
  });
  return sheet;
}

/** Animated GIF (looping) with a fixed 6x6x6 colour cube palette. delayCs = centiseconds per frame. */
export function encodeGif(frames, delayCs) {
  const { width: w, height: h } = frames[0];
  const out = [];
  const u16 = (n) => [n & 255, n >> 8];
  out.push(Buffer.from('GIF89a'), Buffer.from([...u16(w), ...u16(h), 0xf7, 0, 0]));
  const pal = Buffer.alloc(256 * 3);
  for (let i = 0; i < 216; i++) {
    pal[i * 3] = Math.floor(i / 36) * 51;
    pal[i * 3 + 1] = (Math.floor(i / 6) % 6) * 51;
    pal[i * 3 + 2] = (i % 6) * 51;
  }
  out.push(pal, Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]));
  for (const f of frames) {
    out.push(Buffer.from([0x21, 0xf9, 4, 0, ...u16(delayCs), 0, 0]));
    out.push(Buffer.from([0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0, 8]));
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = Math.round(f.data[i * 4] / 51);
      const g = Math.round(f.data[i * 4 + 1] / 51);
      const b = Math.round(f.data[i * 4 + 2] / 51);
      idx[i] = r * 36 + g * 6 + b;
    }
    out.push(lzw(idx, 8));
  }
  out.push(Buffer.from([0x3b]));
  return Buffer.concat(out);
}

function lzw(indices, minCode) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const bytes = [];
  let cur = 0;
  let bits = 0;
  let size = minCode + 1;
  const emit = (code) => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(cur & 255);
      cur >>= 8;
      bits -= 8;
    }
  };
  let dict = new Map();
  let next = eoi + 1;
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) prefix = hit;
    else {
      emit(prefix);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > 1 << size && size < 12) size++;
      } else {
        emit(clear);
        dict = new Map();
        next = eoi + 1;
        size = minCode + 1;
      }
      prefix = k;
    }
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) bytes.push(cur & 255);
  const blocks = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const part = bytes.slice(i, i + 255);
    blocks.push(Buffer.from([part.length, ...part]));
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}
