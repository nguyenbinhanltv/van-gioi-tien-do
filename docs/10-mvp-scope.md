# Phạm vi MVP – Closed Beta

> **Trạng thái: thiết kế mới – chờ duyệt.** Tài liệu này định nghĩa **cụ thể** bản closed beta đầu tiên. Mọi con số là **Đề xuất – chờ duyệt** trừ khi ghi nguồn [07](07-cong-thuc-data-schema.md) / `@vgtd/shared` / [00 §3](00-ho-so-tong-hop.md). Không mâu thuẫn [00 §3–§4](00-ho-so-tong-hop.md). Các cột "02" trích **đúng con số "SL MVP" của [02-asset-matrix-2d.md](02-asset-matrix-2d.md)** — đó là số lượng **bản thiết kế đầy đủ**, không phải beta; cột "Beta" là phạm vi thu gọn đề xuất ở đây.
>
> Bối cảnh: [01-gdd.md](01-gdd.md) · hệ phái và kỹ năng: [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md).

## 1. Mục tiêu closed beta

Closed beta **không** nhằm trình diễn toàn bộ game; nó nhằm **kiểm chứng 5 giả thuyết** rủi ro nhất trước khi đầu tư sâu:

| #   | Giả thuyết                                                                                                                                     | Đo bằng                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| H1  | **Kỹ thuật:** client Cocos Creator 2D isometric chạy trong ngân sách (Web ≤ 25 MB tải đầu, RAM ≤ 500 MB, ≤ 80 draw call) trên máy trung bình.  | Telemetry hiệu năng; test máy thật                              |
| H2  | **Netcode:** kiến trúc server 20 Hz + AOI của [08](08-server-architecture.md) chịu được CCU mục tiêu trên máy local, băng thông ~8 KB/s/người. | Test tải bot; số đo tick / băng thông                           |
| H3  | **Vòng lặp lõi:** "săn – đả tọa – đột phá" đủ cuốn để người chơi quay lại (D1 / D7) và nhìn thấy tiến bộ trong 3 cảnh giới đầu.                | D1 / D7, độ dài phiên, funnel đột phá                           |
| H4  | **Công thức:** các hệ số ở 07 (đột phá, Lôi Kiếp, drop, Ngũ hành) cho nhịp tiến bộ và kinh tế đúng ý đồ.                                       | Tỷ lệ thành công đột phá, tiêu hao / sinh ra, thời gian lên nấc |
| H5  | **Hệ phái:** 4 Đạo Lộ đủ khác biệt và cân bằng tương đối.                                                                                      | Tỷ lệ chọn Đạo Lộ, TTK / DPS theo Đạo Lộ, phản hồi              |

Không thuộc mục tiêu: kiếm tiền, mở rộng nội dung, chiến tranh Linh Mạch quy mô lớn, SSO.

## 2. Phạm vi cảnh giới

**Khuyến nghị: Cảnh giới 1–3 (Luyện Khí → Trúc Cơ → Kim Đan), level cap 70, kèm "cổng Kết Anh" làm đỉnh beta.**

| Cảnh giới | Level (07 §8) | Nấc `s` | Cơ chế mở trong beta (`unlocks`, 07 §8)                | Đột phá lên cảnh giới kế (07 §2)        |
| --------- | ------------- | ------- | ------------------------------------------------------ | --------------------------------------- |
| Luyện Khí | 1–30          | 1–9     | Linh căn, khinh công, pháp bảo ô 1                     | Base 0,70 · không kiếp                  |
| Trúc Cơ   | 31–50         | 10–13   | Bay thấp, thần thức 50 m, chế tác (luyện đan tối giản) | Base 0,55 · Tâm Ma nhẹ                  |
| Kim Đan   | 51–70         | 14–17   | Bay tự do, pháp bảo bản mệnh                           | Base 0,45 · **Lôi Kiếp 3 đạo + Tâm Ma** |

- **Vì sao dừng ở 3:** từ Nguyên Anh trở lên mở cơ chế đắt (phân thân, Lĩnh Vực, Pháp Tướng) và cần map / quái / kiếp lớn — vượt ngân sách beta. Ba cảnh giới đầu đã đủ chạm: Linh căn, đả tọa, đột phá tiểu cảnh, 2 đột phá lớn có kiếp (Tâm Ma nhẹ; Tâm Ma + Lôi Kiếp 3 đạo), bay, Nghiệp Lực.
- **Cổng Kết Anh:** Kim Đan Viên Mãn (level 70, nấc 17) có thể **thử Kết Anh** (Lôi Kiếp 3 đạo, tổng 0,6 × HP_ref — qua được không cần giảm trừ; 07 §3). Thành công → nhân vật thành **Nguyên Anh Sơ kỳ, level 71, khóa cứng ở đó** ("Sắp mở" cho nội dung sau), cơ chế `nascent_soul_projection` / `blink` **tắt bằng cờ**. Phương án B (chủ dự án chọn): cap cứng ở Kim Đan Viên Mãn, Lôi Kiếp 3 đạo chỉ là **thử kiếp không đổi trạng thái** — xem _Câu hỏi cần chốt_ M1.
- **Pacing mục tiêu** (nhất quán [01 §3.4](01-gdd.md)): **~26 giờ chơi** để đạt Kim Đan Viên Mãn (Luyện Khí 6 giờ + Trúc Cơ 8 + Kim Đan 12), trong đó tu thuần chỉ **5,6 giờ** (hệ số 1; 07 §5).

### 2.1 Nhịp tu thuần 17 nấc (hệ số 1: `ρ · P_n · √Match = 1`)

Tính từ 07 §5: `Req(s) = 1000 · 1,35^(s−1)`, `t(s) = 10 phút · 1,08^(s−1)`. Linh căn Đơn đứng đúng nơi hợp hệ có thể nhanh ×2,5 (Đơn Mộc ở Rừng Độc, 07 §5 bảng ví dụ), Tạp Ngũ chậm ×0,7.

| `s` | Nấc                            | Tu vi cần `Req(s)` | Thời gian `t(s)` (phút) | Tích lũy (giờ) |
| --- | ------------------------------ | ------------------ | ----------------------- | -------------- |
| 1   | Luyện Khí 1                    | 1.000              | 10,0                    | 0,17           |
| 3   | Luyện Khí 3                    | 1.823              | 11,7                    | 0,54           |
| 5   | Luyện Khí 5                    | 3.322              | 13,6                    | 0,98           |
| 9   | Luyện Khí 9 → **Trúc Cơ**      | 11.032             | 18,5                    | 2,08           |
| 10  | Trúc Cơ Sơ                     | 14.894             | 20,0                    | 2,41           |
| 13  | Trúc Cơ Viên Mãn → **Kim Đan** | 36.644             | 25,2                    | 3,58           |
| 14  | Kim Đan Sơ                     | 49.470             | 27,2                    | 4,04           |
| 17  | Kim Đan Viên Mãn → **Kết Anh** | 121.714            | 34,3                    | **5,63**       |

Hai ngưỡng đột phá lớn trong beta + cổng Kết Anh nằm ở `s = 9, 13, 17`. Tiểu cảnh còn lại có Base 0,90 (Luyện Khí) / 0,85 (07 §2), không kiếp, **không áp đan và pity** (D19, [DECISIONS.md](DECISIONS.md)).

### 2.2 Tỷ lệ đột phá tham chiếu cho cân bằng (07 §2, K = 0)

| Ngưỡng               | Base | Chủ đan Lam (b = 0,40)             | Chủ đan Tím + phụ đan Lam                                  | Ghi chú                                     |
| -------------------- | ---- | ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| LK → Trúc Cơ         | 0,70 | 0,70 × 1,40 = 0,98 → **95%** (kẹp) | —                                                          | Ví dụ gốc 07 §2                             |
| Trúc Cơ → Kim Đan    | 0,55 | 0,55 × 1,40 = **77%**              | 0,55 × 1,584 = **87%**                                     | Có Tâm Ma nhẹ (thua thì chưa tới bước roll) |
| Kim Đan → Nguyên Anh | 0,45 | 0,45 × 1,40 = **63%**              | 0,45 × 1,584 = **71%** (K = 0); 63,3% khi K = −400 (07 §2) | Có Lôi Kiếp 3 đạo                           |

Pill của "Chủ đan Tím + phụ đan Lam" = 1 − (1 − 0,40 · 1,2)(1 − 0,20 · 1,0) = 0,584 (07 §2).

## 3. Bản đồ

Hai bản đồ từ [04 §5](04-tilemap.md); số liệu giữ nguyên.

| Bản đồ               | Kích thước                          | Loại (04)                              | Vai trò trong beta                                                                   | Bundle (04)         |
| -------------------- | ----------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ | ------------------- |
| **Sơn Môn Đại Phái** | 256 × 256 ô (8 × 8 chunk), tầng 0–4 | Thành chính tông môn, **vùng an toàn** | Trung tâm: tạo nhân vật, tutorial, NPC, chợ, tu luyện, luyện đan, tông môn, hồi sinh | Sect pack 12–15 MB  |
| **Bí Cảnh Rừng Độc** | 192 × 192 ô (6 × 6 chunk), tầng 0–2 | Bí cảnh mở theo mùa, **vùng PK**       | Nơi săn quái / tinh anh / boss, PK có điều kiện, kiếm Nghiệp Lực                     | Event pack 10–15 MB |

### 3.1 Phân vùng và dải level _(Đề xuất)_

Các khu vực là của 04; dải level và luật vùng là đề xuất.

| Bản đồ · Khu vực (04)                                                   | Level mục tiêu | Zone _(Đề xuất)_ | Nội dung beta                                                                                                  |
| ----------------------------------------------------------------------- | -------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Sơn Môn · Quảng trường luyện võ (tầng 1)                                | 1–5            | An toàn          | **Tutorial:** mộc nhân, kỹ năng đầu, đả tọa; lôi đài 12 × 12 (đặt nhưng **tắt PvP** beta)                      |
| Sơn Môn · Chân núi & Cổng; Tàng Kinh Các / Đan Phòng; Đại điện; Hậu sơn | —              | An toàn          | Chợ đệ tử (Vạn Bảo Lâu), NPC, mua bí tịch, luyện đan, nhận nhiệm vụ, Hậu sơn Tụ linh nhãn (đả tọa tốt)         |
| Rừng Độc · **Bìa rừng** (tầng 0, 48 × 32)                               | 5–30           | **PvE** (cấm PK) | Quái thường 3 loại + 1 tinh anh; tán thưa để làm quen — "vùng nhập môn" cho người mới ([04 §5](04-tilemap.md)) |
| Rừng Độc · **Đầm lầy độc** (tầng 0, 64 × 64)                            | 20–50          | PK               | 2 loại quái + 1 tinh anh; đầm độc mất máu theo giây, ván gỗ                                                    |
| Rừng Độc · **Cổ thụ trung tâm** (tầng 1–2, 48 × 48)                     | 40–70          | PK               | 2 loại quái + 1 tinh anh + **boss 2 × 2**; linh dược hiếm, rễ cây nhiều tầng                                   |
| Rừng Độc · **Độc Hỏa Đàm** (tầng 0, 40 × 40)                            | 50–70          | PK               | 1 loại quái + 1 tinh anh + **đấu trường boss 4 × 4**                                                           |
| Rừng Độc · Lối thoát (16 × 16)                                          | —              | An toàn          | Truyền tống về Sơn Môn, mở theo thời gian (04)                                                                 |

Ghi chú:

- **Không có bản đồ săn quái cho level 1–5 ngoài Sơn Môn an toàn** → tutorial dùng **mộc nhân** (bất động, không phản công) trong Quảng trường luyện võ; quái thật đầu tiên ở Bìa rừng. Nếu chủ dự án muốn có quái trong Sơn Môn: _Câu hỏi cần chốt_ M3.
- **Luật PK beta:** chỉ Đầm lầy / Cổ thụ / Độc Hỏa Đàm là PK; Bìa rừng là PvE; Sơn Môn an toàn. Giết người có hậu quả Nghiệp Lực ([01 §8.4](01-gdd.md)). Không có tuần tra / bảo vệ người mới ngoài việc Bìa rừng cấm PK.
- **"Mở theo mùa":** beta chạy **Mùa 0** — Rừng Độc mở liên tục; "đóng / mở theo mùa" là hướng sau.
- **Instance:** một Rừng Độc dùng chung (một World Node); nếu CCU quá giới hạn (mục 8), tách bản sao theo "kênh" (kênh 1/2) — kênh là instance cùng bản đồ, không chuyển cư; chưa làm sharding chunk ở P2.
- **Chunk / streaming:** quy tắc 3 × 3 / 5 × 5 / 7 × 7 ([02](02-asset-matrix-2d.md) §Streaming); chunk 32 × 32 ô (`@vgtd/shared` `CHUNK_SIZE`).

## 4. Quái, tinh anh, boss

**Số lượng beta: 8 loại quái thường (× 2 biến thể ngũ hành = 16) · 4 tinh anh · 2 boss.** Tên là **tên tạm**.

Cơ sở nguồn: 02 §1 ("Quái thường 25 loại × 4 biến thể; Tinh anh 20; Boss 12"), 03 §6 (canvas theo footprint: quái 1 × 1 = 128; tinh anh = 192; boss 2 × 2 = 256, 4 × 4 = 512), 04 §5 (khu vực).

| Khu vực          | `id` (tạm)          | Tên                  | Loại     | Hệ chính / biến thể | Level | Footprint       | Kỹ năng đặc biệt (có telegraph — 11 §3.5)                                           |
| ---------------- | ------------------- | -------------------- | -------- | ------------------- | ----- | --------------- | ----------------------------------------------------------------------------------- |
| Bìa rừng         | `mob_doc_tho`       | Độc Thố              | Thường   | Mộc / Thủy          | 5–15  | 1 × 1           | — (chỉ đòn thường)                                                                  |
| Bìa rừng         | `mob_hoi_lang`      | Hôi Lang             | Thường   | Kim / Thổ           | 10–25 | 1 × 1           | Vồ (cone 60°, telegraph 800 ms)                                                     |
| Bìa rừng         | `mob_thanh_xa`      | Thanh Trúc Xà        | Thường   | Mộc / Hỏa           | 15–30 | 1 × 1           | Phun độc nhỏ (line, 800 ms)                                                         |
| Bìa rừng         | `elite_lang_vuong`  | Hôi Lang Vương       | Tinh anh | Kim                 | 25–30 | 1 × 1 (192)     | Tru gọi 2 Hôi Lang; Vồ mạnh                                                         |
| Đầm lầy độc      | `mob_doc_chu`       | Độc Chu              | Thường   | Thủy / Mộc          | 20–40 | 1 × 1           | Phun tơ làm chậm (cone, 1.000 ms)                                                   |
| Đầm lầy độc      | `mob_doc_thiem`     | Độc Thiềm            | Thường   | Thủy / Hỏa          | 30–50 | 1 × 1           | Phun độc (circle 2,5 ô, 1.200 ms; mẫu trong 11 §6)                                  |
| Đầm lầy độc      | `elite_thiem_vuong` | Thiềm Vương Độc      | Tinh anh | Thủy                | 45–50 | 1 × 1 (192)     | Vũng độc vùng r3 + nhảy đè                                                          |
| Cổ thụ trung tâm | `mob_co_can`        | Cổ Căn Yêu           | Thường   | Mộc / Thổ           | 40–60 | 1 × 1           | Rễ trồi (circle nhỏ, 1.000 ms)                                                      |
| Cổ thụ trung tâm | `mob_huyet_diep`    | Huyết Điệp           | Thường   | Mộc / Hỏa           | 50–70 | 1 × 1           | Phấn độc (cone, 1.000 ms)                                                           |
| Cổ thụ trung tâm | `elite_co_can_mau`  | Cổ Căn Yêu Mẫu       | Tinh anh | Mộc                 | 60–70 | 1 × 1 (192)     | Trói rễ + vùng độc                                                                  |
| Cổ thụ trung tâm | `boss_ho_vuong`     | **Độc Nha Hổ Vương** | **Boss** | Mộc                 | 55–60 | **2 × 2** (256) | 3 skill, 2 phase (đổi skin ở 50% HP; 03 §6)                                         |
| Độc Hỏa Đàm      | `mob_xich_diem`     | Xích Diễm Thạch Quy  | Thường   | Hỏa / Thổ           | 50–70 | 1 × 1           | Phun lửa (line, 1.000 ms)                                                           |
| Độc Hỏa Đàm      | `elite_xich_mang`   | Xích Diễm Mãng       | Tinh anh | Hỏa                 | 60–70 | 1 × 1 (192)     | Quét đuôi + vòng lửa                                                                |
| Độc Hỏa Đàm      | `boss_co_mang`      | **Độc Hỏa Cổ Mãng**  | **Boss** | Hỏa / Mộc           | 65–70 | **4 × 4** (512) | 4 skill, 3 phase; sort line chữ V (03 §6); nham thạch xanh quanh đấu trường (04 §5) |

Tổng: **8 thường + 4 tinh anh + 2 boss = 14 loại** (+ mộc nhân tutorial). Biến thể ngũ hành dùng **tint / palette shader**, không vẽ lại (02 §1). Hệ hiển thị khớp v_e của Rừng Độc (Mộc 0,5 · Thủy 0,3 · Hỏa 0,2; 07 §5).

### 4.1 Chỉ số quái so với người chơi cùng nấc _(Đề xuất)_

Quái dùng **cùng đường cong chỉ số 07 §1** theo cảnh giới / nấc của quái, rồi nhân hệ số — để không cần bảng chỉ số quái riêng:

| Loại     | HP × | ATK × | DEF × | Tốc độ đánh                               | TTK mục tiêu (1 người cùng nấc) | Ghi chú                                                                    |
| -------- | ---- | ----- | ----- | ----------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Thường   | 0,35 | 1,0   | 1,0   | 1 đòn / 1,8 s                             | ~6 – 10 giây                    | Khớp nhịp 150 con / giờ của 07 §6 (≈ 24 giây mỗi con gồm di chuyển + nhặt) |
| Tinh anh | 2,0  | 1,2   | 1,0   | 1 đòn / 1,6 s + 1 kỹ năng                 | ~30 – 45 giây                   | Nhịp 20 con / giờ (07 §6)                                                  |
| Boss     | 45   | 1,5   | 1,2   | 3 – 4 kỹ năng, telegraph 1.000 – 2.000 ms | ~3 – 4 phút với tổ 4 người      | Không solo được; rương tuần 1 lần (07 §6)                                  |

Cơ sở: hai người cùng nấc cần ~33 đòn (07 §1); xoay vòng kỹ năng tốt khoảng ×1,5 – ×1,7 đòn thường ([11](11-he-phai-ky-nang.md) §4.5). Quái thường có ATK × 1,0 gây ~3% Khí Huyết mỗi đòn — 5 – 6 con kéo cùng lúc đã nguy hiểm, đúng ý "kéo nhóm vừa đủ". Cần mô phỏng để chốt.

Rớt đồ theo 07 §6 (quái dã ngoại / tinh anh / boss bí cảnh) với hệ số cảnh giới `1,5^(r−1)`, đánh quái thấp hơn 1 cảnh giới × 0,2, linh khí cạn kiệt sau 2 giờ ở một vùng × 0,5 (hồi sau 6 giờ), personal loot 1/√n, boss rương tuần.

## 5. Kỹ năng

Chi tiết ở [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md) §4.

| Hạng mục                       | Số lượng beta                                                  | Nguồn / ghi chú                          |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------- |
| Đạo Lộ                         | **4** (Kiếm, Pháp, Thể, Đan/Phù)                               | 02 §1 nói 6 lớp vũ khí đầy đủ → beta 4   |
| Kỹ năng mỗi Đạo Lộ             | **8** = 7 chủ động (kể cả 1 chiêu cuối) + 1 bị động            | 11 §4                                    |
| Tổng kỹ năng người chơi        | **32** (28 chủ động + 4 bị động)                               | ~21% của ~150 VFX kỹ năng đầy đủ (02 §4) |
| Kỹ năng quái / tinh anh / boss | ~28 (thường ~9, tinh anh 4 × 1–2, boss 2 × 3–4 + phase)        | Telegraph bắt buộc (11 §3.5)             |
| Đòn thường                     | 1 combo 3 đòn mỗi Đạo Lộ                                       | 02 §1                                    |
| Ô trên thanh                   | PC 1–9 + Shift; Mobile Skill Wheel 2 trang × 5 + F1–F4 phù lục | 05                                       |

## 6. Vật phẩm, đan dược, phù lục

Số lượng đề xuất (so với 02 §3 — số đầy đủ ở cột "02 SL MVP").

| Nhóm                          | 02 SL (đầy đủ) | **Beta**                 | Danh mục beta _(Đề xuất)_                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Đan dược**                  | 40             | **12**                   | Hồi Huyết Đan, Hồi Linh Đan, Ngưng Khí Đan (+tu vi), Giải Độc Đan, Thanh Tâm Đan; **đan đột phá:** Trúc Cơ Đan (`pill_truc_co_dan`), Kết Kim Đan (`pill_ket_kim_dan`), Kết Anh Đan (`pill_ket_anh_dan`) — id theo D24; **phụ đan:** Hộ Mạch Đan, Định Tâm Đan (07 §2–§3; id đề xuất `pill_ho_mach_dan`, `pill_dinh_tam_dan` theo cùng mẫu); Tụ Khí Tán; Bạo Lực Đan (buff) |
| **Phù lục**                   | 30             | **8**                    | Hộ Thể Phù, Hỏa Diễm Phù, Băng Phong Phù, Lôi Phù, Định Thân Phù, Tật Phong Phù, Truyền Tống Phù (về Sơn Môn), Giải Độc Phù — chỉ **mua + rơi**, **chế phù ngoài beta**                                                                                                                                                                                                    |
| **Pháp bảo**                  | 12 hình dạng   | **6**                    | Cầm tay 4 (trượng, quyền sáo, phất trần / bút phù, pháp khí) + lơ lửng 2; thêm 1 **bản mệnh** ở Kim Đan                                                                                                                                                                                                                                                                    |
| **Phi kiếm**                  | 20 mẫu         | **4**                    | Cầm tay + kiếm cưỡi khi bay (Trúc Cơ+); nhập cảnh Kiếm tu                                                                                                                                                                                                                                                                                                                  |
| **Pháp y**                    | 40 bộ          | **12**                   | 4 Đạo Lộ × 3 mốc cảnh giới (Luyện Khí / Trúc Cơ / Kim Đan)                                                                                                                                                                                                                                                                                                                 |
| **Trận bàn**                  | 10             | **3**                    | Tụ Linh Trận Bàn, Hộ Mạch Trận Bàn (giảm sát thương kiếp, 07 §3), Tụ Khí Trận Bàn                                                                                                                                                                                                                                                                                          |
| **Linh thảo / dược liệu**     | 50             | **12**                   | Thu hái ở Rừng Độc; 3 giai đoạn sinh trưởng                                                                                                                                                                                                                                                                                                                                |
| **Khoáng thạch & Linh thạch** | 30             | **6**                    | Linh thạch hạ / trung / thượng + 3 khoáng                                                                                                                                                                                                                                                                                                                                  |
| **Bí tịch / Tàn trang**       | —              | 32 bí tịch + 4 Tàn trang | Một bí tịch cho mỗi kỹ năng (11 §5) và Tàn Trang nâng rank theo Đạo Lộ                                                                                                                                                                                                                                                                                                     |
| **Vật phẩm rơi trên đất**     | 20 kiểu        | **10**                   | Túi, rương, Linh thạch ×3, đan, nguyên liệu, trang bị theo loại                                                                                                                                                                                                                                                                                                            |
| **Icon vật phẩm**             | ~600           | **~150**                 | 1 atlas; phẩm 1–6 thể hiện bằng viền / tint (6 phẩm Trắng → Đỏ; 00 §3)                                                                                                                                                                                                                                                                                                     |

Phẩm chất: dùng **đủ 6 phẩm** vì là thang chuẩn (00 §3), nhưng phân bố rơi theo 07 §6: quái dã ngoại ít phẩm cao; Vàng / Đỏ chỉ từ tinh anh / boss; nên người chơi beta ít gặp Đỏ.

Luyện đan beta: **công thức cố định, tỷ lệ thành công theo phẩm nguyên liệu, không minigame** _(Đề xuất)_ — minigame đan lô ([05](05-ui-ux-icon.md), 02 §5) để sau; chi tiết nghề chưa thiết kế ([OPEN-ITEMS](OPEN-ITEMS.md)). Mục đích: đan đột phá rơi rất hiếm từ quái (0,02 – 0,5% — 07 §6) nên chế tác là nguồn đan chủ lực của người chơi.

## 7. Hệ thống: IN và OUT

Chú thích phase: P1–P5 như mục 12.

### 7.1 IN (bắt buộc cho beta)

| Hệ thống                                                            | Phase | Ghi chú                                                                                                      |
| ------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| Tài khoản **username + password**; tạo nhân vật; roll Linh căn      | P2–P3 | Auth theo quyết định chủ dự án (Google SSO sau). 3 nhân vật / tài khoản (G10, [01](01-gdd.md)).              |
| Di chuyển click-to-move, joystick, tìm đường; bay thấp / bay tự do  | P1–P2 | `InputManager`, `IsoPathfinder` (packages/client-core); bay mở ở Trúc Cơ / Kim Đan (07 §8).                  |
| Chiến đấu 4 Đạo Lộ, hồi chiêu server, Ngũ hành, drop 07 §6          | P3    | 11, 07 §4–§6; anti-cheat cơ bản 08 §6                                                                        |
| Đả tọa + tu vi (`Absorb`), Linh căn, tiểu cảnh                      | P3    | 07 §5                                                                                                        |
| 2 đột phá lớn + cổng Kết Anh: Tâm Ma nhẹ, Tâm Ma + Lôi Kiếp 3 đạo   | P3–P4 | Công thức 07 §2–§3; Tâm Cảnh instance ([01 §5](01-gdd.md)). Lôi Kiếp VFX procedural (06).                    |
| Nghiệp Lực (K), Đạo Tâm: ghi nhận, Karma_Penalty, độ bền × 1,5 Ma   | P3–P4 | **Không có nội dung phe độc quyền**; chỉ số học + nhãn hiển thị ([01 §8](01-gdd.md))                         |
| Độ bền, sửa chữa, chết / hồi sinh                                   | P3    | 07 §7, [01 §12](01-gdd.md)                                                                                   |
| Tổ đội (4), chat (Thế giới, Vùng, Đội, Thì thầm), bạn bè            | P4    | Personal loot 1/√n (07 §6)                                                                                   |
| Giao dịch trực tiếp (thuế 3%), **Vạn Bảo Lâu** cơ bản               | P4    | Niêm yết 1%; thuế bán **cố định 5%** trong beta, CPI tuần chạy **chế độ bóng** (không áp dụng) để đo (07 §7) |
| Truyền tống Sơn Môn ↔ Rừng Độc, phí 07 §7, miễn phí 1 lần / ngày    | P3    | `Fee = 20 · 1,5^(r−1) · (1 + 0,5d)`                                                                          |
| Tông môn **NPC** Sơn Môn Đại Phái: gia nhập, Cống hiến, kho bí tịch | P4    | Không có tông môn do người chơi lập                                                                          |
| Nhiệm vụ: **chuỗi tutorial + ~20 nhiệm vụ ngày / tuần / tông môn**  | P4    | Tối giản; hệ nhiệm vụ & cốt truyện chưa thiết kế ([OPEN-ITEMS](OPEN-ITEMS.md))                               |
| Luyện đan tối giản (đan hồi phục, đan đột phá, phụ đan)             | P4    | Mục 6                                                                                                        |
| Telemetry sự kiện cốt lõi + dashboard KPI tối thiểu                 | P3–P5 | Mục 9.3                                                                                                      |

### 7.2 Có điều kiện (Stretch — chỉ làm nếu P4 dư thời gian)

| Hệ thống                                                                         | Ghi chú                                                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Động Phủ tối giản**: Bồ đoàn, Linh điền 2 × 2, Tụ linh trận 3 × 3 trên Hậu sơn | Lấy từ [04 §6](04-tilemap.md); là cơ chế giữ chân, nhưng thêm công trình + server lưu 4 giá trị mỗi công trình |
| **PK cơ bản** (cờ PK) ở Đầm / Cổ thụ / Độc Hỏa Đàm                               | Cần để Nghiệp Lực có nguồn; nếu cắt, Nghiệp Lực chỉ thay đổi qua nhiệm vụ                                      |
| Lôi đài Quảng trường luyện võ (12 × 12) cho duel                                 | Phụ thuộc luật PvP (chưa thiết kế)                                                                             |

### 7.3 OUT (không làm trong beta)

| Hệ thống                                                              | Lý do                                                                                           | Phase sau beta |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| Chiến tranh Linh Mạch, Hộ Sơn Đại Trận (gameplay), Linh Mạch Tâm      | Quy mô 100 vs 100, băng thông 25 KB/s, cần tông môn người chơi                                  | Sau P5         |
| Cảnh giới ≥ 4: phân thân, Lĩnh Vực, Pháp Tướng, Phi Thăng, Trọng sinh | Ngoài phạm vi 3 cảnh giới                                                                       | Sau beta       |
| Đấu Giá Hội, Tiên Ngọc, Battle Pass, mọi kiếm tiền                    | Chưa thiết kế; beta **không thu tiền**                                                          | Sau beta       |
| Google SSO                                                            | Quyết định: SSO làm sau                                                                         | Sau beta       |
| Linh thú, thú cưỡi, thú đồng hành                                     | Chi phí Spine + hệ tiến hóa                                                                     | Sau beta       |
| Đạo Lữ, Sư đồ, tông môn người chơi lập                                | Cần hệ xã hội lớn                                                                               | Sau beta       |
| Chế phù, rèn, minigame đan lô                                         | Nghề chưa thiết kế                                                                              | Sau beta       |
| Mua bán xuyên server, sự kiện / LiveOps, voice lồng tiếng             | Chưa có thiết kế / nội dung                                                                     | Sau beta       |
| Bản native iOS / Android trên cửa hàng                                | **Beta phát qua Web H5** (desktop + trình duyệt di động, cảm ứng); app native cần cửa hàng + CD | Sau beta       |

> **Nền tảng beta (đề xuất):** Web H5 là kênh chính (một URL, không qua cửa hàng, khớp "local hosting + không CD"); client PC (đóng gói Cocos) tùy chọn cho nhóm kiểm thử; **bố cục cảm ứng vẫn phải chạy trong trình duyệt di động** để kiểm chứng cross-play ([05](05-ui-ux-icon.md)). Xem _Câu hỏi cần chốt_ M5.

## 8. Mục tiêu thời lượng, CCU và hạ tầng thử nghiệm

### 8.1 Thời lượng chơi

| Mục                                          | Mục tiêu _(Đề xuất)_                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Thời gian chơi đến Kim Đan Viên Mãn (median) | **~26 giờ** (Luyện Khí 6 + Trúc Cơ 8 + Kim Đan 12; 01 §3.4) |
| Thời lượng beta                              | **4 tuần**                                                  |
| Người chơi "cày" đạt cap sau                 | ~2 tuần (≈ 15–20 giờ/tuần)                                  |
| Người chơi vừa (≈ 8 giờ / tuần) đạt cap sau  | ~3 – 3,5 tuần                                               |
| Thời gian còn lại ở cap                      | Thử boss, Kết Anh, PK, kinh tế — để thu dữ liệu             |
| Phiên điển hình                              | 30 – 90 phút PC; 10 – 20 phút mobile (01 §3.2)              |

**FTUE – 15 phút đầu (Đề xuất):**

| Phút  | Nội dung                                                                                    | Mục tiêu đo                         |
| ----- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| 0–2   | Tạo nhân vật: chọn Đạo Lộ, giới tính, roll Linh căn (xem trước, 2 lần reroll miễn phí — M7) | Tỷ lệ hoàn tất tạo nhân vật         |
| 2–5   | Quảng trường: di chuyển, đòn thường, kỹ năng đầu (K1/P1/T1/D1) vào mộc nhân, đả tọa         | Thời gian tới kỹ năng đầu ≤ 90 giây |
| 5–7   | **Lên nấc đầu tiên** (Luyện Khí 1 → 2, ~10 phút tu thuần được rút gọn bằng thưởng tutorial) | Thời gian tới nấc đầu ≤ 7 phút      |
| 7–12  | Ra Bìa rừng, đánh Độc Thố / Hôi Lang, nhặt vật phẩm, gặp NPC tông môn                       | Số người rời tutorial               |
| 12–15 | Gia nhập tông môn, nhận nhiệm vụ ngày, mở Vạn Bảo Lâu                                       | FTUE complete ≥ 85%                 |

### 8.2 CCU mục tiêu cho test local

Phiên bản này chạy **local hosting** (chưa chọn nhà cung cấp; có thể cần máy cấu hình trung bình, không autoscale):

| Mức                   | CCU _(Đề xuất)_             | Mô tả                                                                                                                  |
| --------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Đăng ký               | **300 – 500 tài khoản mời** | Closed beta                                                                                                            |
| **Mục tiêu vận hành** | **100 CCU**                 | Chạy ổn 4 tuần: tick p99 ≤ 40 ms (của 50 ms), băng thông ≤ 8 KB/s/người đánh quái; RAM mỗi World Node ≤ 70% bộ nhớ máy |
| **Stress**            | **200 CCU bot**             | Kiểm tra giới hạn, chủ yếu ở Sơn Môn (đông) và đồng thời Rừng Độc                                                      |
| Kịch bản tập trung    | 100 vs 100 AOI              | Đúng kịch bản OPEN-ITEMS #6; băng thông chợ đông ~13 KB/s (00 §3)                                                      |
| Phân bố               | ~50 / 50                    | Sơn Môn ~50, Rừng Độc ~50 (một World Node mỗi bản đồ ở P2; tách "kênh" nếu cần)                                        |

Kỳ vọng: ~100 CCU là khoảng 20–30% của 300–500 tài khoản mời ở giờ cao điểm (tỷ lệ tham khảo thông thường, cần xác nhận bằng dữ liệu beta). Ngưỡng lên 200 CCU chỉ để biết điểm gãy, không phải mục tiêu phục vụ.

### 8.3 Tiêu chí kỹ thuật chấp nhận (từ 00 §3)

| Hạng mục                     | Ngưỡng                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gói tải đầu (Web)            | ≤ **25 MB** (gồm nhân vật 4 MB, bản đồ tân thủ 5 MB, quái + VFX 3 MB …; 02)                                                                                       |
| RAM tab Web                  | ≤ **500 MB** (texture 220 MB; 06)                                                                                                                                 |
| Draw call                    | Web / Mobile ≤ **80**; PC ≤ 150                                                                                                                                   |
| Hạt VFX trên màn hình        | ≤ 1.000 (Web / Mobile); ≤ 3.000 (PC)                                                                                                                              |
| Spine cập nhật đầy đủ        | ≤ 30 cùng lúc (02)                                                                                                                                                |
| Tick mô phỏng / AOI          | 20 Hz / 10 Hz; vùng AOI 2 × 2 màn hình                                                                                                                            |
| Dung lượng CDN tổng ước tính | ≈ **70 – 110 MB** (Core 25 + Sect pack 12–15 + Event pack 10–15 + 4 class pack 3–6 MB mỗi cái + 12 equipment pack 0,2–1 MB + Event pack Lôi Kiếp 5–20 MB; 02, 04) |

## 9. Chỉ số thành công (KPI)

Tất cả ngưỡng là **mục tiêu đề xuất** cho closed beta mời có chọn lọc (không phải thị trường mở); cần chủ dự án duyệt.

### 9.1 Giữ chân và gắn kết

| KPI                                     | Ngưỡng đạt _(Đề xuất)_ | Ngưỡng tốt |
| --------------------------------------- | ---------------------- | ---------- |
| **D1 retention**                        | ≥ 40%                  | ≥ 50%      |
| **D7 retention**                        | ≥ 15%                  | ≥ 25%      |
| D14 retention                           | ≥ 8%                   | ≥ 15%      |
| **Độ dài phiên** (median)               | ≥ 25 phút              | ≥ 40 phút  |
| Độ dài phiên (mean)                     | ≥ 35 phút              | ≥ 50 phút  |
| Số phiên / ngày (người quay lại, D1–D7) | ≥ 1,8                  | ≥ 2,5      |
| FTUE hoàn tất                           | ≥ 85%                  | ≥ 92%      |
| Tỷ lệ ≥ 1 lần vào tổ đội đến D7         | ≥ 30%                  | ≥ 50%      |

### 9.2 Phễu đột phá (cumulative so với số nhân vật tạo)

| Mốc phễu                              | Mục tiêu đến D14 _(Đề xuất)_ | Chỉ số kèm theo                                                            |
| ------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| 1. Tạo nhân vật                       | 100%                         | —                                                                          |
| 2. Hoàn tất tutorial                  | ≥ 85%                        | FTUE time ≤ 15 phút                                                        |
| 3. Luyện Khí tầng 5                   | ≥ 60%                        | Thời gian median tới tầng 5 ≤ 1 giờ chơi                                   |
| 4. Luyện Khí tầng 9 (Viên Mãn)        | ≥ 45%                        | Median ≤ 2,5 – 3 giờ chơi                                                  |
| 5. **Thử** đột phá Trúc Cơ            | ≥ 40%                        | Tỷ lệ thành công lần đầu 85–95% (có chủ đan Lam trở lên)                   |
| 6. Trúc Cơ thành công                 | ≥ 35%                        | Trung bình ≤ 1,2 lần thử                                                   |
| 7. **Thử** đột phá Kim Đan (+ Tâm Ma) | ≥ 18%                        | Tỷ lệ thành công lần đầu 60–80%; Tâm Ma thắng ≥ 80%                        |
| 8. Kim Đan thành công                 | ≥ 12%                        | Trung bình ≤ 2,0 lần thử (pity +8% / lần, 07 §2)                           |
| 9. **Thử** Kết Anh (Lôi Kiếp 3 đạo)   | ≥ 5%                         | Tỷ lệ sống qua 3 đạo ≥ 90% (không cần giảm trừ — 07 §3); thành công 55–75% |

Giải thích: một phễu quá dốc (ví dụ < 20% qua Luyện Khí 9) nghĩa là pacing 07 §5 hoặc nguồn đan quá khắt; quá phẳng (> 80% qua Trúc Cơ) nghĩa là đột phá quá dễ, mất khoảnh khắc P1 ([01 §1](01-gdd.md)).

### 9.3 KPI kỹ thuật, kinh tế, xã hội

| Nhóm       | KPI                                                                    | Ngưỡng _(Đề xuất)_                                |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| Hiệu năng  | Thời gian tới khung hình đầu (Web, 4G giả lập)                         | ≤ 8 giây                                          |
| Hiệu năng  | FPS trung vị trên máy mobile trung bình                                | ≥ 30                                              |
| Ổn định    | Crash-free session                                                     | ≥ 99%                                             |
| Mạng       | Tỷ lệ ngắt kết nối bất thường / phiên                                  | ≤ 2%                                              |
| Anti-cheat | Tài khoản có điểm nghi vấn ≥ 20 (08 §6)                                | ≤ 1%                                              |
| Kinh tế    | Tiêu hao / sinh ra Linh thạch mỗi tuần                                 | 0,9 – 1,0 (07 §7; mục tiêu chính của đo bóng CPI) |
| Kinh tế    | Phân bố thời gian farm theo vùng; rơi đan đột phá thực tế so với 07 §6 | Trong ±25% giá trị kỳ vọng                        |
| Xã hội     | Tỷ lệ gia nhập tông môn NPC trong D3                                   | ≥ 60%                                             |
| Cân bằng   | Tỷ lệ chọn mỗi Đạo Lộ                                                  | Không Đạo Lộ nào < 15% hoặc > 40%                 |

**Sự kiện telemetry tối thiểu** (nguồn dữ liệu cho các KPI trên): `account_created`, `login`, `session_start/end`, `character_created{path, root}`, `ftue_step{n}`, `level_up`, `realm_step_up{s}`, `breakthrough_attempt{threshold, pills, K, n_fail, result}`, `tribulation_result{waves_survived}`, `death{cause, zone}`, `kill{mob_type}`, `drop{item, quality}`, `trade{tax}`, `market_listing`, `repair{cost}`, `teleport{fee}`, `party_join`, `sect_join`, `quest_complete`, `skill_cast{id}` (lấy mẫu), `ping/fps` (lấy mẫu), `error{code}`. Thu thập server-side (chống thao túng) trừ `ping/fps` ở client.

## 10. Bảng nội dung / asset: beta so với 02

Cột "02" = **"SL MVP" trong [02-asset-matrix-2d.md](02-asset-matrix-2d.md)** (số lượng đầy đủ); cột "Beta" = đề xuất. Tỷ lệ làm tròn.

### 10.1 Nhân vật & sinh vật (02 §1)

| Asset Type                 | 02                    | **Beta**                         | ~%        | Ghi chú                                                    |
| -------------------------- | --------------------- | -------------------------------- | --------- | ---------------------------------------------------------- |
| Body base nam / nữ (Spine) | 2 giới tính           | **2**                            | 100%      | Bắt buộc                                                   |
| Bộ animation lớp vũ khí    | 6 lớp                 | **4** (Kiếm, Pháp, Thể, Đan/Phù) | 67%       | ~18 anim mỗi lớp                                           |
| Mặt, tóc                   | 12 mặt, 20 kiểu tóc   | **4 mặt, 6 tóc**                 | 33% / 30% | Palette swap để mở rộng                                    |
| Pháp Tướng Thiên Địa       | 8                     | 0                                | 0%        | Cảnh giới 7                                                |
| NPC chủ chốt (Spine)       | 60                    | **10**                           | 17%       | Tutorial, tông môn, chợ, đan phòng, tàng kinh, truyền tống |
| NPC đại trà (sprite)       | 30 bộ → 200 biến thể  | **3 bộ**                         | 10%       | Đệ tử, thương nhân, dân                                    |
| Linh thú / thú cưỡi        | 15 loài × 3 giai đoạn | 0                                | 0%        | Ngoài beta                                                 |
| Quái thường                | 25 loại × 4 biến thể  | **8 loại × 2 = 16**              | 32% / 16% | Mục 4                                                      |
| Quái tinh anh              | 20                    | **4**                            | 20%       | Mục 4                                                      |
| Boss bí cảnh               | 12                    | **2** (2 × 2 và 4 × 4)           | 17%       | Mục 4                                                      |
| Bóng đổ dưới chân          | 3                     | **3**                            | 100%      | Core                                                       |
| Chân dung hội thoại        | 60 + 12 avatar        | **10 + 4**                       | 17% / 33% | Theo NPC chủ chốt                                          |

### 10.2 Môi trường & thế giới (02 §2)

| Asset Type                  | 02                     | **Beta**                                | ~%    | Ghi chú                                            |
| --------------------------- | ---------------------- | --------------------------------------- | ----- | -------------------------------------------------- |
| Tile nền theo biome         | 4 biome                | **2** (núi, rừng độc)                   | 50%   | Tileset atlas 2048                                 |
| Tile chuyển tiếp            | 16 cặp                 | **6**                                   | 38%   | Wang theo góc (04 §3)                              |
| Vách đá, bậc thềm           | 3 kit × 20 mảnh        | **2 kit × 20** (vách xanh; rễ / đất ẩm) | 67%   | 04 §5                                              |
| Nước, linh tuyền            | 8 kiểu                 | **3** (suối, đầm độc, linh tuyền)       | 38%   |                                                    |
| Cây, đá, bụi                | 60 loài                | **25**                                  | 42%   |                                                    |
| Cỏ, hoa, sỏi (decal)        | 40                     | **15**                                  | 38%   |                                                    |
| Mạch linh khí lộ thiên      | 6 phẩm                 | **2** phẩm (Hậu sơn, Cổ thụ)            | 33%   |                                                    |
| Linh Mạch Tâm               | 1 / bản đồ chiến tranh | 0                                       | 0%    | OUT                                                |
| Mỏ khoáng, điểm thu hái     | 30                     | **10**                                  | 33%   |                                                    |
| Động Phủ: kit nền, tường    | 150 mảnh               | 0 (**stretch: 40**)                     | 0–27% | Stretch                                            |
| Động Phủ: nội thất          | 80                     | 0 (**stretch: 8**)                      | 0–10% | Bồ đoàn, Linh điền, Tụ linh trận, đan lô, giá kinh |
| Kiến trúc tông môn (kit)    | 3 kit × 120 mảnh       | **1 kit × 60** (Chính đạo)              | 17%   | Sơn Môn                                            |
| Landmark tông môn           | 6 tông × 3             | **1 tông × 3**                          | 17%   | Sơn môn, đại điện, tháp                            |
| Hộ Sơn Đại Trận + Trận Nhãn | 1 hệ                   | **5 Trận Nhãn tĩnh** (không vòm)        | —     | Chỉ prop (04 §5); gameplay OUT                     |
| Vân hải quanh phù đảo       | 3 preset               | **1**                                   | 33%   |                                                    |
| Ngày đêm LUT                | 4 LUT                  | **2**                                   | 50%   |                                                    |
| Thời tiết, mây kiếp         | 6 + 1                  | **2 + 1** (sương độc, mưa; mây kiếp)    | 43%   |                                                    |
| Bí cảnh / Phó bản instance  | 10                     | 0                                       | 0%    | Rừng Độc là bí cảnh mở duy nhất                    |
| Bí cảnh mở theo mùa         | 4                      | **1** (Rừng Độc)                        | 25%   | Mùa 0                                              |
| Tâm cảnh (Tâm Ma Kiếp)      | 9 biến thể             | **2**                                   | 22%   | Tâm Ma nhẹ; Tâm Ma + nghiệp                        |

### 10.3 Trang bị & vật phẩm (02 §3)

| Asset Type                             | 02                    | **Beta**            | ~%             |
| -------------------------------------- | --------------------- | ------------------- | -------------- |
| Pháp bảo cầm tay / lơ lửng / kích hoạt | 12 / 12 × 6 phẩm / 12 | **4 / 2 / 0**       | 33% / 17% / 0% |
| Phi kiếm cầm tay / kiếm cưỡi           | 20 / 20 × 6 phẩm      | **4 / 4**           | 20%            |
| Vạn Kiếm Quy Tông                      | 1 hệ                  | **1** (ultimate K8) | 100%           |
| Pháp y                                 | 40 bộ                 | **12**              | 30%            |
| Trận bàn, trận kỳ                      | 10                    | **3**               | 30%            |
| Phù lục                                | 30                    | **8**               | 27%            |
| Đan dược (icon + VFX)                  | 40                    | **12**              | 30%            |
| Đan lô                                 | 3                     | **1**               | 33%            |
| Linh thảo                              | 50                    | **12**              | 24%            |
| Khoáng thạch, Linh thạch               | 30                    | **6**               | 20%            |
| Vật phẩm rơi trên đất                  | 20 kiểu               | **10**              | 50%            |
| Icon vật phẩm                          | ~600                  | **~150**            | 25%            |

### 10.4 VFX (02 §4)

| Asset Type                       | 02           | **Beta**                            | ~%   |
| -------------------------------- | ------------ | ----------------------------------- | ---- |
| Đả tọa vận chuyển linh khí       | 8 hệ         | **5** hệ                            | 63%  |
| Aura cảnh giới                   | 9 cấp        | **3**                               | 33%  |
| Đột phá                          | 2 cấp × 8 hệ | **2 cấp × 5 hệ**                    | 63%  |
| Khiên hộ thể                     | 5 loại       | **2**                               | 40%  |
| Tia sét kiếp (procedural)        | 4            | **1** hệ procedural (dùng chung)    | —    |
| Vòng cảnh báo sét                | 2 cỡ         | **2**                               | 100% |
| Hậu quả va chạm sét              | 3            | **2**                               | 67%  |
| Trận văn mặt đất                 | 5 loại trận  | **2**                               | 40%  |
| VFX kỹ năng chiến đấu            | ~150         | **32 người chơi + ~14 quái / boss** | ~31% |
| Vệt ngự kiếm, viền Pháp Tướng    | 20 + 8       | **4 + 0**                           | 14%  |
| Trạng thái (tê liệt, độc, cháy…) | 15           | **8**                               | 53%  |
| Linh khí môi trường              | 20           | **6**                               | 30%  |

### 10.5 UI/UX và âm thanh (02 §5–§6)

| Asset Type                                  | 02            | **Beta**                                 | ~%              |
| ------------------------------------------- | ------------- | ---------------------------------------- | --------------- |
| Kit khung, viền, nút (9-slice)              | 1 kit         | **1**                                    | 100%            |
| Bitmap font                                 | 4 bộ          | **3**                                    | 75%             |
| HUD bố cục                                  | 2 bố cục      | **2** (PC; cảm ứng)                      | 100%            |
| Minimap la bàn Bát Quái; World UI           | 1; 1 atlas    | **1; 1**                                 | 100%            |
| Menu hệ thống (túi đồ, nhân vật, trang bị…) | 6 màn hình    | **6**                                    | 100%            |
| Kinh mạch đồ, Tinh đồ công pháp             | 2             | **1** (Tinh đồ kỹ năng)                  | 50%             |
| Luyện đan, chế phù, tông môn, Vạn Bảo Lâu   | 5             | **3** (luyện đan, tông môn, Vạn Bảo Lâu) | 60%             |
| Bản đồ thế giới                             | 4 vùng        | **2**                                    | 50%             |
| Icon kỹ năng, trạng thái                    | 150 + 30      | **32 + 8**                               | 21% / 27%       |
| Key art, màn hình tải, khung hội thoại      | 20            | **4**                                    | 20%             |
| Theme phe phái                              | 3             | **1** (Chính)                            | 33%             |
| BGM khám phá / chiến đấu                    | 12 / 8        | **3 / 2**                                | 25%             |
| BGM boss, Lôi Kiếp, Phi Thăng               | 12 + 3        | **2 + 1 + 0**                            | 17%             |
| BGM tông môn theo phe; Stinger              | 3 × 2; 30     | **1; 8**                                 | 17% / 27%       |
| SFX Lôi Kiếp; Vận khí                       | 40; 20        | **8; 6**                                 | 20% / 30%       |
| SFX chiến đấu; di chuyển; UI                | ~600; 120; 80 | **~120; 30; 30**                         | 20% / 25% / 38% |
| Ambience                                    | 30            | **5**                                    | 17%             |
| Voice (lồng tiếng)                          | ~3.000 câu    | **0** (chỉ text)                         | 0%              |

**Quy tắc đóng gói:** mọi asset trên tuân Asset Bundle của 02 (Core ≤ 25 MB; Class pack; Equipment pack; Zone / Sect / Event pack; Map chunk). Asset không có trong beta **không** vào Core.

## 11. Rủi ro và giả định

| Rủi ro / giả định                                                                       | Giảm thiểu                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Prototype Cocos chưa kiểm chứng ngân sách draw call / RAM / Y-sort (OPEN-ITEMS #5)      | P1 chỉ làm slice client + đo; **không mở P2 trước khi P1 đạt ngân sách**  |
| 100 vs 100 AOI chưa đo (OPEN-ITEMS #6)                                                  | P2 có bài test bot; điều chỉnh cell AOI / tần số trước P4                 |
| Hệ số kinh tế 07 chưa khóa bằng dữ liệu (OPEN-ITEMS #7)                                 | Đo bóng CPI; mô phỏng trước P5; điều chỉnh ngay từ dữ liệu 2 tuần đầu     |
| Nội dung mỏng (2 bản đồ, 14 loại quái) → hết việc ở ~26 giờ                             | Kết Anh, PK, boss tuần, kinh tế làm "game cuối" ngắn; chấp nhận cho beta  |
| Nghiệp Lực / PK ở Rừng Độc nhỏ có thể gây quấy phá người mới                            | Bìa rừng cấm PK; PvP death chỉ −4% độ bền; Nghiệp phạt                    |
| Mô hình hosting local giới hạn CCU / uptime                                             | Mục tiêu 100 CCU; thông báo giờ mở cửa; backup / migration thử trước beta |
| Chưa có thiết kế nhiệm vụ, nghề, PvP, onboarding chi tiết ([OPEN-ITEMS](OPEN-ITEMS.md)) | Tối giản có chủ đích (mục 7); thu phản hồi để thiết kế đúng               |
| Số liệu Linh Mạch lệch 5 / 6 phẩm (01 G6)                                               | Không ảnh hưởng beta (Linh Mạch Tâm OUT); chốt trước khi làm chiến tranh  |

## 12. Bản đồ mốc kỹ thuật P1–P5

Cấu trúc repo hiện có: `apps/client-cocos`, `apps/server`, `packages/shared` (`@vgtd/shared`), `packages/client-core`, `tools/procgen` (`@vgtd/procgen`). Không đặt ngày — đặt **tiêu chí thoát** (exit criteria); mỗi phase khép trước khi mở phase tiếp theo (trừ khi ghi "song song").

| Phase  | Tên                  | Phạm vi (tham chiếu repo)                                                                                                                                                                                                                | Phụ thuộc               | **Tiêu chí thoát (Exit)**                                                                                                           |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | **Client slice**     | `apps/client-cocos` + `packages/client-core` + `tools/procgen`: tilemap sinh tự động (Sơn Môn rút gọn), 1 nhân vật Spine paperdoll, InputManager, Y-sort, streaming chunk giả lập, HUD khung, offline. OPEN-ITEMS #5.                    | —                       | Chạy Web + 1 máy mobile thật: ≤ 80 draw call, RAM ≤ 500 MB, ≥ 30 FPS với 20 NPC; gói đầu ≤ 25 MB; tìm đường + click-to-move đúng.   |
| **P2** | **Netcode**          | `apps/server` + `@vgtd/shared`: Gateway / World Node, AOI, dự đoán / đối soát / nội suy, input 20–30 Hz, auth username/password, speedhack + cooldown guard (08 §6), module `step()` dùng chung. OPEN-ITEMS #6.                          | P1                      | **100 CCU bot** ổn định; tick p99 ≤ 40 ms; băng thông ≤ 8 KB/s/người; AOI 100 vs 100 đo được; không teleport / speedhack qua guard. |
| **P3** | **Core loop**        | Mob AI + spawn; 4 Đạo Lộ × 8 kỹ năng, cast server, công thức 07 hiện thực trong `@vgtd/shared`; drop 07 §6; inventory + độ bền; đả tọa / `Absorb`; đột phá tiểu cảnh + đột phá lớn (chưa kiếp); chết / hồi sinh; truyền tống; telemetry. | P2                      | 1 nhân vật đi từ level 1 → **Trúc Cơ → Kim Đan** trên 2 bản đồ; số liệu server khớp bảng 07; telemetry ghi đủ sự kiện lõi.          |
| **P4** | **Content & social** | Đủ 8 + 4 + 2 quái / boss; Tâm Ma + Lôi Kiếp 3 đạo; tổ đội, chat, bạn bè, giao dịch, Vạn Bảo Lâu; tông môn NPC; nhiệm vụ; luyện đan; FTUE; Nghiệp Lực + Đạo Tâm; (stretch: Động Phủ, PK).                                                 | P3 (một phần song song) | Toàn bộ mục 7.1 chạy end-to-end; playtest nội bộ ≥ 20 người qua FTUE ≥ 85% mà không lỗi chặn.                                       |
| **P5** | **Beta hardening**   | Test tải 200 CCU bot, mô phỏng kinh tế, cân bằng 4 Đạo Lộ, anti-cheat, i18n Việt, dashboard KPI, runbook vận hành local, backup / khôi phục, quy trình mời tester. OPEN-ITEMS #7.                                                        | P4                      | **Cổng ra mắt beta:** crash-free ≥ 99%; 100 CCU 24 giờ không sự cố; không mất dữ liệu trong thử khôi phục; dashboard KPI hoạt động. |

Phụ thuộc các mảng chưa thiết kế: nhiệm vụ (P4), nghề (P4, mức tối thiểu), PvP (stretch P4), telemetry (P3–P5) — thiết kế chi tiết tương ứng cần xong **trước phase dùng đến**; xem [OPEN-ITEMS](OPEN-ITEMS.md).

## Câu hỏi cần chốt

| #   | Câu hỏi                                                                                                                                       | Mặc định đề xuất                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| M1  | Cap beta: (A) Nguyên Anh Sơ kỳ khóa cứng sau Kết Anh thành công; (B) cap Kim Đan Viên Mãn, Lôi Kiếp chỉ là thử; (C) cap 70 không có Lôi Kiếp. | **(A)** — cho người chơi khoảnh khắc đột phá đầu tiên có kiếp.                                         |
| M2  | Phạm vi cảnh giới 1–3 có đúng ý? Hay muốn 1–2 (rút gọn) hoặc 1–4?                                                                             | **1–3.**                                                                                               |
| M3  | Quái level 1–5: dùng mộc nhân (an toàn) hay thêm khu quái nhỏ trong Sơn Môn / thêm bản đồ thứ 3?                                              | **Mộc nhân + Bìa rừng cấm PK** (không thêm bản đồ).                                                    |
| M4  | PK ở Rừng Độc có nằm trong beta (stretch)? Nếu cắt thì Nghiệp Lực chỉ thay đổi bằng nhiệm vụ.                                                 | **Có PK cơ bản** (Đầm / Cổ thụ / Hỏa Đàm); Bìa rừng PvE.                                               |
| M5  | Nền tảng beta: chỉ Web H5 (desktop + mobile web), hay thêm client PC đóng gói / app native?                                                   | **Web H5 làm chính;** PC tùy chọn; native sau beta.                                                    |
| M6  | Động Phủ có vào beta không?                                                                                                                   | **Stretch** (Bồ đoàn + Linh điền + Tụ linh trận).                                                      |
| M7  | Linh căn khi tạo nhân vật: số lần reroll miễn phí?                                                                                            | **2 lần** trong tutorial; reroll về sau tốn tài nguyên (chờ thiết kế).                                 |
| M8  | Số tester mời, thời lượng beta, ngưỡng CCU 100 / stress 200?                                                                                  | **300–500 mời; 4 tuần; 100 / 200 CCU.**                                                                |
| M9  | KPI D1 / D7 / phiên (mục 9.1) và các ngưỡng phễu (9.2) có đúng kỳ vọng? Đã có mốc "tối thiểu để tiếp tục đầu tư" chưa?                        | Giữ các ngưỡng "đạt"; **tối thiểu để tiếp tục:** D1 ≥ 30%, D7 ≥ 10%.                                   |
| M10 | Thuế Vạn Bảo Lâu trong beta: cố định 5% + CPI chạy bóng, hay áp dụng CPI thật ngay?                                                           | **5% cố định**, CPI đo bóng.                                                                           |
| M11 | Mức độ tối giản của nhiệm vụ / luyện đan (mục 6, 7) có chấp nhận được khi chưa có thiết kế nghề / quest?                                      | Chấp nhận; thiết kế chi tiết sau khi có phản hồi beta.                                                 |
| M12 | Mức hỗ trợ tải: máy chạy local có cấu hình gì? Có hỗ trợ 2 máy (World Node tách Gateway)?                                                     | Máy phát triển 16 GB RAM / 8 nhân; một máy cho cả Gateway + 2 World Node + DB; tách máy nếu CCU > 100. |
