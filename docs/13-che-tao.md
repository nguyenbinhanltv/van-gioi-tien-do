# Chế tạo – Luyện Đan, Luyện Khí, Chế Phù

> **Trạng thái: bản thiết kế đề xuất – chờ duyệt.** Hồ sơ gốc chỉ nói "nghề luyện đan / luyện khí / chế phù" là mảng còn thiếu ([OPEN-ITEMS.md](OPEN-ITEMS.md) §3). Đã có sẵn trong 07: mở nghề ở Trúc Cơ (`unlocks: crafting` trong `realm_progression.json`), 6 phẩm với hệ số đan q, bảng rơi nguyên liệu nghề và bản vẽ, công thức độ bền / sửa chữa, nguồn giảm trừ Lôi Kiếp. Mọi con số khác ở đây là _Đề xuất – chờ duyệt_ và phải qua mô phỏng kinh tế (OPEN-ITEMS #7) trước khi khóa.
>
> Liên quan: nhiệm vụ nghề [12-nhiem-vu-cot-truyen.md](12-nhiem-vu-cot-truyen.md); kinh tế và không bán sức mạnh [15-kiem-tien-liveops.md](15-kiem-tien-liveops.md); hệ phái và kỹ năng [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md).

## 1. Vai trò của chế tạo

- **Nguồn cung đan, bản vẽ, trận bàn, phù** cho phần lớn người chơi, nên đồng thời là **kênh tiêu hao nguyên liệu** (nguyên liệu bị hủy khi chế) và **kênh tiêu hao Linh thạch** (phí lò, sửa lò, xúc tác).
- **Không rẻ hơn kênh rơi đồ ở phẩm cao.** Phân bố phẩm khi chế ở mức tay nghề thấp bắt đầu đúng bằng bảng "Quái dã ngoại" của 07 §6; tay nghề tối đa vẫn chưa bằng rương Boss ở phẩm Lam–Tím; phẩm Vàng–Đỏ bị chặn bởi **phẩm trần** của bản vẽ / đan phương (§4.3).
- **Mở ở Trúc Cơ** (`crafting`, 07 §8). Hệ quả cố ý: Trúc Cơ Đan (cho ngưỡng Luyện Khí → Trúc Cơ) **không thể tự chế** khi còn ở Luyện Khí; người chơi mới nhận từ rơi đồ, nhiệm vụ chương 1 ([12](12-nhiem-vu-cot-truyen.md) §4.1) hoặc mua của người chơi Trúc Cơ trở lên ở Vạn Bảo Lâu. Đây là mối liên kết cộng đồng chủ ý.

> **[Cập nhật D108 — luyện đan tối giản đã cài]** Máy chủ có Luyện Đan cho beta: các số §4–§6 nằm trong `@vgtd/shared` `alchemy.ts` (test dựng lại bảng §4.3), chế ở đan lô Sơn Môn, trao đổi nguyên tử + sổ cái `SYSTEM_SINK_CRAFT_FEE`, điểm thạo luyện lưu bền, bảng chế tạo phím P. Công thức đang có: Hồi Huyết Đan, Trúc Cơ Đan, Kết Kim Đan, Hộ Mạch Đan, Định Tâm Đan; số nguyên liệu mỗi lần chế, phẩm trần (Tím), làm tròn phí lò, mức cộng thạo luyện là **tạm** (xem D108 / OPEN-ITEMS). Luyện Khí và Chế Phù vẫn ngoài beta.

## 2. Ba nghề

| Nghề          | Sản phẩm                                                                 | Dụng cụ (**lò / đỉnh**) | Tiêu hao chính                  | Gắn với hệ thống                                                                             |
| ------------- | ------------------------------------------------------------------------ | ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| **Luyện Đan** | Đan đột phá (chủ / phụ), đan hồi phục, Hộ Mạch Đan, đan Lôi Kiếp         | Đan lô                  | Linh thảo, yêu đan              | 07 §2 (hệ số đan), §3 (Hộ Mạch Đan hồi 20% HP_ref, hồi chiêu 45 s)                           |
| **Luyện Khí** | Pháp bảo (vũ khí / phòng ngự), pháp y, **trận bàn**, sửa chữa bằng người | Lò rèn                  | Khoáng, yêu đan, bản vẽ         | 07 §1 (trang bị cộng tối đa 60%), §3 (khiên, trận), §7 (sửa chữa)                            |
| **Chế Phù**   | Phù lục tấn công / phòng thủ / hỗ trợ                                    | Bàn phù (bút, chu sa)   | Phù chỉ, chu sa, linh thảo hiếm | Ô phù lục F1–F4 trên PC và ô phù nhanh trên Mobile ([05-ui-ux-icon.md](05-ui-ux-icon.md) §2) |

Nghề không loại trừ nhau (một nhân vật học được cả ba) nhưng **điểm thạo luyện** tách riêng từng nghề (§4.2), nên chuyên một nghề hiệu quả hơn.

### 2.1 Bậc nghề

- **Bậc nghề N = cảnh giới người chơi** (1–9); nghề chỉ mở từ Trúc Cơ (N ≥ 2).
- Công thức (recipe) có **bậc b** = cảnh giới của ngưỡng đột phá hoặc trang bị mà nó phục vụ. Chỉ chế được công thức có b ≤ N.
- Học công thức: bằng **đan phương / bản vẽ / phù phổ** (vật phẩm), mua từ NPC (bậc thấp) hoặc rơi từ Boss (bậc cao). Học xong gắn vào nhân vật.
- Bản vẽ pháp bảo là vật phẩm có phẩm; **bản vẽ Trắng–Lục** rơi từ quái thường, **Lam–Tím** từ tinh anh / Boss, **Vàng–Đỏ** chỉ Boss (có pity 0,002 × (1 + 0,15n), chắc chắn ở lần 30) theo 07 §6.

## 3. Nguyên liệu

### 3.1 Nguồn

| Nguồn                    | Cơ chế                                                                  | Tham chiếu                                                                 |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Quái dã ngoại            | 25% rơi, 1–2 nguyên liệu mỗi lần hạ                                     | 07 §6 (bảng "Nguyên liệu nghề")                                            |
| Quái tinh anh            | 60% rơi, 2–4                                                            | 07 §6                                                                      |
| Boss bí cảnh             | 100% rơi, 3–6; rương chính 1 lần mỗi tuần mỗi boss mỗi người            | 07 §6                                                                      |
| Điểm thu hái trên bản đồ | Linh thảo / khoáng; hồi sinh sau 5–10 phút; chia theo vùng              | _Đề xuất_; Động Phủ trồng linh dược theo [04-tilemap.md](04-tilemap.md) §6 |
| Phế phẩm tái chế         | Chỉ cho ra **bụi linh** (nguyên liệu thấp), không bao giờ ra Linh thạch | _Đề xuất_                                                                  |

Điều chỉnh sẵn có của 07 áp dụng nguyên cho nguyên liệu: quái thấp hơn 1 cảnh giới × 0,2, thấp hơn 2 trở lên **chỉ còn nguyên liệu** (đây là nguồn nguyên liệu bậc thấp chính cho nhân vật cao cảnh giới); linh khí cạn kiệt sau 2 giờ farm liên tục × 0,5; tổ đội roll riêng với hệ số 1/√n.

### 3.2 Họ và bậc nguyên liệu (Đề xuất – chờ duyệt)

| Họ                 | Id tiền tố   | Rơi từ (loại quái)                       | Dùng cho                 |
| ------------------ | ------------ | ---------------------------------------- | ------------------------ |
| Linh thảo          | `mat_herb_`  | Quái thực vật, điểm hái                  | Đan, phù (hiếm)          |
| Yêu đan / thú liệu | `mat_beast_` | Quái thú / yêu vật                       | Đan, Luyện khí, sửa chữa |
| Khoáng             | `mat_ore_`   | Quái khôi lỗi / nguyên tố, điểm đào      | Luyện khí, trận bàn      |
| Phù chỉ, chu sa    | `mat_ink_`   | NPC bán (sink Linh thạch), Boss rơi hiếm | Chế phù                  |
| Bụi linh           | `mat_dust_`  | Phế phẩm, phân giải                      | Xúc tác phổ thông        |

- **Bậc nguyên liệu = cảnh giới của quái / điểm hái nguồn (1–9)**; công thức bậc b chỉ nhận nguyên liệu bậc b (hoặc b − 1 với hệ số 1 : 3, _Đề xuất_). Nguyên liệu **không có phẩm** — phẩm là kết quả của tay nghề (§4); điều này tránh việc phải đặt thêm bảng phân bố phẩm cho nguyên liệu.
- Vật phẩm nguyên liệu có thể giao dịch (qua Vạn Bảo Lâu: niêm yết 1% + thuế bán theo CPI 5–10%, 07 §7). Rổ CPI của chợ ghi rõ gồm "nguyên liệu phổ biến" nên chế tạo phải được theo dõi ở [17-telemetry-kpi.md](17-telemetry-kpi.md) §5.

## 4. Thành công, phẩm chất, thất bại

Mỗi lần chế là **hai bước độc lập** do server quyết định bằng RNG có seed, ghi log từng lần (cùng nguyên tắc với 07 §2, phục vụ khiếu nại): **(A) thành công hay thất bại**, **(B) nếu thành công thì phẩm nào trong 6 phẩm**.

### 4.1 Điểm chế tạo (Score)

Score là số nguyên 0–5, **chỉ có tác dụng ở bước B** (cộng nhẹ vào bước A):

| Thành phần                                     | Giá trị   | Cách đạt                                                                                            |
| ---------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| Điểm thạo luyện (nghề, công thức bậc đang chế) | 0 / 1 / 2 | 0 khi < 50 điểm; 1 khi 50–99; 2 khi 100 (điểm 0–100, mỗi lần chế thành công cộng điểm giảm dần)     |
| Dụng cụ (lò / đỉnh / bàn)                      | 0 / 1 / 2 | Lò phẩm Trắng–Lục = 0; Lam–Tím = 1; Vàng–Đỏ = 2 (lò là vật phẩm luyện khí)                          |
| Xúc tác (một phụ liệu tùy chọn)                | 0 / 1     | Đan: _Dẫn Dược Tán_; Khí: _Hỏa Tinh_; Phù: _Chu Sa Thượng Phẩm_ (mua bằng Linh thạch / nguyên liệu) |

### 4.2 Bước A – xác suất thành công

```latex
P_{\text{ok}} = \mathrm{clamp}\big(S_D + 0{,}02 \cdot \text{Score},\; 0{,}40,\; 0{,}98\big), \qquad S_D = 0{,}95 - 0{,}07\,(D - 1)
```

D là độ khó công thức 1–6 (khớp 6 phẩm của sản phẩm mục tiêu); S_D = 0,95 / 0,88 / 0,81 / 0,74 / 0,67 / 0,60. Điểm thạo luyện tăng theo số lần chế thành công cùng bậc, không tăng khi thất bại, để không "cày thất bại". Các hệ số 0,95, 0,07, 0,02, và sàn / trần 0,40 / 0,98 là _Đề xuất_.

### 4.3 Bước B – phân bố phẩm

**Bậc thang thăng phẩm** (6 phẩm Trắng → Đỏ, chỉ số 0–5): bắt đầu từ Trắng; tại bậc k (0 đến 4) thăng lên phẩm k + 1 với xác suất

```latex
p_k = \mathrm{clamp}\big(a_k + 0{,}04 \cdot \text{Score},\; 0,\; 0{,}9\big), \qquad a = (0{,}50;\ 0{,}40;\ 0{,}30;\ 0{,}18;\ 0{,}08)
```

Dừng ở lần thăng đầu tiên thất bại; phẩm cuối cùng bị **kẹp** bởi phẩm trần của công thức: `phẩm = min(roll, phẩm_trần)`, trong đó phẩm trần = phẩm của đan phương / bản vẽ / phù phổ đang dùng. Phần thăng dư bị bỏ, vì vậy Boss vẫn là nguồn duy nhất của phẩm Vàng–Đỏ ở cấp công thức.

Kết quả (phần trăm, cộng dồn bằng 100):

| Score | Trắng | Lục  | Lam  | Tím  | Vàng | Đỏ   | Kỳ vọng hệ số đan q |
| ----- | ----- | ---- | ---- | ---- | ---- | ---- | ------------------- |
| 0     | 50,0  | 30,0 | 14,0 | 4,9  | 1,0  | 0,09 | 0,75                |
| 1     | 46,0  | 30,2 | 15,7 | 6,3  | 1,6  | 0,21 | —                   |
| 2     | 42,0  | 30,2 | 17,3 | 7,8  | 2,3  | 0,44 | —                   |
| 3     | 38,0  | 29,8 | 18,7 | 9,5  | 3,2  | 0,8  | —                   |
| 4     | 34,0  | 29,0 | 20,0 | 11,2 | 4,4  | 1,4  | —                   |
| 5     | 30,0  | 28,0 | 21,0 | 13,0 | 5,8  | 2,2  | 0,89                |

Điểm cố ý: **Score 0 gần như trùng hàng "Quái dã ngoại"** của bảng phân bố phẩm ở 07 §6 (50 / 30 / 14 / 5 / 0,9 / 0,1), nên người chơi mới chế không lệch khỏi mặt bằng drop; ở Score 5 phẩm Đỏ chỉ 2,2%, vẫn thấp hơn xa chi phí cần có để đạt Score 5 (lò Vàng–Đỏ + 100 điểm thạo luyện + xúc tác). Hệ số q lấy từ `QUALITY_TIERS` (0,6 / 0,8 / 1,0 / 1,2 / 1,4 / 1,6) trong `@vgtd/shared`.

### 4.4 Thất bại

- Thất bại bước A **hủy 60% nguyên liệu chính** (làm tròn lên, chọn ngẫu nhiên theo số lượng) và **toàn bộ xúc tác**; lò mất 1 điểm độ bền như khi thành công. Không bao giờ trả lại Linh thạch.
- **Bảo vệ:** vật phẩm _Hộ Lô Phù_ (mua bằng Linh thạch, 1 lần dùng) giảm phần hủy xuống 20%; phí mua là kênh tiêu hao (§6).
- Không có "đan độc" hay hậu quả lên nhân vật (không phạt Nghiệp, không giảm cảnh giới), nhất quán với nguyên tắc "thất bại đột phá không rớt cảnh giới lớn" ([01-gdd.md](01-gdd.md) §3).
- Hai thất bại liên tiếp ở cùng công thức hiện nhắc **"thạo luyện còn thiếu"** kèm gợi ý nâng Score; **không** có pity thành công (khác đột phá), vì thất bại ở đây chỉ tốn nguyên liệu.

## 5. Công thức mẫu (MVP, Đề xuất – chờ duyệt)

### 5.1 Chi phí tham chiếu

Giá vốn nguyên liệu mục tiêu của một công thức đúng phẩm trần:

```latex
V(r, q) = \kappa_{q} \cdot V_{\text{ref}}(r), \qquad V_{\text{ref}}(r) = 1610 \cdot 1{,}5^{\,r-1} \quad \text{(Linh thạch hạ phẩm)}
```

V_ref là **kỳ vọng rương Boss bí cảnh tuần** cùng cảnh giới (1.610 ở r = 1, bảng 07 §6; nhân 1,5^(r−1) theo hệ số cảnh giới). κ_q: Trắng 0,15 · Lục 0,25 · Lam 0,40 · Tím 0,70 · Vàng 1,20 · Đỏ 2,00 cho **đan chủ**; đan phụ bằng một nửa; đan hồi phục dùng κ = 0,01 mỗi viên; trận bàn / khiên pháp bảo dùng κ như đan chủ cùng phẩm. Ví dụ ở r = 1: Trúc Cơ Đan Lam ≈ 0,40 × 1.610 = **644** Linh thạch hạ phẩm vật liệu (khoảng 1,2 giờ farm tinh anh, 530/giờ theo 07 §6).

### 5.2 Danh sách công thức MVP

Id đan theo D24 (`pill_<tên không dấu>_dan`, khớp `main_pill_ids` của `realm_progression.json`); đan phụ lấy từ bảng hệ số đan 07 §2.

| Nghề      | Công thức (id)                           | Bậc b | Độ khó D    | Đầu ra                                                                                                                        | Ghi chú                                                                            |
| --------- | ---------------------------------------- | ----- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Luyện Đan | `pill_tu_khi_dan` (Tụ Khí Đan)           | 1     | 1           | Đan dẫn nhập: cộng một lượng tu vi nhỏ, **không** ảnh hưởng tỷ lệ đột phá (D19); dùng trong onboarding [16](16-onboarding.md) | Đan hồi phục không tính hệ số đột phá                                              |
| Luyện Đan | `pill_hoi_huyet_dan`, `pill_hoi_khi_dan` | 1–2   | 1           | Hồi Khí Huyết / Chân Nguyên theo %, thường thức                                                                               | Hồi chiêu dùng chung của đan hồi phục (giá trị do 11 chốt)                         |
| Luyện Đan | `pill_truc_co_dan` (Trúc Cơ Đan)         | 1     | 3           | Chủ đan b₀ = 0,40 (07 §2) cho ngưỡng Luyện Khí → Trúc Cơ                                                                      | Không tự chế khi chưa Trúc Cơ (§1)                                                 |
| Luyện Đan | `pill_ket_kim_dan`                       | 2     | 4           | Chủ đan cho ngưỡng Trúc Cơ → Kim Đan                                                                                          | Mở ở chương 3 ([12](12-nhiem-vu-cot-truyen.md))                                    |
| Luyện Đan | `pill_ho_mach_dan` (Hộ Mạch Đan)         | 2     | 3           | Phụ đan b₀ = 0,20; trong Lôi Kiếp: hồi 20% HP_ref, hồi chiêu 45 s, viên đầu uống tại t = 0 (07 §3, D17)                       | Đan hồi máu thường bị khóa trong Lôi Kiếp                                          |
| Luyện Đan | `pill_dinh_tam_dan` (Định Tâm Đan)       | 2     | 3           | Phụ đan b₀ = 0,20                                                                                                             | Hỗ trợ ngưỡng có Tâm Ma                                                            |
| Luyện Khí | `eq_weapon_<he>_b<N>`                    | N     | theo bản vẽ | Pháp bảo vũ khí theo hệ, phẩm ≤ phẩm bản vẽ                                                                                   | Cộng chỉ số theo §7                                                                |
| Luyện Khí | `eq_defense_<he>_b<N>`                   | N     | theo bản vẽ | Pháp y có hệ (quyết định hệ phòng thủ, 07 §4) và khiên pháp bảo Lôi Kiếp                                                      | Khiên: Shield = HP_ref × 0,15 / 0,25 / 0,35 / 0,45 / 0,60 / 0,80 theo phẩm (07 §3) |
| Luyện Khí | `eq_array_disc_b<N>` (trận bàn)          | N     | 3–6         | Trận pháp tiêu hao: R = 10 / 16 / 22 / 28 / 34 / 40% theo phẩm, 1 lần nạp mỗi đợt                                             | Dùng cho Lôi Kiếp từ 9 đạo (07 §3)                                                 |
| Chế Phù   | `talisman_atk_<he>`                      | 1+    | 2–4         | Phù tấn công hệ Ngũ hành, sát thương một lần                                                                                  | Sát thương theo §8 (không dùng công thức riêng)                                    |
| Chế Phù   | `talisman_def_*`, `talisman_aid_*`       | 1+    | 2–4         | Phù khiên, phù hồi, phù tốc                                                                                                   | Giá trị chi tiết do [11](11-he-phai-ky-nang.md) hoặc dữ liệu cân bằng sau đó       |

Bảng giá trị chi tiết (số lượng nguyên liệu mỗi công thức, giá trị phù) nằm trong file dữ liệu `recipes.json` (đề xuất, schema sẽ viết cùng đợt tạo dữ liệu); không đặt trong tài liệu này để khỏi trùng và lệch với `@vgtd/shared`.

## 6. Kinh tế chế tạo

### 6.1 Các kênh tiêu hao

| Kênh                                | Tiêu hao gì                                                         | Đo bằng                         | Ảnh hưởng tới mục tiêu tiêu hao / sinh ra 0,9–1,0 |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| Nguyên liệu bị hủy                  | Vật phẩm (không phải Linh thạch)                                    | Số nguyên liệu bị hủy / sinh ra | Giữ giá nguyên liệu ổn định; theo dõi CPI rổ hàng |
| Phí lò                              | **Linh thạch**: 3% × V(r, q) mỗi lần chế, trả NPC, hủy              | Ledger `SYSTEM_SINK_CRAFT_FEE`  | Vào nhóm "kênh khác" 12% của 07 §7                |
| Độ bền lò, đỉnh, bàn                | Mỗi lần chế −1% độ bền; sửa theo `RepairCost = V_item × 0,004 × Δ%` | Ledger `SYSTEM_SINK_REPAIR`     | Vào nhóm "Sửa chữa trang bị" 15%                  |
| Xúc tác, Hộ Lô Phù                  | Linh thạch hoặc nguyên liệu                                         | Ledger                          | Vào nhóm "kênh khác"                              |
| Học công thức, nâng điểm thạo luyện | Linh thạch một lần                                                  | Ledger                          | Kênh nhỏ                                          |
| Thợ rèn người chơi sửa đồ           | Nguyên liệu + **50% phí Linh thạch NPC** (07 §7)                    | Ledger                          | Giữ giá trị nghề, vẫn có sink                     |

Phí lò 3% là _Đề xuất_; cần hiệu chỉnh để chế tạo không làm vượt phần "kênh khác 12%". Nếu mô phỏng cho thấy chế tạo là sink đáng kể (> 5% tổng tiêu hao), đề nghị **tách riêng một dòng "Chế tạo" trong cơ cấu mục tiêu** và cập nhật 07 §7 qua DECISIONS (tạo D mới), không tự ý đổi số ở đây.

### 6.2 Rủi ro lạm phát cần chống

- **Tràn đan đột phá:** đan đột phá đúng cảnh giới có tỷ lệ rơi rất thấp (0,02% / 0,5% / 6%, 07 §6). Nếu chế tạo làm giá đan sụp, thuế CPI (τ tăng theo CPI_w) không bắt được _giảm phát_. Biện pháp: hạn ngạch chế đan chủ b ≥ 3 là **tối đa 5 viên mỗi nhân vật mỗi tuần** (_Đề xuất_), và giám sát giá rổ CPI.
- **Cày xúc tác bằng bot:** thu hái là mục tiêu của bot; áp giới hạn linh khí cạn kiệt như săn quái (× 0,5 sau 2 giờ liên tục) cho điểm hái, và cờ bot ở [17](17-telemetry-kpi.md) §6.
- **Nhân đôi vật phẩm (dupe):** mọi kết quả chế đi qua Economy Service với khóa idempotency `(char_id, craft_request_id)`, sổ cái kép cân bằng về 0 như giao dịch mua trên Vạn Bảo Lâu (08 §7).

## 7. Luyện khí: trang bị & pháp bảo

- **Tổng cộng trang bị, công pháp và pháp bảo cộng tối đa 60% chỉ số gốc** cùng cảnh giới (07 §1). Với món trang bị phẩm q, đóng góp = w_q × (phần của ô trang bị) × 60%, trong đó w_q (_Đề xuất_): Trắng 0,25 · Lục 0,40 · Lam 0,55 · Tím 0,70 · Vàng 0,85 · Đỏ 1,00. Hệ quả: bộ đồ toàn Trắng ≈ +15%, toàn Đỏ = +60% (đúng trần). Trọng số từng ô do [11](11-he-phai-ky-nang.md) hoặc dữ liệu quyết định.
- **Pháp y có hệ** quyết định hệ phòng thủ trong công thức sát thương (07 §4); pháp y thẩm mỹ bán bằng Tiên Ngọc **không đổi hệ phòng thủ** ([15](15-kiem-tien-liveops.md) §3).
- **Độ bền:** trang bị tiêu hao theo 07 §7; thợ rèn người chơi sửa bằng nguyên liệu cộng 50% phí NPC.
- **Pháp bảo bản mệnh** (`natal_artifact`, mở ở Kim Đan trong 07 §8) nằm ngoài MVP, chỉ giữ chỗ.

## 8. Chế phù: quy tắc chống lạm dụng chiến đấu

Chế phù ảnh hưởng PvP nên chỉ hạn chế, không tạo "sát thương ngoài công thức":

- Sát thương phù tính bằng chính công thức 07 §4 với `c_skill` do dữ liệu phù xác định và **ATK của người dùng** (không có ATK riêng của phù), nên không thể vượt cảnh giới.
- Ô phù: **4 ô F1–F4 trên PC, 1 ô phù nhanh trên Mobile** (05 §2). Hồi chiêu chung của phù: _Đề xuất_ 10 s, và hồi chiêu do server giữ như mọi kỹ năng (08 §6).
- Trong đấu trường xếp hạng (xem [14](14-pvp-chien-tranh.md) §4) cấm dùng đan hồi phục và phù hồi thường; chỉ cho phù do hệ thống cấp.
- Chữ Hán trên phù chỉ là họa tiết, không mang thông tin bắt buộc (05 §5); yêu cầu phông chữ ở [19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md) §3.

## 9. Trải nghiệm và máy chủ

- **UI:** PC mở cửa sổ nổi "Chế tạo" (phím _P_, _Đề xuất_) có tab Luyện Đan / Luyện Khí / Chế Phù; Mobile mở màn hình toàn phần có tab. Icon lớn 128 px cho bảng luyện đan theo 05 §5.
- **Thao tác:** thời gian thi triển mỗi lần chế 5 s (_Đề xuất_), xếp hàng tối đa 10 lần liên tiếp; di chuyển hoặc vào chiến đấu thì hủy lần đang chế (hoàn nguyên liệu). Chỉ chế ở khu **An toàn** hoặc **Động Phủ** của mình.
- **Máy chủ:** Economy Service (08 §7) là nơi duy nhất ghi kết quả; World Node chỉ xác nhận trạng thái "đang chế". Seed RNG và kết quả ghi vào log truy xuất như tỷ lệ đột phá.
- **Telemetry:** các sự kiện `craft.start`, `craft.result` (kèm `success`, `quality`, `score`) và chỉ số tiêu hao theo kênh — xem [17](17-telemetry-kpi.md) §3 và §5.

## Câu hỏi cần chốt

Đã gộp vào [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md), nguồn duy nhất của câu hỏi mở: cột "Câu hỏi" ở đó ghi ID nguồn đã gộp (13 Q1–Q8). Nội dung gốc của mục này nằm trong lịch sử git.
