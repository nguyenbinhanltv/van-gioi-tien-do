# Hồ sơ tổng hợp – MMORPG Tu Tiên 2D Isometric

Oct 31, 2026 · An Nguyen

## 1. Tổng quan dự án

**Vạn Giới Tiên Đồ** (tên tạm) là MMORPG tu tiên **2D Isometric** chạy đồng thời trên Web (H5/WebGL), Mobile (iOS/Android) và PC Client, engine đề xuất Cocos Creator 3.x. Hồ sơ này gom 8 tài liệu thiết kế và 2 gói mã nguồn thành một chỗ, chốt bộ thông số đang có hiệu lực, và ghi lại những quyết định cũ đã bị thay thế.

**Cách đọc:** khi hai tài liệu mâu thuẫn, mục 3 (Thông số chuẩn) và mục 4 (Quyết định đã thay thế) của hồ sơ này là căn cứ; tài liệu gốc vẫn giữ chi tiết.

### Các mốc quyết định

- **GDD High Level:** core loop, 9 cảnh giới với Tâm Ma / Lôi Kiếp, Chính – Tà – Ma, chiến tranh tông môn, kinh tế Linh thạch, Ngũ hành. Viết khi dự án còn định hướng 3D.
- **Asset Breakdown Matrix bản 3D (UE5):** đã bị thay toàn bộ ở mốc 3.
- **Chuyển hướng kỹ thuật sang 2D Isometric 2:1, đa nền tảng có Web:** Matrix được viết lại cho Sprite / Spine / Tilemap, thêm Y-sorting và streaming; engine chuyển sang Cocos Creator.
- **Đặc tả Nhân vật & Quái vật:** hybrid Spine (Player, Boss) + pre-render 3D (quái), paperdoll 8 hướng _[Cập nhật D14: rig 5 hướng + lật gương]_, socket, boss đa ô.
- **Đặc tả Tilemap:** lưới 64 × 32 @1x, Wang theo góc, vách nhiều tầng, 2 bản đồ mẫu, Động Phủ.
- **Đặc tả UI/UX & Icon:** bố cục theo chế độ nhập, 9-slice 720p → 4K, icon 48 / 64 / 128, viền **6 phẩm**.
- **Tối ưu render:** Vạn Kiếm bằng instancing, Lôi Kiếp procedural, 3 shader, batching, chunk streaming, **RAM Web ≤ 500 MB, gói tải đầu ≤ 25 MB**.
- **Công thức & Data Schema:** chỉ số theo hàm mũ có kiểm soát, công thức đột phá mới, sát thương Lôi Kiếp, ma trận Ngũ hành **+25% / −15% DEF**, drop rate, JSON Schema.
- **Mã nguồn sinh asset:** tilemap, phi kiếm, icon, shader GLSL, chạy và kiểm tra thật.
- **Kiến trúc server + Input Layer client + pipeline orchestrator:** AOI, đồng bộ, anti-cheat, microservices; mã TypeScript điều khiển và UI; DAG 5 bước tự động hóa asset.

## 2. Bản đồ tài liệu

| #   | Tài liệu                              | Vai trò                                                                   | Trạng thái                                                                                        |
| --- | ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | GDD – MMORPG Tu Tiên (High Level)     | Gameplay, cảnh giới, phe phái, kinh tế, chiến đấu                         | Hiệu lực về gameplay; phần nền tảng / engine và số Ngũ hành, công thức đột phá đã bị thay (mục 4) |
| 2   | Asset Breakdown Matrix – 2D Isometric | Cây phân loại asset, quy ước 2D, Y-sorting, đóng gói                      | Hiệu lực; ngân sách tải đầu 29 MB và thang 5 phẩm đã bị thay                                      |
| 3   | Đặc tả Nhân vật & Quái vật            | Spine vs pre-render, paperdoll 8 hướng, FPS, socket, boss đa ô            | Hiệu lực                                                                                          |
| 4   | Đặc tả Tilemap Isometric              | Lưới diamond, autotile, vách đá, layer, 2 bản đồ, Động Phủ                | Hiệu lực                                                                                          |
| 5   | Đặc tả UI/UX & Icon Cross-platform    | Bố cục PC / Mobile, 9-slice, icon, viền 6 phẩm                            | Hiệu lực                                                                                          |
| 6   | Giải pháp tối ưu render 2D            | VFX procedural, shader, batching, streaming, ngân sách RAM                | Hiệu lực                                                                                          |
| 7   | Công thức & Data Schema               | Chỉ số, đột phá, Lôi Kiếp, Ngũ hành, drop, chống lạm phát, JSON Schema    | Hiệu lực; là nguồn số liệu gameplay                                                               |
| 8   | Kiến trúc Server Thời gian thực       | AOI, handover, đồng bộ, anti-cheat, microservices, giao thức              | Hiệu lực                                                                                          |
| —   | Gói tutien-procgen.zip                | Sinh tilemap / phi kiếm / icon, shader, công cụ, pipeline orchestrator    | Đã chạy và kiểm tra (xem mục 6)                                                                   |
| —   | Gói tutien-client-input.zip           | Input Abstraction Layer, A*, Joystick / Skill Wheel, AnchorLayout, túi đồ | Đã type-check và kiểm thử (xem mục 6)                                                             |

### Quan hệ giữa các tài liệu

- **GDD → Công thức & Data Schema:** GDD mô tả cơ chế; tài liệu Công thức lượng hóa và xuất JSON cho server.
- **Asset Matrix → Nhân vật, Tilemap, UI, Render:** Matrix đặt quy ước chung (lưới, hướng, atlas, layer); bốn tài liệu sau đi sâu từng nhóm asset.
- **Render + Tilemap + Nhân vật → Server:** tọa độ ô, pivot, collider và chunk 32 × 32 dùng chung cho client và server.
- **Tất cả → mã nguồn:** gói procgen hiện thực hóa Tilemap, icon, shader; gói client hiện thực hóa UI/UX và phần client của tài liệu Server.

## 3. Thông số chuẩn hợp nhất

> **[Cập nhật D44: Player mới dùng premium semi-chibi khoảng 4,5 đầu, mặt cố định theo Đạo Lộ; trang phục/vũ khí đổi hình qua T1–T5 theo 9 cảnh giới, còn 6 phẩm D6 chỉ tint viền/glow lúc chạy. Trang phục cosmetic và skin vũ khí bán riêng; chưa chốt giá/chỉ số. Giữ pipeline từng khung D41 và hướng D14. Chi tiết: [chuẩn phong cách](art/style-semichibi.md), [D44](DECISIONS.md). Concept là tham chiếu, chưa thay asset đang chạy.]**

Đây là bộ giá trị đang có hiệu lực. Mọi thay đổi về sau nên sửa ở đây trước, rồi mới cập nhật tài liệu gốc.

### Nền tảng và lưới

| Hạng mục          | Giá trị chốt                                                                                                                                                                                                      | Tài liệu gốc           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Thể loại / engine | 2D Isometric · Cocos Creator 3.x (dự phòng: Unity 2D, Godot 4)                                                                                                                                                    | Asset Matrix           |
| Nền tảng          | Web H5/WebGL, iOS, Android, PC; cross-play                                                                                                                                                                        | Asset Matrix           |
| Khung thiết kế    | 1280 × 720 logic (dọc: 720 × 1280); vẽ bản gốc @2x, @3x chỉ cho khung 9-slice, icon, bitmap font trên PC 4K                                                                                                       | UI/UX                  |
| Phép chiếu        | Dimetric 2:1; x = (i − j)·32, y = (i + j)·16 (px @1x)                                                                                                                                                             | Tilemap                |
| Ô cơ sở           | 64 × 32 px @1x (bản vẽ 128 × 64 @2x)                                                                                                                                                                              | Tilemap                |
| Chunk             | 32 × 32 ô = 2048 × 1024 px @1x                                                                                                                                                                                    | Asset Matrix, Render   |
| Tầng cao          | Mỗi tầng 32 px @1x, tối đa 4 tầng; mặt vách sort cùng tầng dưới                                                                                                                                                   | Tilemap                |
| Hướng             | 8 hướng; Player và Boss vẽ đủ 8; quái, NPC, linh thú vẽ 5 + lật gương _[Cập nhật D14: Rig Spine Player / Boss vẽ **5 hướng + lật gương**; chỉ animation bất đối xứng được vẽ đủ 8, đánh dấu theo từng animation]_ | Asset Matrix, Nhân vật |
| Nguồn sáng        | Cố định hướng NW cho mọi asset                                                                                                                                                                                    | Asset Matrix           |

### Nhân vật, layer, atlas

[Cập nhật D46: Player semi-chibi dùng profile opt-in `smooth-v2`, 24 fps danh nghĩa, lưới tối đa 4×4 và ô logic 256 px @2x; số ô/thời lượng/sự kiện tại `art/sprite-sheet-pipeline.md`. Bảng D41 cũ giữ nguyên. Đây là thời gian trình diễn, không đổi simulation.]

| Hạng mục              | Giá trị chốt                                                                                        | Tài liệu gốc          |
| --------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| Phương án dựng        | Spine: Player, Linh thú, Boss · Pre-render 3D: quái thường, tinh anh                                | Nhân vật              |
| Canvas theo footprint | 1 × 1: 128 · tinh anh: 192 · 2 × 2: 256 · 4 × 4: 512 · 8 × 8: chỉ Spine ghép mảnh                   | Nhân vật              |
| Pivot                 | (W/2, H − 12) @1x, trùng root bone Spine                                                            | Nhân vật              |
| Va chạm (1 × 1)       | Collider r 0,35 ô · Hurtbox r 0,45 ô · Pick box 48 × 100 px                                         | Nhân vật              |
| Lớp vẽ                | L0 Ground · L1 Decal · L2 Shadow · **L3 Y-sort** · L4 Air · L5 Weather · L6 World UI · L7 Screen UI | Asset Matrix          |
| Sort key              | Y mặt đất của pivot; vật nhiều ô dùng đỉnh dưới footprint; tầng cao xử lý theo nhóm tầng            | Asset Matrix, Tilemap |
| Atlas                 | ≤ 2048 × 2048 (Web/Mobile), 4096 cho atlas map PC; lũy thừa 2; padding 2 px + extrude               | Asset Matrix          |
| Nén                   | Web: KTX2 (ETC1S tile / UASTC nhân vật, UI) + WebP · Mobile: ASTC 4×4 / 6×6 / 8×8 · PC: PNG         | Asset Matrix          |
| Icon                  | Bản gốc 256, xuất 48 / 64 / 128; nền trong suốt; viền ghép lúc chạy                                 | UI/UX                 |
| Phẩm chất             | 6 cấp: Trắng · Lục · Lam · Tím · Vàng · Đỏ, có dấu góc cho người mù màu                             | UI/UX                 |

> [Cập nhật D35: hoạt cảnh xương nhân vật dùng DragonBones thay Spine 4.2 (runtime `dragon-bones` của Cocos 3.8.8, MIT); "Spine" trong tài liệu này đọc là "skeleton DragonBones"; số liệu không đổi. Xem [art/dragonbones.md](art/dragonbones.md).]

### Ngân sách hiệu năng

| Hạng mục              | Web / Mobile                                                 | PC                             | Tài liệu gốc |
| --------------------- | ------------------------------------------------------------ | ------------------------------ | ------------ |
| Gói tải ban đầu       | ≤ 25 MB (Web)                                                | Cài đặt kèm Core + 1 Zone pack | Render       |
| RAM tab Web           | ≤ 500 MB (texture 220 MB)                                    | —                              | Render       |
| Draw call             | ≤ 80                                                         | ≤ 150                          | Render       |
| Hạt VFX trên màn hình | ≤ 1.000                                                      | ≤ 3.000                        | Render       |
| Spine cập nhật đầy đủ | ≤ 30                                                         | —                              | Asset Matrix |
| Băng thông xuống      | ~8 KB/s đánh quái · ~13 KB/s chợ đông · ~25 KB/s chiến tranh | như Web                        | Server       |

### Số liệu gameplay

| Hạng mục         | Giá trị chốt                                                                                                     | Tài liệu gốc   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | -------------- |
| Cảnh giới        | 9 cảnh giới, 41 nấc (Luyện Khí 9 tầng, còn lại 4 tiểu cảnh)                                                      | GDD, Công thức |
| Chỉ số           | Stat = B · λ^x, x = (r − 1) + 0,6·(k − 1)/K_r; λ: HP 1,78 · MP 1,70 · Công 1,75 · Thủ 1,72; Thân pháp tuyến tính | Công thức      |
| Đột phá          | clamp(Base_eff · (1 + Pill) − Karma_Penalty, 5%, 95%); pity +8%/lần (trần 40%)                                   | Công thức      |
| Lôi Kiếp         | Sát thương thuần, Strike = HP_ref · κ_r · 1,22^(w−1); tổng 0,6 → 3,0 × HP_ref                                    | Công thức      |
| Ngũ hành         | Khắc: +25% sát thương, −15% Thủ mục tiêu · bị khắc: −15% · sinh: hồi 10% Chân Nguyên khi hỗ trợ                  | Công thức      |
| Linh căn         | P_n: Đơn 1,6 · Song 1,3 · Tạp 1,0 / 0,85 / 0,7; hấp thu ∝ √Match môi trường                                      | Công thức      |
| Thuế chợ         | Niêm yết 1% + thuế bán 5–10% theo CPI tuần; giao dịch trực tiếp 3%                                               | Công thức      |
| Mục tiêu kinh tế | Tiêu hao / sinh ra 0,9–1,0 mỗi tuần                                                                              | GDD, Công thức |

### Mạng

| Hạng mục            | Giá trị chốt                                                                   | Tài liệu gốc |
| ------------------- | ------------------------------------------------------------------------------ | ------------ |
| Tick mô phỏng / AOI | 20 Hz / 10 Hz                                                                  | Server       |
| Vùng AOI            | 2 × 2 màn hình quanh người chơi (u trong ±40 ô, w trong ±45 ô), thoát ở 1,15 × | Server       |
| Gửi input           | 30 Hz PC, 20 Hz Mobile/Web                                                     | Server       |
| Trễ nội suy         | 100 ms PC, 150–250 ms Mobile/Web (thích ứng)                                   | Server       |
| Bù trễ kỹ năng      | Tua tối đa 200 ms                                                              | Server       |

## 4. Các quyết định đã bị thay thế

Những giá trị ở cột "Cũ" vẫn còn nằm trong tài liệu gốc tương ứng; khi gặp, dùng giá trị ở cột "Hiện hành".

| Hạng mục            | Cũ                                                                    | Hiện hành                                                               | Thay ở              |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------- |
| Thể loại / góc nhìn | MMORPG 3D thế giới mở (GDD)                                           | 2D Isometric 2:1, thế giới mở chia chunk                                | Asset Matrix bản 2D |
| Engine              | Unreal Engine 5 (GDD, Matrix bản 3D)                                  | Cocos Creator 3.x                                                       | Asset Matrix bản 2D |
| Nền tảng            | PC + Mobile                                                           | Web H5 + Mobile + PC, cross-play                                        | Asset Matrix bản 2D |
| Hình thức asset     | Mesh, LOD, Nanite, Niagara                                            | Sprite Sheet, Spine 2D, Tilemap diamond, Particle 2D, sprite shader     | Asset Matrix bản 2D |
| Gói tải đầu Web     | 30 MB (dự phòng 1 MB → 29 MB)                                         | 25 MB                                                                   | Tối ưu render       |
| Thang phẩm chất     | 5 phẩm (pháp bảo, đan dược, viền)                                     | 6 phẩm: Trắng → Đỏ                                                      | UI/UX               |
| Kích thước icon     | Nguồn 512, hiển thị 256 (bản 3D); nguồn 256, hiển thị 128 (Matrix 2D) | Nguồn 256, xuất 48 / 64 / 128                                           | UI/UX               |
| Ngũ hành khắc chế   | +30% sát thương, xuyên 20% kháng                                      | +25% sát thương, −15% Thủ; bị khắc −15%                                 | Công thức           |
| Tương sinh          | +20% buff và hồi phục cho đồng đội hệ được sinh                       | Hồi 10% Chân Nguyên khi hỗ trợ đồng đội hệ được sinh (hồi chiêu 10 s)   | Công thức           |
| Công thức đột phá   | Cộng dồn: Base + Đan + Trận + Đạo tâm + 8%·thất bại                   | clamp(Base_eff · (1 + Pill) − Karma_Penalty, 5%, 95%)                   | Công thức           |
| Lôi Kiếp            | Mô tả định tính (số đạo, telegraph)                                   | Sát thương thuần theo đợt, κ_r cho từng ngưỡng, nguồn giảm trừ bắt buộc | Công thức           |
| VFX Lôi Kiếp        | Flipbook 128 × 512, 8 frame, 4 biến thể                               | Procedural (fBm, segment mesh), không texture                           | Tối ưu render       |
| Vạn Kiếm Quy Tông   | Niagara / flipbook                                                    | 1 sprite kiếm + GPU instancing, quỹ đạo tính trong vertex shader        | Tối ưu render       |

**Chưa được cập nhật trong tài liệu gốc:** GDD và các bảng của Asset Matrix vẫn ghi giá trị cũ ở các dòng trên. Nên sửa trực tiếp hai tài liệu đó để tránh nhầm (xem mục 7).

## 5. Tóm tắt từng tài liệu

### 5.1 GDD – High Level

- Core loop: Luyện khí → Vượt ải / Săn quái → Tài nguyên, Đan dược → Đột phá → Trọng sinh / Phi Thăng; 4 tầng vòng lặp từ 5 phút đến 12 tháng.
- 9 cảnh giới, mỗi cảnh giới mở cơ chế mới (bay, phân thân Nguyên Anh, Lĩnh Vực, Pháp Tướng); thất bại đột phá không rớt cảnh giới lớn.
- Phe Chính – Tà – Ma theo Nghiệp Lực và Đạo Tâm; nghiệp báo, nhân quả tuyến, rơi đồ theo nghiệp; chiến tranh Linh Mạch với Hộ Sơn Đại Trận.
- Kinh tế Linh thạch 3 phẩm, Tiên Ngọc, Cống hiến; chợ Vạn Bảo Lâu, thuế động, Đấu Giá Hội hủy tiền.

### 5.2 Asset Breakdown Matrix (2D)

- Engine Cocos Creator; chuẩn isometric 2:1; quy tắc 8 hướng / 5 hướng lật gương; khi nào dùng Spine, Sprite Sheet hay pre-render.
- 8 lớp vẽ L0–L7, chỉ L3 Y-sort; quy tắc pivot, vật nhiều ô cắt lát, mờ khi che khuất.
- Đóng gói Asset Bundle (Core, Class, Equipment, Zone, Map chunk, Event), streaming chunk 3 × 3 / 5 × 5 / 7 × 7.
- 6 bảng asset: nhân vật, môi trường, vật phẩm, VFX, UI, âm thanh, kèm số lượng MVP.

### 5.3 Đặc tả Nhân vật & Quái vật

- Hybrid: Spine cho Player / Linh thú / Boss, pre-render 3D cho quái; giới hạn bone, slot, đỉnh mesh.
- Paperdoll 15 lớp với bảng Draw Order cho 8 hướng; repack trang bị vào 1 texture để giữ ≤ 2 draw call mỗi nhân vật.
- Bảng FPS và frame cho 13 hoạt cảnh; sự kiện Spine chuẩn; canvas 128 → 512.
- Socket, UI trên đầu, collider / hurtbox / pick box; boss 2 × 2 đến 8 × 8, sort line chữ V, gãy bộ phận và chuyển phase bằng đổi skin.

### 5.4 Đặc tả Tilemap Isometric

- Ô 64 × 32 @1x với bản vẽ @2x, chống khe hở và nhòe.
- Wang theo góc 16 mặt nạ cho Đất cỏ – Đất đá – Nước – Nham thạch; cặp bị cấm được tự chèn dải đá.
- Vách đá nhiều tầng, bộ tile vách, quy tắc sort theo tầng, bậc thang.
- Layer engine, Overhead tự mờ; bản đồ Sơn Môn Đại Phái (5 tầng) và Bí Cảnh Rừng Độc (tán rừng liền khối, sương độc); Động Phủ snap lưới và 4 trạng thái Tiên Dược.

### 5.5 Đặc tả UI/UX & Icon

- Bố cục chọn theo cách nhập, không theo thiết bị; hệ số scale và bộ @1x / @2x / @3x từ 720p đến 4K.
- PC: chat cố định, cửa sổ nổi kéo thả, thanh skill 1–9; Mobile: Joypad động, Skill Wheel, túi đồ toàn màn hình dạng tab.
- 4 họ khung 9-slice (gỗ, ngọc, thủy mặc, viền sáng) với inset chuẩn.
- Icon 48 / 64 / 128, thiết kế Đan dược và Phù lục / Bí tịch, shader và CSS phát sáng, viền 6 phẩm.

### 5.6 Giải pháp tối ưu render 2D

- Vạn Kiếm Quy Tông: 1 sprite, GPU instancing, 4 pha quỹ đạo, dưới 0,5 MB.
- Lôi Kiếp procedural (chia đôi đoạn thẳng, nhánh, bloom giả / thật theo cấp máy).
- Shader: khoét lỗ mờ khi che khuất + X-Ray, Kim Quang Hộ Thể, sông nước Linh Tuyền.
- Batching theo lớp (80 / 150 draw call), chunk streaming theo camera, ngân sách RAM 500 MB và gói đầu 25 MB, danh sách tải lười.

### 5.7 Công thức & Data Schema

- Chỉ số theo hàm mũ có kiểm soát; số đòn hạ gục cùng cảnh giới chỉ tăng khoảng 10% sau 9 cảnh giới.
- Công thức đột phá, sát thương Lôi Kiếp và ví dụ Cửu Cửu Thiên Kiếp 81 đạo.
- Ma trận Ngũ hành, công thức sát thương tổng, linh căn và tốc độ hấp thu.
- Drop Rate Matrix, chống lạm phát (thuế CPI, truyền tống, độ bền); JSON Schema + dữ liệu mẫu realm_progression.json, elemental_matrix.json.

### 5.8 Kiến trúc Server Thời gian thực

- AOI băm theo trục màn hình (u, w); handover giữa World Node bằng ghost + epoch, không ngắt kết nối.
- Di chuyển do server quyết định (input vector, va chạm tách trục); client dự đoán, đối soát, nội suy thích ứng.
- Anti-cheat: ngân sách thời gian chống speedhack, hồi chiêu chỉ do server giữ, điểm nghi vấn.
- Microservices Gateway / World Node / Economy / Chat / Zone Manager; Redis + PostgreSQL với sổ cái kép; giao thức WebTransport / WebSocket.

## 6. Mã nguồn & công cụ

Hai gói được bàn giao dưới dạng file zip trong cuộc trò chuyện; cả hai không cần thư viện bắt buộc ngoài Node.js 18+ (gói client cần TypeScript để biên dịch).

### tutien-procgen (sinh asset + pipeline)

| Thành phần                      | Nội dung                                                                                                                             | Đã kiểm tra                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| src/tilemap/generate_tilemap.js | Simplex fBm → Wang theo góc 3 chất liệu → tileset.png (40 tile 128 × 64, atlas 1024 × 512) + tileset.json + map.json + ảnh xem trước | Chạy khoảng 1 s cho bản đồ 32 × 32; soi ảnh gốc không lộ đường lưới                  |
| src/items/generate_items.js     | Phi kiếm 8 hướng (mô hình 3D chiếu 2:1, khử mặt khuất, tô sáng), 3 đan dược, 6 phù lục chữ triện sinh ngẫu nhiên (SVG)               | Render ra PNG và soi bằng mắt                                                        |
| shaders/                        | loi_kiep.frag, kim_quang.frag, 2 vertex shader (GLSL ES 1.0)                                                                         | Qua glslangValidator; render thật bằng WebGL headless                                |
| tools/                          | SVG → PNG, chụp ảnh shader cho CI, trang xem trước shader tương tác                                                                  | Chạy được                                                                            |
| pipeline/                       | orchestrator_pipeline.yaml, render_layers.sh, validate_assets.js, pack_atlas.js, compress_textures.sh, 3 prompt, local_smoke.sh      | Chạy thử bước 1–4 (phần không dùng AI), nhánh PC: đạt; YAML phân tích cú pháp hợp lệ |

### tutien-client-input (TypeScript)

| Thành phần                               | Nội dung                                                                                           | Đã kiểm tra                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| InputManager.ts                          | Một nguồn Pointer Events + bàn phím; tự chuyển Touch ↔ Chuột; đóng gói input khớp giao thức server | Type-check strict                                |
| IsoPathfinder.ts                         | A* 8 hướng, octile, cấm cắt góc, rút gọn đường bằng tầm nhìn thẳng                                 | 6 bài kiểm thử; lưới 256 × 256 khoảng 26 ms      |
| PointerController.ts, TouchController.ts | Click-to-move, phím 1–6, Space; Joystick động, Skill Wheel 2 trang, kéo nhắm, vùng hủy             | Mô phỏng sự kiện chạm: đạt                       |
| AnchorLayout.ts                          | Neo 9 điểm, safe area, 16:9 / 19,5:9 / dọc, 3 bố cục mặc định                                      | 4 bài kiểm thử: đạt                              |
| InventoryInteraction.ts                  | Kéo thả (PC) và chạm-để-chọn (Mobile/Web), đổi nóng theo chế độ                                    | Type-check strict                                |
| example/                                 | Demo canvas gắn toàn bộ module                                                                     | Biên dịch được; chưa chạy trong trình duyệt thật |

### Chưa kiểm tra được

- Nén KTX2 / ASTC (basisu, astcenc không có trong môi trường thử).
- Ba bước gọi Codex, Antigravity và Claude Code trong pipeline (cần khóa và tài khoản trên runner).
- Bước deploy (cần repo client thật) và schema thật của orchestrator.inc.

## 7. Việc còn mở và bước tiếp theo

### Việc cần làm

| Việc                                                                                                   | Lý do                                                       | Ưu tiên    |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------- |
| Cập nhật GDD sang 2D Isometric / Web / Cocos Creator, số Ngũ hành và công thức đột phá mới             | GDD vẫn ghi 3D, UE5 và các giá trị cũ ở mục 4               | Cao        |
| Cập nhật Asset Matrix: gói đầu 25 MB, 6 phẩm, kích thước icon                                          | Tránh hai tài liệu nói hai số khác nhau                     | Cao        |
| Ánh xạ orchestrator_pipeline.yaml theo schema thật của orchestrator.inc                                | Chưa có tài liệu schema công khai                           | Cao        |
| Chạy pipeline trên runner thật (basisu, astcenc, claude, codex, agy)                                   | Các bước này chưa kiểm tra được                             | Cao        |
| Prototype client trong Cocos Creator: InputManager + tilemap sinh tự động + 1 nhân vật Spine paperdoll | Kiểm chứng ngân sách draw call, RAM và Y-sort trên máy thật | Cao        |
| Module step() dùng chung client / server, World Node mẫu, đo AOI với 100 vs 100                        | Kiểm chứng băng thông và CPU của tài liệu Server            | Trung bình |
| Mô phỏng kinh tế (drop so với tiêu hao) trước closed beta                                              | Khóa các hệ số trong Công thức bằng dữ liệu                 | Trung bình |
| Shader nước lệch hoa văn theo tọa độ thế giới                                                          | Hồ lớn đang thấy hoa văn lặp                                | Thấp       |

### Mảng chưa có tài liệu

Nhiệm vụ và cốt truyện; nghề luyện đan / luyện khí / chế phù chi tiết; luật PvP và đấu trường; kiếm tiền (Tiên Ngọc, Battle Pass, cửa hàng); hướng dẫn người chơi mới; sự kiện và LiveOps; đo lường (telemetry, dashboard KPI).
