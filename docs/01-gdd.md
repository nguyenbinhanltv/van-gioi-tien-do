# GDD – MMORPG Tu Tiên "Vạn Giới Tiên Đồ" (High Level)

> **Nguồn & phạm vi của tài liệu này.** Bộ hồ sơ **không có file `.docx` GDD riêng** trong số 8 tài liệu được bàn giao. GDD gốc (viết khi dự án còn định hướng 3D / UE5) chỉ được **tóm tắt** trong [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) (§1, §2, §5.1) và được lượng hóa trong [07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md). Bản này được **dựng lại từ các nguồn đó**, đã áp dụng toàn bộ mục §4 "Các quyết định đã bị thay thế". Chi tiết gameplay mà hồ sơ không ghi (nhiệm vụ, nghề, PvP, kiếm tiền, onboarding, LiveOps, telemetry) được liệt kê ở [OPEN-ITEMS.md](OPEN-ITEMS.md), **không được bịa thêm ở đây**.
>
> Mọi chỗ khác với GDD gốc được đánh dấu _[Cập nhật §4: …]_. Danh sách tổng hợp: [DECISIONS.md](DECISIONS.md).

## 1. Tổng quan

**Vạn Giới Tiên Đồ** (tên tạm) là MMORPG tu tiên **2D Isometric 2:1** _[Cập nhật §4: GDD gốc ghi "MMORPG 3D thế giới mở" → 2D Isometric 2:1, thế giới mở chia chunk 32 × 32 ô]_, chạy đồng thời trên **Web (H5/WebGL), Mobile (iOS/Android) và PC Client, cross-play** _[Cập nhật §4: gốc "PC + Mobile" → Web H5 + Mobile + PC, cross-play]_.

| Hạng mục            | Giá trị hiện hành                                                   | Ghi chú thay đổi                                                                            |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Thể loại / góc nhìn | 2D Isometric 2:1 (Dimetric), thế giới mở chia chunk                 | _[Cập nhật §4: thay 3D thế giới mở]_                                                        |
| Engine              | **Cocos Creator 3.x** (dự phòng: Unity 2D, Godot 4)                 | _[Cập nhật §4: thay Unreal Engine 5]_                                                       |
| Nền tảng            | Web H5/WebGL, iOS, Android, PC; cross-play                          | _[Cập nhật §4: thay PC + Mobile]_                                                           |
| Hình thức asset     | Sprite Sheet, Spine 2D, Tilemap diamond, Particle 2D, sprite shader | _[Cập nhật §4: thay Mesh, LOD, Nanite, Niagara]_                                            |
| Gói tải đầu (Web)   | ≤ **25 MB**                                                         | _[Cập nhật §4: thay 30 MB (dự phòng 29 MB)]_                                                |
| Thang phẩm chất     | **6 phẩm: Trắng → Lục → Lam → Tím → Vàng → Đỏ**                     | _[Cập nhật §4: thay thang 5 phẩm]_                                                          |
| Icon                | Nguồn 256, xuất 48 / 64 / 128                                       | _[Cập nhật §4: thay nguồn 512 → hiển thị 256 (3D) và nguồn 256 → hiển thị 128 (Matrix 2D)]_ |

Hệ quả kỹ thuật của việc đổi sang 2D: xem [02-asset-matrix-2d.md](02-asset-matrix-2d.md), [04-tilemap.md](04-tilemap.md), [06-toi-uu-render.md](06-toi-uu-render.md) và [08-server-architecture.md](08-server-architecture.md).

## 2. Core loop

Luyện khí → Vượt ải / Săn quái → Tài nguyên, Đan dược → Đột phá → Trọng sinh / Phi Thăng.

Bốn tầng vòng lặp, từ 5 phút đến 12 tháng _(hồ sơ tổng hợp chỉ ghi khung thời gian này; chi tiết từng tầng chưa có trong tài liệu nguồn — xem OPEN-ITEMS)_.

## 3. Hệ thống cảnh giới

- **9 cảnh giới, 41 nấc**: Luyện Khí (9 tầng) và 8 cảnh giới còn lại, mỗi cảnh giới 4 tiểu cảnh (Sơ, Trung, Hậu, Viên Mãn). Thứ tự: Luyện Khí → Trúc Cơ → Kim Đan → Nguyên Anh → Hóa Thần → Luyện Hư → Hợp Thể → Đại Thừa → Độ Kiếp; vượt qua Độ Kiếp là **Phi Thăng**.
- Mỗi cảnh giới mở một cơ chế mới (bay, phân thân Nguyên Anh, Lĩnh Vực, Pháp Tướng…).
- **Thất bại đột phá không rớt cảnh giới lớn.**
- Ở các ngưỡng lớn có **Tâm Ma** và/hoặc **Lôi Kiếp** (Kim Đan → Nguyên Anh: 3 đạo; … ; Độ Kiếp → Phi Thăng: Cửu Cửu Thiên Kiếp 81 đạo — bảng đầy đủ ở [07](07-cong-thuc-data-schema.md) §2).

### 3.1 Chỉ số theo cảnh giới

Stat = B · λ^x, với x = (r − 1) + 0,6·(k − 1)/K_r; λ: HP 1,78 · MP 1,70 · Công 1,75 · Thủ 1,72; Thân pháp tuyến tính. 60% mức tăng nằm ở các tiểu cảnh, 40% dồn vào lần đột phá; số đòn hạ gục cùng cảnh giới chỉ tăng khoảng 10% sau 9 cảnh giới. (Chi tiết: [07](07-cong-thuc-data-schema.md) §1.)

### 3.2 Công thức đột phá _[Cập nhật §4: công thức mới]_

Gốc (đã bỏ): cộng dồn `Base + Đan + Trận + Đạo tâm + 8%·thất bại`.

Hiện hành:

```latex
\text{Success} = \mathrm{clamp}\big(\text{Base}_{\text{eff}} \cdot (1 + \text{Pill}) - \text{Karma\_Penalty},\; 0{,}05,\; 0{,}95\big)
```

- Clamp 5% – 95%; pity +8% mỗi lần thất bại liên tiếp, **trần +40%** (Base_eff = Base_r + min(0,08·n_fail; 0,40)).
- Đan dược nhân với Base (Pill), Nghiệp xấu trừ thẳng (Karma_Penalty) — nên Ma đạo tu nhanh nhưng càng lên cao càng khó đột phá.
- Server roll bằng RNG có seed và ghi log.

### 3.3 Lôi Kiếp _[Cập nhật §4: từ mô tả định tính sang số liệu]_

Gốc: mô tả định tính (số đạo, telegraph). Hiện hành: **sát thương thuần theo đợt**, `Strike = HP_ref · κ_r · 1,22^(w−1)`, tổng 0,6 → 3,0 × HP_ref; κ_r riêng cho từng ngưỡng; **nguồn giảm trừ là bắt buộc** (chỉ các nguồn được liệt kê mới có tác dụng). Ví dụ lớn nhất: Cửu Cửu Thiên Kiếp 81 đạo.

**VFX Lôi Kiếp: procedural** (fBm, segment mesh, không texture) _[Cập nhật §4: thay flipbook 128 × 512, 8 frame, 4 biến thể]_; bloom giả/thật theo cấp máy — xem [06](06-toi-uu-render.md).

## 4. Ngũ hành _[Cập nhật §4: số mới]_

|                | Gốc (GDD bản đầu)                               | Hiện hành                                                                                                                     |
| -------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Tương khắc** | +30% sát thương, xuyên 20% kháng                | **+25% sát thương, −15% Phòng ngự (DEF) mục tiêu**; bên bị khắc: **−15% sát thương**                                          |
| **Tương sinh** | +20% buff và hồi phục cho đồng đội hệ được sinh | **Hồi 10% Chân Nguyên** (tối đa) khi hỗ trợ đồng đội hệ được sinh; hồi chiêu 10 s mỗi cặp người nhận; không áp lên chính mình |

- Khắc: Kim → Mộc → Thổ → Thủy → Hỏa → Kim. Sinh: Kim → Thủy → Mộc → Hỏa → Thổ → Kim. Hệ biến dị: Phong → Mộc, Lôi → Kim, Băng → Thủy.
- Ma trận hệ số và công thức sát thương tổng: [07](07-cong-thuc-data-schema.md) §4. Linh căn (Đơn 1,6 · Song 1,3 · Tạp 1,0 / 0,85 / 0,7; hấp thu ∝ √Match môi trường): §5.

## 5. Phe phái, Nghiệp Lực, chiến tranh

- Phe **Chính – Tà – Ma** theo **Nghiệp Lực** và **Đạo Tâm**; nghiệp báo, nhân quả tuyến, rơi đồ theo nghiệp.
- **Chiến tranh Linh Mạch** giữa các tông môn, có **Hộ Sơn Đại Trận** (chiếm / giữ Linh Mạch — xem thêm 02, 06, 08 về VFX pháp trận và băng thông chiến tranh ~25 KB/s).

## 6. Kinh tế

- Tiền tệ: **Linh thạch 3 phẩm (hạ / trung / thượng)**, **Tiên Ngọc**, **Cống hiến**.
- Chợ **Vạn Bảo Lâu**: niêm yết 1% + thuế bán 5–10% theo CPI tuần; giao dịch trực tiếp 3%. **Đấu Giá Hội** hủy tiền (tiền sink).
- Mục tiêu: **tiêu hao / sinh ra = 0,9 – 1,0 mỗi tuần**; công cụ chống lạm phát: thuế theo CPI, truyền tống, độ bền (xem [07](07-cong-thuc-data-schema.md)).

## 7. Vật phẩm & phẩm chất _[Cập nhật §4]_

- Phẩm chất áp dụng cho pháp bảo, đan dược, viền icon: **6 phẩm Trắng → Lục → Lam → Tím → Vàng → Đỏ**, có dấu góc cho người mù màu _[Cập nhật §4: gốc 5 phẩm]_.
- Icon: nguồn 256 × 256, xuất 48 / 64 / 128; viền phẩm ghép lúc chạy (chi tiết [05](05-ui-ux-icon.md)).
- Vạn Kiếm Quy Tông (chiêu hiệu): 1 sprite kiếm + **GPU instancing**, quỹ đạo tính trong vertex shader, dưới 0,5 MB _[Cập nhật §4: gốc Niagara / flipbook]_ — [06](06-toi-uu-render.md) §1.

## 8. Các mảng chưa có tài liệu

Nhiệm vụ & cốt truyện; nghề luyện đan / luyện khí / chế phù; luật PvP & đấu trường; kiếm tiền (Tiên Ngọc, Battle Pass, cửa hàng); hướng dẫn người chơi mới; sự kiện & LiveOps; telemetry & dashboard KPI. → [OPEN-ITEMS.md](OPEN-ITEMS.md).
