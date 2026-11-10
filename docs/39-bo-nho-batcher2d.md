# 39. Bộ nhớ của bộ đệm đỉnh Batcher2D (`BATCHER2D_MEM_INCREMENT`)

Báo cáo đo (2026-11-10) cho PR #283, nơi đặt `macroConfig.BATCHER2D_MEM_INCREMENT = 2048` (KB) trong `apps/client-cocos/settings/v2/packages/engine.json` để các lớp đông sprite không bị cắt batch mỗi 1024 sprite ([docs/33](33-p1-perf.md), mục "Bộ đệm đỉnh của Batcher2D"). PR #283 ghi chú rằng chênh bộ nhớ khoảng 1-3 MB chỉ là số TÍNH; báo cáo này đo thật bằng giả lập mobile. **PR này không đổi hằng số.**

## Cách đo (lặp lại được)

```bash
npm run mem:p1 -w client-cocos -- --macro 144,1024,2048 --runs 3 --seconds 20
# --scenarios default,casting  --device "Moto G4"  --cpu-throttle 4  --tier low  --out <dir>  --reuse (dùng lại bản dựng đã có)  --no-ua-mem
```

`apps/client-cocos/scripts/mem-p1.mjs`, cho từng giá trị macro (KB; 144 = mặc định của engine, tức không có khóa `macroConfig`):

1. dựng `web-mobile --release` trong **stage riêng** của giá trị đó (stage dùng chung có thể giữ macro cũ trong Library, xem docs/33), ghi giá trị vào `engine.json` trong lúc dựng rồi khôi phục (cả khi Ctrl+C; nếu tiến trình bị giết cứng thì `git checkout` lại file đó), copy bản dựng sang `<out>/web-<giá trị>` và kiểm tra `settings.json` của bản dựng đúng macro (`engine.macros.BATCHER2D_MEM_INCREMENT`);
2. đo từng kịch bản `--runs` lần trên Chrome / Edge headless với **giả lập mobile** (mặc định Moto G4: 360×640 @3x, cảm ứng, UA di động) và **CPU throttle ×4**, `tier=low` (tier điện thoại: atlas @1x, cửa sổ chunk nhỏ): `default` = cảnh nền 20 NPC; `casting` = 14 quái + 20 NPC + HUD chiến đấu, thanh kỹ năng tung chiêu liên tục (`?vfxdemo=1`). Mỗi lần: nóng máy 8 s rồi lấy mẫu 20 s:
   - **JS heap used** (CDP `Performance.getMetrics`), **draw call** và số **renderable sống** (`__vgtdDrawDbg`: số quad nằm trong các bộ đệm đỉnh của batcher);
   - từ hệ điều hành, mỗi 2 s, bộ nhớ các tiến trình của trình duyệt (CDP `SystemInfo.getProcessInfo` → pid → working set và private bytes trên Windows, VmRSS trên Linux): **renderer** (JS heap + ArrayBuffer như bộ đệm đỉnh / chỉ số + DOM) và **tiến trình GPU** (với SwiftShader, "GPU" phần mềm: đỉnh, texture, render target nằm ở đây);
   - một lần cuối `performance.measureUserAgentSpecificMemory()` (số byte trang giữ, gồm cả ArrayBuffer; cần cô lập cross-origin, script đã đặt header).
3. in bảng markdown (trung vị của các lần chạy, `[min..max]`) và ghi `<out>/mem-p1.json`.

Giới hạn: headless SwiftShader KHÔNG phải GPU điện thoại. Số tiến trình chỉ là **thước đo gián tiếp** để so A/B giữa các giá trị macro trên cùng một máy, không phải số tuyệt đối trên điện thoại; riêng số renderer / GPU dao động ±5-10 MB giữa các lần chạy nên mọi chênh lệch dưới mức đó là nhiễu.

## Kết quả (Moto G4 ×4 CPU, tier low, 3 lần × 20 s)

### default

| metric                                         |                  144 KB |                 1024 KB |                 2048 KB | delta (2048 - 144) |
| ---------------------------------------------- | ----------------------: | ----------------------: | ----------------------: | -----------------: |
| JS heap used (MB)                              |       54.0 [54.0..58.5] |       56.3 [54.0..58.5] |       57.6 [55.9..57.7] |               +3.6 |
| renderer process working set (MB)              |    250.2 [247.8..252.9] |    247.6 [242.9..252.4] |    246.0 [245.9..252.4] |               -4.2 |
| renderer private bytes (MB)                    |    194.4 [189.9..196.2] |    195.1 [189.7..195.5] |    190.8 [190.4..196.7] |               -3.5 |
| GPU process working set (MB)                   |    247.5 [246.6..250.2] |    249.2 [246.4..250.8] |    252.0 [245.2..252.6] |               +4.5 |
| GPU private bytes (MB)                         |    267.2 [267.1..267.4] |    267.1 [267.1..275.1] |    267.0 [259.1..267.3] |               -0.2 |
| measureUserAgentSpecificMemory (MB)            |       91.8 [91.2..91.8] |       92.1 [92.1..92.2] |       93.3 [92.5..93.4] |               +1.5 |
| live renderables (quads in the vertex buffers) | 5062.0 [5058.0..5063.0] | 5061.0 [5059.0..5062.0] | 5061.0 [5060.0..5064.0] |               -1.0 |
| draw calls (max)                               |       33.0 [32.0..33.0] |       24.0 [23.0..24.0] |       24.0 [23.0..25.0] |               -9.0 |

### casting

| metric                                         |                  144 KB |                 1024 KB |                 2048 KB | delta (2048 - 144) |
| ---------------------------------------------- | ----------------------: | ----------------------: | ----------------------: | -----------------: |
| JS heap used (MB)                              |       58.9 [57.9..62.1] |       57.6 [56.9..60.4] |       59.1 [56.8..63.3] |               +0.2 |
| renderer process working set (MB)              |    266.3 [264.6..266.4] |    266.8 [266.3..274.0] |    268.8 [263.1..270.9] |               +2.4 |
| renderer private bytes (MB)                    |    210.3 [209.2..212.1] |    213.1 [212.8..219.9] |    214.7 [208.0..215.3] |               +4.4 |
| GPU process working set (MB)                   |    256.6 [251.2..258.2] |    256.6 [255.1..262.5] |    258.8 [253.2..259.8] |               +2.3 |
| GPU private bytes (MB)                         |    284.9 [277.3..285.3] |    276.8 [276.8..284.7] |    276.7 [268.8..285.9] |               -8.3 |
| measureUserAgentSpecificMemory (MB)            |       95.7 [95.5..96.0] |       96.1 [96.0..96.2] |       97.0 [96.6..97.1] |               +1.3 |
| live renderables (quads in the vertex buffers) | 5124.0 [5119.0..5128.0] | 5121.0 [5121.0..5121.0] | 5121.0 [5119.0..5125.0] |               -3.0 |
| draw calls (max)                               |       62.0 [57.0..62.0] |       35.0 [35.0..35.0] |       34.0 [33.0..36.0] |              -28.0 |

Cách đọc:

- **Tín hiệu sạch duy nhất là `measureUserAgentSpecificMemory`** (khoảng min..max của các giá trị không chồng nhau): 2048 KB tốn thêm **+1,5 MB** (cảnh nền, 91,8 → 93,3) và **+1,3 MB** (tung chiêu, 95,7 → 97,0), tức khoảng **1,5 %** bộ nhớ trang; 1024 KB tốn thêm chỉ **+0,3 / +0,4 MB**. Khớp với phép tính bên dưới.
- Heap JS, working set renderer / GPU và private bytes dao động trong cùng khoảng nhiễu giữa 144, 1024 và 2048 KB (dấu của chênh lệch đổi giữa hai kịch bản): **không thấy** chênh lệch bộ nhớ tiến trình nào vượt nhiễu. Các số "GPU private" chênh -8..-16 MB ở kịch bản tung chiêu nằm trong khoảng min..max chồng nhau của các lần chạy, KHÔNG nên đọc là tiết kiệm.
- **Draw call**: cảnh nền 33 → 24, tung chiêu 62 → 34-35 (cùng kết luận của #283; 1024 KB cho đúng số draw call của 2048 KB ở tier low).

## Phép tính bộ nhớ (vì sao 1024 và 2048 khác nhau theo cỡ cảnh)

Một bộ đệm đỉnh có `V = macro × 1024 / 36` đỉnh (đỉnh 2D 36 B), cộng bộ đệm chỉ số `V × 4 × 2 B` (`IB_SCALE` 4, `Uint16`), và engine tạo thêm bộ đệm khi chunk không còn chỗ; GPU giữ một bản cùng cỡ.

| macro (KB) | đỉnh / bộ đệm | quad / bộ đệm | KB / bộ đệm (đỉnh + chỉ số) |
| ---------: | ------------: | ------------: | --------------------------: |
|        144 |          4096 |          1024 |                         176 |
|       1024 |         29127 |          7281 |                        1252 |
|       2048 |         58254 |         14563 |                        2503 |

Số quad sống đo được: **~5100** ở tier low (cảnh nền và tung chiêu cùng cỡ vì tung chiêu thêm rất ít renderable) và khoảng 20000 ở tier medium (ƯỚC TÍNH, chưa đo bằng `mem:p1`: 4 chunk nền × ~5000 ô, cửa sổ chunk lớn hơn). Từ đó:

| cảnh (quad)              |            144 KB |          1024 KB |          2048 KB |
| ------------------------ | ----------------: | ---------------: | ---------------: |
| tier low, ~5100 quad     |  6 bộ đệm, 1,0 MB | 1 bộ đệm, 1,2 MB | 1 bộ đệm, 2,4 MB |
| tier medium, ~20000 quad | 20 bộ đệm, 3,4 MB | 3 bộ đệm, 3,7 MB | 2 bộ đệm, 4,9 MB |

(MB phía CPU; GPU giữ bản cùng cỡ theo lý thuyết, chưa đo riêng được trên SwiftShader.) Chênh của 2048 so với mặc định: **+1,4 MB** (low) và **+1,5 MB** (medium), phía CPU, cộng thêm từng ấy phía GPU. Đính chính cho #283: "cảnh cần khoảng 80 nghìn đỉnh" chỉ đúng với tier medium; ở tier low chỉ ~20 nghìn đỉnh nên một bộ đệm 1024 KB đã đủ.

## Khuyến nghị

1. **Giữ 2048 KB**: chi phí đo được khoảng +1,5 MB (CPU, cộng bản GPU tương đương, ≈ 1,5 % bộ nhớ trang) so với giảm 6-28 draw call; ở tier medium và cao 2048 KB còn rẻ hơn hoặc bằng 1024 KB về số bộ đệm (2 so với 3). Không có tín hiệu bộ nhớ tiến trình nào vượt nhiễu.
2. **Phương án dự phòng nếu máy thật báo áp lực bộ nhớ ở tier low: 1024 KB** (cùng số draw call ở tier low, thêm chỉ ~0,3-0,4 MB). Chỉ đổi nếu đo trên thiết bị thật xác nhận; hằng số là toàn bản dựng (không đổi theo tier lúc chạy), nên đổi xuống 1024 làm tier medium / high tốn thêm khoảng 1 bộ đệm.
3. **Trần cứng 2303 KB** (chỉ số `Uint16`, 65535 đỉnh): không tăng quá mức đó.
4. **Còn mở: chưa đo trên máy mobile thật** (Android tầm thấp và iOS Safari): số ở đây là giả lập trên SwiftShader. Cần chạy `mem:p1` (hoặc xem bộ nhớ GPU trong Safari / Chrome DevTools của thiết bị) trước khi coi là chốt; xem [docs/OPEN-ITEMS.md](OPEN-ITEMS.md).
