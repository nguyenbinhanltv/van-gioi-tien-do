/**
 * Ví dụ gắn kết: canvas 2D, lưới 48 × 48 ô có vật cản, nhân vật đi theo InputFrame.
 * Chạy: npm run demo  rồi mở http://localhost:8080/example/
 * Trên máy tính: click để tìm đường, phím 1–6, Space. Bật chế độ giả lập cảm ứng của
 * DevTools (hoặc mở trên điện thoại) để thấy Joystick + Skill Wheel; chạm lại chuột là đổi về PC.
 */
import { TilePos, tileToScreen, tileOf } from '../src/core/IsoMath.js';
import { InputManager } from '../src/input/InputManager.js';
import type { WalkGrid } from '../src/input/IsoPathfinder.js';
import { AnchorLayout, LayoutResult, touchLayoutFromRects } from '../src/ui/AnchorLayout.js';
import { inRect } from '../src/input/types.js';

const root = document.getElementById('root') as HTMLElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const SIZE = 48;

// ---- Lưới có vật cản sinh theo seed ----
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const blocked = new Uint8Array(SIZE * SIZE).map((_, k) => {
  const i = k % SIZE, j = (k / SIZE) | 0;
  if (i === 0 || j === 0 || i === SIZE - 1 || j === SIZE - 1) return 1;
  return rand() < 0.12 && Math.hypot(i - 24, j - 24) > 2 ? 1 : 0;
});
const grid: WalkGrid = { width: SIZE, height: SIZE, isWalkable: (i, j) => blocked[j * SIZE + i] === 0 };

// ---- Nhân vật + camera ----
const player = { pos: { i: 24.5, j: 24.5 } as TilePos, position() { return this.pos; } };
let zoom = 1;
const camera = {
  clientToWorld(cx: number, cy: number) {
    const r = canvas.getBoundingClientRect();
    const c = tileToScreen(player.pos);
    return { x: (cx - r.left - r.width / 2) / zoom + c.x, y: (cy - r.top - r.height / 2) / zoom + c.y };
  },
};

let layoutRes: LayoutResult | null = null;
const input = new InputManager(canvas, {
  grid, camera, player,
  uiHitTest: (x, y) => {
    if (!layoutRes) return false;
    const r = canvas.getBoundingClientRect();
    for (const [id, rect] of layoutRes.rects) {
      if (id === 'joystick-zone' || id === 'skill-wheel') continue;
      if (inRect(rect, x - r.left, y - r.top)) return true;
    }
    return false;
  },
});

const layout = new AnchorLayout(root);
layout.on('layout', (res) => {
  layoutRes = res;
  zoom = res.scale;
  const tl = touchLayoutFromRects(res, 1 / 32);   // 1 px kéo ở scale 1 ≈ 1/32 ô
  if (tl) input.setTouchLayout(tl);
});
layout.setMode(input.mode);
input.on('modeChange', (m) => layout.setMode(m));

// ---- Mô phỏng đơn giản (trong game thật: hàm step() dùng chung với server) ----
function move(dt: number, dir: TilePos, mag: number) {
  const speed = 4.5 * mag;
  const ni = player.pos.i + dir.i * speed * dt, nj = player.pos.j + dir.j * speed * dt;
  if (grid.isWalkable(Math.floor(ni), Math.floor(player.pos.j))) player.pos.i = ni;
  if (grid.isWalkable(Math.floor(player.pos.i), Math.floor(nj))) player.pos.j = nj;
}

const log: string[] = [];
function frame(t: number, last: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  const f = input.poll();
  move(dt, f.move, f.magnitude);
  for (const c of f.casts) log.unshift(`skill ${c.slot}${c.aimTile ? ` → (${c.aimTile.i.toFixed(1)}, ${c.aimTile.j.toFixed(1)})` : ' (tự nhắm)'}`);
  if (f.dodge) log.unshift('né');
  if (f.cancelCast) log.unshift('hủy kỹ năng');
  log.length = Math.min(log.length, 6);
  draw(f.path, InputManager.toPacket(f));
  requestAnimationFrame((n) => frame(n, t));
}

function draw(path: ReadonlyArray<TilePos> | null, pkt: { dir: number; mag: number; flags: number }) {
  const dpr = devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#141824'; ctx.fillRect(0, 0, r.width, r.height);
  const c = tileToScreen(player.pos);
  const toView = (p: TilePos) => { const s = tileToScreen(p); return { x: (s.x - c.x) * zoom + r.width / 2, y: (s.y - c.y) * zoom + r.height / 2 }; };

  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const p = [toView({ i, j }), toView({ i: i + 1, j }), toView({ i: i + 1, j: j + 1 }), toView({ i, j: j + 1 })];
    ctx.beginPath(); p.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
    ctx.fillStyle = blocked[j * SIZE + i] ? '#4a3f3a' : (i + j) % 2 ? '#2a3a2c' : '#2e402f';
    ctx.fill();
  }
  if (path && path.length) {
    ctx.strokeStyle = '#e8b540'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
    const s = toView(player.pos); ctx.moveTo(s.x, s.y);
    path.forEach((p) => { const q = toView(p); ctx.lineTo(q.x, q.y); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  const me = toView(player.pos);
  ctx.fillStyle = '#7fb2ff'; ctx.beginPath(); ctx.ellipse(me.x, me.y, 10 * zoom, 5 * zoom, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(me.x - 5 * zoom, me.y - 40 * zoom, 10 * zoom, 38 * zoom);

  // Cụm cảm ứng
  const vs = input.mode === 'touch' ? input.touch.visualState() : null;
  if (vs) {
    for (const b of vs.buttons) {
      ctx.beginPath(); ctx.arc(b.center.x, b.center.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = b.pressed ? 'rgba(232,181,64,0.55)' : 'rgba(255,255,255,0.12)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(b.slot === null ? b.id : String(b.slot), b.center.x, b.center.y + 4);
    }
    if (vs.joystick) {
      const { base, knob, radius } = vs.joystick;
      ctx.beginPath(); ctx.arc(base.x, base.y, radius, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(knob.x, knob.y, radius * 0.4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(127,178,255,0.6)'; ctx.fill();
    }
    if (vs.aim) {
      ctx.strokeStyle = vs.aim.overCancel ? '#e0483a' : '#e8b540'; ctx.beginPath();
      ctx.moveTo(vs.aim.from.x, vs.aim.from.y); ctx.lineTo(vs.aim.to.x, vs.aim.to.y); ctx.stroke();
    }
  }
  // Khung HUD theo AnchorLayout
  if (layoutRes) {
    ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    for (const [id, rc] of layoutRes.rects) {
      if (id === 'joystick-zone') continue;
      ctx.strokeStyle = 'rgba(232,181,64,0.5)'; ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w, rc.h);
      ctx.fillStyle = 'rgba(232,228,218,0.8)'; ctx.fillText(id, rc.x + 4, rc.y + 14);
    }
  }
  ctx.fillStyle = '#e6e2d8'; ctx.font = '13px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`chế độ: ${input.mode} · ô (${tileOf(player.pos).i}, ${tileOf(player.pos).j}) · gói dir=${pkt.dir} mag=${pkt.mag} flags=${pkt.flags}`, 12, r.height - 12);
  log.forEach((l, k) => ctx.fillText(l, r.width / 2 - 120, 110 + k * 16));
}

requestAnimationFrame((t) => frame(t, t));
