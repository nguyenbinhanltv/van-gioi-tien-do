# 33. Đo hiệu năng P1 (client slice)

Tiêu chí thoát P1 ([docs/10 §12](10-mvp-scope.md)): chạy Web + 1 máy mobile thật với **≤ 80 draw call, RAM ≤ 500 MB, ≥ 30 FPS với 20 NPC, gói tải đầu ≤ 25 MB**, tìm đường + click-to-move đúng.

## Báo cáo thoát P1 (đo cuối, sau D71 / PR #197)

Đo ngày 2026-11-08 trên `main` ở commit `fb3f0c4` (đã có map Sơn Môn 256 × 256, `WorldView` theo chunk, chibi theo bundle D71): headless Chrome + SwiftShader (WebGL phần mềm, không phải GPU thật), 1280 × 720, tier streaming `medium`, art chibi thật (`ChibiBody`, 6 lớp lẫn nhau cho NPC). Lệnh: `npm run perf:p1 -w client-cocos -- --skip-build [--route] --npcs N`. Gói đầu = file yêu cầu lần đầu cho tới khi world chơi được; phần tải lười sau đó in riêng.

| Tiêu chí P1 (docs/10 §12)              | Ngưỡng   | 0 NPC, đi bộ 60 s | **20 NPC chibi, đi bộ 90 s** | 20 NPC chibi, đứng yên 30 s | Kết quả (Web headless)                                                                                                    |
| -------------------------------------- | -------- | ----------------- | ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Draw call (max)                        | ≤ 80     | 35                | **69**                       | 53                          | **ĐẠT**                                                                                                                   |
| RAM: JS heap + texture (max)           | ≤ 500 MB | 188,0             | **225,8**                    | 128,4                       | **ĐẠT**                                                                                                                   |
| FPS với 20 NPC (trung vị, WebGL mềm)   | ≥ 30     | 34,5 (0 NPC)      | **33,5**                     | 36,1                        | **ĐẠT** (chưa phải GPU)                                                                                                   |
| Gói tải đầu (đến khi chơi được)        | ≤ 25 MB  | 8,88 (gzip 2,11)  | **9,26** (gzip 2,40)         | 10,25 (gzip 2,80)           | **ĐẠT**                                                                                                                   |
| Tải lười sau đó (không nằm trong cổng) | -        | 0                 | 7,18 (gzip 2,81)             | 6,19 (gzip 2,41)            | thông tin                                                                                                                 |
| Tìm đường + click-to-move đúng         | đúng     | -                 | -                            | -                           | Có test (`packages/client-core` pathfinder / touch / layout, `npm test`) và hook `#autotest`; chưa chạy lại trên máy thật |
| Chạy trên 1 máy mobile thật            | có       | -                 | -                            | -                           | **CHƯA ĐO** (bước của chủ dự án, bên dưới)                                                                                |

Thêm từ lần đi bộ 90 s với 20 NPC chibi (map nhiều chunk): 37 lần dựng / hủy cây node chunk, khung nhìn không bao giờ thiếu nền, 3 frame > 50 ms và 0 frame > 100 ms, lát dựng chunk tệ nhất 7,6 ms, heap giữ lại sau GC 74,4 → 61,8 MB (không rò rỉ). So với trước D71 (cùng cấu hình): RAM 771 → 226 MB, gói đầu 71,3 → 9,3 MB; draw call không đổi (69).

Giới hạn của phép đo, nên đọc cùng kết quả:

- Web headless **đạt** cả 4 số đo; P1 chỉ đóng khi có 1 lần đo máy mobile thật (cột cuối). FPS 30+ trên WebGL phần mềm là cận dưới của chi phí CPU / JS, không thay thế GPU điện thoại; máy dùng chung nên FPS dao động vài đơn vị giữa các lần chạy.
- Texture chibi ở desktop headless dùng tier `1x` cho NPC / `full` cho người chơi; texture ASTC chỉ có trên thiết bị hỗ trợ, SwiftShader rơi về WebP / PNG nên số RAM texture trên điện thoại có thể khác.
- RAM = heap JS + bộ nhớ texture GPU của engine; chưa gồm bộ nhớ native của trình duyệt (xem tab Memory trên máy thật).
- Map vẫn là procgen một vùng (không có vật thể L3 theo chunk), props chỉ rải quanh điểm spawn; thêm vật thể / hiệu ứng sẽ tăng draw call và node.

### Bước còn lại cho chủ dự án: đo trên điện thoại thật qua LAN

Điều kiện: máy tính và điện thoại cùng Wi-Fi; tường lửa Windows cho phép Node.js nhận kết nối vào cổng 8456 (hộp thoại "Allow access" lần đầu, chọn mạng Private).

1. Trên máy tính, từ gốc repo: `npm ci`, rồi `npm run build:web -w client-cocos -- --release` (cần Cocos Creator 3.8.8, `COCOS_CREATOR_PATH` nếu cài lệch đường dẫn mặc định). Ổ C đầy thì đặt `apps/client-cocos/{library,temp,build,assets/chibi}` thành junction sang ổ khác trước khi build.
2. `npm run serve -w client-cocos`. Server in các dòng `LAN: http://<IP-máy-tính>:8456/?npcs=20` (mỗi card mạng một dòng; chọn IP cùng dải với điện thoại, thường `192.168.x.x` hoặc `10.x.x.x`).
3. Trên điện thoại mở đúng URL đó bằng Chrome (Android) hoặc Safari (iOS). Không cần cờ nào khác: mặc định đã là 20 NPC chibi nhiều lớp, người chơi lớp mặc định, map Sơn Môn 256 × 256. Muốn đo chuyến đi bộ tự động mở thêm `&route=1` (đi vòng quanh toàn bản đồ, giữ nguyên các cờ khác). Muốn thử tier streaming thấp: `&tier=low`.
4. Chờ ~30 giây cho số ổn định, rồi vừa di chuyển (joystick cảm ứng hiện sẵn; hoặc `&route=1` để máy tự đi) vừa chụp màn hình HUD góc trên-trái: **FPS**, **Draw calls / 80**, **Tex mem**, **JS heap**, **Nodes / Chunks (đang dựng / đang giữ) / NPC**, **Loaded MB** (gói đã tải).
5. Console (tuỳ chọn, chính xác hơn): Android Chrome nối USB (bật USB debugging) → mở `chrome://inspect` trên máy tính → Console in dòng `[vgtd][perf] {...}` mỗi 2 giây (JSON đủ số liệu, gồm `frameMsMax`, `hitches50`, `hitches100`). Tab Memory cho tổng RAM của tab. iOS: Safari Web Inspector qua cáp (không có `performance.memory`: chỉ FPS / draw call trên HUD).
6. Ghi lại: model máy, hệ điều hành + phiên bản trình duyệt, độ phân giải, draw call lớn nhất, RAM lớn nhất (heap + tex, và RAM tab nếu có), FPS trung vị với 20 NPC, gói đã tải (Loaded MB) sau khi chơi được, và nhận xét cảm nhận (giật khi sang chunk mới? click-to-move đúng?). Dán vào bảng kết quả ở trên và đóng OPEN-ITEMS #5 khi mọi dòng đạt (draw call ≤ 80, RAM ≤ 500 MB, ≥ 30 FPS, gói đầu ≤ 25 MB, tìm đường / click-to-move đúng).

Nếu FPS dưới 30 hoặc RAM vượt ngưỡng trên máy thật, chạy thêm `?npcart=placeholder` (tách chi phí NPC chibi) và `&tier=low` rồi báo lại cả ba số.

## Draw call khi có quái và HUD chiến đấu (2026-11-09)

Số 55 / 80 của báo cáo thoát P1 là **không có quái và không có HUD chiến đấu**. Đo thật (`director.root.device.numDrawCalls`) với `?npcs=20&combat=1&mobdemo=1` (14 quái cùng lúc, 20 NPC chibi, HUD chiến đấu, zoom 1,5×): **106** (vượt 80). Công cụ `?drawdbg=1` (`window.__vgtdDrawDbg()`: danh sách các lần ngắt batch theo texture và đường node; `window.__vgtdDrawExp(tên)`: thử một ý tưởng trên cảnh đang chạy) cho thấy nguồn:

| Nguồn                                                                                         | Trước |       Sau | Cách                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ----: | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HUD chiến đấu (mỗi `Label` một texture riêng; mỗi ô thanh kỹ năng đổi texture 4 lần)          |    34 |        ~8 | `Label.cacheMode` dùng atlas chung (`UiLabel.sharedAtlas`: BITMAP chỉ cho chữ lấy từ một tập cố định nhỏ vì BITMAP không thu hồi chuỗi cũ; **mọi chữ có số hoặc tên đổi khi chơi** (máu / MP, sát thương, hồi chiêu, bộ đếm, khoảng cách, số lượng, thông báo) phải là CHAR, nếu không atlas chung đầy dần và lợi ích batch mất); thanh kỹ năng dựng thành các lớp dùng chung (nền, icon, vòng hồi chiêu, chữ tĩnh) và mọi chữ đổi liên tục (máu / MP, hồi chiêu, thông báo) gom vào một lớp cuối |
| Vật thể L3 ngoài màn hình (armature NPC, quái, prop) vẫn vẽ và cắt batch của vật thể bên cạnh |   ~19 |         0 | `YSortLayer.cull`: cất node ngoài khung nhìn (cộng tầm với của sprite, có trễ chống nhấp nháy) vào node không hoạt động                                                                                                                                                                                                                                                                                                                                                                           |
| `enableBatch` của armature                                                                    |     0 | không đổi | các armature bị prop / quái chen giữa nên không liền kề; không dùng                                                                                                                                                                                                                                                                                                                                                                                                                               |

Kết quả: **60–64** (tối đa trong 30 giây đo, zoom 1,5× mặc định; zoom 1,0× nhìn rộng hơn nên ~66) với cùng cảnh, sau khi gộp thêm code mới (party, status tile, khung UI 9-slice, map vùng); tầm với cắt của chibi 120 px, prop = max(cao, rộng/2) + 30; cảnh cơ sở (20 NPC, không quái, không combat) 49 (trước 53–55); mở túi đồ 37 (không đổi). Cổng đo: `npm run perf:p1 -w client-cocos -- --mobs --draw-limit 65` (chỉ siết được ngưỡng, không nới ngưỡng dùng chung). Mục tiêu 65 chưa có chỗ trống: thêm quái / NPC trên màn hình thì phải gom tiếp (HP bar trên đầu, armature).

### Bộ đệm đỉnh của Batcher2D (`BATCHER2D_MEM_INCREMENT`, 2026-11-10)

Nguyên nhân thật của phần lớn draw call "thừa" (đo bằng `__vgtdBatchTrace` + `__vgtdGroundProbe`, xem PR): mọi sprite của một chunk nền dùng cùng texture và material, nhưng engine gộp batch chỉ khi **hash dữ liệu bằng nhau**, và hash đó gồm id của **bộ đệm đỉnh** (`bid`). Mỗi bộ đệm đỉnh 2D mặc định chỉ 144 KB = 4096 đỉnh = 1024 sprite, nên một chunk nền (~1250-5000 ô) và mọi lớp đông sprite bị cắt thành nhiều batch ở ranh giới bộ đệm, dù không có gì khác biệt.

Cách sửa: macro `BATCHER2D_MEM_INCREMENT` = **2048** (KB) trong `apps/client-cocos/settings/v2/packages/engine.json` (`macroConfig`; builder đưa vào `settings.json` của bản dựng: `"macros":{"BATCHER2D_MEM_INCREMENT":2048}`). Mỗi bộ đệm = 2048 KB / 36 B = **58254 đỉnh** (14563 sprite).

- **Giới hạn trên 2303 KB**: chỉ số đỉnh trong bộ đệm là `Uint16` (tối đa 65535 đỉnh; đỉnh 36 byte). 4096 KB cho 116508 đỉnh và vượt giới hạn, nên KHÔNG tăng quá ~2300.
- **Bộ nhớ**: mỗi bộ đệm = 2048 KB đỉnh + 455 KB chỉ số (`IB_SCALE` 4 × 2 B) ≈ 2,5 MB trên CPU và cùng cỡ đó trên GPU. Cảnh 14 quái + 20 NPC cần khoảng 80 nghìn đỉnh: 2 bộ đệm (~5 MB CPU + ~5 MB GPU), so với ~20 bộ đệm × 176 KB (~3,5 MB) ở mặc định; chênh vài MB là do làm tròn lên bộ đệm cuối. Đường RAM của cổng đo (heap JS + texture) không đổi trong sai số (160-173 MB cả hai bên); ArrayBuffer nằm ngoài heap JS nên số này không thấy phần chênh ~1-3 MB.

**Còn mở: chưa kiểm tra bộ nhớ trên máy mobile thật.** Phần chênh bộ nhớ ở trên (~1-3 MB CPU + GPU) là số TÍNH, không phải số đo: ArrayBuffer nằm ngoài heap JS nên cổng đo không thấy. Cần đo trên thiết bị thật (Android tầm thấp và iOS Safari: bộ nhớ GPU của hai bộ đệm 2048 KB, nguy cơ bị hệ điều hành đóng tab) trước khi coi là đã chốt; xem mục "Cách đo trên máy mobile thật" bên dưới và `docs/OPEN-ITEMS.md`. Số đo bằng giả lập mobile (script `npm run mem:p1 -w client-cocos`) và khuyến nghị: [docs/39](39-bo-nho-batcher2d.md).

Đo sạch (hai bản dựng release trên **stage mới** cho mỗi bên, cùng commit, chỉ khác dòng macro; `--mobs`, tối đa draw call 30 giây): zoom 1,5: **64 -> 38**; zoom 1,0: **70 -> 44**; zoom 2,0: **59 -> 35**. Kịch bản tung chiêu liên tục (nhánh PR #274, `--casting`): **70-76 -> 40-47** (zoom 1,5) trước khi gom tiếp bất cứ thứ gì khác. Lưu ý đo: bản dựng release chạy trên bản sao `build/stage-release` có Library riêng; muốn so sánh hai giá trị macro phải dùng `VGTD_STAGE_DIR` mới cho từng bên, nếu không bản dựng cũ có thể giữ cấu hình cũ.

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

Điều kiện: máy tính và điện thoại cùng mạng Wi-Fi, tường lửa cho phép cổng 8456 (cổng mặc định của server tĩnh client; 7456 là của Cocos Creator nên không dùng). Cách nhanh nhất: `npm run play` (README gốc) in sẵn các URL LAN.

1. `npm run build:web -w client-cocos -- --release` (cần Cocos Creator, xem README).
2. `npm run serve -w client-cocos` — server lắng nghe mọi giao diện và in ra các dòng `LAN: http://<IP-máy-tính>:8456/?npcs=20`.
3. Trên điện thoại mở đúng URL đó bằng Chrome (Android) hoặc Safari (iOS). Cờ URL: `?npcs=20` (số NPC, mặc định 20), `?npcart=placeholder` (NPC sprite đơn giản thay vì chibi thật), `?tier=low|medium|high` (cửa sổ streaming), `?class=<id>` (lớp người chơi), `?input=touch`.
4. Số liệu hiện **ngay trên màn hình** (HUD góc trên-trái): FPS, Draw calls / 80, Tex mem, JS heap, Nodes, Chunks, NPC, Loaded MB. Đợi 30 giây cho số ổn định, vừa click/joystick di chuyển vừa chụp màn hình HUD. FPS trung vị lấy bằng mắt qua nhiều lần chụp hoặc từ console (bước 5).
5. Console: Android Chrome → `chrome://inspect` trên máy tính (USB debugging) → Console in dòng `[vgtd][perf] {...}` mỗi 2 giây (JSON đủ số liệu); tab Memory cho tổng RAM của tab. iOS: Safari Web Inspector qua cáp (`performance.memory` không có, chỉ FPS / draw call trên HUD).
6. Ghi lại: model máy, hệ điều hành + phiên bản trình duyệt, độ phân giải, draw call lớn nhất, RAM lớn nhất, FPS trung vị với 20 NPC chibi (mặc định), rồi dán vào bảng dưới và đóng OPEN-ITEMS #5 khi mọi dòng đạt.

## Kết quả (lịch sử, trước D71: các số FAIL ở đây đã được sửa bởi PR #197, xem báo cáo thoát P1 ở trên)

Đo bằng `npm run perf:p1 -w client-cocos` ngày 2026-11-08, Windows 11, headless Chrome + SwiftShader, 1280×720, tier `medium`, world 32×32 ô = **1 chunk**. Hai dòng đầu dùng nhân vật chibi thật (`ChibiBody`, PR #193) cho người chơi; đủ 20 NPC chibi lớp lẫn nhau dùng cả 6 lớp:

| Cấu hình                           | Draw call (≤ 80) | RAM heap+texture (≤ 500 MB) | FPS (≥ 30, phần mềm) | Gói đầu fetch (≤ 25 MB)  |
| ---------------------------------- | ---------------- | --------------------------- | -------------------- | ------------------------ |
| Người chơi chibi, 0 NPC            | 8                | 94,5                        | 41,8                 | 14,06 (gzip 9,43)        |
| 20 NPC sprite placeholder          | 8                | 95,2                        | 42,8                 | 14,06 (gzip 9,43)        |
| **20 NPC chibi, 6 lớp (mặc định)** | 45               | **536,9** (texture 466,8)   | 41,5                 | **135,79** (gzip 125,58) |

**Kết luận: với nghệ thuật thật, P1 chưa đạt.** Draw call và FPS (phần mềm) đạt; RAM và gói đầu vượt ngưỡng vì mỗi lớp chibi nạp 5 hướng với atlas lớn: mỗi lớp thêm khoảng 20 MB tải và ~70–90 MB texture GPU (PNG 6 MB giải nén thành RGBA). Hướng giải quyết thuộc phần thiết kế asset, không sửa trong PR này: nén texture (KTX2/ASTC/WebP theo docs/06), giảm kích thước atlas / số hướng nạp, nạp lười theo lớp (Class pack tách khỏi Core ≤ 25 MB), giới hạn số lớp khác nhau trong tầm nhìn. Đo lại sau mỗi thay đổi bằng cùng lệnh (có `--npcart placeholder` hoặc `--npcs 0` để tách chi phí).

Chi tiết dòng mặc định: frame 24,1 ms (CPU update 0,29 + submit render 0,42 ms, phần còn lại là rasterize phần mềm), 2064 node, heap 70,1 MB.

**Chưa đủ để đóng P1** (OPEN-ITEMS #5): (a) chưa đo trên máy mobile thật; (b) map hiện chỉ 1 chunk nên streaming chưa chịu tải nhiều chunk; (c) RAM native của trình duyệt chưa tính; (d) asset `resources` dev-only trong thư mục build (~228 MB) phải tách khỏi gói phát hành.

## Streaming trên map nhiều chunk (đi bộ theo tuyến; số liệu bảng là trước D71, báo cáo thoát P1 ở trên là số cuối)

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
