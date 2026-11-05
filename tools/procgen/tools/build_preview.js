#!/usr/bin/env node
'use strict';
/**
 * Ghép các file shader vào một trang HTML xem trước tự chứa (mở thẳng bằng trình duyệt,
 * không cần server). Shader chỉ có một nguồn duy nhất là thư mục shaders/.
 *   node tools/build_preview.js   ->  preview/shader_preview.html
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sh = (f) => fs.readFileSync(path.join(root, 'shaders', f), 'utf8');
const embed = (id, src) => `<script type="x-shader" id="${id}">\n${src}\n</script>`;

const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Xem trước shader – Lôi Kiếp & Kim Quang</title>
<style>
  :root { color-scheme: dark; --bg: #11141c; --panel: #1a1f2b; --text: #e6e2d8; --muted: #9aa0ad; --accent: #e8b540; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 1320px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); }
  section { background: var(--panel); border-radius: 10px; padding: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 0 0 8px; }
  p { margin: 0 0 8px; color: var(--muted); }
  .stage { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 6px; overflow: hidden; background: #0d1018; }
  .stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  #kq { width: 100%; aspect-ratio: 1; border-radius: 6px; background: #1d2230; display: block; }
  label { display: flex; gap: 8px; align-items: center; margin-top: 8px; color: var(--muted); }
  input[type=range] { flex: 1; accent-color: var(--accent); }
  @media (max-width: 860px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <section>
    <h1>Lôi Kiếp Giáng Lâm</h1>
    <p>Chạm hoặc bấm lên mặt đất để giáng một đạo sét; tự đánh mỗi 1,4 giây. Không dùng texture hay chuỗi ảnh.</p>
    <div class="stage"><canvas id="ground"></canvas><canvas id="lk"></canvas></div>
    <label>Cường độ kiếp <input id="intensity" type="range" min="0.4" max="2" step="0.1" value="1.4"></label>
    <label><input id="flash" type="checkbox" checked> Chớp màn hình</label>
  </section>
  <section>
    <h2>Kim Quang Hộ Thể</h2>
    <p>Bấm lên khiên để tạo đòn đánh và gợn sóng.</p>
    <canvas id="kq" width="512" height="512"></canvas>
    <label>Độ mạnh khiên <input id="strength" type="range" min="0" max="1" step="0.05" value="1"></label>
  </section>
</main>
${embed('fullscreen-vert', sh('fullscreen.vert'))}
${embed('loi-kiep-frag', sh('loi_kiep.frag'))}
${embed('sprite-vert', sh('sprite_quad.vert'))}
${embed('kim-quang-frag', sh('kim_quang.frag'))}
<script>
'use strict';
const src = (id) => document.getElementById(id).textContent;
function makeProgram(gl, vs, fs) {
  const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const fit = (c, scale) => { const r = c.getBoundingClientRect(); c.width = Math.round(r.width * scale); c.height = Math.round(r.height * scale); };
const t0 = performance.now(); const now = () => (performance.now() - t0) / 1000;

// ---------------- Nền đất isometric vẽ bằng Canvas 2D ----------------
const ground = document.getElementById('ground');
function drawGround() {
  fit(ground, devicePixelRatio);
  const g = ground.getContext('2d'), W = ground.width, H = ground.height, s = W / 1280;
  const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#1a1c2c'); grd.addColorStop(1, '#2c3326');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(160, 190, 140, 0.18)'; g.lineWidth = 1;
  for (let k = -40; k < 40; k++) {
    g.beginPath(); g.moveTo((640 + k * 64) * s, 360 * s); g.lineTo((640 + k * 64 + 720) * s, (360 + 360) * s); g.stroke();
    g.beginPath(); g.moveTo((640 + k * 64) * s, 360 * s); g.lineTo((640 + k * 64 - 720) * s, (360 + 360) * s); g.stroke();
  }
}

// ---------------- Lôi Kiếp ----------------
const lkCanvas = document.getElementById('lk');
const lk = lkCanvas.getContext('webgl', { premultipliedAlpha: true, alpha: true });
const lkProg = makeProgram(lk, src('fullscreen-vert'), src('loi-kiep-frag'));
lk.useProgram(lkProg);
lk.bindBuffer(lk.ARRAY_BUFFER, lk.createBuffer());
lk.bufferData(lk.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), lk.STATIC_DRAW);
const lkPos = lk.getAttribLocation(lkProg, 'a_position');
lk.enableVertexAttribArray(lkPos); lk.vertexAttribPointer(lkPos, 2, lk.FLOAT, false, 0, 0);
const LU = (n) => lk.getUniformLocation(lkProg, n);
const strikes = new Float32Array([0, 0, -99, 0, 0, 0, -99, 0, 0, 0, -99, 0]);
let slot = 0;
function strikeAt(x, y) { strikes.set([x, y, now(), Math.random() * 100], slot * 4); slot = (slot + 1) % 3; }
lkCanvas.addEventListener('pointerdown', (e) => {
  const r = lkCanvas.getBoundingClientRect();
  strikeAt((e.clientX - r.left) / r.width * 1280, (1 - (e.clientY - r.top) / r.height) * 720);
});
setInterval(() => strikeAt(300 + Math.random() * 680, 80 + Math.random() * 200), 1400);

// ---------------- Kim Quang: sprite nhân vật vẽ bằng Canvas 2D làm texture ----------------
const kqCanvas = document.getElementById('kq');
const kq = kqCanvas.getContext('webgl', { premultipliedAlpha: true, alpha: true });
const kqProg = makeProgram(kq, src('sprite-vert'), src('kim-quang-frag'));
kq.useProgram(kqProg);
kq.bindBuffer(kq.ARRAY_BUFFER, kq.createBuffer());
kq.bufferData(kq.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]), kq.STATIC_DRAW);
const aP = kq.getAttribLocation(kqProg, 'a_position'), aL = kq.getAttribLocation(kqProg, 'a_local');
kq.enableVertexAttribArray(aP); kq.vertexAttribPointer(aP, 2, kq.FLOAT, false, 16, 0);
kq.enableVertexAttribArray(aL); kq.vertexAttribPointer(aL, 2, kq.FLOAT, false, 16, 8);
const spr = document.createElement('canvas'); spr.width = spr.height = 128;
{ const g = spr.getContext('2d');
  g.fillStyle = '#4a74a8'; g.beginPath(); g.arc(64, 26, 13, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(47, 40); g.lineTo(81, 40); g.lineTo(96, 118); g.lineTo(32, 118); g.closePath(); g.fill();
  g.fillStyle = '#d9b44a'; g.fillRect(48, 70, 32, 5);
  g.fillStyle = '#3a5f8f'; g.fillRect(38, 44, 9, 40); g.fillRect(81, 44, 9, 40); }
const tex = kq.createTexture(); kq.bindTexture(kq.TEXTURE_2D, tex);
kq.pixelStorei(kq.UNPACK_FLIP_Y_WEBGL, true);
kq.texImage2D(kq.TEXTURE_2D, 0, kq.RGBA, kq.RGBA, kq.UNSIGNED_BYTE, spr);
[kq.TEXTURE_WRAP_S, kq.TEXTURE_WRAP_T].forEach((p) => kq.texParameteri(kq.TEXTURE_2D, p, kq.CLAMP_TO_EDGE));
kq.texParameteri(kq.TEXTURE_2D, kq.TEXTURE_MIN_FILTER, kq.LINEAR);
const KU = (n) => kq.getUniformLocation(kqProg, n);
kq.uniformMatrix3fv(KU('u_viewProj'), false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
kq.uniform1i(KU('u_tex'), 0);
kq.uniform4f(KU('u_uvRect'), 0, 0, 1, 1);
kq.uniform4f(KU('u_spriteBox'), 0.25, 0.1, 0.75, 0.9);
kq.uniform2f(KU('u_texel'), 1 / 128, 1 / 128);
kq.uniform1f(KU('u_rimRadius'), 4);
kq.uniform3f(KU('u_gold'), 1.0, 0.8, 0.32);
kq.uniform4f(KU('u_bubble'), 0.5, 0.5, 0.47, 0.47);
const hits = new Float32Array([0, 0, -99, 0, 0, 0, -99, 0, 0, 0, -99, 0, 0, 0, -99, 0]);
let hslot = 0;
kqCanvas.addEventListener('pointerdown', (e) => {
  const r = kqCanvas.getBoundingClientRect();
  hits.set([(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height, now(), 1], hslot * 4);
  hslot = (hslot + 1) % 4;
});

// ---------------- Vòng lặp ----------------
function frame() {
  const t = now();
  lk.viewport(0, 0, lkCanvas.width, lkCanvas.height);
  lk.clearColor(0, 0, 0, 0); lk.clear(lk.COLOR_BUFFER_BIT);
  lk.uniform2f(LU('u_resolution'), 1280, 720);
  lk.uniform1f(LU('u_time'), t);
  lk.uniform4fv(LU('u_strikes[0]'), strikes);
  lk.uniform1f(LU('u_strikeCount'), 3);
  lk.uniform2f(LU('u_cloudCenter'), 640, 650);
  lk.uniform1f(LU('u_skyHeight'), 520);
  lk.uniform1f(LU('u_intensity'), +document.getElementById('intensity').value);
  lk.uniform3f(LU('u_boltColor'), 0.72, 0.62, 1.0);
  lk.uniform1f(LU('u_flashScale'), document.getElementById('flash').checked ? 1 : 0);
  lk.drawArrays(lk.TRIANGLE_STRIP, 0, 4);

  kq.viewport(0, 0, kqCanvas.width, kqCanvas.height);
  kq.clearColor(0, 0, 0, 0); kq.clear(kq.COLOR_BUFFER_BIT);
  kq.enable(kq.BLEND); kq.blendFunc(kq.ONE, kq.ONE_MINUS_SRC_ALPHA);
  kq.uniform1f(KU('u_time'), t);
  kq.uniform1f(KU('u_strength'), +document.getElementById('strength').value);
  kq.uniform4fv(KU('u_hits[0]'), hits);
  kq.drawArrays(kq.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(frame);
}
function resize() { drawGround(); fit(lkCanvas, Math.min(devicePixelRatio, 1)); }
addEventListener('resize', resize); resize();
requestAnimationFrame(frame);
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
fs.writeFileSync(path.join(root, 'preview', 'shader_preview.html'), html);
console.log('✔ preview/shader_preview.html');
