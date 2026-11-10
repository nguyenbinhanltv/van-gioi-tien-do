# Mô phỏng kinh tế (D113, P5)

> **Tệp sinh tự động** bởi `tools/econ-sim` (`npm run sim -w @vgtd/econ-sim`), phiên bản tham số 1, hạt giống 1, tất định: chạy lại cùng tham số cho đúng số này. Không đổi số liệu gameplay: chỉ **báo cáo và khuyến nghị**; mọi thay đổi đi qua `vgtd-formula-change` (DECISIONS trước). Phục vụ docs/10 §12 (P5 "mô phỏng kinh tế"), OPEN-ITEMS #7, docs/26 §8 (giai đoạn M0–M1).

## 1. Tóm tắt

Một đoàn 2.000 người chơi mô phỏng 90 ngày với công thức và bảng thật của `@vgtd/shared` (bảng rơi 07 §6, thuế chợ, phí niêm yết, phí truyền tống, sửa chữa, tốc độ tu vi, tỷ lệ đột phá). Kết quả kịch bản gốc (chỉ cơ chế đã có trong tài liệu): tỷ lệ tiêu hao / sinh ra ổn định **0,13** (mục tiêu 0,9–1,0); 5 cảnh báo mức cao.

- Lạm phát Linh thạch: tỷ lệ tiêu hao / sinh ra 0,13 (mục tiêu 0,9–1,0)
- Lượng Linh thạch trong ví tăng không ngừng: trung vị 11.350 (tuần 4) → 106.170 (tuần 13)
- Kênh sinh ra chi phối: drop_boss chiếm 50,8% tổng Linh thạch sinh ra
- Kênh tiêu hao mục tiêu 35,0% không có cơ chế Linh thạch: breakthrough
- Kênh tiêu hao mục tiêu 15,0% không có cơ chế Linh thạch: guardianArrayAndLeyLine

Khuyến nghị ngắn (chi tiết ở §7):

1. Hệ số có sẵn: phí sửa chữa ×17,4 đưa tỷ lệ về 0,9 trong mô hình (vòng điều chỉnh hằng tuần của docs/07 §7 nhân 1,1 mỗi lần: cần 30 lần liên tiếp).
2. Kênh "đột phá 35%" không có cơ chế Linh thạch trong tài liệu; đột phá chỉ vài lần mỗi nhân vật nên không thể gánh tiêu hao hằng ngày: cần quyết định kênh tiêu hao **lặp lại** theo giờ chơi (§7).
3. Boss tuần chi phối thu nhập theo giờ và nửa giá trị rương là xổ số thượng phẩm: xem lại số boss khả dụng và dòng 12% × 10.000 (§6).

## 2. Phương pháp và giả định

Mô phỏng theo ngày, một đoàn người chơi (không có người vào mới). Mỗi ngày mỗi người chơi: săn (dã ngoại / tinh anh, đội, linh khí cạn kiệt, quái thấp hơn 1 cảnh giới), đánh boss tuần, làm nhiệm vụ (nhật, tuần, tông môn, phụ, chương chính), tu luyện (tu vi theo `minutesForStage`, đột phá nhỏ và lớn có pity và đan), sửa trang bị, truyền tống, đổi phẩm, chế tạo (thợ) và giao dịch ở chợ (đan đột phá, nguyên liệu; giá theo cung cầu, thuế τ theo CPI tuần). Sổ Linh thạch bảo toàn: tổng ví = tổng sinh ra − tổng tiêu hao (có test).

| Tham số                      | Giá trị                                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Người chơi (thuần, một đoàn) | 2.000                                                                                                                                                                                           |
| Số ngày                      | 90                                                                                                                                                                                              |
| Hạt giống                    | 1                                                                                                                                                                                               |
| Nấc tối đa                   | 18                                                                                                                                                                                              |
| Nhóm                         | casual 50,0% (0.8 giờ/ngày, chơi 60,0% số ngày, rời 2,0%/ngày); regular 35,0% (1.8 giờ/ngày, chơi 85,0% số ngày, rời 1,0%/ngày); hardcore 15,0% (4 giờ/ngày, chơi 95,0% số ngày, rời 0,5%/ngày) |

Mọi con số mà tài liệu **không** nêu đều là giả định hành vi (cần game designer duyệt), liệt kê đầy đủ:

- Nhóm người chơi (casual / regular / hardcore: 50 / 35 / 15%, 0,8 / 1,8 / 4 giờ mỗi ngày chơi, xác suất chơi 60 / 85 / 95%, rời bỏ 2 / 1 / 0,5% mỗi ngày): không có số liệu, đây là giả định về hành vi.
- Chia thời gian một ngày chơi: 40% tu luyện, 45% săn, 10% chế tạo, 5% còn lại. Tu vi chỉ tăng khi tu luyện (D84 dả tọa) và từ nhiệm vụ; giết quái không cho tu vi.
- Nhịp săn 150 quái dã ngoại mỗi giờ hoặc 20 tinh anh mỗi giờ (một nửa thời gian săn cho mỗi loại), dùng 0,3 đan hồi phục mỗi giờ săn; 80% ở cảnh giới của mình, 20% thấp hơn 1 cảnh giới (×0,2); 30% săn theo đội 4 người (mỗi người ×0,5, giết nhanh ×1,5); mỗi boss tuần mất 10 phút.
- Chết 0,25 lần mỗi giờ săn; trang bị = 3 món, mỗi món κ(Lam) × V_ref(r) (docs/13 §5.1); sửa khi thiếu ≥ 25 điểm phần trăm; 30% lượt sửa do thợ rèn người chơi (trả 50% phí NPC).
- Đổi phẩm Linh thạch: 5% số ngày, đổi tới nửa số ví (ngẫu nhiên) khi ví ≥ 1.000 hạ phẩm, phí 5% (docs/26 §7.1); không tài liệu nói người chơi có đổi hay không, đổi bao nhiêu.
- Nhiệm vụ: nhật 80%, tuần 70%, tông môn 60% số ngày / tuần làm; 0,3 nhiệm vụ phụ mỗi ngày (tối đa 12 mỗi cảnh giới); mỗi cảnh giới một chương chính (1,0 giờ farm quy chuẩn). Đơn vị phần thưởng theo docs/12 §4.1 (180 × 1,5^(r−1) mỗi giờ quy chuẩn).
- Nhiệm vụ tông môn cho 20 Cống hiến mỗi ngày (docs/12: "số nguyên cố định trong dữ liệu", chưa có); tông môn nhận 80% người chơi (D98).
- Chế tạo: 20% người chơi là thợ; 4 lần chế mỗi giờ; công thức đan đột phá có phẩm trần Lam; điểm thạo luyện 1 (docs/13 §4); nguyên liệu giá 1 hạ phẩm mỗi đơn vị (docs/13 §5.1 chỉ cho giá vốn của sản phẩm, V(r, q) = κ × 1610 × 1,5^(r−1)).
- Đột phá lớn: người chơi muốn 2 đan đúng cảnh giới (tốt nhất tới phẩm Lam, tối đa 80% ví), bắt đầu mua khi đạt 60% nấc cuối, chờ tối đa 3 ngày rồi thử với những gì có; đan dùng là mất dù thành hay bại; thất bại mất 15% yêu cầu nấc. **Chi phí Linh thạch của đột phá không có trong docs** (chỉ đan và vật liệu); kịch bản gốc đặt 0.
- Chợ: đan đột phá và nguyên liệu mua bán giữa người chơi, giá = V(r, q) × hệ số giá, hệ số đổi theo cung cầu (±15% mỗi ngày, trong [0,3; 50]); 20% giao dịch trực tiếp (thuế 3%), còn lại qua chợ (phí niêm yết 1% + thuế τ theo CPI). Không có NPC mua đồ (docs/OPEN-ITEMS X7); kịch bản riêng thử NPC mua nguyên liệu.
- Không mô phỏng: nhiều vùng với mật độ linh khí khác nhau (ρ = 1, Match = 1), Linh Mạch / Hộ Sơn Đại Trận (không có trong beta, tông môn chỉ có NPC), đấu giá, đổi phẩm bản vẽ, trang bị mua mới khi lên cảnh giới (giá trị trang bị bám theo cảnh giới, lấy từ ngoài vòng Linh thạch), pity bản vẽ Vàng–Đỏ của chế tạo, Tiên Ngọc (docs/15), gian lận (M2).

## 3. Kịch bản và so sánh

| Kịch bản                           | Tỷ lệ tiêu hao / sinh ra (ổn định) | Ví trung vị tuần 4 | Ví trung vị cuối | Ví p90 cuối | Gini cuối | Hệ số giá đan (r1–3) | Cảnh báo cao |
| ---------------------------------- | ---------------------------------- | ------------------ | ---------------- | ----------- | --------- | -------------------- | ------------ |
| Gốc (chỉ cơ chế trong tài liệu)    | 0,13                               | 11.350             | 106.170          | 282.950     | 0,48      | 0,3                  | 5            |
| NPC mua nguyên liệu 30%            | 0,13                               | 11.355             | 88.829           | 329.356     | 0,54      | 16,9                 | 5            |
| Tỷ lệ rơi −20%                     | 0,16                               | 8.885              | 80.015           | 224.524     | 0,50      | 16,5                 | 5            |
| Tỷ lệ rơi +20%                     | 0,12                               | 14.271             | 122.115          | 328.988     | 0,48      | 12,7                 | 5            |
| Phí đột phá 0,5 × V_ref (giả định) | 0,15                               | 6.540              | 98.085           | 271.480     | 0,49      | 0,3                  | 4            |
| Phí sửa chữa ×2                    | 0,19                               | 11.189             | 96.847           | 273.978     | 0,51      | 16,7                 | 5            |

- **Gốc (chỉ cơ chế trong tài liệu):** beta (đến cổng Kết Anh, nấc 18), không NPC mua đồ, đột phá không tốn Linh thạch.
- **NPC mua nguyên liệu 30%:** thêm faucet NPC_SELL (X7): mỗi nguyên liệu không bán được cho người chơi thì NPC mua với 30% giá gốc.
- **Tỷ lệ rơi −20%:** quét tham số M1 (docs/26 §8): mọi xác suất rơi ×0,8.
- **Tỷ lệ rơi +20%:** mọi xác suất rơi ×1,2.
- **Phí đột phá 0,5 × V_ref (giả định):** mỗi lần thử đột phá lớn (kể cả thất bại) tốn 0,5 × 1610 × 1,5^(r−1) hạ phẩm; docs không có phí này, chỉ để đo xem một sink theo sự kiện bù được bao nhiêu.
- **Phí sửa chữa ×2:** hệ số điều chỉnh có sẵn của docs/07 §7 nhân đôi (sau khoảng 7 lần vòng điều chỉnh ×1,1).

## 4. Kịch bản gốc: Linh thạch theo thời gian

### 4.1 Tỷ lệ tiêu hao / sinh ra theo tuần

```text
tuần  1 ██████████████░░░░░░░░░░░░░░░░░░ 0,07
tuần  2 ███████████████████░░░░░░░░░░░░░ 0,09
tuần  3 ██████████████████████████░░░░░░ 0,13
tuần  4 ████████████████████████████████ 0,15
tuần  5 ██████████████████████████████░░ 0,15
tuần  6 ████████████████████████████░░░░ 0,14
tuần  7 █████████████████████████░░░░░░░ 0,12
tuần  8 ██████████████████████████░░░░░░ 0,13
tuần  9 ██████████████████████████░░░░░░ 0,13
tuần 10 ███████████████████████████░░░░░ 0,13
tuần 11 ████████████████████████████░░░░ 0,14
tuần 12 █████████████████████████████░░░ 0,14
tuần 13 ████████████████████████████████ 0,16
```

Mục tiêu 0,9–1,0 (docs/26 §7.1).

### 4.2 Linh thạch trong ví của người chơi còn hoạt động (hạ phẩm)

| Tuần | Sinh ra / người / ngày | Tiêu hao / người / ngày | Ví trung vị | Ví p90  | Gini | Giá đan (hệ số) | Giá nguyên liệu | τ     |
| ---- | ---------------------- | ----------------------- | ----------- | ------- | ---- | --------------- | --------------- | ----- |
| 1    | 500                    | 34                      | 1.408       | 11.407  | 0,63 | 2,2             | 2,7             | 5,0%  |
| 2    | 804                    | 76                      | 4.031       | 23.808  | 0,59 | 5,7             | 7,1             | 10,0% |
| 3    | 1.001                  | 128                     | 7.653       | 40.096  | 0,58 | 15,0            | 18,8            | 10,0% |
| 4    | 1.291                  | 199                     | 11.350      | 66.393  | 0,58 | 38,4            | 37,0            | 10,0% |
| 5    | 1.345                  | 197                     | 15.487      | 88.193  | 0,58 | 35,7            | 11,9            | 10,0% |
| 6    | 1.410                  | 193                     | 24.233      | 110.744 | 0,56 | 17,6            | 17,2            | 5,0%  |
| 7    | 1.536                  | 187                     | 35.005      | 138.444 | 0,56 | 9,4             | 18,5            | 5,0%  |
| 8    | 1.515                  | 194                     | 45.010      | 161.402 | 0,54 | 3,5             | 14,7            | 5,0%  |
| 9    | 1.599                  | 200                     | 54.133      | 186.102 | 0,53 | 1,1             | 11,7            | 5,0%  |
| 10   | 1.702                  | 222                     | 71.635      | 213.122 | 0,51 | 0,4             | 12,5            | 5,0%  |
| 11   | 1.599                  | 216                     | 86.190      | 238.647 | 0,50 | 0,3             | 10,0            | 5,0%  |
| 12   | 1.650                  | 234                     | 97.591      | 263.499 | 0,49 | 0,3             | 14,5            | 10,0% |
| 13   | 1.712                  | 267                     | 106.170     | 282.950 | 0,48 | 0,3             | 7,4             | 10,0% |

Ví trung vị theo tuần:

```text
tuần  1 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 1.408
tuần  2 █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 4.031
tuần  3 ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 7.653
tuần  4 ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 11.350
tuần  5 █████░░░░░░░░░░░░░░░░░░░░░░░░░░░ 15.487
tuần  6 ███████░░░░░░░░░░░░░░░░░░░░░░░░░ 24.233
tuần  7 ███████████░░░░░░░░░░░░░░░░░░░░░ 35.005
tuần  8 ██████████████░░░░░░░░░░░░░░░░░░ 45.010
tuần  9 ████████████████░░░░░░░░░░░░░░░░ 54.133
tuần 10 ██████████████████████░░░░░░░░░░ 71.635
tuần 11 ██████████████████████████░░░░░░ 86.190
tuần 12 █████████████████████████████░░░ 97.591
tuần 13 ████████████████████████████████ 106.170
```

Hệ số giá đan đột phá (cảnh giới 1–3; 1 = V(r, q) của docs/13 §5.1):

```text
tuần  1 ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 2,2
tuần  2 █████░░░░░░░░░░░░░░░░░░░░░░░░░░░ 5,7
tuần  3 ████████████░░░░░░░░░░░░░░░░░░░░ 15,0
tuần  4 ████████████████████████████████ 38,4
tuần  5 ██████████████████████████████░░ 35,7
tuần  6 ███████████████░░░░░░░░░░░░░░░░░ 17,6
tuần  7 ████████░░░░░░░░░░░░░░░░░░░░░░░░ 9,4
tuần  8 ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 3,5
tuần  9 █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 1,1
tuần 10 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,4
tuần 11 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,3
tuần 12 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,3
tuần 13 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,3
```

### 4.3 Kênh sinh ra và tiêu hao (ổn định, từ tuần 5)

Sinh ra:

```text
drop_field   ███████░░░░░░░░░░░░░░░░░░░░░░░░░ 10,4%
drop_elite   █████████████████░░░░░░░░░░░░░░░ 26,5%
drop_boss    ████████████████████████████████ 50,8%
quest_daily  ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 6,1%
quest_weekly ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 4,6%
quest_main   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,1%
quest_side   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,2%
quest_sect   █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 1,5%
npc_sell     ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,0%
```

Tiêu hao:

```text
market_tax        ████████░░░░░░░░░░░░░░░░░░░░░░░░ 9,7%
listing_fee       █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 1,5%
trade_tax         █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 1,0%
craft_fee         ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,4%
repair            ███████████████████████████░░░░░ 32,4%
teleport          ████████████████████████████████ 38,6%
convert_fee       ██████████████░░░░░░░░░░░░░░░░░░ 16,5%
breakthrough_cost ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0,0%
```

### 4.4 Cơ cấu tiêu hao so với mục tiêu (docs/07 §7)

| Nhóm                    | Mục tiêu | Mô hình | Cơ chế trong mô hình               |
| ----------------------- | -------- | ------- | ---------------------------------- |
| breakthrough            | 35,0%    | 0,0%    | breakthrough_cost                  |
| marketTax               | 15,0%    | 12,2%   | market_tax, listing_fee, trade_tax |
| repair                  | 15,0%    | 32,4%   | repair                             |
| guardianArrayAndLeyLine | 15,0%    | 0,0%    | (không có cơ chế)                  |
| teleport                | 8,0%     | 38,6%   | teleport                           |
| tierSwapAndOther        | 12,0%    | 16,9%   | convert_fee, craft_fee             |

## 5. Nhịp tu luyện (thời gian tới từng cảnh giới)

Ngày (kể từ ngày 1) mà người chơi vào cảnh giới, theo nhóm; "tới được" là tỷ lệ nhóm tới được trong thời gian mô phỏng.

| Nhóm     | Cảnh giới  | Tới được | p10 | Trung vị | p90 |
| -------- | ---------- | -------- | --- | -------- | --- |
| casual   | Trúc Cơ    | 81,7%    | 7   | 11       | 18  |
| casual   | Kim Đan    | 66,1%    | 14  | 21       | 32  |
| casual   | Nguyên Anh | 48,4%    | 23  | 34       | 51  |
| regular  | Trúc Cơ    | 92,1%    | 5   | 6        | 11  |
| regular  | Kim Đan    | 85,6%    | 9   | 13       | 21  |
| regular  | Nguyên Anh | 79,9%    | 15  | 21       | 31  |
| hardcore | Trúc Cơ    | 96,3%    | 4   | 5        | 9   |
| hardcore | Kim Đan    | 93,3%    | 7   | 10       | 17  |
| hardcore | Nguyên Anh | 90,3%    | 12  | 17       | 25  |

Toàn bộ 41 nấc (kịch bản "Toàn bộ 41 nấc", không giới hạn nấc):

| Nhóm     | Cảnh giới  | Tới được | Trung vị (ngày) |
| -------- | ---------- | -------- | --------------- |
| casual   | Trúc Cơ    | 80,5%    | 10              |
| casual   | Kim Đan    | 63,6%    | 21              |
| casual   | Nguyên Anh | 46,9%    | 34              |
| casual   | Hóa Thần   | 33,3%    | 51              |
| casual   | Luyện Hư   | 18,6%    | 69              |
| casual   | Hợp Thể    | 4,9%     | 76              |
| casual   | Đại Thừa   | 0,6%     | 88              |
| regular  | Trúc Cơ    | 92,6%    | 6               |
| regular  | Kim Đan    | 86,7%    | 13              |
| regular  | Nguyên Anh | 80,6%    | 21              |
| regular  | Hóa Thần   | 70,3%    | 32              |
| regular  | Luyện Hư   | 60,7%    | 45              |
| regular  | Hợp Thể    | 50,6%    | 59              |
| regular  | Đại Thừa   | 31,4%    | 71              |
| regular  | Độ Kiếp    | 10,9%    | 81              |
| hardcore | Trúc Cơ    | 96,3%    | 5               |
| hardcore | Kim Đan    | 93,0%    | 10              |
| hardcore | Nguyên Anh | 88,0%    | 17              |
| hardcore | Hóa Thần   | 82,7%    | 25              |
| hardcore | Luyện Hư   | 79,3%    | 35              |
| hardcore | Hợp Thể    | 74,3%    | 47              |
| hardcore | Đại Thừa   | 67,3%    | 59              |
| hardcore | Độ Kiếp    | 51,0%    | 73              |

## 6. Thu nhập theo hoạt động và cảnh báo

| Hoạt động | Giờ (cả đoàn) | Linh thạch | Hạ phẩm / giờ |
| --------- | ------------- | ---------- | ------------- |
| field     | 34.906        | 13.002.069 | 372           |
| elite     | 34.906        | 33.969.375 | 973           |
| boss      | 3.475         | 64.316.931 | 18.507        |
| quests    | 0             | 16.521.965 | 0             |
| craft     | 3.028         | 5.610.891  | 1.853         |

```text
field █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 372 / giờ
elite ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 973 / giờ
boss  ████████████████████████████████ 18.507 / giờ
craft ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 1.853 / giờ
```

(Nhiệm vụ không tính giờ riêng: đóng góp bằng Linh thạch ở bảng kênh.)

### Cảnh báo mức cao

- **[cao] Lạm phát Linh thạch: tỷ lệ tiêu hao / sinh ra 0,13 (mục tiêu 0,9–1,0).** Tuần 5 trở đi dưới 0,9 hai tuần liền (docs/26 §7.2). Phần tiêu hao thiếu mỗi người chơi mỗi ngày: 1.176 hạ phẩm để chạm 0,9.
- **[cao] Lượng Linh thạch trong ví tăng không ngừng: trung vị 11.350 (tuần 4) → 106.170 (tuần 13).** Người chơi còn hoạt động tích lũy Linh thạch nhanh hơn mọi kênh tiêu hao rút ra; giá đan và nguyên liệu mất tín hiệu khi ví đầy.
- **[cao] Kênh sinh ra chi phối: drop_boss chiếm 50,8% tổng Linh thạch sinh ra.** Rương boss tuần: 74,5% giá trị kỳ vọng của rương nằm ở dòng "thượng phẩm 12% × 10.000" (07 §6): một quả xổ số, không phải thu nhập đều.
- **[cao] Kênh tiêu hao mục tiêu 35,0% không có cơ chế Linh thạch: breakthrough.** docs/07 §7 và docs/26 §7.1 đặt 35% cho "đột phá và vật liệu đột phá" nhưng không tài liệu nào định nghĩa phí Linh thạch của đột phá; đan đột phá đi qua chợ (chuyển giữa người chơi, chỉ thuế bị hủy). Ngoài ra đột phá chỉ xảy ra vài lần mỗi nhân vật nên không thể là sink hằng ngày.
- **[cao] Kênh tiêu hao mục tiêu 15,0% không có cơ chế Linh thạch: guardianArrayAndLeyLine.** Hộ Sơn Đại Trận / Linh Mạch: beta chỉ có tông môn NPC (D98), không có tông môn người chơi nên kênh này chưa tồn tại.

### Cảnh báo mức trung

- **[trung] Vòng lặp chi phối theo giờ: boss tuần 18.507 hạ phẩm/giờ so với 973 khi săn thường (×19,0).** Bị khóa theo tuần (1 rương / boss / tuần) nên không nhân lên được, nhưng một người chơi làm đủ rương tuần có phần lớn thu nhập tuần từ ~10 phút. Cần xem: số boss khả dụng mỗi tuần và hệ số rương theo cảnh giới.
- **[trung] Đan hồi phục dư: 131 viên mỗi người chơi cuối kỳ (dùng giả định 0,3 viên / giờ săn).** Nguồn rơi (3% dã ngoại, 15% × 1–2 tinh anh) lớn hơn nhu cầu giả định; không có chợ hay NPC mua; nếu có thì giá trị κ = 0,01 × V_ref mỗi viên thành một faucet Linh thạch lớn (X7).

### Cảnh báo mức thấp

- **[thấp] Kênh repair chiếm 32,4% tiêu hao (mục tiêu 15,0%).** Cơ cấu tiêu hao lệch xa cơ cấu mục tiêu của docs/07 §7 vì các kênh khác thiếu.
- **[thấp] Kênh teleport chiếm 38,6% tiêu hao (mục tiêu 8,0%).** Cơ cấu tiêu hao lệch xa cơ cấu mục tiêu của docs/07 §7 vì các kênh khác thiếu.
- **[thấp] Bản vẽ Trắng–Lục tích lũy 4.5 bản mỗi người chơi.** Không có kênh dùng hoặc hủy bản vẽ trong mô hình (chế tạo trang bị chưa mô phỏng).

### Cảnh báo mức thông tin

- **[thông tin] Chế tạo: lãi ròng -8.180 hạ phẩm mỗi giờ chế (săn thường 973).** Doanh thu sau thuế 5.610.891, chi phí (phí lò + nguyên liệu theo giá chợ) 30.379.177. Lãi âm nghĩa là nguyên liệu đắt hơn đan bán được ở giá chợ trong mô hình này.
- **[thông tin] Nhịp tu luyện: nhóm regular qua cổng Kết Anh (vào Nguyên Anh) ở ngày trung vị 21 (79,9% nhóm tới được).** Tu vi chỉ tăng khi tu luyện: tổng 41 nấc ≈ 47 giờ thuần (docs/12 §4.2) và 17 nấc đầu ≈ 5,6 giờ; thời gian chờ chủ yếu là đan đột phá, không phải tu vi. Đây là hệ quả trực tiếp của công thức 07 §5; game designer cần xem có muốn nhịp này không.
- **[thông tin] Mâu thuẫn trong docs/12 §4.2: nhiệm vụ nhật "0,25 giờ farm quy chuẩn" = 45 hạ phẩm ở r = 1, nhưng ghi chú ghi "≈ 90".** 0,25 × 150 × 1,2 = 45. Mô phỏng dùng đơn vị (45).

## 7. Khuyến nghị (không đổi số gameplay)

1. **Cần thêm khoảng 1.194 hạ phẩm tiêu hao mỗi người chơi mỗi ngày** (ở ổn định) để tới 0,9 mà không đổi nguồn sinh ra.
2. Chỉ bằng phí sửa chữa: ×17,4 mới tới 0,9; phí sửa chữa khi đó dễ làm người chơi ít giờ nản (sửa từ 0 lên 100% tốn 696% giá trị món đồ). Nên chia gánh giữa nhiều kênh hơn là dồn vào một.
3. **Quyết định thiết kế cần có** (game designer, rồi `vgtd-formula-change`): (a) có phí Linh thạch cho đột phá hay không, và nếu có thì nhỏ nhưng lặp (mỗi lần thử, kể cả thất bại, kèm pity), vì một lần mỗi cảnh giới không bù được dòng sinh ra hằng ngày; (b) có NPC mua đồ hay không (X7) và trần giá, vì không có thì đan hồi phục và bản vẽ thấp phẩm chỉ tích lũy; (c) kênh thay cho Hộ Sơn Đại Trận / Linh Mạch (15%) trong beta chỉ có tông môn NPC; (d) chợ cần phí hoặc giá sàn để giá đan không dao động hàng chục lần ở tuần đầu.
4. Xem lại số boss khả dụng mỗi tuần và dòng thượng phẩm 12% (hoặc đổi thành vật phẩm / pity) để thu nhập không nằm ở xổ số.
5. Đan đột phá: giá đỉnh ×38,4 so với V(r, q) khi cả đoàn chạm ngưỡng cùng lúc, vì nhu cầu (2 đan mỗi ngưỡng) lớn hơn nhiều nguồn rơi 0,02–6% và công suất thợ: cân nhắc hạn mức NPC bán đan đầu game, hoặc giảm số đan khuyến nghị, để người chơi không phải chờ hay thử không đan.
6. Chạy lại mô phỏng khi: có số liệu closed beta (M3), thay đổi bảng rơi / phí, hoặc chốt phí đột phá / NPC mua. `npm run sim -w @vgtd/econ-sim -- --help`.

## 8. Giới hạn của mô hình

- Một đoàn cố định (không có người chơi mới vào) và hành vi giả định: con số tuyệt đối không phải dự báo, chỉ dùng để **so sánh kịch bản** và phát hiện cấu trúc lệch.
- Chưa có: gian lận (M2), đấu giá, Tiên Ngọc, Linh Mạch, pity chế tạo, nhiều vùng khác ρ, giá trị trang bị tăng theo cảnh giới (lấy từ ngoài vòng Linh thạch), người chơi không chơi đủ mọi nhóm nghề.
- Phẩm đan: Trắng / Lục / Lam / Tím / Vàng / Đỏ; bản vẽ dùng làm vật phẩm tích lũy, không chế tạo trang bị.
- Cống hiến (CONG_HIEN) là tiền riêng, không vào tỷ lệ (docs/26 §7.1); cung được đếm riêng: 7.634.146 cho 1.605 thành viên.
