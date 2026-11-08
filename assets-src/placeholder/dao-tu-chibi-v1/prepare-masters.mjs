/* global process, console */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  keyOut,
  defringe,
  removeFragments,
  crop,
  toStraight,
  toPremultiplied,
  placeScaled,
  measureFigure,
} from '@vgtd/sprite';

// Class art construction values and hand-reviewed points live in the sidecar.
// This calibrates masters only; motion frames retain their separate fixed DPI calibration.
const root = resolve('assets-src/placeholder/dao-tu-chibi-v1');
const ref = join(root, 'reference');
const spec = JSON.parse(readFileSync(join(ref, 'master-landmarks.json'), 'utf8'));
const raw = decodePng(readFileSync(join(ref, spec.source)));
const cleaned = removeFragments(defringe(keyOut(toStraight(raw))));
const front = spec.views.find((v) => v.direction === 'S');
const scale = spec.targetHeight / (front.soleY - front.crown[1]);
const views = [];
// The AI's weapon grips cross equal-panel boundaries. Crop in reviewed empty gaps;
// landmark coordinates remain in their original equal-panel coordinate system.
const panelBoundaries = [0, 330, 750, 1200, 1560, raw.width];
for (const [i, view] of spec.views.entries()) {
  const landmarkPanelX = Math.round((i * raw.width) / spec.views.length);
  const x0 = panelBoundaries[i];
  const x1 = panelBoundaries[i + 1];
  const coordinateOffsetX = landmarkPanelX - x0;
  const panel = crop(cleaned.image, x0, 0, x1 - x0, raw.height);
  const sourceBounds = measureFigure(panel);
  if (!sourceBounds) throw new Error(`Empty master ${view.direction}`);
  const axisX = view.axisX + coordinateOffsetX;
  const dx = CELL_PX / 2 - scale * axisX;
  const dy = spec.ground - scale * view.soleY;
  const projected = {
    left: sourceBounds.left * scale + dx,
    right: sourceBounds.right * scale + dx,
    top: sourceBounds.top * scale + dy,
    bottom: sourceBounds.bottom * scale + dy,
  };
  const noCanvasLoss =
    projected.left >= 0 && projected.top >= 0 && projected.right <= CELL_PX && projected.bottom <= CELL_PX;
  const anatomicalHeight = (view.soleY - view.crown[1]) * scale;
  const heightPass = Math.abs(anatomicalHeight / spec.targetHeight - 1) <= 0.03;
  const headRatio = view.chin ? (view.chin[1] - view.crown[1]) / (view.soleY - view.crown[1]) : null;
  const eyeRatio = view.eyesY ? (view.eyesY - view.crown[1]) / (view.soleY - view.crown[1]) : null;
  if (
    !noCanvasLoss ||
    !heightPass ||
    (headRatio !== null && (headRatio < 0.2 || headRatio > 0.24)) ||
    (eyeRatio !== null && (eyeRatio < 0.15 || eyeRatio > 0.17))
  ) {
    throw new Error(
      `Master gate failed ${JSON.stringify({ direction: view.direction, projected, anatomicalHeight, headRatio, eyeRatio })}`,
    );
  }
  const master = placeScaled(toPremultiplied(panel), scale, axisX, view.soleY, CELL_PX / 2, spec.ground, CELL_PX);
  writeFileSync(join(ref, `${view.direction}.master-native.png`), encodePng(toPremultiplied(panel)));
  writeFileSync(join(ref, `${view.direction}.master.png`), encodePng(master));
  const point = ([x, y]) => ({ x: (x + coordinateOffsetX) * scale + dx, y: y * scale + dy });
  const masterHead = {
    kind: view.kind ?? 'crown-chin',
    crown: point(view.crown),
    ...(view.chin ? { chin: point(view.chin) } : {}),
    ...(view.shoulderTop
      ? { shoulderTop: { left: point(view.shoulderTop[0]), right: point(view.shoulderTop[1]) } }
      : {}),
    breadth: { left: point(view.breadth[0]), right: point(view.breadth[1]) },
  };
  views.push({
    direction: view.direction,
    panel: [x0, 0, x1 - x0, raw.height],
    landmarkPanelX,
    coordinateOffsetX,
    scale,
    dx,
    dy,
    anatomicalHeight,
    headRatio,
    eyeRatio,
    sourceBounds,
    projected,
    noCanvasLoss,
    heightPass,
    outputBounds: measureFigure(master),
    masterHead,
  });
}
writeFileSync(join(ref, 'T1.master.png'), readFileSync(join(ref, 'S.master.png')));
const report = {
  character: 'dao-tu-chibi-v1',
  method: spec.method,
  scale,
  targetHeight: spec.targetHeight,
  cell: CELL_PX,
  ground: spec.ground,
  removedFragments: cleaned.removed,
  views,
  status: 'manual construction and projected native-alpha bounds pass; motion QA not run',
};
writeFileSync(join(root, 'character-calibration.json'), JSON.stringify(report, null, 2) + '\n');
// Separate sheet DPI: one common source-to-216 scale for all tier references.
// T1 stays the turnaround master; the tier sheet's redrawn T1 is comparison only.
const tierSource = 'raw/T1-T5.front.storm-grey-blue.png';
const tierRaw = decodePng(readFileSync(join(ref, tierSource)));
const tierClean = removeFragments(defringe(keyOut(toStraight(tierRaw))));
const tierScale = spec.targetHeight / (669 - 52);
const tierBoundaries = [0, 408, 793, 1178, 1598, tierRaw.width];
const tierAxes = [218, 606, 990, 1378, 1806];
const tiers = [];
for (let i = 1; i < 5; i++) {
  const x0 = tierBoundaries[i];
  const panel = crop(tierClean.image, x0, 0, tierBoundaries[i + 1] - x0, tierRaw.height);
  const axis = tierAxes[i] - x0;
  const master = placeScaled(toPremultiplied(panel), tierScale, axis, 669, CELL_PX / 2, spec.ground, CELL_PX);
  const sourceBounds = measureFigure(panel);
  const projected = {
    left: (sourceBounds.left - axis) * tierScale + CELL_PX / 2,
    right: (sourceBounds.right - axis) * tierScale + CELL_PX / 2,
    top: (sourceBounds.top - 669) * tierScale + spec.ground,
    bottom: (sourceBounds.bottom - 669) * tierScale + spec.ground,
  };
  if (projected.left < 0 || projected.top < 0 || projected.right > CELL_PX || projected.bottom > CELL_PX)
    throw new Error(`Tier canvas loss T${i + 1}`);
  writeFileSync(join(ref, `T${i + 1}.master-native.png`), encodePng(toPremultiplied(panel)));
  writeFileSync(join(ref, `T${i + 1}.master.png`), encodePng(master));
  tiers.push({
    tier: i + 1,
    source: tierSource,
    panel: [x0, 0, tierBoundaries[i + 1] - x0, tierRaw.height],
    scale: tierScale,
    sourceBounds,
    projected,
    status: 'front edit reference; no motion/variant gate run',
  });
}
writeFileSync(
  join(ref, 'tier-calibration.json'),
  JSON.stringify(
    {
      scale: tierScale,
      referenceCrownY: 52,
      referenceSoleY: 669,
      tiers,
      note: 'One common tier-sheet scale. Canonical T1 from turnaround, not tier redraw.',
    },
    null,
    2,
  ) + '\n',
);
const files = [];
function hashTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) hashTree(path);
    else if (entry.name !== 'sha256.json')
      files.push({
        path: path.slice(root.length + 1).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      });
  }
}
hashTree(root);
writeFileSync(join(ref, 'sha256.json'), JSON.stringify(files, null, 2) + '\n');
const reviewIndex = process.argv.indexOf('--review-out');
if (reviewIndex >= 0) {
  const out = resolve(process.argv[reviewIndex + 1]);
  const data = (name) => 'data:image/png;base64,' + readFileSync(join(ref, name)).toString('base64');
  const cards = spec.views
    .map(
      (v) =>
        `<article><h3>${v.direction}</h3><img width="256" height="256" src="${data(v.direction + '.master.png')}" alt="Đao tu T1 ${v.direction}"></article>`,
    )
    .join('');
  const tierCards = [1, 2, 3, 4, 5]
    .map(
      (t) =>
        `<article><h3>T${t}</h3><img width="256" height="256" src="${data('T' + t + '.master.png')}" alt="Đao tu T${t} phía trước"></article>`,
    )
    .join('');
  const rows = views
    .map(
      (v) =>
        `<tr><td>${v.direction}</td><td>${v.anatomicalHeight.toFixed(2)}</td><td>${v.headRatio ? (v.headRatio * 100).toFixed(2) + '%' : 'D50: gáy bị tóc che'}</td><td>${v.eyeRatio ? (v.eyeRatio * 100).toFixed(2) + '%' : 'không thấy mắt'}</td><td>${v.noCanvasLoss ? 'Đạt' : 'Lỗi'}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Đao tu · Master T1 & T1–T5</title><style>*{box-sizing:border-box}body{margin:0;background:#eeeae1;color:#263d48;font:16px/1.6 system-ui}main{max-width:1420px;margin:auto;padding:40px 24px}h1{font-size:48px;line-height:1.12}h2{font-size:28px}section{margin:30px 0;background:white;padding:24px;border-radius:16px}.eyebrow{letter-spacing:2px;font-size:12px;font-weight:700;color:#6b8095}.cards{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-around}.cards article{text-align:center}.cards img{background:repeating-conic-gradient(#e1e5e5 0% 25%,#f5f5f1 0% 50%) 50%/16px 16px;object-fit:contain;display:block;width:256px;height:256px}.small .cards img{width:128px;height:128px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:10px;border-bottom:1px solid #dde3e4}.note{border-left:3px solid #7892a7;padding-left:16px}button{padding:10px 18px;background:#294653;color:white;border:0;border-radius:6px;cursor:pointer}.tag{background:#dce7e7;padding:6px 12px;border-radius:20px;display:inline-block}details{margin:20px 0}summary{cursor:pointer;font-weight:bold}a{color:#286582}@media(max-width:600px){main{padding:24px 12px}h1{font-size:34px}section{padding:14px}}</style><main><header><p class="eyebrow">VẠN GIỚI TIÊN ĐỒ · ĐAO TU · STORM REAVER A</p><h1>Thép núi mực.<br>Sắc xám xanh bão.</h1><p class="tag">Checkpoint master · Chưa phải nghiệm thu motion</p><p>Nam, dáng gọn, đao nặng trên vai, tóc đen buộc thấp và mắt xám. T1 giản lược đồ kim loại / tranh núi; T3–T5 giữ nền teal tối, nhấn storm grey-blue, trắng gió hạn chế.</p><button onclick="document.body.classList.toggle('small')">Đổi xem 1× / 2×</button><p>Mặc định: ảnh 256 texture px hiển thị 256 CSS px (2×). Nút 1× hiển thị 128 CSS px. Đây là PNG master, <b>không phải capture Cocos</b>.</p></header><section><p class="eyebrow">T1 · NĂM HƯỚNG VẼ</p><h2>Cùng khuôn mặt, cùng một scale</h2><div class="cards">${cards}</div><p class="note">Một scale ${scale.toFixed(10)} cho toàn turnaround; S cao đúng216px. Không fit riêng từng hướng. Crop nằm trong khoảng trống nguồn để giữ nguyên tay cầm / lưỡi đao; alpha bounds bao gồm tóc rời và vũ khí, khác H giải phẫu.</p><table><tr><th>Hướng</th><th>H @2×</th><th>Đầu / H</th><th>Mắt / H</th><th>Canvas</th></tr>${rows}</table><p>NE/N: ponytail che gáy; lưu crown, hai đầu shoulderTop và breadth theo D50. Không bịa cằm / skull base. Các tỉ lệ phía trước dùng landmark thủ công đã ghi, không dùng bbox vũ khí.</p></section><section><p class="eyebrow">T1–T5 · FRONT EDIT MASTERS</p><h2>Trang phục tiến triển, bản sắc giữ lại</h2><div class="cards">${tierCards}</div><p>T1 ở đây là master S canonical; không dùng bản T1 được AI vẽ lại trong sheet tier. T2–T5 từ sheet riêng được chuẩn bị bằng một scale chung, giữ nguồn trước / sau sửa màu.</p><p class="note">Các tier là đầu vào edit sau này; chưa chạy cổng variant/pose/face theo từng motion. Chi tiết mặt / nét tóc có drift nhỏ do AI; không tuyên bố pixel-identical. Chưa tạo hướng khác cho T2–T5.</p></section><section><h2>Trạng thái cổng</h2><p><b>Đã chạy:</b> đo landmark master, cùng scale, H±3%, đầu20–24%, mắt15–17% ở hướng thấy mặt, projected native-alpha canvas bounds, kiểm ảnh normalized và crop.</p><p><b>Chưa chạy:</b> full15clip smooth-v2, D47/48/50 trên từng frame động, footslide / loop / palette / similarity, D45 body–weapon–FX, exporter, capture thật Cocos Creator3.8.8 ở2×. Chưa mở PR.</p><p>Clip Đao tu theo D49: attack chém ngang nặng; attack_2 quét cung; attack_3 giáng đất; dash xung kích; channel xoáy đao; cast gầm nộ. Phong còn là đề xuất.</p><details><summary>Nguồn gốc và phép chuẩn bị</summary><p>Built-in image_gen.imagegen; model không được công bố. Chỉ reference dự án: gói concept worker32 và master dẫn xuất. Prompt / UTC / repair lineage / SHA256 lưu trong reference/*.json và raw/*.png. KeyOut → defringe → removeFragments theo public @vgtd/sprite; crop giữ pixel nguồn; placeScaled chuẩn bị master một lần; không scale riêng motion frame. Native sources được giữ nguyên.</p><p><a href="https://openai.com/policies/row-terms-of-use/">OpenAI Output terms</a> kiểm tra2026-11-08; quyền Output theo điều khoản, không gắn nhãn stock/CC0. Bộ master chưa import runtime.</p></details></section></main></html>`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}
console.log(
  JSON.stringify(
    {
      scale,
      views: views.map(({ direction, anatomicalHeight, headRatio, eyeRatio, noCanvasLoss }) => ({
        direction,
        anatomicalHeight,
        headRatio,
        eyeRatio,
        noCanvasLoss,
      })),
      tiers: tiers.length,
    },
    null,
    2,
  ),
);
