# Tài liệu – Vạn Giới Tiên Đồ

MMORPG tu tiên **2D Isometric** (Web H5 · Mobile · PC, cross-play), client Cocos Creator 3.x, server TypeScript. Đây là mục lục duy nhất của `docs/`; tài liệu viết bằng tiếng Việt.

## Thứ bậc căn cứ khi tài liệu mâu thuẫn

1. [DECISIONS.md](DECISIONS.md): nhật ký quyết định D1–D77+. Mục càng mới càng thắng; D14 trở đi ghi đè mọi tài liệu bên dưới, kể cả khi văn bản cũ còn nguyên. D1–D13 là các quyết định đã thay thế từ hồ sơ gốc (từng nằm ở 00 §4).
2. [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) §3: thông số chuẩn hợp nhất.
3. `@vgtd/shared` (dạng thực thi của 1–2; test tái hiện ví dụ trong [07](07-cong-thuc-data-schema.md)).
4. Các tài liệu chi tiết bên dưới. Nếu mâu thuẫn với 1–3, chúng thua.

**Mỗi con số, mỗi luật có một nơi ở.** Hằng số và công thức: `@vgtd/shared` + 00 §3 + 07. Quyết định đã khóa: DECISIONS. Câu hỏi còn chờ chủ dự án: [31](31-bang-quyet-dinh.md) (các mục "Câu hỏi cần chốt" trong 01 và 10–29 chỉ còn là con trỏ về đây). Việc còn mở và điểm mơ hồ kỹ thuật: [OPEN-ITEMS.md](OPEN-ITEMS.md). Nguồn gốc và giấy phép asset: [ASSET-LICENSES.md](ASSET-LICENSES.md). Tài liệu khác chỉ trích và dẫn link.

## 1. Thiết kế game

| #   | File                                                   | Nội dung                                                                                                                                                           |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | [01-gdd.md](01-gdd.md)                                 | GDD: tầm nhìn, core loop 4 tầng thời gian, 9 cảnh giới, Tâm Ma / Lôi Kiếp, Nghiệp Lực, tông môn, kinh tế, Động Phủ, xã hội                                         |
| 10  | [10-mvp-scope.md](10-mvp-scope.md)                     | Phạm vi closed beta: cảnh giới 1–3, 2 bản đồ, quái / vật phẩm, IN / OUT, CCU, KPI, mốc P1–P5                                                                       |
| 11  | [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md)         | Hệ phái (6 Đạo Lộ, D49) và kỹ năng: dữ liệu, AOE trên lưới iso, 48 kỹ năng MVP + 12 công pháp nhánh, mô phỏng cân bằng, schema                                     |
| 12  | [12-nhiem-vu-cot-truyen.md](12-nhiem-vu-cot-truyen.md) | Loại nhiệm vụ, cốt truyện MVP, ngân sách phần thưởng, mô hình dữ liệu                                                                                              |
| 13  | [13-che-tao.md](13-che-tao.md)                         | Luyện đan / luyện khí / chế phù: nguyên liệu, thành công, phân phối phẩm, sink                                                                                     |
| 14  | [14-pvp-chien-tranh.md](14-pvp-chien-tranh.md)         | Luật PvP theo vùng, Nghiệp Lực, đấu trường, chiến tranh Linh Mạch                                                                                                  |
| 15  | [15-kiem-tien-liveops.md](15-kiem-tien-liveops.md)     | Tiên Ngọc, Battle Pass, cửa hàng, danh sách "không bao giờ bán", lịch LiveOps                                                                                      |
| 16  | [16-onboarding.md](16-onboarding.md)                   | 30 phút đầu trên PC và Mobile, gate tính năng, móc giữ chân                                                                                                        |
| 17  | [17-telemetry-kpi.md](17-telemetry-kpi.md)             | Sự kiện, KPI, dashboard, giám sát kinh tế, tín hiệu gian lận, quyền riêng tư                                                                                       |
| 18  | [18-art-bible-am-thanh.md](18-art-bible-am-thanh.md)   | Art bible (màu, VFX Ngũ hành, UI), âm thanh, quy tắc asset AI / placeholder / giấy phép. Nhân vật Player: mục 4 (chỉ còn đúng cho NPC / quái; Player theo D41/D44) |
| 19  | [19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md)       | i18n và phông chữ; checklist pháp lý Việt Nam (**phải được luật sư xác minh**)                                                                                     |

Các mục ghi _Đề xuất – chờ duyệt_ chưa có hiệu lực cho tới khi vào DECISIONS; không tài liệu nào đổi 00 §3.

## 2. Đặc tả nền (từ hồ sơ gốc; một số chỗ đã bị DECISIONS ghi đè)

| #   | File                                                       | Nội dung                                                                                     |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 00  | [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md)               | Tổng quan và **thông số chuẩn hợp nhất** (§3)                                                |
| 02  | [02-asset-matrix-2d.md](02-asset-matrix-2d.md)             | Asset Matrix 2D: engine, Y-sort, lớp vẽ, đóng gói, bảng asset                                |
| 03  | [03-nhan-vat-quai-vat.md](03-nhan-vat-quai-vat.md)         | Nhân vật và quái vật: paperdoll, socket, hitbox, boss đa ô (Player nay theo D41, xem art/)   |
| 04  | [04-tilemap.md](04-tilemap.md)                             | Tilemap isometric: lưới 64 × 32, Wang, vách, 2 bản đồ, Động Phủ                              |
| 05  | [05-ui-ux-icon.md](05-ui-ux-icon.md)                       | UI/UX và icon cross-platform: bố cục theo chế độ nhập, 9-slice, icon, 6 phẩm                 |
| 06  | [06-toi-uu-render.md](06-toi-uu-render.md)                 | Tối ưu render: Vạn Kiếm instancing, Lôi Kiếp procedural, shader, streaming, ngân sách RAM    |
| 07  | [07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md) | Công thức và data schema: chỉ số, đột phá, Lôi Kiếp, Ngũ hành, drop (nguồn số liệu gameplay) |
| 08  | [08-server-architecture.md](08-server-architecture.md)     | Kiến trúc server realtime: AOI, handover, đồng bộ, anti-cheat                                |

Sơ đồ trích từ bản gốc nằm ở [assets/](assets/) (02, 03, 04, 05, 06, 08). Ghi chú _[Cập nhật §4: …]_ trong 01 và 02 đánh dấu chỗ khác bản gốc do áp dụng các quyết định D1–D13.

## 3. Thiết kế kỹ thuật (20–29, 33, 34)

Bộ thiết kế hệ thống cho MVP. Mục ghi "Đề xuất – chờ duyệt" chưa có hiệu lực cho tới khi vào DECISIONS.

| #   | File                                                   | Nội dung                                                                                                 |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 20  | [20-kien-truc-tong-the.md](20-kien-truc-tong-the.md)   | C4, ranh giới module monolith ↔ microservice, tiến trình/luồng, docker-compose cục bộ                    |
| 21  | [21-kien-truc-client.md](21-kien-truc-client.md)       | Phân tầng client, bootstrap, store, bundle/streaming, UI AnchorLayout, y-flip, hoạt cảnh, perf           |
| 22  | [22-server-modules.md](22-server-modules.md)           | Từng module: trách nhiệm, cổng, trạng thái, ngân sách tick, AOI, handover, chế độ lỗi                    |
| 23  | [23-mo-hinh-du-lieu.md](23-mo-hinh-du-lieu.md)         | ERD PostgreSQL, Redis key, migration, chiến lược ID, lưu giữ dữ liệu                                     |
| 24  | [24-giao-thuc-mang.md](24-giao-thuc-mang.md)           | Khung gói, phiên bản, danh mục thông điệp, rate limit, ngân sách băng thông                              |
| 25  | [25-xac-thuc-bao-mat.md](25-xac-thuc-bao-mat.md)       | Mật khẩu, JWT + refresh, SSO, STRIDE, tín hiệu anti-cheat                                                |
| 26  | [26-kinh-te-ledger.md](26-kinh-te-ledger.md)           | Sổ cái kép, giao dịch idempotent, chợ/đấu giá, faucet/sink, mô phỏng kinh tế                             |
| 27  | [27-van-hanh-quan-sat.md](27-van-hanh-quan-sat.md)     | Log, metric, trace, telemetry, dashboard, cấu hình và cờ tính năng                                       |
| 28  | [28-chien-luoc-kiem-thu.md](28-chien-luoc-kiem-thu.md) | Đơn vị/thuộc tính/xác định, replay, tích hợp, loadbot, hiệu năng thiết bị, CI                            |
| 29  | [29-adr.md](29-adr.md)                                 | Chỉ mục ADR, đề xuất mới, giải quyết điểm mơ hồ của PR #7/#9/#10 (phụ lục A–C)                           |
| 33  | [33-p1-perf.md](33-p1-perf.md)                         | Đo hiệu năng P1 (client slice) và báo cáo thoát P1                                                       |
| 34  | [34-combat-server.md](34-combat-server.md)             | Combat phía server: lõi giải quyết cast (D75)                                                            |
| 35  | [35-p5-load-test.md](35-p5-load-test.md)               | Kiểm thử tải P5: bot chơi thật, soak ngắn / dài, khói CI (D100)                                          |
| 38  | [38-van-bao-lau.md](38-van-bao-lau.md)                 | Vạn Bảo Lâu cơ bản: ký quỹ, mua nguyên tử, phí 1 % + thuế cố định 5 %, CPI bóng (D112)                   |
| 39  | [39-bo-nho-batcher2d.md](39-bo-nho-batcher2d.md)       | Đo bộ nhớ của bộ đệm đỉnh Batcher2D (`BATCHER2D_MEM_INCREMENT` 144 / 1024 / 2048 KB) bằng giả lập mobile |

## 4. Art và hoạt cảnh (`art/`)

| File                                                                                 | Nội dung                                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [art/sprite-sheet-pipeline.md](art/sprite-sheet-pipeline.md)                         | Pipeline sprite sheet AI từng khung cho thân Player (D41): hợp đồng công cụ `@vgtd/sprite`        |
| [art/style-semichibi.md](art/style-semichibi.md)                                     | Phong cách semi-chibi (D44); [sheet tỉ lệ](art/semichibi-proportions.svg). Thắng 18 §4 cho Player |
| [art/the-tu.md](art/the-tu.md)                                                       | Thể tu: tài sản chung và ghi chú sản xuất từng hướng (E, SE, S, NE, N)                            |
| [art/dragonbones.md](art/dragonbones.md)                                             | DragonBones (D35): runtime Cocos 3.8.8, rủi ro, dự phòng; còn đúng cho Boss / NPC                 |
| [art/rig-pipeline.md](art/rig-pipeline.md)                                           | Quy trình rig và hoạt cảnh bằng AI (D36, `@vgtd/rig`): Boss / NPC                                 |
| [art/parts-spec.md](art/parts-spec.md)                                               | Đặc tả mảnh cho từng Đạo Lộ (**sinh tự động**, CI kiểm khớp)                                      |
| [art/rig-legacy-player.md](art/rig-legacy-player.md)                                 | Rig Player thời D39/D40 (lịch sử, thay thế một phần bởi D41)                                      |
| [art/rig-underpaint.md](art/rig-underpaint.md)                                       | Danh sách phần cần vẽ bù của rig Kiếm tu (sinh bởi `underpaintNeeds`)                             |
| [art/identity-temporal-calibration-d55.md](art/identity-temporal-calibration-d55.md) | Gate palette identity và temporal review (D55)                                                    |
| [art/head-reason-similarity-audit-d54.md](art/head-reason-similarity-audit-d54.md)   | Tóm tắt audit similarity đầu (D54)                                                                |
| `art/*.json`                                                                         | Đầu vào của công cụ / test (`head-reason-similarity-cohort-d54`, `smooth-clock-migration`)        |
| [art/reviews/TEMPLATE.md](art/reviews/TEMPLATE.md)                                   | Mẫu ghi chú duyệt hoạt cảnh (dùng với [32](32-animation-viewer.md))                               |

## 5. Vận hành và công cụ

| #   | File                                             | Nội dung                                                                                |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 30  | [30-quy-tac-van-hanh.md](30-quy-tac-van-hanh.md) | Quy tắc vận hành 24/7: hàng đợi, cổng quyết định, ai quyết gì, điều kiện merge          |
| 32  | [32-animation-viewer.md](32-animation-viewer.md) | Trình xem animation DragonBones trong Cocos, chế độ review 8 hướng, QA hình ảnh tự động |

## 6. Quyết định và việc mở

| File                                           | Nội dung                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [DECISIONS.md](DECISIONS.md)                   | Nhật ký quyết định (không xóa, không đánh số lại)                  |
| [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md) | Hàng đợi câu hỏi chờ chủ dự án, theo ID; cổng quyết định của 30 §4 |
| [OPEN-ITEMS.md](OPEN-ITEMS.md)                 | Việc còn mở, điểm mơ hồ của spec, mảng thiết kế chưa có            |
| [ASSET-LICENSES.md](ASSET-LICENSES.md)         | Hồ sơ nguồn gốc và giấy phép asset (mọi asset phải có dòng ở đây)  |

## Quy ước

- Ngôn ngữ: tiếng Việt, giữ nguyên tiêu đề, bảng và công thức. Công thức LaTeX trong khối `latex`; mã trong khối code có ngôn ngữ.
- Khi đổi thông số: thêm mục vào DECISIONS trước (có hiệu lực ngay), rồi `@vgtd/shared` và test, rồi 00 §3 và tài liệu chi tiết kèm ghi chú `[Cập nhật D<n>: …]` (skill `vgtd-formula-change`).
- Các file 03–08 giữ nguyên văn docx ngoài các ghi chú `[Cập nhật …]`; khi gặp giá trị cũ (ví dụ 06 nhắc "thay cho mức 29 MB"), dùng 00 §3 và DECISIONS.
- Kiểm link tài liệu: `npm run docs:links`.
