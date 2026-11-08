# 33. Đo hiệu năng P1 (client slice)

Tiêu chí thoát P1 ([docs/10 §12](10-mvp-scope.md)): chạy Web + 1 máy mobile thật với **≤ 80 draw call, RAM ≤ 500 MB, ≥ 30 FPS với 20 NPC, gói tải đầu ≤ 25 MB**, tìm đường + click-to-move đúng.

## Cách đo trên Web (headless)

```bash
npm ci
npm run perf:p1 -w client-cocos                      # build web-mobile --release rồi đo
npm run perf:p1 -w client-cocos -- --skip-build      # dùng build/web-mobile có sẵn
# tùy chọn: --npcs 20  --tier low|medium|high  --seconds 20  --warmup 6  --out <thư mục>  --gate-fps
```

Cần Cocos Creator 3.8.8 (`COCOS_CREATOR_PATH`) để build và Chrome/Edge (`CHROME_PATH`). Script mở `/?npcs=20&tier=medium` bằng puppeteer-core, đợi `window.__vgtdPerf` (do `PerfHud` công bố), lấy mẫu 2 lần/giây sau khi khởi động, in bảng so với tiêu chí và ghi `p1-perf.json` (mặc định `<tmp>/vgtd-perf`). Exit code 1 nếu draw call, RAM hoặc gói đầu vượt ngưỡng; FPS chỉ làm fail khi có `--gate-fps` vì headless dùng SwiftShader (WebGL phần mềm), không đại diện GPU thật.

- **Draw call**: `director.root.device.numDrawCalls`.
- **RAM**: `performance.memory.usedJSHeapSize` (bật `--enable-precise-memory-info`) cộng bộ nhớ texture GPU `device.memoryStatus.textureSize`. Chưa gồm bộ nhớ native của trình duyệt.
- **Gói tải đầu**: tổng kích thước (thô và gzip) mọi file mà trang thực sự yêu cầu cho tới khi world chơi được. Thư mục build còn chứa asset `resources` tải lười của trình xem animation (dev-only, ~228 MB) không nằm trong lần tải đầu.

Tham số URL (cũng dùng trên máy thật): `?npcs=N` (mặc định 20, 0 = tắt), `?tier=low|medium|high` (cửa sổ streaming, D63), `?input=touch|pointer`.

## Cách đo trên máy mobile thật

1. `npm run build:web -w client-cocos -- --release`, rồi `npm run serve -w client-cocos` (cổng 7456, lắng nghe loopback).
2. Android: bật USB debugging, `adb reverse tcp:7456 tcp:7456`, mở Chrome trên máy tại `http://localhost:7456/?npcs=20`. iOS: dùng Safari Web Inspector qua cáp (tính năng `performance.memory` không có, chỉ có FPS / draw call trên HUD).
3. HUD góc trên-trái hiện FPS, Draw calls / 80, Tex mem, JS heap, Nodes, Chunks, NPC, Loaded MB. Đợi 30 s cho số ổn định, chụp màn hình HUD khi đang click-to-move.
4. Android + `chrome://inspect`: tab Console in dòng `[vgtd][perf] {...}` mỗi 2 giây (cùng số liệu JSON); tab Memory / Performance cho RAM tổng của tab. Ghi lại: model máy, Android/Chrome version, độ phân giải, số liệu lớn nhất của draw call và RAM, FPS trung vị.
5. Dán kết quả vào bảng dưới và đóng OPEN-ITEMS #5 khi mọi dòng đạt.

## Kết quả

Đo bằng `npm run perf:p1 -w client-cocos` ngày 2026-11-08, Windows 11, headless Chrome + SwiftShader, 1280×720, 20 NPC, tier `medium`, art placeholder (chưa có `ChibiBody` thật, PR #193 chưa merge), world 32×32 ô = **1 chunk**:

| Tiêu chí             | Ngưỡng | Đo được             | Kết quả                                   |
| -------------------- | ------ | ------------------- | ----------------------------------------- |
| Draw call (max)      | ≤ 80   | 6                   | Đạt                                       |
| RAM (heap + texture) | ≤ 500  | 62,1 MB             | Đạt (chưa gồm RAM native trình duyệt)     |
| FPS với 20 NPC       | ≥ 30   | 36,8 (min 35,1)     | Đạt trên WebGL phần mềm; chưa đo máy thật |
| Gói tải đầu          | ≤ 25   | 5,41 MB (gzip 1,04) | Đạt                                       |

Chi tiết: frame 27,1 ms, trong đó CPU update 0,22 ms + submit render 0,51 ms (phần còn lại là rasterize phần mềm), 2043 node, heap 43,3 MB, texture 18,8 MB.

**Chưa đủ để đóng P1** (OPEN-ITEMS #5): (a) chưa đo trên máy mobile thật; (b) map hiện chỉ 1 chunk nên streaming chưa chịu tải nhiều chunk và số draw call / RAM sẽ tăng khi có nhiều chunk, vật thể, hiệu ứng; (c) NPC dùng sprite placeholder, nhân vật thật (paperdoll / chibi) có nhiều texture và draw call hơn; (d) asset `resources` dev-only trong thư mục build phải tách khỏi gói phát hành.
