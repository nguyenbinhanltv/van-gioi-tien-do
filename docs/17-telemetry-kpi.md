# Telemetry, KPI & Dashboard

> **Trạng thái: bản thiết kế đề xuất – chờ duyệt.** Hồ sơ gốc ghi "đo lường (telemetry, dashboard KPI)" là mảng chưa có tài liệu ([OPEN-ITEMS.md](OPEN-ITEMS.md) §3). Đã có sẵn: mục tiêu tiêu hao / sinh ra 0,9–1,0, thuế CPI, vòng điều chỉnh hằng tuần ([07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md) §6–7); điểm nghi vấn gian lận ([08-server-architecture.md](08-server-architecture.md) §6); ngân sách hiệu năng và băng thông ([00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) §3). Ngưỡng KPI sản phẩm (giữ chân, chuyển đổi…) là _Đề xuất – chờ duyệt_ vì chưa có dữ liệu thật. Phần quyền riêng tư (§7) phải được luật sư kiểm tra: xem [19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md) §4.

## 1. Nguyên tắc

1. **Server là nguồn sự thật cho mọi số liệu kinh tế và chiến đấu.** Số liệu client (hiệu năng, UI) chỉ phục vụ trải nghiệm; **không bao giờ** dùng sự kiện client để tính tiền tệ, rơi đồ hay xử phạt. Kinh tế đọc từ **sổ cái kép PostgreSQL** (08 §7), không đọc từ log client.
2. **Đo ít nhưng đúng:** không ghi từng đòn đánh; gộp theo trận / theo giờ (cùng tinh thần gộp số sát thương mỗi 100 ms ở 08 §8).
3. **Tối thiểu hóa dữ liệu cá nhân** (§7): sự kiện chỉ chứa **định danh giả danh**, không có tên đăng nhập, email, số điện thoại, nội dung chat.
4. **Mỗi sự kiện có chủ và có câu hỏi nó trả lời.** Sự kiện không gắn với KPI, dashboard hay phát hiện gian lận thì không thêm.
5. **Lược đồ có phiên bản và được kiểm bằng CI** (JSON Schema draft 2020-12 + Ajv, như 07 §8) để client và server không lệch tên trường.

## 2. Kiến trúc thu thập (Đề xuất – chờ duyệt)

| Thành phần                   | Mô tả                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nguồn sự kiện server         | World Node, Economy, Auth, Chat phát lên bus NATS (chủ đề `telemetry.<domain>`), dùng lại mẫu **outbox** của 08 §7 để không mất sự kiện khi service khởi động lại                                   |
| Nguồn sự kiện client         | Gói TypeScript nhỏ (đề xuất `@vgtd/telemetry`, chưa tạo; client dùng chung giao thức): gom ≤ 50 sự kiện hoặc 10 s rồi gửi qua Gateway; hàng đợi ngoại tuyến 200 sự kiện, bỏ sự kiện cũ nhất khi đầy |
| Tiếp nhận                    | Gateway kiểm chữ ký phiên + giới hạn tần số; chuyển vào dịch vụ ghi sự kiện (ghi theo lô)                                                                                                           |
| Lưu trữ MVP (hosting cục bộ) | PostgreSQL bảng `telemetry_events` phân vùng theo ngày; log thô quá 90 ngày bị xóa (§7); dự phòng nâng lên kho cột (ClickHouse hoặc tương đương) khi vượt khả năng PostgreSQL                       |
| Dashboard                    | Công cụ mã nguồn mở chạy cục bộ (ví dụ Grafana hoặc Metabase) đọc từ view tổng hợp; **không** cho đọc bảng thô chứa `player_pid` ngoài nhóm vận hành                                                |
| Cảnh báo                     | Quy tắc trên view tổng hợp, gửi về kênh nội bộ của đội (kênh cụ thể chưa chốt)                                                                                                                      |

Ước lượng khối lượng (_Đề xuất_, chưa đo): 60–120 sự kiện hành vi mỗi giờ chơi cho một người, cộng thêm mẫu hiệu năng 1 mỗi 60 giây; với 1.000 người chơi đồng thời ≈ 2–4 triệu sự kiện mỗi ngày. Phải đo lại trong closed beta.

## 3. Phân loại sự kiện (event taxonomy)

### 3.1 Quy ước đặt tên

- **`<domain>.<action>`**, chữ thường, `snake_case` cho từng phần; một dấu chấm. Domain lấy từ danh sách cố định ở §3.3. Ví dụ: `quest.complete`, `breakthrough.attempt`.
- **Hành động** là động từ ngắn ở thì hiện tại hoặc kết quả: `start`, `complete`, `attempt`, `result`, `purchase`, `violation`.
- **Thuộc tính** `snake_case`; đơn vị là hậu tố (`_ms`, `_s`, `_pct`, `_kbps`, `_count`); tỷ lệ lưu số thực 0–1 (không phải 0–100) để khớp 07 (`ratio`).
- **Không** nhúng tiếng Việt có dấu vào khóa; giá trị dùng id (`spirit_root = "song_moc_thuy"`), id vật phẩm và nhiệm vụ lấy từ dữ liệu ([12](12-nhiem-vu-cot-truyen.md) §5.2, [13](13-che-tao.md)).
- Đổi tên hoặc đổi ý nghĩa trường = **tăng phiên bản lược đồ** (`schema_version`), không sửa im lặng.

### 3.2 Trường bắt buộc (envelope)

| Trường           | Kiểu          | Ý nghĩa                                                                                 | Server hay client |
| ---------------- | ------------- | --------------------------------------------------------------------------------------- | ----------------- |
| `event_id`       | UUID v7       | Khử trùng lặp; sắp theo thời gian                                                       | Cả hai            |
| `event_name`     | string        | `<domain>.<action>`                                                                     | Cả hai            |
| `schema_version` | string        | Ví dụ `1.0.0`                                                                           | Cả hai            |
| `source`         | enum          | `client`, `gateway`, `world`, `economy`, `auth`, `chat`                                 | Cả hai            |
| `ts_server_ms`   | integer       | Giờ server khi nhận hoặc phát; **chuẩn thời gian**                                      | Server            |
| `ts_client_ms`   | integer\|null | Giờ client (không tin cậy)                                                              | Client            |
| `player_pid`     | string        | Định danh giả danh = HMAC-SHA256(account_id, khóa bí mật); **không** phải tên đăng nhập | Cả hai            |
| `session_id`     | string        | Phiên kết nối hiện tại (08 §7: mã phiên)                                                | Cả hai            |
| `seq`            | integer       | Số thứ tự trong phiên (phát hiện mất / phát lại)                                        | Cả hai            |
| `platform`       | enum          | `web`, `ios`, `android`, `pc`                                                           | Cả hai            |
| `input_mode`     | enum          | `pc`, `touch`, `hybrid` (05 §1)                                                         | Client            |
| `client_version` | string        | Phiên bản gói đã tải                                                                    | Client            |
| `locale`         | string        | Ví dụ `vi-VN` ([19] §2)                                                                 | Client            |
| `realm`, `stage` | integer       | Cảnh giới 1–9 và nấc 1–41 của nhân vật (nếu đã tạo)                                     | Server            |

Trường ngữ cảnh tùy chọn (khi có): `zone_id`, `map_id`, `tile_i`, `tile_j` (tọa độ ô theo D15 trong [DECISIONS.md](DECISIONS.md)), `party_size`, `sect_id` (không phải tên). Trường **cấm** trong sự kiện: tên đăng nhập, email, số điện thoại, nội dung chat, mật khẩu, địa chỉ IP đầy đủ, ID thiết bị phần cứng.

Đề xuất schema envelope (rút gọn, JSON Schema draft 2020-12; chưa thêm vào `@vgtd/shared`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://data.tutien.game/schema/telemetry_event.schema.json",
  "title": "telemetry_event",
  "type": "object",
  "required": [
    "event_id",
    "event_name",
    "schema_version",
    "source",
    "ts_server_ms",
    "player_pid",
    "session_id",
    "seq",
    "platform"
  ],
  "additionalProperties": true,
  "properties": {
    "event_id": {
      "type": "string",
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "event_name": { "type": "string", "pattern": "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$" },
    "schema_version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "source": { "enum": ["client", "gateway", "world", "economy", "auth", "chat"] },
    "ts_server_ms": { "type": "integer", "minimum": 0 },
    "ts_client_ms": { "type": ["integer", "null"], "minimum": 0 },
    "player_pid": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "session_id": { "type": "string", "minLength": 8 },
    "seq": { "type": "integer", "minimum": 0 },
    "platform": { "enum": ["web", "ios", "android", "pc"] },
    "input_mode": { "enum": ["pc", "touch", "hybrid"] },
    "client_version": { "type": "string" },
    "locale": { "type": "string", "pattern": "^[a-z]{2}-[A-Z]{2}$" },
    "realm": { "type": "integer", "minimum": 1, "maximum": 9 },
    "stage": { "type": "integer", "minimum": 1, "maximum": 41 }
  },
  "not": {
    "anyOf": [
      { "required": ["email"] },
      { "required": ["phone"] },
      { "required": ["username"] },
      { "required": ["ip"] }
    ]
  }
}
```

### 3.3 Danh mục sự kiện (MVP)

| Domain         | Sự kiện chính                                                                                                                | Nguồn           | Thuộc tính tiêu biểu                                                                          | Dùng cho                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- | ------------------------------ |
| `session`      | `start`, `end`                                                                                                               | gateway         | `duration_s`, `reason` (`quit`/`timeout`/`kick`), `reconnect_count`                           | DAU, độ dài phiên              |
| `account`      | `register`, `login`                                                                                                          | auth            | `method` (`password` / sau này `google`)                                                      | Phễu, giữ chân                 |
| `character`    | `create`, `delete`                                                                                                           | world           | `spirit_root` (id loại), `mutation` (null/phong/loi/bang), `element_primary`                  | Phân bố Linh căn so với 07 §5  |
| `ftue`         | `spirit_root_reveal`, `first_move`, `first_cultivate`, `first_kill`, `first_equip`, `first_breakthrough`, `complete`, `skip` | client + world  | `step`, `elapsed_s`, `input_mode`                                                             | Phễu FTUE ([16] §7)            |
| `quest`        | `accept`, `progress`, `complete`, `abandon`                                                                                  | world / economy | `quest_id`, `type`, `elapsed_s`                                                               | Nhịp tiến độ; phát hiện bot    |
| `cultivate`    | `start`, `stage_up`                                                                                                          | world           | `stage_from`, `stage_to`, `minutes`, `rho`, `match`                                           | Nhịp tu luyện, đối chiếu 07 §5 |
| `breakthrough` | `attempt`                                                                                                                    | economy         | `to_realm`, `minor`, `base_eff`, `pill`, `karma_penalty`, `p_success`, `success`, `n_fail`    | Đối chiếu tỷ lệ với 07 §2      |
| `tribulation`  | `start`, `end`                                                                                                               | world           | `strikes`, `waves_cleared`, `shield_used`, `array_used`, `death`, `durability_loss`           | Cân bằng Lôi Kiếp (07 §3)      |
| `combat`       | `kill`, `death`, `skill_use` (gộp mỗi 60 s)                                                                                  | world           | `target_type`, `element_matchup` (`counter`/`neutral`/`countered`), `loot_rolled`             | Cân bằng, drop                 |
| `loot`         | `drop`                                                                                                                       | economy         | `source` (`wild`/`elite`/`boss`), `item_id`, `quality`, `pity_n`                              | Kiểm bảng rơi (§5)             |
| `economy`      | `faucet`, `sink`, `transfer`                                                                                                 | economy         | `currency` (`ha`/`trung`/`thuong`/`tien_ngoc`/`cong_hien`), `amount`, `channel`               | Kinh tế (§5)                   |
| `market`       | `list`, `sale`, `cancel`                                                                                                     | economy         | `item_id`, `quality`, `price`, `tax_rate`, `fee`                                              | CPI, thuế                      |
| `craft`        | `start`, `result`                                                                                                            | economy         | `recipe_id`, `score`, `success`, `quality`, `materials_destroyed`                             | Kinh tế chế tạo ([13])         |
| `pvp`          | `kill`, `flag`                                                                                                               | world           | `zone`, `realm_gap`, `karma_delta`                                                            | Quấy phá ([14])                |
| `arena`        | `match_end`                                                                                                                  | world           | `mode`, `realm`, `duration_s`, `winner_input_mode`, `rtt_p95_ms`                              | Công bằng cross-play           |
| `war`          | `end`                                                                                                                        | world           | `leyline_id`, `participants`, `peak_entities`, `kbps_p95`, `result`                           | Tải chiến tranh ([14] §5)      |
| `iap`          | `purchase`, `refund`                                                                                                         | economy         | `sku`, `amount_vnd`, `platform_fee_pct`, `provider`                                           | Doanh thu ([15])               |
| `liveops`      | `event_join`, `event_end`                                                                                                    | world           | `event_id`, `budget_faucet`, `budget_sink`                                                    | Chiến dịch                     |
| `perf`         | `sample` (1 mỗi 60 s)                                                                                                        | client          | `fps_p50`, `fps_p5`, `ram_mb`, `draw_calls_p95`, `particles_p95`, `quality_tier`              | Hiệu năng (§4.3)               |
| `net`          | `sample` (1 mỗi 60 s)                                                                                                        | client          | `rtt_ms_p50`, `rtt_ms_p95`, `loss_pct`, `down_kbps`, `transport` (`webtransport`/`websocket`) | Mạng (§4.3)                    |
| `client`       | `load`, `error`, `crash`                                                                                                     | client          | `load_ms_core`, `bundle`, `error_code`, `stack_hash`                                          | Ổn định                        |
| `anticheat`    | `violation`, `flag`, `disconnect`                                                                                            | world / gateway | `kind`, `points`, `total_points`, `action`                                                    | Gian lận (§6)                  |
| `social`       | `report`, `block`                                                                                                            | chat / world    | `reason`, `context` (`pvp`/`chat`/`trade`)                                                    | Quấy phá, kiểm duyệt           |

Với `perf.sample` và `net.sample`: lấy mẫu 100% trong closed beta, 10% sau đó (_Đề xuất_). `combat.skill_use` gộp theo kỹ năng mỗi 60 s, không ghi từng lần.

## 4. KPI cốt lõi & dashboard

### 4.1 KPI

Các ngưỡng bên dưới là **kỳ vọng làm điểm xuất phát (_Đề xuất – chờ duyệt_)**, không phải số liệu đã được xác minh; cần thay bằng số đo thật sau closed beta.

| Nhóm                        | KPI                                                                     | Định nghĩa                                               | Mục tiêu khởi điểm                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Thu hút                     | Người dùng mới, DAU / WAU / MAU, độ dính (DAU/MAU)                      | `session.start` theo `player_pid`                        | Theo dõi xu hướng; chưa đặt số                                                                                                          |
| FTUE                        | Tỷ lệ qua từng bước, thời gian hoàn thành                               | Phễu `ftue.*` ([16] §7)                                  | ≥ 50% hoàn thành FTUE trong phiên đầu; trung vị ≤ 32 phút                                                                               |
| Giữ chân                    | D1 / D7 / D30                                                           | Người có `session.start` ở ngày N sau `character.create` | D1 ≥ 30%, D7 ≥ 12%, D30 ≥ 5% (đề xuất; phải so sánh với mốc ngành thật)                                                                 |
| Tiến độ                     | Thời gian tới Luyện Khí tầng 5, tầng 9, Trúc Cơ; tỷ lệ tới Trúc Cơ ở D7 | `cultivate.stage_up`, `breakthrough.attempt`             | So với mốc lý thuyết (07 §5: ≈ 59 phút tới tầng 5, ≈ 2,1 giờ tới tầng 9 ở hệ số 1)                                                      |
| Phân phối Linh căn          | Tỷ lệ mỗi loại linh căn khi tạo nhân vật                                | `character.create`                                       | Đúng 5 / 20 / 35 / 25 / 15% (07 §5), lệch quá 2 điểm trên mẫu lớn → kiểm RNG                                                            |
| Xã hội                      | % người vào tông môn, % chơi tổ đội                                     | `social`, `party_size`                                   | Theo dõi                                                                                                                                |
| Nội dung                    | Tỷ lệ hoàn thành chủ tuyến, nhật thường                                 | `quest.complete`                                         | Theo dõi                                                                                                                                |
| PvP                         | Số trận, tỷ lệ thắng theo `input_mode`, tỷ lệ báo cáo                   | `arena.match_end`, `pvp.kill`, `social.report`           | Chênh thắng PC–Mobile ≤ 5 điểm phần trăm ([14] §4.3)                                                                                    |
| Hiệu năng                   | FPS p5, RAM, draw call, hạt, tải gói đầu                                | `perf.sample`, `client.load`                             | Trong ngân sách 00 §3: Web ≤ 500 MB, ≤ 80 draw call, ≤ 1.000 hạt; gói đầu ≤ 25 MB                                                       |
| Mạng                        | RTT, mất gói, băng thông xuống                                          | `net.sample`                                             | Băng thông ≈ 8 KB/s đánh quái, ≈ 13 chợ đông, ≈ 25 chiến tranh (00 §3); tỷ lệ phiên vượt ngưỡng cảnh báo RTT 250 (PC) / 300 ms (Mobile) |
| Ổn định                     | Phiên không sập (crash-free), lỗi tải                                   | `client.crash`, `client.error`                           | ≥ 99% phiên không sập (đề xuất)                                                                                                         |
| Doanh thu (sau khi mở shop) | Chuyển đổi trả phí, ARPDAU, ARPPU, hoàn tiền                            | `iap.*`                                                  | Không đặt số ở MVP ([15] Q8)                                                                                                            |

### 4.2 Bộ dashboard

| Dashboard              | Người dùng                | Làm mới         | Nội dung chính                                                    | Cảnh báo ví dụ                                        |
| ---------------------- | ------------------------- | --------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| **Vận hành trực tiếp** | Vận hành, LiveOps         | 1 phút          | CCU, kết nối mới, độ trễ, lỗi, tải World Node, trạng thái sự kiện | CCU giảm > 30% trong 10 phút; lỗi tải gói > 2%        |
| **FTUE**               | Thiết kế, sản phẩm        | Hằng ngày       | Phễu theo PC / Mobile / Web và loại Linh căn                      | Một bước mất > 25% người chơi                         |
| **Giữ chân & tiến độ** | Sản phẩm                  | Hằng ngày       | D1 / D7 / D30, thời gian tới các mốc cảnh giới                    | D1 giảm > 5 điểm so với tuần trước                    |
| **Kinh tế**            | Kinh tế, LiveOps          | Hằng giờ / tuần | §5                                                                | §5.3                                                  |
| **Hiệu năng & mạng**   | Kỹ thuật                  | 5 phút          | FPS, RAM, draw call, RTT, băng thông, theo nền tảng và cấp máy    | Băng thông vượt ngân sách 00 §3 hơn 20% trong 15 phút |
| **Bảo mật / gian lận** | Vận hành, bảo mật         | 1 phút          | §6                                                                | §6                                                    |
| **Công bằng PvP**      | Thiết kế                  | Hằng ngày       | Thắng theo `input_mode`, theo cảnh giới, báo cáo quấy phá         | Chênh thắng PC–Mobile > 5 điểm phần trăm              |
| **Doanh thu**          | Quản lý (sau khi mở shop) | Hằng ngày       | Doanh thu theo SKU, hoàn tiền, ARPU                               | Hoàn tiền tăng đột biến                               |

## 5. Giám sát kinh tế

Nguồn dữ liệu: **sổ cái PostgreSQL** (bảng `ledger_entries`, [23](23-mo-hinh-du-lieu.md) và [26 §2](26-kinh-te-ledger.md); mẫu `ledger` ở 08 §7 chỉ là phác thảo) và sự kiện `economy.*`, `market.*`, `loot.*`. Mỗi bút toán có tài khoản (`SYSTEM_SINK_*` / `SYSTEM_FAUCET_*`, tên chuẩn ở 26 §2.2) nên tính được dòng tiền theo kênh.

### 5.1 Chỉ số bắt buộc

| Chỉ số                                                    | Cách tính                                                                                                                                         | Tham chiếu                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Tỷ lệ tiêu hao / sinh ra** (Linh thạch, quy ra hạ phẩm) | Tổng sink / tổng faucet theo tuần, tách theo kênh                                                                                                 | Mục tiêu 0,9–1,0 (07 §6–7, `SINK_SOURCE_RATIO_TARGET`) |
| **Cơ cấu tiêu hao**                                       | Tỷ trọng từng kênh so với mục tiêu: đột phá 35%, thuế chợ + niêm yết 15%, sửa chữa 15%, Hộ Sơn Đại Trận / Linh Mạch 15%, truyền tống 8%, khác 12% | 07 §7 (`SINK_TARGETS`)                                 |
| **CPI_w**                                                 | Giá trung bình tuần này của rổ (đan đột phá, nguyên liệu phổ biến, bản vẽ phẩm thấp) / tuần trước                                                 | 07 §7                                                  |
| **Thuế chợ hiện hành τ**                                  | τ = clamp(0,05 + 0,5 × max(0, CPI_w − 1,02), 0,05, 0,10)                                                                                          | 07 §7                                                  |
| **Nguồn Linh thạch theo kiểu quái**                       | Linh thạch sinh ra từ dã ngoại / tinh anh / Boss / nhiệm vụ / sự kiện                                                                             | 07 §6 (kỳ vọng 180 / 530 mỗi giờ ở r = 1)              |
| **Giá trị sổ cái**                                        | Tổng Linh thạch toàn server; phân phối (Gini, phần của top 1%, trung vị)                                                                          | _Đề xuất_                                              |
| **Vận tốc tiền**                                          | Giao dịch Vạn Bảo Lâu / tổng Linh thạch                                                                                                           | _Đề xuất_                                              |
| **Tiên Ngọc**                                             | Vào (nạp, miễn phí), ra (cửa hàng, Battle Pass) — **tách khỏi tỷ lệ Linh thạch**                                                                  | [15] §6                                                |
| **Kinh tế chế tạo**                                       | Nguyên liệu bị hủy, phí lò, sửa lò, xúc tác                                                                                                       | [13] §6.1                                              |
| **Sự kiện**                                               | Faucet / sink thêm của từng sự kiện so với ngân sách khai báo                                                                                     | [15] §5.4                                              |

### 5.2 Kiểm toán định kỳ

| Kiểm toán                     | Cách làm                                                                                                                                    | Tần suất  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **Cân bằng sổ cái**           | Với mọi giao dịch, tổng bút toán bằng 0; tổng toàn sổ khớp tổng số dư ví + tài khoản SINK                                                   | Hằng ngày |
| **Tỷ lệ rơi thực tế**         | So tỷ lệ quan sát với bảng 07 §6 bằng kiểm định nhị thức (z), cảnh báo khi p < 0,001 và mẫu đủ lớn; pity bản vẽ Vàng–Đỏ: chắc chắn ở lần 30 | Hằng tuần |
| **Tỷ lệ đột phá thực tế**     | So `success` với `p_success` đã ghi (RNG có seed, 07 §2); lệch hệ thống → kiểm RNG                                                          | Hằng tuần |
| **Phân phối phẩm**            | So phân phối phẩm rơi với bảng 07 §6 và phân phối phẩm chế với bảng §4.3 của [13]                                                           | Hằng tuần |
| **Phát hiện nhân đôi (dupe)** | Số vật phẩm sinh ra không có nguồn trong sổ cái; ID giao dịch lặp (khóa idempotency)                                                        | Hằng ngày |
| **RMT / chợ đen**             | Chuyển một chiều giá trị lớn từ tài khoản mới tới tài khoản khác; niêm yết giá bất thường; tài khoản chỉ giao dịch, không chơi              | Hằng ngày |

### 5.3 Ngưỡng cảnh báo (khớp vòng điều chỉnh hằng tuần của 07 §7)

| Điều kiện                                               | Hành động                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Tiêu hao / sinh ra < 0,9 trong 2 tuần liền              | Kích hoạt vòng điều chỉnh: nâng sàn τ thêm 1 điểm, nhân phí sửa chữa 1,1 (07 §7); dừng sự kiện nhiều faucet ([15] §5.4) |
| Tiêu hao / sinh ra > 1,05 trong 2 tuần liền             | Điều chỉnh ngược chiều (07 §7)                                                                                          |
| CPI_w > 1,02                                            | τ tăng theo công thức; xem lại sự kiện nguyên liệu                                                                      |
| CPI_w < 0,95 (giảm phát)                                | Bật hạn ngạch chế đan chủ ([13] §6.2); xem lại nguồn nguyên liệu                                                        |
| Một kênh tiêu hao lệch > 5 điểm phần trăm khỏi mục tiêu | Xem lại hệ số kênh đó trong dữ liệu                                                                                     |
| Ledger mất cân bằng hoặc dupe phát hiện                 | Dừng kênh liên quan (kill switch), điều tra; ghi sự cố                                                                  |

Mọi hệ số điều chỉnh nằm trong dữ liệu và server nạp lại không cần phát hành client (07 §7).

## 6. Tín hiệu chống gian lận

Server là nơi ra quyết định (08 §6). Telemetry chỉ **ghi lại** và **tổng hợp** để con người xem xét.

### 6.1 Tín hiệu đã định nghĩa ở 08

| Tín hiệu                                   | Ngưỡng (08 §6)                                                                                                       | Sự kiện                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Input vượt ngân sách thời gian (speedhack) | Claimed > 1,02 × (t − t_vào) + 250 ms; tỷ lệ Claimed / thời gian thật trên 1,03 kéo dài → gắn cờ; trên 1,10 → ngắt   | `anticheat.violation` (`kind: speed`)    |
| Quãng đường mỗi tick vượt tốc độ cho phép  | > tốc độ × 50 ms × 1,05                                                                                              | `anticheat.violation` (`kind: speed`)    |
| Yêu cầu dùng chiêu trước `readyAt`         | Từ chối, cộng điểm                                                                                                   | `anticheat.violation` (`kind: cooldown`) |
| Tần số gói thi triển                       | > 10 gói/giây (token bucket)                                                                                         | `anticheat.violation` (`kind: spam`)     |
| Gói phát lại                               | Số thứ tự + mã phiên                                                                                                 | `anticheat.violation` (`kind: replay`)   |
| **Điểm nghi vấn**                          | +1 mỗi vi phạm, −1 mỗi phút; 20: cảnh báo log; 50: ngắt kết nối; 3 lần ngắt trong 24 giờ: hàng đợi kiểm tra thủ công | `anticheat.flag`, `anticheat.disconnect` |

### 6.2 Tín hiệu hành vi bổ sung (Đề xuất – chờ duyệt)

| Dấu hiệu                                | Cách đo                                                                                                                 | Hướng xử lý                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Bot / macro**                         | Độ lệch chuẩn khoảng cách giữa các input quá nhỏ; đường đi lặp (entropy thấp); online liên tục > 20 giờ/ngày nhiều ngày | Gắn cờ xem xét, không tự cấm (08 §6)      |
| **Cày nhiệm vụ bằng bot**               | Hoàn thành cả bộ nhật thường dưới 10 phút nhiều ngày liên tiếp ([12] §4.3)                                              | Cờ                                        |
| **Nhiều tài khoản**                     | Nhiều tài khoản chung nơi chơi / hành vi / nhận chuyển giá trị (không dùng định danh thiết bị phần cứng, §7)            | Cờ + kiểm tra thủ công                    |
| **Thông đồng đấu trường (win-trading)** | Cặp đối thủ lặp; thắng thua theo mẫu                                                                                    | Giảm điểm, loại khỏi xếp hạng ([14] §4.2) |
| **Canh xác / quấy phá**                 | `pvp.kill` lặp nạn nhân, `social.report` nhiều                                                                          | Biện pháp trong [14] §6                   |
| **Nhân đôi vật phẩm / hack kinh tế**    | §5.2                                                                                                                    | Dừng kênh, điều tra                       |
| **Chuyển giá trị bất thường**           | Tài khoản mới nhận / chuyển lượng lớn qua giao dịch trực tiếp (thuế 3%)                                                 | Cờ; hạn chế chợ cho tài khoản mới         |

### 6.3 Nguyên tắc xử lý

- **Không cấm tài khoản tự động chỉ dựa trên một chỉ số**, vì mạng Mobile có thể tạo dương tính giả (08 §6).
- Mỗi lần xử phạt có **bằng chứng truy xuất**: log RNG, sổ cái, nhật ký sự kiện `anticheat.*`; cho phép khiếu nại và kiểm tra lại (07 §2 "ghi log từng lần để đội vận hành kiểm tra khiếu nại").
- Hàng đợi kiểm tra thủ công có SLA nội bộ (đề xuất 72 giờ) và nhật ký người xử lý.

## 7. Quyền riêng tư & tối thiểu hóa dữ liệu

> **Phải được luật sư kiểm tra** trước khi ra mắt ([19](19-ngon-ngu-phap-ly.md) §4). Các điều dưới đây là nguyên tắc thiết kế kỹ thuật, không phải ý kiến pháp lý.

| Chủ đề                     | Nguyên tắc                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Định danh**              | Tên đăng nhập và băm mật khẩu chỉ nằm trong dịch vụ Auth; telemetry dùng `player_pid` (HMAC). Bảng ánh xạ `account_id ↔ player_pid` chỉ do bộ phận vận hành xem, không đưa vào dashboard.                                                   |
| **Dữ liệu cấm thu**        | Email, số điện thoại, họ tên thật, địa chỉ, nội dung chat, ảnh, mã thiết bị phần cứng, vị trí chính xác. Báo cáo quấy phá chỉ đính kèm 60 s log chiến đấu / chat liên quan khi người dùng bấm Báo cáo.                                      |
| **Địa chỉ IP**             | Gateway thấy IP để giới hạn tần số và an ninh; không lưu vào sự kiện. Nếu cần lưu, cắt còn /24 (IPv4) hoặc /48 (IPv6) và xóa sau ≤ 30 ngày (_Đề xuất_; thời hạn bắt buộc tối thiểu theo luật **cần kiểm tra**).                             |
| **Thiết bị**               | Chỉ lớp thô: `platform`, phiên bản hệ điều hành / trình duyệt chính, lớp độ phân giải, cấp máy; không dùng vân tay thiết bị.                                                                                                                |
| **Đồng ý**                 | Màn hình đầu tiên hiển thị mục đích thu thập; chia hai nhóm: **thiết yếu** (vận hành, bảo mật, kinh tế, chống gian lận; cần để cung cấp dịch vụ) và **phân tích** (hành vi, hiệu năng; có thể tắt trong Cài đặt).                           |
| **Trẻ em / vị thành niên** | Có cơ chế xác minh độ tuổi và đồng ý của người giám hộ khi bắt buộc theo luật (ngưỡng tuổi cụ thể **cần kiểm tra**; xem [19] §4); không thu thập phân tích hành vi chi tiết với tài khoản vị thành niên nếu luật yêu cầu.                   |
| **Lưu giữ**                | Log sự kiện thô 90 ngày (_Đề xuất_); tổng hợp ẩn danh giữ lâu hơn; sổ cái tài chính và thanh toán giữ theo nghĩa vụ kế toán / pháp lý (**cần kiểm tra** thời hạn); log truy cập theo nghĩa vụ lưu trữ của luật Việt Nam (**cần kiểm tra**). |
| **Xóa và xuất dữ liệu**    | Có quy trình xử lý yêu cầu xóa / xuất của chủ thể dữ liệu: xóa ánh xạ `player_pid`, ẩn danh bản ghi sự kiện; **giữ** bút toán sổ cái đã ẩn danh để chống gian lận và nghĩa vụ kế toán.                                                      |
| **Truy cập**               | Phân quyền theo vai trò: kỹ sư xem tổng hợp; chỉ vận hành / bảo mật xem bảng thô; mọi truy vấn bảng thô được ghi nhật ký.                                                                                                                   |
| **Vị trí lưu trữ**         | Dữ liệu của người dùng Việt Nam lưu tại Việt Nam (hosting cục bộ giai đoạn đầu thỏa; khi chuyển đám mây phải kiểm tra yêu cầu lưu trữ dữ liệu trong nước — [19] §4).                                                                        |
| **Bên thứ ba**             | Không gửi sự kiện cho nền tảng quảng cáo / phân tích bên thứ ba ở MVP; mọi SDK mới phải qua rà soát quyền riêng tư và khai báo trên cửa hàng ứng dụng.                                                                                      |

## Câu hỏi cần chốt

| #   | Câu hỏi                                                                       | Mặc định đề xuất                                                   |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Q1  | Lưu trữ MVP: PostgreSQL phân vùng hay ngay lập tức dùng kho cột (ClickHouse)? | PostgreSQL ở MVP (đơn giản khi chạy cục bộ), nâng cấp khi vượt tải |
| Q2  | Công cụ dashboard: Grafana hay Metabase (hoặc cả hai)?                        | Metabase cho sản phẩm / kinh tế, Grafana cho vận hành / hiệu năng  |
| Q3  | Ngưỡng KPI giữ chân và tỷ lệ FTUE (D1 ≥ 30%, D7 ≥ 12%, D30 ≥ 5%, FTUE ≥ 50%)  | Dùng làm giả thuyết ban đầu, đối chiếu mốc ngành sau closed beta   |
| Q4  | Có tách "tùy chọn phân tích" (opt-out) khỏi dữ liệu thiết yếu ngay MVP không? | Có (§7); thiết yếu luôn bật                                        |
| Q5  | Thời hạn lưu: log thô 90 ngày, IP 30 ngày, sổ cái theo luật                   | Dùng làm mốc; chốt sau tư vấn pháp lý                              |
| Q6  | Dùng `player_pid` HMAC với khóa xoay vòng hàng năm hay cố định?               | Cố định trong MVP; có kế hoạch xoay khi cần ẩn danh sâu hơn        |
| Q7  | SLA hàng đợi kiểm tra thủ công 72 giờ và quy trình khiếu nại                  | Có                                                                 |
| Q8  | Có thu nhận thêm bản ghi `ui.open` để tối ưu giao diện không?                 | Không trong MVP (giảm khối lượng và PII)                           |
