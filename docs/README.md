# Tài liệu thiết kế – Vạn Giới Tiên Đồ

MMORPG tu tiên **2D Isometric** (Web H5 · Mobile · PC, cross-play), client Cocos Creator 3.x, server TypeScript.

Thư mục này là bản Markdown của bộ tài liệu thiết kế (chuyển từ `.docx`). **Nguồn chuẩn khi các tài liệu mâu thuẫn:** [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) — mục 3 (Thông số chuẩn hợp nhất) và mục 4 (Quyết định đã thay thế).

## Mục lục

| #   | File                                                       | Nội dung                                                                                  | Ghi chú                                                    |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 00  | [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md)               | Hồ sơ tổng hợp: bản đồ tài liệu, thông số chuẩn, quyết định thay thế, việc còn mở         | Chuyển nguyên văn từ docx                                  |
| 01  | [01-gdd.md](01-gdd.md)                                     | GDD High Level: core loop, 9 cảnh giới, Ngũ hành, phe phái, kinh tế                       | **Không có docx GDD** — dựng lại từ 00 + 07, đã áp dụng §4 |
| 02  | [02-asset-matrix-2d.md](02-asset-matrix-2d.md)             | Asset Breakdown Matrix 2D: engine, Y-sort, lớp vẽ, đóng gói, các bảng asset               | Đã áp dụng §4 (25 MB, 6 phẩm, icon, Lôi Kiếp, Vạn Kiếm)    |
| 03  | [03-nhan-vat-quai-vat.md](03-nhan-vat-quai-vat.md)         | Nhân vật & Quái vật: Spine vs pre-render, paperdoll 8 hướng, socket, boss đa ô            | Chuyển nguyên văn                                          |
| 04  | [04-tilemap.md](04-tilemap.md)                             | Tilemap Isometric: lưới 64 × 32, Wang, vách, 2 bản đồ, Động Phủ                           | Chuyển nguyên văn                                          |
| 05  | [05-ui-ux-icon.md](05-ui-ux-icon.md)                       | UI/UX & Icon cross-platform: bố cục theo chế độ nhập, 9-slice, icon, 6 phẩm               | Chuyển nguyên văn                                          |
| 06  | [06-toi-uu-render.md](06-toi-uu-render.md)                 | Tối ưu render: Vạn Kiếm instancing, Lôi Kiếp procedural, shader, streaming, ngân sách RAM | Chuyển nguyên văn                                          |
| 07  | [07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md) | Công thức & Data Schema: chỉ số, đột phá, Lôi Kiếp, Ngũ hành, drop, JSON Schema           | Nguồn số liệu gameplay                                     |
| 08  | [08-server-architecture.md](08-server-architecture.md)     | Kiến trúc server realtime: AOI, handover, đồng bộ, anti-cheat, microservices              | Chuyển nguyên văn                                          |
| —   | [DECISIONS.md](DECISIONS.md)                               | Nhật ký quyết định (cũ → hiện hành) từ §4                                                 |                                                            |
| —   | [OPEN-ITEMS.md](OPEN-ITEMS.md)                             | Việc còn mở (§7) và các mảng thiết kế chưa có tài liệu                                    |                                                            |
| —   | [assets/](assets/)                                         | Sơ đồ trích từ docx (02, 03, 04, 05, 06, 08)                                              |                                                            |

## Thiết kế bổ sung (12–19, đề xuất – chờ duyệt)

Các mảng mà hồ sơ gốc chưa có ([OPEN-ITEMS.md](OPEN-ITEMS.md) §3). Số liệu đã có hiệu lực chỉ được trích từ 07 / `@vgtd/shared`; con số mới được đánh dấu _Đề xuất – chờ duyệt_. Mỗi file kết thúc bằng danh sách "Câu hỏi cần chốt" kèm mặc định đề xuất.

| #   | File                                                   | Nội dung                                                                                        |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 12  | [12-nhiem-vu-cot-truyen.md](12-nhiem-vu-cot-truyen.md) | Loại nhiệm vụ, cốt truyện MVP, ngân sách phần thưởng, mô hình dữ liệu và JSON Schema            |
| 13  | [13-che-tao.md](13-che-tao.md)                         | Luyện đan / luyện khí / chế phù: nguyên liệu, thành công, phân phối phẩm, sink kinh tế          |
| 14  | [14-pvp-chien-tranh.md](14-pvp-chien-tranh.md)         | Luật PvP theo vùng, Nghiệp Lực, đấu trường, chiến tranh Linh Mạch, chống quấy phá               |
| 15  | [15-kiem-tien-liveops.md](15-kiem-tien-liveops.md)     | Tiên Ngọc, Battle Pass, cửa hàng, danh sách "không bao giờ bán", lịch LiveOps, chống lạm phát   |
| 16  | [16-onboarding.md](16-onboarding.md)                   | 30 phút đầu trên PC và Mobile, gate tính năng, móc giữ chân                                     |
| 17  | [17-telemetry-kpi.md](17-telemetry-kpi.md)             | Phân loại sự kiện, KPI, dashboard, giám sát kinh tế, tín hiệu gian lận, quyền riêng tư          |
| 18  | [18-art-bible-am-thanh.md](18-art-bible-am-thanh.md)   | Art bible (phong cách, màu, VFX Ngũ hành), âm thanh, quy tắc asset AI / placeholder / giấy phép |
| 19  | [19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md)       | Chiến lược i18n và phông chữ; checklist pháp lý Việt Nam (**phải được luật sư xác minh**)       |

## Quy ước

- Ngôn ngữ: tiếng Việt, giữ nguyên tiêu đề, bảng và công thức. Công thức LaTeX nằm trong khối `latex`; mã nằm trong khối code có ngôn ngữ (ts, glsl, sql, json, css).
- Ghi chú _[Cập nhật §4: …]_ trong 01 và 02 đánh dấu chỗ khác với bản gốc do áp dụng mục 4 của hồ sơ tổng hợp.
- Các file 03–08 giữ nguyên văn docx. Một số giá trị cũ vẫn có thể nằm trong đó (ví dụ 06 nhắc "thay cho mức 29 MB"); khi gặp, dùng 00 §3–§4.
- Khi đổi thông số: sửa **00 §3** trước, rồi cập nhật tài liệu gốc và ghi vào [DECISIONS.md](DECISIONS.md).
- Docx gốc và hai gói mã (`tutien-procgen.zip`, `tutien-client-input.zip`) nằm ngoài repo.
