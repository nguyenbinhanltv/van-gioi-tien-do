#!/usr/bin/env node
'use strict';
/**
 * Chụp ảnh shader không cần trình duyệt (dùng cho CI so sánh hình – visual regression).
 * Cần: npm i -D gl   (headless WebGL1). Trên Linux server chạy kèm Xvfb:
 *   xvfb-run -s "-screen 0 1280x720x24" node tools/shader_snapshot.js out/snapshots
 *
 * Xuất: loi_kiep_t*.png (các thời điểm của một đợt 3 tia) và kim_quang_t*.png.
 */
const fs = require('fs');
const path = require('path');
const { Image } = require('../src/lib/png');

let createGL;
try { createGL = require('gl'); } catch { console.error('Thiếu gói "gl". Chạy: npm i -D gl'); process.exit(1); }

const outDir = process.argv[2] || 'out/snapshots';
fs.mkdirSync(outDir, { recursive: true });
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'shaders', f), 'utf8');

function program(gl, vsSrc, fsSrc) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function snapshot(gl, W, H, file) {
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const img = new Image(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  img.save(path.join(outDir, file));
  console.log('✔', path.join(outDir, file));
}

// ---------------------------------------------------------------------------
// Lôi Kiếp: khung logic 1280 × 720, render ở 1/2 độ phân giải như cấu hình Mobile
// ---------------------------------------------------------------------------
function loiKiep() {
  const W = 640, H = 360;
  const gl = createGL(W, H, { premultipliedAlpha: true });
  const prog = program(gl, read('fullscreen.vert'), read('loi_kiep.frag'));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);

  gl.uniform2f(U('u_resolution'), 1280, 720);
  gl.uniform2f(U('u_cloudCenter'), 640, 640);
  gl.uniform1f(U('u_skyHeight'), 520);
  gl.uniform1f(U('u_intensity'), 1.4);
  gl.uniform3f(U('u_boltColor'), 0.72, 0.62, 1.0);
  gl.uniform1f(U('u_flashScale'), 1.0);
  gl.uniform1f(U('u_strikeCount'), 3);
  // 3 tia đánh lệch nhịp vào 3 điểm trên mặt đất
  gl.uniform4fv(U('u_strikes[0]'), new Float32Array([
    640, 150, 0.00, 11.0,
    430, 210, 0.45, 23.0,
    860, 120, 0.90, 37.0,
  ]));

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const t of [0.06, 0.55, 1.0, 1.8]) {
    gl.clearColor(0.09, 0.11, 0.15, 1);  // nền thay cho cảnh game
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U('u_time'), t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    snapshot(gl, W, H, `loi_kiep_t${t.toFixed(2)}.png`);
  }
}

// ---------------------------------------------------------------------------
// Kim Quang: sprite nhân vật sinh bằng code (bóng người đơn giản) trong atlas 128 × 128
// ---------------------------------------------------------------------------
function makeCharacterTexture(S) {
  const tex = new Uint8Array(S * S * 4);
  const inBody = (x, y) => {
    const head = Math.hypot(x - 64, y - 26) < 13;
    const torso = Math.abs(x - 64) < 17 - (y - 40) * 0.08 && y > 38 && y < 88;
    const robe = y >= 88 && y < 118 && Math.abs(x - 64) < 14 + (y - 88) * 0.45;
    const arms = y > 44 && y < 82 && Math.abs(Math.abs(x - 64) - 22) < 5;
    return head || torso || robe || arms;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inBody(x, y)) continue;
    const i = (y * S + x) * 4;
    const shade = 0.75 + 0.25 * Math.cos((x - 50) / 30);
    tex[i] = 70 * shade; tex[i + 1] = 110 * shade; tex[i + 2] = 160 * shade; tex[i + 3] = 255;
  }
  // Hàng 0 của mảng là đáy texture trong WebGL: lật dọc để đầu nằm phía trên
  const flipped = new Uint8Array(tex.length);
  for (let y = 0; y < S; y++) flipped.set(tex.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
  return flipped;
}

function kimQuang() {
  const W = 256, H = 256, S = 128;
  const gl = createGL(W, H, { premultipliedAlpha: true });
  const prog = program(gl, read('sprite_quad.vert'), read('kim_quang.frag'));
  gl.useProgram(prog);
  const data = new Float32Array([
    // a_position (clip)  a_local
    -1, -1, 0, 0,
    1, -1, 1, 0,
    -1, 1, 0, 1,
    1, 1, 1, 1,
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_position'), aLoc = gl.getAttribLocation(prog, 'a_local');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 16, 8);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, makeCharacterTexture(S));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const U = (n) => gl.getUniformLocation(prog, n);
  gl.uniformMatrix3fv(U('u_viewProj'), false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
  gl.uniform1i(U('u_tex'), 0);
  gl.uniform4f(U('u_uvRect'), 0, 0, 1, 1);
  gl.uniform4f(U('u_spriteBox'), 0.25, 0.1, 0.75, 0.9);
  gl.uniform2f(U('u_texel'), 1 / S, 1 / S);
  gl.uniform1f(U('u_rimRadius'), 4);
  gl.uniform1f(U('u_strength'), 1);
  gl.uniform3f(U('u_gold'), 1.0, 0.8, 0.32);
  gl.uniform4f(U('u_bubble'), 0.5, 0.5, 0.47, 0.47);
  gl.uniform4fv(U('u_hits[0]'), new Float32Array([
    0.85, 0.62, 0.0, 1.0,
    0.2, 0.35, 0.35, 0.7,
    0, 0, -10, 0,
    0, 0, -10, 0,
  ]));

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const t of [0.05, 0.3, 0.6, 2.0]) {
    gl.clearColor(0.12, 0.14, 0.18, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U('u_time'), t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    snapshot(gl, W, H, `kim_quang_t${t.toFixed(2)}.png`);
  }
}

loiKiep();
kimQuang();
