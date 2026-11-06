# Việc còn mở & mảng thiết kế còn thiếu

Nguồn: [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) §6 (chưa kiểm tra được) và §7 (việc còn mở).

## 1. Việc cần làm

| #   | Việc                                                                                                                          | Lý do                                                       | Ưu tiên    | Trạng thái                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Cập nhật GDD sang 2D Isometric / Web / Cocos Creator, số Ngũ hành và công thức đột phá mới                                    | GDD vẫn ghi 3D, UE5 và các giá trị cũ ở D1–D4, D8–D10       | Cao        | **Đã làm trong repo**: [01-gdd.md](01-gdd.md) (dựng lại do không có docx GDD). Cần chủ GDD đối chiếu với bản gốc |
| 2   | Cập nhật Asset Matrix: gói đầu 25 MB, 6 phẩm, kích thước icon                                                                 | Tránh hai tài liệu nói hai số khác nhau                     | Cao        | **Đã làm**: [02-asset-matrix-2d.md](02-asset-matrix-2d.md)                                                       |
| 3   | Ánh xạ `orchestrator_pipeline.yaml` theo schema thật của orchestrator.inc                                                     | Chưa có tài liệu schema công khai                           | Cao        | **Thay bằng GitHub Actions** (D28, D29): không cần ánh xạ orchestrator                                           |
| 4   | Chạy pipeline trên runner thật (basisu, astcenc, claude, codex, agy)                                                          | Các bước này chưa kiểm tra được                             | Cao        | **Thay bằng GitHub Actions** (D28): CI ngắn, không CD                                                            |
| 5   | Prototype client trong Cocos Creator: InputManager + tilemap sinh tự động + 1 nhân vật paperdoll (skeleton DragonBones – D35) | Kiểm chứng ngân sách draw call, RAM và Y-sort trên máy thật | Cao        | Mở                                                                                                               |
| 6   | Module `step()` dùng chung client / server, World Node mẫu, đo AOI với 100 vs 100                                             | Kiểm chứng băng thông và CPU của tài liệu Server            | Trung bình | Mở                                                                                                               |
| 7   | Mô phỏng kinh tế (drop so với tiêu hao) trước closed beta                                                                     | Khóa các hệ số trong Công thức bằng dữ liệu                 | Trung bình | Mở                                                                                                               |
| 8   | Shader nước lệch hoa văn theo tọa độ thế giới                                                                                 | Hồ lớn đang thấy hoa văn lặp                                | Thấp       | Mở                                                                                                               |

## 2. Chưa kiểm tra được (từ §6)

- Nén KTX2 / ASTC (basisu, astcenc không có trong môi trường thử).
- Ba bước gọi Codex, Antigravity và Claude Code trong `orchestrator_pipeline.yaml` (chỉ còn là tài liệu tham khảo, D29).
- Bước deploy: không còn trong phạm vi (D28: không CD). "orchestrator.inc" trong tài liệu nguồn là nhầm lẫn (D29).
- Demo canvas `example/` của gói client mới biên dịch, chưa chạy trong trình duyệt thật.

### Art/animation ưu tiên trước — quyết định 2026-11-06

[Cập nhật D32: ưu tiên thiết kế nhân vật/asset trau chuốt + animation mượt. Kỹ thuật chỉ phục vụ trình xem animation trong engine (PR #7, #67 + viewer); server/netcode tiếp tục tạm dừng.] Các mục server ở bảng trên không có nghĩa được mở lại.

- ~~Chưa chỉ định người rig/animate (human animator not assigned).~~ **[Đóng bởi D36: AI làm toàn bộ concept, tách mảnh, rig và hoạt cảnh; chủ dự án (art owner tạm thời) chỉ duyệt trong viewer. Không còn chặn.]**
- **Rủi ro mới (D36): chất lượng animation khi không có animator.** Hoạt cảnh do agent sinh có thể cứng/thiếu trọng lượng; chỉ coi là hoàn thiện sau khi chủ dự án duyệt trong viewer. Cần tiêu chí duyệt (timing, footstep, độ liền mạch vòng lặp) và quy trình sửa lặp.
- **Cần QA hình ảnh tự động (D36).** Không có người xem từng frame: cần kiểm tự động (xuyên mảnh, lệch pivot/socket, rách mesh, vòng lặp không khớp, vượt giới hạn rig docs/03, ảnh chụp so sánh trong engine) trước khi đưa tới người duyệt. Xây ở bộ công cụ AI animation (task sau PR #76).
- **`@vgtd/rig` (tools/rig) – việc còn mở sau PR lõi:** (1) rig thật của Kiếm tu (`tools/rig/kiem-tu.rig.json`, worker nhân vật) chưa nạp: bộ hoạt cảnh mới chạy và qua QA trên rig tham chiếu `buildReferenceHumanoid`; cần xác nhận tên bone/vai trò khi có rig thật. (2) Hướng S/N/chéo là chiếu giảm biên độ từ góc nghiêng, cần duyệt trong viewer. (4) Chưa có renderer PNG/GIF (contact sheet) và 7 hoạt cảnh còn lại (walk, dash, meditate, channel, sword_fly, tribulation, emote). (5) Kiểm bằng runtime Cocos chỉ chạy cục bộ (CI không có Cocos). Xem [art/rig-pipeline.md](art/rig-pipeline.md).
- **Rig Kiếm tu: kiếm đôi và mối nối hở (vòng 3, `@vgtd/rig`).** (1) Mảnh `scabbard` của `outfit_lower` có một thanh kiếm vẽ sẵn nên khi kiếm rút trên tay thì thấy hai thanh; đã bỏ mảnh đó khỏi 5 hướng bằng `removePieces`. Đánh đổi đo được: đuôi sash mà mảnh đó nối giờ lộ ra, hướng S tách mảnh 2 → 11 clip. Bone `scabbard` và vùng atlas tương ứng **giữ nguyên, chưa dùng**, để gắn lại khi có mảnh vỏ kiếm rỗng. (2) Cần art vẽ bù dưới khớp (danh sách chính xác từng cặp mảnh và số px: [art/rig-underpaint.md](art/rig-underpaint.md); lớn nhất: đùi / robe_back 31 px, vest / tay áo vai 20 px, robe_back / robe_front 11 px) và một mảnh vỏ kiếm rỗng cùng vẽ bù đuôi sash. (3) Sau khi art xong: áp lại `autoSkin`, đo lại bằng `npm run artifacts -w @vgtd/rig`, rồi mới đặt `seamSeverity` mặc định thành `error` (hiện `warning` vì chưa sạch). Xem [art/rig-pipeline.md §11](art/rig-pipeline.md).
- ~~Cần xác minh giấy phép Spine Professional và điều khoản Spine Runtimes~~ **[Thay bởi D35: không dùng Spine; mục này đóng.]** Các mục mới từ nghiên cứu [art/dragonbones.md](art/dragonbones.md):
  - ~~**Editor DragonBones Pro không còn tải chính thức (editor availability).**~~ **[Đóng bởi D36: editor GUI là tùy chọn, không còn chặn.]** (ghi chú lịch sử) Trang tải của Egret trả 404; bản desktop cuối 5.6.2 (2018) chỉ có từ bên thứ ba. Công cụ hiện hành là **LoongBones** (web, đổi tên 2025-10-13). Chủ dự án chọn công cụ và nguồn tải được chấp nhận; [Cập nhật D36: không còn chặn.]
  - **Điều khoản LoongBones (chủ dự án đã kiểm 2026-11-06, giá theo ảnh chụp của chủ dự án; không chặn, D36):** gói Free **$0** = dùng thử 7 ngày (10 dự án, 10 MB lưu đám mây, 20K AI token/ngày; thử kết thúc ~2026-11-13). VIP 1 tháng **$9.9/tháng** (không giới hạn dự án, 2 GB, 60K AI token/ngày). VIP 1 năm **$89.9/năm** (không giới hạn dự án, 20 GB, 60K token/ngày). Loong Coins **$9.9 một lần** (6.000 coin cho tính năng AI; giá niêm yết $19.9). Xuất tệp: **được phép, không watermark**. Dùng thương mại tệp xuất: **được phép (theo cách đọc điều khoản của chủ dự án, không phải tư vấn pháp lý)**. Nhập DragonBones 5.x JSON: **không làm (chủ dự án bỏ qua 2026-11-06)**. Chưa mua; LoongBones vẫn tùy chọn và hiện không dùng (D36).
- **Giá/ToS LoongBones và quyền thương mại với asset xuất ra chưa xác minh (editor terms/risk).** Có mục "会员订阅", báo cáo trái chiều miễn phí/trả phí. Cần người đọc `loongbones.com` và ghi vào [ASSET-LICENSES.md](ASSET-LICENSES.md) khi có asset đầu.
  - **Phiên bản dữ liệu xuất chưa kiểm với Cocos 3.8.8 (export-format risk).** Runtime đọc tối đa 5.6.300; cần sinh mẫu từ nguồn rig trung lập (D36; LoongBones chỉ tùy chọn), nạp thử, ghim fixture (liên quan 31 I-06, worker rig/viewer).
  - **Thiếu tính năng so với Spine (physics constraint, `Skin.addSkin`).** Cần quyết định cách làm vải/tóc/phi phong (key tay hoặc bone chain) và đổi trang bị bằng `replaceSlotDisplay` trong spike.
  - **Công cụ ít bảo trì (abandonment risk).** Giảm thiểu: runtime MIT trong engine + nguồn rig trung lập sinh DragonBones JSON bằng mã; có thể xem lại Spine sau MVP.

[Cập nhật D34: tạm chấp nhận ảnh từ `image_gen.imagegen` khi mô hình/phiên bản không được công bố; vẫn phải ghi CLI version, ngày/giờ, prompt đầy đủ vào ASSET-LICENSES.md và rà soát giấy phép/xác minh nguồn gốc trước phát hành.]

## 3. Mảng chưa có tài liệu thiết kế

> Cập nhật: các tầng vòng lặp thời gian (5 phút → 12 tháng), cơ chế từng cảnh giới và chiến tranh Linh Mạch đã có **đề xuất** ở [01-gdd.md](01-gdd.md) §3–§4, §9 (chờ duyệt; xem mục "Design A"); nhiệm vụ, chế tạo, PvP, kiếm tiền, onboarding, LiveOps, telemetry có đề xuất ở 12–17 (PR #69). Danh sách dưới giữ nguyên làm lịch sử.

- Nhiệm vụ và cốt truyện
- Nghề luyện đan / luyện khí / chế phù chi tiết
- Luật PvP và đấu trường
- Kiếm tiền (Tiên Ngọc, Battle Pass, cửa hàng)
- Hướng dẫn người chơi mới (onboarding)
- Sự kiện và LiveOps
- Đo lường (telemetry, dashboard KPI)

## 4. Lưu ý khi chuyển đổi tài liệu

- Không có docx GDD riêng; 01-gdd.md chỉ chứa những gì hồ sơ tổng hợp và tài liệu Công thức ghi lại. Các tầng vòng lặp thời gian (5 phút → 12 tháng), cơ chế riêng của từng cảnh giới và chiến tranh Linh Mạch hiện có **thiết kế đề xuất** trong 01 §3–§4, §9 (chờ duyệt, mục "Design A" ở cuối file); vẫn chưa có nguồn gốc.
- 03–08 giữ nguyên văn docx, kể cả các chỗ nhắc giá trị cũ để so sánh.

## 5. Điểm mơ hồ của spec phát hiện khi viết `@vgtd/shared` (PR #4)

Nguồn: mô tả PR #4 (`packages/shared`). Tất cả A1–A13 đã được chốt ngày 2026-11-05 (xem [DECISIONS.md](DECISIONS.md) D14–D24); các mục gameplay được đánh dấu cần game designer duyệt khi cân bằng.

| #   | Điểm mơ hồ                                                                                                                                                                                                                                                                            | Trạng thái                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A1  | Bảng chỉ số in trong 07 lệch công thức của chính nó tới ~0,02% (Độ Kiếp sơ kỳ HP in 120.936, tính ra 120.932; Viên Mãn 156.733 so với 156.758). Nằm trong ngưỡng CI 1% của tài liệu. Code dùng công thức; HP_ref của ví dụ 81 đạo dùng số in 156.733.                                 | **Đã chốt 2026-11-05** (D16)                                                                    |
| A2  | Tổng Lôi Kiếp: bảng làm tròn 81 đạo thành 3,0 × HP_ref, công thức cho ≈ 2,999×; số học ví dụ lệch ≤ 2 HP so với 90.904 / 250.772 in trong tài liệu. `tribulationOutcome` có `totalMultiplierOverride` để tái hiện đúng số in.                                                         | **Đã chốt 2026-11-05** (D16)                                                                    |
| A3  | Số Hộ Mạch Đan: "172 s → 4 viên" được cài là `floor(172/45) + 1` (viên đầu tại t = 0).                                                                                                                                                                                                | **Đã chốt 2026-11-05** (D17) (chờ game designer duyệt khi cân bằng)                             |
| A4  | Thứ tự chia sát thương cho hộ pháp so với giảm của trận pháp không được nêu; code áp dụng nhân sau khi giảm. Trần 50% giả định áp cho trận pháp + Thể tu gộp. Độ bền khiên mất 10%/đợt mới chỉ là hằng số.                                                                            | **Đã chốt 2026-11-05** (D18) (chờ game designer duyệt khi cân bằng)                             |
| A5  | Đột phá tiểu cảnh: chỉ có Base 0,90 / 0,85 và nửa Karma_Penalty; đan và pity **không** áp dụng, clamp 5–95% là giả định.                                                                                                                                                              | **Đã chốt 2026-11-05** (D19) (chờ game designer duyệt khi cân bằng)                             |
| A6  | Hướng nào được vẽ cho Player / Boss: 00 §3 ghi 8, tài liệu Nhân vật ghi 5 + lật.                                                                                                                                                                                                      | **Đã chốt 2026-11-05**: 5 hướng + lật, animation bất đối xứng có thể vẽ đủ 8 (D14)              |
| A7  | Gốc iso: (i, j) nguyên là tâm ô hay đỉnh N; trục y.                                                                                                                                                                                                                                   | **Đã chốt 2026-11-05**: đỉnh N, tâm (i + 0,5; j + 0,5), y hướng xuống, client Cocos lật y (D15) |
| A8  | Sort theo tầng cao: Tilemap định nghĩa nhóm theo tầng nhưng không có khóa số; `compareDrawOrder` sắp theo nhóm → Y → X → id. Tối đa 4 tầng → nhóm 0..4 (mặt vách tầng L thuộc nhóm L−1).                                                                                              | **Đã chốt 2026-11-05** (D20)                                                                    |
| A9  | AOI `EXIT_FACTOR` 1,15 cho 46 / 51,75; tài liệu dùng 46 / 52 (làm tròn); hằng số dùng 46 / 52.                                                                                                                                                                                        | **Đã chốt 2026-11-05** (D16)                                                                    |
| A10 | Pity "xác suất lần thứ n = 0,002·(1 + 0,15n)": n coi là số lần thử tính từ 1, bảo đảm ở n = 30 (công thức chỉ cho 0,9% ở đó).                                                                                                                                                         | **Đã chốt 2026-11-05** (D21) (chờ game designer duyệt khi cân bằng)                             |
| A11 | Drop cảnh giới thấp: chênh ≥ 2 cảnh giới thì chỉ rơi nguyên liệu; `lowRealmFactor` trả `null` cho trường hợp này (nơi gọi phải xử lý).                                                                                                                                                | **Đã chốt 2026-11-05** (D22) (chờ game designer duyệt khi cân bằng)                             |
| A12 | Lỗi nhỏ của schema mẫu: trip `strictRequired` của Ajv (chạy với `strictRequired:false`, schema giữ nguyên văn); `realms.minItems` là 7 nhưng có 9 cảnh giới; `max_pills` tối đa 5 so với luật "m ≤ 3"; `Trúc Cơ → Kim Đan` là `heart_demon` trong JSON nhưng "Tâm Ma nhẹ" trong bảng. | **Đã chốt 2026-11-05** (D23)                                                                    |
| A13 | `realms[].breakthrough.main_pill_ids` trong JSON (`pill_ket_kim_dan` cho Trúc Cơ, …) khác tên đan trong bảng §2 ("Trúc Cơ Đan", "Kết Anh Đan"); giữ như JSON.                                                                                                                         | **Đã chốt 2026-11-05** (D24)                                                                    |

## 6. Thiếu hạ tầng cho mô phỏng xác định và giấy phép asset

- `@vgtd/shared` chưa có PRNG có seed dùng chung client ↔ server (các công thức hiện nhận giá trị ngẫu nhiên được truyền vào). Cần thêm trước khi viết World Node (xem skill `vgtd-sim-determinism`).
- Chưa có `docs/ASSET-LICENSES.md`; tạo khi nhập asset bên thứ ba đầu tiên (xem skill `vgtd-asset-pipeline`).

## Design A (01, 10, 11)

Các tài liệu [01-gdd.md](01-gdd.md), [10-mvp-scope.md](10-mvp-scope.md), [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md) đã **thiết kế bổ sung** các tầng thời gian, cơ chế từng cảnh giới, chiến tranh Linh Mạch, Nghiệp Lực / Đạo Tâm, phạm vi closed beta và hệ phái / kỹ năng. **Mọi giá trị mới là đề xuất, chờ chủ dự án duyệt** (chưa phải quyết định; chưa vào DECISIONS). Các câu hỏi cần chốt (mỗi mục có mặc định đề xuất):

- GDD: mục "Câu hỏi cần chốt" của 01 (G1–G15), gồm ba mức hậu quả Lôi Kiếp (G1), Linh Mạch 5 hay 6 phẩm (G6).
- MVP: mục "Câu hỏi cần chốt" của 10 (M1–M13).
- Hệ phái / kỹ năng: mục "Câu hỏi cần chốt" của 11 (S1–S11).
- Cần duyệt thêm: ρ của Hậu sơn Sơn Môn khi đả tọa (0,6 theo 07 §5 hay giá trị riêng) — 01 §11.

## Design C (20–29)

Nguồn: PR #68. Mọi ADR ở [29-adr.md](29-adr.md) đang là "Đề xuất – chờ duyệt". Bảng "Câu hỏi cần chốt" của từng tài liệu: [20](20-kien-truc-tong-the.md#câu-hỏi-cần-chốt), [21](21-kien-truc-client.md#câu-hỏi-cần-chốt), [22](22-server-modules.md#câu-hỏi-cần-chốt), [23](23-mo-hinh-du-lieu.md#câu-hỏi-cần-chốt), [24](24-giao-thuc-mang.md#câu-hỏi-cần-chốt), [25](25-xac-thuc-bao-mat.md#câu-hỏi-cần-chốt), [26](26-kinh-te-ledger.md#câu-hỏi-cần-chốt), [27](27-van-hanh-quan-sat.md#câu-hỏi-cần-chốt), [28](28-chien-luoc-kiem-thu.md#câu-hỏi-cần-chốt), [29](29-adr.md#câu-hỏi-cần-chốt).

| #   | Việc                                                                                                                                                                                 | Nguồn                                                               | Trạng thái                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | PRNG có seed dùng chung trong `@vgtd/shared` (đề xuất xoshiro128\*\*, luồng đặt tên, seed bí mật cho roll kinh tế); đổi băm vàng của PR #10. Giải quyết mục §6 ở trên khi được duyệt | [29 ADR-010](29-adr.md)                                             | Chờ duyệt                                                                                                                                       |
| T2  | Quy tắc làm tròn số nguyên cho hàm kinh tế của `@vgtd/shared` (`sellerProceeds` trả số thực; sổ cái cần số nguyên, đề xuất thuế làm tròn lên)                                        | [26 §2.1, §5.3](26-kinh-te-ledger.md), ADR-024                      | Mở                                                                                                                                              |
| T3  | Luật Đấu Giá Hội: tỷ lệ hủy tiền, chống sniping, ai được đưa hàng (chưa có số)                                                                                                       | [26 §5.4](26-kinh-te-ledger.md)                                     | Mở                                                                                                                                              |
| T4  | Bản ghi snapshot thêm 1 bit "tuyệt đối" (37–44 bit so với 36–43 trong 08 §8) – cần xác nhận hoặc sửa 08                                                                              | [24 §6](24-giao-thuc-mang.md), PR #10                               | Chờ xác nhận                                                                                                                                    |
| T5  | Ngân sách 8/13/25 KB/s có tính tiêu đề WS + TCP/TLS không                                                                                                                            | [24 §9, Q4](24-giao-thuc-mang.md)                                   | Mở                                                                                                                                              |
| T6  | Điểm mơ hồ PR #9 (stream tier, 4–6 chunk, tie-break `compareDrawOrder`, pivot mặt vách, schema `elevation`/`objects`) và PR #10 (`qinggong`, input bị bỏ, cờ bậc thang…)             | [29 Phụ lục B](29-adr.md)                                           | Chờ xác nhận                                                                                                                                    |
| T7  | Điểm mơ hồ PR #7 còn leo thang: trục ellipse quỹ đạo, số khung sự kiện, hitbox elite và giới hạn rig quái Spine không phải boss, dữ liệu mẫu Boss                                    | [29 Phụ lục A](29-adr.md)                                           | Chờ chủ art / game design                                                                                                                       |
| T8  | Chưa kiểm chứng: Cocos 3.8.8 + DragonBones (D35; trước đó Spine 4.2), ngân sách engine ≤ 6 MB, đóng gói dữ liệu chunk (spike S1–S5)                                                  | [21 §12](21-kien-truc-client.md)                                    | Mở                                                                                                                                              |
| T9  | Mọi ngân sách ms, trần CCU, rate limit, kích thước thông điệp họ Lạnh là giả thiết thiết kế, chưa đo (cần loadbot 100v100)                                                           | [22 §3.4](22-server-modules.md), [28 §6](28-chien-luoc-kiem-thu.md) | Mở                                                                                                                                              |
| T10 | Đối chiếu telemetry/KPI với docs/17 và các tài liệu game design 10–19 khi chúng vào repo                                                                                             | [27](27-van-hanh-quan-sat.md)                                       | Mở                                                                                                                                              |
| T11 | Chính sách quyền riêng tư / xóa dữ liệu, kiểm thử xâm nhập độc lập trước closed beta                                                                                                 | [23 §7](23-mo-hinh-du-lieu.md), [25](25-xac-thuc-bao-mat.md)        | Mở                                                                                                                                              |
| T12 | Đối chiếu 20–28 với docs 10–19 sau khi PR #69/#70 vào `main`: sửa link, thống nhất tên sổ cái (`ledger`/`SRC_*` ↔ `ledger_entries`/`SYSTEM_*`), kiểm tra lại số CCU/tick             | [29 Phụ lục C](29-adr.md)                                           | **Đã đối chiếu 2026-11-05**: tên sổ cái thống nhất theo 26 (docs/13, 15, 17 đã sửa); link 20–29 → 10–19 đã kiểm (0 lỗi); phần còn lại xem mục 8 |

## 7. Đề xuất từ thiết kế B (PR #69, chờ game designer duyệt)

- FTUE bước 9 ([16-onboarding.md](16-onboarding.md) §4.2): theo D19 lần đột phá tiểu cảnh đầu tiên là 90% cố định, không đan, không pity. Đề xuất (chưa áp dụng): cân nhắc nâng tỷ lệ riêng cho nhân vật chưa từng đột phá, hoặc giữ nguyên 90%.
- Nút Né trên Mobile: `docs/05` chưa mô tả vị trí ([16-onboarding.md](16-onboarding.md) Q4).
- Đã đối chiếu với 12–19 (PR #69): phần phe / Nghiệp / rơi đồ và chiến tranh Linh Mạch của 01 chuyển sang tham chiếu 14; FTUE của 10 chuyển sang 16, KPI sang 17, nhiệm vụ sang 12, chế tạo sang 13. Còn lệch cần chốt: số Trận Nhãn 3 (14) so với 5 (04 §5) (G15); lợi thế phe (G14); chế phù trong beta (M13).

- Đã đối chiếu với 20–29 (PR #68): số CCU 100 / tick p99 ≤ 40 ms của 10 và `CastStart` / AOE trên lưới ô của 11 đã được 20–24, 28, 29 dùng làm đầu vào; không phát sinh lệch mới (T12 vẫn mở cho phần sổ cái / link của 20–28).

## 8. Rà soát chéo 2026-11-05 (docs 00–29): mâu thuẫn và khoảng trống còn mở

Nguồn: báo cáo rà soát chéo trong mô tả PR của nhánh `docs-cross-review`. Các mục dưới **không được tự quyết**; mỗi mục cần chủ dự án hoặc chủ tài liệu chốt (đề xuất mặc định nằm ở các bảng "Câu hỏi cần chốt" được dẫn).

| #   | Mâu thuẫn / khoảng trống                                                                                                                                                                                                                        | Vị trí                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| X1  | Số World Node ở beta: 1 worker chạy hai `MapInstance` (20 §5.3, 22 §3) hay một World Node mỗi bản đồ / 2 World Node (10 §8.2, M12)                                                                                                              | 10 §8.2, M12; 20 §5.3; 22 §3                |
| X2  | Biên giá niêm yết Vạn Bảo Lâu: 50%–200% giá trung bình 7 ngày (01 G13) hay [P_ref/10, P_ref×10] (26 Q3)                                                                                                                                         | 01 G13; 26 Q3; 24 §8 (`PRICE_OUT_OF_RANGE`) |
| X3  | Tiên Ngọc trong closed beta: tắt hoàn toàn (01 §10.2, G7; 10 §7.3) hay có Tiên Ngọc nội bộ để thử luồng (15 Q8)                                                                                                                                 | 01 §10.2; 10 §7.3; 15 Q8                    |
| X4  | Chương 1 (Luyện Khí) chỉ ghi bản đồ Sơn Môn (12 §3.2), nhưng Sơn Môn không có quái (10 §3, M3: mộc nhân); quái thật đầu tiên ở Bìa rừng Rừng Độc                                                                                                | 12 §3.2; 10 §3, M3                          |
| X5  | Cốt truyện 12 dừng ở chương 3 (đầu Kim Đan) nhưng phạm vi beta có ~12 giờ Kim Đan, boss, Kết Anh (10 §2): chưa có nhiệm vụ / cốt truyện cho Kim Đan                                                                                             | 12 §3.2, Q1; 10 §2                          |
| X6  | Cống hiến có nhiều faucet (12 loại `sect`, 13 Q6, 14 §4–§5, 15) và sink (11 §5 nâng rank, kho tông môn) nhưng không có mục tiêu cân bằng hay chỉ số theo dõi như Linh thạch (26 chỉ có mã `CONG_HIEN`)                                          | 11 §5; 12 §4.2; 14; 15; 26 §1               |
| X7  | `NPC_SELL` là faucet Linh thạch trong 26 (§2.2, I5) nhưng không tài liệu game design nào định nghĩa NPC mua đồ (giá, trần, loại đồ)                                                                                                             | 26 §2.2, I5; 07 §6                          |
| X8  | Chưa có module / giao thức sở hữu: tổ đội (4) + bạn bè (10 §7.1), nhiệm vụ (chỉ có bảng `quest_progress`), tông môn, hàng chờ đấu trường / cờ PK / nút Báo cáo (14), Kiếp Đài và Tâm Cảnh (01 §5.3–§5.4). 24 chỉ giữ chỗ id `sect_*`, `quest_*` | 20 §4; 22; 23; 24 §5; 10 §7.1; 14; 01 §5    |
| X9  | Cửa sổ bảo trì Thứ Tư 05:00–06:00 (15 Q7) trùng giờ reset ngày 05:00 UTC+7 (12 Q2)                                                                                                                                                              | 15 Q7; 12 Q2                                |
| X10 | Ô nhân vật thứ hai bán bằng Tiên Ngọc (15 Q6) trong khi mặc định mỗi tài khoản đã có 3 nhân vật (01 G10, 10 §7.1)                                                                                                                               | 15 Q6; 01 G10                               |
| X11 | Đăng ký "bước 0 ngắn gọn, không email" (16 Q1) so với khai báo ngày sinh khi đăng ký (19 Q6) và email tùy chọn (25 Q4)                                                                                                                          | 16 Q1; 19 Q6; 25 Q4                         |
| X12 | Issue backlog D-25…D-29 đánh số tài liệu lệch thực tế: D-25 "Auth (docs/25)" nhưng docs/25 gồm cả bảo mật; D-27 "Observability", D-28 "Security", D-29 "Test strategy" ứng với docs 27, 25, 28; docs/29 là ADR                                  | Issue #59–#63; 25–29                        |

## 9. Nhân vật (`@vgtd/character`, PR #7): điểm mơ hồ 1–5

Chi tiết và đề xuất: [29-adr.md Phụ lục A](29-adr.md). Các hàng còn mở nằm ở [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md) (F-01…F-05); mã giữ mặc định có thể cấu hình.

1. Animation bất đối xứng của Player (D14): mặc định `attack`, `cast`, `channel`; Boss mặc định không có (ADR-020, F-01).
2. Draw Order vs lật gương: SW/W/NW dùng preset riêng; lật chỉ áp lên hình, `mirrored` chọn biến thể lật.
3. Trục socket: pivot-space y lên, không lật (ADR-021, F-02); `head_top` "theo cỡ nhân vật" chưa có công thức (dùng `socketsOverride`).
4. Quỹ đạo ellipse 36 × 18: rộng × cao đầy đủ hay bán trục (F-05).
5. Định nghĩa "draw call": số engine báo là chuẩn, `checkRepack` chỉ ước lượng tĩnh (ADR-022, F-03).

## 10. Kiếm tu "chi liền": dáng đi váy dài vs bảng animation

1. `GAIT_PROFILES.robe` (opt-in, `rig:assemble --gait robe`) rút ngắn bước chạy/đi cho váy dài; clip giữ thời lượng bảng animation nhưng `motion.speed` ghi trong clip thấp hơn (run ≈ 0,55 × 150 px/s). Runtime cần `timeScale = tốc độ thực / tốc độ ghi` (≈ 1,8×, nhịp bước nhanh hơn) hoặc chấp nhận thay đổi thời lượng; client chưa làm. **Cần chủ dự án quyết:** chấp nhận nhịp nhanh hơn / sửa bảng animation (docs/03) / bỏ `robe` và dùng dáng từ key pose tham chiếu (`docs/art/rig-keypose.md`).
