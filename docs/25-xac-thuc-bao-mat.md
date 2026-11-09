# Xác thực và bảo mật

> **Trạng thái:** thiết kế kỹ thuật. Mục "Đề xuất – chờ duyệt" chưa có hiệu lực cho tới khi vào [DECISIONS.md](DECISIONS.md). Anti-cheat dựa trên [08 §6](08-server-architecture.md) và `@vgtd/sim` (PR #10). Giao thức: [24](24-giao-thuc-mang.md); dữ liệu: [23](23-mo-hinh-du-lieu.md); kinh tế: [26](26-kinh-te-ledger.md).
>
> **Phạm vi:** MVP dùng tên đăng nhập + mật khẩu; Google SSO là giai đoạn sau. Tài liệu này **không** thay thế đánh giá bảo mật độc lập trước khi mở công khai; các mục chưa kiểm chứng được ghi rõ.

## 1. Mục tiêu bảo mật

| #   | Mục tiêu                                                                                                  | Ưu tiên    |
| --- | --------------------------------------------------------------------------------------------------------- | ---------- |
| G1  | Không ai nhân đôi / tạo ra tài sản ngoài các đường faucet được thiết kế                                   | Cao nhất   |
| G2  | Không ai chiếm tài khoản người khác dễ dàng (nhồi thông tin đăng nhập, brute force)                       | Cao        |
| G3  | Client bị sửa/bị hack **không** đổi được kết quả game (server quyết định)                                 | Cao        |
| G4  | Server không bị làm sập bằng gói xấu / tràn kết nối                                                       | Cao        |
| G5  | Làm khó bot farming đủ để kinh tế vẫn cân bằng (tiêu hao/sinh ra 0,9–1,0 – [00 §3](00-ho-so-tong-hop.md)) | Trung bình |
| G6  | Dữ liệu cá nhân tối thiểu và được bảo vệ                                                                  | Trung bình |

## 2. Đăng nhập bằng tên đăng nhập + mật khẩu

### 2.1 Đăng ký

- Trường: `username` (3–20 ký tự `[a-z0-9_]`, không phân biệt hoa thường; không chứa từ cấm), `password`, `email` **tùy chọn** ở MVP (cần cho khôi phục mật khẩu; không có email thì không khôi phục tự động – chỉ qua hỗ trợ). Xác minh email bằng liên kết một lần (cục bộ: Mailpit – [20 §6](20-kien-truc-tong-the.md)).
- Chống đăng ký hàng loạt: giới hạn 3 tài khoản/IP/ngày ở MVP; sau MVP thêm CAPTCHA (hCaptcha/Turnstile) khi có tín hiệu lạm dụng.
- Tên nhân vật khác tên đăng nhập; tên đăng nhập **không** hiển thị cho người chơi khác (giảm nhắm mục tiêu tấn công).

### 2.2 Chính sách mật khẩu (theo NIST SP 800-63B, đề xuất – chờ duyệt, ADR-007)

| Quy tắc                                    | Giá trị                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Độ dài tối thiểu / tối đa                  | **10** / **128** ký tự (Unicode, chuẩn hóa NFKC trước khi băm)                                                                                                            |
| Quy tắc thành phần (hoa/số/ký tự đặc biệt) | **Không** bắt buộc (không có lợi, làm người chơi chọn mật khẩu yếu)                                                                                                       |
| Danh sách mật khẩu bị lộ / phổ biến        | Từ chối nếu thuộc danh sách 100.000 mật khẩu phổ biến (tệp tĩnh trong repo) hoặc trùng `username`/`email`; sau MVP có thể thêm kiểm tra k-anonymity qua dịch vụ bên ngoài |
| Đổi định kỳ                                | **Không** ép; chỉ buộc đổi khi nghi bị lộ                                                                                                                                 |
| Dán mật khẩu                               | Cho phép (hỗ trợ trình quản lý mật khẩu)                                                                                                                                  |
| Chỉ báo độ mạnh                            | Hiển thị gợi ý (không chặn ngoài các quy tắc trên)                                                                                                                        |

### 2.3 Băm mật khẩu: argon2id

| Tham số                   | Giá trị khởi đầu                                                                                                           | Ghi chú                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Thuật toán                | **argon2id**                                                                                                               | Khuyến nghị OWASP                                                                                      |
| Bộ nhớ / vòng / song song | m = 19 MiB (19456 KiB), t = 2, p = 1 là **sàn**; mục tiêu **≥ 46 MiB, t = 1, p = 1** nếu thời gian cho phép                | Hiệu chỉnh trên máy chủ thật sao cho một lần băm mất khoảng 80–150 ms; ghi tham số **trong chuỗi băm** |
| Muối                      | 16 byte ngẫu nhiên từ CSPRNG, mỗi mật khẩu một muối                                                                        | Có trong chuỗi PHC                                                                                     |
| Tiêu thụ CPU              | Chạy ở **thread pool riêng** (thư viện native chạy trên libuv pool, vd `@node-rs/argon2`); giới hạn song song ≤ số lõi − 1 | Không chặn event loop ([20 §5.1](20-kien-truc-tong-the.md))                                            |
| Nâng cấp tham số          | `hash_version` trong `credentials`; khi đăng nhập thành công mà tham số cũ hơn → băm lại và ghi                            | —                                                                                                      |
| Hạn chế tải               | Hàng đợi băm tối đa 64 yêu cầu; vượt → `503` kèm `Retry-After` (chống DoS bằng đăng nhập)                                  | Chi phí ngược: tấn công làm tốn CPU; có rate limit theo IP trước khi băm                               |
| Pepper (khóa phía server) | Tùy chọn: HMAC-SHA256 với khóa trong biến môi trường/secret manager trước khi băm                                          | Ở MVP cục bộ có thể bỏ; sau MVP cần quản lý khóa (xoay vòng)                                           |

Thư viện cụ thể (`@node-rs/argon2` hay `argon2`) cần xác nhận bằng thử nghiệm trên Windows/Linux/CI trước khi khóa. **Chưa đo** thời gian băm thật.

### 2.4 Khóa tài khoản và chống brute force

| Cơ chế                                         | Quy tắc                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Giới hạn theo IP                               | 10 lần đăng nhập thất bại / 15 phút / IP → trả `429`                                                                                                         |
| Giới hạn theo tài khoản                        | 5 lần thất bại liên tiếp → khóa tạm **tăng dần** (1 → 5 → 15 → 60 phút), đặt lại khi thành công. Không khóa vĩnh viễn (tránh bị lợi dụng để khóa người khác) |
| Phản hồi                                       | Cùng một thông báo và thời gian cho "sai tên" và "sai mật khẩu"; với tên không tồn tại vẫn chạy băm giả (hằng thời gian) để chống dò tên                     |
| Thông báo                                      | Gửi email khi đăng nhập từ thiết bị/IP lạ nếu có email (sau MVP)                                                                                             |
| Nhồi thông tin đăng nhập (credential stuffing) | Tín hiệu: nhiều tên khác nhau từ một IP/ASN, tỷ lệ thất bại cao → tăng độ trễ, CAPTCHA, chặn tạm                                                             |
| Ghi nhật ký                                    | Mọi thất bại/thành công → `audit_log` (IP, UA); cảnh báo theo ngưỡng ([27](27-van-hanh-quan-sat.md))                                                         |

## 3. Token: JWT truy cập + refresh

### 3.1 Thiết kế

| Mục                    | Quyết định (đề xuất – chờ duyệt, ADR-007)                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token           | **JWT** ký **EdDSA (Ed25519)**; hạn **10 phút**; claim: `sub` (accountId), `sid` (sessionId), `jti`, `iat`, `exp`, `ver` (token_version của tài khoản), `aud`, `iss`. Không chứa dữ liệu nhạy cảm                                               |
| Vì sao không HS256     | Ký bất đối xứng: Gateway/Chat/Economy sau này chỉ cần **khóa công khai** để xác minh, không giữ bí mật ký → khớp lộ trình tách service ([20 §8](20-kien-truc-tong-the.md))                                                                      |
| Refresh token          | **Chuỗi ngẫu nhiên 256 bit** (không phải JWT), lưu **băm SHA-256** ở `auth_sessions`; hạn trượt **30 ngày**, hạn tuyệt đối **90 ngày**                                                                                                          |
| Xoay vòng              | Mỗi lần làm mới cấp refresh mới và vô hiệu cái cũ (cùng `family_id`). Dùng lại refresh đã xoay (reuse) → coi là bị đánh cắp → **thu hồi cả họ** và buộc đăng nhập lại                                                                           |
| Nơi lưu (Web)          | Access token **chỉ trong RAM** (không `localStorage`); refresh token trong cookie `HttpOnly; Secure; SameSite=Strict` (tiền tố `__Host-`) hoặc, nếu client và API khác site, lưu trong IndexedDB với chấp nhận rủi ro XSS (cần quyết định – Q3) |
| Nơi lưu (native)       | Keychain / Keystore của hệ điều hành                                                                                                                                                                                                            |
| CSRF                   | `/auth/refresh` yêu cầu tiêu đề tùy biến (`X-VGTD-Client`) + `SameSite=Strict` + kiểm tra `Origin`                                                                                                                                              |
| Tránh lộ token         | Không đặt token trong URL/query; không ghi token vào log (bộ lọc log che)                                                                                                                                                                       |
| Dùng token ở WebSocket | Gửi ở `hello` ([24 §4](24-giao-thuc-mang.md)); xác minh **một lần/kết nối**; hạn token không ép đóng kết nối đang chạy, nhưng thu hồi phiên thì ép đóng (§3.2)                                                                                  |
| Đồng hồ                | Cho phép lệch ±60 s khi kiểm `exp`/`iat`                                                                                                                                                                                                        |
| Quản lý khóa ký        | Ed25519 khóa riêng ở biến môi trường/tệp bí mật (không commit); `kid` trong header; hỗ trợ ≥ 2 khóa công khai để xoay vòng                                                                                                                      |

### 3.2 Thu hồi phiên

| Tình huống                           | Cơ chế                                                                                              | Độ trễ hiệu lực                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Đăng xuất một thiết bị               | Đánh dấu `auth_sessions.revoked_at`; phát `auth.session.revoked` → Gateway đóng kết nối có `sid` đó | Tức thời cho WS; ≤ 10 phút cho token truy cập đã cấp (tự hết hạn) |
| "Đăng xuất mọi nơi" / đổi mật khẩu   | Tăng `accounts.token_version`; thu hồi mọi phiên; Gateway kick mọi kết nối của tài khoản            | Tức thời cho WS                                                   |
| Khóa / cấm tài khoản                 | `status='banned'` + `account_bans`; `AuthPort.revoke` + `Gateway.kick`                              | Tức thời cho WS                                                   |
| Cần chặn ngay token truy cập còn hạn | Thêm `jti` vào deny-list (Redis `revoked:{jti}` hoặc bản RAM) đến khi hết hạn                       | Tức thời                                                          |
| Phát hiện tái sử dụng refresh        | Thu hồi cả `family_id`                                                                              | Tức thời                                                          |

Gateway kiểm tra `token_version` khi `hello` (đọc bộ nhớ đệm 60 s hoặc DB) và nhận sự kiện thu hồi qua `EventBus` (NATS sau MVP).

## 4. Google SSO (giai đoạn sau MVP)

- **Luồng:** OIDC _authorization code + PKCE_; server xác minh `id_token` (chữ ký JWKS của Google, `aud`, `iss`, `exp`, `nonce`); danh tính duy nhất là `sub`, **không** dùng email làm khóa; chỉ chấp nhận `email_verified = true`.
- **Liên kết tài khoản:** bảng `credentials(kind='google', external_subject=sub)`. Liên kết vào tài khoản mật khẩu hiện có chỉ khi người chơi **đã đăng nhập** và xác nhận lại (không tự động gộp theo email – chống chiếm tài khoản).
- Tài khoản chỉ SSO không có mật khẩu; có thể đặt mật khẩu sau.
- Sau khi xác minh, dùng chung cơ chế token ở §3 (hệ thống không phụ thuộc Google cho phiên).
- Đường lui: nếu Google gặp sự cố, tài khoản có mật khẩu vẫn đăng nhập được; tài khoản chỉ SSO cần quy trình khôi phục (Q5).

## 5. Bảo mật vận chuyển và triển khai

- TLS ≥ 1.2 cho mọi đường ngoài (`wss://`, HTTPS); chứng chỉ cục bộ qua `mkcert` khi cần HTTPS thật (Service Worker chấp nhận `localhost`).
- Tiêu đề: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, CSP chặt cho trang tĩnh (cho phép `wasm-unsafe-eval` nếu Cocos/Spine WASM cần), `Referrer-Policy: no-referrer`.
- Kiểm tra `Origin` ở WebSocket và CORS cho `/auth/*` (danh sách cho phép).
- **Bí mật:** biến môi trường / tệp `.env` **không commit** (quy tắc hiện hành của repo); mẫu `.env.example`; không log bí mật.
- **Chuỗi cung ứng:** khóa phiên bản qua `package-lock.json` (đã có); `npm audit` chạy ở lịch hằng tuần/ nhánh phát hành (không làm chậm CI ngắn); tài sản bên thứ ba cần kiểm giấy phép (skill `vgtd-asset-pipeline`); bước pipeline có quyền hạn tối thiểu (xem PR #5).
- Đầu vào: mọi gói/JSON được kiểm bằng `validateMessage` / schema; không `eval`, không SQL nối chuỗi (Kysely/tham số hóa).

## 6. Mô hình đe dọa (STRIDE)

Tài sản cần bảo vệ: **A1** sổ cái và vật phẩm; **A2** tài khoản/phiên; **A3** tính công bằng của mô phỏng; **A4** tính sẵn sàng của World Node; **A5** dữ liệu cá nhân; **A6** bí mật ký/khóa.

Ranh giới tin cậy: _Client (không tin)_ ⇄ _Gateway_ ⇄ _World/Economy/Auth/Chat (tin)_ ⇄ _PostgreSQL/Redis (tin)_.

| STRIDE                     | Mối đe dọa                                          | Tài sản    | Biện pháp chính                                                                                                                                                          | Dư rủi ro / việc mở                                                                   |
| -------------------------- | --------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **S**poofing               | Chiếm tài khoản bằng nhồi mật khẩu / brute force    | A2         | argon2id, khóa tăng dần, rate limit IP/tài khoản, phản hồi đồng nhất, kiểm tra mật khẩu bị lộ (§2)                                                                       | Không có 2FA ở MVP → Q4                                                               |
| S                          | Giả mạo token / phát lại token                      | A2         | Ed25519, `exp` ngắn, `sid`/`jti`, xoay vòng + phát hiện reuse                                                                                                            | Token truy cập bị đánh cắp dùng được tối đa 10 phút                                   |
| S                          | Giả mạo gói (phát lại `input`)                      | A3         | `seq` + mã phiên; server bỏ gói cũ/trùng (08 §6)                                                                                                                         | —                                                                                     |
| **T**ampering              | Sửa gói (vị trí, sát thương, giá)                   | A1, A3     | Client chỉ gửi ý định; server tính mọi thứ; `validateMessage`; kiểm tra phạm vi; chỉ gói hợp lệ vào `step()`                                                             | —                                                                                     |
| T                          | Sửa bộ nhớ client (hack tốc độ, hồi chiêu)          | A3         | Ngân sách thời gian, `readyAt` phía server (§7)                                                                                                                          | ESP/radar (đọc thông tin) không chặn được hoàn toàn: AOI chỉ gửi thực thể trong vùng  |
| T                          | Nhân đôi vật phẩm bằng race / gửi trùng             | A1         | Giao dịch ACID, `idempotency_key`, khóa dòng, `version` lạc quan, ràng buộc `CHECK`, đối chiếu sổ cái, **một chủ duy nhất** cho instance ([26 §3](26-kinh-te-ledger.md)) | Cần kiểm thử đồng thời (chaos) trước closed beta ([28 §5](28-chien-luoc-kiem-thu.md)) |
| T                          | Chèn SQL / JSON độc                                 | A1, A5     | Truy vấn tham số hóa; schema                                                                                                                                             | —                                                                                     |
| **R**epudiation            | Người chơi chối giao dịch; GM chối hành động        | A1         | Sổ cái chỉ-thêm; `audit_log`; `roll_log`; log GM bất biến                                                                                                                | Cần quy trình kiểm toán                                                               |
| **I**nformation disclosure | Liệt kê tài khoản/nhân vật; lộ vị trí ngoài AOI     | A2, A3, A5 | Phản hồi đồng nhất; UUIDv7 không đoán được; AOI chỉ gửi trong vùng; không gửi thông tin người khác                                                                       | —                                                                                     |
| I                          | Lộ token/bí mật qua log/URL                         | A2, A6     | Che token trong log; token không ở URL; secret ngoài repo                                                                                                                | —                                                                                     |
| I                          | Rò rỉ chat riêng                                    | A5         | Kiểm tra quyền kênh; giữ 30 ngày; truy cập log có ghi nhận                                                                                                               | —                                                                                     |
| **D**enial of service      | Tràn kết nối / gói xấu / khung lớn                  | A4         | Giới hạn kết nối/IP, 16 KB/khung, token bucket, đóng khi sai định dạng ×3, backpressure                                                                                  | DoS tầng mạng cần hạ tầng bên ngoài (ngoài MVP cục bộ)                                |
| D                          | Đăng nhập dồn dập làm cạn CPU băm                   | A4         | Hàng đợi băm ≤ 64, rate limit trước khi băm                                                                                                                              | —                                                                                     |
| D                          | Gây tick vượt ngân sách bằng nhiều thực thể/kỹ năng | A4         | Trần thực thể/AOI, trần số kỹ năng, giảm tải ([22 §3.7](22-server-modules.md))                                                                                           | —                                                                                     |
| **E**levation of privilege | Gọi API admin / GM                                  | A1, A2     | API admin ở cổng riêng, xác thực riêng, RBAC tối thiểu, mọi hành động ghi `audit_log`                                                                                    | Cần chốt vai trò GM (Q6)                                                              |
| E                          | Client giả mạo thông điệp S→C hoặc tuyên bố "đã có" | A3         | Client không có đường ghi vào server ngoài ý định                                                                                                                        | —                                                                                     |

### 6.1 Các kịch bản gian lận kinh tế

| Kịch bản                                           | Cách xảy ra                                                          | Biện pháp                                                                                                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplication**                                    | Race giữa hai yêu cầu cùng dùng/chuyển một instance; thử lại sau lỗi | `UPDATE … WHERE owner_id AND location AND version`; `requestId`; một giao dịch cho cả chuyển vật phẩm + bút toán; chạy kiểm tra bất biến: mỗi `item_instances.id` có **đúng một** dòng, mọi vật phẩm sinh ra có bút toán `MINT`/nguồn hợp lệ |
| **Market abuse – rửa giao dịch (wash trading)**    | Hai tài khoản mua bán qua lại để làm lệch giá/CPI                    | Phát hiện cặp mua/bán lặp; loại giao dịch cùng IP/thiết bị/`account_group` khỏi rổ CPI; thuế bán và phí niêm yết 1% làm tăng chi phí ([07 §7](07-cong-thuc-data-schema.md))                                                                  |
| Market abuse – thao túng giá/độc quyền             | Gom hàng rồi niêm yết giá cao                                        | Trần/sàn giá theo giá tham chiếu CPI (±X%); giới hạn số niêm yết đồng thời; giám sát                                                                                                                                                         |
| Market abuse – lừa đảo "đổi giá phút chót"         | Hủy niêm yết/đổi giá ngay khi người mua bấm                          | Giá chốt theo bản ghi khóa trong giao dịch (`FOR UPDATE`); mua khớp theo `version` niêm yết, nếu đổi → lỗi `LISTING_GONE`                                                                                                                    |
| **RMT** (bán tiền thật) / rửa tiền qua chuyển hàng | Chuyển giá trị lớn giữa tài khoản bằng đồ giá thấp–cao               | Ngưỡng/giới hạn chuyển ngày, thuế giao dịch trực tiếp 3%, cảnh báo luồng tiền một chiều, hàng đợi xem xét                                                                                                                                    |
| **Bot farming**                                    | Đánh quái 24/7, vòng lặp đường đi giống hệt                          | Xem §7.3: tín hiệu hành vi, giới hạn tăng trưởng, giảm lợi ích (drop có hạn mức/ngày – theo game design)                                                                                                                                     |
| **Speedhack / teleport**                           | Đồng hồ client nhanh; sửa tọa độ                                     | Ngân sách thời gian input, giới hạn quãng đường/tick; client không gửi vị trí (§7.1)                                                                                                                                                         |
| **Cooldown hack**                                  | Xin dùng chiêu sớm                                                   | `readyAt` ở server, dung sai ≤ min(RTT/2, 100 ms), GCD, token bucket (§7.1)                                                                                                                                                                  |
| **Packet tamper / replay**                         | Sửa gói, phát lại                                                    | Giải mã nghiêm ngặt, `seq` cũ bị bỏ, kiểm tra phạm vi                                                                                                                                                                                        |
| **Lợi dụng bug logic** (đột phá, rơi đồ)           | Gửi lặp lệnh đột phá để xổ số lại                                    | Roll ở server bằng RNG có seed bí mật ghi `roll_log`; pity tính ở server; mỗi lệnh có `requestId`                                                                                                                                            |

## 7. Tín hiệu anti-cheat và ánh xạ sang tài liệu 08

### 7.1 Đã có (08 §6, đã cài ở `@vgtd/sim` – PR #10)

| Tín hiệu / cơ chế                                  | Quy tắc ([08 §6](08-server-architecture.md))                                                                       | Điểm vi phạm | Hành động                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------- |
| Ngân sách thời gian input                          | `Budget(t) = 1,02·(t − t_vào) + 250 ms`; input vượt bị giữ, không áp; trượt sau 10 s                               | +1/input     | Bỏ input dư                                                          |
| Quãng đường mỗi tick                               | ≤ tốc độ cho phép × 50 ms × 1,05 (+ lực đẩy server)                                                                | +1           | Kéo về vị trí hợp lệ                                                 |
| Tỷ lệ `Claimed / thời gian thật` trong cửa sổ 60 s | > 1,03 kéo dài → gắn cờ; > 1,10 → ngắt                                                                             | —            | Gắn cờ / ngắt kết nối + log                                          |
| Cooldown                                           | `t_server ≥ readyAt − min(RTT/2, 100 ms)`; đủ Chân Nguyên, GCD, không bị khống chế, trong tầm, có đường ngắm       | +1/từ chối   | Từ chối, gửi lại trạng thái đúng                                     |
| Tần số gói thi triển                               | Token bucket 10 gói/s                                                                                              | —            | Bỏ gói                                                               |
| Replay                                             | `seq` + mã phiên                                                                                                   | —            | Bỏ gói                                                               |
| Điểm nghi vấn                                      | +1 mỗi vi phạm, −1/phút; **20**: cảnh báo log; **50**: ngắt; **3 lần ngắt/24 h**: chuyển hàng đợi xem xét thủ công | —            | Không tự cấm chỉ vì một chỉ số (tránh dương tính giả ở mạng di động) |

Ghi chú từ PR #10 (cần xác nhận, xem [29 – Phụ lục B](29-adr.md)): lệnh bị giữ do vượt ngân sách bị **bỏ** chứ không xếp hàng lại; "kéo dài" của cửa sổ tỷ lệ hiểu là 2 cửa sổ liên tiếp; kết quả: speedhack 1,24× bị ngắt sau ~4 s.

### 7.2 Đề xuất bổ sung (ngoài 08)

| Tín hiệu                                                          | Dùng cho           | Cách đo                                                            | Điểm               |
| ----------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------ | ------------------ |
| Độ đều khoảng cách giữa các input (độ lệch chuẩn thấp bất thường) | Bot macro          | Cửa sổ 60 s; so với phân bố người chơi thật (cần dữ liệu)          | +0,5–2             |
| Độ lặp của đường đi / chuỗi kỹ năng                               | Bot farming        | Băm chuỗi `(dir, skill)` theo cửa sổ; lặp ≥ N lần                  | Cờ xem xét         |
| Thời gian online liên tục > 20 h/ngày, 7 ngày                     | Bot                | Từ `auth_sessions` + telemetry                                     | Hàng đợi xem xét   |
| Tỷ lệ thu nhập/giờ so với phân vị 99 cùng cảnh giới               | Bot, khai thác lỗi | Từ sổ cái ([26](26-kinh-te-ledger.md))                             | Cảnh báo + xem xét |
| Giao dịch trực tiếp/chợ bất thường (một chiều, cặp lặp)           | RMT, wash trading  | Truy vấn định kỳ trên `market_trades`/`ledger_tx`                  | Hàng đợi xem xét   |
| Nhiều tài khoản cùng IP/ thiết bị                                 | Farm đa tài khoản  | `auth_sessions.ip`, vân tay thiết bị mềm (không cố định danh tính) | Cờ                 |
| Lệch trạng thái client/server lặp lại (đối soát > 2 ô nhiều lần)  | Sửa client         | Metric `desync`                                                    | +1                 |

### 7.3 Thang xử lý (đề xuất)

1. **Bỏ gói / từ chối** (tự động, không hậu quả).
2. **Cảnh báo log + metric** (điểm 20).
3. **Giảm lợi ích tạm thời** (ví dụ vô hiệu nhận thưởng/giao dịch) trong khi chờ xem xét – chỉ cho tín hiệu kinh tế mạnh.
4. **Ngắt kết nối** (điểm 50) – tự động.
5. **Hàng đợi xem xét thủ công** (3 lần ngắt/24 h hoặc cờ kinh tế); **cấm** chỉ do GM sau xem xét. Không cấm tự động chỉ dựa trên một chỉ số (08 §6).

Mọi can thiệp và lý do ghi `audit_log`; người chơi bị ảnh hưởng có kênh khiếu nại (chi tiết do vận hành/LiveOps quy định).

## 8. Quản lý rủi ro còn lại

| Rủi ro                                                           | Mức               | Kế hoạch                                                                      |
| ---------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| Client Web có thể bị đọc/sửa (JS) – không có cách ngăn hoàn toàn | Chấp nhận         | Thiết kế để client không tin cậy; minify/obfuscate chỉ làm khó, không dựa vào |
| Bot dựa trên đọc màn hình (không sửa client)                     | Cao               | Tín hiệu hành vi (§7.2), giới hạn lợi ích; chấp nhận không tuyệt đối          |
| Thiếu pen-test độc lập                                           | Cao               | Kiểm thử bảo mật trước closed beta (Q7)                                       |
| Tài khoản bị chiếm không có 2FA                                  | Trung bình        | Sau MVP: TOTP + Google SSO                                                    |
| Quản lý khóa ký/ pepper cục bộ sơ sài                            | Thấp ở MVP cục bộ | Cần secret manager khi có môi trường thật                                     |

### 7.4 Làm cứng đầu vào ở cổng và World Node _[Cập nhật D101, P5]_

Lớp **trước** các kiểm tra của sim (7.1): chặn gói rác và gói tràn trước khi chúng vào hàng đợi input. Mọi số nằm ở `SECURITY_CONFIG` (`apps/server/src/config.ts`).

| Lớp                                                                                                     | Quy tắc                                                                                                                                                                                          | Hành động                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Khung quá lớn / không phải nhị phân sau `hello`                                                         | `MAX_FRAME_BYTES` 2048 (ws); khung văn bản sau `hello`                                                                                                                                           | Đóng kết nối                                                |
| Giải mã (`decode` + `validateMessage`)                                                                  | Kiểu, phạm vi số nguyên, độ dài chuỗi / mảng, cờ lạ, dư byte, `requestId` hex: mọi sai lệch ném `ProtocolError`                                                                                  | Trả `error` (BadMessage), tính **một vết**                  |
| Thông điệp chiều máy chủ → khách do khách gửi (`snapshot`, `pong`, ...), thông điệp của module chưa bật | Coi như khung sai                                                                                                                                                                                | Trả `error`, tính một vết                                   |
| Vết khung sai                                                                                           | **5 vết / cửa sổ trượt 30 s** (lỗi vặt của khách thật tự hết hạn; trước D101 là 5 vết cộng dồn cả phiên và chỉ một số nhánh mới kích hoạt kick)                                                  | Ngắt (BadMessage)                                           |
| Ngân sách theo lớp thông điệp (token bucket mỗi kết nối)                                                | `move` 40 / 30 mỗi s, `cast` 10 / 8, `ping` 5 / 2, `chat` và `party` 30 / 10 (lỏng hơn bộ giới hạn riêng của dịch vụ để câu trả lời có lý do đi trước), `inventory` 20 / 10, `progression` 6 / 2 | Bỏ khung; trả `RateLimited` **tối đa 1 lần / 10 s** mỗi lớp |
| Tràn kéo dài                                                                                            | **40 khung bị bỏ trong 10 s**                                                                                                                                                                    | Ngắt (RateLimited)                                          |
| Gói / giây toàn cục                                                                                     | 120 (đã có)                                                                                                                                                                                      | Ngắt                                                        |
| Tín hiệu của sim (7.1: ngân sách thời gian, quãng đường, cooldown, tầm, đường ngắm, tỷ lệ)              | Giữ nguyên, kể cả tín dụng trễ D85                                                                                                                                                               | Như 7.1                                                     |

Khách thật không bị phạt: `burst` của `move` cho phép một đợt bù ~1,5 s sau khi tab treo; đồng hồ ngân sách là giờ thật (`packetClock`), cùng nguyên tắc với D85, nên máy chủ quá tải không làm khách đang chơi đúng nhịp 20 Hz bị bỏ gói (test: 120 s chơi 20 Hz + kỹ năng + ping không rơi gói nào).

**Nhật ký an ninh có cấu trúc**: mỗi sự kiện một dòng JSON `{"sec":1,"ev":"kick|budget_drop|bad_frame|violation","tick":N,"entity":<id số của thế giới>,"reason":"<chuỗi cố định>","detail":{<bộ đếm>}}`. **Không** có id tài khoản, tên, địa chỉ IP, token, nội dung khung hay chat. Mỗi (kết nối, khóa) chỉ ghi tối đa 1 dòng / 10 s (kick luôn được ghi). Nguồn ghi tiêm được (`WorldNodeOptions.securityLog`); `main.ts` ghi ra stdout, `SECURITY_LOG=0` tắt. Bộ đếm: `metrics.kicksFlood`, `budgetDrops`, `securityEvents`.

Kiểm thử: `apps/server/tests/hardening.test.ts` (ngân sách, cửa sổ vết, khách chậm không bị phạt, log không PII), `apps/server/tests/gateway-fuzz.test.ts` (bắn khung ngẫu nhiên / đột biến / giá trị cực đoan / sai chiều vào **cổng thật** qua hàng trăm kết nối: không sập, khách đứng ngoài không bị ảnh hưởng, trạng thái thế giới hợp lệ, bộ nhớ có cận), `packages/protocol/tests/fuzz.test.ts` (giải mã).

## Câu hỏi cần chốt

Đã gộp vào [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md), nguồn duy nhất của câu hỏi mở: cột "Câu hỏi" ở đó ghi ID nguồn đã gộp (25 Q1–Q8). Nội dung gốc của mục này nằm trong lịch sử git.
