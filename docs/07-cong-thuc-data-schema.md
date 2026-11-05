# Hệ thống Công thức & Data Schema – MMORPG Tu Tiên 2D

Oct 31, 2026 · An Nguyen

## 1. Chỉ số cơ bản theo cảnh giới

Chỉ số tăng theo hàm mũ của một "tiến độ tu luyện" x, trong đó 60% mức tăng của mỗi cảnh giới nằm rải ở các tiểu cảnh và 40% dồn vào lần đột phá. Nhờ vậy chỉ số luôn tăng đơn điệu, đột phá luôn tạo cú nhảy cảm nhận được, và số đòn hạ gục giữa hai người cùng cảnh giới gần như không đổi suốt 9 cảnh giới.

### Công thức

```latex
\begin{aligned}
x(r, k) &= (r - 1) + \alpha \cdot \frac{k - 1}{K_r}, \qquad \alpha = 0{,}6 \\
\text{Stat}(r, k) &= B \cdot \lambda^{\,x(r, k)} \qquad \text{(Khí Huyết, Chân Nguyên, Công kích, Phòng ngự)} \\
\text{ThânPháp}(r, k) &= B_{TP} \cdot \left(1 + 0{,}15 \cdot x(r, k)\right)
\end{aligned}
```

Trong đó r = 1…9 là cảnh giới (Luyện Khí … Độ Kiếp), k là tiểu cảnh, K_r là số tiểu cảnh của cảnh giới đó (Luyện Khí 9 tầng, các cảnh giới khác 4: Sơ, Trung, Hậu, Viên Mãn). Tổng cộng 41 nấc. Thân pháp tăng tuyến tính vì nó quyết định tốc độ di chuyển và né tránh, tăng theo hàm mũ sẽ phá vỡ nhịp chiến đấu.

| Chỉ số           | B (Luyện Khí tầng 1) | λ               | Lý do chọn λ                                                           |
| ---------------- | -------------------- | --------------- | ---------------------------------------------------------------------- |
| Khí Huyết (HP)   | 1.200                | 1,78            | Nhỉnh hơn Công kích một chút để trận đấu cùng cảnh giới không ngắn dần |
| Chân Nguyên (MP) | 400                  | 1,70            | Chậm hơn để chi phí kỹ năng cao cấp vẫn là ràng buộc                   |
| Công kích        | 60                   | 1,75            | Mốc tham chiếu                                                         |
| Phòng ngự        | 40                   | 1,72            | Chậm hơn Công kích để giảm sát thương không tăng quá nhanh             |
| Thân pháp        | 100                  | tuyến tính 0,15 | Trần khoảng 2,3 lần ở cuối game                                        |

### Bảng giá trị (chỉ số gốc, chưa tính trang bị)

| Cảnh giới · nấc  | x    | Khí Huyết | Chân Nguyên | Công kích | Phòng ngự | Thân pháp |
| ---------------- | ---- | --------- | ----------- | --------- | --------- | --------- |
| Luyện Khí tầng 1 | 0    | 1.200     | 400         | 60        | 40        | 100       |
| Trúc Cơ sơ kỳ    | 1    | 2.136     | 680         | 105       | 69        | 115       |
| Kim Đan sơ kỳ    | 2    | 3.802     | 1.156       | 184       | 118       | 130       |
| Nguyên Anh sơ kỳ | 3    | 6.768     | 1.965       | 322       | 204       | 145       |
| Hóa Thần sơ kỳ   | 4    | 12.047    | 3.341       | 563       | 350       | 160       |
| Luyện Hư sơ kỳ   | 5    | 21.443    | 5.680       | 985       | 602       | 175       |
| Hợp Thể sơ kỳ    | 6    | 38.168    | 9.655       | 1.723     | 1.036     | 190       |
| Đại Thừa sơ kỳ   | 7    | 67.940    | 16.414      | 3.016     | 1.781     | 205       |
| Độ Kiếp sơ kỳ    | 8    | 120.936   | 27.903      | 5.278     | 3.064     | 220       |
| Độ Kiếp Viên Mãn | 8,45 | 156.733   | 35.437      | 6.788     | 3.910     | 227       |

Ví dụ cú nhảy đột phá: Luyện Khí tầng 9 (x = 0,533) có 1.632 Khí Huyết; lên Trúc Cơ sơ kỳ là 2.136, tăng 31% chỉ sau một lần đột phá.

### Kiểm soát lạm phát chỉ số

- Với công thức sát thương ở mục 4, hai người cùng nấc cần khoảng 33 đòn để hạ nhau ở Luyện Khí và khoảng 36 đòn ở Độ Kiếp: thời gian giao tranh chỉ dài thêm khoảng 10% sau 9 cảnh giới.
- Toàn bộ chỉ số dừng ở khoảng 130 lần mức khởi đầu (Khí Huyết), đủ nhỏ để server dùng số nguyên 32 bit cho cả sát thương chí mạng có nhân hệ số.
- Trang bị, công pháp và pháp bảo cộng tối đa 60% chỉ số gốc ở cùng cảnh giới, nên cảnh giới luôn là yếu tố quyết định.

## 2. Tỷ lệ đột phá

Công thức giữ đúng dạng yêu cầu, bổ sung ba quy tắc để server tính được: đan dược cộng dồn theo kiểu giảm dần, pity cộng vào Base, và kết quả kẹp trong 5–95%.

```latex
\begin{aligned}
\text{Success} &= \mathrm{clamp}\big(\text{Base}_{\text{eff}} \cdot (1 + \text{Pill}) - \text{Karma\_Penalty},\; 0{,}05,\; 0{,}95\big) \\
\text{Base}_{\text{eff}} &= \text{Base}_r + \min(0{,}08 \cdot n_{\text{fail}},\; 0{,}40) \\
\text{Pill} &= \min\Big(1,\; 1 - \prod_{i=1}^{m} (1 - b_i)\Big), \quad m \le 3, \quad b_i = b_0 \cdot q_{\text{phẩm}} \cdot (\text{đúng cảnh giới} ? 1 : 0{,}3) \\
\text{Karma\_Penalty} &= 0{,}20 \cdot \frac{\max(0, -K)}{1000}
\end{aligned}
```

- n_fail là số lần thất bại liên tiếp ở cùng ngưỡng, reset khi thành công; pity tối đa +40% (5 lần).
- K là Nghiệp Lực (−1000 đến +1000); nghiệp thiện không cộng tỷ lệ, lợi thế của Chính đạo nằm ở chỗ khác. Ma đạo (K ≤ −700) mất 14–20 điểm phần trăm.
- Vì đan nhân với Base còn nghiệp trừ thẳng, ở cảnh giới cao (Base thấp) nghiệp xấu gây thiệt hại tương đối lớn hơn: Ma đạo tu nhanh nhưng càng lên cao càng khó đột phá.
- Đột phá tiểu cảnh: Base 0,90 (tầng Luyện Khí) hoặc 0,85, không có kiếp, Karma_Penalty tính một nửa.
- Server roll bằng RNG có seed và ghi log từng lần để đội vận hành kiểm tra khiếu nại.

### Base theo ngưỡng đột phá lớn

| Ngưỡng                | Base_r | Kiếp đi kèm               |
| --------------------- | ------ | ------------------------- |
| Luyện Khí → Trúc Cơ   | 0,70   | Không                     |
| Trúc Cơ → Kim Đan     | 0,55   | Tâm Ma nhẹ                |
| Kim Đan → Nguyên Anh  | 0,45   | Lôi Kiếp 3 đạo + Tâm Ma   |
| Nguyên Anh → Hóa Thần | 0,35   | Lôi Kiếp 6 đạo            |
| Hóa Thần → Luyện Hư   | 0,30   | Tâm Ma đa người           |
| Luyện Hư → Hợp Thể    | 0,25   | Lôi Kiếp 9 đạo            |
| Hợp Thể → Đại Thừa    | 0,20   | Lôi Kiếp 18 đạo           |
| Đại Thừa → Độ Kiếp    | 0,15   | Tâm Ma + Lôi Kiếp 36 đạo  |
| Độ Kiếp → Phi Thăng   | 0,10   | Cửu Cửu Thiên Kiếp 81 đạo |

### Hệ số đan dược

| Loại đan              | b₀   | Ví dụ                                        |
| --------------------- | ---- | -------------------------------------------- |
| Chủ đan (đúng ngưỡng) | 0,40 | Trúc Cơ Đan, Kết Anh Đan, Cửu Chuyển Kim Đan |
| Phụ đan               | 0,20 | Hộ Mạch Đan, Định Tâm Đan                    |

Hệ số phẩm q theo 6 cấp: Trắng 0,6 · Lục 0,8 · Lam 1,0 · Tím 1,2 · Vàng 1,4 · Đỏ 1,6.

### Ví dụ tính

| Tình huống                                                                                                     | Base_eff | Pill                           | Karma_Penalty | Kết quả            |
| -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------ | ------------- | ------------------ |
| Luyện Khí → Trúc Cơ; Trúc Cơ Đan Lam; K = 0                                                                    | 0,70     | 0,40                           | 0             | 0,98 → kẹp **95%** |
| Kim Đan → Nguyên Anh; Kết Anh Đan Tím + Hộ Mạch Đan Lam; K = −400                                              | 0,45     | 1 − 0,52 × 0,80 = 0,584        | 0,08          | **63,3%**          |
| Độ Kiếp → Phi Thăng, đã thất bại 2 lần; Cửu Chuyển Kim Đan Đỏ + Định Tâm Đan Vàng + Hộ Mạch Đan Vàng; K = −800 | 0,26     | 1 − 0,36 × 0,72 × 0,72 = 0,813 | 0,16          | **31,1%**          |
| Như dòng trên nhưng K = 0                                                                                      | 0,26     | 0,813                          | 0             | **47,1%**          |

## 3. Sát thương Lôi Kiếp

Sét kiếp là **sát thương thuần**: bỏ qua Phòng ngự và Ngũ hành. Tổng sát thương của mỗi kiếp được đặt cao hơn lượng máu của người chơi (0,6 đến 3 lần Khí Huyết gốc), nên muốn qua kiếp từ 9 đạo trở lên bắt buộc phải có pháp bảo phòng ngự hoặc trận pháp tiêu hao.

### Công thức

```latex
\begin{aligned}
\text{Strike}(w) &= HP_{\text{ref}} \cdot \kappa_r \cdot g^{\,w-1}, \qquad g = 1{,}22,\; w = 1 \dots W_r \\
\text{Total}_r &= HP_{\text{ref}} \cdot \kappa_r \cdot m_r \cdot \frac{g^{W_r} - 1}{g - 1}
\end{aligned}
```

HP_ref là Khí Huyết gốc (chưa tính trang bị) ở Viên Mãn của cảnh giới đang độ kiếp; m_r là số tia mỗi đợt. Tia cách nhau 1,5 s trong một đợt, các đợt cách nhau 8 s để người chơi nạp lại trận và uống đan.

| Ngưỡng                | Số đạo | Số đợt W | Tia / đợt m | κ_r    | Tổng (× HP_ref) | Riêng đợt cuối (× HP_ref) |
| --------------------- | ------ | -------- | ----------- | ------ | --------------- | ------------------------- |
| Kim Đan → Nguyên Anh  | 3      | 3        | 1           | 0,162  | 0,6             | 0,24                      |
| Nguyên Anh → Hóa Thần | 6      | 6        | 1           | 0,115  | 1,2             | 0,31                      |
| Luyện Hư → Hợp Thể    | 9      | 9        | 1           | 0,0794 | 1,8             | 0,39                      |
| Hợp Thể → Đại Thừa    | 18     | 9        | 2           | 0,0485 | 2,2             | 0,48                      |
| Đại Thừa → Độ Kiếp    | 36     | 9        | 4           | 0,0287 | 2,6             | 0,56                      |
| Độ Kiếp → Phi Thăng   | 81     | 9        | 9           | 0,0147 | 3,0             | 0,65                      |

### Nguồn giảm trừ (chỉ những nguồn này có tác dụng)

| Nguồn                     | Cơ chế                          | Giá trị theo phẩm (Trắng → Đỏ)                            | Tiêu hao                                                  |
| ------------------------- | ------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| Pháp bảo phòng ngự        | Khiên hấp thụ trước khi trừ máu | Shield = HP_ref × 0,15 / 0,25 / 0,35 / 0,45 / 0,60 / 0,80 | Mất 10% độ bền mỗi đợt; khiên vỡ thì không hồi trong kiếp |
| Trận pháp tiêu hao        | Giảm % mỗi tia                  | R = 10 / 16 / 22 / 28 / 34 / 40%                          | 1 lần nạp trận bàn mỗi đợt; hết lần nạp thì trận tắt      |
| Hộ Mạch Đan               | Hồi máu                         | 20% HP_ref, hồi chiêu 45 s                                | Đan hồi máu thường bị khóa trong Lôi Kiếp                 |
| Công pháp Thể tu          | Giảm % cộng với trận            | +10% (tổng giảm tối đa 50%)                               | —                                                         |
| Đồng đạo hộ pháp          | Chia sát thương                 | Mỗi người nhận 25% của mỗi tia, tối đa 2 người            | Hộ pháp chịu đúng phần đã chia                            |
| Phòng ngự, kháng ngũ hành | Không tác dụng                  | —                                                         | —                                                         |

Điều kiện qua kiếp (D_i là tia thứ i, R_i là mức giảm đang bật):

```latex
\sum_{i} D_i \cdot (1 - R_i) \; - \; \text{Shield} \; - \; \text{Heal} \; < \; HP_{\max}
```

### Ví dụ: Cửu Cửu Thiên Kiếp 81 đạo

HP_ref = 156.733 (Độ Kiếp Viên Mãn); Khí Huyết thực có trang bị +40% = 219.426. Kiếp kéo dài 9 × 12 s + 8 × 8 s = 172 s, đủ cho 4 viên Hộ Mạch Đan.

| Bước                                    | Có trận Vàng (34%)     | Không có trận          |
| --------------------------------------- | ---------------------- | ---------------------- |
| Sát thương thô (3,0 × HP_ref)           | 470.199                | 470.199                |
| Sau trận                                | 310.331                | 470.199                |
| Trừ khiên pháp bảo Vàng (0,60 × HP_ref) | 216.291                | 376.159                |
| Trừ 4 Hộ Mạch Đan (4 × 31.347)          | 90.904                 | 250.772                |
| So với Khí Huyết 219.426                | **Sống, còn ~59% máu** | **Chết** (vượt 31.346) |

Khi người chơi chết giữa kiếp, phần tiến độ kiếp đã qua quyết định mức hậu quả Nhẹ / Trung / Nặng như trong GDD.

## 4. Ma trận Ngũ Hành và công thức sát thương

Khắc hệ cho +25% sát thương và giảm 15% Phòng ngự của mục tiêu khi tính đòn đó; bị khắc thì −15% sát thương; tương sinh không đổi sát thương mà hồi 10% Chân Nguyên khi hỗ trợ đồng đội. Các giá trị này thay cho mức +30% / xuyên 20% trong GDD bản đầu.

### Ma trận hệ số sát thương (hàng = hệ tấn công, cột = hệ phòng thủ)

| Tấn công \ Phòng thủ | Kim             | Mộc             | Thủy            | Hỏa             | Thổ             |
| -------------------- | --------------- | --------------- | --------------- | --------------- | --------------- |
| **Kim**              | 1,00            | **1,25** (khắc) | 1,00 (sinh)     | 0,85 (bị khắc)  | 1,00            |
| **Mộc**              | 0,85 (bị khắc)  | 1,00            | 1,00            | 1,00 (sinh)     | **1,25** (khắc) |
| **Thủy**             | 1,00            | 1,00 (sinh)     | 1,00            | **1,25** (khắc) | 0,85 (bị khắc)  |
| **Hỏa**              | **1,25** (khắc) | 1,00            | 0,85 (bị khắc)  | 1,00            | 1,00 (sinh)     |
| **Thổ**              | 1,00 (sinh)     | 0,85 (bị khắc)  | **1,25** (khắc) | 1,00            | 1,00            |

Khắc: Kim → Mộc → Thổ → Thủy → Hỏa → Kim. Sinh: Kim → Thủy → Mộc → Hỏa → Thổ → Kim. Khi ô là khắc, Phòng ngự của mục tiêu nhân thêm 0,85.

### Tương sinh khi hỗ trợ

- Khi một người hồi máu hoặc buff đồng đội mà hệ của mình sinh ra hệ của đồng đội (ví dụ Thủy buff cho Mộc), đồng đội hồi 10% Chân Nguyên tối đa.
- Hồi chiêu 10 s cho mỗi cặp người nhận; không áp dụng lên chính mình.

### Hệ của mỗi bên

- Hệ tấn công = hệ của kỹ năng đang dùng; đòn đánh thường lấy hệ linh căn chính.
- Hệ phòng thủ = hệ của pháp y nếu pháp y có hệ, nếu không thì linh căn chính (linh căn có tỷ trọng cao nhất).
- Hệ biến dị dùng hàng và cột của hệ gốc: Phong → Mộc, Lôi → Kim, Băng → Thủy.

### Công thức sát thương tổng

```latex
\begin{aligned}
\text{Raw} &= \text{ATK} \cdot c_{\text{skill}} \\
\text{DEF}_{\text{eff}} &= \text{DEF} \cdot D_{\text{elem}} \cdot (1 - \text{Pen}), \qquad D_{\text{elem}} = 0{,}85 \text{ nếu khắc, ngược lại } 1 \\
\text{DMG} &= \frac{\text{Raw}^2}{\text{Raw} + \text{DEF}_{\text{eff}}} \cdot M_{\text{elem}} \cdot \text{Crit} \cdot \text{Suppress} \cdot U(0{,}95;\,1{,}05) \\
\text{Suppress} &= \mathrm{clamp}\big(1 - 0{,}15 \cdot \max(0,\; r_{\text{def}} - r_{\text{atk}}),\; 0{,}4,\; 1\big)
\end{aligned}
```

- Crit mặc định ×1,5; Pen là xuyên giáp từ trang bị, tối đa 0,4.
- Suppress chỉ phạt người cảnh giới thấp đánh người cảnh giới cao (−15% mỗi cảnh giới, sàn 40%); người cảnh giới cao không được cộng thêm.

### Ví dụ (Hóa Thần sơ kỳ, Công 563, mục tiêu Thủ 350, c_skill = 1)

| Trường hợp              | Tính                        | Sát thương | So với trung tính |
| ----------------------- | --------------------------- | ---------- | ----------------- |
| Trung tính              | 563² / (563 + 350)          | 347        | —                 |
| Hỏa đánh Kim (khắc)     | 563² / (563 + 297,5) × 1,25 | 460        | +33%              |
| Hỏa đánh Thủy (bị khắc) | 347 × 0,85                  | 295        | −15%              |

## 5. Linh căn và tốc độ hấp thu linh khí

Tốc độ tu luyện phụ thuộc vào độ thuần của linh căn và mức khớp giữa linh căn với ngũ hành của môi trường. Đơn linh căn nhanh gấp khoảng 3,6 lần Tạp linh căn khi đứng đúng nơi hợp hệ, nhưng chậm hơn cả Tạp linh căn khi đứng sai chỗ; bù lại, Tạp linh căn dùng kỹ năng mọi hệ không bị phạt.

### Công thức

```latex
\begin{aligned}
\text{Match} &= \max\Big(0{,}1,\; 5 \cdot \sum_{e} a_e \, v_e\Big) \qquad (\text{môi trường đều } v_e = 0{,}2 \Rightarrow \text{Match} = 1) \\
\text{Absorb}(s) &= \rho \cdot A_s \cdot P_n \cdot \sqrt{\text{Match}} \quad \text{(tu vi / phút)}, \qquad A_s = 100 \cdot 1{,}25^{\,s-1} \\
\text{Req}(s) &= 1000 \cdot 1{,}35^{\,s-1} \quad \Rightarrow \quad t(s) = \frac{10 \text{ phút} \cdot 1{,}08^{\,s-1}}{\rho \cdot P_n \cdot \sqrt{\text{Match}}}
\end{aligned}
```

- a_e: tỷ trọng linh căn hệ e của người chơi (tổng bằng 1); v_e: tỷ trọng ngũ hành của vùng đất (tổng bằng 1, ghi trong dữ liệu map); s = 1…41 là nấc tu luyện.
- Căn bậc hai làm dịu chênh lệch, để Đơn linh căn đứng sai chỗ vẫn tu được.
- ρ là mật độ linh khí: 1,0 bản đồ thường, 0,6 thành chính, 1 + 0,25 × phẩm khi ngồi trên Linh Mạch phẩm 1–5; Tụ linh trận và bồ đoàn cộng thêm như tài liệu Động Phủ.
- Ở hệ số 1, tổng thời gian tu thuần từ nấc 1 đến 41 khoảng 47 giờ, chưa tính thu thập tài nguyên và kiếp.

### Loại linh căn

| Loại                          | Số hệ | Tỷ lệ khi tạo nhân vật | P_n  | Phạt sát thương khi dùng kỹ năng ngoài hệ |
| ----------------------------- | ----- | ---------------------- | ---- | ----------------------------------------- |
| Đơn linh căn (Thiên linh căn) | 1     | 5%                     | 1,6  | −30%                                      |
| Song linh căn                 | 2     | 20%                    | 1,3  | −15%                                      |
| Tạp linh căn – Tam            | 3     | 35%                    | 1,0  | 0%                                        |
| Tạp linh căn – Tứ             | 4     | 25%                    | 0,85 | 0%                                        |
| Tạp linh căn – Ngũ            | 5     | 15%                    | 0,7  | 0%                                        |

Mỗi lần tạo nhân vật có 2% khả năng một linh căn đổi thành biến dị (Phong, Lôi, Băng), giữ nguyên P_n.

### Ví dụ tại Bí Cảnh Rừng Độc (Mộc 0,5 · Thủy 0,3 · Hỏa 0,2)

| Linh căn                  | Σ aₑvₑ | Match     | Hệ số tốc độ (P_n × √Match) | Tổng giờ tu thuần nếu tu cả 41 nấc ở đây |
| ------------------------- | ------ | --------- | --------------------------- | ---------------------------------------- |
| Đơn Mộc                   | 0,50   | 2,5       | **2,53**                    | ~18,5 giờ                                |
| Song Mộc–Thủy (0,6 / 0,4) | 0,42   | 2,1       | 1,88                        | ~25 giờ                                  |
| Tạp Ngũ (0,2 mỗi hệ)      | 0,20   | 1,0       | 0,70                        | ~67 giờ                                  |
| Tạp Tam Kim–Thổ–Hỏa       | 0,067  | 0,33      | 0,58                        | ~81 giờ                                  |
| Đơn Kim                   | 0      | 0,1 (sàn) | 0,51                        | ~92 giờ                                  |

## 6. Drop Rate Matrix

Quái dã ngoại chủ yếu rơi nguyên liệu và ít Linh thạch; quái tinh anh là nguồn Linh thạch đều đặn; Boss bí cảnh là nguồn chính của Linh thạch thượng phẩm, đan đột phá và bản vẽ pháp bảo phẩm cao, nhưng bị khóa theo tuần. Tỷ lệ dưới đây là mỗi lần hạ quái cùng cảnh giới với người chơi.

### Tỷ lệ rơi (xác suất · số lượng)

| Vật phẩm                             | Quái dã ngoại | Quái tinh anh | Boss bí cảnh   |
| ------------------------------------ | ------------- | ------------- | -------------- |
| Linh thạch hạ phẩm                   | 35% · 1–3     | 100% · 5–12   | 100% · 40–80   |
| Linh thạch trung phẩm (= 100 hạ)     | 0,5% · 1      | 8% · 1        | 100% · 2–5     |
| Linh thạch thượng phẩm (= 10.000 hạ) | —             | 0,1% · 1      | 12% · 1        |
| Đan dược hồi phục                    | 3% · 1        | 15% · 1–2     | 100% · 2–4     |
| Đan đột phá đúng cảnh giới           | 0,02%         | 0,5%          | 6%             |
| Bản vẽ pháp bảo Trắng – Lục          | 0,05%         | 1%            | 15%            |
| Bản vẽ pháp bảo Lam – Tím            | —             | 0,05%         | 3%             |
| Bản vẽ pháp bảo Vàng – Đỏ            | —             | —             | 0,2% (có pity) |
| Nguyên liệu nghề                     | 25% · 1–2     | 60% · 2–4     | 100% · 3–6     |

### Phân bổ phẩm khi đan dược hoặc bản vẽ đã rơi

| Nguồn         | Trắng | Lục | Lam | Tím | Vàng | Đỏ   |
| ------------- | ----- | --- | --- | --- | ---- | ---- |
| Quái dã ngoại | 50%   | 30% | 14% | 5%  | 0,9% | 0,1% |
| Quái tinh anh | 30%   | 35% | 22% | 10% | 2,5% | 0,5% |
| Boss bí cảnh  | 10%   | 25% | 35% | 22% | 7%   | 1%   |

Với bản vẽ, phẩm được roll trong khoảng phẩm của dòng đã trúng ở bảng trên.

### Hệ số điều chỉnh

- **Theo cảnh giới quái:** số lượng Linh thạch nhân 1,5^(r − 1); cấp quái càng cao nguồn tiền càng lớn, khớp với chi phí đột phá tăng dần.
- **Đánh quái thấp:** quái thấp hơn người chơi 1 cảnh giới thì mọi tỷ lệ × 0,2; thấp hơn từ 2 cảnh giới thì chỉ còn nguyên liệu.
- **Linh khí cạn kiệt:** farm liên tục quá 2 giờ trong một vùng thì × 0,5, hồi lại sau 6 giờ.
- **Tổ đội:** mỗi thành viên roll riêng (personal loot) với hệ số 1/√n; đội 4 người mỗi người × 0,5, tổng gấp đôi một người chơi solo, bù lại tốc độ giết nhanh hơn.
- **Boss bí cảnh:** rương thưởng chính 1 lần mỗi tuần cho mỗi boss mỗi người; giết thêm chỉ nhận Linh thạch × 0,3, không có bản vẽ.
- **Pity bản vẽ Vàng – Đỏ:** xác suất lần thứ n là 0,002 × (1 + 0,15n); chắc chắn rơi ở lần thứ 30 nếu chưa có.

### Kỳ vọng Linh thạch (quy ra hạ phẩm, cảnh giới 1)

| Nguồn                     | Kỳ vọng mỗi lần hạ                       | Nhịp điển hình      | Kỳ vọng mỗi giờ |
| ------------------------- | ---------------------------------------- | ------------------- | --------------- |
| Quái dã ngoại             | 0,35 × 2 + 0,005 × 100 = 1,2             | 150 con / giờ       | 180             |
| Quái tinh anh             | 8,5 + 0,08 × 100 + 0,001 × 10.000 = 26,5 | 20 con / giờ        | 530             |
| Boss bí cảnh (rương tuần) | 60 + 3,5 × 100 + 0,12 × 10.000 = 1.610   | 1 lần / tuần / boss | —               |

Các kỳ vọng này là đầu vào để cân kênh tiêu hao ở mục 7, với mục tiêu tỷ lệ tiêu hao / sinh ra 0,9–1,0 mỗi tuần.

## 7. Cơ chế chống lạm phát

Ba kênh tiêu hao chính dưới đây đều tính theo cảnh giới hoặc theo chỉ số giá, nên tự lớn lên cùng nguồn tiền ở mục 6. Mọi Linh thạch thu qua các kênh này bị hủy, không chuyển cho người chơi khác.

### Thuế chợ Vạn Bảo Lâu

```latex
\tau = \mathrm{clamp}\big(0{,}05 + 0{,}5 \cdot \max(0,\; \text{CPI}_w - 1{,}02),\; 0{,}05,\; 0{,}10\big)
```

- Phí niêm yết 1% giá đăng, không hoàn lại (tối thiểu 1 hạ phẩm); thuế bán τ trừ vào tiền người bán nhận.
- CPI_w = giá trung bình tuần này của rổ hàng (đan đột phá, nguyên liệu phổ biến, bản vẽ phẩm thấp) chia cho tuần trước. Ví dụ CPI tăng 8% trong tuần → τ = 0,05 + 0,5 × 0,06 = 8%.
- Giao dịch trực tiếp giữa người chơi chịu thuế cố định 3%.

### Phí truyền tống trận

```latex
\text{Fee} = 20 \cdot 1{,}5^{\,r-1} \cdot (1 + 0{,}5 \cdot d) \quad \text{(Linh thạch hạ phẩm)}
```

r là cảnh giới người chơi, d là số vùng đi qua (0 nếu cùng vùng). Miễn phí 1 lần mỗi ngày về Sơn Môn của mình; chỉ truyền tống được khi ngoài chiến đấu.

| Trường hợp           | Phí   | So với kỳ vọng 1 giờ farm dã ngoại cùng cảnh giới |
| -------------------- | ----- | ------------------------------------------------- |
| Luyện Khí, cùng vùng | 20    | 11%                                               |
| Hóa Thần, qua 2 vùng | 203   | 22%                                               |
| Độ Kiếp, qua 3 vùng  | 1.281 | 28%                                               |

### Hao mòn độ bền trang bị

| Sự kiện             | Mất độ bền (mọi món đang mặc)      |
| ------------------- | ---------------------------------- |
| Chết khi đánh quái  | −8%                                |
| Chết trong PvP      | −4% (thấp hơn để hạn chế quấy phá) |
| Chết trong Lôi Kiếp | −15%                               |
| Chiến đấu liên tục  | −1% mỗi 30 phút                    |
| Ma đạo (K ≤ −700)   | Mọi mức trên × 1,5                 |

```latex
\text{RepairCost} = V_{\text{item}} \cdot 0{,}004 \cdot \Delta\%
```

Sửa 1% độ bền tốn 0,4% giá trị gốc của món đồ (sửa từ 0 lên 100% tốn 40%). Độ bền về 0 thì món đồ mất toàn bộ chỉ số nhưng không bị hủy. Thợ rèn người chơi sửa bằng nguyên liệu cộng 50% phí Linh thạch của NPC, giữ nghề có giá trị mà vẫn có tiêu hao.

### Cơ cấu tiêu hao mục tiêu

| Kênh tiêu hao                                 | Tỷ trọng mục tiêu |
| --------------------------------------------- | ----------------- |
| Đột phá và vật liệu đột phá                   | 35%               |
| Thuế chợ và phí niêm yết                      | 15%               |
| Sửa chữa trang bị                             | 15%               |
| Nạp Hộ Sơn Đại Trận, phí duy trì Linh Mạch    | 15%               |
| Truyền tống                                   | 8%                |
| Phí đổi Linh thạch lên phẩm (5%) và kênh khác | 12%               |

### Vòng điều chỉnh hằng tuần

- Tỷ lệ tiêu hao / sinh ra dưới 0,9 trong 2 tuần liền: nâng sàn τ thêm 1 điểm và nhân phí sửa chữa 1,1.
- Tỷ lệ trên 1,05 trong 2 tuần liền: hạ theo chiều ngược lại.
- Mọi hệ số điều chỉnh nằm trong file dữ liệu, server nạp lại mà không cần bản cập nhật client.

## 8. realm_progression.json

File chứa toàn bộ tham số của mục 1–3: công thức chỉ số, luật đột phá, công thức tu vi và 9 cảnh giới kèm kiếp. Client và server cùng đọc một file; schema viết theo JSON Schema draft 2020-12 để kiểm tra tự động trong CI (ví dụ bằng Ajv) trước khi phát hành.

### Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://data.tutien.game/schema/realm_progression.schema.json",
  "title": "realm_progression",
  "type": "object",
  "required": ["schema_version", "stat_formula", "breakthrough_rules", "cultivation", "realms"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "stat_formula": {
      "type": "object",
      "required": ["alpha", "stats"],
      "additionalProperties": false,
      "properties": {
        "alpha": { "type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 1 },
        "stats": {
          "type": "object",
          "required": ["hp", "mp", "atk", "def", "agi"],
          "additionalProperties": false,
          "properties": {
            "hp": { "$ref": "#/$defs/statParam" },
            "mp": { "$ref": "#/$defs/statParam" },
            "atk": { "$ref": "#/$defs/statParam" },
            "def": { "$ref": "#/$defs/statParam" },
            "agi": { "$ref": "#/$defs/statParam" }
          }
        }
      }
    },
    "breakthrough_rules": {
      "type": "object",
      "required": [
        "min_rate",
        "max_rate",
        "pity_per_fail",
        "pity_cap",
        "max_pills",
        "wrong_realm_pill_factor",
        "karma_penalty_per_1000",
        "quality_multipliers",
        "minor_stage_base",
        "minor_stage_karma_factor"
      ],
      "additionalProperties": false,
      "properties": {
        "min_rate": { "$ref": "#/$defs/ratio" },
        "max_rate": { "$ref": "#/$defs/ratio" },
        "pity_per_fail": { "$ref": "#/$defs/ratio" },
        "pity_cap": { "$ref": "#/$defs/ratio" },
        "max_pills": { "type": "integer", "minimum": 1, "maximum": 5 },
        "wrong_realm_pill_factor": { "$ref": "#/$defs/ratio" },
        "karma_penalty_per_1000": { "$ref": "#/$defs/ratio" },
        "quality_multipliers": {
          "type": "array",
          "items": { "type": "number", "minimum": 0 },
          "minItems": 6,
          "maxItems": 6
        },
        "minor_stage_base": {
          "type": "object",
          "required": ["luyen_khi", "default"],
          "additionalProperties": false,
          "properties": { "luyen_khi": { "$ref": "#/$defs/ratio" }, "default": { "$ref": "#/$defs/ratio" } }
        },
        "minor_stage_karma_factor": { "$ref": "#/$defs/ratio" }
      }
    },
    "cultivation": {
      "type": "object",
      "required": ["req_base", "req_growth", "absorb_base", "absorb_growth"],
      "additionalProperties": false,
      "properties": {
        "req_base": { "type": "number", "exclusiveMinimum": 0 },
        "req_growth": { "type": "number", "exclusiveMinimum": 1 },
        "absorb_base": { "type": "number", "exclusiveMinimum": 0 },
        "absorb_growth": { "type": "number", "exclusiveMinimum": 1 }
      }
    },
    "realms": { "type": "array", "minItems": 7, "items": { "$ref": "#/$defs/realm" } }
  },
  "$defs": {
    "ratio": { "type": "number", "minimum": 0, "maximum": 1 },
    "statParam": {
      "type": "object",
      "required": ["base", "model"],
      "additionalProperties": false,
      "properties": {
        "base": { "type": "number", "exclusiveMinimum": 0 },
        "model": { "enum": ["exponential", "linear"] },
        "lambda": { "type": "number", "exclusiveMinimum": 1 },
        "slope": { "type": "number", "exclusiveMinimum": 0 }
      },
      "if": { "properties": { "model": { "const": "exponential" } } },
      "then": { "required": ["lambda"] },
      "else": { "required": ["slope"] }
    },
    "tribulation": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type": { "enum": ["none", "heart_demon", "heart_demon_multi", "lightning", "lightning_heart_demon"] },
        "strikes": { "type": "integer", "minimum": 1 },
        "waves": { "type": "integer", "minimum": 1, "maximum": 9 },
        "strikes_per_wave": { "type": "integer", "minimum": 1 },
        "kappa": { "type": "number", "exclusiveMinimum": 0 },
        "wave_growth": { "type": "number", "minimum": 1 },
        "strike_interval_s": { "type": "number", "exclusiveMinimum": 0 },
        "wave_interval_s": { "type": "number", "exclusiveMinimum": 0 },
        "durability_loss_on_death": { "$ref": "#/$defs/ratio" }
      },
      "if": { "properties": { "type": { "enum": ["lightning", "lightning_heart_demon"] } } },
      "then": {
        "required": [
          "strikes",
          "waves",
          "strikes_per_wave",
          "kappa",
          "wave_growth",
          "strike_interval_s",
          "wave_interval_s"
        ]
      }
    },
    "realm": {
      "type": "object",
      "required": ["id", "order", "name", "sub_stages", "level_range", "breakthrough"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z_]+$" },
        "order": { "type": "integer", "minimum": 1 },
        "name": { "type": "string", "minLength": 1 },
        "sub_stages": { "type": "integer", "minimum": 1, "maximum": 9 },
        "level_range": { "type": "array", "items": { "type": "integer", "minimum": 1 }, "minItems": 2, "maxItems": 2 },
        "unlocks": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
        "breakthrough": {
          "type": "object",
          "required": ["to", "base_rate", "tribulation"],
          "additionalProperties": false,
          "properties": {
            "to": { "type": "string", "pattern": "^[a-z_]+$" },
            "base_rate": { "$ref": "#/$defs/ratio" },
            "main_pill_ids": { "type": "array", "items": { "type": "string" } },
            "tribulation": { "$ref": "#/$defs/tribulation" }
          }
        }
      }
    }
  }
}
```

### Dữ liệu mẫu đầy đủ

```json
{
  "schema_version": "1.0.0",
  "stat_formula": {
    "alpha": 0.6,
    "stats": {
      "hp": { "base": 1200, "model": "exponential", "lambda": 1.78 },
      "mp": { "base": 400, "model": "exponential", "lambda": 1.7 },
      "atk": { "base": 60, "model": "exponential", "lambda": 1.75 },
      "def": { "base": 40, "model": "exponential", "lambda": 1.72 },
      "agi": { "base": 100, "model": "linear", "slope": 0.15 }
    }
  },
  "breakthrough_rules": {
    "min_rate": 0.05,
    "max_rate": 0.95,
    "pity_per_fail": 0.08,
    "pity_cap": 0.4,
    "max_pills": 3,
    "wrong_realm_pill_factor": 0.3,
    "karma_penalty_per_1000": 0.2,
    "quality_multipliers": [0.6, 0.8, 1.0, 1.2, 1.4, 1.6],
    "minor_stage_base": { "luyen_khi": 0.9, "default": 0.85 },
    "minor_stage_karma_factor": 0.5
  },
  "cultivation": { "req_base": 1000, "req_growth": 1.35, "absorb_base": 100, "absorb_growth": 1.25 },
  "realms": [
    {
      "id": "luyen_khi",
      "order": 1,
      "name": "Luyện Khí",
      "sub_stages": 9,
      "level_range": [1, 30],
      "unlocks": ["linh_can", "khinh_cong", "artifact_slot_1"],
      "breakthrough": {
        "to": "truc_co",
        "base_rate": 0.7,
        "main_pill_ids": ["pill_truc_co"],
        "tribulation": { "type": "none" }
      }
    },
    {
      "id": "truc_co",
      "order": 2,
      "name": "Trúc Cơ",
      "sub_stages": 4,
      "level_range": [31, 50],
      "unlocks": ["fly_low", "divine_sense_50m", "crafting"],
      "breakthrough": {
        "to": "kim_dan",
        "base_rate": 0.55,
        "main_pill_ids": ["pill_ket_kim_dan"],
        "tribulation": { "type": "heart_demon" }
      }
    },
    {
      "id": "kim_dan",
      "order": 3,
      "name": "Kim Đan",
      "sub_stages": 4,
      "level_range": [51, 70],
      "unlocks": ["fly_free", "natal_artifact"],
      "breakthrough": {
        "to": "nguyen_anh",
        "base_rate": 0.45,
        "main_pill_ids": ["pill_ket_anh"],
        "tribulation": {
          "type": "lightning_heart_demon",
          "strikes": 3,
          "waves": 3,
          "strikes_per_wave": 1,
          "kappa": 0.162,
          "wave_growth": 1.22,
          "strike_interval_s": 1.5,
          "wave_interval_s": 8,
          "durability_loss_on_death": 0.15
        }
      }
    },
    {
      "id": "nguyen_anh",
      "order": 4,
      "name": "Nguyên Anh",
      "sub_stages": 4,
      "level_range": [71, 90],
      "unlocks": ["nascent_soul_projection", "blink"],
      "breakthrough": {
        "to": "hoa_than",
        "base_rate": 0.35,
        "main_pill_ids": ["pill_hoa_than"],
        "tribulation": {
          "type": "lightning",
          "strikes": 6,
          "waves": 6,
          "strikes_per_wave": 1,
          "kappa": 0.115,
          "wave_growth": 1.22,
          "strike_interval_s": 1.5,
          "wave_interval_s": 8,
          "durability_loss_on_death": 0.15
        }
      }
    },
    {
      "id": "hoa_than",
      "order": 5,
      "name": "Hóa Thần",
      "sub_stages": 4,
      "level_range": [91, 110],
      "unlocks": ["domain", "upper_realm_access"],
      "breakthrough": {
        "to": "luyen_hu",
        "base_rate": 0.3,
        "main_pill_ids": ["pill_luyen_hu"],
        "tribulation": { "type": "heart_demon_multi" }
      }
    },
    {
      "id": "luyen_hu",
      "order": 6,
      "name": "Luyện Hư",
      "sub_stages": 4,
      "level_range": [111, 130],
      "unlocks": ["combat_clone", "void_portal"],
      "breakthrough": {
        "to": "hop_the",
        "base_rate": 0.25,
        "main_pill_ids": ["pill_hop_the"],
        "tribulation": {
          "type": "lightning",
          "strikes": 9,
          "waves": 9,
          "strikes_per_wave": 1,
          "kappa": 0.0794,
          "wave_growth": 1.22,
          "strike_interval_s": 1.5,
          "wave_interval_s": 8,
          "durability_loss_on_death": 0.15
        }
      }
    },
    {
      "id": "hop_the",
      "order": 7,
      "name": "Hợp Thể",
      "sub_stages": 4,
      "level_range": [131, 150],
      "unlocks": ["dharma_avatar"],
      "breakthrough": {
        "to": "dai_thua",
        "base_rate": 0.2,
        "main_pill_ids": ["pill_dai_thua"],
        "tribulation": {
          "type": "lightning",
          "strikes": 18,
          "waves": 9,
          "strikes_per_wave": 2,
          "kappa": 0.0485,
          "wave_growth": 1.22,
          "strike_interval_s": 1.5,
          "wave_interval_s": 8,
          "durability_loss_on_death": 0.15
        }
      }
    },
    {
      "id": "dai_thua",
      "order": 8,
      "name": "Đại Thừa",
      "sub_stages": 4,
      "level_range": [151, 170],
      "unlocks": ["great_dao_law"],
      "breakthrough": {
        "to": "do_kiep",
        "base_rate": 0.15,
        "main_pill_ids": ["pill_do_kiep"],
        "tribulation": {
          "type": "lightning_heart_demon",
          "strikes": 36,
          "waves": 9,
          "strikes_per_wave": 4,
          "kappa": 0.0287,
          "wave_growth": 1.22,
          "strike_interval_s": 1.5,
          "wave_interval_s": 8,
          "durability_loss_on_death": 0.15
        }
      }
    },
    {
      "id": "do_kiep",
      "order": 9,
      "name": "Độ Kiếp",
      "sub_stages": 4,
      "level_range": [171, 180],
      "unlocks": ["ascension_prep"],
      "breakthrough": {
        "to": "phi_thang",
        "base_rate": 0.1,
        "main_pill_ids": ["pill_cuu_chuyen_kim_dan"],
        "tribulation": {
          "type": "lightning",
          "strikes": 81,
          "waves": 9,
          "strikes_per_wave": 9,
          "kappa": 0.0147,
          "wave_growth": 1.22,
          "strike_interval_s": 1.5,
          "wave_interval_s": 8,
          "durability_loss_on_death": 0.15
        }
      }
    }
  ]
}
```

### Kiểm tra bổ sung ngoài schema (script CI)

- realms[].order liên tục 1…n; breakthrough.to trỏ tới id của cảnh giới kế tiếp (riêng cảnh giới cuối trỏ phi_thang).
- strikes = waves × strikes_per_wave; level_range tăng dần và không chồng nhau.
- Tính lại bảng mục 1 từ tham số, so với bảng giá trị đã duyệt; lệch quá 1% thì chặn build.

## 9. elemental_matrix.json

File chứa tham số của mục 4–5: quan hệ sinh khắc, ma trận hệ số sát thương, hiệu ứng tương sinh, hệ biến dị, loại linh căn và tham số hấp thu linh khí. Ngũ hành của từng vùng đất (v_e) nằm trong dữ liệu map, không nằm ở đây.

### Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://data.tutien.game/schema/elemental_matrix.schema.json",
  "title": "elemental_matrix",
  "type": "object",
  "required": [
    "schema_version",
    "elements",
    "overcomes",
    "generates",
    "damage_matrix",
    "overcome_def_multiplier",
    "generate_support",
    "mutations",
    "mutation_chance",
    "root_types",
    "absorption"
  ],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "elements": {
      "type": "array",
      "items": { "$ref": "#/$defs/element" },
      "minItems": 5,
      "maxItems": 5,
      "uniqueItems": true
    },
    "overcomes": { "$ref": "#/$defs/elementMap", "description": "khóa khắc giá trị" },
    "generates": { "$ref": "#/$defs/elementMap", "description": "khóa sinh ra giá trị" },
    "damage_matrix": {
      "type": "object",
      "description": "hàng = hệ tấn công, cột = hệ phòng thủ",
      "propertyNames": { "$ref": "#/$defs/element" },
      "minProperties": 5,
      "maxProperties": 5,
      "additionalProperties": {
        "type": "object",
        "propertyNames": { "$ref": "#/$defs/element" },
        "minProperties": 5,
        "maxProperties": 5,
        "additionalProperties": { "type": "number", "minimum": 0, "maximum": 2 }
      }
    },
    "overcome_def_multiplier": { "type": "number", "minimum": 0, "maximum": 1 },
    "generate_support": {
      "type": "object",
      "required": ["mp_restore_pct", "cooldown_s", "applies_to_self"],
      "additionalProperties": false,
      "properties": {
        "mp_restore_pct": { "type": "number", "minimum": 0, "maximum": 1 },
        "cooldown_s": { "type": "number", "minimum": 0 },
        "applies_to_self": { "type": "boolean" }
      }
    },
    "mutations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "base"],
        "additionalProperties": false,
        "properties": {
          "id": { "enum": ["phong", "loi", "bang"] },
          "base": { "$ref": "#/$defs/element" }
        }
      },
      "uniqueItems": true
    },
    "mutation_chance": { "type": "number", "minimum": 0, "maximum": 1 },
    "root_types": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "element_count", "spawn_weight", "purity", "off_element_damage_penalty"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z_]+$" },
          "element_count": { "type": "integer", "minimum": 1, "maximum": 5 },
          "spawn_weight": { "type": "number", "minimum": 0, "maximum": 1 },
          "purity": { "type": "number", "exclusiveMinimum": 0 },
          "off_element_damage_penalty": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "absorption": {
      "type": "object",
      "required": ["match_floor", "match_scale", "curve", "density"],
      "additionalProperties": false,
      "properties": {
        "match_floor": { "type": "number", "minimum": 0 },
        "match_scale": { "type": "number", "exclusiveMinimum": 0 },
        "curve": { "enum": ["linear", "sqrt"] },
        "density": {
          "type": "object",
          "required": ["normal", "main_city", "ley_line_base", "ley_line_per_grade"],
          "additionalProperties": false,
          "properties": {
            "normal": { "type": "number", "minimum": 0 },
            "main_city": { "type": "number", "minimum": 0 },
            "ley_line_base": { "type": "number", "minimum": 0 },
            "ley_line_per_grade": { "type": "number", "minimum": 0 }
          }
        }
      }
    }
  },
  "$defs": {
    "element": { "enum": ["kim", "moc", "thuy", "hoa", "tho"] },
    "elementMap": {
      "type": "object",
      "propertyNames": { "$ref": "#/$defs/element" },
      "additionalProperties": { "$ref": "#/$defs/element" },
      "minProperties": 5,
      "maxProperties": 5
    }
  }
}
```

### Dữ liệu mẫu đầy đủ

```json
{
  "schema_version": "1.0.0",
  "elements": ["kim", "moc", "thuy", "hoa", "tho"],
  "overcomes": { "kim": "moc", "moc": "tho", "tho": "thuy", "thuy": "hoa", "hoa": "kim" },
  "generates": { "kim": "thuy", "thuy": "moc", "moc": "hoa", "hoa": "tho", "tho": "kim" },
  "damage_matrix": {
    "kim": { "kim": 1.0, "moc": 1.25, "thuy": 1.0, "hoa": 0.85, "tho": 1.0 },
    "moc": { "kim": 0.85, "moc": 1.0, "thuy": 1.0, "hoa": 1.0, "tho": 1.25 },
    "thuy": { "kim": 1.0, "moc": 1.0, "thuy": 1.0, "hoa": 1.25, "tho": 0.85 },
    "hoa": { "kim": 1.25, "moc": 1.0, "thuy": 0.85, "hoa": 1.0, "tho": 1.0 },
    "tho": { "kim": 1.0, "moc": 0.85, "thuy": 1.25, "hoa": 1.0, "tho": 1.0 }
  },
  "overcome_def_multiplier": 0.85,
  "generate_support": { "mp_restore_pct": 0.1, "cooldown_s": 10, "applies_to_self": false },
  "mutations": [
    { "id": "phong", "base": "moc" },
    { "id": "loi", "base": "kim" },
    { "id": "bang", "base": "thuy" }
  ],
  "mutation_chance": 0.02,
  "root_types": [
    { "id": "don", "element_count": 1, "spawn_weight": 0.05, "purity": 1.6, "off_element_damage_penalty": 0.3 },
    { "id": "song", "element_count": 2, "spawn_weight": 0.2, "purity": 1.3, "off_element_damage_penalty": 0.15 },
    { "id": "tap_tam", "element_count": 3, "spawn_weight": 0.35, "purity": 1.0, "off_element_damage_penalty": 0.0 },
    { "id": "tap_tu", "element_count": 4, "spawn_weight": 0.25, "purity": 0.85, "off_element_damage_penalty": 0.0 },
    { "id": "tap_ngu", "element_count": 5, "spawn_weight": 0.15, "purity": 0.7, "off_element_damage_penalty": 0.0 }
  ],
  "absorption": {
    "match_floor": 0.1,
    "match_scale": 5,
    "curve": "sqrt",
    "density": { "normal": 1.0, "main_city": 0.6, "ley_line_base": 1.0, "ley_line_per_grade": 0.25 }
  }
}
```

### Kiểm tra bổ sung ngoài schema (script CI)

- Với mọi cặp A khắc B: damage_matrix[A][B] = 1,25 và damage_matrix[B][A] = 0,85; mọi ô còn lại bằng 1,00.
- overcomes và generates mỗi bảng tạo thành đúng một vòng 5 hệ, không hệ nào lặp.
- Tổng spawn_weight của root_types bằng 1; element_count không trùng nhau.
