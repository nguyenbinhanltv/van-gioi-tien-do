'use strict';
/**
 * Bộ mã hóa PNG tối giản, không phụ thuộc thư viện ngoài (chỉ dùng zlib của Node).
 * Ảnh RGBA 8 bit, filter 0 cho mọi dòng. Đủ dùng cho sprite sheet và ảnh xem trước.
 */
const zlib = require('zlib');
const fs = require('fs');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** Ảnh RGBA trong bộ nhớ, có vẽ chồng (alpha "source-over") và sao chép thô. */
class Image {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  setPixel(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }

  getPixel(x, y) {
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  fill(r, g, b, a) {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
    }
  }

  /** Vẽ ảnh src lên (dx, dy) với alpha blending. */
  drawImage(src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= this.width) continue;
        const si = (y * src.width + x) * 4;
        const sa = src.data[si + 3] / 255;
        if (sa <= 0) continue;
        const di = (ty * this.width + tx) * 4;
        const da = this.data[di + 3] / 255;
        const oa = sa + da * (1 - sa);
        for (let c = 0; c < 3; c++) {
          this.data[di + c] = (src.data[si + c] * sa + this.data[di + c] * da * (1 - sa)) / oa;
        }
        this.data[di + 3] = oa * 255;
      }
    }
  }

  /** Sao chép thô (không blend) – dùng khi đóng gói atlas. */
  blit(src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= this.height) continue;
      const srow = y * src.width * 4;
      const drow = (ty * this.width + dx) * 4;
      this.data.set(src.data.subarray(srow, srow + src.width * 4), drow);
    }
  }

  toPNG() {
    const { width, height, data } = this;
    const stride = width * 4 + 1;
    const raw = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      raw[y * stride] = 0; // filter: None
      Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * stride + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  save(path) {
    fs.writeFileSync(path, this.toPNG());
  }
}

/** Đọc kích thước từ header PNG mà không giải nén (dùng cho kiểm định nhanh). */
function readPNGSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Không phải file PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25] };
}

/**
 * Giải mã PNG 8 bit không xen kẽ (RGBA, RGB, xám, xám + alpha) thành Image RGBA.
 * Đủ cho ảnh do resvg, script này và hầu hết công cụ đồ họa xuất ra.
 */
function decodePNG(buf) {
  const { width, height, bitDepth, colorType } = readPNGSize(buf);
  if (bitDepth !== 8) throw new Error(`Chỉ hỗ trợ PNG 8 bit (file là ${bitDepth} bit)`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Kiểu màu PNG ${colorType} chưa hỗ trợ (cần RGBA/RGB/xám)`);
  if (buf[28] !== 0) throw new Error('PNG xen kẽ (interlaced) chưa hỗ trợ');
  const idat = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const img = new Image(width, height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      if (channels === 4) { img.data[d] = line[s]; img.data[d + 1] = line[s + 1]; img.data[d + 2] = line[s + 2]; img.data[d + 3] = line[s + 3]; }
      else if (channels === 3) { img.data[d] = line[s]; img.data[d + 1] = line[s + 1]; img.data[d + 2] = line[s + 2]; img.data[d + 3] = 255; }
      else if (channels === 2) { img.data[d] = img.data[d + 1] = img.data[d + 2] = line[s]; img.data[d + 3] = line[s + 1]; }
      else { img.data[d] = img.data[d + 1] = img.data[d + 2] = line[s]; img.data[d + 3] = 255; }
    }
    prev = line;
  }
  return img;
}

/** Thu nhỏ bằng trung bình vùng có trọng số alpha (giữ viền icon không bị quầng đen). */
function resizeArea(src, w, h) {
  const out = new Image(w, h);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx, y0 = y * sy, y1 = (y + 1) * sy;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const k = wx * wy, i = (yy * src.width + xx) * 4, al = src.data[i + 3] / 255;
          r += src.data[i] * al * k; g += src.data[i + 1] * al * k; b += src.data[i + 2] * al * k;
          a += al * k; area += k;
        }
      }
      out.setPixel(x, y, a ? r / a : 0, a ? g / a : 0, a ? b / a : 0, (a / area) * 255);
    }
  }
  return out;
}

module.exports = { Image, crc32, readPNGSize, decodePNG, resizeArea };
