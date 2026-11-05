# Vận hành và quan sát (Observability)

> **Trạng thái:** thiết kế kỹ thuật. Mục "Đề xuất – chờ duyệt" chưa có hiệu lực cho tới khi vào [DECISIONS.md](DECISIONS.md). Mảng "Đo lường (telemetry, dashboard KPI)" chưa có tài liệu game design ([OPEN-ITEMS §3](OPEN-ITEMS.md)); tài liệu **docs/17** (đo lường, do nhóm game design viết song song) chưa có khi viết bản này. Phần telemetry sản phẩm ở §4 chỉ định **hạ tầng** (đường ống, định dạng sự kiện, quyền riêng tư); **danh mục sự kiện và KPI sản phẩm** sẽ lấy từ docs/17 khi có, và phải được đối chiếu lại ở lần cập nhật sau (Q1).
>
> **Phạm vi MVP:** chạy cục bộ (docker-compose profile `obs`, [20 §6](20-kien-truc-tong-the.md)); không có môi trường phát hành, không CD.

## 1. Nguyên tắc

| #   | Nguyên tắc                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------- |
| O1  | Một định danh tương quan (`traceId`) đi từ client → Gateway → World/Economy → log và metric                    |
| O2  | Quan sát **không** nằm trong đường nóng của tick: ghi vào bộ đệm vòng, xuất ở luồng chính/job nền              |
| O3  | Không bao giờ log bí mật (mật khẩu, token, khóa) hay dữ liệu cá nhân thô; che trường nhạy cảm tại điểm ghi     |
| O4  | Mã mô phỏng không đọc đồng hồ để quyết định logic; đồng hồ chỉ dùng để đo (rìa) – skill `vgtd-sim-determinism` |
| O5  | Mọi ngân sách trong [00 §3](00-ho-so-tong-hop.md) có một chỉ số đo được và một ngưỡng cảnh báo                 |
| O6  | Công cụ cục bộ nhẹ: bật theo profile, mặc định tắt                                                             |

## 2. Log

**Đề xuất – chờ duyệt (ADR-018):** log có cấu trúc JSON một dòng bằng **pino**; ghi ra `stdout`; thu bằng **Loki** (cục bộ qua Promtail/Alloy), xem trong Grafana.

| Trường                    | Ý nghĩa                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `ts`                      | RFC 3339 UTC (đồng hồ rìa)                                                        |
| `level`                   | `trace`, `debug`, `info`, `warn`, `error`, `fatal`                                |
| `msg`                     | Thông điệp ngắn, không nội suy dữ liệu động vào chuỗi cố định (dùng trường riêng) |
| `module`                  | `gateway`, `auth`, `world`, `zone`, `economy`, `chat`, `platform`                 |
| `traceId`, `spanId`       | Tương quan với trace                                                              |
| `accountId`/`characterId` | UUID (đã là mã không đoán được); IP **cắt octet cuối** hoặc băm có muối           |
| `tick`                    | Số tick (với log của World Node)                                                  |
| `err`                     | `{type, message, stack}`; stack chỉ ở `error`/`fatal`                             |

- **Mức log mặc định:** `info`; `debug` bật theo module bằng cờ cấu hình, **không** bật trong đường nóng của tick; log theo từng gói input/snapshot bị cấm ở `info`.
- **Lấy mẫu:** sự kiện lặp (gói sai định dạng, rate limit) gộp theo khóa trong 10 s với bộ đếm.
- **Che dữ liệu (redaction):** danh sách đường dẫn che cấu hình sẵn (`*.password`, `*.token`, `*.refreshToken`, `req.headers.authorization`, cookie, **`*.seed`, `*.rngSeed`, `*.rngState`** của luồng roll kinh tế; chỉ cho phép `seedId`).
- **Log kiểm toán** (đăng nhập, GM, can thiệp kinh tế) ghi vào bảng `audit_log` ([23](23-mo-hinh-du-lieu.md)), **không** chỉ vào file; log ứng dụng không thay thế.
- **Lưu giữ cục bộ:** Loki 7 ngày (dev). Hạn lưu thật: chờ chốt (Q5); log chứa mã định danh phải theo [23 §7](23-mo-hinh-du-lieu.md).

## 3. Metric

**Đề xuất – chờ duyệt (ADR-018):** `prom-client` (Prometheus text) trên cổng quản trị `/metrics` (tách khỏi cổng game), Prometheus thu mỗi 5 s (cục bộ), Grafana hiển thị. Quy ước tên: `vgtd_<module>_<đại lượng>_<đơn vị>`; nhãn ít chiều (tránh `characterId` làm nhãn).

### 3.1 Chỉ số cốt lõi theo ngân sách

| Chỉ số                                                         | Loại              | Ngưỡng / mục tiêu (nguồn)                                        | Cảnh báo                                          |
| -------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `vgtd_world_tick_duration_ms` (histogram, nhãn `phase`)        | histogram         | p99 ≤ 45 ms; tổng pha ≤ 42 ms ([22 §3.4](22-server-modules.md))  | p99 > 45 ms 1 phút                                |
| `vgtd_world_tick_overrun_total`                                | counter           | 0 ở tải mục tiêu                                                 | > 0 liên tục 5 s                                  |
| `vgtd_world_entities` (gauge, nhãn `kind`)                     | gauge             | ≤ ~1.000 (giả thiết)                                             | > 80% trần                                        |
| `vgtd_world_aoi_duration_ms`                                   | histogram         | ≤ 8 ms mỗi lượt AOI                                              | p99 > 8 ms                                        |
| `vgtd_gateway_connections` (gauge)                             | gauge             | ≤ trần CCU                                                       | > 90% trần                                        |
| `vgtd_gateway_downstream_bytes_per_s` (histogram theo kết nối) | histogram         | 8 / 13 / 25 KB/s theo tình huống ([00 §3](00-ho-so-tong-hop.md)) | p95 vượt ngân sách tình huống                     |
| `vgtd_gateway_upstream_bytes_per_s`                            | histogram         | < 1 KB/s (08 §8)                                                 | p95 > 1 KB/s                                      |
| `vgtd_gateway_send_queue_bytes`                                | histogram         | —                                                                | Số kết nối bị `SLOW_CONSUMER`                     |
| `vgtd_gateway_rate_limited_total{type}`                        | counter           | —                                                                | Tăng đột biến                                     |
| `vgtd_anticheat_violation_total{kind}`                         | counter           | Điểm 20 cảnh báo / 50 ngắt (08 §6)                               | Tỷ lệ ngắt kết nối tăng                           |
| `vgtd_anticheat_disconnect_total{reason}`                      | counter           | —                                                                | —                                                 |
| `vgtd_economy_tx_duration_ms{reason}`                          | histogram         | p95 ≤ 30 ms, p99 ≤ 100 ms (giả thiết)                            | p99 > 100 ms                                      |
| `vgtd_economy_invariant_violation_total`                       | counter           | **0**                                                            | > 0 → đóng băng ([26 §3.3](26-kinh-te-ledger.md)) |
| `vgtd_economy_idempotency_replay_total`                        | counter           | —                                                                | Tăng bất thường (client lỗi?)                     |
| `vgtd_economy_faucet_sink_ratio` (gauge, theo tuần)            | gauge             | 0,9–1,0 ([00 §3](00-ho-so-tong-hop.md))                          | Theo [26 §7.2](26-kinh-te-ledger.md)              |
| `vgtd_auth_login_total{result}`, `…_hash_ms`                   | counter/histogram | p95 băm ≈ 80–150 ms (mục tiêu)                                   | Thất bại > 20% / IP đột biến                      |
| `vgtd_db_pool_*`, `vgtd_db_query_duration_ms`                  | gauge/histogram   | —                                                                | Hàng đợi pool > 0 kéo dài                         |
| `nodejs_eventloop_lag_seconds`, `nodejs_gc_*`, heap            | mặc định          | Lag luồng chính p99 ≤ 20 ms (giả thiết)                          | p99 > 50 ms                                       |
| `vgtd_chat_messages_total`, `…_filtered_total`                 | counter           | —                                                                | —                                                 |

### 3.2 Metric phía client (qua telemetry – §4)

`frame_time_ms` p50/p95/p99, `draw_calls` (theo lớp), `texture_mem_mb`, `js_heap_mb`, `spine_active`, `rtt_ms`, `jitter_ms`, `recon_error_tiles`, `chunk_load_ms`, `time_to_interactive_ms`, theo nhãn `platform`, `deviceTier`, `gpu` ([21 §10](21-kien-truc-client.md)).

## 4. Đường ống telemetry

```mermaid
flowchart LR
  C["Client<br/>Telemetry SDK (tầng 2)"] -- "lô JSON/MsgPack nén, 60 s hoặc 50 sự kiện" --> GW["POST /telemetry (Gateway)"]
  S["Server modules<br/>EventBus topics"] --> TP
  GW --> V["Xác thực schema + giới hạn kích thước + loại PII"]
  V --> TP["Telemetry pipeline<br/>(hàng đợi trong bộ nhớ)"]
  TP --> L[("Loki<br/>sự kiện kỹ thuật")]
  TP --> PG[("PostgreSQL schema telemetry<br/>sự kiện sản phẩm – sau MVP có thể ClickHouse")]
  TP --> M["Prometheus (đếm/histogram)"]
```

- **Hai loại dữ liệu:** (1) _telemetry kỹ thuật_ (hiệu năng, lỗi, mạng) – lấy mẫu 1–5% phiên, mục đích vận hành; (2) _telemetry sản phẩm_ (hành vi người chơi, KPI) – danh mục theo docs/17 khi có.
- **Định dạng sự kiện:** `{v, name, ts (ms, đồng hồ client đã hiệu chỉnh), sessionId (ngẫu nhiên, không phải accountId), props{…}}`; bản đồ `name → schema` nằm ở `packages/shared` hoặc `packages/protocol` (một nguồn); server **loại** sự kiện không có trong danh mục.
- **Quyền riêng tư:** không gửi nội dung chat, mật khẩu, vị trí chính xác lâu dài; `accountId` chỉ gắn phía server khi cần; người chơi có tùy chọn tắt telemetry sản phẩm (tuân thủ thông báo quyền riêng tư – Q4); telemetry kỹ thuật tối thiểu luôn bật nhưng ẩn danh.
- **Chống lạm dụng:** `POST /telemetry` có rate limit (6 lô/phút/phiên), tối đa 64 KB/lô, bỏ qua nếu hàng đợi đầy (không chặn game); client không thử lại quá 3 lần.
- **Lưu giữ:** Loki 7 ngày cục bộ; bảng PG telemetry 90 ngày (đề xuất, chờ docs/17); tổng hợp lâu hơn dạng số liệu.
- **Đồng bộ với docs/17:** khi docs/17 có, thêm bảng ánh xạ `sự kiện KPI → tên sự kiện kỹ thuật` ở đây và kiểm tra bằng test schema rằng mọi sự kiện trong docs/17 có bản ghi trong danh mục.

## 5. Trace (vết phân tán)

- **OpenTelemetry SDK** (Node): span cho HTTP `/auth/*`, giao dịch Economy (theo `reason`), truy vấn DB, nối WS, thao tác `join`/`leave`; **không** tạo span cho từng gói input hay từng tick (chi phí); thay vào đó dùng histogram pha tick.
- Lan truyền ngữ cảnh: `traceparent` ở HTTP; với WS, `traceId` ngắn (8 byte) trong `hello_ack` và gắn vào log của kết nối; lệnh Economy từ World mang `traceId` của yêu cầu gốc.
- Xuất OTLP tới **OTel Collector** → **Tempo** (cục bộ). Lấy mẫu: 100% ở dev; `ParentBased(TraceIdRatio 0,05)` khi tải thật, luôn giữ span lỗi.
- Quy ước tên span: `module.operation` (ví dụ `economy.buy`, `auth.login`).

## 6. Dashboard cục bộ (Grafana, nạp sẵn bằng provisioning)

| Dashboard                 | Nội dung                                                                                                       | Dùng khi                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Game Server Health**    | Tick p50/p95/p99 theo pha, số thực thể, lag event loop, GC, kết nối, băng thông xuống/lên theo tình huống      | Mọi phiên dev/loadbot                                  |
| **Network**               | RTT, jitter, mất gói (từ client), kích thước snapshot, tỷ lệ delta/full, `SLOW_CONSUMER`, rate limit           | Kiểm thử mạng xấu ([28 §6](28-chien-luoc-kiem-thu.md)) |
| **Economy**               | Giao dịch/giây, độ trễ, tỷ lệ idempotency replay, **faucet/sink theo kênh**, CPI, τ, tổng Linh thạch, bất biến | Mô phỏng và closed beta                                |
| **Security / Anti-cheat** | Đăng nhập thất bại theo IP, khóa tạm, vi phạm theo loại, ngắt kết nối, hàng đợi xem xét                        | Vận hành                                               |
| **Client Performance**    | Frame time, draw call, bộ nhớ, TTI theo thiết bị/nền tảng                                                      | Ma trận thiết bị ([28 §7](28-chien-luoc-kiem-thu.md))  |
| **Release Gate**          | Ba cảnh chuẩn (chợ 50, Lôi Kiếp, 100 v 100): draw call, băng thông, tick                                       | Trước khi phát hành                                    |

Cảnh báo (Alertmanager hoặc Grafana alerting) ở MVP gửi vào **thông báo cục bộ/log** – không có kênh ngoài; ngưỡng ở §3.1. SLO khởi điểm (chờ chốt, Q3): tỷ lệ tick ≤ 50 ms ≥ 99,9%; độ sẵn sàng đăng nhập ≥ 99% trong khung giờ test; giao dịch Economy thành công (không tính từ chối hợp lệ) ≥ 99,9%.

## 7. Báo cáo lỗi

| Nguồn                                   | Cách làm (MVP)                                                                                                                                                                                                                | Sau MVP                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Server (ngoại lệ chưa bắt, worker chết) | `process.on('uncaughtException'/'unhandledRejection')` → log `fatal` + metric + thoát có kiểm soát (trình giám sát khởi động lại); worker chết → khởi động lại ([22 §3.7](22-server-modules.md))                              | Sentry/GlitchTip                  |
| Client                                  | `window.onerror`, `unhandledrejection`, lỗi bên trong `Renderer` → `Telemetry.error` (có **ring buffer 5 MB** các `Action` gần nhất, bản dựng, thiết bị, trạng thái FSM) → `POST /telemetry` loại `error`, gom theo băm stack | Sentry (self-host) kèm source map |
| Lỗi giao thức                           | `ProtocolError` → `error` gửi client + log `warn` có hexdump ≤ 64 byte                                                                                                                                                        | —                                 |
| Lỗi dữ liệu tĩnh                        | Kiểm tra schema khi khởi động; lỗi → không khởi động                                                                                                                                                                          | —                                 |

Đề xuất – chờ duyệt: MVP **không** triển khai Sentry cục bộ (tốn tài nguyên); dùng đường telemetry + Loki và nhóm lỗi theo băm stack; đánh giá lại khi có người thử nghiệm thật (Q2).

## 8. Cấu hình và cờ tính năng

### 8.1 Cấu hình

- **Lớp cấu hình** (ưu tiên tăng dần): mặc định trong mã → tệp `config/<env>.json` → biến môi trường `VGTD_*` → cờ dòng lệnh. Kiểm tra bằng **schema** (JSON Schema/zod) khi khởi động; sai → không khởi động.
- **Môi trường:** `dev` (cục bộ), `test` (CI/integration), `loadtest`; (`prod` ngoài phạm vi MVP).
- **Phân loại:** (a) hạ tầng (cổng, DSN, pool) – chỉ qua env; (b) vận hành (rate limit, ngưỡng) – đọc lại khi nhận tín hiệu/endpoint admin; (c) **dữ liệu cân bằng** (hệ số kinh tế, drop) – tệp dữ liệu có `dataVersion`, nạp lại không cần phát hành client ([07 §7](07-cong-thuc-data-schema.md)).
- Bí mật chỉ qua env/tệp `.env` không commit; có `.env.example`.

### 8.2 Cờ tính năng (feature flags)

**Đề xuất – chờ duyệt (ADR-018):** hệ cờ tự viết, đơn giản, trong `platform`:

| Thuộc tính             | Thiết kế                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lưu                    | Tệp `flags.json` (đọc lại khi đổi) + bản ghi ghi đè trong PG khi cần chỉnh nóng; Redis bản sao khi bật                                                                                 |
| Dạng                   | `{key, enabled, rollout (0–100), allow[], deny[], description, owner, expires}`; `rollout` quyết bằng băm `(key, accountId)` **xác định** (không `Math.random`)                        |
| Đánh giá               | `Flags.isOn(key, ctx)` – nhanh, không I/O; kết quả gửi cho client trong `hello_ack` (cờ dành cho client)                                                                               |
| **Quy tắc quan trọng** | **Không** dùng cờ để đổi hành vi của `step()`/công thức mà client dự đoán nếu không kèm tăng phiên bản dữ liệu; cờ chỉ bật tính năng, không đổi kết quả mô phỏng giữa client và server |
| Loại cờ                | `release` (bật dần, có hạn), `ops` (công tắc ngắt khẩn: tắt chợ, tắt chat Thế giới, tắt đột phá), `experiment` (sau MVP)                                                               |
| Quản lý nợ             | Mỗi cờ có `expires`; CI cảnh báo cờ quá hạn                                                                                                                                            |
| Công tắc ngắt          | `ops.market.enabled`, `ops.chat.world`, `ops.economy.writes` (đóng băng ghi), `ops.login.enabled`: kiểm tra ở đầu cổng module                                                          |

## 9. Sổ tay vận hành tối thiểu (runbook) cho MVP

| Tình huống                       | Kiểm tra đầu tiên                                       | Hành động                                                     |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Tick chậm                        | Dashboard Game Server Health → pha nào                  | Giảm tải (flag), kiểm GC, ghi hồ sơ CPU (`--cpu-prof`)        |
| Người chơi báo mất đồ / nhân đôi | `audit_log`, `ledger_tx` theo `characterId`, `roll_log` | Truy vết theo `requestId`; sửa bằng `GM_ADJUST` có duyệt      |
| Tăng đột biến đăng nhập thất bại | Dashboard Security                                      | Tăng ngưỡng khóa, chặn IP/ASN tạm                             |
| Bất biến sổ cái vi phạm          | Cảnh báo `invariant_violation`                          | Bật `ops.economy.writes=off`, điều tra, đối chiếu từ bút toán |
| PostgreSQL chậm / hết kết nối    | `vgtd_db_pool_*`                                        | Giảm tải, kiểm khóa dài, khởi động lại có kiểm soát           |

## Câu hỏi cần chốt

| #   | Câu hỏi                                                                               | Mặc định đề xuất                                                         |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Q1  | Đối chiếu danh mục sự kiện/KPI với docs/17 khi có (hiện chưa có)                      | Cập nhật bản sau; hạ tầng ở đây độc lập danh mục                         |
| Q2  | Không dùng Sentry cục bộ trong MVP; dùng telemetry + Loki?                            | **Có**                                                                   |
| Q3  | SLO khởi điểm (tick ≤ 50 ms 99,9%, v.v.)?                                             | **Có** làm khởi điểm; chốt sau loadbot                                   |
| Q4  | Chính sách quyền riêng tư: telemetry sản phẩm mặc định bật hay xin đồng ý (opt-in)?   | **Opt-in** cho sản phẩm; kỹ thuật ẩn danh luôn bật; cần xác nhận pháp lý |
| Q5  | Thời hạn lưu log ứng dụng (7 ngày cục bộ; môi trường thật?)                           | 7 ngày dev; 30 ngày khi có môi trường thật                               |
| Q6  | Stack quan sát: Prometheus + Grafana + Loki + Tempo + OTel Collector (profile `obs`)? | **Có**; chỉ chạy khi cần                                                 |
| Q7  | Hệ cờ tính năng tự viết thay vì dịch vụ ngoài?                                        | **Có** cho MVP                                                           |
