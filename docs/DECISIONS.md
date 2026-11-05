# Nhật ký quyết định

Nguồn: [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) §4 "Các quyết định đã bị thay thế". Cột "Hiện hành" là giá trị có hiệu lực. Cột "Đã áp dụng ở" cho biết tài liệu Markdown nào đã được sửa cho khớp.

| #   | Hạng mục            | Cũ                                                                    | Hiện hành                                                                                                     | Thay ở (tài liệu quyết định) | Đã áp dụng ở |
| --- | ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------ |
| D1  | Thể loại / góc nhìn | MMORPG 3D thế giới mở (GDD)                                           | 2D Isometric 2:1, thế giới mở chia chunk                                                                      | Asset Matrix bản 2D          | 01, 02       |
| D2  | Engine              | Unreal Engine 5 (GDD, Matrix bản 3D)                                  | Cocos Creator 3.x (dự phòng: Unity 2D, Godot 4)                                                               | Asset Matrix bản 2D          | 01, 02       |
| D3  | Nền tảng            | PC + Mobile                                                           | Web H5 + Mobile + PC, cross-play                                                                              | Asset Matrix bản 2D          | 01, 02       |
| D4  | Hình thức asset     | Mesh, LOD, Nanite, Niagara                                            | Sprite Sheet, Spine 2D, Tilemap diamond, Particle 2D, sprite shader                                           | Asset Matrix bản 2D          | 01, 02       |
| D5  | Gói tải đầu Web     | 30 MB (dự phòng 1 MB → 29 MB)                                         | **25 MB** (6 + 4 + 4 + 5 + 3 + 1 + 2 dự phòng)                                                                | Tối ưu render (06)           | 01, 02       |
| D6  | Thang phẩm chất     | 5 phẩm (pháp bảo, đan dược, viền)                                     | **6 phẩm: Trắng → Lục → Lam → Tím → Vàng → Đỏ** (có dấu góc cho người mù màu)                                 | UI/UX (05)                   | 01, 02       |
| D7  | Kích thước icon     | Nguồn 512, hiển thị 256 (bản 3D); nguồn 256, hiển thị 128 (Matrix 2D) | **Nguồn 256, xuất 48 / 64 / 128**                                                                             | UI/UX (05)                   | 01, 02       |
| D8  | Ngũ hành khắc chế   | +30% sát thương, xuyên 20% kháng                                      | **+25% sát thương, −15% Thủ mục tiêu; bị khắc −15%**                                                          | Công thức (07)               | 01           |
| D9  | Tương sinh          | +20% buff và hồi phục cho đồng đội hệ được sinh                       | **Hồi 10% Chân Nguyên** khi hỗ trợ đồng đội hệ được sinh (hồi chiêu 10 s)                                     | Công thức (07)               | 01           |
| D10 | Công thức đột phá   | Cộng dồn: Base + Đan + Trận + Đạo tâm + 8%·thất bại                   | `clamp(Base_eff · (1 + Pill) − Karma_Penalty, 5%, 95%)`; pity +8%/lần, trần 40%                               | Công thức (07)               | 01           |
| D11 | Lôi Kiếp (cơ chế)   | Mô tả định tính (số đạo, telegraph)                                   | Sát thương thuần theo đợt, κ_r cho từng ngưỡng, nguồn giảm trừ bắt buộc; `Strike = HP_ref · κ_r · 1,22^(w−1)` | Công thức (07)               | 01           |
| D12 | VFX Lôi Kiếp        | Flipbook 128 × 512, 8 frame, 4 biến thể                               | **Procedural** (fBm, segment mesh), không texture                                                             | Tối ưu render (06)           | 01, 02       |
| D13 | Vạn Kiếm Quy Tông   | Niagara / flipbook                                                    | **1 sprite kiếm + GPU instancing**, quỹ đạo tính trong vertex shader                                          | Tối ưu render (06)           | 01, 02       |

## Ghi chú

- Không có docx GDD: 01-gdd.md được dựng lại từ hồ sơ tổng hợp và tài liệu Công thức (xem đầu file đó).
- 03–08 không bị sửa vì hồ sơ tổng hợp ghi chúng đang "Hiệu lực"; 07 đã chứa số liệu mới (D8–D11), 06 đã chứa D5, D12, D13, 05 đã chứa D6, D7.
- Thông số chuẩn hợp nhất (nền tảng, lưới, layer, atlas, ngân sách hiệu năng, mạng): [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) §3.
