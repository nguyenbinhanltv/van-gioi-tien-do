# Việc còn mở & mảng thiết kế còn thiếu

Nguồn: [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) §6 (chưa kiểm tra được) và §7 (việc còn mở).

## 1. Việc cần làm

| #   | Việc                                                                                                   | Lý do                                                       | Ưu tiên    | Trạng thái                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Cập nhật GDD sang 2D Isometric / Web / Cocos Creator, số Ngũ hành và công thức đột phá mới             | GDD vẫn ghi 3D, UE5 và các giá trị cũ ở D1–D4, D8–D10       | Cao        | **Đã làm trong repo**: [01-gdd.md](01-gdd.md) (dựng lại do không có docx GDD). Cần chủ GDD đối chiếu với bản gốc |
| 2   | Cập nhật Asset Matrix: gói đầu 25 MB, 6 phẩm, kích thước icon                                          | Tránh hai tài liệu nói hai số khác nhau                     | Cao        | **Đã làm**: [02-asset-matrix-2d.md](02-asset-matrix-2d.md)                                                       |
| 3   | Ánh xạ `orchestrator_pipeline.yaml` theo schema thật của orchestrator.inc                              | Chưa có tài liệu schema công khai                           | Cao        | **Thay bằng GitHub Actions** (D28, D29): không cần ánh xạ orchestrator                                           |
| 4   | Chạy pipeline trên runner thật (basisu, astcenc, claude, codex, agy)                                   | Các bước này chưa kiểm tra được                             | Cao        | **Thay bằng GitHub Actions** (D28): CI ngắn, không CD                                                            |
| 5   | Prototype client trong Cocos Creator: InputManager + tilemap sinh tự động + 1 nhân vật Spine paperdoll | Kiểm chứng ngân sách draw call, RAM và Y-sort trên máy thật | Cao        | Mở                                                                                                               |
| 6   | Module `step()` dùng chung client / server, World Node mẫu, đo AOI với 100 vs 100                      | Kiểm chứng băng thông và CPU của tài liệu Server            | Trung bình | Mở                                                                                                               |
| 7   | Mô phỏng kinh tế (drop so với tiêu hao) trước closed beta                                              | Khóa các hệ số trong Công thức bằng dữ liệu                 | Trung bình | Mở                                                                                                               |
| 8   | Shader nước lệch hoa văn theo tọa độ thế giới                                                          | Hồ lớn đang thấy hoa văn lặp                                | Thấp       | Mở                                                                                                               |

## 2. Chưa kiểm tra được (từ §6)

- Nén KTX2 / ASTC (basisu, astcenc không có trong môi trường thử).
- Ba bước gọi Codex, Antigravity và Claude Code trong `orchestrator_pipeline.yaml` (chỉ còn là tài liệu tham khảo, D29).
- Bước deploy: không còn trong phạm vi (D28: không CD). "orchestrator.inc" trong tài liệu nguồn là nhầm lẫn (D29).
- Demo canvas `example/` của gói client mới biên dịch, chưa chạy trong trình duyệt thật.

## 3. Mảng chưa có tài liệu thiết kế

- Nhiệm vụ và cốt truyện
- Nghề luyện đan / luyện khí / chế phù chi tiết
- Luật PvP và đấu trường
- Kiếm tiền (Tiên Ngọc, Battle Pass, cửa hàng)
- Hướng dẫn người chơi mới (onboarding)
- Sự kiện và LiveOps
- Đo lường (telemetry, dashboard KPI)

## 4. Lưu ý khi chuyển đổi tài liệu

- Không có docx GDD riêng; 01-gdd.md chỉ chứa những gì hồ sơ tổng hợp và tài liệu Công thức ghi lại. Các tầng vòng lặp thời gian (5 phút → 12 tháng), cơ chế riêng của từng cảnh giới và chiến tranh Linh Mạch hiện có **thiết kế đề xuất** trong 01 §3–§4, §9 (chờ duyệt, mục 4a); vẫn chưa có nguồn gốc.
- 03–08 giữ nguyên văn docx, kể cả các chỗ nhắc giá trị cũ để so sánh.

## 4a. Thiết kế bổ sung chờ chủ dự án duyệt (PR #70)

Các tài liệu [01-gdd.md](01-gdd.md), [10-mvp-scope.md](10-mvp-scope.md), [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md) đã **thiết kế bổ sung** các tầng thời gian, cơ chế từng cảnh giới, chiến tranh Linh Mạch, Nghiệp Lực / Đạo Tâm, phạm vi closed beta và hệ phái / kỹ năng. **Mọi giá trị mới là đề xuất, chờ chủ dự án duyệt** (chưa phải quyết định; chưa vào DECISIONS). Các câu hỏi cần chốt (mỗi mục có mặc định đề xuất):

- GDD: mục "Câu hỏi cần chốt" của 01 (G1–G13), gồm ba mức hậu quả Lôi Kiếp (G1), Linh Mạch 5 hay 6 phẩm (G6).
- MVP: mục "Câu hỏi cần chốt" của 10 (M1–M12).
- Hệ phái / kỹ năng: mục "Câu hỏi cần chốt" của 11 (S1–S11).
- Cần duyệt thêm: ρ của Hậu sơn Sơn Môn khi đả tọa (0,6 theo 07 §5 hay giá trị riêng) — 01 §11.

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
