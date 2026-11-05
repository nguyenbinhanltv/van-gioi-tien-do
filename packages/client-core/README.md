# tutien-client-input – Input Abstraction Layer & Responsive UI

Mã TypeScript (ES2020, không phụ thuộc engine) cho điều khiển và bố cục HUD của Tu Tiên 2D Isometric trên PC, Mobile và Web. Mọi module chỉ dùng DOM chuẩn (Pointer Events, ResizeObserver), nên gắn được vào Cocos Creator, Phaser, Pixi hay canvas thuần.

## Cấu trúc

```
src/core/IsoMath.ts               Toán isometric 2:1, mã hóa hướng cho gói input, Emitter
src/input/types.ts                InputFrame, InputMode, cờ gói tin
src/input/IsoPathfinder.ts        A* 8 hướng trên lưới ô, heuristic octile, cấm cắt góc, rút gọn đường
src/input/PointerController.ts    PC: click-to-move (A*), phím 1–6, Space né, WASD, Shift, F
src/input/TouchController.ts      Cảm ứng: Joystick động + Skill Wheel (chạm, kéo nhắm, hủy, vuốt đổi trang)
src/input/InputManager.ts         Nhận diện chế độ, tự chuyển Touch ↔ Chuột (Web hybrid), đóng gói input
src/ui/AnchorLayout.ts            Neo 9 điểm, safe area, 16:9 / 19,5:9 / màn hình dọc, bố cục mặc định
src/ui/InventoryInteraction.ts    Túi đồ: kéo thả (PC) và chạm-để-chọn (Mobile/Web), đổi nóng theo chế độ
example/                          Demo canvas gắn toàn bộ các module
tests/                            Kiểm thử A*, toán iso, bố cục, điều khiển cảm ứng
```

## Chạy

```bash
npm install
npm test        # biên dịch + 3 bộ kiểm thử
npm run demo    # mở http://localhost:8080/example/
```

Trong demo: trên máy tính click để tìm đường, bấm 1–6 và Space; bật giả lập cảm ứng của DevTools (hoặc mở trên điện thoại) để thấy Joystick và Skill Wheel. Chạm rồi dùng lại chuột, hoặc gõ phím, thì bố cục tự đổi.

## Gắn vào game

```ts
const input = new InputManager(canvas, { grid, camera, player, uiHitTest, pickEntity });
const layout = new AnchorLayout(hudRoot);              // phần tử HUD có data-ui="minimap", "chat"…
layout.setMode(input.mode);
input.on('modeChange', (m) => layout.setMode(m));
layout.on('layout', (res) => {
  const tl = touchLayoutFromRects(res, tilesPerPixel);
  if (tl) input.setTouchLayout(tl);
});

// mỗi frame:
const frame = input.poll();                            // giống nhau trên mọi nền tảng
predictLocal(frame);                                   // step() dùng chung với server
net.sendInput(InputManager.toPacket(frame));           // { dir, mag, flags } như tài liệu server
```

- `camera.clientToWorld(clientX, clientY)` trả về tọa độ màn hình logic của thế giới (trước khi đổi sang ô).
- `uiHitTest` trả về true khi điểm nằm trên UI (chat, túi đồ) để click không làm nhân vật đi.
- Trên PC, A* chạy khi click và tối đa mỗi 150 ms khi giữ chuột; với khoảng cách trong một màn hình, một lần tìm đường mất dưới 1 ms. Lưới 256 × 256 với 15% ô chặn, đường dài khoảng 150 ô, mất khoảng 26 ms trên máy kiểm thử; nếu cần tìm đường xa hơn, chuyển sang Web Worker.
