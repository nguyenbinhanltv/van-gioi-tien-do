# Hồ sơ tổng hợp – MMORPG Tu Tiên 2D Isometric

Oct 31, 2026 · An Nguyen

## 1. Tổng quan dự án

**Vạn Giới Tiên Đồ** (tên tạm) là MMORPG tu tiên **2D Isometric** chạy đồng thời trên Web (H5/WebGL), Mobile (iOS/Android) và PC Client, engine đề xuất Cocos Creator 3.x. Hồ sơ này gom 8 tài liệu thiết kế và 2 gói mã nguồn thành một chỗ, chốt bộ thông số đang có hiệu lực, và ghi lại những quyết định cũ đã bị thay thế.

**Cách đọc:** khi hai tài liệu mâu thuẫn, mục 3 (Thông số chuẩn) của hồ sơ này và [DECISIONS.md](DECISIONS.md) (D1–D13 là các quyết định đã thay thế, D14 trở đi ưu tiên cao hơn) là căn cứ; tài liệu gốc vẫn giữ chi tiết.

### Các mốc quyết định

- **GDD High Level:** core loop, 9 cảnh giới với Tâm Ma / Lôi Kiếp, Chính – Tà – Ma, chiến tranh tông môn, kinh tế Linh thạch, Ngũ hành. Viết khi dự án còn định hướng 3D.
- **Asset Breakdown Matrix bản 3D (UE5):** đã bị thay toàn bộ ở mốc 3.
- **Chuyển hướng kỹ thuật sang 2D Isometric 2:1, đa nền tảng có Web:** Matrix được viết lại cho Sprite / Spine / Tilemap, thêm Y-sorting và streaming; engine chuyển sang Cocos Creator.
- **Đặc tả Nhân vật & Quái vật:** hybrid Spine (Player, Boss) + pre-render 3D (quái), paperdoll rig 5 hướng + lật gương _[D14]_, socket, boss đa ô.
- **Đặc tả Tilemap:** lưới 64 × 32 @1x, Wang theo góc, vách nhiều tầng, 2 bản đồ mẫu, Động Phủ.
- **Đặc tả UI/UX & Icon:** bố cục theo chế độ nhập, 9-slice 720p → 4K, icon 48 / 64 / 128, viền **6 phẩm**.
- **Tối ưu render:** Vạn Kiếm bằng instancing, Lôi Kiếp procedural, 3 shader, batching, chunk streaming, **RAM Web ≤ 500 MB, gói tải đầu ≤ 25 MB**.
- **Công thức & Data Schema:** chỉ số theo hàm mũ có kiểm soát, công thức đột phá mới, sát thương Lôi Kiếp, ma trận Ngũ hành **+25% / −15% DEF**, drop rate, JSON Schema.
- **Mã nguồn sinh asset:** tilemap, phi kiếm, icon, shader GLSL, chạy và kiểm tra thật.
- **Kiến trúc server + Input Layer client + pipeline orchestrator:** AOI, đồng bộ, anti-cheat, microservices; mã TypeScript điều khiển và UI; DAG 5 bước tự động hóa asset.

## 2. Bản đồ tài liệu

Bản đồ tài liệu và quan hệ giữa chúng nằm ở [README.md](README.md) (mục lục duy nhất). Mục này từng chứa bảng 8 tài liệu nguồn và hai gói mã; bảng đó đã lỗi thời và được gỡ.

## 3. Thông số chuẩn hợp nhất

[Cập nhật D58: export semi-chibi opt-in `timingProfile: "smooth-v2"` chạy clock 24 Hz, mỗi bản vẽ 1 tick; idle 16/24 giây, attack 14/24 giây. Animation kế thừa clock armature DragonBones. Legacy giữ clock cũ; atlas/PNG không đổi khi sửa timing runtime.]

[Cập nhật D57: `inherited-registration` chỉ tái dùng registration do tool tự tính từ nguồn trước edit khi SHA256 nguồn/mask khớp và toàn bộ RGBA ngoài mask nhị phân giống hệt trên toàn sheet. Mất mask/hash hoặc khác byte là lỗi cứng; giữ calibration/origin từ nguồn, ghi provenance trong contract/review. Không miễn head/similarity/foot/canvas, không coi centroid là giải phẫu. Bổ sung D57 (orchestrator 2026-11-08): `authoredOrigins` được phép cùng `inherited-registration` chỉ khi authored origin trên ô nguồn trước edit và ô đã sửa giống hệt; vẫn cấm trộn variant; mọi kiểm chứng SHA/mask/RGBA giữ nguyên.]

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

[Cập nhật D60: `bracketed-occlusion` chỉ cho dash/run/attack/hit không có bằng chứng đầu thật vì che khuất. Crown phải nhìn thấy, ghi vật che và endpoint bị che; hai lân cận trực tiếp phải có phép đo đầu đạt band. Tối đa 2 ô bracketed mỗi clip; không kề nhau vì lân cận phải đo thật, không còn trần phần trăm hay trần chuỗi riêng. Lab D55 phải đạt, cả hai pair temporal ≥0,45. Cửa sổ lấy đúng kích thước cửa sổ đầu D55 của master, đặt theo crown nhìn thấy với margin tổng 8%, cùng cách dựng trên master và cả hai phía temporal; torso giữ D55, không fallback centroid hay tạo anatomy. INFO ghi bracketed/chưa đo, không giả là pass đo đầu; không dùng idle/walk/emote/master hay bịa điểm.]

[Cập nhật D61: `clip-relative-proxy` cho ô động (dash/run/attack/hit) không có bằng chứng đầu so được với master, sau tối đa một lần vẽ lại khóa master. Proxy = bề rộng mũ tóc đặc trên hàng mép trên headband (alpha≥128, màu tóc, opening 3×3, thành phần chứa crown rồi thành phần lớn nhất sau opening); ô đạt khi proxy trong ±3% trung bình proxy ≥2 ô chứng nhận của cùng clip. Bắt buộc crown, hàng headband khai báo, occluder + endpoint bị che, Lab D55 và hai pair temporal ≥0,45. INFO `clip-relative`, không phải pass band master; mọi gate khác giữ nguyên. Chi tiết: docs/DECISIONS.md D61.]

[Cập nhật D59: NE/N chỉ dùng `rear-span-only` khi một đầu breadth sọ bị vật che thật trên cả master và ô. Đo crown→nape Euclidean trong ±3% master cùng hướng, bắt buộc `occluder` cụ thể và `occludedSide` cùng định nghĩa; không lấy seam nội thất, không chiếu endpoint. Ô có đủ hai đầu phải dùng D48: so span với master D59, breadth ô chỉ INFO không có tỷ lệ master; không cho phép chiều ghép ngược. Cửa sổ Lab/temporal của master D59 và mọi ô ghép là hình vuông cạnh một span, tâm trung điểm hai endpoint, nới tổng 8%; cửa sổ không tạo breadth evidence. Crown theo hàng cao nhất có dải ≥2 pixel main-cap alpha≥128 không chạm bun/gold/ribbon, x ở trung điểm dải. Không sửa ảnh master; Lab D55, head band, foot/canvas và D41/D54 giữ nguyên.]

[Cập nhật D47: upright semi-chibi có exception/bbox ngoài band dùng bằng chứng kích thước đầu master ±3%, reason `posture`/`secondary-overhang`, không ép phẳng flight tuck/dash/lunge. Ô trong band không exception giữ cổng cũ; evidence đã khai báo luôn được kiểm. Chi tiết tọa độ và INFO review ở `art/sprite-sheet-pipeline.md`.]

[Cập nhật D48, bổ sung D47: NE/N bị che cằm dùng `rear-skull-base`, crown→đáy sọ tại chỗ nối gáy/cổ và bề ngang sọ tối đa đều ±3% cùng master của hướng đó. Không bịa hay chiếu cằm. Kind, landmark và bề ngang giữ trong INFO; chi tiết schema ở pipeline.]

[Cập nhật D50, bổ sung D48: nếu tóc của master đã duyệt che gáy, không sửa master hay đoán skull base; dùng `rear-crown-shoulder`, crown sọ→trung điểm đường đỉnh vai nhìn thấy và bề ngang sọ đều ±3% đúng master cùng hướng. Kind ghi trên masterHead theo direction, chỉ NE/N; ngưỡng/gates khác giữ nguyên.]

[Cập nhật D52, bổ sung D47/D48/D50: chỉ N có crown bị phụ kiện cứng che dùng `rear-base-ornament`, đo gáy nhìn thấy↔điểm thấp nhất nhìn thấy nơi phụ kiện cứng tiếp xúc tóc, cộng bề ngang sọ; cả hai ±3% master khóa cùng hướng. MasterHead ghi định nghĩa neo cố định, ô dùng cùng định nghĩa và note đã xem. Không chiếu crown/lấy cạnh vòng làm crown, không sửa master, không dùng tóc mềm làm neo. Chi tiết schema/INFO ở `art/sprite-sheet-pipeline.md`; các gate và scale khác giữ nguyên.]

[Cập nhật D53, bổ sung hẹp D50: nếu một đầu vai thật sự bị quạt/tóc/ribbon che trên master NE/N, dùng `rear-crown-shoulder-single`: khoảng cách dọc crown→đỉnh vai còn nhìn thấy và bề ngang sọ đều ±3% master khóa cùng hướng. Master/ô cùng `occludedSide`, có `occluder` cụ thể; không chiếu vai bị che, không sửa master, không dùng vì tiện. Pháp tu NE che vai trái, đo vai phải; ô che cả vai phải phải báo. Ưu tiên D50 nếu nhìn thấy cả hai đầu; gate/scale khác giữ nguyên.]

[Cập nhật D56, bổ sung hẹp D53: ô NE/N nghiêng động `dash`/`run`/`attack`/`attack_2`/`attack_3` khai `posture`, crown và hai đầu bề ngang tóc ôm sọ nhìn thấy alpha ≥128 nhưng vai thật sự bị che, được dùng bằng chứng ô `rear-breadth-only` với `occluder` cụ thể và note đã xem. Chỉ so bề ngang ±3% master khóa cùng hướng, không đo khoảng dọc/chiếu vai; master giữ kind và ảnh cũ. Không dùng idle; D54 similarity (và D55 khi merge), foot/canvas/scale không được miễn. Pháp tu NE dash local4/5/7 chờ tooling merge mới áp dụng.]

[Cập nhật D54: lý do head-evidence `posture`/`secondary-overhang`/`rear-*` không miễn gate similarity. Ngoại lệ pose D41 có tên riêng đã xem (bow, seated, die-collapse, lunge, recoil, raised-sword) giữ miễn phép so crop trên mọi kind, kể cả upright emote. Có cả bằng chứng đầu và pose D41 thì chỉ pose D41 cấp miễn, không suy miễn từ bằng chứng đầu. Audit so chính xác mọi ô old-skip/new-check; các miễn pose giữ nguyên được ghi riêng, không gọi là pass. Các ngưỡng, scale và cổng foot/canvas giữ nguyên.]

[Cập nhật D55: gate cứng similarity là khoảng cách palette Lab(D65) của pixel opaque: đầu ≤15, thân ≤23. L1 8×8 chỉ chẩn đoán. Temporal SSIM native giữa drawing liên tiếp/seam loop chỉ tịnh tiến ±3px; pair <0,45 ghi INFO review-by-eye, không fail; mirror còn phải qua review contact sheet bằng mắt. Head-size ±3% giữ vai trò scale. Cửa sổ dùng landmark thật, front rộng breadth hoặc một chiều dài đầu, rear endpoint thật; D56 crown+breadth cả master/ô. Margin tổng 8%, torso 25%×44% H master, thiếu điểm ghi centroid-fallback, không tạo evidence. Giữ D41/D54; 11 ô Lab vượt trần là rebuild-blocking, 33 ô L1 cũ được đánh giá lại theo A+C.]

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

[Cập nhật D56-master: chỉ master NE/N có nape và cả hai acromion thật sự bị che mới dùng `rear-breadth-only`, khai đủ vật che cụ thể tại `occlusions.nape/leftShoulder/rightShoulder`. Crown và breadth khối main-cap đặc nhìn thấy alpha≥128; chọn hàng rộng nhất có dải tóc liên tục, loại nét rời hoặc mảnh dưới 2 px, ribbon/pin/tassel. Ô dùng cùng quy tắc, crown nhìn thấy và breadth ±3% master, không tạo span dọc; không giới hạn lean khi master có kind này. Master D53 vẫn giữ giới hạn D56 cũ. Cửa sổ Lab D55 từ crown, rộng 1,08×breadth và cao đúng 1,0×breadth; không tạo evidence từ cửa sổ. Giữ D41/D54, foot/canvas và scale cố định.]

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

### Ngoại lệ sửa vùng đầu của sprite

[Cập nhật D62: ngoại lệ hẹp của D47 chỉ để sửa head-band, áp dụng mọi lớp/hướng: một lượt scale ROI đầu đồng đều không quá 5%, không xoay/shear, Lanczos3 + feather, pivot chin/nape base đã khóa hoặc đường tiếp giáp đầu–trang phục nhìn thấy khi cả hai bị che; khóa dải base. Nguồn ORIGINAL hoặc đúng một AI head edit khóa master; không nối chồng. AI head replacement tối đa một lần thử/ô, cùng mặt nạ và bằng chứng, giữ thiết kế đã khóa. RGBA ngoài mask giống từng byte, D57 inherited-registration, xem seam 4×, ghi hệ số + SHA mask/provenance và đo lại landmark thật. Tỉ lệ thân/toàn ô D41 và mọi gate giữ nguyên; chi tiết tại D62 và pipeline.]

[Cập nhật D63–D67: stream tier low/high, camera thấy 4–6 chunk, `staticSortBias` trong `@vgtd/shared`, pivot vách `(i+j+1)·16` + keep-out 1 ô, schema tùy chọn `elevation`/`objects[]`; xem `docs/DECISIONS.md`.]

[Cập nhật D68: PRNG mô phỏng là xoshiro128** (4 × uint32, gieo splitmix32) trong `@vgtd/shared`, luồng `combat` nằm trong `stateHash()`; `SkillDef` của `@vgtd/sim` biên dịch từ dữ liệu kỹ năng D49 (cooldown, GCD, MP theo % MP tối đa, tầm, LOS).]

[Cập nhật D69: mặc định mô phỏng/giao thức v1 (khinh công chỉ lưu cờ, bay dạng xung, input vượt ngân sách bị giữ và +1 điểm nghi ngờ, wire float32 + cờ delta, kết quả kỹ năng không kèm sát thương); cảm giác chơi xem lại sau playtest, cần game designer duyệt khi cân bằng.]

[Cập nhật D70: khung `@vgtd/server` (Gateway + World Node): xác thực tên/mật khẩu qua HTTP (scrypt tạm thời thay argon2id, JWT EdDSA 10 phút), bắt tay WS bằng `hello` JSON 5 s, AOI 10 Hz tối đa 120 thực thể, snapshot delta theo băng 20/10/5 Hz, công cụ `loadtest`.]

[Cập nhật D75: lõi combat server (`apps/server/src/world/combat/`): chí mạng gốc 5 % (trần 60 %), hồi sinh PvE 10 s, hit flag bit1 = hạ gục; xem `docs/DECISIONS.md` và `docs/34-combat-server.md`.]

[Cập nhật D78: giao thức v3 (`skill_cast` có điểm ngắm tùy chọn, `self.vitals` HP / MP / khiên của chính người chơi); xem `docs/DECISIONS.md` và `docs/24-giao-thuc-mang.md`.]

## 4. Các quyết định đã bị thay thế

Bảng "Cũ → Hiện hành" của D1–D13 (thể loại, engine, nền tảng, hình thức asset, gói 25 MB, 6 phẩm, icon, Ngũ hành, tương sinh, công thức đột phá, Lôi Kiếp, VFX Lôi Kiếp, Vạn Kiếm) nằm ở [DECISIONS.md](DECISIONS.md), D1–D13, (bản đầy đủ hơn của bảng từng ở đây); mọi quyết định về sau (D14 trở đi) cũng chỉ nằm ở đó. Giá trị cũ vẫn có thể còn trong tài liệu gốc 01–08; khi gặp, dùng cột "Hiện hành" của DECISIONS.

## 5. Phần đã gỡ

Các mục tóm tắt từng tài liệu (5), kiểm kê hai gói mã bàn giao dạng zip (6) và danh sách việc cần làm thời docx (7) đã được gỡ: tóm tắt trùng với [README.md](README.md) và chính các tài liệu 01–08; hai gói mã nay là các package `@vgtd/*` trong repo; việc còn mở và các mảng thiết kế chưa có nằm ở [OPEN-ITEMS.md](OPEN-ITEMS.md) §1–§3. Nội dung gốc nằm trong lịch sử git của file này.
