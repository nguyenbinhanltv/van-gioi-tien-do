# PvP & Chiến tranh Tông môn

> **Trạng thái: bản thiết kế đề xuất – chờ duyệt.** Hồ sơ gốc chỉ có khung: phe Chính – Tà – Ma theo Nghiệp Lực (K ∈ [−1000, +1000]) và Đạo Tâm, "chiến tranh Linh Mạch với Hộ Sơn Đại Trận", băng thông chiến tranh ~25 KB/s ([01-gdd.md](01-gdd.md) §5, [00-ho-so-tong-hop.md](00-ho-so-tong-hop.md) §3). Hồ sơ **không** có luật PvP, đấu trường hay lịch chiến tranh ([OPEN-ITEMS.md](OPEN-ITEMS.md) §3). Mọi con số mới là _Đề xuất – chờ duyệt_; số đã có hiệu lực được trích từ [07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md) và [08-server-architecture.md](08-server-architecture.md).

## 1. Nguyên tắc

1. **Cảnh giới quyết định** (07 §1): luật PvP không được tạo con đường vượt cảnh giới bằng tiền hoặc tổ đội đông.
2. **Có thể chơi cả đời không PvP.** PvP bắt buộc không nằm trên đường chủ tuyến; chỉ vùng PK, đấu trường và chiến tranh có PvP.
3. **PvP phải có giá, nhưng giá không làm người chơi bỏ game.** Độ bền mất ít hơn khi chết PvP (−4%, so với −8% khi chết đánh quái; 07 §7) "để hạn chế quấy phá".
4. **Mọi thứ do server quyết định** (08 §4–6): client chỉ gửi ý định; sát thương, hồi chiêu, trúng đòn, kết quả trận đều ở World Node.
5. **Kẻ mạnh bắt nạt kẻ yếu phải tốn nghiệp**, bắt nạt có hệ thống thì bị hệ thống chặn (§6).

## 2. Vùng và luật PvP

Lớp dữ liệu **Zone** của tilemap ([04-tilemap.md](04-tilemap.md) §4) có 4 giá trị: **An toàn / PK / bí cảnh / sự kiện**. Luật dưới đây gắn vào từng giá trị; mỗi bản đồ có thể ghi đè bằng cờ `pvp` trong dữ liệu map.

| Zone        | PvP tự do?                              | Nghiệp Lực khi giết                | Chết PvP mất gì                                       | Truyền tống / hồi sinh                                                       | Ví dụ                                                                          |
| ----------- | --------------------------------------- | ---------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **An toàn** | Không (chỉ tỷ thí hai bên đồng ý, §4.4) | Không                              | Không                                                 | Hồi sinh tại chỗ; được truyền tống                                           | Sơn Môn Đại Phái, chợ, Động Phủ                                                |
| **PK**      | Có, theo giới hạn §6.1                  | Theo bảng §3.3                     | Độ bền −4% (07 §7); rơi đồ theo phe (§3.4)            | Hồi sinh ở điểm hồi sinh PK, bất tử 5 s; **cấm truyền tống khi có cờ chiến** | Vùng PK ngoài sơn môn                                                          |
| **Bí cảnh** | Theo cờ `pvp` của từng map              | Như PK nếu `pvp = true`            | Như PK nếu `pvp = true`; khi `pvp = false` chỉ có PvE | Chỉ vào / ra qua cổng; khóa theo tuần cho rương Boss (07 §6)                 | Bí Cảnh Rừng Độc (`pvp = true`, theo 04 §5 "bản đồ PK")                        |
| **Sự kiện** | Do cấu hình sự kiện                     | Theo cấu hình (thường không đổi K) | Theo cấu hình (thường không mất)                      | Theo cấu hình                                                                | Sự kiện đấu trường mùa ([15-kiem-tien-liveops.md](15-kiem-tien-liveops.md) §5) |

Zone tách cả **tính PvP** khỏi **tính nguy hiểm**: một vùng An toàn vẫn có quái (PvE), nhưng người chơi không thể gây sát thương cho nhau.

### 2.1 Cờ chiến

| Cờ                 | Điều kiện                                            | Hiệu lực                                                                      |
| ------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Gây hấn** (đỏ)   | Tấn công người chơi không có cờ trong vùng PK        | 60 s kể từ đòn cuối; giết người có cờ này **không** trừ Nghiệp                |
| **Phòng vệ** (cam) | Bị người khác tấn công trước                         | Phản kháng không bị coi là gây hấn                                            |
| **Truy nã**        | K ≤ −700 (Ma đạo) hoặc giết liên tục (§6.2)          | Giết người truy nã cộng nghiệp (§3.3); hiển thị trên bản đồ nhỏ trong vùng PK |
| **Chiến tranh**    | Thuộc bên tham chiến trong instance chiến tranh (§5) | PvP giữa hai bên không đổi K; ngoài hai bên vẫn bị cấm                        |

Cờ do server giữ; client chỉ hiển thị vòng chọn mục tiêu có màu ở lớp L1 ([02-asset-matrix-2d.md](02-asset-matrix-2d.md) layer L1 "vòng chọn mục tiêu") và tên đổi màu ở L6.

## 3. Nghiệp Lực & phe phái

### 3.1 Giá trị đã có hiệu lực

| Nội dung                             | Giá trị                                                                                          | Nguồn                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------- |
| Phạm vi K                            | −1000 đến +1000                                                                                  | 07 §2                     |
| Phạt tỷ lệ đột phá                   | Karma_Penalty = 0,20 × max(0, −K) / 1000 (tiểu cảnh: một nửa); nghiệp thiện **không** cộng tỷ lệ | 07 §2                     |
| Ma đạo                               | K ≤ −700: mất 14–20 điểm phần trăm; mọi mức mất độ bền × 1,5                                     | 07 §2, §7                 |
| Độ bền khi chết                      | PvP −4%; đánh quái −8%; Lôi Kiếp −15%                                                            | 07 §7                     |
| Suppress (người thấp đánh người cao) | −15% mỗi cảnh giới chênh, sàn 40%; người cao không được cộng                                     | 07 §4                     |
| Rơi đồ theo nghiệp                   | Có, chưa có số liệu                                                                              | [01-gdd.md](01-gdd.md) §5 |

### 3.2 Ngưỡng phe (Đề xuất – chờ duyệt)

| Phe                    | Khoảng K    | Ghi chú                                                                                            |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| **Chính đạo**          | K ≥ +300    | Được vào khu Chính đạo; lợi thế nằm ở thẩm mỹ, nhiệm vụ, dịch vụ (07 §2: không cộng tỷ lệ đột phá) |
| **Tán tu** (trung lập) | −299 … +299 | Mặc định khi tạo nhân vật (K = 0)                                                                  |
| **Tà đạo**             | −699 … −300 | Bị phạt đột phá 0,20 × 300 / 1000 = 6 điểm phần trăm trở lên (cùng công thức)                      |
| **Ma đạo**             | K ≤ −700    | Ngưỡng có sẵn của 07; phạt tỷ lệ 14 điểm trở lên, độ bền × 1,5                                     |

Chuyển ngưỡng không tạo hiệu ứng mạnh ngoài những gì 07 đã định; ngưỡng ±300 chỉ để gán danh hiệu, màu tên và mở nhiệm vụ nhân quả ([12](12-nhiem-vu-cot-truyen.md) §3.4). Phe có thể gắn với hệ phái trong [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md).

### 3.3 Biến động Nghiệp khi PvP (Đề xuất – chờ duyệt)

| Hành vi                                               | ΔK                             | Ghi chú                                    |
| ----------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| Giết người **không cờ**, chênh cảnh giới ≤ 1          | −50                            | Trong vùng PK                              |
| Giết người **không cờ**, thấp hơn ≥ 2 cảnh giới       | −120                           | Đây là hành vi bị khuyến cáo chặn ở §6.1   |
| Giết người **có cờ Gây hấn** hoặc **Truy nã**         | +10 (tối đa +100 mỗi ngày)     | Chặn cày nghiệp thiện                      |
| Giết người cùng một nạn nhân lần thứ 3 trong 1 giờ    | −50 thêm, không có phần thưởng | Chống canh xác (§6.2)                      |
| Giết người trong chiến tranh, giữa hai bên tham chiến | 0                              | Chiến tranh là hợp lệ                      |
| Giết người ngoài chiến tranh nhưng ở trong instance   | −50                            | Người tham chiến chỉ được tấn công bên kia |

Tổng tăng K do PvP mỗi ngày tối đa +100; tổng giảm không giới hạn (nhưng dưới −1000 bị kẹp). Suy giảm nghiệp theo thời gian **không** có; muốn kéo K về 0 phải làm nhiệm vụ nhân quả (tối đa +100 mỗi tuần, [12](12-nhiem-vu-cot-truyen.md) §3.4).

### 3.4 Rơi đồ theo nghiệp (Đề xuất – chờ duyệt)

Chỉ áp dụng cho người **chết trong vùng PK / bí cảnh có `pvp = true`**:

| Phe người chết | Xác suất rơi 1 món không khóa trong túi (không phải đồ đang mặc) | Nơi nhận                                 |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| Chính / Tán tu | 0%                                                               | —                                        |
| Tà đạo         | 10%                                                              | Kẻ giết, trong 60 s, qua Economy Service |
| Ma đạo         | 25%                                                              | Kẻ giết, trong 60 s                      |

Rơi đồ là **chuyển quyền sở hữu**, không phải tạo mới, nên đi qua Economy Service với khóa idempotency (08 §7); sổ cái kép giữ cân bằng và không tạo nguồn faucet. Không bao giờ rơi Linh thạch trong người (Linh thạch chỉ chuyển qua giao dịch hợp lệ).

## 4. Đấu trường & xếp hạng

### 4.1 Đấu trường (Luận Kiếm Đài – tên đề xuất)

| Chế độ               | Số người | Giai đoạn                                                                          |
| -------------------- | -------- | ---------------------------------------------------------------------------------- |
| **Luận Kiếm 1v1**    | 1 vs 1   | MVP                                                                                |
| **Tam Tài Trận 3v3** | 3 vs 3   | Sau MVP (khi có thanh khoảng cách và kỹ năng hỗ trợ ở [11](11-he-phai-ky-nang.md)) |
| Đồng đạo chiến 5v5   | 5 vs 5   | Tùy chọn mùa sau                                                                   |

- **Instance theo yêu cầu**, một World Node đơn luồng chạy 20 Hz, tự hủy sau 5 phút không còn ai (08 §7 "Vận hành").
- **Phân nhóm theo cảnh giới lớn** (r = 1…9): chỉ gặp người cùng cảnh giới.
- **Chuẩn hóa chỉ số:** coi mọi người ở **Viên Mãn** của cảnh giới (x = r − 1 + 0,6 · (K − 1)/K ở nấc cuối; bảng 07 §1) và **trang bị chỉ tính tối đa +30%** (thay vì 60%) — gần mức trung bình của một người chơi bình thường — để chênh lệch trang bị không áp đảo. Linh căn, kỹ năng, Ngũ hành (07 §4–5) vẫn đầy đủ.
- **Cấm** đan hồi phục và phù hồi thường; chỉ dùng vật phẩm hệ thống cấp (kéo theo [13](13-che-tao.md) §8).
- **Chất lượng mạng:** ngưỡng RTT cho xếp hạng trùng ngưỡng cảnh báo mạng của 08 §5: RTT > 250 ms (PC) / > 300 ms hoặc mất gói > 5% (Mobile / Web) nhắc đổi mạng trước khi vào hàng.
- **Mất kết nối:** 10 s tự nối lại theo 08 §7, tổng cộng đợi tối đa 30 s (_Đề xuất_) rồi tính thua nếu chưa quay lại.

### 4.2 Xếp hạng

| Nội dung         | Đề xuất                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hệ điểm          | Điểm Đạo (kiểu Elo, hệ số K = 32), 10 trận xếp hạng ban đầu                                                                                                       |
| Mùa              | 8 tuần, cùng nhịp với mùa Battle Pass ([15](15-kiem-tien-liveops.md) §4); ảnh chụp bảng xếp hạng mỗi ngày (Redis sorted set + ảnh chụp PostgreSQL theo 08 §7)     |
| Hạng             | Đồng, Bạc, Vàng, Bạch Kim, Kim Cương, Tinh Hà (tên tạm; không trùng thang phẩm 6 màu để khỏi nhầm phẩm chất)                                                      |
| Phần thưởng      | **Thẩm mỹ** (danh hiệu, khung avatar, pháp y thẩm mỹ), Cống hiến, nguyên liệu tinh luyện giới hạn theo tuần; **không** có Linh thạch đáng kể, đan đột phá, bản vẽ |
| Bảo vệ hạng      | Hạng không rớt quá 1 bậc mỗi tuần (giảm cảm giác bị phạt)                                                                                                         |
| Matchmaking      | Cùng cảnh giới, ±200 điểm, nới 50 điểm mỗi 15 s chờ, sau 90 s nới tối đa ±600                                                                                     |
| Chống thông đồng | Cùng cặp đối thủ chỉ tính điểm tối đa 3 lần mỗi ngày; cờ khi tỷ lệ thắng hai chiều bất thường                                                                     |

### 4.3 Chơi chéo (cross-play) công bằng

Cùng một hàng chờ cho PC / Web / Mobile, vì server không biết thiết bị khi tính sát thương (08 §4–5). Chênh lệch do cách nhập được kiểm soát bằng:

- Mọi đòn trúng do server tính trên cùng hitbox (hurtbox r 0,45 ô, [03-nhan-vat-quai-vat.md](03-nhan-vat-quai-vat.md)), không phụ thuộc cách nhắm.
- "Chạm nhanh = tự nhắm mục tiêu gần nhất" ([05](05-ui-ux-icon.md) §3) chỉ áp dụng kỹ năng nhắm mục tiêu; không cho tự nhắm có ưu thế đặc biệt trong đấu trường (cùng tầm, cùng độ chính xác với PC).
- Đo tỷ lệ thắng theo chế độ nhập ([17](17-telemetry-kpi.md) §4); nếu chênh quá 5 điểm phần trăm trên mẫu đủ lớn, mở hàng chờ riêng theo chế độ nhập.

### 4.4 Tỷ thí (duel) ở khu An toàn

Hai người đồng ý → một vùng tỷ thí tạm thời (vòng tròn L1), không đổi Nghiệp, không mất độ bền, không rơi đồ; kết thúc khi ra khỏi vùng hoặc một bên còn 1 HP (dừng đòn). Mỗi cặp chỉ tỷ thí 1 lần mỗi 10 phút để tránh quấy rối bằng lời mời liên tục.

## 5. Chiến tranh Linh Mạch

### 5.1 Khái niệm

| Thuật ngữ           | Ý nghĩa                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Linh Mạch**       | Điểm linh khí có phẩm 1–5; tại đó mật độ linh khí ρ = 1 + 0,25 × phẩm khi ngồi trên Linh Mạch (07 §5)      |
| **Hộ Sơn Đại Trận** | Trận pháp phòng thủ của tông môn sở hữu Linh Mạch; có **Trận Lực** và **3 Trận Nhãn**; nạp bằng Linh thạch |
| **Linh Mạch Tâm**   | Điểm trung tâm; bên tấn công phải giữ nó liên tục khi đủ điều kiện                                         |
| **Tuyên chiến**     | Đăng ký đánh một Linh Mạch trong tuần                                                                      |

Mỗi Linh Mạch chỉ thuộc **một** tông môn; có thể chưa có chủ (vô chủ) hoặc có chủ. Quyền lợi chiếm hữu trong MVP chỉ là **mật độ linh khí ρ** cho tu luyện tại chỗ (đúng công thức 07 §5), tên tông môn trên bản đồ và vật trang trí; **không** có dòng Linh thạch nhận thụ động, để không tạo faucet ngoài kế hoạch (xem câu hỏi Q5).

### 5.2 Lịch hằng tuần (Đề xuất – chờ duyệt)

Mọi giờ là UTC+7 (`Asia/Ho_Chi_Minh`, không có giờ mùa hè).

| Khung                   | Sự kiện                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Thứ Hai 05:00           | Mở tuyên chiến: tông môn đủ điều kiện (§5.3) đăng ký đánh 1 Linh Mạch                        |
| Thứ Năm 23:59           | Đóng tuyên chiến; hệ thống công bố đối đầu                                                   |
| Thứ Sáu                 | Hai bên nộp danh sách tham chiến (tối đa 100 + 20 dự bị); phòng thủ nạp Hộ Sơn Đại Trận      |
| **Thứ Bảy 20:00–21:30** | **Cửa sổ chiến tranh** (90 phút): chuẩn bị 10 phút → công trận 60 phút → quyết chiến 20 phút |
| Chủ nhật 05:00          | Quyết toán, trả thưởng, mở lại bảng Linh Mạch                                                |

Giờ Thứ Bảy 20:00 là mặc định cho cả server; các máy chủ khác (nếu có) có thể lệch (câu hỏi Q4).

### 5.3 Điều kiện tuyên chiến

- Tông môn tấn công có **≥ 20 thành viên hoạt động** trong 7 ngày (_Đề xuất_).
- Mỗi tông môn **tuyên chiến tối đa 1 Linh Mạch mỗi tuần**; mỗi Linh Mạch **chỉ bị đánh tối đa 1 lần mỗi tuần**.
- Sau khi đổi chủ, Linh Mạch được **miễn nhiễm 72 giờ**, chống đánh liên tiếp.
- Đặt cọc Linh thạch khi tuyên chiến; 30% cọc bị hủy (sink), phần còn lại trả khi chiến tranh kết thúc đúng luật.

### 5.4 Diễn biến một trận

| Giai đoạn       | Thời lượng | Luật                                                                                                                                                                       |
| --------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chuẩn bị**    | 10 phút    | Không giao tranh. Phòng thủ bố trí và nạp trận; tấn công tập kết ở khu xuất phát; cấm truyền tống ngoài chiến trận                                                         |
| **Công trận**   | 60 phút    | Tấn công phá **3 Trận Nhãn** (mỗi cái có thanh Trận Lực, phải giữ điểm 90 s để trận tắt). Mỗi Trận Nhãn tắt làm Hộ Sơn Đại Trận yếu đi một nấc (xem số khởi điểm bên dưới) |
| **Quyết chiến** | 20 phút    | Chỉ khi có ≥ 2 Trận Nhãn đã tắt, bên tấn công mở **Linh Mạch Tâm**; giữ liên tục 5 phút trước 21:30 thì thắng; nếu không, phòng thủ giữ                                    |
| **Quyết toán**  | Tức thời   | Server ghi kết quả; đổi chủ Linh Mạch; trả thưởng thẩm mỹ và Cống hiến                                                                                                     |

**Hộ Sơn Đại Trận (số khởi điểm, Đề xuất – chờ duyệt):** khi còn ≥ 1 Trận Nhãn sáng, mọi người của bên phòng thủ trong bán kính trận nhận **giảm 15% sát thương** từ bên tấn công; mỗi Trận Nhãn tắt giảm mức này đi 5 điểm phần trăm (mốc 15 → 10 → 5 → 0). Đây là số **phẳng** nhằm không tạo thêm cấu trúc chỉ số riêng; Trận Lực của mỗi Trận Nhãn tính bằng **số đòn chuẩn** (tương đương số đòn hạ gục cùng cảnh giới ~33–36 đòn theo 07 §1) × số người tham chiến, và đặt trong `war_config.json` (đề xuất). Hiệu ứng dùng sprite instancing như Vạn Kiếm và shader Kim Quang Hộ Thể ([06-toi-uu-render.md](06-toi-uu-render.md)); VFX đã có trong ngân sách hạt (≤ 1.000 Web/Mobile).

### 5.5 Luật tham chiến

| Mục          | Quy định                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Quân số      | Mỗi bên ≤ 100 người cùng lúc; dự bị tối đa 20 để thay thế người ngắt kết nối (ngưỡng 100 vs 100 khớp 08 §8)                     |
| Hiển thị     | Mỗi client thấy tối đa **120 thực thể** gần nhất theo ưu tiên: đồng đội gần, mục tiêu đang chọn, kẻ địch gần (trần AOI ở 08 §8) |
| Hồi sinh     | Tại chiến trướng sau **15 s**; bất tử 3 s; hồi sinh ở nơi khác cấm                                                              |
| Độ bền       | Mỗi lần chết −4% (07 §7), **tính tối đa 5 lần chết mỗi người mỗi trận** (_Đề xuất_) để không bị kiệt túi khi tham gia           |
| Nghiệp       | Giết đối thủ trong trận không đổi K (§3.3); giết người ngoài hai bên bị −50                                                     |
| Đan / phù    | Đan hồi phục cùng hồi chiêu chung 30 s trong chiến trận (_Đề xuất_); không dùng được truyền tống                                |
| Rơi đồ       | **Không** rơi đồ trong chiến tranh (khác vùng PK §3.4)                                                                          |
| Kết thúc sớm | Phòng thủ có thể bỏ chạy: nếu toàn bộ Trận Nhãn tắt và Linh Mạch Tâm bị giữ đủ 5 phút thì thắng sớm                             |

### 5.6 Kinh tế chiến tranh

| Khoản                           | Đề xuất                                                                                                                                                                       | Kênh trong cơ cấu mục tiêu (07 §7)               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Nạp Hộ Sơn Đại Trận             | Linh thạch tông môn đóng góp; mỗi Trận Nhãn nạp theo cảnh giới tông môn                                                                                                       | "Nạp Hộ Sơn Đại Trận, phí duy trì Linh Mạch" 15% |
| Phí duy trì Linh Mạch hằng tuần | F_g = F₀ · 2^(g − 1) · 1,5^(r_tông − 1) (Linh thạch hạ phẩm); **F₀ = 10.000** ≈ 3% thu nhập tuần của tông môn 50 người (≈ 50 × 10 giờ × (180 + 530) = 355.000 ở r = 1; 07 §6) | cùng kênh                                        |
| Cọc tuyên chiến                 | Mức theo phẩm Linh Mạch; 30% hủy                                                                                                                                              | cùng kênh                                        |
| Sửa chữa sau chiến              | Độ bền (−4% mỗi lần chết) → `RepairCost` ở 07 §7                                                                                                                              | "Sửa chữa trang bị" 15%                          |

Mục tiêu: nhóm "Hộ Sơn Đại Trận + Linh Mạch" chiếm 15% tổng tiêu hao; số F₀ và cọc phải kiểm lại bằng mô phỏng kinh tế (OPEN-ITEMS #7).

## 6. Chống quấy phá (anti-griefing)

### 6.1 Chặn từ luật

- **Bảo hộ tân thủ:** người chơi đang ở Luyện Khí **không bị tấn công** trong vùng PK trừ khi họ có cờ Gây hấn hoặc Phòng vệ; vùng bí cảnh có `pvp = true` là ngoại lệ vì ngưỡng vào của map.
- **Bảo hộ chênh lệch:** trong vùng PK, **không thể gây sát thương cho người thấp hơn ≥ 2 cảnh giới** trừ khi đối phương có cờ Gây hấn / Truy nã. Bù cho công thức Suppress (07 §4) chỉ phạt phía yếu đánh phía mạnh.
- **Không có va chạm cứng người – người** (08 §4): không thể chặn đường nhau; kẻ đứng chắn không tạo tường.
- **Hồi sinh có bất tử 5 s** ở PK; điểm hồi sinh luân phiên giữa 2–3 vị trí cách xa nhau.

### 6.2 Chống canh xác & săn đuổi

| Hành vi                               | Biện pháp                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Giết lại cùng nạn nhân trong 1 giờ    | Lần 1–2 bình thường; từ lần 3: −50 K thêm, không phần thưởng, nạn nhân miễn mất độ bền                              |
| Chuỗi 5 người liên tiếp trong 10 phút | Gắn **Truy nã** 30 phút                                                                                             |
| Canh cổng bí cảnh / điểm hồi sinh     | Người vừa hồi sinh có vùng bảo vệ 5 s; điểm hồi sinh luân phiên; vùng quanh cổng vào có bán kính 6 ô là vùng cấm PK |
| Quấy rối bằng chat / link             | Kênh Chat có token bucket, lọc từ, chặn / báo cáo (08 §7)                                                           |
| Phá phách bằng quái kéo (train)       | Quái đuổi theo quá 40 ô thì về điểm sinh và hồi đầy máu; không đẩy quái sang người khác                             |

### 6.3 Báo cáo & xử lý

- Nút **Báo cáo** trên khung mục tiêu (PC và Mobile) gửi 60 s log chiến đấu gần nhất kèm ảnh chụp trạng thái server.
- Điểm vi phạm xã hội (khác điểm nghi vấn gian lận ở 08 §6): hành vi giết liên tục, quấy rối được cộng điểm và áp **thời gian chờ hồi sinh dài hơn** trước khi đến mức chặn PvP tạm thời; **không tự động cấm tài khoản** chỉ dựa trên một chỉ số (cùng nguyên tắc 08 §6).

## 7. Quyền hạn máy chủ & anti-cheat trong PvP

Đây không thêm cơ chế mới mà nhắc lại các ràng buộc của 08:

| Vấn đề                           | Cách giữ                                                                                                        | Tham chiếu     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| Vị trí, tốc độ                   | Client gửi ý định; server tính và đối soát; speedhack bị ngân sách thời gian chặn                               | 08 §4, §6      |
| Hồi chiêu, tần số thi triển      | `readyAt` do server giữ; token bucket 10 gói/giây                                                               | 08 §6          |
| Trúng đòn nhắm tức thời          | Server tua mục tiêu lùi tối đa 200 ms (lag compensation); kỹ năng vùng không tua                                | 08 §5          |
| Sát thương, rơi đồ, độ bền       | Mọi phép tính ở server; rơi đồ PvP chuyển qua Economy                                                           | 08 §6–7, 07 §7 |
| Kết quả đấu trường / chiến tranh | Ghi vào Economy với khóa idempotency, kèm log RNG và nhật ký trận; có thể xem lại khi khiếu nại                 | 08 §7, 07 §2   |
| Băng thông chiến tranh           | Snapshot 20 / 10 / 5 Hz theo vùng; số sát thương gộp mỗi 100 ms; mục tiêu ~25 KB/s                              | 08 §8          |
| Điểm nghi vấn                    | +1 mỗi vi phạm, giảm 1 mỗi phút; 20 cảnh báo, 50 ngắt kết nối; 3 lần ngắt trong 24 giờ chuyển kiểm tra thủ công | 08 §6          |

Instance chiến tranh là một **World Node chuyên dụng**. Kiểm chứng tải thật (100 vs 100) thuộc OPEN-ITEMS #6; tài liệu này không khẳng định CPU hay băng thông ngoài các con số của 08.

## Câu hỏi cần chốt

Đã gộp vào [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md), nguồn duy nhất của câu hỏi mở: cột "Câu hỏi" ở đó ghi ID nguồn đã gộp (14 Q1–Q9). Nội dung gốc của mục này nằm trong lịch sử git.
