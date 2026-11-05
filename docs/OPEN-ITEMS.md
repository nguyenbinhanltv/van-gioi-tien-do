# Việc còn mở & mảng thiết kế còn thiếu

Nguồn: [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) §6 (chưa kiểm tra được) và §7 (việc còn mở).

## 1. Việc cần làm

| #   | Việc                                                                                                   | Lý do                                                       | Ưu tiên    | Trạng thái                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Cập nhật GDD sang 2D Isometric / Web / Cocos Creator, số Ngũ hành và công thức đột phá mới             | GDD vẫn ghi 3D, UE5 và các giá trị cũ ở D1–D4, D8–D10       | Cao        | **Đã làm trong repo**: [01-gdd.md](01-gdd.md) (dựng lại do không có docx GDD). Cần chủ GDD đối chiếu với bản gốc |
| 2   | Cập nhật Asset Matrix: gói đầu 25 MB, 6 phẩm, kích thước icon                                          | Tránh hai tài liệu nói hai số khác nhau                     | Cao        | **Đã làm**: [02-asset-matrix-2d.md](02-asset-matrix-2d.md)                                                       |
| 3   | Ánh xạ `orchestrator_pipeline.yaml` theo schema thật của orchestrator.inc                              | Chưa có tài liệu schema công khai                           | Cao        | Mở                                                                                                               |
| 4   | Chạy pipeline trên runner thật (basisu, astcenc, claude, codex, agy)                                   | Các bước này chưa kiểm tra được                             | Cao        | Mở                                                                                                               |
| 5   | Prototype client trong Cocos Creator: InputManager + tilemap sinh tự động + 1 nhân vật Spine paperdoll | Kiểm chứng ngân sách draw call, RAM và Y-sort trên máy thật | Cao        | Mở                                                                                                               |
| 6   | Module `step()` dùng chung client / server, World Node mẫu, đo AOI với 100 vs 100                      | Kiểm chứng băng thông và CPU của tài liệu Server            | Trung bình | Mở                                                                                                               |
| 7   | Mô phỏng kinh tế (drop so với tiêu hao) trước closed beta                                              | Khóa các hệ số trong Công thức bằng dữ liệu                 | Trung bình | Mở                                                                                                               |
| 8   | Shader nước lệch hoa văn theo tọa độ thế giới                                                          | Hồ lớn đang thấy hoa văn lặp                                | Thấp       | Mở                                                                                                               |

## 2. Chưa kiểm tra được (từ §6)

- Nén KTX2 / ASTC (basisu, astcenc không có trong môi trường thử).
- Ba bước gọi Codex, Antigravity và Claude Code trong pipeline (cần khóa và tài khoản trên runner).
- Bước deploy (cần repo client thật) và schema thật của orchestrator.inc.
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

- Không có docx GDD riêng; 01-gdd.md chỉ chứa những gì hồ sơ tổng hợp và tài liệu Công thức ghi lại. Các tầng vòng lặp thời gian (5 phút → 12 tháng), cơ chế riêng của từng cảnh giới và chi tiết chiến tranh Linh Mạch chưa có nguồn chi tiết.
- 03–08 giữ nguyên văn docx, kể cả các chỗ nhắc giá trị cũ để so sánh.
