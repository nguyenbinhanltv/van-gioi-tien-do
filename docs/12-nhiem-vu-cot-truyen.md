# Nhiệm vụ & Cốt truyện – Vạn Giới Tiên Đồ

> **[Cập nhật D107, 2026-11-09]** Chủ sở hữu đã duyệt tài liệu này; phần hiện thực nằm ở `packages/shared/src/quests.ts` (dữ liệu, reset 05:00 UTC+7, đơn vị thưởng) và `apps/server/src/quests/`. Khác đề xuất: dữ liệu là mô-đun TypeScript chứ không phải `quests.json` + Ajv, mục tiêu rút gọn còn `kill` / `collect` / `talk` / `reach` / `breakthrough` / `cultivate`, tiến độ lưu theo tài khoản trong kho D92 (`quests.json`) chứ chưa phải bảng `quest_progress`. Còn thiếu so với tài liệu: xem OPEN-ITEMS "D107 - nhiệm vụ: còn mở".
>
> **Trạng thái: bản thiết kế đề xuất – chờ duyệt.** Mảng này nằm trong [OPEN-ITEMS.md](OPEN-ITEMS.md) §3 ("Nhiệm vụ và cốt truyện") và hồ sơ gốc không có chi tiết. Mọi con số mới mang nhãn _Đề xuất – chờ duyệt_. Số liệu đã có hiệu lực chỉ được **trích dẫn** từ [07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md) / `@vgtd/shared`, không định nghĩa lại ở đây.
>
> Phạm vi MVP thật sự do [10-mvp-scope.md](10-mvp-scope.md) quyết định (đang được viết lại bởi nhóm thiết kế A); tài liệu này giả định MVP gồm **Luyện Khí → Trúc Cơ** và một đoạn mở đầu Kim Đan, hai bản đồ mẫu trong [04-tilemap.md](04-tilemap.md) (Sơn Môn Đại Phái, Bí Cảnh Rừng Độc). Hệ phái và kỹ năng xem [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md); tổng quan xem [01-gdd.md](01-gdd.md).

## 1. Nguyên tắc thiết kế

1. **Nhiệm vụ không thay thế vòng lặp cốt lõi.** Core loop vẫn là Luyện khí → Săn quái → Tài nguyên → Đột phá ([01-gdd.md](01-gdd.md) §2). Nhiệm vụ hướng dẫn, kể chuyện và thưởng thêm, nhưng không phải nguồn tiến độ chính.
2. **Phần thưởng tính theo đơn vị quy chuẩn, không theo số cứng**, để tự lớn lên cùng cảnh giới như nguồn tiền ở 07 §6 (xem §4).
3. **Server là nguồn sự thật duy nhất.** Client không bao giờ báo "đã xong"; tiến độ nhiệm vụ sinh ra từ sự kiện của World Node / Economy (theo [08-server-architecture.md](08-server-architecture.md) §7).
4. **Chọn Chính / Tà / Ma là lựa chọn bản sắc, không phải lựa chọn sức mạnh.** Các nhánh của cùng một nhiệm vụ chính có phần thưởng kinh tế tương đương; chỉ khác Nghiệp Lực và lời thoại (khớp 07 §2: nghiệp thiện không cộng tỷ lệ đột phá).
5. **Mỗi loại nhiệm vụ có trần faucet riêng** để kênh tiêu hao / sinh ra giữ trong 0,9–1,0 mỗi tuần (07 §6–7).

## 2. Các loại nhiệm vụ

| Loại (`type`)            | Tên tiếng Việt       | Làm lại được?                                                  | Nguồn nội dung                               | Ghi chú                                                          |
| ------------------------ | -------------------- | -------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `main`                   | Chủ tuyến (Đạo Lộ)   | Không                                                          | Cốt truyện theo cảnh giới (§3)               | Chặn theo cảnh giới; mở cơ chế mới ở mỗi ngưỡng lớn              |
| `side`                   | Chi tuyến (Kỳ Duyên) | Không                                                          | NPC trong vùng, chuỗi 2–5 nhiệm vụ           | Câu chuyện nhỏ, thưởng nguyên liệu nghề và vật phẩm thẩm mỹ      |
| `daily`                  | Nhật thường          | Có, reset mỗi ngày                                             | Mẫu nhiệm vụ sinh theo vùng (săn, hái, giao) | Ít, tối đa 5 mỗi ngày; không phạt khi bỏ                         |
| `weekly`                 | Chu thường           | Có, reset mỗi tuần (cùng nhịp khóa boss tuần)                  | Boss bí cảnh, luyện nghề, đấu trường         | Gắn với khóa tuần 1 lần của 07 §6                                |
| `sect`                   | Tông môn             | Có (nhật / chu)                                                | Tông môn giao                                | Thưởng **Cống hiến**; tăng cống hiến = chức vị, kho tông môn     |
| `secret_realm` (Bí cảnh) | Bí cảnh thí luyện    | Theo mùa                                                       | Bí Cảnh Rừng Độc và các bí cảnh sau          | Có chuỗi mục tiêu trong instance; đi cùng rương boss tuần        |
| `karma` (Nhân quả tuyến) | Nhân quả             | Không                                                          | Kích hoạt khi Nghiệp Lực vượt ngưỡng         | Nhiệm vụ "trả nghiệp" hoặc "kết thiện duyên"; xem §3.4           |
| `event`                  | Sự kiện              | Theo lịch ([15-kiem-tien-liveops.md](15-kiem-tien-liveops.md)) | LiveOps                                      | Có ngày bắt đầu / kết thúc, không trộn vào tiến độ chủ tuyến     |
| `tutorial`               | Dẫn nhập             | Không                                                          | [16-onboarding.md](16-onboarding.md)         | Chuỗi bắt buộc 30 phút đầu, hỗ trợ chính trong khung PC / Mobile |

### 2.1 Nhịp reset (Đề xuất – chờ duyệt)

- **Reset ngày:** 05:00 giờ Việt Nam (UTC+7, múi `Asia/Ho_Chi_Minh`). **Reset tuần:** 05:00 sáng thứ Hai. Giờ do **server** quyết định; client chỉ hiển thị đếm ngược.
- Lý do 05:00: người chơi muộn không bị cắt giữa tối; trùng khung thấp tải để chạy tác vụ dọn dẹp.

### 2.2 Giới hạn số lượng (Đề xuất – chờ duyệt)

| Loại     | Số nhận tối đa cùng lúc | Số hoàn thành tối đa mỗi chu kỳ |
| -------- | ----------------------- | ------------------------------- |
| `daily`  | 5                       | 5 mỗi ngày                      |
| `weekly` | 6                       | 6 mỗi tuần                      |
| `sect`   | 3 nhật + 3 chu          | 3 mỗi ngày + 3 mỗi tuần         |
| `side`   | 10 (khung "Nhật ký")    | Không giới hạn                  |
| `main`   | 1                       | —                               |

Sổ nhiệm vụ trên UI: Mobile dùng tab "Nhiệm vụ" trong túi đồ toàn màn hình; PC dùng khung Thủy mặc ([05-ui-ux-icon.md](05-ui-ux-icon.md) §2, §4).

## 3. Cốt truyện MVP

### 3.1 Bối cảnh (Đề xuất – chờ duyệt)

> [Cập nhật D123: tọa độ NPC nhiệm vụ (`QUEST_NPCS`) trùng ô client vẽ tượng NPC; tracker nhiệm vụ có mũi tên dẫn đường, nhấp để tự đi, hội thoại NPC và dấu `!` / `?` trên đầu NPC.]

Vạn Giới là chuỗi các thế giới nối nhau qua Linh Mạch; mỗi Linh Mạch là một con đường về phía Tiên Giới. Người tu hành là kẻ **đi trên tiên đồ** — vì vậy tên game. Nhân vật chính là một phàm nhân vừa thức tỉnh Linh Căn tại chân núi của **Sơn Môn Đại Phái** (tạm gọi Thiên Kiếm Tông, theo tên asset `tset_sect_tianjian` ở [02-asset-matrix-2d.md](02-asset-matrix-2d.md)). Xung đột chính: Linh Mạch của sơn môn đang bị **độc khí** ăn mòn từ **Bí Cảnh Rừng Độc**; ai kiểm soát nguồn độc sẽ nắm Linh Mạch — kéo theo ba đường Chính, Tà, Ma.

### 3.2 Dàn ý theo cảnh giới

| Chương | Cảnh giới (07 §1)           | Tên chương            | Bản đồ                                | Cơ chế mở / dạy                                      | Mốc cốt truyện                                                    |
| ------ | --------------------------- | --------------------- | ------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| 1      | Luyện Khí (1–9 tầng)        | **Phàm Căn**          | Sơn Môn Đại Phái (Chân núi → Hậu sơn) | Thử Linh Căn, vận khí, đột phá tiểu cảnh, khinh công | Nhập môn, phát hiện độc khí; chuẩn bị Trúc Cơ Đan                 |
| 2      | Trúc Cơ                     | **Trúc Cơ Thí Luyện** | Bí Cảnh Rừng Độc (PK)                 | Nghề (luyện đan / luyện khí / chế phù) và PvP khu PK | Vào bí cảnh tìm "Độc Nguyên"; chọn đứng về một phe (§3.4)         |
| 3      | Trúc Cơ → Kim Đan (đoạn mở) | **Tâm Ma**            | Instance Tâm Ma + Hậu sơn             | Tâm Ma nhẹ (07 §2 bảng ngưỡng Trúc Cơ → Kim Đan)     | Đối mặt Tâm Ma; mở cổng sang Kim Đan; kết chương MVP (hook mùa 2) |

Phạm vi mở rộng (Nguyên Anh trở đi, Lôi Kiếp 3 đạo, Linh Mạch chiến tranh) nằm ngoài MVP; nhưng chương 2–3 phải gieo mầm cho chiến tranh Linh Mạch ([14-pvp-chien-tranh.md](14-pvp-chien-tranh.md)).

### 3.3 Cấu trúc một chương

Mỗi chương có 3 phần: **Mở** (3–5 nhiệm vụ dẫn nhập, tương tác NPC), **Thân** (vòng lặp săn / hái / luyện, 4–6 nhiệm vụ), **Kết** (nhiệm vụ trước ngưỡng đột phá: chuẩn bị nguyên liệu đan, hạ tinh anh, hạ boss, đột phá). Thời lượng đề xuất: chương 1 ≈ 90–120 phút chơi liên tục (đủ để chạm Luyện Khí tầng 9 cùng tu luyện tự nhiên, xem §4.2).

### 3.4 Lựa chọn Chính – Tà – Ma

Ba điểm rẽ nhánh trong chương 2 (dưới đây là các lựa chọn tiêu biểu). **Phần thưởng kinh tế giống nhau; chỉ ΔK và lời thoại / nhánh phụ khác nhau.**

| Điểm rẽ                                | Chính                      | Tà                                      | Ma                        |
| -------------------------------------- | -------------------------- | --------------------------------------- | ------------------------- |
| Độc Nguyên nên thanh tẩy hay lợi dụng? | Thanh tẩy (ΔK +40)         | Giữ làm nguồn tài nguyên riêng (ΔK −30) | Hấp thu vào thân (ΔK −90) |
| Đệ tử phản bội bị bắt                  | Giao cho tông môn (ΔK +30) | Bắt làm thuộc hạ (ΔK −30)               | Thôn phệ tu vi (ΔK −120)  |
| Rương bí cảnh có người bị nạn          | Cứu rồi mới lấy (ΔK +40)   | Bỏ qua (ΔK 0)                           | Cướp (ΔK −60)             |

ΔK là **Đề xuất – chờ duyệt**; thang K ∈ [−1000, +1000] và ngưỡng Ma đạo K ≤ −700 lấy từ 07 §2 và §7. Tổng ΔK cộng dồn từ chủ tuyến chương 2 không được vượt ±250 (để người chơi không bị đẩy vào Ma đạo chỉ bằng cốt truyện; phạt đột phá do nghiệp tối đa 0,20 × 250 / 1000 = 5 điểm phần trăm, theo công thức 07 §2).

Nhân quả tuyến (`karma`): khi K ≤ −300 hoặc K ≥ +300 lần đầu (ngưỡng _Đề xuất_, cùng ngưỡng phe ở [14-pvp-chien-tranh.md](14-pvp-chien-tranh.md) §3), mở chuỗi 2–3 nhiệm vụ "trả nghiệp" (hoàn tất sẽ đưa K tiến về 0 một lượng giới hạn, ví dụ +100 mỗi chuỗi, tối đa 1 chuỗi mỗi tuần) hoặc "thiện duyên" (thưởng thẩm mỹ, không thưởng sức mạnh).

## 4. Nhiệm vụ trong kinh tế & tiến độ

### 4.1 Đơn vị phần thưởng quy chuẩn

Phần thưởng nhiệm vụ ghi bằng **đơn vị**, server quy ra số cụ thể theo cảnh giới r và nấc s của người chơi bằng các công thức đã có ở 07:

| Đơn vị             | Ý nghĩa                                                                                   | Quy ra (cảnh giới r, nấc s)                                          | Nguồn công thức                                                |
| ------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `cult_minutes`     | **Phút tu luyện quy chuẩn**: lượng tu vi hấp thu trong 1 phút ở ρ = 1, Match = 1, P_n = 1 | tu vi = n × A_s, với A_s = 100 · 1,25^(s − 1)                        | 07 §5                                                          |
| `stone_wild_hours` | **Giờ farm dã ngoại quy chuẩn** của cảnh giới r                                           | n × 180 × 1,5^(r − 1) Linh thạch hạ phẩm (180 = kỳ vọng/giờ ở r = 1) | 07 §6 bảng "Kỳ vọng Linh thạch" và hệ số cảnh giới 1,5^(r − 1) |
| `contribution`     | Điểm Cống hiến tông môn                                                                   | Số nguyên cố định trong dữ liệu (không theo công thức)               | _Đề xuất_                                                      |
| `item`             | Vật phẩm cụ thể (nguyên liệu nghề, đan hồi phục, thẩm mỹ)                                 | id + số lượng; phẩm theo bảng riêng                                  | 07 §6                                                          |

Không có đơn vị trực tiếp cho **đan đột phá**, **bản vẽ phẩm Lam trở lên**, **Linh thạch thượng phẩm**, **Tiên Ngọc** trong nhiệm vụ thường: các vật phẩm này được kiểm soát bởi bảng rơi (07 §6) và quy tắc "không bán" ([15-kiem-tien-liveops.md](15-kiem-tien-liveops.md) §3). Ngoại lệ duy nhất là một Trúc Cơ Đan **phẩm Trắng** thưởng ở cuối chương 1 để người chơi mới có đường đột phá (xem [16-onboarding.md](16-onboarding.md)); cần duyệt ở mục "Câu hỏi cần chốt".

### 4.2 Ngân sách theo loại (Đề xuất – chờ duyệt)

Tiến độ tu luyện thuần ở hệ số 1 mất khoảng 125 phút để đi hết 9 tầng Luyện Khí (Σ 10 · 1,08^(s − 1) phút, s = 1…9, suy từ 07 §5) và khoảng 47 giờ cho 41 nấc. Nhiệm vụ chỉ nên là **một phần ba thấp** của tổng:

| Loại     | Tu vi tối đa mỗi chu kỳ (`cult_minutes`)        | Linh thạch tối đa mỗi chu kỳ (`stone_wild_hours`) | Ghi chú                                                                                        |
| -------- | ----------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `main`   | 25% tổng Req của cảnh giới (cộng dồn cả chương) | 1,0 mỗi chương                                    | Trần tổng cho cả chương, chỉ nhận một lần                                                      |
| `side`   | 5 mỗi nhiệm vụ                                  | 0,05 mỗi nhiệm vụ                                 | Nhiều chuỗi, nhưng chỉ làm một lần                                                             |
| `daily`  | 20 mỗi ngày                                     | 0,25 mỗi ngày                                     | 5 nhiệm vụ nhỏ; ≈ 90 Linh thạch hạ phẩm ở r = 1 nếu cả 5 xong (so với 180 farm dã ngoại / giờ) |
| `weekly` | 60 mỗi tuần                                     | 1,0 mỗi tuần                                      | Không tính rương boss tuần (rương đã có bảng riêng ở 07 §6)                                    |
| `sect`   | 10 mỗi ngày                                     | 0,10 mỗi ngày                                     | Chủ yếu thưởng Cống hiến                                                                       |

**Kiểm tra bắt buộc trước khi duyệt dữ liệu:** tổng faucet mỗi tuần từ nhiệm vụ của một người chơi tích cực (7 daily set + 1 weekly set + sect) ≤ **15%** tổng Linh thạch sinh ra từ săn quái của cùng người chơi trong cùng tuần (giả định 10 giờ/tuần, theo bảng 07 §6). Mô phỏng này là một phần của việc OPEN-ITEMS #7 "Mô phỏng kinh tế".

### 4.3 Chống lạm dụng

- Nhiệm vụ nhật / chu **không nhận phần thưởng sau khi quá hạn reset**; trạng thái dở dang bị hủy và ghi log.
- Phần thưởng `item` đi qua Economy Service với khóa idempotency `(char_id, quest_id, reset_epoch)`; bấm nhận hai lần không phát hai lần (khớp mô hình giao dịch ở 08 §7).
- Mục tiêu "hạ quái": chỉ tính khi có **đóng góp sát thương hợp lệ** (≥ ngưỡng % máu mục tiêu, _Đề xuất_ 10%) và áp hệ số "đánh quái thấp" như bảng rơi (07 §6: quái thấp hơn 1 cảnh giới thì tỷ lệ × 0,2; 2 cảnh giới trở lên chỉ còn nguyên liệu); với nhiệm vụ, quái thấp hơn ≥ 2 cảnh giới không tính tiến độ.
- Tổ đội: tiến độ nhiệm vụ cộng cho mỗi thành viên đủ điều kiện (đóng góp ≥ ngưỡng hoặc trong cùng cụm 30 ô quanh người hạ quái, _Đề xuất_), không nhân đôi tài nguyên nhờ tổ đội.
- Bot dọn nhiệm vụ: nhiệm vụ lặp ghi telemetry `quest.complete` kèm thời gian hoàn thành; cờ nghi vấn khi 3 ngày liền xong cả bộ trong dưới 10 phút từ cùng một chuỗi hành vi ([17-telemetry-kpi.md](17-telemetry-kpi.md) §6).

## 5. Mô hình dữ liệu nhiệm vụ

### 5.1 Vòng đời

```text
locked ─(đủ điều kiện)→ available ─(nhận)→ active ─(mọi mục tiêu xong)→ ready ─(trả)→ completed
                                              │                                     │
                                              ├─(bỏ / hết hạn)→ abandoned           └─(reset)→ available  (chỉ daily / weekly / sect / event)
                                              └─(thất bại)→ failed  (chỉ nhiệm vụ có nhánh thất bại)
```

- `locked`: chưa đủ điều kiện (cảnh giới, nhiệm vụ tiền đề, Nghiệp Lực, tông môn).
- Chuyển trạng thái chỉ xảy ra trong World Node (tiến độ) hoặc Economy (trao thưởng); Gateway chỉ chuyển yêu cầu "nhận / trả / bỏ".
- Tiến độ của mỗi người chơi lưu dạng JSON gọn trong PostgreSQL (bảng `quest_progress`, một dòng cho mỗi cặp nhân vật – nhiệm vụ), snapshot lên Redis theo chu kỳ như dữ liệu vị trí (08 §7).

### 5.2 Trường dữ liệu chính

| Trường                 | Kiểu          | Ý nghĩa                                                                                                      |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`                   | string        | `q_<chuong>_<ten>` hoặc `q_daily_<mau>`; ổn định giữa các phiên bản                                          |
| `type`                 | enum          | Một trong các giá trị ở §2                                                                                   |
| `name_key`, `desc_key` | string        | **Khóa chuỗi i18n**, không nhúng văn bản ([19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md) §2)               |
| `chapter`              | integer       | Chương cốt truyện (chỉ `main`, `side`)                                                                       |
| `giver`, `turn_in`     | object        | NPC giao / nhận: `npc_id`, `map_id`                                                                          |
| `prerequisites`        | object        | `min_realm`, `max_realm`, `min_stage`, `quests_done[]`, `karma_range[2]`, `sect_required`, `item_required[]` |
| `objectives[]`         | array         | Danh sách mục tiêu (§5.3); `mode` = `all` hoặc `any`                                                         |
| `rewards`              | object        | `cult_minutes`, `stone_wild_hours`, `contribution`, `items[]`, `karma_delta` (đơn vị §4.1)                   |
| `repeat`               | object        | `kind` (`none`/`daily`/`weekly`/`event`), `max_per_cycle`                                                    |
| `time_limit_s`         | integer\|null | Giới hạn thời gian (bí cảnh có thể có)                                                                       |
| `branches[]`           | array         | Nhánh chọn (Chính / Tà / Ma): lựa chọn → mục tiêu / ΔK / quest tiếp theo                                     |
| `zone_rule`            | enum          | `any`, `safe`, `pk`, `secret_realm`, `event` (khớp lớp **Zone** ở [04-tilemap.md](04-tilemap.md) §4)         |
| `telemetry_tag`        | string        | Nhãn gom thống kê ([17-telemetry-kpi.md](17-telemetry-kpi.md))                                               |

### 5.3 Loại mục tiêu

| `kind`               | Tham số                                   | Do ai phát sự kiện                                                             |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `kill`               | `monster_id` hoặc `tier`, `count`         | World Node (có kiểm tra đóng góp)                                              |
| `collect`            | `item_id`, `count`                        | Economy (đếm vật phẩm trong túi, vật phẩm "nhiệm vụ" bị khóa, không giao dịch) |
| `deliver`            | `item_id`, `npc_id`                       | Economy                                                                        |
| `talk`               | `npc_id`, `dialogue_node`                 | World Node                                                                     |
| `reach`              | `map_id`, `tile` (i, j), `radius`         | World Node (so vị trí server)                                                  |
| `cultivate_minutes`  | `minutes` (tu luyện thật, không treo máy) | World Node (đếm khi ở trạng thái vận khí)                                      |
| `breakthrough`       | `to` (`truc_co`, …), `minor` (bool)       | Economy / World Node (kết quả roll ở 07 §2)                                    |
| `craft`              | `recipe_id` hoặc `profession`, `count`    | Economy ([13-che-tao.md](13-che-tao.md))                                       |
| `clear_instance`     | `instance_id`, `min_party`                | World Node                                                                     |
| `use_item`           | `item_id`                                 | Economy                                                                        |
| `pvp_win` (tùy chọn) | `mode`, `count`                           | World Node; **không** dùng trong `daily` thường                                |

Quy tắc: mục tiêu vị trí (`reach`) dùng tọa độ ô (i, j) theo D15 trong [DECISIONS.md](DECISIONS.md) (đỉnh N của ô; tâm ô = i + 0,5; j + 0,5); mục tiêu `cultivate_minutes` chỉ tính phút ở trạng thái vận khí đang hoạt động (không tính khi đang offline) để không biến nhiệm vụ thành AFK.

### 5.4 Đề xuất JSON Schema

File dữ liệu dự kiến: `quests.json` (một mảng `quests`) nằm cạnh `realm_progression.json` trong `packages/shared/src/data`, kèm schema `quest.schema.json` (draft 2020-12, kiểm bằng Ajv trong CI như 07 §8). **Đề xuất – chờ duyệt**; chưa được thêm vào `@vgtd/shared` (ngoài phạm vi tài liệu này).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://data.tutien.game/schema/quest.schema.json",
  "title": "quest",
  "type": "object",
  "required": ["id", "type", "name_key", "desc_key", "prerequisites", "objectives", "rewards", "repeat"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "pattern": "^q_[a-z0-9_]+$" },
    "type": { "enum": ["main", "side", "daily", "weekly", "sect", "secret_realm", "karma", "event", "tutorial"] },
    "name_key": { "type": "string", "pattern": "^quest\\.[a-z0-9_.]+$" },
    "desc_key": { "type": "string", "pattern": "^quest\\.[a-z0-9_.]+$" },
    "chapter": { "type": "integer", "minimum": 1 },
    "giver": { "$ref": "#/$defs/npcRef" },
    "turn_in": { "$ref": "#/$defs/npcRef" },
    "zone_rule": { "enum": ["any", "safe", "pk", "secret_realm", "event"], "default": "any" },
    "time_limit_s": { "type": ["integer", "null"], "minimum": 30 },
    "prerequisites": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "min_realm": { "type": "integer", "minimum": 1, "maximum": 9 },
        "max_realm": { "type": "integer", "minimum": 1, "maximum": 9 },
        "min_stage": { "type": "integer", "minimum": 1, "maximum": 41 },
        "quests_done": {
          "type": "array",
          "items": { "type": "string", "pattern": "^q_[a-z0-9_]+$" },
          "uniqueItems": true
        },
        "karma_range": {
          "type": "array",
          "items": { "type": "integer", "minimum": -1000, "maximum": 1000 },
          "minItems": 2,
          "maxItems": 2
        },
        "sect_required": { "type": "boolean" }
      }
    },
    "objectives": {
      "type": "object",
      "required": ["mode", "list"],
      "additionalProperties": false,
      "properties": {
        "mode": { "enum": ["all", "any"] },
        "list": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/objective" } }
      }
    },
    "rewards": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "cult_minutes": { "type": "number", "minimum": 0 },
        "stone_wild_hours": { "type": "number", "minimum": 0 },
        "contribution": { "type": "integer", "minimum": 0 },
        "karma_delta": { "type": "integer", "minimum": -250, "maximum": 250 },
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["item_id", "count"],
            "additionalProperties": false,
            "properties": {
              "item_id": { "type": "string", "pattern": "^[a-z0-9_]+$" },
              "count": { "type": "integer", "minimum": 1 },
              "quality": { "type": "integer", "minimum": 0, "maximum": 5 }
            }
          }
        }
      }
    },
    "repeat": {
      "type": "object",
      "required": ["kind"],
      "additionalProperties": false,
      "properties": {
        "kind": { "enum": ["none", "daily", "weekly", "event"] },
        "max_per_cycle": { "type": "integer", "minimum": 1 }
      }
    },
    "branches": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "choice_key", "karma_delta"],
        "additionalProperties": false,
        "properties": {
          "id": { "enum": ["chinh", "ta", "ma"] },
          "choice_key": { "type": "string" },
          "karma_delta": { "type": "integer", "minimum": -250, "maximum": 250 },
          "next_quest": { "type": "string", "pattern": "^q_[a-z0-9_]+$" }
        }
      }
    },
    "telemetry_tag": { "type": "string", "pattern": "^[a-z0-9_.]+$" }
  },
  "$defs": {
    "npcRef": {
      "type": "object",
      "required": ["npc_id", "map_id"],
      "additionalProperties": false,
      "properties": { "npc_id": { "type": "string" }, "map_id": { "type": "string" } }
    },
    "objective": {
      "type": "object",
      "required": ["kind"],
      "additionalProperties": false,
      "properties": {
        "kind": {
          "enum": [
            "kill",
            "collect",
            "deliver",
            "talk",
            "reach",
            "cultivate_minutes",
            "breakthrough",
            "craft",
            "clear_instance",
            "use_item",
            "pvp_win"
          ]
        },
        "target_id": { "type": "string" },
        "count": { "type": "integer", "minimum": 1 },
        "minutes": { "type": "number", "exclusiveMinimum": 0 },
        "tile": { "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2 },
        "radius": { "type": "number", "exclusiveMinimum": 0 }
      }
    }
  }
}
```

### 5.5 Dữ liệu mẫu (chương 1, Đề xuất – chờ duyệt)

```json
{
  "id": "q_c1_van_khi_dau_tien",
  "type": "tutorial",
  "name_key": "quest.c1.first_qi.name",
  "desc_key": "quest.c1.first_qi.desc",
  "chapter": 1,
  "giver": { "npc_id": "npc_truong_lao_cong_son", "map_id": "map_sonmon" },
  "turn_in": { "npc_id": "npc_truong_lao_cong_son", "map_id": "map_sonmon" },
  "zone_rule": "safe",
  "prerequisites": { "min_realm": 1, "max_realm": 1 },
  "objectives": { "mode": "all", "list": [{ "kind": "cultivate_minutes", "minutes": 3 }] },
  "rewards": {
    "cult_minutes": 4,
    "stone_wild_hours": 0.05,
    "items": [{ "item_id": "pill_tu_khi_dan", "count": 1, "quality": 0 }]
  },
  "repeat": { "kind": "none" },
  "telemetry_tag": "ftue.first_qi"
}
```

Kiểm tra bổ sung ngoài schema (script CI đề xuất): `quests_done` không tạo vòng; `max_realm ≥ min_realm`; tổng `rewards.cult_minutes` của `main` trong một chương ≤ ngân sách §4.2; `daily` / `weekly` / `sect` có `repeat.max_per_cycle`; mọi `name_key` / `desc_key` tồn tại trong bảng chuỗi vi-VN.

## Câu hỏi cần chốt

Đã gộp vào [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md), nguồn duy nhất của câu hỏi mở: cột "Câu hỏi" ở đó ghi ID nguồn đã gộp (12 Q1–Q8). Nội dung gốc của mục này nằm trong lịch sử git.
