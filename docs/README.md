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

## Quy ước

- Ngôn ngữ: tiếng Việt, giữ nguyên tiêu đề, bảng và công thức. Công thức LaTeX nằm trong khối `latex`; mã nằm trong khối code có ngôn ngữ (ts, glsl, sql, json, css).
- Ghi chú _[Cập nhật §4: …]_ trong 01 và 02 đánh dấu chỗ khác với bản gốc do áp dụng mục 4 của hồ sơ tổng hợp.
- Các file 03–08 giữ nguyên văn docx. Một số giá trị cũ vẫn có thể nằm trong đó (ví dụ 06 nhắc "thay cho mức 29 MB"); khi gặp, dùng 00 §3–§4.
- Khi đổi thông số: sửa **00 §3** trước, rồi cập nhật tài liệu gốc và ghi vào [DECISIONS.md](DECISIONS.md).
- Docx gốc và hai gói mã (`tutien-procgen.zip`, `tutien-client-input.zip`) nằm ngoài repo.
