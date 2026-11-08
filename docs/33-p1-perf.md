# 33. Đo hiệu năng P1 (client slice)

Tiêu chí thoát P1 ([docs/10 §12](10-mvp-scope.md)): chạy Web + 1 máy mobile thật với **≤ 80 draw call, RAM ≤ 500 MB, ≥ 30 FPS với 20 NPC, gói tải đầu ≤ 25 MB**, tìm đường + click-to-move đúng.

## Cách đo trên Web (headless)

```bash
npm ci
npm run perf:p1 -w client-cocos                      # build web-mobile --release rồi đo
npm run perf:p1 -w client-cocos -- --skip-build      # dùng build/web-mobile có sẵn
# tùy chọn: --route  --npcs 20  --npcart chibi|placeholder  --tier low|medium|high  --seconds 20  --warmup 6  --out <thư mục>  --gate-fps
```

Cần Cocos Creator 3.8.8 (`COCOS_CREATOR_PATH`) để build và Chrome/Edge (`CHROME_PATH`). Script mở `/?npcs=20&tier=medium` bằng puppeteer-core, đợi `window.__vgtdPerf` (do `PerfHud` công bố), lấy mẫu 2 lần/giây sau khi khởi động, in bảng so với tiêu chí và ghi `p1-perf.json` (mặc định `<tmp>/vgtd-perf`). Exit code 1 nếu draw call, RAM hoặc gói đầu vượt ngưỡng; FPS chỉ làm fail khi có `--gate-fps` vì headless dùng SwiftShader (WebGL phần mềm), không đại diện GPU thật.

- **Draw call**: `director.root.device.numDrawCalls`.
- **RAM**: `performance.memory.usedJSHeapSize` (bật `--enable-precise-memory-info`) cộng bộ nhớ texture GPU `device.memoryStatus.textureSize`. Chưa gồm bộ nhớ native của trình duyệt.
- **Gói tải đầu**: tổng kích thước (thô và gzip) mọi file mà trang yêu cầu lần đầu **cho tới khi world chơi được**; tổng đã tải trong cả lần chạy (gồm asset stream / tải lười sau đó, ví dụ rig các hướng khác khi đi bộ) in riêng ở dòng `total fetched`. Cổng 25 MB chỉ áp lên gói tải đầu (patch từ worker 39, D71). Thư mục build còn chứa asset `resources` tải lười của trình xem animation (dev-only, ~228 MB) không nằm trong lần tải đầu.

Tham số URL (cũng dùng trên máy thật): `?npcs=N` (mặc định 20, 0 = tắt), `?tier=low|medium|high` (cửa sổ streaming, D63), `?input=touch|pointer`.

## Cách đo trên máy mobile thật

Điều kiện: máy tính và điện thoại cùng mạng Wi-Fi, tường lửa cho phép cổng 7456.

1. `npm run build:web -w client-cocos -- --release` (cần Cocos Creator, xem README).
2. `npm run serve -w client-cocos` — server lắng nghe mọi giao diện và in ra các dòng `LAN: http://<IP-máy-tính>:7456/?npcs=20`.
3. Trên điện thoại mở đúng URL đó bằng Chrome (Android) hoặc Safari (iOS). Cờ URL: `?npcs=20` (số NPC, mặc định 20), `?npcart=placeholder` (NPC sprite đơn giản thay vì chibi thật), `?tier=low|medium|high` (cửa sổ streaming), `?class=<id>` (lớp người chơi), `?input=touch`.
4. Số liệu hiện **ngay trên màn hình** (HUD góc trên-trái): FPS, Draw calls / 80, Tex mem, JS heap, Nodes, Chunks, NPC, Loaded MB. Đợi 30 giây cho số ổn định, vừa click/joystick di chuyển vừa chụp màn hình HUD. FPS trung vị lấy bằng mắt qua nhiều lần chụp hoặc từ console (bước 5).
5. Console: Android Chrome → `chrome://inspect` trên máy tính (USB debugging) → Console in dòng `[vgtd][perf] {...}` mỗi 2 giây (JSON đủ số liệu); tab Memory cho tổng RAM của tab. iOS: Safari Web Inspector qua cáp (`performance.memory` không có, chỉ FPS / draw call trên HUD).
6. Ghi lại: model máy, hệ điều hành + phiên bản trình duyệt, độ phân giải, draw call lớn nhất, RAM lớn nhất, FPS trung vị với 20 NPC chibi (mặc định), rồi dán vào bảng dưới và đóng OPEN-ITEMS #5 khi mọi dòng đạt.

## Kết quả

Đo bằng `npm run perf:p1 -w client-cocos` ngày 2026-11-08, Windows 11, headless Chrome + SwiftShader, 1280×720, tier `medium`, world 32×32 ô = **1 chunk**. Hai dòng đầu dùng nhân vật chibi thật (`ChibiBody`, PR #193) cho người chơi; đủ 20 NPC chibi lớp lẫn nhau dùng cả 6 lớp:

| Cấu hình                           | Draw call (≤ 80) | RAM heap+texture (≤ 500 MB) | FPS (≥ 30, phần mềm) | Gói đầu fetch (≤ 25 MB)  |
| ---------------------------------- | ---------------- | --------------------------- | -------------------- | ------------------------ |
| Người chơi chibi, 0 NPC            | 8                | 94,5                        | 41,8                 | 14,06 (gzip 9,43)        |
| 20 NPC sprite placeholder          | 8                | 95,2                        | 42,8                 | 14,06 (gzip 9,43)        |
| **20 NPC chibi, 6 lớp (mặc định)** | 45               | **536,9** (texture 466,8)   | 41,5                 | **135,79** (gzip 125,58) |

**Kết luận: với nghệ thuật thật, P1 chưa đạt.** Draw call và FPS (phần mềm) đạt; RAM và gói đầu vượt ngưỡng vì mỗi lớp chibi nạp 5 hướng với atlas lớn: mỗi lớp thêm khoảng 20 MB tải và ~70–90 MB texture GPU (PNG 6 MB giải nén thành RGBA). Hướng giải quyết thuộc phần thiết kế asset, không sửa trong PR này: nén texture (KTX2/ASTC/WebP theo docs/06), giảm kích thước atlas / số hướng nạp, nạp lười theo lớp (Class pack tách khỏi Core ≤ 25 MB), giới hạn số lớp khác nhau trong tầm nhìn. Đo lại sau mỗi thay đổi bằng cùng lệnh (có `--npcart placeholder` hoặc `--npcs 0` để tách chi phí).

Chi tiết dòng mặc định: frame 24,1 ms (CPU update 0,29 + submit render 0,42 ms, phần còn lại là rasterize phần mềm), 2064 node, heap 70,1 MB.

**Chưa đủ để đóng P1** (OPEN-ITEMS #5): (a) chưa đo trên máy mobile thật; (b) map hiện chỉ 1 chunk nên streaming chưa chịu tải nhiều chunk; (c) RAM native của trình duyệt chưa tính; (d) asset `resources` dev-only trong thư mục build (~228 MB) phải tách khỏi gói phát hành.

## Streaming trên map nhiều chunk (đi bộ theo tuyến)

Map lát cắt nay là **Sơn Môn 256 × 256 ô = 8 × 8 chunk** (docs/04 §5, docs/10 §12; `prepare.mjs` sinh bằng procgen, đặt `VGTD_MAP_TILES=32` để quay lại map 1 chunk), nên `ChunkStreamer` thực sự nạp / giữ / bỏ chunk. `--route` (`?route=1`) cho người chơi đi một vòng 8 điểm quanh map theo đường A\* của `client-core` (đường được tính trước, không có hitch tìm đường trong lúc đo), mặc định 90 s, và thêm vào báo cáo: số lần dựng / hủy cây node chunk, thời gian dựng chunk, frame tệ nhất, số frame > 50 / > 100 ms, số lần khung nhìn thiếu nền, heap giữ lại sau GC cưỡng bức đầu và cuối đoạn đo (`window.gc`, chrome `--js-flags=--expose-gc`).

Hai bài học từ phép đo đầu tiên, đã sửa trong PR này:

1. Dựng cây node cho **mọi** chunk streamer đã nạp (cả vòng prefetch ngoài màn hình) cho 44 chunk / 82 315 node, **132 draw call**, RAM 520 MB, 21 FPS. `WorldView` nay tách _dữ liệu chunk_ (cửa sổ nạp / prefetch / giữ, rẻ) khỏi _cây node sprite_ (~2000 node / chunk): cây chỉ có cho chunk nằm trong khung nhìn mở rộng 192 px và bị hủy ngay khi rời khỏi. Còn 4–8 chunk dựng, ≤ 15 200 node.
2. Dựng cả cây trong một frame mất 24 ms trung bình, tới 60 ms. Nay dựng dần mỗi frame tối đa 300 sprite (~7 frame / chunk), mỗi lần chỉ một chunk: frame > 50 ms giảm từ 31 xuống 2 trong 90 s, lát dựng tệ nhất 6,6 ms.

Kết quả (headless Chrome + SwiftShader, 1280 × 720, tier `medium`, đi 60–90 s, 2026-11-08; máy dùng chung nên FPS dao động vài đơn vị). "Nền thiếu" = số lần đồng bộ mà một chunk trong khung nhìn (trừ chunk `missing` ngoài map) chưa có dữ liệu hoặc chưa có cây node đầy đủ; gói đầu = file yêu cầu lần đầu cho tới khi world chơi được (cổng 25 MB), phần tải lười sau đó in riêng.

| Cấu hình                           | Draw call (≤ 80) | RAM heap+texture (≤ 500 MB) | FPS (≥ 30, phần mềm) | Gói đầu (≤ 25 MB) | Tải lười sau đó | Dựng chunk tb / max | Lát dựng tệ nhất | Frame > 50 / > 100 ms | Nền thiếu |
| ---------------------------------- | ---------------- | --------------------------- | -------------------- | ----------------- | --------------- | ------------------- | ---------------- | --------------------- | --------- |
| Chibi người chơi, 0 NPC            | 35               | 269                         | 33,1                 | 23,56             | 7,54            | 19,1 / 24,6 ms      | 7,2 ms           | 3 / 0                 | 0         |
| 20 NPC placeholder                 | 36               | 378                         | 33,2                 | 23,56             | 7,54            | 17,8 / 23,6 ms      | 6,9 ms           | 2 / 2                 | 0         |
| **20 NPC chibi, 6 lớp (mặc định)** | 69               | **771**                     | 32,9                 | **71,32**         | 65,11           | 18,3 / 21,5 ms      | 6,2 ms           | 3 / 0                 | 0         |

- Chunk: 25–38 lần dựng và hủy cây trên một vòng, giữ dữ liệu tối đa 45–46 chunk (cửa sổ giữ 7 × 7 + 30 s hold), khung nhìn không thiếu nền ở lần đo nào (số đếm đã tính cả chunk chưa có dữ liệu).
- Rò rỉ: heap giữ lại sau GC đầu / cuối đoạn đo 64,0 → 65,5 MB (0 NPC), 63,6 → 58,1 MB (placeholder), 81,0 → 76,8 MB (chibi); heap thô tăng trong lúc đi là do GC chưa chạy, không phải rò rỉ.
- **Gói đầu**: 23,56 MB với 0 NPC (đạt, sát ngưỡng) và **71,32 MB với 20 NPC chibi (FAIL)**, vì NPC nạp rig trước khi world chơi được; 7,5 / 65 MB còn lại được tải lười khi người chơi quay đủ 5 hướng. Trên main trước PR #197 (bundle theo hướng của worker 39).
- Chibi mặc định: RAM 771 MB (FAIL) do texture của cả 6 lớp × các hướng (texture 466,8 MB); chưa phải do dựng chunk (lát dựng chunk tệ nhất 6,2 ms). Việc nén texture + nạp lười thuộc asset budget (worker 39), không đổi ở đây.
- Props L3 hiện chỉ rải quanh điểm spawn (bán kính 40 ô, vì mọi object L3 được sort mỗi frame và chưa stream theo chunk); `objects[]` theo chunk (D67) sẽ thay khi procgen phát ra.
