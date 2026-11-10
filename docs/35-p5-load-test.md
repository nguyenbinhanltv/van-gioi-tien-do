# 35. Kiểm thử tải P5: bot chơi thật, soak ngắn và dài (D100)

Tiêu chí P5 ([docs/10 §12](10-mvp-scope.md)): "Test tải 200 CCU bot"; cổng beta: "100 CCU 24 giờ không sự cố". Chiến lược chung: [docs/28 §6](28-chien-luoc-kiem-thu.md). Tài liệu này mô tả công cụ `npm run soak`, cách đọc kết quả, các số đo đầu tiên và những gì **chưa** đo được.

**Không đổi số gameplay nào.** Ngưỡng bên dưới là ngân sách thiết kế đã có (docs/00 §3, docs/08 §8, docs/28 §6.2). Chỗ nào trượt, tài liệu này **báo cáo**, không chỉnh ngưỡng hay mã để cho đạt.

## 1. Công cụ

```bash
npm run soak -w @vgtd/server -- --bots 200 --minutes 30 --out soak-30m     # soak ngắn (200 bot, 30 phút)
npm run soak -w @vgtd/server -- --bots 100 --hours 24 --out soak-24h       # soak dài: cổng beta, chạy tay, KHÔNG chạy trong CI
npm run soak -w @vgtd/server -- --ci                                       # khói CI: 20 bot, 60 giây
npm run soak -w @vgtd/server -- --preset smoke                             # khói cục bộ 25 phút: 100 bot, backup mỗi 5 phút (mục 6)
npm run soak -w @vgtd/server -- --preset full --out soak-24h               # 24 giờ trên máy riêng: 200 bot, backup mỗi 30 phút (mục 6)
```

Mã: `apps/server/src/loadtest/` (`game-bot.ts`, `game-worker.ts`, `soak.ts`, `soak-report.ts`), kịch bản chạy `apps/server/scripts/soak.mjs` (đóng gói bằng esbuild, chạy `node --expose-gc`).

- **Bot chơi thật** (`GameBot`): bọc `NetClient` thật của `@vgtd/client-core` (đăng nhập HTTP, WebSocket, dự đoán, nội suy, nối lại), không dùng trình duyệt. Mỗi bot chọn lớp (đủ 4 lớp luân phiên, D82), rồi chạy hỗn hợp: đi lang thang, săn quái (đi tới, đánh theo vòng kỹ năng, tôn trọng hồi chiêu và GCD / thời gian niệm), thiền, đứng yên; chat kênh Thế Giới, mời / nhận / rời tổ đội, nhận quà túi (`sendBagClaim`), dùng đan hồi máu. Nhịp mặc định là nhịp "thực tế" (`REALISTIC`); `--social-pace F` chia nhỏ nhịp chat / tổ đội để một lần chạy ngắn vẫn đi qua các đường đó (khói CI dùng 0,12).
- **Đường thật phía server**: gateway HTTP + WebSocket thật, World Node thật với combat, quái (149 quái trong vùng 96×96 của bot), tiến trình, túi đồ và **kho tệp D92** (`--store file`, mặc định; `--store memory` để so sánh). Server chạy trong luồng chính, bot chạy trong các worker thread (một vòng 33 ms dùng chung mỗi worker, kết nối dàn đều `--connect-per-s`).
- **Đo** (mỗi `--sample-s` giây, ghi `samples.jsonl`, `samples.csv`, `summary.json`, `report.txt` vào `--out`): thời gian tick (p50 / p95 / p99 / max, **toàn bộ lần chạy** bằng `TickHistogram`, không phải trung bình các cửa sổ), tách bước sim / AOI / mã hóa + gửi snapshot, số tick quá 50 ms, băng thông xuống / lên theo người chơi (payload + header khung WebSocket), số thực thể thấy, tốc độ `aoi_enter`, heap (đo **sau `gc()`**) và RSS theo thời gian, số bị đá / ngắt / vi phạm giao thức theo loại, hoạt động của bot (cast, hạ quái, chết, chat gửi / nhận, tổ đội, thiền).
- **Mã thoát**: 0 đạt mọi tiêu chí, 1 trượt tiêu chí (ở `--ci`: trượt cổng), 2 công cụ hỏng.
- **Khói CI** (`.github/workflows/ci.yml`, bước sau `docs:links`, `timeout-minutes: 5`): chỉ chặn về **đúng đắn** (bot bị rớt / bị đá, vi phạm giao thức, không ai chơi) và **tick p99 vượt trần thô** (`--max-tick-p99`, mặc định 100 ms). Ngưỡng thiết kế (tick p99 ≤ 40 ms...) chỉ để thông tin, vì runner chung quá nhiễu. Về vi phạm giao thức: mọi loại **trừ `cooldown`** làm cổng đỏ; `cooldown` được báo cáo nhưng không chặn cho tới khi mục 3 ("Vi phạm `cooldown`") được giải quyết, vì bot trung thực vẫn dính một ít khi server stall (có test khóa hành vi này trong `soak-report.test.ts`).

## 2. Tiêu chí và ngưỡng

| Tiêu chí                    | Ngưỡng                                                                                 | Nguồn                                                   |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| CCU ổn định                 | mọi bot còn online cuối lần chạy, 0 bị đá / ngắt / nối lại                             | docs/10 §12 (cổng beta)                                 |
| Tick p99                    | ≤ 40 ms (ngân sách tick 50 ms ở 20 Hz)                                                 | docs/28 §6.2, docs/08                                   |
| Băng thông xuống / người    | ≤ 8 KB/s khi săn quái (trung bình lần chạy và p95 của cửa sổ)                          | docs/00 §3, docs/28 §6.2                                |
| Băng thông lên / người      | < 1 KB/s                                                                               | docs/08 §8                                              |
| Thực thể gửi / người        | ≤ 120 (Mobile / Web)                                                                   | docs/00 §3                                              |
| Heap                        | trôi ≤ 5 % (trung vị quý cuối so với quý hai, sau warm-up)                             | docs/28 §6.2 (đề xuất)                                  |
| Độ dốc heap / RSS           | heap ≤ 20 MB/giờ, RSS ≤ 40 MB/giờ sau khoảng khởi động (chỉ xét khi chạy ≥ 10 phút)    | đề xuất của công cụ soak (D121 chưa có số của designer) |
| Nhật ký ghi trước nén gọn   | `journal.json` không nằm trên đĩa / treo ở ≥ 3 mẫu liên tiếp, không treo cuối lần chạy | D102 (xóa sau mỗi commit)                               |
| Backup khi đang chạy        | mỗi bản thành công, ≤ 15 giây; bản cuối xác thực được (`verifyBackup`)                 | D99                                                     |
| Vi phạm giao thức / lỗi bot | 0                                                                                      | bot trung thực không được vi phạm                       |
| Bot thật sự chơi            | cast > 0, hạ quái > 0 (khi có quái), chat nhận > 0 (≥ 2 phút)                          | tránh "đạt" vì không làm gì                             |

Các ngưỡng soak (độ dốc, backup, ngân sách tick p99, độ dài chuỗi nhật ký treo) là **thiết lập của công cụ**, đề xuất, không phải số gameplay; đổi bằng `--max-heap-slope-mb-h`, `--max-rss-slope-mb-h`, `--max-tick-p99-budget`, `--max-backup-s`, `--journal-stuck-samples` (mặc định 20 / 40 / 40 / 15 / 3). Chạy ngắn hơn 10 phút thì hai độ dốc chỉ để thông tin.

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

## 5. Điều tra D106: vi phạm `cooldown` và đuôi tick

Hai chỗ trượt ở mục 3 được điều tra tiếp (D106). Không đổi số gameplay nào.

### 5.1 Vi phạm `cooldown` của bot trung thực: đã tìm ra nguyên nhân và sửa

**Nguyên nhân (đã tái hiện bằng test xác định, `apps/server/tests/cast-timing.test.ts`).** `step()` xét một cast theo đồng hồ của **tick xử lý nó** và bắt đầu hồi chiêu / GCD ở đúng mốc đó. Mọi độ trễ giữa lúc cast **đến** server và tick xử lý (lượng tử hóa 50 ms của tick, và nhất là một tick bị đứng) làm dời mốc bắt đầu hồi chiêu: client chờ `cooldown + 150 ms` tính trên đồng hồ của nó giữa hai lần gửi vẫn có thể bị từ chối nếu cast đầu bị kẹt trong hộp thư lâu hơn cast sau. Test: cast A đến, server đứng X ms, client chờ `cooldown + 150 ms` kể từ lúc gửi A rồi gửi B: X = 100 và 200 ms qua, **X >= ~300 ms bị từ chối** (`CastReason.Cooldown`). Bù độ trễ của docs/08 §6 (`t_server >= readyAt - min(RTT/2, 100 ms)`) cũng **không bao giờ hoạt động**: World Node luôn đặt `rttMs: 0` và server không đo RTT từng client. Lượng tử hóa 50 ms một mình không đủ giải thích (biên 150 ms của bot lớn hơn), nên thủ phạm là các lần đứng tick (mục 5.2).

**Sửa.** Node ghi đồng hồ thực lúc cast đến (`recvAtMs`) và khi tick bắt đầu tính `CastInput.ageMs` = thời gian cast nằm trong hộp thư (kẹp ở `ANTICHEAT.CAST_MAX_AGE_MS` = 1000 ms). `step()` xét cast và đóng dấu hồi chiêu / GCD tại **mốc đến** (đồng hồ guard trừ `ageMs`), các cast cùng tick giữ thứ tự; bộ đếm gói cast vẫn theo đồng hồ tick. Không dùng độ trễ do client khai: `ageMs` do server tự đo nên không thể giả. Client cast sớm thật sự vẫn bị từ chối (test "still rejects a client that really recasts early"). `ageMs` vắng mặt = hành vi cũ, nên replay / hash xác định không đổi.

**Số đo.** Cùng 200 bot, máy tương đối rảnh: trước sửa 526 vi phạm `cooldown` trong 28,6 nghìn cast (lần A, mục 3); sau sửa **5** trong 14,1 nghìn cast (4 phút). Hai lần chạy ở điều kiện khác nhau nên chưa so sánh được trực tiếp; **bằng chứng cơ chế là test xác định**, không phải hai con số này. Còn vài vi phạm lẻ (chưa rõ: có thể do đứng tick lâu hơn trần 1000 ms hoặc đường khác); cần đo lại trên máy yên tĩnh. Dưới tình trạng máy bị bỏ đói nặng (tick đứng hàng trăm ms đến hàng giây) còn thấy hàng nghìn vi phạm `queue` / `budget` của **di chuyển** (cũ và mới đều có): đó là chống gian lận di chuyển dưới quá tải cực đoan, chưa điều tra ở đây.

### 5.2 Đuôi tick: các nguồn đã đo, một nguồn đã sửa

Công cụ mới trong `report.txt` (khối `tick profile`): thời gian trung bình / p50 / p99 / max từng pha của tick (`pre` hộp thư + combat pre, `sim`, `post` combat, `mobs`, `events`, `aoi`, `snap`), số tick quá 50 ms và pha lớn nhất của từng tick đó, **histogram thời gian tick**, khoảng cách giữa hai lần bắt đầu tick (độ trôi `setTimeout` + độ dài tick), độ trễ event loop (`monitorEventLoopDelay`), các lần GC (`PerformanceObserver`, tách theo loại, không tính lần `gc()` ép của bộ lấy mẫu) và chi phí ghi tệp của kho D92. `soak` cũng chạy được ở chế độ cũ bằng `--sync-writes` để so sánh.

**Lần đo 200 bot, 4 phút, kho tệp, máy rảnh (trước khi sửa ghi tệp):**

| Pha                                              | Trung bình (ms/tick) | p99 (ms) | max (ms)        | Pha lớn nhất của … trong 8 tick > 50 ms |
| ------------------------------------------------ | -------------------- | -------- | --------------- | --------------------------------------- |
| `snap` (mã hóa + gửi snapshot, gồm flush túi đồ) | 7,91                 | 14,7     | 36,7            | 1                                       |
| `mobs` (AI + đòn đánh quái)                      | 2,69                 | 12,1     | 28,6            | 3                                       |
| `aoi` (chạy ở tick chẵn)                         | 2,40                 | 10,5     | 18,9            | 0                                       |
| `events` (sự kiện, tiến trình, chat, tổ đội)     | 0,58                 | 6,2      | 64,6            | 4                                       |
| `sim` / `post` / `pre`                           | 0,50 / 0,30 / 0,16   | ~1       | 3,0 / 6,6 / 2,0 | 0                                       |

Tick: p50 13,5 · p99 33,75 · max 80,4 ms, 8 tick (0,17 %) quá 50 ms: **đạt ngưỡng 40 ms trong lần đo này**. Nhưng ngay trong lần đo đó, khoảng cách bắt đầu tick có max 395 ms, độ trễ event loop max 407 ms và **357 lần ghi tệp đồng bộ tổng cộng 10,8 giây (max 371 ms)** trong 240 giây: loop bị khóa 4,5 % thời gian. Điểm mấu chốt: **"tick p99" chỉ đo thân tick, không thấy các lần đứng nằm ngoài tick** (hàm hẹn giờ của kho ghi tệp chạy giữa hai tick); chúng hiện ra ở khoảng cách bắt đầu tick và độ trễ event loop, và là phần mà bot thật cảm nhận (độ trễ gói, tick bị dời).

Nguồn đã xác định rõ là của ta: **`DocFile` ghi cả tài liệu JSON (accounts / progression / inventories / ledger) đồng bộ trên event loop** (mở, ghi, `fsync`, đổi tên), tối đa mỗi 250 ms mỗi tệp khi có thay đổi liên tục; trung bình 30 ms một lần, tới 370 ms trên máy này.

**Sửa (không đổi định dạng tệp, cùng giao thức tmp + fsync + `.bak` + rename của D92):** ghi **nền**. Tài liệu được tuần tự hóa trên loop (bản sao tại một thời điểm), phần chậm (ghi + `fsync`) chạy trên thread pool của libuv, chỉ hai lần đổi tên (commit) quay lại loop, cùng một đoạn đồng bộ với kiểm tra "bản ghi này còn mới nhất không". Một lần ghi mỗi tệp tại một thời điểm (thay đổi trong lúc đó được ghi ngay sau); `flush()` (tắt máy, test) vẫn đồng bộ và **thay thế** mọi lần ghi nền còn dở, nên bản cũ không bao giờ ghi đè bản mới (test `doc-file-async.test.ts`: không sót tệp tạm, đúng thứ tự, lỗi được đếm và thử lại).

| Cùng 200 bot, 150 s, kho tệp (A/B xen kẽ, máy bị tranh chấp nặng) | Loop bị khóa bởi ghi tệp                 | Số lần ghi |
| ----------------------------------------------------------------- | ---------------------------------------- | ---------- |
| `--sync-writes` (cũ), lần 1                                       | **6,4 s** (max 346 ms)                   | 239        |
| ghi nền (mới), lần 1                                              | 0,21 s (max 68 ms) + tuần tự hóa 0,02 s  | 31         |
| `--sync-writes` (cũ), lần 2                                       | **11,7 s** (max 753 ms)                  | 131        |
| ghi nền (mới), lần 2                                              | 0,89 s (max 301 ms) + tuần tự hóa 0,17 s | 125        |
| ghi nền (mới), 4 phút, máy ít nhiễu hơn                           | 0,57 s (max 134 ms) + tuần tự hóa 0,21 s | 361        |

Thời gian loop bị khóa giảm **~13-30 lần**. Phần còn lại là lần đổi tên (có lúc 100-300 ms: chống virus / đánh chỉ mục của Windows, ngoài tầm của ta) và tuần tự hóa cả tài liệu (thường <= 6 ms, 149 ms một lần khi máy nghẽn).

**Giới hạn của phép đo, nói thẳng.** Trong lúc A/B chạy, máy dev bị tranh chấp CPU nặng từ bên ngoài (tải CPU hệ thống 100 %, hơn 50 tiến trình node / claude, một tiến trình game 3 GB): tick p50 và p99 của các lần đó nhảy (p99 ~850 ms, có cả lần GC scavenge 300 ms với heap 20 MB, tức tiến trình bị hệ điều hành bỏ đói), nên **không thể so p99 của cũ với mới** trong các lần đó; chỉ con số thời gian-bị-khóa-bởi-ghi-tệp (đo trực tiếp bằng đồng hồ trong mã) là so được. Đây cũng là lý do các lần đo 98-102 ms ở mục 3 không lặp lại ở lần đo máy rảnh (33,75 ms). **Chưa có số p99 "sau sửa" trên máy yên tĩnh**: việc đó vẫn cần một máy riêng.

**Đối chiếu với nhật ký TxJournal (D102), ảnh chụp sống (D99) và commit của chợ (D112):** ghi nền phải giữ luật "hoàn tất nhật ký dở trước mọi lần ghi sau". Hai khe hở đã vá khi gộp: (1) lần ghi của chính nhật ký (`markWritten`) không làm lần ghi nền đang chạy trên thread pool bị bỏ, nên một bản cũ hơn có thể đè lên nội dung mới của nhật ký; nay `markWritten` tăng thế hệ và bản cũ bị bỏ; (2) `flushAsync` không gọi `beforeWrite` (hoàn tất nhật ký dở); nay gọi ở đầu lần ghi và lại ngay trước bước commit (cùng đoạn đồng bộ với kiểm tra "còn mới nhất"), thế hệ được lấy SAU khi hoàn tất nhật ký. Ảnh chụp sống (`serializeNow`) đọc trạng thái trong bộ nhớ trong một lượt đồng bộ nên không phụ thuộc lần ghi nền nào. Test: `journal-background.test.ts` (4), cùng bộ crash-injection của journal / market / backup restore drill giữ nguyên xanh.

Các nguồn khác đã đo, **chưa sửa** (không phải lỗi rõ ràng của ta):

- **GC**: ~900-950 lần scavenge, tổng 1,2-2,0 s trong 4 phút (max scavenge 2,7 ms khi máy rảnh), 50 lần major (max 10-24 ms). Heap chỉ ~20 MB; phần lớn là cấp phát mỗi tick (`world.entities.map` dựng lại cả mảng, `Map` theo id, snapshot). Giảm cấp phát là cải thiện thật nhưng là việc lớn hơn (đụng `step()` bất biến), chưa làm.
- **`snap`** (mã hóa + gửi): 55-60 % thời gian tick trung bình, tuyến tính theo người nhận x thực thể thấy (200 x ~113). Là chi phí cố hữu của thiết kế; muốn giảm phải đổi mức chi tiết / tần số (quyết định thiết kế, không phải sửa mã).
- **`mobs`**: 2,7 ms trung bình nhưng p99 12 ms (nhiều quái đuổi người cùng lúc); chưa phân tích sâu.
- **Tuần tự hóa cả tài liệu**: tăng theo số tài khoản và độ dài sổ cái (ghi tăng dần / nhật ký thêm vào cuối là hướng đúng; việc của kho PostgreSQL ở D92).

## 6. Runbook: soak 24 giờ (D121)

**Không chạy trong CI, không chạy trên máy dev đang làm việc khác.** Soak chạy server và bot **chung một tiến trình / một máy**: số tick là cận trên của một server riêng, và mọi tải khác trên máy làm nhiễu độ trễ vòng lặp. Cổng beta ([docs/10 §12](10-mvp-scope.md)) là "100 CCU 24 giờ không sự cố"; bản `full` dùng 200 bot để có dư địa.

### 6.1 Thêm trong lần chạy soak (so với mục 1)

Mỗi mẫu (CSV / JSONL) có thêm: **độ trễ vòng lặp** của cửa sổ (`loop_p50_ms`, `loop_p99_ms`, `loop_max_ms`; `monitorEventLoopDelay` độ phân giải 10 ms nên sàn khoảng 10 ms là bình thường), **kích thước tệp của kho D92** (`store_mb`, mỗi tài liệu trong JSONL, `journal_kb`, `journal_present`) và **thời gian backup** (`backup_ms`, `backup_ok`). Backup chạy **trong một tiến trình riêng** (`soak-backup.ts`, cùng việc với lệnh `backup` của vận hành, D99: đọc tài liệu sống, ghi, xoay vòng giữ 3 bản): không chặn vòng lặp đang đo. Bản **cuối** của lần chạy được lấy sau khi flush hết và **được xác thực** (`verifyBackup`).

Backup nằm ở `--out/backups`; nếu không có `--out` (chỉ khi chạy dưới 1 giờ, không preset) thì ở một thư mục tạm riêng và **bị xóa khi lần chạy kết thúc**, kể cả khi dùng `--data-dir`; không bao giờ ghi vào thư mục hiện hành. Muốn giữ backup thì đặt `--out`.

Preset (mọi giá trị đều ghi đè được bằng cờ riêng):

| Preset  | Bot | Thời gian | Mẫu mỗi | Backup mỗi | Dùng để                                    |
| ------- | --- | --------- | ------- | ---------- | ------------------------------------------ |
| `smoke` | 100 | 25 phút   | 15 giây | 5 phút     | kiểm nhanh trước khi chạy dài; chạy cục bộ |
| `full`  | 200 | 24 giờ    | 60 giây | 30 phút    | cổng beta, máy riêng                       |

### 6.2 Kiểm nhanh cục bộ (khoảng 25 phút)

```bash
npm ci
npm run soak -w @vgtd/server -- --preset smoke
# kết quả: thư mục tạm in ở đầu lần chạy (hoặc --out DIR): samples.csv, samples.jsonl, summary.json, report.txt, backups/
```

Mã thoát 0 = mọi tiêu chí đạt (độ dốc heap / RSS ở bản 25 phút là **tham khảo có xét**: đủ 10 phút nên đã được chấm, nhưng 25 phút vẫn ngắn). Mã 1 = trượt tiêu chí, xem `report.txt`; mã 2 = công cụ hỏng.

### 6.3 Chạy đủ 24 giờ trên máy riêng

1. **Máy**: một máy không chạy gì khác (không IDE, không phiên agent), điện ổn định, tắt ngủ / tự cập nhật / quét virus thời gian thực trên thư mục kết quả; đĩa trống ít nhất 2 GB (kết quả + 3 backup + kho tệp); Node ≥ 18 (khuyến nghị bản chạy ở CI, 22).
2. **Mã**: `git switch main && git pull`, ghi lại commit (`git rev-parse HEAD`), `npm ci`, `npm run build`.
3. **Thử khói trước**: `--preset smoke` phải xong với mã 0 trên chính máy này; nếu không, đừng bắt đầu chạy dài.
4. **Chạy** (một phiên không bị ngắt, dùng `tmux` / `screen` / dịch vụ, không phụ thuộc phiên SSH):
   ```bash
   npm run soak -w @vgtd/server -- --preset full --out /duong/dan/soak-24h 2>&1 | tee /duong/dan/soak-24h.log
   ```
   Có thể dùng `--data-dir DIR` để đặt kho tệp ở đĩa muốn đo (mặc định: thư mục tạm, xóa khi xong).
5. **Theo dõi** (không cần canh): `tail -f soak-24h.log` in một dòng mỗi 60 giây (tick, heap, RSS, bot online). `samples.jsonl` được ghi nối đuôi sau mỗi mẫu, nên nếu tiến trình chết vẫn còn dữ liệu đến lúc đó; `Ctrl+C` (SIGINT) dừng sớm **và vẫn ghi báo cáo** cho phần đã đo.
6. **Xong**: đọc `report.txt` (mục 4); lưu `summary.json`, `samples.csv`, log và commit vào chỗ chung (ngoài kho mã, như số đo đầu tiên ở mục 3). Một lần chạy đạt khi mã thoát 0: không bot nào bị rớt / đá, tick p99 ≤ 40 ms, độ dốc heap / RSS trong ngưỡng, nhật ký ghi trước nén gọn, mọi backup thành công và bản cuối xác thực được.

### 6.4 Khi một tiêu chí trượt

| Triệu chứng                   | Nhìn vào                                                                   | Việc thường gặp                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Độ dốc heap / RSS vượt ngưỡng | `heap_mb`, `rss_mb` trong `samples.csv` (vẽ theo `t_s`); heap đã đo sau GC | rò rỉ thật (phiên / bản đồ không được xóa) hay chỉ là kho tệp lớn lên (so với `store_mb`); chạy lại ngắn với `--store memory` để tách |
| Tick p99 vượt 40 ms           | `tick_p99`, `loop_p99_ms`, mục "tick profile" trong `report.txt`           | pha nào lớn nhất; GC; ghi tệp trên vòng lặp (`file-store writes`); máy có tải khác                                                    |
| Nhật ký không nén gọn         | `journal_present`, `journal_kb`; `journalPending` cuối lần chạy            | commit nhiều tài liệu bị lỗi đĩa, hoặc ghi trễ không bao giờ hoàn tất: xem log lỗi của kho (D102)                                     |
| Backup chậm / hỏng            | `backup_ms`, `backup_ok`, thư mục `backups/`                               | đĩa chậm hoặc bị quét virus; tài liệu quá lớn (xem tăng trưởng từng tài liệu trong mục tiêu chí)                                      |
| Bot bị rớt hàng loạt          | `kicks`, `disconnects`, `report.txt` mục vi phạm                           | ngân sách tin nhắn (D101) hoặc backpressure                                                                                           |

Số đo của lần chạy 24 giờ đầu tiên **chưa có** (chưa chạy ở đây): bản 25 phút `smoke` chỉ là kiểm công cụ. Ngưỡng độ dốc và backup là đề xuất của công cụ; sau lần chạy thật cần xem lại.

## 7. D119: giảm chi phí mã hóa snapshot

Số đo đầu tiên (mục 5.2) cho thấy `snap` (mã hóa + gửi snapshot) là pha lớn nhất của tick: 7,9 ms trung bình ở 200 bot, 55-60 % thời gian tick. D119 cắt phần mã hóa, **không đổi định dạng dây, không đổi `PROTOCOL_VERSION`, không đổi số gameplay**.

### 7.1 Cái gì tốn

Hồ sơ CPU (`npm run bench:tick -w @vgtd/server -- --cpu-prof`, 200 người, 150 quái, đầu vào xác định): `sendSnapshots` tự nó chiếm 26 % tổng thời gian CPU, cộng `encodeSnapshot` 3,7 %, `write` 3,1 %, `finish` 2,7 %, `result` 2,0 %, kiểm tra lại cấu trúc `validateMessage` + `snapEntity` 2,9 %, GC 7,8 %. Trong `sendSnapshots`, số tick theo dòng cho thấy vòng quét `c.visible` mỗi client là chỗ nóng: tạo một cặp `[khóa, giá trị]` cho mỗi phần tử Map, phép `%` theo chu kỳ dải, rồi dựng một object `SnapshotEntity` cho mỗi bản ghi, để `encode` kiểm tra lại từng object và đẩy từng bản ghi qua một `BitWriter` rồi **sao chép** hai lần.

### 7.2 Đã làm

- `encodeSnapshotRecords` (`packages/protocol/src/binary.ts`): mã hóa snapshot từ các **mảng song song** (`SnapshotRecords`, một bộ đệm dùng lại cho mọi client của mọi tick) thay vì dựng `SnapshotMsg` + object cho từng thực thể; không chạy lại `validateMessage` trên cả thông điệp (mọi trường của bản ghi vẫn bị kiểm tra phạm vi: giới hạn dây bằng đúng độ rộng bit nên `BitWriter` tự từ chối; phần đầu thông điệp và `self` kiểm tra như cũ; mảng là `Float64Array` để một giá trị ngoài phạm vi hay số lẻ không bị cắt âm thầm); chuỗi bit được nối vào thông điệp qua `BitWriter.finishView()` (không sao chép).
- `WorldNode.sendSnapshots`: điền `SnapshotRecords` thay vì mảng object; cập nhật `Client.last` **tại chỗ** sau khi mã hóa (không cấp phát cặp object mới mỗi bản ghi); duyệt `c.visible.values()` (id nằm trong `Visible`) thay vì `entries()`, và phép `% chu kỳ` thành `& (chu kỳ - 1)` (chu kỳ dải là 1 / 2 / 4).
- Không làm (đã cân nhắc): **chia sẻ byte đã mã hóa giữa các client**: bản ghi của mỗi client dùng delta so với vị trí client đó nhận gần nhất (`Client.last`), nên hai client thấy cùng thực thể thường mã hóa khác nhau; chia sẻ chỉ có nghĩa nếu bỏ delta theo client hoặc nhóm client theo trạng thái đã nhận, tức là đổi giao thức / băng thông (cần quyết định riêng). Delta so với snapshot đã xác nhận cuối và bỏ trường không đổi **đã có từ D73** (`Client.last`, bỏ bản ghi không đổi, dải theo khoảng cách).

### 7.3 Số đo (cùng một máy, trước = `main`, sau = nhánh này)

**Tính đúng:** luồng byte **không đổi**: `npm run bench:tick -- --hash` in cùng checksum `57976c24` (29.449.495 byte, 260.146 khung) trước và sau; `snapshot-golden.test.ts` (byte vàng), test tương đương mới (`snapshot-records.test.ts`: byte-giống-hệt `encode()` trên 300 snapshot ngẫu nhiên có seed + biên delta, từ chối đúng những gì `encode` từ chối) và toàn bộ test xác định đều xanh.

**Đo trong tiến trình** (`bench:tick`, 200 người, 40x40 ô, 150 quái, 600 tick, đầu vào xác định, không socket; chạy xen kẽ cũ / mới, máy dev chung nên mỗi cặp là phép so cùng điều kiện gần nhau nhất):

| Cặp                                      | `snap` ms/tick (cũ → mới) | CPU ms/tick (cũ → mới) | tick trung bình ms (cũ → mới) |
| ---------------------------------------- | ------------------------- | ---------------------- | ----------------------------- |
| 1                                        | 3,38 → 2,17               | 7,00 → 5,96            | 5,70 → 4,37                   |
| 2                                        | 3,07 → 2,05               | 6,33 → 5,31            | 5,24 → 4,13                   |
| 3                                        | 3,36 → 2,31               | 7,63 → 5,94            | 5,78 → 4,69                   |
| 4 (sau khi thêm `values()` + mặt nạ bit) | 4,59 → 2,50               | 9,43 → 6,64            | 7,79 → 5,14                   |

Ba cặp chạy lúc máy rảnh cho `snap` **-32 đến -35 %**, CPU -14 đến -22 %; các cặp chạy lúc máy nghẽn (CPU hệ thống 100 %, nhiều tiến trình khác) vẫn cùng chiều nhưng nhiễu hơn (cặp 4: -46 %, hai cặp nghẽn khác lệch). Hồ sơ CPU sau cải thiện: tổng thời gian mẫu 10,6 s → 6,0 s cho cùng khối lượng việc (có phần nhờ máy rảnh hơn lúc đo).

**Đo bằng soak** (`npm run soak`, bot thật qua socket, kho bộ nhớ, 150 s đo sau 30 s khởi động; bộ cũ và mới build từ hai bản mã, chạy xen kẽ). **Nhiễu máy át tín hiệu 2 ms**: vòng 1 bị tranh chấp CPU nặng (p99 hàng trăm ms ở CẢ cũ lẫn mới, `snap` 6-18 ms ở cả hai), nên chỉ vòng 2 (máy rảnh) dùng được:

| Vòng 2 (máy rảnh) | tick p50 / p95 / p99 (ms) | `snap` ms/tick   | tick > 50 ms |
| ----------------- | ------------------------- | ---------------- | ------------ |
| 200 bot, cũ       | 14,00 / 30,75 / 61,50     | 9,16             | 46 (1,56 %)  |
| 200 bot, mới      | 12,25 / 22,75 / **32,50** | **6,39** (-30 %) | 4 (0,13 %)   |
| 100 bot, cũ       | 6,00 / 10,00 / 12,50      | 3,00             | 0            |
| 100 bot, mới      | 5,50 / 9,50 / 12,75       | **2,53** (-16 %) | 0            |

(Vòng 1, máy nghẽn: 100 bot cũ p99 76,75 / mới 106,50; 200 bot cũ 739 / mới 647: **không kết luận được**, chỉ cho thấy máy dev chung không phân giải nổi chênh lệch vài ms; ngoài ra thứ tự chạy xen kẽ không loại được hiệu ứng nhiệt / nền.) Kết luận thận trọng: **bằng chứng chính là phép đo trong tiến trình có checksum byte**; soak ở vòng sạch cùng chiều (200 bot: p99 61,5 → 32,5 ms, nhưng mẫu đơn, chưa lặp lại trên máy riêng).

### 7.4 Còn lại

`snap` vẫn chiếm ~55 % thời gian tick ở bench (2,1-2,5 ms trong 4-5 ms): phần dư gồm duyệt `visible` của từng client (tuyến tính theo người nhận x thực thể thấy), tạo `self`, `write` / `frameHeader` và bản sao cuối mỗi thông điệp. Giảm thêm cần đổi mức chi tiết (tần số, trần 120 thực thể: quyết định thiết kế, không phải sửa mã) hoặc tách mã hóa sang worker. `updateAoi` (~19 % CPU ở hồ sơ) và `mobs` chưa đụng tới.
