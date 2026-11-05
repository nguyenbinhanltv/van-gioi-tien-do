# Art Bible & Âm thanh

> **Trạng thái: bản thiết kế đề xuất – chờ duyệt.** Hồ sơ gốc đã khóa phần **kỹ thuật** của hình ảnh: lưới 64 × 32, 8 lớp vẽ, nguồn sáng NW, canvas nhân vật, khung 9-slice, icon 48 / 64 / 128, 6 phẩm, ngân sách render ([02](02-asset-matrix-2d.md), [03](03-nhan-vat-quai-vat.md), [04](04-tilemap.md), [05](05-ui-ux-icon.md), [06](06-toi-uu-render.md)). Hồ sơ **không** có hướng thẩm mỹ thống nhất (trụ cột phong cách, bảng màu, ngôn ngữ VFX theo Ngũ hành, định hướng âm nhạc ngoài bảng số lượng ở 02, chính sách asset AI). Phần này lấp khoảng trống đó. Mọi màu, tỷ lệ và quy tắc ngoài các giá trị đã trích dẫn là _Đề xuất – chờ duyệt_. Quyết định D14 trong [DECISIONS.md](DECISIONS.md) (rig Spine Player / Boss **5 hướng + lật gương**, animation bất đối xứng được vẽ đủ 8 hướng) thay dòng "Hướng" trong 00 §3 và được áp dụng ở đây.

## 1. Trụ cột phong cách

| Trụ cột                                           | Ý nghĩa                                                                                                                                     | Cách kiểm tra                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **1. Tiên hiệp thủy mặc, không cổ trang nặng nề** | Nền màu dịu, mảng lớn, nét cọ và chữ triện làm điểm nhấn; trang phục gọn để đọc được silhouette ở 128 px                                    | Thang xám: nhận biết được hình dáng nhân vật, quái, vật phẩm ở kích thước hiển thị |
| **2. Dễ đọc trước đẹp**                           | Chiến đấu có thể 100 vs 100 ([14](14-pvp-chien-tranh.md) §5): màu phe, hệ, phẩm phải phân biệt tức thì                                      | Bài thử màn hình 720p ở kích thước thật; thử mù màu (xem §10)                      |
| **3. Isometric nhất quán**                        | Mọi asset theo cùng phép chiếu 2:1, ô 64 × 32, nguồn sáng NW, pivot (W/2, H − 12) (00 §3)                                                   | Xem trước ghép lên tilemap mẫu, không lệch pivot / bóng                            |
| **4. Linh quang có kiểm soát**                    | Hiệu ứng phát sáng theo cấp bậc, nhưng nằm trong ngân sách hạt và draw call (≤ 1.000 hạt, ≤ 80 draw call trên Web/Mobile)                   | Chạy ở cấp máy thấp, bảng hạt trong [06](06-toi-uu-render.md)                      |
| **5. Văn hóa Việt – Hoa đan xen có chủ đích**     | Tiên hiệp Á Đông là nền; chi tiết (kiến trúc, trang phục, lễ hội) có thể pha yếu tố Việt; không bê nguyên biểu tượng tôn giáo hay chính trị | Rà soát nội dung ([19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md) §5)             |

Phản mẫu (không làm): bóng đổ ngược NW, viền sáng tuỳ tiện cho một asset, trộn phong cách pixel art cứng với vẽ tay mềm trong cùng cảnh, văn bản Latinh in lên icon (05 §5).

## 2. Bảng màu

### 2.1 Nguyên tắc

- **Bảng màu giới hạn theo vùng**: mỗi vùng có 1 màu chủ đạo, 1 màu nhấn, 1 dải trung tính; mỗi vật liệu dùng dải **4–5 bậc sáng tối** (tối nhất → sáng nhất, sáng từ NW) để đồng nhất giữa vẽ tay, Spine và pre-render 3D (quái, [03](03-nhan-vat-quai-vat.md)).
- **Hạn chế độ bão hòa** ở nền (≤ 55%) để dành bão hòa cao cho thứ cần thu hút: quái mục tiêu, vật phẩm rơi, VFX kỹ năng, cột sáng phẩm cao.
- **Viền tối 1 px** (cùng tông, đậm hơn dải tối nhất) cho nhân vật và quái; vật nền không viền (để tách lớp).

### 2.2 Màu phẩm chất (đã khóa ở 05 §7)

| Cấp | Tên        | Màu chính |
| --- | ---------- | --------- |
| 1   | Phàm phẩm  | `#E8E4DA` |
| 2   | Linh phẩm  | `#5FBF6A` |
| 3   | Huyền phẩm | `#4A90D9` |
| 4   | Địa phẩm   | `#A05FD6` |
| 5   | Thiên phẩm | `#E8B540` |
| 6   | Tiên phẩm  | `#E0483A` |

Các mã này **chỉ** dùng cho khung viền, dấu góc, tên vật phẩm và cột sáng phẩm. Màu quả cầu hào quang đan dược (`#7EE0A1` sơ cấp, `#FFD45A` cực phẩm) lấy từ ví dụ CSS ở 05 §6.

### 2.3 Màu Ngũ hành (Đề xuất – chờ duyệt)

| Hệ                    | Hán tự | Màu chính | Dải sáng NW | Dải tối   | Gam phụ                    |
| --------------------- | ------ | --------- | ----------- | --------- | -------------------------- |
| Kim                   | 金     | `#D9D4BD` | `#F4F0DE`   | `#8E8A74` | Vàng nhạt `#C8B560`        |
| Mộc                   | 木     | `#4FA36A` | `#9BD9A8`   | `#27573A` | Nâu rễ `#6B4F32`           |
| Thủy                  | 水     | `#2F8FC9` | `#8ED0EE`   | `#16466B` | Xanh ngọc `#4DC4C0`        |
| Hỏa                   | 火     | `#E5532D` | `#FFB27A`   | `#7A2314` | Vàng lửa `#FFD05A`         |
| Thổ                   | 土     | `#B58A4A` | `#E3C07F`   | `#5B4222` | Đỏ đất `#9A5B34`           |
| _Phong_ (biến dị Mộc) | 風     | `#B8E8D2` | —           | —         | Xoáy trắng–lục nhạt        |
| _Lôi_ (biến dị Kim)   | 雷     | `#C6B6FF` | —           | —         | Trắng–tím, tia ngoằn ngoèo |
| _Băng_ (biến dị Thủy) | 冰     | `#BFE9FF` | —           | —         | Trắng xanh, tinh thể       |

Hệ biến dị dùng hàng và cột của hệ gốc trong ma trận (Phong → Mộc, Lôi → Kim, Băng → Thủy; 07 §4), nên VFX giữ **ngôn ngữ chuyển động của hệ gốc** nhưng đổi màu.

**Va chạm màu phẩm – hệ (lỗ hổng cần quản lý):** Mộc (lục), Thủy (lam), Kim (trắng), Hỏa (đỏ) gần với Linh / Huyền / Phàm / Tiên phẩm. Quy tắc tách: (1) **phẩm chất luôn nằm trong khung chữ nhật + dấu góc** (05 §7); (2) **hệ luôn gắn với ký hiệu tròn (huy hiệu hệ) và hình dạng VFX riêng** (§5) — không bao giờ dùng màu hệ làm viền vật phẩm; (3) mọi bảng hiển thị cả phẩm lẫn hệ phải kèm Hán tự / ký hiệu hình học, không chỉ màu.

### 2.4 Bảng màu vùng MVP (Đề xuất – chờ duyệt)

| Vùng                                          | Chủ đạo                                    | Nhấn                                  | Trung tính                              | Không khí                                                             |
| --------------------------------------------- | ------------------------------------------ | ------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| **Sơn Môn Đại Phái** ([04](04-tilemap.md) §5) | Xanh lam núi `#5E8798`, lục tùng `#3F6E55` | Son đỏ `#B83A2E`, vàng ngói `#D6A441` | Xám đá `#9AA3AC`, trắng sương `#E9EEF0` | Sáng, theo chu kỳ ngày đêm; mây núi ở lớp L5 / Overhead               |
| **Bí Cảnh Rừng Độc**                          | Lục tối `#1F3329`, tím nấm `#6A4A8C`       | Lục độc phát quang `#7ED957`          | Nâu rêu `#4B4A38`                       | Tối; nấm và đầm độc là light sprite; sương độc là lớp phủ L5          |
| **Động Phủ**                                  | Gỗ ấm `#8A6A45`, ngọc `#78B79A`            | Đỏ lồng đèn `#C94A3C`                 | Kem `#EFE6D0`                           | Ấm, riêng tư; bốn trạng thái Tiên Dược ([04] §6) có sắc lục khác nhau |
| **Hậu sơn / Tụ Linh Nhãn**                    | Lam nhạt, trắng ngà                        | Cyan phát sáng `#6FE0E0`              | Đá trắng                                | Thác nước, hơi linh khí                                               |

Phe ([14](14-pvp-chien-tranh.md) §3): **Chính** ấm–vàng–trắng; **Tà** đỏ sẫm–tím–đen gân vàng; **Ma** đen–xám tro–đỏ tươi. Cờ chiến (Gây hấn / Phòng vệ / Truy nã) dùng vòng chọn ở L1 với 3 màu cố định đã tối ưu cho mù màu: _Gây hấn_ đỏ + hình tam giác, _Phòng vệ_ cam + hình tròn, _Truy nã_ tím + hình thoi.

## 3. Ánh sáng, bóng, độ sâu

| Quy tắc             | Giá trị (nguồn)                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Nguồn sáng          | **Cố định NW** cho mọi asset (00 §3, `LIGHT_DIRECTION` ở `@vgtd/shared`)                                                                       |
| Hướng bóng đổ       | Về phía **SE**; bóng dưới chân là **ellipse tỉ lệ 2:1** ở lớp **L2** (02), không vẽ bóng trong sprite nhân vật                                 |
| Highlight           | Cạnh trên–trái của mọi khối; vật phát sáng (đèn, đan, nấm) có ánh phản bổ sung lên vật xung quanh bằng light sprite, không bằng dựng sáng thật |
| Pivot               | (W/2, H − 12) @1x, trùng root bone Spine (00 §3)                                                                                               |
| Tương phản ngày–đêm | Dùng tint toàn cảnh (không đổi sprite); đêm vẫn đảm bảo nhận biết silhouette                                                                   |
| Độ mờ khi che khuất | Shader khoét lỗ / mờ + X-Ray theo [06](06-toi-uu-render.md); mái đình mờ để lộ nội thất (04 §4)                                                |

## 4. Nhân vật & tỷ lệ trên canvas 128 px

### 4.1 Khung

Dùng nguyên số đã khóa ở 03: canvas **128 × 128 @1x (256 × 256 @2x)** cho Player, NPC, quái cỡ người (footprint 1 × 1); chiều cao hình **96–110 px**; pivot **(64, 116)** từ góc trên trái (tức (W/2, H − 12)); hurtbox r 0,45 ô; **pick box 48 × 100 px**, đáy tại pivot.

| Thông số (Đề xuất – chờ duyệt) | Giá trị                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tỷ lệ cơ thể                   | **~5,5–6 đầu** (cách điệu, hơi gọn): đầu ≈ 17–19 px trong chiều cao hình 100 px                                                                                |
| Rộng vai                       | ≈ 28–34 px; thân không vượt **pick box 48 px** (tay vung, vũ khí, tay áo rộng được phép tràn ra ngoài pick box)                                                |
| Chiều cao mũ cao / búi tóc     | Cộng vào `head_top` như dữ liệu trang bị khai báo (03 §4: mũ cao +8, thú cưỡi, ngự kiếm) để UI trên đầu không đè mũ                                            |
| Điểm nhận dạng đọc ở 48 px     | Đầu: 1 chi tiết (mũ / trâm / tóc) ≥ 3 px; ở thân: 1 mảng màu phân biệt phe hoặc hệ                                                                             |
| Nét viền                       | 1 px @1x, tối hơn dải tối nhất của chất liệu                                                                                                                   |
| Hướng vẽ (D14)                 | **Rig Spine 5 hướng (S, SE, E, NE, N) + lật gương** cho SW / W / NW; animation bất đối xứng (vũ khí tay phải) được vẽ đủ 8 hướng, đánh dấu theo từng animation |
| Chiều cao so với quái          | Quái tinh anh: canvas 192, hình ~140 px; Boss 2 × 2 → 256, 4 × 4 → 512 (03 §3)                                                                                 |

Socket vũ khí và phi kiếm theo bảng socket 03 §4 (`hand_R`, `hand_L`, `back`, `chest`, …); phần đồ **không** vẽ trực tiếp lên thân cơ sở mà là paperdoll 15 lớp ([03] §3), nên mọi thiết kế trang phục phải tách lớp được.

### 4.2 Nhân vật theo phe và hệ phái

Silhouette phân biệt bằng **một chi tiết lớn** (không chỉ màu): ví dụ Chính — tay áo dài + dải lụa; Tà — áo choàng xẻ, vai gai; Ma — áo choàng rách, sừng / tóc dựng. Chi tiết hệ phái cụ thể chờ [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md).

## 5. Ngôn ngữ VFX theo Ngũ hành

Mỗi hệ có **ba tín hiệu**: hình dạng, chuyển động, âm thanh đi kèm — để nhận ra hệ ngay cả khi màu bị che bởi số sát thương hay sương độc.

| Hệ   | Hình dạng chủ đạo               | Chuyển động                                | Điểm nhấn                     | Blend / lớp                    | Cách làm tiết kiệm                                                        |
| ---- | ------------------------------- | ------------------------------------------ | ----------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Kim  | Đường thẳng, cung kiếm, mảnh vỡ | Nhanh, dứt khoát, dừng gọn; chớp sáng ngắn | Tiếng kim loại ngân; vệt sáng | Cộng sáng (additive), L4       | Một sprite mảnh kiếm + GPU instancing (Vạn Kiếm, 06)                      |
| Mộc  | Dây leo xoắn, lá, hạt giống     | Mọc dần rồi bung; xoắn ốc                  | Lá rơi, mầm nở                | Thường (normal), L3 / L4       | Particle 2D lá; dây leo theo spline cắt sprite                            |
| Thủy | Đường cong sin, giọt, gợn sóng  | Chảy liên tục, mượt                        | Gợn tròn, nước bắn            | Thường + mờ nhẹ, L1 (gợn) / L4 | Dùng shader sông nước Linh Tuyền ([06]); sóng tính theo toạ độ thế giới   |
| Hỏa  | Lưỡi lửa, tia lửa bay lên       | Nhấp nháy, bay lên, nhiễu                  | Than hồng, bỏng sáng          | Cộng sáng, L4                  | Particle 2D + nhiễu thủ tục; giới hạn tuổi hạt                            |
| Thổ  | Khối chữ nhật, đá, bụi          | Nặng, thấp, rung nhẹ; chậm vào, mạnh ra    | Vụn đá bắn, bụi bốc           | Thường, L3 / L1 (vết nứt)      | Mảnh đá tái sử dụng từ tileset; rung camera tối đa 2 px (có tùy chọn tắt) |

Biến dị: **Phong** giữ ngôn ngữ Mộc nhưng thêm xoáy gió; **Lôi** giữ ngôn ngữ Kim nhưng đường zích-zắc phân nhánh; **Băng** giữ Thủy nhưng đóng tinh thể (ví dụ nhỏ giọt → mảnh băng).

### 5.1 Quy tắc chung cho VFX

- **Không texture cho sét kiếp**: Lôi Kiếp là procedural (fBm, segment mesh; D12), tông trắng–tím `#C6B6FF`; cường độ tăng theo số đạo ([07] §3: 3 → 81 đạo).
- **Tăng phẩm = tăng độ phức tạp, không chỉ độ sáng** (05 §6): kỹ năng cao cấp có thêm lớp chuyển động (hạt bay, quét sáng chéo), nhưng vẫn trong ngân sách hạt.
- **Bản giảm theo cấp máy**: mỗi VFX có bản đầy đủ và bản giảm (ít hạt, không bloom); chiến tranh 100 vs 100 tự dùng bản giảm cho VFX của người khác.
- **Tôn trọng giảm chuyển động**: `prefers-reduced-motion` tắt rung màn hình và hiệu ứng nhấp nháy mạnh (05 §6); không có chớp trắng toàn màn hình liên tục > 3 lần/giây (an toàn động kinh quang nhạy).
- **Kim Quang Hộ Thể**, **khoét lỗ / X-Ray**, **sông nước** là ba shader đã có (06); VFX mới nên dùng chúng trước khi viết shader thứ tư.

## 6. Họ khung UI (đã khóa ở 05 §4)

| Họ khung                    | Dùng cho (05 §4)                                       | Hướng thẩm mỹ bổ sung (Đề xuất)                                                                            |
| --------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Gỗ cổ**                   | Cửa sổ chính, túi đồ, cửa hàng NPC                     | Vân gỗ sẫm ấm, đinh đồng; cảm giác "thư phòng" – dùng cho màn hình thao tác dài                            |
| **Ngọc bích**               | Tooltip, ô kỹ năng, nút chính, popup phần thưởng       | Ngọc xanh lục sáng; tối giản; nút chính màu ngọc, nút nguy hiểm dùng thêm viền đỏ son                      |
| **Thủy mặc**                | Hội thoại, bảng nhiệm vụ, bản đồ, thông báo cốt truyện | Giấy tuyên, nét cọ lan nhẹ; nhiều khoảng trắng; nét cọ trang trí là sprite riêng neo góc                   |
| **Viền sáng Cyber-Xianxia** | HUD nhỏ, khung mục tiêu, thanh máu                     | Viền phát sáng theo **màu hệ** của nhân vật / mục tiêu (shader); dày 8 px @1x; không dùng cho nội dung dài |

Quy tắc: mỗi màn hình dùng **tối đa 2 họ khung**; cửa sổ chính chọn 1 họ làm "nền" (Gỗ cổ hoặc Thủy mặc), họ còn lại chỉ cho tooltip / popup. Phông chữ: xem [19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md) §3; chữ Hán chỉ là họa tiết trên icon (05 §5).

Quy tắc dựng đã khóa (giữ nguyên): góc không giãn; giãn / lặp theo vật liệu; atlas UI extrude 2 px; làm tròn pixel màn hình nguyên; kiểm thử 720p / 1080p / 1440p / 4K ở ba kích thước (05 §4).

## 7. Quy tắc icon (nhắc 05 §5, §6, §7, bổ sung thẩm mỹ)

| Quy tắc                       | Giá trị                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Kích thước                    | Nguồn 256 × 256; xuất 48 / 64 / 128; nền trong suốt; **không** phóng quá 110%                                                |
| Vùng an toàn                  | Vùng nội dung 52 × 52 trên lưới 64; hình chính ≥ 70% vùng nội dung                                                           |
| Nguồn sáng                    | Trên-trái (NW) như môi trường                                                                                                |
| Bản 48 px                     | **Chỉnh tay riêng**: tăng tương phản, viền tối 1 px, bỏ chi tiết < 2 px                                                      |
| Chữ                           | Không chữ Latinh; chữ Hán chỉ là họa tiết                                                                                    |
| Phẩm chất                     | Khung ghép lúc chạy (nền → icon → viền → hiệu ứng động); **icon không vẽ sẵn khung**                                         |
| Silhouette                    | Mỗi icon trong cùng nhóm phải phân biệt được ở thang xám 48 px                                                               |
| Hình khối theo nhóm (Đề xuất) | Đan: tròn; phù lục: chữ nhật đứng nghiêng 15°; bí tịch: ngang; pháp bảo: dài chéo; nguyên liệu: hình tự nhiên không đối xứng |
| Màu đường viền của hệ         | Huy hiệu hệ nhỏ (Hán tự trên nền tròn màu hệ) ở góc dưới phải khi icon có hệ — không đổi màu khung phẩm                      |
| Tên file                      | `icon_<nhóm>_<mã>_<kích thước>.png` (05 §5); nhóm: pill, talisman, manual, material, equip, skill, buff                      |

## 8. Âm thanh

### 8.1 Chuẩn kỹ thuật (đã khóa ở 02, 06)

- Nguồn **WAV 48 kHz / 24-bit**; BGM: M4A/AAC (Safari) + OGG, 96–128 kbps stereo, vòng lặp 3–5 phút, 2–3 stem; SFX ngắn mono 22–44,1 kHz.
- **BGM và ambience luôn stream**, SFX ngắn nạp vào bộ nhớ; chỉ phát sau thao tác đầu tiên của người chơi (autoplay của trình duyệt); tối đa **24 âm** cùng lúc trên Mobile/Web, **48** trên PC; âm định vị bằng pan ngang và suy giảm theo khoảng cách ô; nhạc thích ứng làm bằng crossfade 2–3 stem trong code (02).
- Bộ nhớ âm đã giải mã ≤ **40 MB** (chỉ SFX); gói đầu chỉ có SFX giao diện (≈ 1 MB), phần còn lại tải lười (06 §6).
- Mất focus tab → tạm dừng âm thanh (05 §3).

### 8.2 Chủ đề nhạc theo vùng (Đề xuất – chờ duyệt, dựa trên nhạc cụ ở 02)

| Vùng / tình huống                   | Nhạc cụ chủ (02)                                                                 | Hướng cảm xúc                                                             | Stem                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Sân Nhập Môn / Chân núi**         | Địch tử, cổ cầm nhẹ                                                              | Mở, ấm, mời gọi (FTUE [16](16-onboarding.md))                             | 2 stem: nền + giai điệu                               |
| **Sơn Môn Đại Phái** (ngày / đêm)   | Cổ cầm, chuông đồng, tiêu                                                        | Trang nghiêm, thanh tĩnh; đêm thưa nhạc và có thêm gió                    | 3 stem (nền, giai điệu, nhịp); biến thể ngày / đêm    |
| **Hậu sơn / Tụ Linh Nhãn**          | Cổ tranh, nước chảy                                                              | Tĩnh tâm, ứng với tu luyện                                                | 2 stem + ambience thác                                |
| **Bí Cảnh Rừng Độc**                | Tiêu, synth pad trầm, nhịp thưa                                                  | Bất an, thở nhẹ, dồn dập khi vào vùng sương độc                           | 3 stem; tăng stem căng thẳng theo cường độ giao tranh |
| **Chiến đấu thường**                | Tỳ bà tremolo, trống trận                                                        | Dồn dập; chuyển ở ranh giới ô nhịp                                        | Stem cường độ                                         |
| **Boss / Lôi Kiếp / Phi Thăng**     | Dàn đầy đủ; Lôi Kiếp tăng theo số đạo sét                                        | Hùng tráng; đổi theo phase boss                                           | Theo phase                                            |
| **Chiến tranh Linh Mạch** ([14] §5) | Trống trận, kèn                                                                  | Hùng hồn; thay đổi theo ba giai đoạn (Chuẩn bị / Công trận / Quyết chiến) | 3 stem tương ứng 3 giai đoạn                          |
| **Chủ đề tông môn theo phe** (02)   | Chính: cổ cầm, chuông đồng · Tà: suona lệch điệu · Ma: hợp xướng trầm, synth méo | Nhận diện phe                                                             | 3 × 2 biến tấu                                        |
| **Stinger**                         | Ngắn 2–8 s                                                                       | Đột phá thành công / thất bại, vật phẩm hiếm, chiếm Linh Mạch             | 30 clip (02)                                          |

### 8.3 Danh mục SFX

Số lượng đã có ở 02 (MVP): Lôi Kiếp 40 (3 lớp theo khoảng cách: xa rền trầm, trung, gần nổ sắc); Vận khí 20 (drone theo cảnh giới, cao độ tăng theo tiến độ đột phá); Chiến đấu ~600 (bảng âm sắc theo hệ); Di chuyển 120 (bước chân theo loại ô lấy từ lớp **Terrain**, gió ngự kiếm); UI 80 (cọ lướt giấy, ấn triện, chuông nhỏ, ngọc va; biến thể theo phe); Stinger 30.

Danh mục (phân loại) đề xuất bổ sung cho các hệ thống mới:

| Nhóm SFX                    | Nội dung                                                                         | Ghi chú                                                         |
| --------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Chiến đấu theo hệ           | Kim: keng; Mộc: rì rào; Thủy: ào; Hỏa: bùng; Thổ: ầm; biến dị Phong / Lôi / Băng | Khớp ngôn ngữ VFX §5; **khắc** có âm "chạm" riêng (07 §4: +25%) |
| Khắc / bị khắc              | Âm tăng áp lực khi khắc; âm "bị chặn" khi bị khắc                                | Hỗ trợ người mù màu                                             |
| Chế tạo ([13])              | Đan lô sôi, búa lò rèn, bút phù, kết quả thành công / thất bại                   | 6 cấp phẩm → 6 mức âm kết quả                                   |
| Nhặt đồ theo phẩm           | Âm nhặt tăng dần theo 6 cấp; Thiên / Tiên phẩm có thông báo toàn kênh (05 §7)    | Cùng 6 cấp với cột sáng vật phẩm                                |
| Đột phá / Tâm Ma / Lôi Kiếp | Chuông, tim đập, sét; Cửu Cửu Thiên Kiếp có lớp đặc biệt                         | 07 §3                                                           |
| PvP & chiến tranh ([14])    | Đếm ngược, chiếm Trận Nhãn, trận tắt, hồi sinh chiến trướng                      | Nhẹ để không chồng âm 100 vs 100; ưu tiên ≤ 24 âm Mobile        |
| Giao diện xã hội            | Tin nhắn, mời đội, tin tông môn                                                  | Có tùy chọn tắt theo nhóm                                       |
| Ambience                    | Gió núi, suối, côn trùng, nhỏ giọt, sương độc                                    | Stream, luôn theo vùng                                          |

### 8.4 Chính sách giọng nói (VO)

| Mục                        | Đề xuất                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MVP**                    | **Không VO đầy đủ.** Hội thoại là chữ (khung Thủy mặc), kèm âm nhấn không lời (ngắn, tiếng "ừm", thở, cười) để nhân vật có "giọng"                                      |
| Tiếng tương lai            | Tiếng Việt trước ([19] §2); thu theo kịch bản có khóa chuỗi; tải lười khi mở hội thoại (06 §6: VO tải khi mở hội thoại, stream)                                         |
| Diễn viên                  | Hợp đồng giải phóng quyền bằng văn bản; ghi tên diễn viên, quyền thương mại, phạm vi sử dụng vào hồ sơ giấy phép (§9)                                                   |
| **Giọng tổng hợp bằng AI** | **Không dùng ở bản phát hành** trừ khi: (1) giấy phép công cụ cho phép thương mại, (2) không nhân bản giọng người thật nếu thiếu sự đồng ý, (3) ghi vào hồ sơ giấy phép |
| Âm nhạc / SFX AI           | Cùng điều kiện như asset AI ở §9                                                                                                                                        |

## 9. Asset AI, placeholder & theo dõi giấy phép

Quy tắc này **bổ sung** quy trình bắt buộc đã có trong skill `vgtd-asset-pipeline`: mọi asset không sinh bởi `tools/procgen` hoặc không vẽ nội bộ phải **kiểm tra giấy phép trước khi tải vào repo**, chỉ chấp nhận giấy phép cho phép dùng thương mại và phân phối trong binary game (ví dụ CC0, CC-BY có ghi công, MIT/OFL cho phông chữ), từ chối NC, ND, SA khi kéo theo giấy phép cho art của chính game, "chỉ dùng cá nhân", giấy phép không rõ hoặc thiếu, art sao chép không ghi nguồn; nếu không xác định được giấy phép thì **không thêm** asset và ghi vào [OPEN-ITEMS.md](OPEN-ITEMS.md).

### 9.1 Hồ sơ giấy phép `docs/ASSET-LICENSES.md`

Tại thời điểm viết, **file này chưa tồn tại** trong repo; người nhập asset bên thứ ba đầu tiên tạo nó theo khung sau (không thuộc phạm vi PR này):

| Cột                       | Nội dung                                                                |
| ------------------------- | ----------------------------------------------------------------------- |
| `Tên asset`               | Tên file / bộ asset trong repo                                          |
| `Loại`                    | `third-party` · `ai-generated` · `procgen` · `in-house` · `placeholder` |
| `Nguồn (URL)` / `Tác giả` | Trang gốc, người làm                                                    |
| `Giấy phép`               | Tên + phiên bản (ví dụ CC0 1.0, CC-BY 4.0, OFL 1.1)                     |
| `Yêu cầu ghi công`        | Văn bản bắt buộc; có đưa vào màn hình "Credits" hay không               |
| `Ngày kiểm tra`           | Ngày kiểm tra giấy phép (ISO)                                           |
| `Dùng ở`                  | Bundle / màn hình / bản đồ                                              |
| `Phát hành?`              | `yes` / `no` (xem placeholder bên dưới)                                 |
| `Ghi chú`                 | Chỉnh sửa, hạn chế                                                      |

### 9.2 Asset AI tạo sinh (AI-generated)

Chỉ được vào build phát hành nếu **thỏa tất cả**:

1. **Công cụ cho phép thương mại**: ghi tên công cụ, phiên bản mô hình, ngày; lưu ảnh chụp điều khoản (hoặc đường dẫn) vào hồ sơ. Điều khoản thay đổi → kiểm tra lại.
2. **Không bắt chước họa sĩ còn sống / tác phẩm cụ thể**: cấm lệnh kiểu "theo phong cách của <họa sĩ>"; cấm đưa ảnh tham chiếu có bản quyền của người khác.
3. **Không chứa người thật, thương hiệu, logo, chữ Hán tạo sinh có nghĩa sai** (chữ Hán trên phù lục chỉ là họa tiết nhưng phải rà soát để không ra nghĩa xúc phạm).
4. **Có bước chỉnh tay của họa sĩ** (tối thiểu đồng bộ bảng màu §2, pivot, nguồn sáng NW, thang xám 48 px); asset AI chưa qua bước này là `placeholder`.
5. **Lưu prompt, seed, mô hình, ngày** trong hồ sơ. Với pipeline có bước AI trong `orchestrator_pipeline.yaml` ([00] §6) áp dụng cùng quy tắc.
6. **Quyền tác giả của sản phẩm AI**: khả năng đăng ký và bảo hộ tại Việt Nam và các thị trường khác **cần kiểm tra** (xem [19](19-ngon-ngu-phap-ly.md) §5); vì vậy asset cốt lõi định danh game (logo, nhân vật chính, biểu tượng tông môn) **không** nên chỉ do AI sinh ra, mà phải do họa sĩ vẽ / tinh chỉnh đáng kể.

Asset sinh bằng mã (`tools/procgen`: tilemap, phi kiếm, icon, shader) không phải AI tạo sinh và không cần hồ sơ prompt; ghi `procgen` + seed (nguyên tắc "commit seeds, not images").

### 9.3 Asset placeholder

- Đánh dấu `Loại = placeholder` và `Phát hành? = no` trong hồ sơ; đặt trong thư mục có tiền tố `_placeholder/` của bundle (không đổi quy ước tiền tố `spr_` / `spn_` / `atl_` / `ui_` / `sfx_` / `bgm_` ở 02).
- **Cổng phát hành:** bản build phát hành thất bại nếu còn asset `placeholder` (hoặc `third-party` thiếu dòng hồ sơ) — đề xuất thêm vào bước `validate` của `tools/procgen/pipeline/validate_assets.js` (thuộc `@vgtd/procgen`, nằm ngoài phạm vi tài liệu này).
- Placeholder vẫn phải đúng **kích thước, pivot, lớp và ngân sách** (để không phát sinh lỗi khi thay thế); chỉ khác nội dung hình.
- Không dùng placeholder có logo hoặc chữ của công cụ tạo sinh.

### 9.4 Nguồn bên thứ ba thường dùng

Kenney, OpenGameArt, itch.io, game-icons.net: dùng kết quả từ công cụ tra cứu giấy phép, không đoán; ghi công trong màn hình Credits nếu giấy phép yêu cầu. Phông chữ: chỉ phông có giấy phép thương mại cho nhúng vào game (ví dụ OFL), xem [19] §3.

## 10. Khả năng tiếp cận trong nghệ thuật

- Phẩm chất đọc được bằng **dấu góc + hình**, không chỉ màu (05 §7).
- Hệ đọc được bằng **huy hiệu Hán tự + hình dạng VFX**, không chỉ màu (§2.3, §5).
- Tên vật phẩm đạt tương phản 4,5:1 trên cả nền sáng lẫn tối (05 §7).
- Có tùy chọn giảm chuyển động, tắt rung màn hình, tắt nhấp nháy (05 §6, §5.1).
- Cỡ chữ UI có thanh trượt 80–120% (05 §1).
- Thử mù màu bắt buộc cho: cờ chiến, hệ Ngũ hành, phẩm chất.

## Câu hỏi cần chốt

| #   | Câu hỏi                                                                                               | Mặc định đề xuất                                                                          |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Q1  | Bảng màu Ngũ hành (§2.3) và bảng màu vùng (§2.4)                                                      | Dùng làm điểm xuất phát; họa sĩ chủ chốt tinh chỉnh bằng thử thực tế trên tilemap mẫu     |
| Q2  | Tỷ lệ nhân vật ~5,5–6 đầu và đầu ≈ 17–19 px trong chiều cao 100 px                                    | Giữ; xác nhận bằng một nhân vật mẫu trước khi vẽ hàng loạt                                |
| Q3  | Cho phép asset AI vào bản phát hành (điều kiện §9.2) hay chỉ làm placeholder?                         | Chỉ placeholder ở MVP; đưa vào phát hành sau khi có chỉnh tay và hồ sơ giấy phép          |
| Q4  | Ai tạo và sở hữu `docs/ASSET-LICENSES.md`, và có thêm cổng CI cho placeholder không?                  | Người nhập asset bên thứ ba đầu tiên tạo; thêm cổng vào `validate_assets.js` qua PR riêng |
| Q5  | VO: MVP không có VO, và không dùng giọng AI ở bản phát hành                                           | Có                                                                                        |
| Q6  | Tên nhạc cụ và thành phần nhạc theo vùng (§8.2) có giữ danh sách này, hay yêu cầu nhà soạn nhạc chốt? | Giữ làm brief; nhà soạn nhạc tinh chỉnh                                                   |
| Q7  | Có bắt buộc **thử mù màu** (cờ chiến, hệ, phẩm) trước mỗi bản phát hành không?                        | Có                                                                                        |
| Q8  | Hệ biến dị (Phong / Lôi / Băng) có bảng màu riêng như §2.3 hay dùng màu hệ gốc?                       | Có màu riêng nhưng chung ngôn ngữ chuyển động hệ gốc                                      |
