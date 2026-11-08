# Kiếm tiền & LiveOps

> **Trạng thái: bản thiết kế đề xuất – chờ duyệt.** Hồ sơ gốc chỉ nêu ba loại tiền (Linh thạch 3 phẩm, **Tiên Ngọc**, **Cống hiến**), chợ Vạn Bảo Lâu, Đấu Giá Hội và mục tiêu tiêu hao / sinh ra 0,9–1,0 mỗi tuần ([01-gdd.md](01-gdd.md) §6). Hồ sơ **không** có cửa hàng, Battle Pass hay lịch sự kiện ([OPEN-ITEMS.md](OPEN-ITEMS.md) §3). Giá và con số mới là _Đề xuất – chờ duyệt_; số đã có hiệu lực trích từ [07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md) / `@vgtd/shared`. Các điều khoản pháp lý liên quan (thanh toán, trẻ vị thành niên, hộp ngẫu nhiên) ở [19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md) và **phải được luật sư kiểm tra**.

## 1. Nguyên tắc

1. **Cảnh giới không bao giờ bán được.** Đây là điều kiện tồn tại của toàn bộ cân bằng ở 07 §1 (chỉ số tăng theo cảnh giới; trang bị tối đa +60%). Mọi thứ trong cửa hàng phải qua phép thử: _"nếu một người trả tiền và người kia không, ai thắng PvP hoặc đột phá nhanh hơn?"_ — câu trả lời phải là "không ai".
2. **Tiền thật không đổi sang Linh thạch.** Linh thạch là đơn vị trao đổi của nền kinh tế người chơi; chặn đường này là cách chính để tránh lạm phát do tiền thật và chợ đen (RMT) (§6).
3. **Thu nhập đến từ thẩm mỹ, tiện lợi nhẹ và thời gian, không từ xác suất.** Tỷ lệ đột phá (07 §2) và bảng rơi đồ (07 §6) là bất khả xâm phạm.
4. **Hai nền tảng thanh toán, một sổ cái.** Web, iOS, Android, PC khác nhau về cổng thanh toán nhưng mọi Tiên Ngọc đi qua Economy Service với sổ cái kép (08 §7).
5. **Minh bạch:** hiển thị giá, quy đổi, tỷ lệ (nếu có ngẫu nhiên) và ngày hết hạn ngay trên giao diện; có hạn mức chi tiêu cho người chơi vị thành niên (xem [19](19-ngon-ngu-phap-ly.md)).

## 2. Ba loại tiền & hàng hóa

| Tiền                                                                         | Kiếm bằng                                                                 | Tiêu vào                                                          | Giao dịch giữa người chơi?                                 | Ghi chú                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Linh thạch** (hạ / trung / thượng; 1 trung = 100 hạ, 1 thượng = 10.000 hạ) | Săn quái, nhiệm vụ, bán chợ (07 §6)                                       | Đột phá, sửa chữa, truyền tống, thuế chợ, Hộ Sơn Đại Trận (07 §7) | **Có** (thuế 3% trực tiếp; chợ có phí niêm yết + thuế bán) | Đổi lên phẩm có phí 5% (kênh khác, 07 §7). **Không** mua được bằng Tiên Ngọc |
| **Tiên Ngọc**                                                                | Nạp tiền; một lượng nhỏ từ Battle Pass track miễn phí và thành tựu (§4.3) | Cửa hàng thẩm mỹ / tiện lợi, Battle Pass, Nguyệt Lệnh             | **Không** (khóa tài khoản)                                 | Đơn chiều: vào hệ thống rồi mất, không quay lại thành Linh thạch             |
| **Cống hiến**                                                                | Nhiệm vụ tông môn, đóng góp kho tông môn, chiến tranh Linh Mạch           | Cửa hàng tông môn (công pháp tông môn, vật phẩm tông môn)         | **Không**                                                  | Đo đóng góp, không phải tiền chợ                                             |

Ví dụ ràng buộc: người chơi có thể bán trang phục **rơi trong game** (không do Tiên Ngọc mua) lấy Linh thạch trên chợ; trang phục mua bằng Tiên Ngọc thì **bị khóa** (không bán), để Tiên Ngọc không thể "rút" thành Linh thạch.

## 3. Những thứ không bao giờ bán (luật công bằng)

Danh sách này là **cam kết sản phẩm**. Mọi mục cửa hàng mới phải được đối chiếu với bảng trước khi lên lịch. Sự thay đổi danh sách cần một dòng mới trong [DECISIONS.md](DECISIONS.md).

| #   | Không bán                                                                                    | Vì sao (liên kết với công thức)                                                                                                       |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Đan đột phá** (chủ đan / phụ đan) và nguyên liệu độc quyền để chế chúng                    | Đan nhân vào Base (07 §2); bán đan = bán thời gian tu luyện; nguồn đan phải đến từ rơi đồ và chế tạo ([13-che-tao.md](13-che-tao.md)) |
| 2   | **Điều chỉnh tỷ lệ đột phá**: tăng Base, xóa pity, hồi pity, bảo hiểm thất bại, cộng tỷ lệ   | Công thức clamp 5–95% do server quyết (07 §2); bất kỳ bán xác suất nào đều phá cam kết "không bán sức mạnh"                           |
| 3   | **Xóa / điều chỉnh Nghiệp Lực** (reset K, mua nghiệp thiện)                                  | K tác động phạt đột phá và rơi đồ ([14](14-pvp-chien-tranh.md) §3); bán xóa nghiệp biến PvP thành hợp thức hóa hung bạo               |
| 4   | **Bản vẽ và đan phương** phẩm Lam trở lên                                                    | Boss bí cảnh là nguồn chính, có pity (07 §6)                                                                                          |
| 5   | **Linh thạch** trực tiếp, hoặc đổi Tiên Ngọc → Linh thạch                                    | Chống lạm phát và RMT (§6)                                                                                                            |
| 6   | **Nguồn giảm trừ Lôi Kiếp**: khiên pháp bảo, trận bàn, Hộ Mạch Đan (07 §3)                   | Cho phép trả tiền để qua kiếp từ 9 đạo trở lên là bán đột phá                                                                         |
| 7   | **Linh căn**: đổi, nâng cấp, chọn loại (07 §5, tỷ lệ tạo nhân vật 5 / 20 / 35 / 25 / 15%)    | P_n quyết định tốc độ tu luyện; không bán thay đổi bản chất nhân vật                                                                  |
| 8   | **Tăng tốc tu vi** vượt mức nền: bình nước tăng ρ, nhân đôi tu vi, "tọa quan" mua bằng tiền  | Mức thu tu vi do mật độ ρ và Match quyết (07 §5); Động Phủ có Tụ linh trận và bồ đoàn đạt bằng chơi game                              |
| 9   | **Tăng tỷ lệ rơi**, khóa boss tuần, xóa linh khí cạn kiệt (07 §6)                            | Bảng rơi là nguồn faucet chính; điều chỉnh bán được sẽ làm hỏng cân bằng kinh tế                                                      |
| 10  | **Lợi thế PvP**: chỉ số trực tiếp, xóa cờ Gây hấn, miễn Truy nã, vào hàng ưu tiên đấu trường | Cảnh giới quyết định (07 §1); PvP công bằng ([14](14-pvp-chien-tranh.md))                                                             |
| 11  | **Quyền chiếm Linh Mạch / Hộ Sơn Đại Trận** hoặc nạp trận                                    | Chiến tranh là tranh chấp tông môn, phí duy trì đã là sink Linh thạch (07 §7)                                                         |
| 12  | **Pháp bảo / trang bị có chỉ số** bán bằng Tiên Ngọc                                         | Tổng trang bị tối đa +60% chỉ số gốc (07 §1); bán trang bị phẩm cao là bán sức mạnh                                                   |
| 13  | **Hộp ngẫu nhiên (gacha) có thưởng sức mạnh**                                                | Vừa vi phạm các mục trên, vừa rủi ro pháp lý (xem [19](19-ngon-ngu-phap-ly.md) §5)                                                    |

### 3.1 Cho phép bán

| Nhóm                   | Ví dụ                                                                                                  | Ràng buộc                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Thẩm mỹ nhân vật**   | Pháp y thẩm mỹ, kiểu tóc, hào quang, kiểu phi kiếm, hiệu ứng bước chân, danh hiệu, khung avatar        | **Không đổi hệ phòng thủ**: hệ của pháp y quyết định hệ phòng thủ (07 §4), nên skin thẩm mỹ chỉ đổi hình, giữ nguyên hệ và chỉ số của pháp y đang mặc |
| **Thẩm mỹ môi trường** | Đồ trang trí Động Phủ, hiệu ứng trận, nhạc nền riêng                                                   | Không tăng Tụ linh trận / ρ; hạn mức đồ trang trí không đổi                                                                                           |
| **Tiện lợi nhẹ**       | Ô túi đồ và kho thêm (đến một trần cố định), ô nhân vật thứ hai, đổi tên, tab giao diện, lưu bố cục UI | Trần ô túi ≤ 30% so với mặc định (_Đề xuất_); không tác động tới sức mạnh                                                                             |
| **Thú cưng thẩm mỹ**   | Skin linh thú / kiểu pháp bảo vòng quanh                                                               | Không đổi chỉ số linh thú                                                                                                                             |
| **Thời gian**          | Nguyệt Lệnh (ưu đãi hằng ngày, §4.4), Battle Pass                                                      | Chỉ cho đồ thuộc "Cho phép" ở bảng này                                                                                                                |

Hiệu ứng thẩm mỹ phải **tuân ngân sách render** (≤ 1.000 hạt VFX Web/Mobile, ≤ 3.000 PC, ≤ 80 / 150 draw call; 00 §3). Vì thế skin phi kiếm dùng cùng instancing với Vạn Kiếm Quy Tông ([06-toi-uu-render.md](06-toi-uu-render.md)), và hiệu ứng nặng có bản giảm cho máy yếu; skin của người khác có thể bị lược giản trong chiến tranh 100 vs 100 (xem [14](14-pvp-chien-tranh.md) §5).

## 4. Sản phẩm bán

### 4.1 Cửa hàng Tiên Ngọc (Đề xuất – chờ duyệt)

| Nhóm hàng          | Tần suất làm mới           | Ghi chú                                                |
| ------------------ | -------------------------- | ------------------------------------------------------ |
| Thường trực        | Cố định                    | Đổi tên, ô túi, ô nhân vật, skin cơ bản                |
| Xoay vòng tuần     | Mỗi thứ Hai 05:00 (UTC+7)  | 6–8 món thẩm mỹ; hiển thị đếm ngược                    |
| Theo mùa / sự kiện | Theo [§5](#5-liveops) lịch | Bộ trang phục chủ đề (Trung Thu, Tết…)                 |
| Gói nạp lần đầu    | Một lần mỗi tài khoản      | Chỉ thẩm mỹ / tiện lợi, **không** chứa vật phẩm mục §3 |

**Gói nạp Tiên Ngọc (nhà phát hành thiết lập, ví dụ):** 20.000 / 50.000 / 100.000 / 200.000 / 500.000 / 1.000.000 ₫, tỷ lệ cơ sở **1 Tiên Ngọc ≈ 100 ₫** trên Web (giá trên cửa hàng ứng dụng có thể khác do phí nền tảng, _cần kiểm tra điều kiện hiện hành_). Bonus nạp lần đầu: _Đề xuất_ +100% ở gói thấp nhất. Tất cả số trên là điểm xuất phát để duyệt, không phải khuyến nghị giá chính thức.

### 4.2 Tiên Duyên Lệnh (Battle Pass)

| Thông số                 | Đề xuất                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Chu kỳ                   | **8 tuần**, đồng nhịp với mùa xếp hạng đấu trường ([14](14-pvp-chien-tranh.md) §4.2)                                            |
| Số cấp                   | 50                                                                                                                              |
| Hai track                | **Miễn phí** và **Tiên** (trả phí); track Tiên bán bằng Tiên Ngọc hoặc tiền thật trực tiếp                                      |
| Nguồn điểm               | Nhiệm vụ `daily` / `weekly` ([12](12-nhiem-vu-cot-truyen.md)), đấu trường, chiến tranh; **có trần điểm mỗi tuần**               |
| Mục tiêu hoàn thành      | Người chơi bình thường (~5 giờ mỗi tuần) hoàn thành khoảng cấp 40; người tích cực hoàn thành 50                                 |
| Phần thưởng              | **Chỉ** thẩm mỹ (§3.1), một lượng nhỏ Tiên Ngọc để giảm giá mùa sau, Cống hiến, nguyên liệu phổ thông (không phải đan / bản vẽ) |
| Mua cấp                  | **Không bán cấp trực tiếp** (xem câu hỏi Q3)                                                                                    |
| Hoàn thành mùa không hết | Phần thưởng chưa nhận bị mất khi kết thúc mùa, nhưng thông báo trước 7 ngày                                                     |

### 4.3 Tiên Ngọc miễn phí (Đề xuất – chờ duyệt)

Người chơi miễn phí có thể kiếm Tiên Ngọc từ track miễn phí và thành tựu, tối đa **khoảng 30% giá một Battle Pass mỗi mùa**; đủ để cảm nhận giá trị nhưng không đủ để thay thế việc mua. Lượng Tiên Ngọc miễn phí là một **faucet Tiên Ngọc**, không ảnh hưởng Linh thạch.

### 4.4 Nguyệt Lệnh (thẻ tháng)

Nhận một lượng nhỏ Tiên Ngọc hằng ngày trong 30 ngày kèm tiện lợi nhẹ (ví dụ thêm 1 lượt đổi nhiệm vụ nhật thường và 1 thiết lập bố cục UI). **Không** có đan, tu vi, rơi đồ.

## 5. LiveOps

### 5.1 Nguyên tắc

- **Sự kiện là dữ liệu, không phải bản cập nhật.** Cấu hình sự kiện nằm trong file `events.json` (đề xuất), server nạp lại không cần phát hành client, như mọi hệ số điều chỉnh ở 07 §7 ("Mọi hệ số điều chỉnh nằm trong file dữ liệu, server nạp lại mà không cần bản cập nhật client"). Asset sự kiện nằm trong **Event pack** tải lười ([02-asset-matrix-2d.md](02-asset-matrix-2d.md), Asset Bundle), nên phải phát hành trước ngày bắt đầu.
- **Mỗi sự kiện có ngân sách faucet và sink đi kèm** (§5.4). Không có sự kiện nào được nâng tỷ lệ rơi **Linh thạch, đan đột phá, bản vẽ** (các mục trong §3) trong MVP.
- **Mọi sự kiện có kill switch:** tắt qua dữ liệu trong ≤ 5 phút (không cần restart World Node).

### 5.2 Các loại lịch

| Loại                     | Chu kỳ                        | Nội dung                                                                                                     | Nguồn quy tắc                        |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| **Reset ngày**           | 05:00 UTC+7 hằng ngày         | Nhiệm vụ nhật thường, lượt truyền tống miễn phí về Sơn Môn (1 lần/ngày, 07 §7)                               | [12](12-nhiem-vu-cot-truyen.md) §2.1 |
| **Reset tuần**           | Thứ Hai 05:00                 | Khóa boss bí cảnh theo tuần (07 §6), nhiệm vụ chu thường, xoay vòng cửa hàng                                 | 07 §6, §4.1                          |
| **Chiến tranh tông môn** | Thứ Bảy 20:00–21:30 hằng tuần | Chiến tranh Linh Mạch                                                                                        | [14](14-pvp-chien-tranh.md) §5.2     |
| **Mùa**                  | 8 tuần                        | Battle Pass, xếp hạng đấu trường, chủ đề tuần mới                                                            | §4.2, [14] §4.2                      |
| **Sự kiện thế giới**     | 1–2 lần mỗi tháng, 2–3 giờ    | Yêu Thú Triều, Thiên Tượng, Bí cảnh mở ngẫu nhiên; thưởng nguyên liệu, thẩm mỹ, **không** thưởng đan đột phá | §5.1                                 |
| **Lễ hội văn hóa**       | Theo lịch âm / dương          | Tết Nguyên Đán, Trung Thu, Giỗ Tổ… trang phục, vật phẩm trang trí, nhiệm vụ chủ đề                           | Thẩm mỹ + nhiệm vụ `event`           |
| **Kỷ niệm / ra mắt**     | Hằng năm                      | Quà tặng thẩm mỹ cho người chơi đang hoạt động                                                               | Chi phí LiveOps                      |
| **Bảo trì**              | Báo trước ≥ 24 giờ            | Cửa sổ bảo trì cố định (_Đề xuất_ Thứ Tư 05:00–06:00 UTC+7)                                                  | Vận hành                             |

Lễ hội dùng văn hóa Việt (Tết, Trung Thu) làm lớp phủ lên nền tu tiên; mọi nội dung thẩm mỹ gắn với tôn giáo hoặc nhân vật lịch sử phải được rà soát nội dung (xem [19](19-ngon-ngu-phap-ly.md) §5).

### 5.3 Cấu hình một sự kiện (khung đề xuất)

```json
{
  "id": "evt_trung_thu_01",
  "kind": "festival",
  "window": { "start": "2027-09-20T05:00:00+07:00", "end": "2027-09-27T05:00:00+07:00" },
  "quests": ["q_evt_trung_thu_daily_1"],
  "shop": ["cos_trungthu_lantern_01"],
  "currencies": [{ "id": "token_trung_thu", "cap_per_day": 60, "convertible": false }],
  "budget": { "extra_faucet_pct_of_week": 3, "extra_sink_pct_of_week": 3 },
  "kill_switch": true,
  "bundle": "event_trungthu_01"
}
```

Trường `budget` bắt buộc; CI (dự kiến) từ chối cấu hình thiếu nó.

### 5.4 Quản trị faucet / sink của sự kiện

Mục tiêu tuần: **tiêu hao / sinh ra từ 0,9 đến 1,0** (07 §6–7). LiveOps phải tuân:

| Quy tắc                                                                                                                                                                 | Lý do                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Mỗi sự kiện: `extra_faucet_pct_of_week` − `extra_sink_pct_of_week` ≤ 2 điểm phần trăm (tính theo giá trị Linh thạch quy đổi)                                            | Không để một sự kiện tự kéo tỷ lệ ra ngoài 0,9–1,0                 |
| Tổng faucet thêm của mọi sự kiện đang chạy ≤ 10% faucet cơ sở của tuần                                                                                                  | Chống chồng sự kiện                                                |
| Tiền sự kiện (`token_*`) **không đổi được sang Linh thạch**, khóa tài khoản, hết hạn khi sự kiện kết thúc                                                               | Cùng lý do với Tiên Ngọc (§6)                                      |
| Tuần có tỷ lệ tiêu hao / sinh ra < 0,9 hai tuần liền: vòng điều chỉnh của 07 §7 (nâng sàn τ +1 điểm, nhân phí sửa 1,1) chạy **trước** khi cho thêm sự kiện nhiều faucet | Tránh hai cơ chế làm ngược chiều nhau                              |
| Tuần có CPI_w > 1,05 (vượt ngưỡng chợ): sự kiện faucet vật phẩm nằm trong rổ CPI bị hoãn                                                                                | Rổ gồm đan đột phá, nguyên liệu phổ biến, bản vẽ phẩm thấp (07 §7) |

## 6. Tương tác với chống lạm phát

| Cơ chế (07 §7)                                                    | Tương tác với kiếm tiền                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Thuế chợ τ = clamp(0,05 + 0,5 × max(0, CPI_w − 1,02), 0,05, 0,10) | Chỉ áp cho giao dịch Linh thạch. Mua bán bằng Tiên Ngọc **không tồn tại** nên không có CPI Tiên Ngọc          |
| Phí niêm yết 1% và giao dịch trực tiếp 3%                         | Áp cho vật phẩm giao dịch được; đồ mua bằng Tiên Ngọc bị khóa nên không đi qua kênh này                       |
| Phí truyền tống, độ bền, Hộ Sơn Đại Trận                          | Không có "vé truyền tống / sửa chữa miễn phí" bán bằng Tiên Ngọc; sinks này phải còn nguyên                   |
| Đấu Giá Hội hủy tiền                                              | Có thể bán vật phẩm thẩm mỹ **hiếm không phải từ Tiên Ngọc** qua Đấu Giá Hội bằng Linh thạch, tiền thu bị hủy |
| Mục tiêu tiêu hao / sinh ra 0,9–1,0                               | Tiên Ngọc nằm ngoài tỷ lệ này (là tiền riêng); **không** được quy đổi để làm "sink" trong báo cáo kinh tế     |

Nguy cơ cần theo dõi ([17-telemetry-kpi.md](17-telemetry-kpi.md) §5): người chơi mua vật phẩm thẩm mỹ **tradable** bằng Tiên Ngọc rồi bán lấy Linh thạch (rút tiền thật thành Linh thạch). Vì vậy mặc định mọi món Tiên Ngọc bị khóa tài khoản; muốn mở một món có thể giao dịch (ví dụ hộp quà tặng bạn bè) cần quyết định riêng và hạn mức.

## 7. Thanh toán & vận hành (khung, chờ pháp lý)

- **Hàng đợi một chiều:** Gateway nhận biên lai (App Store, Google Play, cổng thanh toán Web) → Auth/Economy xác thực **phía server** → ghi sổ cái kép (`SYSTEM_FAUCET_IAP` → ví Tiên Ngọc) với khóa idempotency = mã giao dịch của nhà cung cấp; không bao giờ tin biên lai từ client.
- **Hoàn tiền / chargeback:** ví Tiên Ngọc được phép âm; khi âm thì vô hiệu hóa chi tiêu và khóa các vật phẩm Tiên Ngọc liên quan cho đến khi cân bằng (_Đề xuất_).
- **Phí nền tảng:** cửa hàng ứng dụng thường thu 15–30% doanh thu (_cần kiểm tra điều kiện và chương trình giảm phí hiện hành_). Người chơi Web có thể thanh toán qua cổng riêng; **không** hướng người dùng iOS / Android vượt chính sách cửa hàng ứng dụng (cần kiểm tra).
- **Hạn mức chi tiêu cho người dưới 18 tuổi:** mặc định cần có (xem [19](19-ngon-ngu-phap-ly.md) §4); con số cụ thể chờ pháp lý.
- **Thông báo giá:** hiển thị bằng VNĐ, đã gồm thuế (_cần kiểm tra_ nghĩa vụ thuế GTGT).
- **Hỗ trợ khách hàng:** mỗi giao dịch có mã tra cứu; log RNG đột phá và sổ cái là bằng chứng khiếu nại (07 §2, 08 §7).

## Câu hỏi cần chốt

Đã gộp vào [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md), nguồn duy nhất của câu hỏi mở: cột "Câu hỏi" ở đó ghi ID nguồn đã gộp (15 Q1–Q9). Nội dung gốc của mục này nằm trong lịch sử git.
