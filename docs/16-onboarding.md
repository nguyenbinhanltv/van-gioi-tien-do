# Onboarding – 30 phút đầu (FTUE)

> **Trạng thái: bản thiết kế đề xuất – chờ duyệt.** Hồ sơ gốc không có hướng dẫn người chơi mới ([OPEN-ITEMS.md](OPEN-ITEMS.md) §3). Tài liệu này thiết kế 30 phút đầu trên **PC** và **Mobile / Web cảm ứng** dựa trên bố cục và phím trong [05-ui-ux-icon.md](05-ui-ux-icon.md), ngân sách tải của [06-toi-uu-render.md](06-toi-uu-render.md) và công thức tu luyện / đột phá của [07-cong-thuc-data-schema.md](07-cong-thuc-data-schema.md). Thời gian từng bước và tỷ lệ mục tiêu là _Đề xuất – chờ duyệt_ và phải được đo ([17-telemetry-kpi.md](17-telemetry-kpi.md) §4) trước khi khóa.
>
> Liên quan: nhiệm vụ dẫn nhập `tutorial` ([12-nhiem-vu-cot-truyen.md](12-nhiem-vu-cot-truyen.md) §2), cơ chế chế tạo mở ở Trúc Cơ ([13](13-che-tao.md)), phạm vi MVP ([10-mvp-scope.md](10-mvp-scope.md)).

## 1. Mục tiêu và nguyên tắc

**Mục tiêu 30 phút:** người chơi (a) biết mình có Linh căn gì và vì sao nó quan trọng, (b) đã di chuyển, đánh, dùng đồ và **đột phá tiểu cảnh lần đầu**, (c) hiểu vòng lặp "tu luyện → săn → đột phá" và có **lý do cụ thể để quay lại** ngày mai.

Nguyên tắc:

1. **Dạy bằng làm, không bằng chữ.** Mỗi bước là một hành động người chơi thực hiện; hộp thoại ngắn, chạm / bấm để bỏ qua.
2. **Cùng nội dung, hai cách nhập.** Bố cục chọn theo cách nhập (PC khi có `(pointer: fine)` + `(hover: hover)`; cảm ứng khi `(pointer: coarse)`), không theo thiết bị; người chơi ép được chế độ trong Cài đặt (05 §1).
3. **Mọi thứ dạy phải ở trong gói tải ban đầu.** Gói đầu ≤ 25 MB gồm "Bản đồ tân thủ" (3 × 3 chunk quanh điểm hồi sinh ≈ 96 × 96 ô), Spine nhân vật + bộ trang bị tân thủ, quái vùng đầu và VFX kỹ năng cấp 1, chỉ SFX giao diện (06 §6). Vì vậy toàn bộ 30 phút diễn ra trong **Sân Nhập Môn** (khu An toàn ở Chân núi & Cổng sơn môn, [04-tilemap.md](04-tilemap.md) §5), không chờ tải thêm; gói Sơn Môn Đại Phái (Sect pack) tải nền ngay sau khi vào.
4. **Không bán, không PvP, không chợ trong 30 phút đầu.** Tránh quá tải và vi phạm cam kết công bằng ([15](15-kiem-tien-liveops.md) §3).
5. **Thất bại là một phần của câu chuyện.** Thất bại đột phá không rớt cảnh giới lớn (00 §3).

## 2. Hai bố cục nhập liệu

Dùng nguyên kích thước và phím của 05 §2–3 (khung logic 1280 × 720).

| Khía cạnh            | PC (chuột + phím)                                           | Mobile / Web cảm ứng                                                                                                  |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Di chuyển            | Chuột trái vào đất (click-to-move) hoặc **WASD**            | **Joypad nổi** góc trái (hiện tại chỗ ngón cái chạm trong 40% màn hình trái); bán kính 64, vùng chết 10%              |
| Đánh thường          | Chuột trái vào quái                                         | Nút đánh thường 96 px ở tâm **Skill Wheel** (góc phải dưới)                                                           |
| Kỹ năng              | Phím **1–9**; thanh phụ Shift + 1–9                         | 5 nút kỹ năng 64 px quanh nút đánh thường; vuốt vòng cung để sang trang 2                                             |
| Nhắm                 | Con trỏ chuột                                               | **Chạm nhanh** = tự nhắm mục tiêu gần nhất; **giữ và kéo** = nhắm hướng (vòng ellipse 2:1), kéo tới vùng "Hủy" để hủy |
| Né (Space)           | Phím **Space** (08 §4: dash 12 ô/s trong 0,25 s, hồi 1,5 s) | **Cần chốt**: 05 chưa mô tả nút Né trên Mobile (xem Q4)                                                               |
| Túi đồ               | Phím **I** (cửa sổ nổi 420 × 480); chuột phải = dùng / mặc  | Tab "Túi" toàn màn hình, lưới 6 cột; chạm = bảng chi tiết có nút Dùng / Mặc                                           |
| Nhân vật & Công pháp | **C**, **K**                                                | Mở qua các tab của túi đồ toàn màn hình                                                                               |
| Phù lục              | **F1–F4** (4 ô bên phải thanh skill)                        | Ô phù lục nhanh (cạnh Skill Wheel)                                                                                    |
| Bản đồ               | **M**                                                       | Chạm bản đồ nhỏ (160 × 160)                                                                                           |
| Chat                 | Khung cố định góc dưới trái 360 × 200                       | Dải 2 dòng phía trên Joypad                                                                                           |
| Vùng chạm tối thiểu  | 24 px logic                                                 | 44 pt (88 px @2x)                                                                                                     |

Dòng hướng dẫn trong giao diện **đổi theo chế độ nhập** (ví dụ "Bấm chuột phải để mặc" so với "Chạm → Mặc"), lấy từ cùng một khóa chuỗi i18n với hai biến thể ([19-ngon-ngu-phap-ly.md](19-ngon-ngu-phap-ly.md) §2).

### Riêng cho Web

- Màn hình đầu **"Chạm để vào"**: vừa là bước tải tài nguyên nền, vừa là thao tác đầu tiên để mở khóa âm thanh (trình duyệt chặn phát tự động; BGM chỉ bắt đầu sau thao tác đầu tiên, 06 §6; 02 mục Âm thanh).
- Gợi ý **Toàn màn hình** (Fullscreen API) sau tương tác đầu; trên iOS Safari gợi ý "Thêm vào màn hình chính" để đủ không gian (05 §3).
- Chặn menu chuột phải mặc định của trình duyệt trong vùng game (05 §3).
- Mất focus tab → tự tạm dừng âm thanh và giảm tần số vẽ (05 §3); FTUE phải tự dừng đồng hồ nhiệm vụ có thời gian.

## 3. Dòng thời gian 30 phút

Thời điểm là mục tiêu cho người chơi trung bình (_Đề xuất_). "Tu vi" tính bằng phút tu luyện quy chuẩn (`cult_minutes`, [12](12-nhiem-vu-cot-truyen.md) §4.1); A₁ = 100 tu vi mỗi phút ở ρ = 1, Match = 1, P_n = 1; Req(1) = 1.000 (07 §5).

| #   | Phút  | Bước                                                                                                    | Người chơi làm                          | Dạy gì                                                               | Kết quả                                                                       |
| --- | ----- | ------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0   | 0:00  | **Vào game**: màn "Chạm để vào"; đăng ký / đăng nhập (tên đăng nhập + mật khẩu)                         | Nhập tài khoản, đồng ý điều khoản       | Quyền riêng tư tối thiểu ([19] §4)                                   | Có tài khoản; âm thanh bật                                                    |
| 1   | 0:30  | **Tạo nhân vật**: tên, giới tính, vài kiểu tóc, màu y phục                                              | Chọn và xác nhận                        | Bản sắc nhân vật                                                     | Nhân vật tạo xong                                                             |
| 2   | 1:30  | **Thử Linh Căn**: cảnh nghi lễ ngắn, server tung linh căn theo bảng 07 §5                               | Chạm / bấm vào Linh Thạch Trắc Căn      | **Linh căn**: loại, hệ, vì sao quan trọng                            | Người chơi biết hệ chính; hiển thị "hệ số tu luyện" (xem §4)                  |
| 3   | 3:00  | **Di chuyển** tới NPC Trưởng lão Cổng sơn môn (cách ~12 ô)                                              | PC: click đất / WASD; Mobile: Joypad    | Di chuyển, camera isometric, ô chạm                                  | Nhận nhiệm vụ `tutorial` đầu                                                  |
| 4   | 4:30  | **Vận khí lần đầu**: ngồi vào bồ đoàn tân thủ, tu luyện 3 phút                                          | Giữ trạng thái vận khí                  | Tu luyện hấp thu tu vi; ý nghĩa Linh căn × môi trường                | Tu vi tăng; nhận nhiệm vụ tiếp                                                |
| 5   | 7:30  | **Đánh thường**: 3 con hình nộm / quái yếu                                                              | PC: chuột trái; Mobile: nút đánh thường | Đánh thường, mục tiêu, thanh máu                                     | Hạ 3 con                                                                      |
| 6   | 10:00 | **Kỹ năng đầu + Ngũ hành**: học kỹ năng; đánh quái yếu hệ khắc / bị khắc                                | Phím 1 hoặc nút kỹ năng; dùng Né (PC)   | Số sát thương **+25% khi khắc, −15% khi bị khắc** (07 §4)            | Thấy chữ "Khắc!" và màu số sát thương khác                                    |
| 7   | 13:00 | **Túi đồ & trang bị**: nhặt đồ rơi, mặc pháp bảo Trắng                                                  | I → chuột phải; Mobile: túi → Mặc       | Nhặt đồ, túi, trang bị                                               | Trang bị đầu tiên                                                             |
| 8   | 15:30 | **Nhiệm vụ & NPC**: nhật ký nhiệm vụ, giao nhiệm vụ; nhận **Tụ Khí Đan** (đan dẫn nhập, chỉ cộng tu vi) | Mở nhật ký; giao                        | Nhật ký, phần thưởng                                                 | Có thưởng tu vi + Tụ Khí Đan                                                  |
| 9   | 18:00 | **Đột phá tiểu cảnh lần đầu** (Luyện Khí tầng 1 → 2)                                                    | Nhấn "Đột phá"                          | Đột phá, thất bại không rớt cảnh giới; tỷ lệ cố định 90% (§4.2, D19) | Lên tầng 2 (hoặc thử lại)                                                     |
| 10  | 20:30 | **Ô nhanh & phù lục**: ô phù lục F1–F4 / ô phù nhanh; dùng 1 Phù Hỏa Cầu                                | Kéo thả (PC) / chạm-chọn-gán (Mobile)   | Ô nhanh, phù                                                         | Có phù lục dùng được                                                          |
| 11  | 23:00 | **Tinh anh đầu tiên** (mini boss nhẹ): Sói Độc ở rìa Sân Nhập Môn                                       | Dùng kỹ năng + Né                       | Phối hợp né + kỹ năng; quái mạnh hơn                                 | Rơi vật liệu nghề phổ thông và thưởng tu vi (**không** có Trúc Cơ Đan ở FTUE) |
| 12  | 26:00 | **Bản đồ & mục tiêu tiếp theo**: mở bản đồ, thấy Hậu sơn và cổng Bí Cảnh                                | M / chạm bản đồ nhỏ                     | Bản đồ; mục tiêu dài hạn                                             | Hiểu "đi đâu tiếp"                                                            |
| 13  | 28:00 | **Móc gắn kết**: lưu tiến độ, nhận quà nhập môn (thẩm mỹ), xem trước nhiệm vụ ngày mai                  | Chạm "Nhận"                             | Daily, tông môn, hẹn ngày mai                                        | Màn "Hẹn gặp ngày mai" (§7)                                                   |
| 14  | 30:00 | **Mở khóa tự do**: bắt đầu chuỗi chương 1 (chủ tuyến)                                                   | —                                       | —                                                                    | Kết thúc FTUE, chuyển sang nhiệm vụ thường                                    |

Bước 2 là thời điểm duy nhất người chơi **không thể bỏ qua** vì nó cố định nhân vật; mọi bước khác cho "Bỏ qua" (tiến độ nhiệm vụ vẫn được ghi, phần thưởng vẫn giữ).

## 4. Vài điểm thiết kế quan trọng

### 4.1 Linh căn không làm FTUE chậm hơn

07 §5: hệ số tốc độ = P_n × √Match × ρ, với P_n từ 0,7 (Tạp Ngũ) đến 1,6 (Đơn), và trong thành chính ρ = 0,6. Nếu để người chơi tự tu luyện 1 tầng Luyện Khí (Req = 1.000, 10 phút ở hệ số 1) thì một người Tạp Ngũ cần ~14 phút chỉ để lên tầng 2; người Đơn linh căn đúng hệ chỉ ~4 phút. Để FTUE đồng đều:

- **Phần thưởng nhiệm vụ tính theo `cult_minutes` tuyệt đối** (không nhân hệ số Linh căn), nên người hệ số thấp nhận cùng lượng tu vi dẫn nhập (xem [12](12-nhiem-vu-cot-truyen.md) §4.1). Tổng tu vi cần cho tầng 1 → 2 là 1.000; kế hoạch: 3 phút vận khí (300 × hệ số) + nhiệm vụ đầu 400 (4 phút quy chuẩn) + nhiệm vụ đánh quái 300 → xấp xỉ 1.000 cho hệ số 1; người hệ số thấp thiếu một chút và bù bằng phần thưởng giao nhiệm vụ ở bước 8.
- **Bồ đoàn tân thủ** nằm ở khu có mật độ ρ = 1,0 (_Đề xuất_: tham số `rho` trong dữ liệu map của Sân Nhập Môn, vì ρ là thuộc tính vùng, 07 §5) và Match = 1 (môi trường đều v_e = 0,2).
- Ở bước 2 chỉ hiển thị **một con số dễ hiểu** ("Hệ số tu luyện ×0,7 … ×1,6") thay vì công thức.

### 4.2 Bước 9: lần đột phá đầu tiên

Theo **D19** ([DECISIONS.md](DECISIONS.md)): đột phá tiểu cảnh **không áp đan và không có pity**, kẹp 5–95%. Công thức tiểu cảnh: Base 0,90 (tầng Luyện Khí), không có kiếp, Karma_Penalty tính một nửa (07 §2). Với nhân vật mới (K = 0) tỷ lệ là **cố định 90%**, và lần thử lại **không** tốt hơn lần đầu.

- Thiết kế **không** ghi đè công thức và **không** giả định đan hay pity (không có "100% thành công" kịch bản).
- Tụ Khí Đan ở bước 8 chỉ cộng tu vi; nó không đổi tỷ lệ đột phá.
- Khi thất bại (10%): hiện thông điệp "Tâm chưa tĩnh – thử lại sau 30 giây"; thất bại không rớt cảnh giới lớn (00 §3), không mất vật phẩm; người chơi thử lại với cùng tỷ lệ 90%.
- Nếu đội thiết kế thấy 10% thất bại ở lần đầu là quá cao cho FTUE, đây là đề xuất cần game designer duyệt, ghi ở [OPEN-ITEMS.md](OPEN-ITEMS.md) §7; tài liệu này không giả định mức khác.

### 4.3 Dạy Ngũ hành bằng trải nghiệm (bước 6)

Hai con quái yếu: một hệ khắc người chơi, một hệ bị khắc. Số sát thương dùng ma trận 07 §4 (khắc 1,25; bị khắc 0,85; kèm giảm DEF 15% khi khắc) và hiện chữ "Khắc!" hoặc "Bị khắc" cạnh số. Màu số sát thương theo `fnt_damage_*` trong atlas UI; không dạy công thức, chỉ hiện kết quả.

### 4.4 Gate tính năng (mở khóa tuần tự)

| Tính năng                        | Mở khi             | Lý do                                                    |
| -------------------------------- | ------------------ | -------------------------------------------------------- |
| Di chuyển, đánh thường, nhiệm vụ | Ngay               | Cốt lõi                                                  |
| Kỹ năng, Né, Ngũ hành            | Sau bước 5         | Dạy tuần tự                                              |
| Túi đồ, trang bị                 | Bước 7             | Cần có đồ để dạy                                         |
| Chat thế giới                    | Luyện Khí tầng 2   | Giảm spam từ tài khoản mới (08 §7: lọc từ, token bucket) |
| Kênh Đội, kết bạn                | Tầng 2             | Xã hội hóa sau khi hiểu cơ bản                           |
| Gia nhập tông môn                | Tầng 3             | Tông môn gắn nhiệm vụ nhật / chu                         |
| Vạn Bảo Lâu (chợ)                | Tầng 3 (_Đề xuất_) | Chặn bot mới tạo; người chơi đã hiểu giá trị đồ          |
| PvP (vùng PK, đấu trường)        | Trúc Cơ            | Cùng ngưỡng bí cảnh ([14] §6.1)                          |
| Nghề chế tạo                     | Trúc Cơ            | `crafting` trong `realm_progression.json` ([13])         |

## 5. Các tình huống đặc biệt

| Tình huống                                   | Xử lý                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mất kết nối giữa FTUE                        | Nối lại trong 10 s (08 §7); sau đó khôi phục ở bước gần nhất; không mất vật phẩm đã nhận                                                                  |
| Thoát giữa chừng                             | Tiến độ lưu theo từng bước (server); vào lại tiếp tục                                                                                                     |
| Người chơi cũ (tài khoản khác)               | Nút "Bỏ qua hướng dẫn" từ lần đầu, nhưng vẫn chạy bước Thử Linh Căn và quà nhập môn                                                                       |
| Máy yếu (Web/Mobile thấp)                    | Dùng bộ @1x, giảm hạt VFX, hạ tần số vẽ; hướng dẫn không dựa vào hiệu ứng nặng                                                                            |
| Hạn chế khả năng tiếp cận                    | Hộp thoại có tương phản 4,5:1; hỗ trợ giảm chuyển động (`prefers-reduced-motion`) theo 05 §6; phẩm chất có dấu góc ngoài màu                              |
| Người chơi chết trong FTUE                   | Hồi sinh tại chỗ không mất độ bền (ngoại lệ hướng dẫn, chỉ trong Sân Nhập Môn); phần thưởng nhiệm vụ không bị mất                                         |
| Tạo nhân vật có Linh căn "xấu" (Tạp Ngũ 15%) | Không cho đổi lại (đổi Linh căn thuộc danh sách không bán, [15] §3 #7); thay vào đó giải thích điểm mạnh (không bị phạt khi dùng kỹ năng ngoài hệ, 07 §5) |

## 6. Móc giữ chân sớm (early retention hooks)

Tốc độ tu luyện thuần (07 §5, hệ số 1) cho thời gian tích lũy hoàn thành từng tầng Luyện Khí: tầng 1: 10 phút; tầng 2: 20,8; tầng 3: 32,5; tầng 4: 45,1; tầng 5: 58,7; tầng 6: 73,4; tầng 7: 89,2; tầng 8: 106,4; tầng 9: 124,9 phút (≈ 2,1 giờ cho 9 tầng, Σ 10 · 1,08^(s − 1) phút). Đây là khung nhịp cho các mốc quay lại:

| Mốc          | Hook                                                                                                           | Mục tiêu hành vi                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Cuối phiên 1 | Màn "Hẹn gặp ngày mai" liệt kê: 5 nhiệm vụ nhật thường mở lúc 05:00, tầng 3 chỉ cách ~12 phút, Hậu sơn chưa mở | Có lý do để quay lại, không đặt "đếm ngược khóa"/đe dọa mất mát |
| D1           | Đăng nhập ngày thứ 2: **chuỗi thưởng 7 ngày** (chỉ thẩm mỹ và vật phẩm nguyên liệu phổ thông)                  | Quay lại ngày thứ hai; không có thưởng sức mạnh                 |
| D1–D3        | Chuỗi chủ tuyến chương 1; mục tiêu Luyện Khí tầng 5–6 (≈ 1–1,2 giờ chơi tu luyện + săn)                        | Hoàn thành chương 1 trong 2–3 phiên                             |
| D3–D7        | Gia nhập tông môn (tầng 3), nhiệm vụ tông môn, Cống hiến; kết bạn; Động Phủ tân thủ (nếu MVP có)               | Tạo kết nối xã hội                                              |
| D7           | Đột phá lên **Trúc Cơ** (tầng 9 ≈ 2,1 giờ tu luyện + chuẩn bị đan / nhiệm vụ); mở nghề, bí cảnh, PvP           | Mốc cảm xúc lớn, bắt đầu phase giữa game                        |
| Hằng tuần    | Reset tuần: rương boss tuần, nhiệm vụ chu, cửa hàng xoay vòng; mùa Battle Pass                                 | Thói quen theo tuần ([15] §5)                                   |

Các hook **không** dùng: đếm ngược gây áp lực mất đồ, thông báo đẩy dày đặc, thưởng đăng nhập chỉ cho người trả tiền, hoặc "hết hạn" cho tiến độ chủ tuyến.

Thông báo đẩy (Mobile / Web, nếu có): tối đa 1 mỗi ngày, mặc định bật cho "nhiệm vụ nhật thường đã mở" và "chiến tranh sắp bắt đầu" (tông môn); người chơi tắt từng loại ở Cài đặt; không gửi trong 22:00–07:00 UTC+7 (_Đề xuất_).

## 7. Đo lường FTUE

Tên sự kiện và trường bắt buộc nằm ở [17-telemetry-kpi.md](17-telemetry-kpi.md) §3. Phễu tối thiểu:

`session.start` → `account.register` → `character.create` → `ftue.spirit_root_reveal` → `ftue.first_move` → `ftue.first_cultivate` → `ftue.first_kill` → `ftue.first_equip` → `ftue.first_breakthrough` → `ftue.complete`.

Mục tiêu khởi điểm (_Đề xuất_, vì chưa có dữ liệu thật): ≥ 70% người tạo nhân vật xong bước 3 (di chuyển), ≥ 50% hoàn thành FTUE trong phiên đầu, thời gian trung vị hoàn thành FTUE ≤ 32 phút. Theo dõi riêng **PC / Mobile / Web** và **loại Linh căn** để phát hiện chênh lệch (ví dụ Tạp Ngũ rời bỏ nhiều hơn).

## Câu hỏi cần chốt

| #   | Câu hỏi                                                                                                                                 | Mặc định đề xuất                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Cho phép **chơi thử (guest)** rồi nâng cấp thành tài khoản, hay bắt buộc đăng ký trước? (Auth MVP: username + mật khẩu; Google SSO sau) | Bắt buộc đăng ký ở bước 0 ngắn gọn (không email bắt buộc), giảm PII; cân nhắc guest sau MVP                                                           |
| Q2  | Cho phép đổi Linh căn một lần trong 30 phút đầu không?                                                                                  | Không (giữ cam kết "không bán / không đổi Linh căn"); giải thích điểm mạnh từng loại                                                                  |
| Q3  | ~~Đan có áp dụng cho đột phá tiểu cảnh không?~~ **Đã chốt bởi D19**: không áp đan, không pity                                           | Không còn là câu hỏi; FTUE bước 9 = 90% cố định (§4.2)                                                                                                |
| Q4  | Nút **Né (Space)** trên Mobile đặt ở đâu? (05 chỉ có nút ngự kiếm / khinh công và ô phù nhanh)                                          | Thêm nút Né nhỏ cạnh Skill Wheel hoặc cử chỉ chạm đôi Joypad; nhóm UI chốt                                                                            |
| Q5  | Có cho phép "Bỏ qua hướng dẫn" ngay từ đầu cho người dùng nâng cao?                                                                     | Có, nhưng giữ bước Thử Linh Căn và quà nhập môn                                                                                                       |
| Q6  | Ngưỡng mở chợ ở tầng 3 và chat ở tầng 2                                                                                                 | Giữ như §4.4                                                                                                                                          |
| Q7  | Trúc Cơ Đan phẩm Trắng (ngoại lệ [12] §4.1) phát lúc nào?                                                                               | Chỉ ở **cuối chương 1** (nhiệm vụ chủ tuyến trước ngưỡng Trúc Cơ, khoảng tầng 9), đúng 1 viên, khóa không giao dịch; **không** phát trong 30 phút đầu |
| Q8  | Thông báo đẩy mặc định bật hay tắt?                                                                                                     | Bật cho 2 loại nêu trong §6, hỏi quyền sau bước 9 (không ở bước 0)                                                                                    |
