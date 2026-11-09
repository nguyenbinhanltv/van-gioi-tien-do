# 35. Kiểm thử tải P5: bot chơi thật, soak ngắn và dài (D100)

Tiêu chí P5 ([docs/10 §12](10-mvp-scope.md)): "Test tải 200 CCU bot"; cổng beta: "100 CCU 24 giờ không sự cố". Chiến lược chung: [docs/28 §6](28-chien-luoc-kiem-thu.md). Tài liệu này mô tả công cụ `npm run soak`, cách đọc kết quả, các số đo đầu tiên và những gì **chưa** đo được.

**Không đổi số gameplay nào.** Ngưỡng bên dưới là ngân sách thiết kế đã có (docs/00 §3, docs/08 §8, docs/28 §6.2). Chỗ nào trượt, tài liệu này **báo cáo**, không chỉnh ngưỡng hay mã để cho đạt.

## 1. Công cụ

```bash
npm run soak -w @vgtd/server -- --bots 200 --minutes 30 --out soak-30m     # soak ngắn (200 bot, 30 phút)
npm run soak -w @vgtd/server -- --bots 100 --hours 24 --out soak-24h       # soak dài: cổng beta, chạy tay, KHÔNG chạy trong CI
npm run soak -w @vgtd/server -- --ci                                       # khói CI: 20 bot, 60 giây
```

Mã: `apps/server/src/loadtest/` (`game-bot.ts`, `game-worker.ts`, `soak.ts`, `soak-report.ts`), kịch bản chạy `apps/server/scripts/soak.mjs` (đóng gói bằng esbuild, chạy `node --expose-gc`).

- **Bot chơi thật** (`GameBot`): bọc `NetClient` thật của `@vgtd/client-core` (đăng nhập HTTP, WebSocket, dự đoán, nội suy, nối lại), không dùng trình duyệt. Mỗi bot chọn lớp (đủ 4 lớp luân phiên, D82), rồi chạy hỗn hợp: đi lang thang, săn quái (đi tới, đánh theo vòng kỹ năng, tôn trọng hồi chiêu và GCD / thời gian niệm), thiền, đứng yên; chat kênh Thế Giới, mời / nhận / rời tổ đội, nhận quà túi (`sendBagClaim`), dùng đan hồi máu. Nhịp mặc định là nhịp "thực tế" (`REALISTIC`); `--social-pace F` chia nhỏ nhịp chat / tổ đội để một lần chạy ngắn vẫn đi qua các đường đó (khói CI dùng 0,12).
- **Đường thật phía server**: gateway HTTP + WebSocket thật, World Node thật với combat, quái (149 quái trong vùng 96×96 của bot), tiến trình, túi đồ và **kho tệp D92** (`--store file`, mặc định; `--store memory` để so sánh). Server chạy trong luồng chính, bot chạy trong các worker thread (một vòng 33 ms dùng chung mỗi worker, kết nối dàn đều `--connect-per-s`).
- **Đo** (mỗi `--sample-s` giây, ghi `samples.jsonl`, `samples.csv`, `summary.json`, `report.txt` vào `--out`): thời gian tick (p50 / p95 / p99 / max, **toàn bộ lần chạy** bằng `TickHistogram`, không phải trung bình các cửa sổ), tách bước sim / AOI / mã hóa + gửi snapshot, số tick quá 50 ms, băng thông xuống / lên theo người chơi (payload + header khung WebSocket), số thực thể thấy, tốc độ `aoi_enter`, heap (đo **sau `gc()`**) và RSS theo thời gian, số bị đá / ngắt / vi phạm giao thức theo loại, hoạt động của bot (cast, hạ quái, chết, chat gửi / nhận, tổ đội, thiền).
- **Mã thoát**: 0 đạt mọi tiêu chí, 1 trượt tiêu chí (ở `--ci`: trượt cổng), 2 công cụ hỏng.
- **Khói CI** (`.github/workflows/ci.yml`, bước sau `docs:links`, `timeout-minutes: 5`): chỉ chặn về **đúng đắn** (bot bị rớt / bị đá, vi phạm giao thức, không ai chơi) và **tick p99 vượt trần thô** (`--max-tick-p99`, mặc định 100 ms). Ngưỡng thiết kế (tick p99 ≤ 40 ms...) chỉ để thông tin, vì runner chung quá nhiễu. Về vi phạm giao thức: mọi loại **trừ `cooldown`** làm cổng đỏ; `cooldown` được báo cáo nhưng không chặn cho tới khi mục 3 ("Vi phạm `cooldown`") được giải quyết, vì bot trung thực vẫn dính một ít khi server stall (có test khóa hành vi này trong `soak-report.test.ts`).

## 2. Tiêu chí và ngưỡng

| Tiêu chí                    | Ngưỡng                                                        | Nguồn                             |
| --------------------------- | ------------------------------------------------------------- | --------------------------------- |
| CCU ổn định                 | mọi bot còn online cuối lần chạy, 0 bị đá / ngắt / nối lại    | docs/10 §12 (cổng beta)           |
| Tick p99                    | ≤ 40 ms (ngân sách tick 50 ms ở 20 Hz)                        | docs/28 §6.2, docs/08             |
| Băng thông xuống / người    | ≤ 8 KB/s khi săn quái (trung bình lần chạy và p95 của cửa sổ) | docs/00 §3, docs/28 §6.2          |
| Băng thông lên / người      | < 1 KB/s                                                      | docs/08 §8                        |
| Thực thể gửi / người        | ≤ 120 (Mobile / Web)                                          | docs/00 §3                        |
| Heap                        | trôi ≤ 5 % (trung vị quý cuối so với quý hai, sau warm-up)    | docs/28 §6.2 (đề xuất)            |
| Vi phạm giao thức / lỗi bot | 0                                                             | bot trung thực không được vi phạm |
| Bot thật sự chơi            | cast > 0, hạ quái > 0 (khi có quái), chat nhận > 0 (≥ 2 phút) | tránh "đạt" vì không làm gì       |

Số vi phạm chỉ tính **trong cửa sổ đo** (sau warm-up); bộ đếm của server từ lúc khởi động (gồm giai đoạn nối bot) được in kèm theo loại.

## 3. Số đo đầu tiên (2026-11-09)

Máy: dev Windows 11, **i5-12400F (12 luồng), 32 GB**, Node 24.12, loopback, không TLS. **Server và toàn bộ bot (4 / 2 worker) chạy chung một máy** và máy dev còn tiến trình khác (các phiên agent khác) → số tick là cận trên, không phải số của một server riêng. Kho tệp D92 (`--store file`) trừ khi ghi khác. Mọi tệp kết quả thô nằm ngoài kho mã (thư mục `--out` của người chạy).

| Lần chạy                        | Bot | Đo    | Tick p50 / p95 / **p99** / max (ms) | Tick > 50 ms | Xuống KB/s/người (TB / p95 cửa sổ / xấu nhất) | Lên KB/s (TB / xấu nhất) | Thực thể thấy (TB / max) | Heap (MB), trôi | RSS max | Vi phạm (trong cửa sổ) |
| ------------------------------- | --- | ----- | ----------------------------------- | ------------ | --------------------------------------------- | ------------------------ | ------------------------ | --------------- | ------- | ---------------------- |
| A. 200 bot, kho tệp             | 200 | 10 ph | 16,5 / 54,8 / **102,0** / 243,5     | 654 (5,86 %) | 4,06 / 5,93 / 6,33                            | 0,28 / 0,41              | 112,6 / 120              | 22 → 23, 4,4 %  | 979 MB  | 526 (`cooldown`)       |
| B. 100 bot, kho tệp (cổng beta) | 100 | 5 ph  | 9,5 / 54,5 / **98,3** / 347,6       | 328 (5,91 %) | 3,35 / 5,18 / 5,69                            | 0,29 / 0,57              | 88,7 / 120               | 18 → 19, 3,0 %  | 600 MB  | 180 (`cooldown`)       |
| C. 100 bot, **kho bộ nhớ**      | 100 | 3 ph  | 9,8 / 47,3 / **79,5** / 273,8       | 157 (4,52 %) | 3,53 / 5,92 / 5,96                            | 0,28 / 0,40              | 88,3 / 120               | 19 → 20, 3,1 %  | 592 MB  | 81 (`cooldown`)        |

Trong mọi lần chạy: **0 bot rớt**, 0 bị đá, 0 ngắt phía server, 0 nối lại; hoạt động thật (A: 28,6 nghìn cast, 2.480 hạ quái, 62 chết, chat 1.576 / 1.576 đến nơi, 340 lần vào tổ đội, 1.059 lần thiền, 326 nghìn ô đã đi). Chi phí trung bình mỗi tick ở A: bước sim 0,90 ms, AOI 8,03 ms mỗi tick AOI (max 136 ms), mã hóa + gửi snapshot 12,56 ms.

### Kết luận theo tiêu chí

| Tiêu chí                | 200 bot                                                                  | 100 bot                   |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------- |
| CCU ổn định             | **ĐẠT** 200 / 200                                                        | **ĐẠT** 100 / 100         |
| Băng thông xuống        | **ĐẠT** 4,06 KB/s (xấu nhất 6,33, ngưỡng 8)                              | **ĐẠT** 3,35 KB/s         |
| Băng thông lên          | **ĐẠT** 0,28 KB/s                                                        | **ĐẠT** 0,29 KB/s         |
| Thực thể / người        | **ĐẠT** tối đa 120 (đúng trần; bị chặn bởi `MAX_VISIBLE`)                | **ĐẠT**                   |
| Heap                    | **ĐẠT** trôi 4,4 % (mốc 5 %: sát; chạy 10 phút, chỉ mang tính tham khảo) | **ĐẠT** 3,0 %             |
| **Tick p99 ≤ 40 ms**    | **TRƯỢT**: p99 102 ms                                                    | **TRƯỢT**: p99 98 ms      |
| **0 vi phạm giao thức** | **TRƯỢT**: 526 vi phạm `cooldown`                                        | **TRƯỢT**: 180 `cooldown` |

### Hai chỗ trượt, nói thẳng

**1. Tick p99.** Trung vị tick lành (9,5 ms ở 100 bot, 16,5 ms ở 200 bot, đúng dạng "tuyến tính theo số người") nhưng **đuôi** dài: 4,5–5,9 % tick vượt 50 ms, max 243–348 ms, và p99 gần như **không phụ thuộc số bot** (102 ms ở 200 bot, 98 ms ở 100 bot). Đuôi không tỉ lệ với tải nghĩa là phần lớn là **giật cục** (dừng 100–350 ms rời rạc), không phải "mỗi tick đều nặng". Đã loại trừ một nghi phạm: đổi kho tệp sang kho bộ nhớ (lần C) hạ p99 từ 98 xuống 79,5 ms nhưng **không làm đuôi biến mất**, nên việc ghi tệp D92 không phải nguyên nhân chính (có thể góp một phần). Heap chỉ ~20 MB nên GC của server khó là thủ phạm. **Nguyên nhân chưa chứng minh được**; nghi vấn hợp lý nhất là tranh chấp CPU / lập lịch hệ điều hành giữa server, 2–4 worker bot (mỗi bot chạy dự đoán + nội suy của `NetClient`) và các tiến trình khác trên cùng máy dev dùng chung. Hai bằng chứng củng cố: một lần chạy 200 bot khác trong lúc máy bị tác vụ nặng khác (chạy test) cho p99 tới 204 ms ở các cửa sổ trùng thời điểm đó (lần chạy đó bị loại, không dùng trong bảng); và baseline P2 trên cùng máy với bot nhẹ trong một tiến trình (kịch bản `war`, 200 người) cho p99 31–44 ms ([OPEN-ITEMS "P2 exit"](OPEN-ITEMS.md)). Muốn kết luận phải đo trên **máy riêng cho server, bot ở máy khác** (hoặc ít nhất ghim server vào lõi riêng); việc này chưa làm. Chưa chỉnh mã hay ngưỡng nào.

**2. Vi phạm `cooldown`.** Bot trung thực vẫn dính 180–526 vi phạm `cooldown` (và 182 vi phạm `budget` ở lần chạy bị loại), tức server ghi nhận cast sớm hơn hồi chiêu / GCD. Bot đã cộng biên 150 ms cho hồi chiêu và 120 ms cho GCD / thời gian niệm, nên đây không phải bot bắn sớm có chủ ý. Giả thuyết: khi tick bị giật, đồng hồ mô phỏng của server chạy chậm hơn đồng hồ thực mà bot dùng để hẹn cast, nên cast "đến sớm" so với hồi chiêu tính theo thời gian mô phỏng. Hai điều khớp với giả thuyết: số vi phạm giảm theo đuôi tick (81 ở lần C, đuôi ngắn nhất, so với 180 và 526), và mọi vi phạm là loại `cooldown`. Vẫn **chưa chứng minh** và cần xác nhận khi (1) được làm rõ; nếu sau khi tick ổn mà vi phạm còn thì đó là lỗi của bot hoặc của đường cast. Đáng chú ý: không có bot nào bị đá (bị đá cần điểm nghi ngờ tích lũy), nên chống gian lận không phạt oan trong các lần chạy này.

### Việc mở (không nằm trong PR này)

- Đo lại trên máy riêng / server tách khỏi bot để chốt tick p99 và vi phạm `cooldown` (mục 1, 2).
- **Chưa chạy** soak 30 phút, 4–8 giờ (S5) và 24 giờ (cổng beta "100 CCU 24 giờ không sự cố"): công cụ có sẵn (`--minutes`, `--hours`, ghi CSV mỗi `--sample-s` giây, heap sau GC, xu hướng heap theo MB / giờ) nhưng các lần đó cần chạy tay trên máy chủ riêng. Trôi heap trong 5–10 phút chỉ mang tính chỉ báo (báo cáo ghi rõ "run shorter than 2 h").
- Bot hiện vẫn chưa gồm: bạn bè (D96), đột phá lớn (D97, cần tu vi đủ), mua bán / chợ, bản đồ nhiều vùng.
- Chưa có PvP nên chưa có "100 vs 100" hai phe (như đã ghi ở "P2 exit").

## 4. Cách đọc `report.txt`

`[PASS]` / `[FAIL]` từng tiêu chí ở mục 2, kèm số đo và ngưỡng; `[INFO]` là chi phí AOI. `samples.csv` mở được bằng bảng tính để vẽ tick p99, băng thông, heap, RSS theo thời gian (cột `tick_p99`, `down_kbps_mean`, `heap_mb`...). `summary.json` là toàn bộ kết quả dạng máy đọc được (dùng `--json` để in ra stdout).
