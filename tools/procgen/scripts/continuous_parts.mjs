/** Deterministic TRACK 2 art preparation. Geometry is supplied by the art manifest. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Image, decodePNG, resizeArea } = require('../src/lib/png.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const options = {};
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) {
    positional.push(arg);
    continue;
  }
  const key = arg.slice(2);
  if (!['source', 'dir', 'manifest', 'master'].includes(key) || !process.argv[i + 1])
    throw new Error(`Unknown or incomplete option ${arg}`);
  options[key] = process.argv[++i];
}
const mode = positional[0] ?? 'process';
const defaultSource = path.join(root, 'assets-src/placeholder/kiem-tu-continuous-v1');
const source = options.source ? path.resolve(root, options.source) : defaultSource;
const direction = options.dir ?? 'E';
const manifestPath = path.resolve(
  root,
  options.manifest ??
    (mode === 'masks' && positional[2] ? positional[2] : path.join(source, `${direction}.parts.json`)),
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const masterPath = options.master
  ? path.resolve(root, options.master)
  : manifest.reference4x
    ? path.resolve(root, manifest.reference4x)
    : path.join(source, `reference/${direction}.master4x.png`);
const master = decodePNG(fs.readFileSync(masterPath));
if (master.width !== 512 || master.height !== 512) throw new Error('Master must be a 512x512 @4x RGBA image');
if (source !== defaultSource && !manifest.paletteSamples)
  throw new Error('A different character must supply paletteSamples in its geometry manifest');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const silhouette = new Uint8Array(512 * 512);
const silhouetteMargin = manifest.silhouetteMargin4x ?? 3;
if (!Number.isFinite(silhouetteMargin) || silhouetteMargin < 0 || silhouetteMargin > 16)
  throw new Error('silhouetteMargin4x must be between 0 and 16');
const silhouetteRadius = Math.ceil(silhouetteMargin);
for (let y = 0; y < 512; y++)
  for (let x = 0; x < 512; x++) {
    // Leave half a texture pixel for AA/downsampling inside the permitted two-pixel rest deviation.
    for (let dy = -silhouetteRadius; dy <= silhouetteRadius && !silhouette[y * 512 + x]; dy++)
      for (let dx = -silhouetteRadius; dx <= silhouetteRadius; dx++) {
        if (
          dx * dx + dy * dy > silhouetteMargin * silhouetteMargin ||
          x + dx < 0 ||
          y + dy < 0 ||
          x + dx >= 512 ||
          y + dy >= 512
        )
          continue;
        if (master.getPixel(x + dx, y + dy)[3] >= 128) {
          silhouette[y * 512 + x] = 1;
          break;
        }
      }
  }

function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i],
      [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distance(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

function maskFor(part) {
  const mask = new Image(512, 512);
  mask.fill(0, 0, 0, 255);
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      const u = (x + 0.5) / 2,
        v = (y + 0.5) / 2;
      if (
        (part.polygons ?? []).some((p) => inPolygon(u, v, p)) ||
        (part.segments ?? []).some((s) => distance(u, v, s.a, s.b) <= s.r)
      )
        mask.setPixel(x, y, 255, 255, 255, 255);
    }
  return mask;
}

function bounds(image, threshold = 127, mask = false) {
  let x0 = image.width,
    y0 = image.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      if (image.getPixel(x, y)[mask ? 0 : 3] > threshold) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  if (x1 < x0) throw new Error('Empty part or region mask');
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function material(c) {
  const [r, g, b] = c,
    l = luminance(c);
  if (l < 92) return 'hair';
  if (b > r + 3 || (b > r - 5 && b > g - 8 && l < 175)) return 'blue';
  if (r > b + 18 && r > g + 8 && l > 140) return 'skin';
  if (r > b + 17 && r > g + 5 && l < 160) return 'gold';
  return 'cloth';
}

const palettes = {};
const sampleRegions = manifest.paletteSamples ?? {
  cloth: [
    [115, 91, 124, 115],
    [120, 118, 126, 126],
    [113, 197, 139, 201],
  ],
  skin: [
    [134, 54, 142, 65],
    [123, 136, 128, 143],
  ],
  blue: [
    [114, 146, 136, 180],
    [127, 88, 133, 107],
  ],
  gold: [
    [111, 190, 136, 194],
    [118, 80, 122, 83],
  ],
  jade: [[99, 31, 109, 39]],
  hair: [
    [108, 54, 119, 101],
    [117, 209, 125, 222],
  ],
};
const paletteFilters =
  manifest.paletteFilters ??
  (source === defaultSource
    ? {
        cloth: { minLuma: 145 },
        hair: { maxLuma: 125 },
        blue: { maxLuma: 180, maxRedMinusBlue: 5 },
        skin: { minLuma: 140 },
        gold: { minLuma: 110, minRedMinusBlue: 12 },
        jade: { minGreenMinusRed: 4, minGreenMinusBlue: -3 },
      }
    : {});
for (let y = 0; y < master.height; y++)
  for (let x = 0; x < master.width; x++) {
    const c = master.getPixel(x, y);
    if (c[3] < 240) continue;
    for (const [name, regions] of Object.entries(sampleRegions)) {
      if (!regions.some(([x0, y0, x1, y1]) => x / 2 >= x0 && x / 2 <= x1 && y / 2 >= y0 && y / 2 <= y1)) continue;
      const l = luminance(c);
      const f = paletteFilters[name] ?? {};
      if (
        (f.minLuma !== undefined && l < f.minLuma) ||
        (f.maxLuma !== undefined && l > f.maxLuma) ||
        (f.minRedMinusBlue !== undefined && c[0] - c[2] < f.minRedMinusBlue) ||
        (f.maxRedMinusBlue !== undefined && c[0] - c[2] > f.maxRedMinusBlue) ||
        (f.minGreenMinusRed !== undefined && c[1] - c[0] < f.minGreenMinusRed) ||
        (f.minGreenMinusBlue !== undefined && c[1] - c[2] < f.minGreenMinusBlue)
      )
        continue;
      (palettes[name] ??= []).push(c);
    }
  }
for (const colors of Object.values(palettes)) colors.sort((a, b) => luminance(a) - luminance(b));

// Remove translucent background haze and isolated speckles; retain antialias only next to opaque paint.
function cleanAlpha(image) {
  const opaque = new Uint8Array(image.width * image.height),
    seen = new Uint8Array(opaque.length);
  const components = [];
  let maxAlpha = 0;
  for (let i = 0; i < opaque.length; i++) maxAlpha = Math.max(maxAlpha, image.data[i * 4 + 3]);
  const threshold = Math.min(160, maxAlpha * 0.7);
  for (let i = 0; i < opaque.length; i++)
    opaque[i] = image.data[i * 4 + 3] >= threshold && image.data[i * 4 + 3] > 0 ? 1 : 0;
  for (let i = 0; i < opaque.length; i++) {
    if (!opaque[i] || seen[i]) continue;
    const queue = [i];
    seen[i] = 1;
    for (let k = 0; k < queue.length; k++) {
      const p = queue[k],
        x = p % image.width,
        y = Math.floor(p / image.width);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const u = x + dx,
          v = y + dy,
          q = v * image.width + u;
        if (u < 0 || v < 0 || u >= image.width || v >= image.height || seen[q] || !opaque[q]) continue;
        seen[q] = 1;
        queue.push(q);
      }
    }
    components.push(queue);
  }
  components.sort((a, b) => b.length - a.length);
  const keep = new Uint8Array(opaque.length);
  for (const component of components.filter(
    (c) => c.length >= Math.max(Math.min(5, components[0]?.length ?? 1), (components[0]?.length ?? 0) * 0.01),
  ))
    for (const p of component) keep[p] = 1;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const p = y * image.width + x;
      if (keep[p]) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (
            x + dx >= 0 &&
            y + dy >= 0 &&
            x + dx < image.width &&
            y + dy < image.height &&
            keep[(y + dy) * image.width + x + dx]
          ) {
            near = true;
            break;
          }
        }
      if (!near || image.data[p * 4 + 3] < 8) image.setPixel(x, y, 0, 0, 0, 0);
    }
}

function processPart(part) {
  const filename = path.join(source, 'raw', direction, `${part.id}.png`);
  if (!fs.existsSync(filename)) return null;
  const raw = decodePNG(fs.readFileSync(filename));
  let image = resizeArea(raw, 512, 512);
  const turns = part.sourceQuarterTurns ?? 0;
  if (!Number.isInteger(turns) || turns < 0 || turns > 3)
    throw new Error('sourceQuarterTurns must be an integer between 0 and 3');
  for (let turn = 0; turn < turns; turn++) {
    const rotated = new Image(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) rotated.setPixel(511 - y, x, ...image.getPixel(x, y));
    image = rotated;
  }
  if (part.sourceBounds4x) {
    const [x0, y0, x1, y1] = part.sourceBounds4x;
    if (![x0, y0, x1, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 >= 512 || y1 >= 512 || x1 < x0 || y1 < y0)
      throw new Error('sourceBounds4x must be inclusive bounds inside the normalized 512 canvas');
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) if (x < x0 || y < y0 || x > x1 || y > y1) image.setPixel(x, y, 0, 0, 0, 0);
  }
  if (part.id !== 'shadow') cleanAlpha(image);
  const guide = maskFor(part);
  const before = bounds(image, part.id === 'shadow' ? 1 : 8),
    target = bounds(guide, 127, true);
  const registered = new Image(512, 512);
  // Bounding-box registration preserves the generated contour and shared-canvas intent.
  // A silhouette comparison is reported separately; registration alone is not acceptance.
  const crop = new Image(before.width, before.height);
  for (let y = 0; y < before.height; y++)
    for (let x = 0; x < before.width; x++) crop.setPixel(x, y, ...image.getPixel(x + before.x0, y + before.y0));
  const fitted = resizeArea(crop, target.width, target.height);
  for (let y = 0; y < fitted.height; y++)
    for (let x = 0; x < fitted.width; x++) registered.setPixel(x + target.x0, y + target.y0, ...fitted.getPixel(x, y));
  const contourFit = part.registration
    ? part.registration === 'contour'
    : /^(arm_[LR]|leg_[LR]|torso|vest|robe_front|robe_back|robe_inner|sash_knot|ribbon_tail_[LR])$/.test(part.id);
  if (contourFit) {
    // Fit each continuous cross-section to the neutral art guide. This registers the curved front skirt,
    // fully painted hidden hips and round limb caps instead of leaving the generated trapezoid unchanged.
    registered.fill(0, 0, 0, 0);
    const rows = [];
    for (let y = before.y0; y <= before.y1; y++) {
      let lo = 512,
        hi = -1;
      for (let x = before.x0; x <= before.x1; x++)
        if (image.getPixel(x, y)[3] >= 128) {
          lo = Math.min(lo, x);
          hi = x;
        }
      if (hi >= lo) rows.push({ y, lo, hi });
    }
    for (let y = target.y0; y <= target.y1; y++) {
      let lo = 512,
        hi = -1;
      for (let x = target.x0; x <= target.x1; x++)
        if (guide.getPixel(x, y)[0] >= 128) {
          lo = Math.min(lo, x);
          hi = x;
        }
      if (hi < lo) continue;
      const sourceY = before.y0 + ((y - target.y0) * (before.height - 1)) / Math.max(1, target.height - 1);
      const row = rows.reduce((best, r) => (Math.abs(r.y - sourceY) < Math.abs(best.y - sourceY) ? r : best));
      for (let x = lo; x <= hi; x++) {
        const u = Math.round(row.lo + ((x - lo) * (row.hi - row.lo)) / Math.max(1, hi - lo));
        const c = image.getPixel(u, row.y);
        registered.setPixel(x, y, ...c.slice(0, 3), x === lo || x === hi ? 192 : 255);
      }
    }
  }
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++)
      if ((part.excludePolygons ?? []).some((polygon) => inPolygon(x / 2, y / 2, polygon)))
        registered.setPixel(x, y, 0, 0, 0, 0);
  const groups = {};
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      const c = registered.getPixel(x, y);
      if (c[3] < 8) continue;
      const region = (part.materialRegions ?? []).find((r) => inPolygon(x / 2, y / 2, r.polygon));
      const inferred = material(c);
      const name =
        region?.material ??
        (part.materialRegions || part.materials.length === 1
          ? part.materials[0]
          : (part.materialAliases?.[inferred] ?? inferred));
      const key = part.materials.includes(name) ? name : part.materials[0];
      (groups[key] ??= []).push({ x, y, c });
    }
  const transfer = {};
  for (const [name, pixels] of Object.entries(groups)) {
    const palette = palettes[name];
    if (!palette?.length) throw new Error(`No master palette for ${name}`);
    pixels.sort((a, b) => luminance(a.c) - luminance(b.c));
    for (let i = 0; i < pixels.length; i++) {
      const { x, y, c } = pixels[i];
      const q = 0.05 + (0.9 * i) / Math.max(1, pixels.length - 1),
        targetColor = palette[Math.round(q * (palette.length - 1))];
      const rgb = c.slice(0, 3).map((v, k) => Math.round(v * 0.25 + targetColor[k] * 0.75));
      registered.setPixel(x, y, ...rgb, c[3]);
    }
    transfer[name] = { pixels: pixels.length, masterSamples: palette.length, paletteBlend: 0.75 };
  }
  let silhouetteClipped4x = 0;
  if (part.clipToMaster !== false && !['shadow', 'sword_trail', 'sword_glint'].includes(part.id)) {
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        if (!silhouette[y * 512 + x] && registered.getPixel(x, y)[3] > 0) {
          registered.setPixel(x, y, 0, 0, 0, 0);
          silhouetteClipped4x++;
        }
      }
  }
  if (part.id === 'shadow') {
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const c = registered.getPixel(x, y);
        registered.setPixel(x, y, 25, 27, 30, Math.min(51, c[3]));
      }
  }
  if (manifest.edgeDefringe) {
    const original = new Uint8ClampedArray(registered.data);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4,
          alpha = original[i + 3];
        if (alpha === 0 || alpha >= 250) continue;
        let nearest = null,
          best = Infinity;
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            const u = x + dx,
              v = y + dy,
              d = dx * dx + dy * dy;
            if (u < 0 || v < 0 || u >= 512 || v >= 512 || d >= best) continue;
            const j = (v * 512 + u) * 4;
            if (original[j + 3] < 250) continue;
            best = d;
            nearest = original.slice(j, j + 3);
          }
        const color = original.slice(i, i + 3);
        if (nearest && luminance(color) > luminance(nearest) + 12) registered.setPixel(x, y, ...nearest, alpha);
      }
  }
  const final = resizeArea(registered, 256, 256);
  fs.mkdirSync(path.join(source, direction), { recursive: true });
  final.save(path.join(source, direction, `${part.id}.png`));
  return {
    id: part.id,
    rawSize: [raw.width, raw.height],
    generatedBounds4x: before,
    registeredBounds4x: target,
    transfer,
    silhouetteClipped4x,
    registration: contourFit ? 'continuous cross-section fit to neutral mask' : 'alpha-weighted bounds fit',
    finalBounds2x: bounds(final, part.id === 'shadow' ? 1 : 8),
  };
}

if (mode === 'licenses') {
  if (source !== defaultSource || direction !== 'E')
    throw new Error('The KT3 license writer is Kiếm tu E specific; maintain other character provenance separately');
  const filename = path.join(root, 'docs/ASSET-LICENSES.md');
  const marker = '\n## KT3 — Kiếm tu chi liền, pilot E (2026-11-06 UTC)\n';
  const existing = fs.readFileSync(filename, 'utf8');
  const previous = existing.split(marker)[0];
  const start = existing.indexOf(marker);
  const followingStart = start < 0 ? -1 : existing.indexOf('\n## ', start + marker.length);
  const following = followingStart < 0 ? '' : existing.slice(followingStart);
  const entries = manifest.parts
    .map((p) => path.join(source, 'raw', direction, `${p.id}.generation.json`))
    .concat(
      fs.existsSync(path.join(source, 'raw', direction, 'history'))
        ? fs
            .readdirSync(path.join(source, 'raw', direction, 'history'))
            .filter((p) => p.endsWith('.generation.json'))
            .map((p) => path.join(source, 'raw', direction, 'history', p))
        : [],
    )
    .filter(fs.existsSync)
    .map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
  let section =
    marker +
    '\nNguồn gốc: master concept A / KT2 (`assets-src/placeholder/kiem-tu-rig-v1/turnaround/E.png`), phóng bằng Lanczos tiền nhân alpha lên @4x. Các mảnh mới do `image_gen.imagegen` sinh riêng từ master và mask vùng; model **không công bố (undisclosed)**; CLI `codex-cli 0.164.0`. Chủ art tạm: người dùng. Điều khoản công cụ: https://openai.com/policies/row-terms-of-use/ ; giữ nhãn placeholder của KT2, cần duyệt nguồn gốc và quyền sử dụng trước phát hành. Không thêm nguồn bên thứ ba.\n\nHậu xử lý bằng mã `tools/procgen/scripts/continuous_parts.mjs`: bỏ halo alpha / đốm rời, đăng ký bounding box về mask, chuyển bảng màu theo từng vật liệu bằng mẫu từ master (75% màu mẫu, 25% ảnh sinh), giới hạn silhouette nghỉ trong biên master + 2 px @2x, downsample @4x→@2x. Mask hình học và nhãn vật liệu được tác giả chỉnh thủ công trong `E.parts.json`; mốc khớp chỉnh thủ công trong `E/landmarks.json`. Không tô pixel thủ công lên ảnh đầu ra. Ánh sáng NW và đồng nhất phong cách vẫn phải duyệt bằng mắt; đăng ký không tự chứng minh cổng QA.\n\nĐường dẫn ảnh thô được chọn: `assets-src/placeholder/kiem-tu-continuous-v1/raw/E/<id>.png`; ảnh RGBA @2x: `assets-src/placeholder/kiem-tu-continuous-v1/E/<id>.png`; mask tái tạo từ manifest bằng lệnh `node tools/procgen/scripts/continuous_parts.mjs masks <thư-mục-tạm>`. Mỗi JSON cạnh ảnh thô giữ prompt và tham chiếu gốc.\n';
  section +=
    '\n[Cập nhật KT3] Đăng ký cuối dùng cross-section liên tục cho thân, chi, vạt váy, nút đai và dải tóc; các chi tiết nhỏ dùng area resampling để không mất nét mắt/miệng. Các chỉnh sửa mask thủ công gồm bổ sung búi tóc riêng, mở rộng cổ/ngực dưới đầu, cạnh trước vạt váy và nút đai; giữ cả mask lúc sinh (`raw/E/<id>.mask.png`) và guide cuối trong manifest. PNG nguồn là straight alpha; chỉ atlas/export là PMA. Bóng riêng giới hạn alpha 20%. Kiểm tra rest composite chạy bằng mode `check`; không thay thế kiểm tra mesh khi chuyển động.\n';
  section +=
    '\nChỉnh bảng màu ngọc (không đổi alpha): thêm mẫu jade riêng từ trâm concept A cho trâm và mặt dây; tránh ánh xanh ngọc bị phân loại thành vải xanh hoặc vàng. Đây là hậu xử lý màu bằng mã, không phải lần sinh ảnh mới.\n';
  section +=
    '\n[Cập nhật KT3 — quần ngà và lót khe váy] Hai chân sinh lại từ master, chân cũ và mask; giữ ảnh/prompt cũ trong raw/E/history. Nhãn vật liệu chỉnh thủ công: quần ngà, boot charcoal, viền đế sáng; nếp lót ngà rộng 6 px @2x ở cạnh sau robe_front và cạnh trước robe_back, giữ các dải gấu vàng riêng. Hậu xử lý màu bằng mã, không tô pixel thủ công; alpha từng chân/panel và landmarks giữ nguyên. Rest composite maxExtra/maxMissing 2 px.\n';
  for (const e of entries)
    section += `\n### KT3 / ${e.id}\n\n- UTC bắt đầu: ${e.utcStart}; công cụ: ${e.tool}; model: ${e.model}; CLI: ${e.cli}.\n- Đầu vào: master E @4x + mask riêng của mảnh từ manifest. Đầu ra: \`${e.selectedOutput}\`.\n- Prompt đầy đủ:\n\n\`\`\`text\n${e.prompt}\n\`\`\`\n`;
  fs.writeFileSync(filename, previous + section + following);
  console.log(`Logged ${entries.length} generation prompts`);
} else if (mode === 'check') {
  const master2x = manifest.reference2x
    ? decodePNG(fs.readFileSync(path.resolve(root, manifest.reference2x)))
    : resizeArea(master, 256, 256);
  const composite = new Image(256, 256);
  const images = new Map();
  for (const part of manifest.parts) {
    const image = decodePNG(fs.readFileSync(path.join(source, direction, `${part.id}.png`)));
    if (image.width !== 256 || image.height !== 256) throw new Error(`${part.id}: expected RGBA256 canvas`);
    if (!image.data.some((v, i) => i % 4 === 3 && v > 8)) throw new Error(`${part.id}: empty alpha`);
    images.set(part.id, image);
  }
  for (const id of manifest.restOrder) composite.drawImage(images.get(id), 0, 0);
  const nearest = (x, y, image) => {
    let best = 20;
    for (let v = Math.max(0, y - 20); v <= Math.min(255, y + 20); v++)
      for (let u = Math.max(0, x - 20); u <= Math.min(255, x + 20); u++) {
        if (image.getPixel(u, v)[3] >= 128) best = Math.min(best, Math.hypot(u - x, v - y));
      }
    return best;
  };
  let extraPixels = 0,
    missingPixels = 0,
    maxExtraPx = 0,
    maxMissingPx = 0;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const actual = composite.getPixel(x, y)[3] >= 128,
        expected = master2x.getPixel(x, y)[3] >= 128;
      if (actual && !expected) {
        extraPixels++;
        maxExtraPx = Math.max(maxExtraPx, nearest(x, y, master2x));
      }
      if (expected && !actual) {
        missingPixels++;
        maxMissingPx = Math.max(maxMissingPx, nearest(x, y, composite));
      }
    }
  const result = {
    sourceParts: images.size,
    canvas2x: [256, 256],
    alphaThreshold: 128,
    extraPixels,
    missingPixels,
    maxExtraPx,
    maxMissingPx,
    pass: maxExtraPx <= 2 && maxMissingPx <= 2,
  };
  if (positional[1]) fs.writeFileSync(positional[1], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
} else if (mode === 'masks') {
  const out = positional[1];
  if (!out) throw new Error('Usage: node continuous_parts.mjs masks <working-directory>');
  fs.mkdirSync(out, { recursive: true });
  for (const part of manifest.parts) maskFor(part).save(path.join(out, `${part.id}_mask4x.png`));
  console.log(`Wrote ${manifest.parts.length} part masks`);
} else {
  const reports = manifest.parts
    .map((part) => {
      try {
        return processPart(part);
      } catch (error) {
        throw new Error(`${part.id}: ${error.message}`, { cause: error });
      }
    })
    .filter(Boolean);
  const out = positional[1];
  if (out)
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          method: 'alpha cleanup, bounds registration, per-material ranked palette transfer 75%, area downsample',
          reports,
        },
        null,
        2,
      ) + '\n',
    );
  console.log(
    JSON.stringify(
      reports.map((r) => ({ id: r.id, bounds: r.finalBounds2x })),
      null,
      2,
    ),
  );
}
