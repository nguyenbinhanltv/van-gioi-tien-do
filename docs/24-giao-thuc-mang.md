# Giao thức mạng

> **Trạng thái:** thiết kế kỹ thuật. Mục "Đề xuất – chờ duyệt" chưa có hiệu lực cho tới khi vào [DECISIONS.md](DECISIONS.md). Nền tảng: [08 §8](08-server-architecture.md) (giao thức & băng thông) và `@vgtd/protocol` v1 trong PR #10 (đang mở: 9 thông điệp đầu, `PROTOCOL_VERSION = 1`). Số nhịp, ngân sách lấy từ `NETWORK` của `@vgtd/shared`; không sao chép hằng số vào mã khác.
>
> **Phạm vi:** vận chuyển, khung gói, phiên bản, danh mục thông điệp, rate limit, kích thước so với ngân sách. Thông điệp **đã có** trong PR #10 được ghi nguyên (id 1–9); mọi thông điệp còn lại là **đề xuất**.

## 1. Vận chuyển

| Lớp                           | MVP                                                                                                               | Sau MVP                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Trình duyệt Web               | **WebSocket nhị phân** (`wss://`; `ws://` chỉ cho localhost)                                                      | **WebTransport (HTTP/3)** khi trình duyệt hỗ trợ; client dò khả năng, rơi về WebSocket ([08 §8](08-server-architecture.md)) |
| Mobile / PC native            | Cùng WebSocket                                                                                                    | Thư viện QUIC native hoặc WebTransport                                                                                      |
| Xác thực (đăng nhập, làm mới) | **HTTPS JSON** (không qua WS): `POST /auth/login`, `/auth/refresh`, `/auth/logout` ([25](25-xac-thuc-bao-mat.md)) | Thêm `/auth/google` (OIDC)                                                                                                  |
| Phục vụ tĩnh                  | HTTP(S) riêng (bundle, manifest)                                                                                  | CDN                                                                                                                         |

Lý do chọn WebSocket cho MVP: hỗ trợ mọi trình duyệt/nền tảng, thư viện `ws` ổn định trên Node, đủ cho 20–30 Hz input. **Đánh đổi đã biết:** WS chạy trên TCP nên có _head-of-line blocking_ — một gói mất làm trễ cả luồng; vì thế (a) snapshot là delta so với baseline ACK nên gói tới trễ vẫn dùng được, (b) client nội suy 150–250 ms, (c) khi bật WebTransport, input/snapshot chuyển sang datagram không tin cậy theo bảng ánh xạ ở 08 §8 (mỗi gói input kèm 2 input trước). Giao thức được thiết kế để **cùng định dạng gói** chạy trên cả hai lớp.

### 1.1 Chi tiết WebSocket

- Chỉ **khung nhị phân**; khung văn bản bị đóng với mã 1003. Một thông điệp = một khung (không phân mảnh); kích thước khung tối đa **16 KB** (vượt: đóng 1009).
- **Không** đặt token trong URL (lọt vào log). Token truy cập gửi ở thông điệp `hello` đầu tiên; kết nối chưa gửi `hello` trong **5 s** bị đóng.
- `permessage-deflate`: **tắt** mặc định; chỉ gửi nén (cờ `compress` từng lần gửi) cho chat và danh sách lớn ([08 §8](08-server-architecture.md)). Snapshot không nén.
- Kiểm tra `Origin` theo danh sách cho phép (chặn WebSocket chéo trang).
- Nhịp tim: thông điệp `ping`/`pong` ứng dụng mỗi 10 s (đồng bộ đồng hồ); ping của WS giao thức để Gateway phát hiện kết nối chết (30 s).
- Gateway định tuyến bằng `peekHeader(buf)` không giải mã thân ([PR #10]).

## 2. Khung gói và kiểu dữ liệu

Giữ nguyên định dạng của PR #10: `[version u8][type u8][body…]`, **big-endian**, giải mã **nghiêm ngặt** (từ chối byte thừa, bit đệm khác 0, cờ không biết).

| Quy tắc                                                                                                                              | Ghi chú                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Số nguyên không dấu/có dấu cố định; số thực chỉ ở trường được ghi rõ (vị trí float32 trong khối `self`, còn lại lượng tử 1/32 ô)     | Không gửi `float64`                               |
| Chuỗi UTF-8 có độ dài `u8`/`u16` đứng trước; giới hạn độ dài mỗi trường (tên ≤ 24 byte, chat ≤ 256 byte…)                            | Giải mã từ chối chuỗi sai UTF-8                   |
| Mọi mảng có số phần tử đứng trước và **giới hạn trên cứng** (chống cấp phát tùy ý)                                                   | `validateMessage` kiểm tra; lỗi → `ProtocolError` |
| Định danh dài hạn (UUID) chỉ xuất hiện ở bắt tay, thư, chợ (16 byte); trong thế giới dùng `entityId u32` và **chỉ số cục bộ 10 bit** | [23 §3](23-mo-hinh-du-lieu.md)                    |
| Thời gian: `serverTimeMs u32` (modulo 2³²) cho nhịp; `tick u32` cho mô phỏng                                                         | Đồng hồ server đồng bộ bằng 8 ping/pong, trung vị |

**Đề xuất – chờ duyệt (ADR-013): hai họ mã hóa dùng chung khung/header**

| Họ       | Phạm vi                                                                                                           | Mã hóa                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nóng** | `input`, `snapshot`, `aoi_enter`, `aoi_leave`, `skill_cast`, `skill_result`, `damage_batch`, `ping/pong`, `error` | Đóng gói bit/byte thủ công (như PR #10) – tối ưu từng byte                                                                                                            |
| **Lạnh** | Mọi thứ còn lại: `hello`, túi đồ, chat, chợ, thư, đột phá, tông môn…                                              | **Protobuf** (`@bufbuild/protobuf`), mô tả trong `packages/protocol/proto/*.proto`, bọc trong thông điệp `pb` (type `0x80`): `[ver][0x80][msgId u16][protobuf bytes]` |

Lý do: [08 §8](08-server-architecture.md) đã gợi ý Protobuf/FlatBuffers cho sự kiện; mô tả bằng `.proto` cho phép **Economy/Chat/Gateway viết bằng Go/Kotlin/Rust sau này** sinh mã từ cùng nguồn, đồng thời có luật tiến hóa trường rõ ràng (§3). Phần nóng không dùng Protobuf vì không đạt mật độ bit (5–6 B/thực thể) và chạy ở 20 Hz. **Điểm cần xác nhận:** PR #10 hiện cài mọi thứ bằng codec thủ công; việc thêm họ Lạnh là mở rộng, không phá vỡ v1.

## 3. Phiên bản và tương thích

- `PROTOCOL_VERSION` (u8) nằm trong **mọi** gói; `hello` mang `{protocolMin, protocolMax, dataVersion, clientBuild, platform}`.
- **Chính sách MVP:** server chấp nhận **đúng một** phiên bản; lệch → `error{code: VERSION_MISMATCH}` kèm `serverVersion` rồi đóng; client chuyển sang màn hình cập nhật ([21 §3](21-kien-truc-client.md)). **Sau MVP:** hỗ trợ cửa sổ N và N−1 trong 14 ngày kể từ lần phát hành để cập nhật cuốn chiếu.
- **Khi nào tăng phiên bản** (skill `vgtd-sim-determinism`): đổi bố cục trường, giá trị enum, hành vi công thức/bảng dữ liệu làm đổi kết quả mô phỏng, hoặc đổi thứ tự rút số ngẫu nhiên.
- **Tiến hóa trường (họ Lạnh/Protobuf):** chỉ thêm trường tùy chọn với số hiệu mới; không đổi nghĩa/xóa số hiệu (đánh dấu `reserved`); trường lạ bị bỏ qua. Kiểm tra bằng công cụ `buf breaking` trong CI ([28 §3](28-chien-luoc-kiem-thu.md)).
- **Họ Nóng:** mọi thay đổi = tăng `PROTOCOL_VERSION`.
- **Vector kiểm thử vàng**: bộ gói mẫu + kết quả giải mã (JSON) được lưu trong repo, dùng bởi mọi hiện thực (TS, và sau này Go/Rust) để chống lệch codec.
- `dataVersion` (băm bảng dữ liệu tĩnh) tách khỏi giao thức: lệch → cập nhật bundle dữ liệu, không cần ngắt giao thức.

## 4. Vòng đời kết nối

```mermaid
sequenceDiagram
  participant C as Client
  participant G as Gateway
  participant A as Auth
  participant W as World Node
  C->>A: HTTPS POST /auth/login (user, pass)
  A-->>C: accessToken (JWT, ngắn hạn) + refreshToken
  C->>G: WS mở kết nối
  C->>G: hello {protocolMin/Max, dataVersion, token}
  G->>A: verifyAccessToken
  G-->>C: hello_ack {sessionId, serverTimeMs, limits, characters[]}
  C->>G: char_select {characterId}
  G->>W: join(characterState, epoch)
  W-->>G: aoi_enter (đầy đủ) + snapshot đầu
  loop mỗi 50 ms
    C->>G: input {ack, inputs[1..3]}
    G->>W: pushInput
    W-->>G: snapshot (delta vs baseline ACK)
    G-->>C: snapshot
  end
  Note over C,G: ping/pong 10 s; mất kết nối → resume {sessionId, lastSnapshotSeq} trong 10 s
```

- **Resume** [Cập nhật D80: đã hiện thực qua `hello` JSON `{resume:{entityId,token}}` + token dùng một lần trong `hello_ack`, không phải thông điệp Protobuf `resume`; giữ nhân vật 10 s; sổ anti-cheat giữ nguyên, ngân sách thời gian được trượt một lần; phiên đã thu hồi không resume được]**:** khi rớt mạng ≤ 10 s, `resume{sessionId, lastSeq}` nối lại cùng phiên; World Node giữ nhân vật đứng yên ([08 §7](08-server-architecture.md)). Quá 10 s: `hello` mới, nhân vật được đưa ra khỏi thế giới và lưu.
- **Một nhân vật một kết nối:** kết nối thứ hai của cùng tài khoản đá kết nối cũ bằng `bye{reason: LOGIN_ELSEWHERE}`.
- **Trình tự đóng:** `bye{reason}` → đóng WS với mã tương ứng (ví dụ 4001 phiên hết hạn, 4003 bị kick, 4008 vi phạm giao thức).

## 5. Danh mục thông điệp

Ký hiệu: **C→S** / **S→C**; "Họ": N = nóng (thủ công), L = lạnh (Protobuf); "Tin cậy": trên WebSocket mọi thông điệp tin cậy; cột này chỉ lưu ý ánh xạ **WebTransport** sau MVP (D = datagram, S = stream).

| Id           | Tên                      | Hướng     | Họ  | Tin cậy (WT) | Trạng thái      | Nội dung                                                                                                                                                                                                                                                  |
| ------------ | ------------------------ | --------- | --- | ------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | `input`                  | C→S       | N   | D            | **Có (PR #10)** | `ack u16, count u8, count × {seq u16, dtMs u8, dir u8, mag:4·flags:4}` (1–3 input)                                                                                                                                                                        |
| 2            | `snapshot`               | S→C       | N   | D            | **Có**          | `flags, seq, [baselineSeq], tick, [self 19 B (+20 B vitals khi đổi)], count, bản ghi thực thể bit-packed` (37–44 bit/thực thể)                                                                                                                            |
| 3            | `aoi_enter`              | S→C       | N   | S            | **Có**          | `count × 20 B` (chỉ số, entityId, kind, **defId u16**, vị trí, anim, hướng, hp%, maxHp) _[Cập nhật D74: giao thức v2, +2 B `defId`]_                                                                                                                      |
| 4            | `aoi_leave`              | S→C       | N   | S            | **Có**          | `count × index u16`                                                                                                                                                                                                                                       |
| 5            | `skill_cast`             | C→S       | N   | S            | **Có**          | `seq u16, skillId u16, targetId u32, castFlags u8, [aimQi u16, aimQj u16]` (11 B, hoặc 15 B có điểm ngắm) _[Cập nhật D78: giao thức v3, +1 B cờ, điểm ngắm tùy chọn lượng tử 1/32 ô]_                                                                     |
| 6            | `skill_result`           | S→C       | N   | S            | **Có**          | `seq, reason (CastReason), skillId, readyAtMs, casterIndex, hits[]`                                                                                                                                                                                       |
| 7            | `error`                  | S→C       | N   | S            | **Có**          | `code u16, len u8, utf-8` (mã lỗi §8)                                                                                                                                                                                                                     |
| 8/9          | `ping`/`pong`            | C→S/S→C   | N   | D            | **Có**          | `clientTimeMs u32 [, serverTimeMs u32]`                                                                                                                                                                                                                   |
| 15           | `telegraph_start`        | S→C       | N   | S            | **Có**          | `id u16, mobEntityId u32, shape u8, qi u16, qj u16, facing u8, size u16, extra u16, durationMs u16` (20 B) _[Cập nhật D89: giao thức v5; hình báo đòn của quái, chỉ tới client có AOI chứa điểm neo]_                                                     |
| 16           | `telegraph_end`          | S→C       | N   | S            | **Có**          | `id u16, cancelled u8` (5 B) _[Cập nhật D89]_                                                                                                                                                                                                             |
| 10           | `hello`                  | C→S       | N   | S            | Đề xuất         | `protocolMin u8, protocolMax u8, dataVersion u32, clientBuild u16, platform u8, tokenLen u16, token` (token JWT ≤ 1 KB)                                                                                                                                   |
| 11           | `hello_ack`              | S→C       | N   | S            | Đề xuất         | `sessionId 16 B, serverTimeMs u32, tickHz u8, limits{maxEntities, maxFrame}, characters[…]`                                                                                                                                                               |
| 12           | `resume`                 | C→S       | N   | S            | Đề xuất         | `sessionId 16 B, lastSnapshotSeq u16`                                                                                                                                                                                                                     |
| 13           | `bye`                    | S→C       | N   | S            | Đề xuất         | `reason u8` (LOGIN_ELSEWHERE, KICKED, SHUTDOWN, SLOW_CONSUMER, BANNED)                                                                                                                                                                                    |
| 14           | `char_select`            | C→S       | N   | S            | Đề xuất         | `characterId 16 B`                                                                                                                                                                                                                                        |
| 20           | `damage_batch`           | S→C       | N   | S            | Đề xuất         | Số sát thương **gộp mỗi 100 ms/mục tiêu** ([08 §8](08-server-architecture.md)): `count, count × {targetIndex u16, sum u32, flags u8 (crit, element, kill)}`                                                                                               |
| 21           | `buff_update`            | S→C       | N   | S            | Đề xuất         | `entityIndex u16, buffId u16, stacks u8, expireTick u32` (thêm/đổi/xóa)                                                                                                                                                                                   |
| 22           | `entity_event`           | S→C       | N   | S            | Đề xuất         | Chết, hồi sinh, đổi trạng thái lớn: `entityIndex u16, kind u8, arg u32`                                                                                                                                                                                   |
| 23           | `target_select`          | C→S       | N   | S            | Đề xuất         | `targetId u32` (0 = bỏ chọn); ý định, server xác thực                                                                                                                                                                                                     |
| 24           | `cast_cancel`            | C→S       | N   | S            | Đề xuất         | `seq u16`                                                                                                                                                                                                                                                 |
| 25           | `drop_spawn`             | S→C       | N   | S            | Đề xuất         | Vật phẩm rơi hiện trên đất (vị trí, `def_id`, chủ nhặt đầu)                                                                                                                                                                                               |
| 26           | `drop_pick`              | C→S       | N   | S            | Đề xuất         | Ý định nhặt `dropId u32`; kết quả đi qua Economy → `inv_delta`                                                                                                                                                                                            |
| 27           | `cast_start`             | S→C       | N   | S            | Đề xuất         | `casterIndex u16, skillId u16, aim, serverStartTick u32, windupMs u16`: client chạy animation/telegraph theo mốc server (docs/11)                                                                                                                         |
| 28           | `skill_cast_ground`      | C→S       | N   | S            | Đề xuất         | `seq u16, skillId u16, aimI/aimJ` lượng tử 1/32 ô, cho kỹ năng vùng đặt trên đất. **[Thay thế bởi D78: điểm nhắm là trường tùy chọn của `skill_cast` (giao thức v3), không thêm thông điệp này]**. Khoảng trống v1: `skill_cast` (id 5) chưa có điểm nhắm |
| 30           | `inv_snapshot`           | S→C       | L   | S            | Đề xuất         | Toàn bộ túi đồ/trang bị/số dư khi vào game hoặc sau lỗi đồng bộ (có `version`)                                                                                                                                                                            |
| 31           | `inv_delta`              | S→C       | L   | S            | Đề xuất         | Thay đổi gia tăng kèm `version` mới; client phát hiện lỗ hổng `version` → xin `inv_snapshot`                                                                                                                                                              |
| 32           | `inv_cmd`                | C→S       | L   | S            | Đề xuất         | `requestId, op ∈ {use, equip, unequip, move, split, merge, discard, sort}, args`                                                                                                                                                                          |
| 33           | `inv_result`             | S→C       | L   | S            | Đề xuất         | `requestId, ok/lỗi, delta?`                                                                                                                                                                                                                               |
| 40           | `chat_send`              | C→S       | L   | S            | Đề xuất         | `channel, text (≤ 256 B), clientMsgId`                                                                                                                                                                                                                    |
| 41           | `chat_msg`               | S→C       | L   | S            | Đề xuất         | `channel, senderName, senderId?, text, ts`                                                                                                                                                                                                                |
| 42           | `chat_history`           | S→C       | L   | S            | Đề xuất         | Tối đa 200 tin gần nhất khi vào kênh                                                                                                                                                                                                                      |
| 50           | `market_search`          | C→S       | L   | S            | Đề xuất         | Bộ lọc, phân trang                                                                                                                                                                                                                                        |
| 51           | `market_results`         | S→C       | L   | S            | Đề xuất         | Danh sách niêm yết                                                                                                                                                                                                                                        |
| 52           | `market_list`            | C→S       | L   | S            | Đề xuất         | `requestId, itemRef, qty, unitPrice, currency, duration`                                                                                                                                                                                                  |
| 53           | `market_buy`             | C→S       | L   | S            | Đề xuất         | `requestId, listingId, qty`                                                                                                                                                                                                                               |
| 54           | `market_result`          | S→C       | L   | S            | Đề xuất         | `requestId, ok/lỗi` (thuế, phí đã tính phía server)                                                                                                                                                                                                       |
| 70           | `trade_invite`           | Hai chiều | L   | S            | Đề xuất         | Mời giao dịch trực tiếp (thuế cố định 3%)                                                                                                                                                                                                                 |
| 71           | `trade_update`           | Hai chiều | L   | S            | Đề xuất         | Đặt/đổi vật phẩm, tiền của một bên                                                                                                                                                                                                                        |
| 72           | `trade_lock`             | Hai chiều | L   | S            | Đề xuất         | Khóa đề nghị (bước 1)                                                                                                                                                                                                                                     |
| 73           | `trade_confirm`          | C→S       | L   | S            | Đề xuất         | Xác nhận (bước 2)                                                                                                                                                                                                                                         |
| 74           | `trade_cancel`           | Hai chiều | L   | S            | Đề xuất         | Hủy / hết hạn 60 s                                                                                                                                                                                                                                        |
| 75           | `trade_result`           | S→C       | L   | S            | Đề xuất         | Kết quả giao dịch (thuế, lỗi)                                                                                                                                                                                                                             |
| 80           | `mail_list`              | C→S       | L   | S            | Đề xuất         | Xin danh sách thư                                                                                                                                                                                                                                         |
| 81           | `mail_list_result`       | S→C       | L   | S            | Đề xuất         | Danh sách thư                                                                                                                                                                                                                                             |
| 82           | `mail_read`              | C→S       | L   | S            | Đề xuất         | Đánh dấu đã đọc                                                                                                                                                                                                                                           |
| 83           | `mail_claim`             | C→S       | L   | S            | Đề xuất         | `requestId, mailId` – nhận đính kèm (1 giao dịch Economy)                                                                                                                                                                                                 |
| 84           | `mail_claim_result`      | S→C       | L   | S            | Đề xuất         | Kết quả nhận thư                                                                                                                                                                                                                                          |
| 90           | `craft_start`            | C→S       | L   | S            | Đề xuất         | `requestId`, công thức, nguyên liệu                                                                                                                                                                                                                       |
| 91           | `craft_result`           | S→C       | L   | S            | Đề xuất         | Kết quả chế tạo (roll phía server)                                                                                                                                                                                                                        |
| 60           | `char_state`             | S→C       | L   | S            | D76             | `stage u8, flags u8 (bit0 đang đả tọa, bit1 sẵn sàng đột phá, bit2 tầng cuối), nFail u8, rootType u8, elements u8 (mask kim..thổ), mutation u8, karma+1000 u16, tuVi f64, tuViReq f64`; gửi khi vào game, khi đổi tầng/cờ và ~1 Hz khi đang đả tọa        |
| 61           | `breakthrough_start`     | C→S       | L   | S            | D76             | Ý định đột phá: `requestId 16 B` (đan/trận chưa có); server tự chọn tiểu/đại cảnh                                                                                                                                                                         |
| 62           | `breakthrough_result`    | S→C       | L   | S            | D76             | `requestId 16 B, outcome u8 (1 thành công, 2 thất bại, 3 bị từ chối), kind u8 (0/1 tiểu/2 đại), reason u8, fromStage u8, toStage u8, chance u16 (1/10000), nFail u8`; roll phía server, ghi `roll_log`                                                    |
| 63           | `meditate_start`         | C→S       | L   | S            | D76             | Ý định đả tọa: `requestId 16 B`; server từ chối khi đang di chuyển/chiến đấu/đã chết                                                                                                                                                                      |
| 64           | `meditate_stop`          | C→S       | L   | S            | D76             | Ý định dừng đả tọa: `requestId 16 B` (idempotent)                                                                                                                                                                                                         |
| 65           | `meditate_result`        | S→C       | L   | S            | D76             | `requestId 16 B, meditating u8, reason u8` (`ProgressionReason`); đúng một kết quả cho mỗi lệnh                                                                                                                                                           |
| 66           | `inv_state`              | S→C       | L   | S            | D79             | Toàn bộ túi đồ + ví + hàng chờ (xem ghi chú D79 dưới bảng)                                                                                                                                                                                                |
| 67           | `inv_cmd`                | C→S       | L   | S            | D79             | Ý định về túi: `requestId 16 B, op u8, from u8, to u8`                                                                                                                                                                                                    |
| 68           | `inv_result`             | S→C       | L   | S            | D79             | `requestId 16 B, op u8, reason u8, count u8`                                                                                                                                                                                                              |
| 100–119      | `sect_*`                 | Hai chiều | L   | S            | Đề xuất         | **Khối id dành riêng** cho tông môn; từng thông điệp được gán id riêng khi docs game design chốt, mỗi bố cục một id                                                                                                                                       |
| 120–139      | `quest_*`                | Hai chiều | L   | S            | Đề xuất         | **Khối id dành riêng** cho nhiệm vụ; cùng quy tắc một id/bố cục                                                                                                                                                                                           |
| 128 (`0x80`) | `pb` (phong bì Protobuf) | Hai chiều | L   | S            | Đề xuất         | `[ver][0x80][msgId u16][bytes]`. `msgId` thuộc **không gian id riêng** của họ Lạnh (các id ≥ 30 ở bảng này); `type` byte 1–127 dành cho họ Nóng                                                                                                           |
| 150          | `telemetry_batch`        | C→S       | L   | S            | Đề xuất         | Lô sự kiện telemetry của client theo envelope docs/17 §3.2 (≤ 50 sự kiện hoặc 10 s, ≤ 16 KB), chỉ trong phiên đã `hello`; trước đăng nhập dùng `POST /telemetry`                                                                                          |

**Quy tắc id:** mỗi bố cục thông điệp có **đúng một** id (`type` cho họ Nóng, `msgId` trong `pb` cho họ Lạnh); `validateMessage` và vector vàng ([§3](#3-phiên-bản-và-tương-thích)) tra theo id đó. Khối id dành riêng chỉ được dùng sau khi mỗi thông điệp được ghi thành một dòng riêng. `0x80` = 128 ở mọi chỗ trong tài liệu.

Ghi chú: mọi thông điệp C→S là **ý định**; không có thông điệp "đặt vị trí", "báo trúng", "cấp vật phẩm" (nguyên tắc P1, [20 §1](20-kien-truc-tong-the.md)). Nội dung chi tiết nhiệm vụ/tông môn/PvP phụ thuộc docs game design (10–19); bảng này chỉ giữ chỗ và quy ước.

> **[Cập nhật D76]** Các id 60-65 dùng phong bì họ Lạnh `[ver][0x80][msgId u16][thân]` nhưng thân là bố cục nhị phân cố định (big-endian, giải mã chặt, không byte thừa) cho tới khi có pipeline Protobuf; thêm `msgId` là additive nên không tăng `PROTOCOL_VERSION` (hiện 2 do D74). Hiện thực: `packages/protocol/src/progression.ts`.

> **[Cập nhật D79]** Các id 66-68 (túi đồ, `packages/protocol/src/inventory.ts`) cùng phong bì họ Lạnh; id 69 để dành. `inv_state`: `slotCount u8`, ví 3 × `f64` (Linh thạch hạ/trung/thượng), từng ô (`0` trống · `1` xếp chồng `defId u16, quality u8, qty u16` · `2` instance `defId u16, quality u8, durability u16 (×100), bound u8`), `pendingCount u8` + mục `defId u16, quality u8, qty u16`; gửi khi vào game và sau mỗi thay đổi, tối đa một lần mỗi tick. `inv_cmd`: `op` 1 = chuyển / hoán đổi / gộp ô, 2 = nhận hàng chờ (from = to = 0); phát lại cùng `requestId` trả đúng kết quả cũ. `inv_result.reason` (`InvReason`): 0 ok, 1 ô sai, 2 ô trống, 3 quá nhanh, 4 chưa sẵn sàng, 5 không chuyển được; `count` = số mục hàng chờ đã chuyển. `PROTOCOL_VERSION` lên **4** (một lần tăng chung với việc nối lại, D79). Không có trường giá, cửa hàng hay tiền thật.

> **[Cập nhật D82]** `hello` (JSON) có thêm `classId` tùy chọn (chuỗi `PathId` hoặc id dây 1..6; sai giá trị: `BadMessage`), dùng chỉ khi nhân vật chưa tồn tại; `hello_ack` có `classId` (id dây của lớp server giữ). `EnterEntity.defId` của người chơi (kind 0) mang id lớp 1..6 (0 = không rõ), của quái vẫn là id định nghĩa quái: không đổi bố cục `aoi_enter`, không tăng `PROTOCOL_VERSION`. Hiện thực: `apps/server/src/gateway.ts`, `packages/shared/src/classes.ts`.

### 5.1 Quy tắc ứng dụng

- **Lệnh có tác dụng phụ** (`inv_cmd`, `market_*`, `craft_*`, `breakthrough_*`) mang `requestId` (UUIDv7 do client sinh) → ánh xạ thành khóa idempotency; gửi lại sau mất kết nối là an toàn ([26 §4](26-kinh-te-ledger.md)). Server trả đúng kết quả cũ cho cùng `requestId`.
- **Lệnh khác** (di chuyển, chat) không cần idempotent; di chuyển có `seq` và bị loại nếu cũ/trùng.
- **Phản hồi bắt buộc:** mọi `*_cmd` nhận đúng một `*_result` hoặc `error`, kể cả khi bị từ chối.
- **Không tin client:** trường `qty`, `price` được kiểm tra phạm vi và so khớp với trạng thái server; id lạ → `NOT_FOUND`, không tiết lộ tồn tại của đối tượng của người khác.
- **Gộp:** sát thương gộp 100 ms/mục tiêu; `buff_update` và `inv_delta` gộp trong cùng tick.

## 6. Snapshot, ACK và đồng bộ (tóm tắt, theo 08 §5, §8)

- Client ghi số `seq` snapshot nhận gần nhất vào `ack` của mọi gói `input`; server mã hóa delta dựa trên snapshot đó; quá 1 s không có ACK → gửi **trạng thái đầy đủ** (`flags` đánh dấu).
- `self` block (19 B) mang `lastSeq` và trạng thái chuyển động để client chạy lại input chờ (đối soát). Vị trí `float32`; sai lệch ≤ 1e-5 ô ở bản đồ 256 ô (PR #10). **v3 (D78):** bit 2 của byte cờ `self` báo có `vitals` (5 × u32 = 20 B: `hp, hpMax, mp, mpMax, shield`); server chỉ gửi khi giá trị đổi so với lần gửi gần nhất cho client đó, hoặc ở snapshot đầy đủ / resync. **v3 (D78):** bit 2 của byte cờ `self` báo có `vitals` (5 × u32 = 20 B: `hp, hpMax, mp, mpMax, shield`); server chỉ gửi khi giá trị đổi so với lần gửi gần nhất cho client đó, hoặc ở snapshot đầy đủ / resync.
- Tần số theo vùng: 20 / 10 / 5 Hz [Cập nhật D73: vùng theo khoảng cách ô 10 / 25, trần 40 thực thể ở 20 Hz, bỏ bản ghi không đổi; định dạng dây không đổi], luôn 20 Hz cho đồng đội, mục tiêu đang chọn, kẻ tấn công mình (`NETWORK.UPDATE_HZ_*`).
- Bản ghi thực thể: `chỉ số 10 · tuyệt đối 1 · (Δi s8+Δj s8 | qi 16+qj 16) · anim 6 · hướng 3 · hasHp 1 · [hp% 7]` = 37–44 bit (PR #10 thêm 1 bit "tuyệt đối" so với 36–43 bit của 08; sai khác này được ghi ở [OPEN-ITEMS, mục "Design C (20–29)"](OPEN-ITEMS.md)).
- **Hướng 3 bit = 8 hướng** để chứa cả hướng đã lật gương và animation bất đối xứng (D14); client suy ra phần lật từ hướng.

## 7. Rate limit và bảo vệ

Token bucket theo kết nối **và** theo tài khoản (cùng một tài khoản mở nhiều kết nối không nhân hạn mức). Giá trị mặc định là **đề xuất** (hiệu chỉnh bằng dữ liệu), trừ những giá trị 08 đã nêu.

| Loại                                   | Hạn mức                                                   | Quá hạn mức                                                                   | Nguồn      |
| -------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| `input`                                | ≤ 30 gói/s (PC), ≤ 20 gói/s (Mobile/Web) + dung sai 1,25× | Bỏ gói; điểm vi phạm; xem ngân sách thời gian [25 §7](25-xac-thuc-bao-mat.md) | 08 §4, §6  |
| `skill_cast`                           | **10 gói/s**                                              | Bỏ gói                                                                        | 08 §6      |
| `target_select`, `cast_cancel`         | 20/s                                                      | Bỏ gói                                                                        | Đề xuất    |
| `inv_cmd`                              | 10/s, bùng nổ 20                                          | `error{RATE_LIMITED}`                                                         | Đề xuất    |
| `chat_send`                            | Thế giới: 1/5 s; tông môn/đội: 1/s; riêng: 1/2 s          | `error{RATE_LIMITED}`, tin bị bỏ                                              | Đề xuất    |
| `market_search`                        | 2/s                                                       | `error`                                                                       | Đề xuất    |
| `market_list`, `market_buy`, `trade_*` | 3/s                                                       | `error`                                                                       | Đề xuất    |
| `telemetry_batch`                      | 1 lô/10 s, ≤ 16 KB; quá hạn thì bỏ                        | Bỏ                                                                            | docs/17 §2 |
| `ping`                                 | 1/s                                                       | Bỏ                                                                            | Đề xuất    |
| Tổng byte C→S                          | ≤ 4 KB/s (dài hạn), bùng nổ 16 KB                         | Đóng kết nối nếu kéo dài > 10 s                                               | Đề xuất    |
| Kết nối mới theo IP                    | 20/phút; tối đa 5 kết nối đồng thời/IP                    | Từ chối                                                                       | Đề xuất    |
| Gói sai định dạng liên tiếp            | 3                                                         | Đóng kết nối (mã 4008)                                                        | Đề xuất    |

Vi phạm cộng vào điểm nghi vấn chung (cảnh báo 20, ngắt 50, giảm 1/phút – 08 §6). Chống phát lại: `seq` + mã phiên (08 §6).

## 8. Mã lỗi

`error{code u16, text}`; `text` chỉ để gỡ lỗi, UI dùng bảng mã ở client (đa ngôn ngữ).

| Dải       | Nhóm             | Ví dụ                                                                                                                                          |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1000–1099 | Giao thức        | `VERSION_MISMATCH` 1001, `MALFORMED` 1002, `FRAME_TOO_LARGE` 1003, `UNKNOWN_TYPE` 1004                                                         |
| 1100–1199 | Phiên / xác thực | `TOKEN_EXPIRED` 1101, `TOKEN_INVALID` 1102, `SESSION_REVOKED` 1103, `LOGIN_ELSEWHERE` 1104, `BANNED` 1105                                      |
| 1200–1299 | Giới hạn         | `RATE_LIMITED` 1201, `SLOW_CONSUMER` 1202, `SERVER_FULL` 1203                                                                                  |
| 2000–2099 | Chiến đấu        | Các giá trị `CastReason` của `@vgtd/sim` (hồi chiêu, thiếu Chân Nguyên, ngoài tầm, không có đường ngắm, bị khống chế…)                         |
| 3000–3099 | Túi đồ / kinh tế | `INSUFFICIENT_FUNDS` 3001, `ITEM_NOT_FOUND` 3002, `BAG_FULL` 3003, `LISTING_GONE` 3004, `IDEMPOTENCY_MISMATCH` 3005, `PRICE_OUT_OF_RANGE` 3006 |
| 4000–4099 | Chat             | `MUTED` 4001, `FILTERED` 4002                                                                                                                  |
| 5000–5099 | Thế giới         | `MAP_FULL` 5001, `NOT_IN_WORLD` 5002                                                                                                           |
| 9000–9999 | Nội bộ           | `INTERNAL` 9000 (không lộ chi tiết)                                                                                                            |

## 9. Kích thước so với ngân sách băng thông

Ngân sách ([00 §3](00-ho-so-tong-hop.md), 08 §8): **~8 KB/s** đánh quái · **~13 KB/s** chợ đông · **~25 KB/s** chiến tranh; chiều lên < 1 KB/s. Số liệu đo từ PR #10 (chỉ snapshot, 20 tick, 5,2–5,6 B/thực thể gồm header và khối `self`):

| Tình huống                       | Thực thể gần/giữa/xa | Snapshot (PR #10, đã đo) | Sự kiện + header (08, ước lượng) | Tổng ước tính | Ngân sách | Dư địa    |
| -------------------------------- | -------------------- | ------------------------ | -------------------------------- | ------------- | --------- | --------- |
| Đánh quái dã ngoại               | 30 / 20 / 20         | 4,9 KB/s                 | ~2 KB/s                          | ~6,9 KB/s     | 8         | ~1,1 KB/s |
| Chợ tông môn đông (trần 120)     | 60 / 40 / 20         | 8,7 KB/s                 | ~3 KB/s                          | ~11,7 KB/s    | 13        | ~1,3 KB/s |
| Chiến tranh 100 v 100 (trần 120) | 60 / 40 / 20         | 8,7 KB/s                 | ~10–14 KB/s                      | ~19–23 KB/s   | 25        | ~2–6 KB/s |

**Cảnh báo về cách tính:** (1) các con số 08 và PR #10 là **tải trọng ứng dụng**, chưa gồm tiêu đề WebSocket (2–4 B/khung S→C) và TCP/TLS (khoảng 40–80 B/gói TCP; ~+10–15% với gói nhỏ 20 Hz); khi tính dung lượng thực tế (hóa đơn dữ liệu di động) cần cộng thêm — ngân sách trong 00 §3 **chưa nói rõ có gồm phần này**, xem Q4. (2) Phần "sự kiện + header" mới là ước lượng của tài liệu gốc và **chưa có phép đo**; mục tiêu đo bằng loadbot 100 v 100 ([28 §6](28-chien-luoc-kiem-thu.md)).

Ngân sách theo thông điệp (đề xuất, dùng để kiểm thử "không vượt"):

| Thông điệp                   | Kích thước mục tiêu                  | Tần suất                               | Chiều  |
| ---------------------------- | ------------------------------------ | -------------------------------------- | ------ |
| `input` (1 / 3 input)        | 10 B / 20 B                          | 20–30 Hz                               | Lên    |
| `snapshot`                   | 13 B + ~5 B × thực thể (≤ 120 / 200) | 20 Hz (vùng gần), 10/5 Hz              | Xuống  |
| `aoi_enter`                  | 2 B + 20 B × thực thể mới            | Theo sự kiện, ≤ 5/s                    | Xuống  |
| `skill_result`               | 14 B + 7 B × số đòn trúng            | Theo sự kiện                           | Xuống  |
| `telegraph_start` / `_end`   | 20 B / 5 B                           | Theo đòn của quái (~49 B/s ở giữa bầy) | Xuống  |
| `damage_batch`               | ≤ 3 B + 7 B × mục tiêu               | ≤ 10 Hz                                | Xuống  |
| `chat_msg`                   | ≤ 320 B (nén tùy chọn)               | Theo kênh                              | Xuống  |
| `inv_snapshot`               | ≤ 8 KB (túi 100 ô); gửi khi vào game | Hiếm                                   | Xuống  |
| `inv_delta`, `market_result` | ≤ 128 B                              | Theo thao tác                          | Xuống  |
| Khung tối đa                 | 16 KB                                | —                                      | Cả hai |

Chiều lên: input 30 Hz × 10 B = 300 B/s (+ header WS 6–8 B/khung với mặt nạ) < 1 KB/s như yêu cầu.

## 10. Kiểm thử giao thức (tóm tắt; chi tiết [28 §3](28-chien-luoc-kiem-thu.md))

- Hồi quy bằng vector vàng; round-trip ngẫu nhiên; fuzz (đã có 50.000 buffer ngẫu nhiên trong PR #10); chỉ `ProtocolError` được ném.
- `buf breaking` cho họ Lạnh; kiểm kích thước tối đa mỗi thông điệp theo bảng trên.
- Thử nghiệm mạng xấu (mất gói 5%, trễ 300 ms, jitter) với bộ giả lập trong test tích hợp.

## Câu hỏi cần chốt

Đã gộp vào [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md), nguồn duy nhất của câu hỏi mở: cột "Câu hỏi" ở đó ghi ID nguồn đã gộp (24 Q1–Q7). Nội dung gốc của mục này nằm trong lịch sử git.
