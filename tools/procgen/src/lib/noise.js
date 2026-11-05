'use strict';
/**
 * Hai loại noise:
 *  - Simplex 2D (Gustavson) có seed: dùng cho địa hình thế giới (không cần lặp).
 *  - Value noise LẶP CHU KỲ trên hình vuông đơn vị (u, v): dùng cho texture bên trong
 *    tile, để tile hình thoi ghép liền mép với chính nó và với các biến thể khác.
 */
const { mulberry32, lerp } = require('./rng');

function makeSimplex2D(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  const corner = (g, x, y) => {
    let t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    t *= t;
    return t * t * (g[0] * x + g[1] * y);
  };

  return function simplex(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const n0 = corner(grad[perm[ii + perm[jj]] & 7], x0, y0);
    const n1 = corner(grad[perm[ii + i1 + perm[jj + j1]] & 7], x1, y1);
    const n2 = corner(grad[perm[ii + 1 + perm[jj + 1]] & 7], x2, y2);
    return 70 * (n0 + n1 + n2); // xấp xỉ [-1, 1]
  };
}

/** fBm trên một hàm noise bất kỳ, trả về xấp xỉ [-1, 1]. */
function fbm(noiseFn, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noiseFn(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Hash số nguyên 2D + seed -> [0, 1). */
function hash2i(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Value noise lặp với chu kỳ `period` ô lưới trên hình vuông đơn vị.
 * f(u + 1, v) = f(u, v) và f(u, v + 1) = f(u, v)  ->  tile ghép liền mép.
 */
function periodicNoise(u, v, period, seed) {
  const x = u * period, y = v * period;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (k) => ((k % period) + period) % period;
  const a = hash2i(w(x0), w(y0), seed), b = hash2i(w(x0 + 1), w(y0), seed);
  const c = hash2i(w(x0), w(y0 + 1), seed), d = hash2i(w(x0 + 1), w(y0 + 1), seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

/** fBm lặp chu kỳ: các tầng có chu kỳ base, 2·base, 4·base… nên vẫn lặp trên [0, 1). */
function periodicFbm(u, v, basePeriod, seed, octaves = 4) {
  let amp = 1, sum = 0, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u, v, period, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm; // [0, 1)
}

module.exports = { makeSimplex2D, fbm, hash2i, periodicNoise, periodicFbm };
