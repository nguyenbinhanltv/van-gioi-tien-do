# Tài liệu thiết kế – Vạn Giới Tiên Đồ

MMORPG tu tiên **2D Isometric** (Web H5 · Mobile · PC, cross-play), client Cocos Creator 3.x, server TypeScript.

Thư mục này là bản Markdown của bộ tài liệu thiết kế (chuyển từ `.docx`). **Nguồn chuẩn khi các tài liệu mâu thuẫn:** [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) — mục 3 (Thông số chuẩn hợp nhất) và mục 4 (Quyết định đã thay thế).

## Mục lục

| #   | File                                                       | Nội dung                                                                                                                          | Ghi chú                                                              |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 00  | [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md)               | Hồ sơ tổng hợp: bản đồ tài liệu, thông số chuẩn, quyết định thay thế, việc còn mở                                                 | Chuyển nguyên văn từ docx                                            |
| 01  | [01-gdd.md](01-gdd.md)                                     | GDD đầy đủ: tầm nhìn, core loop 4 tầng thời gian, 9 cảnh giới, Tâm Ma / Lôi Kiếp, Nghiệp Lực, tông môn, kinh tế, Động Phủ, xã hội | Dựng lại từ 00 + 07 (không có docx) + **thiết kế bổ sung chờ duyệt** |
| 02  | [02-asset-matrix-2d.md](02-asset-matrix-2d.md)             | Asset Breakdown Matrix 2D: engine, Y-sort, lớp vẽ, đóng gói, các bảng asset                                                       | Đã áp dụng §4 (25 MB, 6 phẩm, icon, Lôi Kiếp, Vạn Kiếm)              |
| 03  | [03-nhan-vat-quai-vat.md](03-nhan-vat-quai-vat.md)         | Nhân vật & Quái vật: Spine vs pre-render, paperdoll 8 hướng, socket, boss đa ô                                                    | Chuyển nguyên văn                                                    |
| 04  | [04-tilemap.md](04-tilemap.md)                             | Tilemap Isometric: lưới 64 × 32, Wang, vách, 2 bản đồ, Động Phủ                                                                   | Chuyển nguyên văn                                                    |
| 05  | [05-ui-ux-icon.md](05-ui-ux-icon.md)                       | UI/UX & Icon cross-platform: bố cục theo chế độ nhập, 9-slice, icon, 6 phẩm                                                       | Chuyển nguyên văn                                                    |
| 06  | [06-toi-uu-render.md](06-toi-uu-render.md)                 | Tối ưu render: Vạn Kiếm instancing, Lôi Kiếp procedural, shader, streaming, ngân sách RAM                                         | Chuyển nguyên văn                                                    |
| 07  | [07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md) | Công thức & Data Schema: chỉ số, đột phá, Lôi Kiếp, Ngũ hành, drop, JSON Schema                                                   | Nguồn số liệu gameplay                                               |
| 08  | [08-server-architecture.md](08-server-architecture.md)     | Kiến trúc server realtime: AOI, handover, đồng bộ, anti-cheat, microservices                                                      | Chuyển nguyên văn                                                    |
| 10  | [10-mvp-scope.md](10-mvp-scope.md)                         | Phạm vi closed beta: cảnh giới 1–3, 2 bản đồ, quái / vật phẩm, IN / OUT, CCU, KPI, mốc P1–P5                                      | **Thiết kế mới – chờ duyệt** (có mục "Câu hỏi cần chốt")             |
| 11  | [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md)             | Hệ phái (4 Đạo Lộ) và hệ thống kỹ năng: mô hình dữ liệu, AOE trên lưới iso, 32 kỹ năng MVP, JSON Schema                           | **Thiết kế mới – chờ duyệt** (có mục "Câu hỏi cần chốt")             |
| —   | [DECISIONS.md](DECISIONS.md)                               | Nhật ký quyết định (cũ → hiện hành) từ §4                                                                                         |                                                                      |
| —   | [OPEN-ITEMS.md](OPEN-ITEMS.md)                             | Việc còn mở (§7) và các mảng thiết kế chưa có tài liệu                                                                            |                                                                      |
| —   | [assets/](assets/)                                         | Sơ đồ trích từ docx (02, 03, 04, 05, 06, 08)                                                                                      |                                                                      |

## Thiết kế kỹ thuật (20–29)

Bộ tài liệu thiết kế hệ thống cho MVP (server modular monolith, client Cocos, dữ liệu, giao thức, bảo mật, kinh tế, vận hành, kiểm thử). Mọi mục ghi "Đề xuất – chờ duyệt" **chưa có hiệu lực** cho tới khi vào [DECISIONS.md](DECISIONS.md); không tài liệu nào đổi [00 §3–4](00-ho-so-tong-hop.md). Tài liệu game design (01, 10–19) do nhóm khác viết.

| #   | File                                                   | Nội dung                                                                                      |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 20  | [20-kien-truc-tong-the.md](20-kien-truc-tong-the.md)   | C4, ranh giới module monolith ↔ microservice, mô hình tiến trình/luồng, docker-compose cục bộ |
| 21  | [21-kien-truc-client.md](21-kien-truc-client.md)       | Phân tầng client, bootstrap, store, bundle/streaming, UI AnchorLayout, y-flip, Spine, perf    |
| 22  | [22-server-modules.md](22-server-modules.md)           | Từng module: trách nhiệm, cổng, trạng thái, ngân sách tick, AOI, handover, chế độ lỗi         |
| 23  | [23-mo-hinh-du-lieu.md](23-mo-hinh-du-lieu.md)         | ERD PostgreSQL, Redis key, migration, chiến lược ID, lưu giữ dữ liệu                          |
| 24  | [24-giao-thuc-mang.md](24-giao-thuc-mang.md)           | Vận chuyển, khung gói, phiên bản, danh mục thông điệp, rate limit, ngân sách băng thông       |
| 25  | [25-xac-thuc-bao-mat.md](25-xac-thuc-bao-mat.md)       | Mật khẩu argon2id, JWT + refresh, SSO, STRIDE, tín hiệu anti-cheat                            |
| 26  | [26-kinh-te-ledger.md](26-kinh-te-ledger.md)           | Sổ cái kép, giao dịch idempotent, chợ/đấu giá, faucet/sink, kế hoạch mô phỏng kinh tế         |
| 27  | [27-van-hanh-quan-sat.md](27-van-hanh-quan-sat.md)     | Log, metric, trace, telemetry, dashboard, báo lỗi, cấu hình và cờ tính năng                   |
| 28  | [28-chien-luoc-kiem-thu.md](28-chien-luoc-kiem-thu.md) | Đơn vị/thuộc tính/xác định, replay, tích hợp, loadbot, hiệu năng thiết bị, các giai đoạn CI   |
| 29  | [29-adr.md](29-adr.md)                                 | Chỉ mục ADR, đề xuất mới, giải quyết điểm mơ hồ của PR #7/#9/#10 và OPEN-ITEMS §6             |

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

| - | [art/dragonbones.md](art/dragonbones.md) | DragonBones thay Spine (D35): editor/giấy phép, runtime Cocos 3.8.8, rủi ro, dự phòng |

## Quy ước

- Ngôn ngữ: tiếng Việt, giữ nguyên tiêu đề, bảng và công thức. Công thức LaTeX nằm trong khối `latex`; mã nằm trong khối code có ngôn ngữ (ts, glsl, sql, json, css).
- Ghi chú _[Cập nhật §4: …]_ trong 01 và 02 đánh dấu chỗ khác với bản gốc do áp dụng mục 4 của hồ sơ tổng hợp.
- Các file 03–08 giữ nguyên văn docx. Một số giá trị cũ vẫn có thể nằm trong đó (ví dụ 06 nhắc "thay cho mức 29 MB"); khi gặp, dùng 00 §3–§4.
- Khi đổi thông số: sửa **00 §3** trước, rồi cập nhật tài liệu gốc và ghi vào [DECISIONS.md](DECISIONS.md).
- Docx gốc và hai gói mã (`tutien-procgen.zip`, `tutien-client-input.zip`) nằm ngoài repo.
