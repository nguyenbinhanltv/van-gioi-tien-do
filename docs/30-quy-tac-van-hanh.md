# Quy tắc vận hành 24/7 đến khi hoàn thiện MVP

**Trạng thái:** chủ dự án đã xác nhận 2026-11-05 (mục 12). Không thay thế `CLAUDE.md` và `docs/DECISIONS.md`; khi mâu thuẫn, hai tài liệu đó thắng.
**Nguồn ràng buộc:** `CLAUDE.md` (hard rules, Git rules, Verify), `docs/DECISIONS.md` D1–D31, `docs/10-mvp-scope.md` §12, `docs/OPEN-ITEMS.md` §8, báo cáo thiết kế `Bao-cao-thiet-ke-Van-Gioi-Tien-Do` §5 (bảng quyết định) và §7 (kế hoạch resume; báo cáo nằm ngoài repo).

## 0. Nguyên tắc nền

1. **Tự động hóa việc làm, không tự động hóa quyền quyết định.** 24/7 nghĩa là luôn có việc không bị chặn để làm tiếp; không có nghĩa là agent tự chốt các câu hỏi thiết kế/pháp lý/tiền bạc.
2. **Thiết kế đứng trước cài đặt** (quyết định của chủ dự án, epic #64): không viết code cho phần còn có dòng "Chặn" chưa được chốt ở báo cáo §5.
3. **Nguồn sự thật:** DECISIONS (D14+) > docs/00 §3–§4 > `@vgtd/shared` > docs khác. Không bịa số gameplay; thiếu thì ghi vào `docs/OPEN-ITEMS.md`.
4. **Mọi thứ phải kiểm chứng được:** không báo "xong" nếu chưa chạy bộ kiểm tra; báo cả thất bại và phần bỏ qua.

## 1. Điều kiện dừng: "MVP hoàn thiện" nghĩa là gì

Vòng lặp 24/7 chỉ dừng khi **tất cả** đúng (nguồn: docs/10 §12 và §9):

| Cổng | Tiêu chí thoát (đo được)                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P1   | Web + 1 máy mobile thật: ≤ 80 draw call, RAM ≤ 500 MB, ≥ 30 FPS với 20 NPC, gói đầu ≤ 25 MB, click-to-move đúng                               |
| P2   | 100 CCU bot ổn định, tick p99 ≤ 40 ms, ≤ 8 KB/s/người, AOI 100v100 đo được, speedhack/teleport bị guard chặn                                  |
| P3   | 1 nhân vật level 1 → Kim Đan trên 2 bản đồ; số liệu server khớp 07; telemetry đủ sự kiện lõi                                                  |
| P4   | Toàn bộ docs/10 §7.1 chạy end-to-end; playtest nội bộ ≥ 20 người, FTUE ≥ 85% không lỗi chặn                                                   |
| P5   | crash-free ≥ 99%; 100 CCU 24 giờ không sự cố; thử khôi phục không mất dữ liệu; dashboard KPI chạy; pháp lý được luật sư xác minh (docs/19 Q1) |

Mỗi phase **đóng trước khi mở phase sau** (10 §11–§12); P2 song song với phần client chỉ khi PR #10 đã qua cổng ADR-010.

## 2. Vai trò

| Vai trò                                 | Được làm                                                                                                                                               | Không được làm                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Chủ dự án (người)**                   | Chốt cột "Quyết định" §5, duyệt ADR, ngân sách, pháp lý, chủ art                                                                                       | —                                                                                    |
| **Orchestrator** (`van-gioi-tien-do-1`) | Chọn việc kế tiếp theo §4, spawn/redirect worker, theo dõi, kích hoạt AO review, merge PR đã đủ điều kiện §6 (theo ủy quyền đã ghi trong memory dự án) | Tự chốt quyết định thuộc §5 bảng "Phải hỏi người"; bỏ qua branch protection          |
| **Worker**                              | Một task phạm vi hẹp, một PR, sửa CI/review của PR đó, `ao report`                                                                                     | Sửa package khác khi chưa qua orchestrator; tự merge PR của mình; mở việc ngoài task |
| **Worker Codex (asset)**                | Sinh asset placeholder + ghi `docs/ASSET-LICENSES.md`                                                                                                  | Dùng asset ngoài chưa kiểm giấy phép                                                 |
| **AO native reviewer**                  | Review PR của worker                                                                                                                                   | Thay cho GitHub approval/branch protection                                           |

Sở hữu package: mỗi package thuộc một worker tại một thời điểm; thay đổi chéo package đi qua `src/index.ts` public và orchestrator (CLAUDE.md).

## 3. Vòng lặp vận hành (mỗi chu kỳ)

```text
1. ĐỌC TRẠNG THÁI   gh pr list; ao session ls; CI; OPEN-ITEMS; hàng đợi §4
2. XỬ LÝ CHẶN       CI đỏ → worker sửa; review có comment → worker sửa; xung đột → merge origin/main
3. CHẤM ĐIỂM        merge PR đủ điều kiện §6; đóng issue tương ứng
4. CHỌN VIỆC        việc ưu tiên cao nhất KHÔNG bị chặn bởi quyết định (§4) và không trùng package
5. GIAO VIỆC        spawn worker kèm brief chuẩn §8; tối đa N worker song song (§9)
6. TỔNG HỢP         gom câu hỏi cho người vào MỘT bản tin (digest §7), không hỏi lẻ từng cái
7. GHI NHẬT KÝ      ao report; cập nhật OPEN-ITEMS/DECISIONS khi có quyết định mới
```

Nhịp: chu kỳ chính **mỗi 20–30 phút khi có worker đang chạy** (poll CI/PR); **1–2 giờ khi chỉ chờ người** (không poll dày vô ích). Dùng sự kiện hoàn thành của worker/CI làm tín hiệu chính, lịch (`ScheduleWakeup`/`ao automation`) chỉ làm heartbeat dự phòng ≥ 20 phút.

## 4. Hàng đợi ưu tiên và cổng quyết định

Thứ tự (cao → thấp): (1) sửa CI/review của PR đang mở; (2) việc trên đường găng của phase hiện tại; (3) việc song song không chặn nhau; (4) nợ kỹ thuật/test/docs.

**Quy tắc "cổng quyết định":** trước khi giao việc, kiểm các dòng liên quan ở báo cáo §5:

- Cột "Quyết định" **đã điền** → ghi vào `DECISIONS.md` (D32+) trước, rồi mới làm (skill `vgtd-formula-change`).
- **Để trống và dòng "Chặn P<n>" của phase hiện tại** → việc đó **không được làm**; chuyển sang việc khác và đưa câu hỏi vào digest.
- Để trống nhưng có "Đề xuất mặc định" và **không** thuộc nhóm "Phải hỏi người" (§5 dưới) → được làm theo mặc định **sau 48 giờ** không phản hồi digest, và phải gắn nhãn `[default-pending-approval]` trong PR + ghi vào OPEN-ITEMS để dễ đảo lại.

Kế hoạch tham chiếu: báo cáo §7.2 (PR #7 → #66 → #9 → #67; #10 sau ADR-010) và issue #11–#42; thứ tự phase P1 → P5.

## 5. Ai quyết cái gì

**Agent được tự quyết (ghi lại trong PR):** tên biến, cấu trúc nội bộ package, test, refactor trong package của mình, sửa lỗi chính tả/liên kết docs, sửa sự thật khách quan sai lệch giữa docs (như PR #72), cấu hình CI trong ràng buộc D28.

**Phải hỏi người (chặn tới khi có trả lời, không có "mặc định sau 48 giờ"):**

- Mọi thứ đổi/ thêm số gameplay đã khóa hoặc cần game designer duyệt (D16–D22), công thức, cân bằng, schema dữ liệu.
- Pháp lý, quyền riêng tư, thanh toán, Tiên Ngọc, giấy phép (docs/19); ngân sách tiền; thuê ngoài.
- Chọn/đổi engine, Spine, nhà cung cấp hosting (D2, D25, D27); thêm phụ thuộc lớn.
- Quyết định kiến trúc nhóm ADR chặn: 005, 007, 010, 011, 012, 013.
- Mâu thuẫn X1–X12, G6, G14, G15 (OPEN-ITEMS §8).
- Phát hành ra ngoài, mời tester, bất kỳ thứ gì công khai, xóa dữ liệu thật, chạy trên dữ liệu người chơi.
- Nội dung art/âm thanh cuối cùng (chủ art tạm thời: chủ dự án); asset AI chỉ là placeholder cho tới khi chủ art duyệt và hồ sơ giấy phép đủ.

## 6. Git, PR, CI, merge

1. Nhánh mới từ `origin/main` trong namespace phiên (`ao/<session>/<topic>`); **không** commit lên `main`.
2. Đồng bộ bằng **merge**, **không rebase, không force-push, không `git reset --hard`**; commit theo conventional commits; mỗi task một PR.
3. Trước khi push, tại root: `npm ci`, `typecheck`, `test`, `build`, `lint`, `format:check` đều đạt.
4. **Điều kiện merge (orchestrator):** (a) `verify (18)` và `verify (22)` xanh; (b) AO review không còn yêu cầu bắt buộc chưa xử lý, mọi thread đã resolve; (c) PR không vượt phạm vi task, không đụng cổng quyết định §4–§5; (d) mô tả PR có kết quả kiểm tra và rủi ro; (e) không phải PR thuộc nhóm "phải hỏi người" khi chưa có xác nhận.
5. Không bao giờ bypass branch protection (D31); không merge khi CI đỏ hoặc chưa chạy.
6. Không commit sản phẩm build (`out/`, `build/`, `dist/`), bí mật, `.claude/settings.local.json`; **không tạo/sửa `.claude/settings.json`** (D30).
7. Mô phỏng/mã xác định: không `Math.random`, `Date.now`, `performance.now` trong sim; hằng số/công thức chỉ ở `@vgtd/shared`.
8. Asset: không nhập asset bên thứ ba hoặc từ MCP nếu chưa qua kiểm giấy phép và chưa ghi vào `docs/ASSET-LICENSES.md`.

## 7. Giao tiếp với người (không làm phiền, không bỏ sót)

- **Digest** mỗi ngày (hoặc khi có ≥ 5 câu hỏi/blocker): một bản tin duy nhất gồm (1) đã merge, (2) đang chạy, (3) bị chặn kèm ID dòng §5 cần trả lời + đề xuất mặc định, (4) rủi ro mới, (5) số đo mới (draw call, FPS, tick…).
- Câu hỏi khẩn (blocker cho nhiều worker, sự cố bảo mật, mất dữ liệu): báo ngay, không chờ digest.
- Worker dùng `ao report` (`--checkpoint` mốc, `--needs-input`, `--stuck`, `--done`); orchestrator không báo "xong" thay worker.
- Không gửi dữ liệu nhạy cảm ra dịch vụ ngoài; PR/commit/comment viết bằng tiếng Anh, docs thiết kế bằng tiếng Việt.

## 8. Brief chuẩn cho worker mới

Mỗi spawn phải có: mục tiêu một câu; issue/phase; file docs bắt buộc đọc; **danh sách quyết định đã chốt** (D-id) và **dòng §5 còn mở không được tự quyết**; package được phép sửa; tiêu chí xong (kiểm tra đo được); quy tắc Git/CI §6; yêu cầu `ao report` ở mốc; giới hạn thử lại §9. Task asset thêm quy tắc giấy phép §6.8.

## 9. Giới hạn chi phí và an toàn vận hành

| Hạng mục                        | Mặc định đề xuất (chủ dự án chỉnh)                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Worker chạy song song           | ≤ 3 (tối đa 1 worker mỗi package; 1 worker Codex asset)                                                    |
| Thử lại một lỗi CI              | ≤ 3 lần; sau đó `--stuck` kèm log, orchestrator đổi hướng hoặc hỏi người                                   |
| Một task chạy                   | ≤ 1 ngày làm việc không có checkpoint → orchestrator kiểm tra, chia nhỏ hoặc dừng                          |
| Ngân sách token/ngày            | **Chủ dự án đặt** (chưa có số); khi đạt 80% → chỉ làm việc đường găng, 100% → dừng nhận việc mới và báo    |
| Dung lượng repo/LFS             | Mỗi PR asset ghi ước lượng LFS; cảnh báo khi vượt 50% quota (quota chưa được ước lượng – báo cáo §6.1 T12) |
| Chạy dài (loadbot, soak 24 giờ) | Chỉ trên máy local của dự án, ghi rõ tài nguyên; không tự mở dịch vụ ra Internet                           |

## 10. Sự cố và dừng khẩn

- **Dừng ngay và báo người** nếu: lộ bí mật/token; push nhầm lên `main`; hỏng dữ liệu/kho git; CI `main` đỏ kéo dài; agent phát hiện mình đang cần lệnh phá hoại (xóa nhánh người khác, `--force`, `reset --hard`); vi phạm phạm vi pháp lý.
- Cách dừng: `ao session kill` các worker liên quan, ghi sự cố vào báo cáo/`OPEN-ITEMS`, **không tự sửa lịch sử git**; khôi phục bằng commit mới.
- `main` đỏ: ưu tiên số 1; revert bằng PR mới (không force).
- Mất kết nối/daemon: khi khởi động lại, đọc `ao session ls`, `gh pr list`, nhật ký báo cáo để tiếp tục; không giả định trạng thái cũ.

## 11. Đo tiến độ và tự kiểm

- Bảng theo dõi phase (P1–P5): issue đóng / tổng, tiêu chí thoát đã đo / chưa đo; cập nhật trong digest.
- Mỗi cuối phase: chạy lại rà soát chéo (`vgtd-review-all-gdds`, `vgtd-architecture-review`) và cập nhật `OPEN-ITEMS`; số đo thật thay giả thiết trong docs 22 §3.4, 24 §9, 28 §6.
- Mốc "MVP hoàn thiện" chỉ được tuyên bố khi chủ dự án xác nhận các tiêu chí §1 (kèm số đo, không chỉ CI xanh).

## 12. Xác nhận của chủ dự án (2026-11-05)

| #   | Hạng mục                                                     | Kết quả                                                                                                                             |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Số worker song song tối đa                                   | **3** (ngân sách token/ngày: **chưa đặt**, orchestrator hỏi lại khi cần; tới lúc đó dùng mức 80%/100% theo thông báo của chủ dự án) |
| 2   | Orchestrator tự merge PR đủ điều kiện mục 6.4                | **Cho phép**                                                                                                                        |
| 3   | Quy tắc "mặc định sau 48 giờ" (mục 4)                        | **Bật**                                                                                                                             |
| 4   | Giờ yên tĩnh                                                 | **UTC+7; chỉ báo khẩn 23:00–07:00**                                                                                                 |
| 5   | Đưa vào repo (`docs/30`, nhắc trong `CLAUDE.md`/`AGENTS.md`) | **Có** (tài liệu này)                                                                                                               |
