# Ngôn ngữ (Localization) & Checklist pháp lý

> **Trạng thái: bản thiết kế đề xuất – chờ duyệt.** Hồ sơ gốc không có chiến lược ngôn ngữ hay hồ sơ pháp lý. Phần 2–3 là thiết kế kỹ thuật (chuỗi i18n, phông chữ). Phần 4–5 là **checklist pháp lý để người phụ trách hỏi luật sư**.
>
> ## ⚠️ Phần pháp lý KHÔNG phải tư vấn pháp lý
>
> Phần 4–6 do nhóm thiết kế game tổng hợp từ hiểu biết chung, **chưa được luật sư Việt Nam kiểm tra**, và có thể sai, thiếu hoặc đã lỗi thời (luật Việt Nam về game online, dữ liệu cá nhân và thanh toán thay đổi nhanh; một số cơ quan quản lý đã tái cấu trúc). **Mọi mục phải được luật sư có chuyên môn về game online / thương mại điện tử / dữ liệu cá nhân tại Việt Nam xác minh trước khi ra mắt hoặc thu tiền thật.** Quy ước: tên văn bản mà chúng tôi **tin chắc** được ghi thẳng; điều khoản cụ thể, con số, hiệu lực hoặc việc văn bản còn áp dụng mà chúng tôi **chưa chắc** được đánh dấu **"cần kiểm tra"**. Không có mục nào dưới đây là cam kết rằng game "đã tuân thủ".

## 1. Phạm vi

| Nội dung           | Quyết định hiện có                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Ngôn ngữ phát hành | **Tiếng Việt (`vi-VN`) trước.** Nhiều ngôn ngữ chỉ sau MVP; thiết kế phải sẵn sàng ngay từ ngày đầu (§2).               |
| Nền tảng           | Web H5 + Mobile + PC, cross-play (00 §3); thị trường mục tiêu ban đầu: Việt Nam.                                        |
| Đăng nhập          | Tên đăng nhập + mật khẩu ở MVP; Google SSO sau (quyết định của người phụ trách dự án).                                  |
| Hosting            | Cục bộ ở giai đoạn đầu; chưa chọn nhà cung cấp. Các điều về lưu trữ dữ liệu trong nước (§4.4) ảnh hưởng quyết định này. |

## 2. Chiến lược ngôn ngữ (i18n)

### 2.1 Nguyên tắc

1. **Tiếng Việt là ngôn ngữ nguồn.** Văn bản chuẩn viết bằng tiếng Việt; bản dịch khác sinh từ khóa chuỗi.
2. **Không có chuỗi nhúng trong mã hoặc trong ảnh.** Mọi chữ hiển thị lấy từ **khóa chuỗi** (i18n key) từ ngày đầu; không có chữ Latinh in trên icon (05 §5); chữ Hán chỉ là họa tiết.
3. **Server gửi mã, không gửi câu.** Lỗi, thông báo hệ thống và sự kiện trả về **mã + tham số** (ví dụ `err.craft.no_materials`, `{item}`); client dịch. Điều này giữ giao thức nhị phân của 08 §8 gọn và đa ngôn ngữ.
4. **Không ghép câu bằng cách nối chuỗi.** Dùng mẫu có **tham số đặt tên** (`"{player} đã đột phá lên {realm}"`) để các ngôn ngữ khác đổi thứ tự từ.
5. **Thuật ngữ cố định** nằm trong **bảng thuật ngữ** (Linh căn, Linh thạch, Tiên Ngọc, Cống hiến, Nghiệp Lực, Đạo Tâm, Lôi Kiếp, Tâm Ma, Hộ Sơn Đại Trận, 6 phẩm Trắng → Đỏ…); bản dịch ngoại ngữ giữ Hán Việt hoặc phiên âm kèm chú giải lần đầu.

### 2.2 Khóa chuỗi

| Quy ước                                | Ví dụ                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `domain.sub.name` chữ thường, dấu chấm | `ui.inventory.title`, `item.pill_truc_co_dan.name`, `item.pill_truc_co_dan.desc`, `quest.c1.first_qi.name` |
| Khớp trường dữ liệu                    | `name_key` / `desc_key` của nhiệm vụ ([12](12-nhiem-vu-cot-truyen.md) §5.2) mang tiền tố `quest.`          |
| Biến thể theo chế độ nhập              | `tutorial.use_item.pc` / `tutorial.use_item.touch` (đọc theo `input_mode`, [16](16-onboarding.md) §2)      |
| Số nhiều                               | Dùng cơ chế ICU `plural` dù tiếng Việt không cần, để thêm ngôn ngữ sau không đổi khóa                      |
| Mô tả cho dịch giả                     | Mỗi khóa mới có `context` ngắn (nơi hiển thị, độ dài tối đa)                                               |

Cấu trúc tệp đề xuất: `locales/vi-VN.json` (nguồn), `locales/en.json` (khung, sau MVP). CI (dự kiến): báo lỗi nếu khóa trong mã không có trong `vi-VN.json`, báo cảnh báo nếu khóa thiếu ở ngôn ngữ khác, và kiểm tra tham số `{...}` khớp giữa các ngôn ngữ. Thư viện cụ thể chưa chốt (xem câu hỏi Q2).

### 2.3 Định dạng theo vùng

- **Số:** hiển thị theo `vi-VN` (dấu chấm ngăn nghìn, dấu phẩy thập phân), đúng với cách tài liệu 07 ghi ("1.200", "0,6"); dùng `Intl.NumberFormat` với `locale` thay vì tự chèn dấu.
- **Ngày giờ:** giờ máy chủ UTC+7 (`Asia/Ho_Chi_Minh`); client hiển thị theo múi của người dùng, có chú thích múi giờ cho lịch sự kiện / chiến tranh ([14](14-pvp-chien-tranh.md) §5.2, [15](15-kiem-tien-liveops.md) §5).
- **Tiền:** VNĐ cho cửa hàng; ký hiệu `₫`; **Linh thạch / Tiên Ngọc** là số nguyên không đơn vị tiền thật.

### 2.4 Chiều dài chữ và bố cục

- Chừa **≥ 30% chiều rộng** cho chữ dài hơn khi dịch sang tiếng khác (tiếng Anh thường ngắn hơn tiếng Việt ở UI nhưng một số ngôn ngữ dài hơn); khung 9-slice của 05 §4 giãn theo nội dung nên chịu được; nút chính ghi giới hạn ký tự.
- Kiểm tra **pseudo-localization** (chữ giả dài, có dấu) để bắt tràn chữ.
- Không dùng chữ viết tắt không giải thích; thanh máu / số sát thương không phụ thuộc ngôn ngữ.

### 2.5 Thứ tự ngôn ngữ

| Giai đoạn              | Ngôn ngữ              | Ghi chú                                                                                  |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| MVP / closed beta      | `vi-VN`               | Đủ 100% chuỗi                                                                            |
| Sau MVP (cân nhắc)     | `en`                  | Thị trường người Việt ở nước ngoài và người chơi quốc tế; cần rà soát pháp lý riêng (§6) |
| Dài hạn (chưa cam kết) | `zh-Hans` / `zh-Hant` | Phải thêm phông chữ CJK và xử lý ngắt dòng (xem §3); chưa lên kế hoạch                   |

## 3. Phông chữ

### 3.1 Yêu cầu bao phủ

| Nhu cầu                           | Chi tiết                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tiếng Việt đầy đủ**             | Chữ Latinh + toàn bộ nguyên âm có dấu (ví dụ ầ, ẫ, ể, ỡ, ự, ỳ); dùng dạng chuẩn hóa **Unicode NFC**; kiểm tra các tổ hợp dấu chồng (ẩ, ệ…) không bị lệch dấu ở cỡ nhỏ |
| **Hán tự cho phù lục / họa tiết** | Ký hiệu ngũ hành 金 木 水 火 土, biến dị 風 雷 冰, vài chữ trên bùa (như 符, 令, 敕); chỉ là họa tiết, không mang thông tin bắt buộc (05 §5)                          |
| **Số, ký hiệu**                   | Số sát thương và HUD dùng **bitmap font** (`fnt_`, 02), không cần bao phủ ngôn ngữ                                                                                    |
| **Đọc được ở cỡ nhỏ**             | Cỡ tối thiểu thân văn bản ≈ 14 px logic trên khung 1280 × 720; thanh trượt 80–120% (05 §1)                                                                            |

### 3.2 Chiến lược (Đề xuất – chờ duyệt)

Ngân sách gói đầu Web chỉ **25 MB** và mọi thứ ngoài Core là tải lười (06 §6), nên **không nhúng phông CJK đầy đủ** (thường rất nặng, nhiều MB).

| Thành phần                                | Phương án                                                                                                                                                                         | Lý do                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Văn bản thân (hội thoại, mô tả, chat)** | Một phông sans + một phông serif có hỗ trợ tiếng Việt, giấy phép OFL, **cắt tập con** (Latin + Vietnamese) rồi đóng gói woff2 / TTF; tải thân văn bản trong Core UI (4 MB, 06 §6) | Nhẹ; đồng nhất ở Web, Mobile, PC                       |
| **Tiêu đề, tên cửa sổ**                   | Phông trang trí nhẹ cho tiếng Việt (OFL), cắt tập con; hoặc bitmap font sinh trước cho các chuỗi cố định                                                                          | Chữ ít, cố định; bitmap tránh lệch hiển thị            |
| **Hán tự họa tiết**                       | **Không dùng phông**: vẽ trước thành sprite / SVG → atlas (≈ 20–40 chữ). Chữ triện trên phù lục đã có pipeline sinh SVG trong `tools/procgen` (00 §6)                             | Tránh tải phông CJK; kiểm soát được hình dạng và nghĩa |
| **Chữ Hán trong nội dung động**           | Không cho phép (tên nhân vật, chat dùng chữ Latinh + tiếng Việt ở MVP)                                                                                                            | Tránh thiếu glyph, tránh lọc từ phức tạp               |
| **Fallback**                              | Thiếu glyph → phông hệ thống → ô vuông; log `client.error` với mã glyph (không log nội dung chat, [17] §7)                                                                        | Phát hiện sớm                                          |

Ứng viên phông (_cần kiểm tra giấy phép từng tệp trước khi đưa vào repo_, quy trình ở skill `vgtd-asset-pipeline` và [18-art-bible-am-thanh.md](18-art-bible-am-thanh.md) §9): các phông OFL trên Google Fonts có hỗ trợ tiếng Việt như **Be Vietnam Pro** (sans), **Noto Sans / Noto Serif** (có Vietnamese) để dùng cho thân văn bản; **Ma Shan Zheng** hoặc tương tự (OFL) có thể dùng để **dựng sprite** Hán tự họa tiết ở bước sản xuất (nhưng sprite là sản phẩm phái sinh: vẫn ghi vào hồ sơ giấy phép). Mọi phông phải được liệt kê trong `docs/ASSET-LICENSES.md` (khi file này được tạo) với giấy phép và điều khoản nhúng.

### 3.3 Quy tắc tên nhân vật và nội dung do người chơi

- **Tên nhân vật:** chữ cái Unicode thuộc Latinh gồm tiếng Việt có dấu, độ dài 2–16 ký tự, không toàn khoảng trắng, không ký tự điều khiển, chuẩn hóa NFC; không chữ Hán ở MVP (§3.2).
- **Lọc từ và mạo danh:** kênh Chat có lọc từ và token bucket (08 §7); tên giống quản trị viên / thương hiệu bị từ chối. Lọc từ tiếng Việt phải xử lý **không dấu / sai dấu** ("duma" so với "đụ má").
- **Ngắt dòng:** tiếng Việt tách theo âm tiết bằng khoảng trắng nên tương thích; không xử lý riêng cho CJK ở MVP.

## 4. Checklist pháp lý phát hành game online tại Việt Nam

> Nhắc lại: **mọi mục cần được luật sư xác minh**. Cột "Chắc?" cho biết mức tin của chúng tôi vào việc văn bản **tồn tại và có liên quan** (không phải nội dung chi tiết): **Chắc** = tin chắc tên văn bản; **Kiểm tra** = chưa chắc số hiệu / hiệu lực / điều khoản.

### 4.1 Chủ thể và giấy phép cung cấp dịch vụ

| #   | Hạng mục                                                         | Văn bản liên quan                                                                                                                                                          | Chắc?                                            | Việc cần làm                                                                                                                                                                  | Ảnh hưởng thiết kế                                                |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| L1  | Pháp nhân Việt Nam đứng tên cung cấp dịch vụ game                | Luật Doanh nghiệp; quy định ngành nghề kinh doanh dịch vụ trò chơi điện tử                                                                                                 | Chắc (tên) / Kiểm tra (điều kiện cụ thể)         | Xác định công ty nào phát hành, ngành nghề, vốn / điều kiện nếu có; chủ thể nước ngoài cần kiểm tra thêm hạn chế đầu tư                                                       | Quyết định hosting, hợp đồng thanh toán                           |
| L2  | **Giấy phép / thủ tục cho game nhiều người chơi tương tác (G1)** | **Nghị định 72/2013/NĐ-CP** (dịch vụ Internet và thông tin trên mạng; phân loại trò chơi G1–G4); **Thông tư 24/2014/TT-BTTTT** (hướng dẫn về trò chơi điện tử trên mạng)   | Chắc (tên) / Kiểm tra (còn hiệu lực đến mức nào) | Xác định game thuộc nhóm nào (MMORPG tương tác nhiều người thường được xếp G1 — **kiểm tra**); chuẩn bị hồ sơ xin giấy phép và phê duyệt nội dung / kịch bản; thời gian xử lý | Kế hoạch ra mắt: closed beta có thể cần xin phép trước (kiểm tra) |
| L3  | Các văn bản sửa đổi / thay thế gần đây                           | **Nghị định 27/2018/NĐ-CP** (sửa đổi 72/2013); **Nghị định 147/2024/NĐ-CP** (về quản lý, cung cấp, sử dụng dịch vụ Internet và thông tin trên mạng; có hiệu lực cuối 2024) | Kiểm tra (nội dung, phạm vi thay thế)            | Luật sư xác định văn bản nào đang là căn cứ; quy định xác thực tài khoản người chơi game (L8)                                                                                 | Auth, [16] §1                                                     |
| L4  | **Cơ quan quản lý**                                              | Trước đây Bộ Thông tin và Truyền thông (Cục Phát thanh, truyền hình và thông tin điện tử). Bộ máy nhà nước đã được tái cấu trúc năm 2025                                   | Kiểm tra (cơ quan hiện hành)                     | Xác định cơ quan hiện tại tiếp nhận hồ sơ G1                                                                                                                                  | Kế hoạch thời gian                                                |

### 4.2 Nội dung game và phân loại độ tuổi

| #   | Hạng mục                                                                                        | Văn bản liên quan                                                                       | Chắc?                                                 | Việc cần làm                                                                                                                                 | Ảnh hưởng thiết kế                                                     |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| L5  | **Phê duyệt nội dung / kịch bản trò chơi**                                                      | Nghị định 72/2013/NĐ-CP; Thông tư 24/2014/TT-BTTTT (như L2); các văn bản thay thế (L3)  | Chắc (tên) / Kiểm tra                                 | Nộp kịch bản, nội dung game cho cơ quan quản lý; **mọi thay đổi nội dung lớn sau khi duyệt** có thể phải báo cáo / duyệt lại (kiểm tra)      | Cốt truyện ([12]), vật phẩm, thẩm mỹ ([18]); LiveOps sự kiện ([15] §5) |
| L6  | Nội dung bị cấm (bạo lực quá mức, tục tĩu, chống Nhà nước, đồi trụy, mê tín dị đoan, đánh bạc…) | Nghị định 72/2013/NĐ-CP (danh mục nội dung cấm); Luật An ninh mạng 2018                 | Chắc (tên) / Kiểm tra (đối chiếu theo chủ đề tu tiên) | Rà soát: tu tiên có yếu tố tôn giáo / mê tín (ví dụ phép, bùa, kiếp); hình ảnh ma / độc; chia sẻ với luật sư trước khi chốt art / cốt truyện | Nội dung [12], [18] §1, §5                                             |
| L7  | **Phân loại độ tuổi** và hiển thị cảnh báo                                                      | Thông tư 24/2014/TT-BTTTT và hướng dẫn liên quan (nhóm tuổi 12+/16+/18+ — **kiểm tra**) | Kiểm tra                                              | Xác định nhóm tuổi phù hợp (có PvP, có hình ảnh ma, có chi tiêu); hiển thị nhãn ở màn hình đăng ký, cửa hàng ứng dụng                        | Ảnh hưởng giới hạn tuổi, tính năng chat, hạn mức chi tiêu              |

### 4.3 Người chơi: xác thực, giờ chơi, vị thành niên

| #   | Hạng mục                                           | Văn bản liên quan                                                                                                                                                                                    | Chắc?                          | Việc cần làm                                                                                                             | Ảnh hưởng thiết kế                                                                                                  |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| L8  | **Xác thực tài khoản người chơi** (định danh)      | Nghị định 147/2024/NĐ-CP (quy định về xác thực tài khoản đối với một số dịch vụ, trong đó có game — **kiểm tra phạm vi G1**)                                                                         | Kiểm tra                       | Xác định có phải xác thực bằng số điện thoại / định danh điện tử và với đối tượng nào; thiết kế luồng thu thập tối thiểu | **Đăng ký MVP (username + mật khẩu)** có thể phải thêm bước xác thực; sửa [16] §3 bước 0                            |
| L9  | **Giới hạn thời gian chơi cho người dưới 18 tuổi** | Thường được nhắc đến: giới hạn 180 phút mỗi ngày cho game G1 đối với người chơi vị thành niên trong Thông tư 24/2014/TT-BTTTT (và/hoặc văn bản sau) — **số, đối tượng, văn bản cụ thể cần kiểm tra** | Kiểm tra                       | Xác nhận mức giới hạn hiện hành, cách tính (tổng mỗi ngày hay mỗi phiên), cách xác định độ tuổi                          | Cần cơ chế đếm giờ do **server** giữ, hiển thị đếm ngược, ngắt kết nối; ảnh hưởng nhịp FTUE và nhiệm vụ nhật thường |
| L10 | **Xác minh độ tuổi và đồng ý của người giám hộ**   | Nghị định 13/2023/NĐ-CP (trẻ em: ngưỡng 16 tuổi cho đồng ý của cha mẹ / người giám hộ — **kiểm tra điều khoản**); Luật Trẻ em 2016                                                                   | Chắc (tên) / Kiểm tra (ngưỡng) | Thiết kế luồng đồng ý + xác minh; hạn chế thu thập dữ liệu trẻ em (xem [17] §7)                                          | Telemetry; chat; cửa hàng                                                                                           |
| L11 | **Hạn mức chi tiêu cho người dưới 18 tuổi**        | Không biết có quy định cụ thể; có thể có yêu cầu về bảo vệ người tiêu dùng, trẻ em                                                                                                                   | Kiểm tra                       | Hỏi luật sư có mức trần bắt buộc không; nếu không, tự đặt chính sách bảo thủ                                             | [15] §7                                                                                                             |
| L12 | **Bảo vệ trẻ em trên môi trường mạng**             | Luật Trẻ em 2016 (Luật số 102/2016/QH13); văn bản hướng dẫn (**kiểm tra**)                                                                                                                           | Chắc (tên) / Kiểm tra          | Nút báo cáo, kiểm duyệt chat, chặn liên hệ độc hại (xem [14] §6.3)                                                       | Chat, báo cáo, lọc từ                                                                                               |

### 4.4 Dữ liệu cá nhân và an ninh mạng

| #   | Hạng mục                                                        | Văn bản liên quan                                                                                                                                                                        | Chắc?                                     | Việc cần làm                                                                                                                          | Ảnh hưởng thiết kế                                 |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| L13 | **Bảo vệ dữ liệu cá nhân**                                      | **Nghị định 13/2023/NĐ-CP** (có hiệu lực từ 01/07/2023); **Luật Bảo vệ dữ liệu cá nhân** (Quốc hội thông qua năm 2025, có hiệu lực từ 01/01/2026 — **số hiệu và nội dung cần kiểm tra**) | Chắc (Nghị định 13) / Kiểm tra (luật mới) | Xác định văn bản nào áp dụng ở thời điểm ra mắt; lập danh mục dữ liệu, mục đích, thời hạn lưu; thông báo xử lý dữ liệu; lấy sự đồng ý | [17] §7 toàn bộ                                    |
| L14 | **Đánh giá tác động xử lý dữ liệu cá nhân** (hồ sơ nộp cơ quan) | Nghị định 13/2023/NĐ-CP (có yêu cầu lập hồ sơ đánh giá tác động — **kiểm tra điều khoản và mẫu hồ sơ**)                                                                                  | Kiểm tra                                  | Luật sư soạn / rà soát hồ sơ trước khi thu thập dữ liệu thật                                                                          | Danh mục dữ liệu cần thống nhất với [17] §3.2      |
| L15 | **Thông báo vi phạm dữ liệu**                                   | Nghị định 13/2023/NĐ-CP (thời hạn thông báo — thường được nhắc đến là 72 giờ — **kiểm tra**)                                                                                             | Kiểm tra                                  | Quy trình sự cố; ai liên hệ cơ quan; mẫu thông báo cho người dùng                                                                     | Nhật ký truy cập, phát hiện bất thường             |
| L16 | **Lưu trữ dữ liệu người dùng Việt Nam trong nước**              | **Luật An ninh mạng 2018** (Luật số 24/2018/QH14); **Nghị định 53/2022/NĐ-CP** (hướng dẫn, trong đó có quy định lưu trữ dữ liệu và đặt chi nhánh — **kiểm tra điều kiện áp dụng**)       | Chắc (tên) / Kiểm tra (điều kiện)         | Xác nhận yêu cầu với doanh nghiệp trong nước; chuẩn bị khi chuyển từ hosting cục bộ lên đám mây nước ngoài                            | Quyết định hosting ([08] §7; câu hỏi Q4 của dự án) |
| L17 | **Lưu nhật ký (log) và hợp tác với cơ quan chức năng**          | Luật An ninh mạng 2018; Nghị định 72/2013/NĐ-CP (thời hạn lưu thông tin — **kiểm tra**)                                                                                                  | Chắc (tên) / Kiểm tra                     | Xác định loại log và thời hạn bắt buộc; quy trình đáp ứng yêu cầu hợp pháp của cơ quan                                                | Thời hạn lưu trong [17] §7                         |
| L18 | **Giao dịch điện tử, chữ ký, điều khoản sử dụng**               | **Luật Giao dịch điện tử 2023** (Luật số 20/2023/QH15, hiệu lực từ 01/07/2024 — **kiểm tra**)                                                                                            | Chắc (tên) / Kiểm tra                     | Điều khoản dịch vụ (TOS), chính sách quyền riêng tư tiếng Việt, đồng ý điện tử hợp lệ                                                 | Màn đăng ký ([16] §3 bước 0)                       |

### 4.5 Thanh toán, thuế, người tiêu dùng

| #   | Hạng mục                                                        | Văn bản liên quan                                                                                                                                         | Chắc?                 | Việc cần làm                                                                                                                                           | Ảnh hưởng thiết kế                 |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| L19 | **Thanh toán không dùng tiền mặt; cổng thanh toán**             | **Nghị định 52/2024/NĐ-CP** (thanh toán không dùng tiền mặt; thay Nghị định 101/2012 — **kiểm tra**); quy định về dịch vụ trung gian thanh toán           | Kiểm tra              | Dùng **cổng thanh toán đã được cấp phép** (không tự thu tiền); hợp đồng; đối soát; hoàn tiền                                                           | [15] §7                            |
| L20 | **Tiên Ngọc (tiền ảo trong game)**                              | Không có văn bản nào chúng tôi tin chắc; cần luật sư xem xét quy định về "tiền ảo", đơn vị điện tử trong game, và việc **cấm quy đổi ngược ra tiền thật** | Kiểm tra              | Giữ thiết kế **một chiều, khóa tài khoản, không đổi ra tiền thật** ([15] §2, §6); xác nhận không bị coi là phương tiện thanh toán / sản phẩm tài chính | Cam kết sản phẩm [15] §3           |
| L21 | **Bảo vệ quyền lợi người tiêu dùng**                            | **Luật Bảo vệ quyền lợi người tiêu dùng 2023** (Luật số 19/2023/QH15, hiệu lực từ 01/07/2024 — **kiểm tra**)                                              | Chắc (tên) / Kiểm tra | Hiển thị giá, điều kiện, hoàn tiền; giải quyết khiếu nại; hợp đồng mẫu; không điều khoản bất lợi                                                       | Cửa hàng, Battle Pass ([15] §4)    |
| L22 | **Thuế** (GTGT, thu nhập doanh nghiệp; nhà cung cấp nước ngoài) | Luật thuế GTGT; Luật thuế TNDN; quy định thuế đối với nhà cung cấp nước ngoài qua nền tảng số (**kiểm tra văn bản hiện hành**)                            | Kiểm tra              | Kế toán / luật sư thuế xác định nghĩa vụ; xuất hóa đơn điện tử                                                                                         | Giá niêm yết đã gồm thuế ([15] §7) |
| L23 | **Cửa hàng ứng dụng (Apple, Google)**                           | Chính sách của nền tảng (không phải luật VN): phí 15–30% (**kiểm tra điều kiện hiện hành**), quy định mua hàng trong ứng dụng, nhãn tuổi, quyền riêng tư  | Kiểm tra              | Đọc điều khoản; không hướng người dùng vượt kênh thanh toán của cửa hàng                                                                               | [15] §7                            |
| L24 | **Thương mại điện tử** (đăng ký website / ứng dụng bán hàng)    | **Nghị định 52/2013/NĐ-CP** (thương mại điện tử) và sửa đổi (**Nghị định 85/2021/NĐ-CP** — **kiểm tra**)                                                  | Kiểm tra              | Xác định cần thông báo / đăng ký website, ứng dụng bán hàng với cơ quan hay không                                                                      | Website / app cửa hàng             |
| L25 | **Quảng cáo và khuyến mại**                                     | **Luật Quảng cáo 2012**; Luật Thương mại (quy định khuyến mại — **kiểm tra**)                                                                             | Chắc (tên) / Kiểm tra | Quy tắc quảng bá, sự kiện tặng quà, sự kiện có thưởng (**không là cờ bạc**, xem §5.4)                                                                  | LiveOps ([15] §5)                  |

### 4.6 Sở hữu trí tuệ

| #   | Hạng mục                                    | Văn bản liên quan                                                                                    | Chắc?                 | Việc cần làm                                                                                                           | Ảnh hưởng thiết kế                   |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| L26 | **Luật Sở hữu trí tuệ**                     | **Luật Sở hữu trí tuệ 2005**, sửa đổi bổ sung 2009, 2019, 2022 (**kiểm tra bản hợp nhất hiện hành**) | Chắc (tên) / Kiểm tra | Xác nhận quyền với mã nguồn, hình ảnh, âm thanh; hợp đồng với họa sĩ / nhà soạn nhạc có điều khoản chuyển nhượng quyền | [18] §9                              |
| L27 | **Nhãn hiệu "Vạn Giới Tiên Đồ" (tên tạm)**  | Quy định đăng ký nhãn hiệu (Cục Sở hữu trí tuệ — **kiểm tra**)                                       | Kiểm tra              | Tra cứu trùng nhãn hiệu / tên miền / tên trên cửa hàng ứng dụng; đăng ký nhóm dịch vụ giải trí / phần mềm              | Tên tạm có thể phải đổi              |
| L28 | **Giấy phép asset bên thứ ba và phông chữ** | Điều khoản giấy phép từng asset (CC0, CC-BY, OFL…)                                                   | Chắc (nguyên tắc)     | Ghi vào `docs/ASSET-LICENSES.md`; ghi công trong màn hình Credits nếu bắt buộc                                         | [18] §9, skill `vgtd-asset-pipeline` |

### 4.7 Lộ trình pháp lý đề xuất

| Mốc                                  | Việc                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Trước khi viết mã đăng ký thật**   | Luật sư xác nhận L8–L10 (xác thực, tuổi); quyết định dữ liệu tối thiểu ở đăng ký                                                           |
| **Trước closed beta có người ngoài** | L2, L5 (có cần giấy phép / duyệt nội dung cho thử nghiệm kín không?); L13, L14 (đánh giá tác động dữ liệu); L18 (TOS, chính sách riêng tư) |
| **Trước khi thu tiền thật**          | L19–L25 (thanh toán, thuế, người tiêu dùng); L20 (Tiên Ngọc); L11 (hạn mức vị thành niên)                                                  |
| **Trước công khai**                  | L2–L7 (giấy phép G1, phê duyệt nội dung, nhãn tuổi), L9 (giờ chơi), L16 (lưu trữ trong nước), L27 (nhãn hiệu)                              |
| **Hằng năm / khi đổi nội dung lớn**  | Rà soát lại văn bản; báo cáo thay đổi nội dung nếu bắt buộc (L5)                                                                           |

## 5. Nội dung, sở hữu trí tuệ và hộp ngẫu nhiên

### 5.1 Rà soát nội dung

- **Tu tiên có yếu tố tôn giáo / tâm linh:** tên gọi Tiên, Phật, Ma, Địa phủ; kiếp, đạo, phép, bùa. Hồ sơ [12](12-nhiem-vu-cot-truyen.md) và [18](18-art-bible-am-thanh.md) tránh dùng biểu tượng tôn giáo có thật và tên nhân vật lịch sử Việt Nam / Trung Quốc; nếu cần (Tết, Giỗ Tổ, Trung Thu) thì chỉ dùng yếu tố văn hóa dân gian, qua rà soát (L6).
- **Bạo lực:** PvP, nhân vật Ma đạo (cướp, thôn phệ tu vi). Giữ ở mức hoạt hình, không máu me chi tiết; mức độ gắn với nhóm tuổi (L7).
- **Ngôn ngữ chat:** lọc từ tục tĩu, tuyên truyền thù hận, nội dung chính trị nhạy cảm (L6, L17); công cụ báo cáo ([14] §6.3).
- **Bản đồ và địa danh:** không dùng địa danh gây tranh chấp chính trị.

### 5.2 Sở hữu trí tuệ

- Hợp đồng với họa sĩ, nhà soạn nhạc, lập trình viên bên ngoài phải có điều khoản **chuyển nhượng quyền sử dụng / sở hữu** rõ ràng; ghi vào hồ sơ asset.
- **Không dùng** nhân vật, nhạc, hình ảnh của game / phim khác; "tu tiên" là thể loại chung nhưng tên riêng, thuật ngữ độc đáo thương hiệu của game khác phải tránh (ví dụ tên chiêu, tên tông môn trùng).
- Mã nguồn mở dùng trong dự án: ghi giấy phép (MIT, Apache-2.0…), tránh GPL lây nếu không chủ ý.

### 5.3 Asset do AI tạo

- **Quyền tác giả** đối với sản phẩm do AI tạo: khả năng đăng ký và bảo hộ tại Việt Nam **cần kiểm tra**; chưa có thông lệ rõ ràng. Do đó asset định danh cốt lõi (logo, nhân vật chính, biểu tượng tông môn) phải có đóng góp sáng tạo đáng kể của họa sĩ ([18] §9.2 mục 6).
- **Rủi ro vi phạm:** mô hình có thể tái tạo nội dung giống tác phẩm có bản quyền; bắt buộc quy trình chỉnh tay và hồ sơ prompt ([18] §9.2).
- **Điều khoản của công cụ AI** có thể hạn chế dùng thương mại hoặc cần ghi công — ghi vào hồ sơ giấy phép.

### 5.4 Hộp ngẫu nhiên (loot box / gacha) và xác suất

- **Mặc định MVP: không bán hộp ngẫu nhiên** ([15](15-kiem-tien-liveops.md) §3 #13, câu hỏi Q4). Thưởng ngẫu nhiên **trong game** (rơi đồ, rương boss) dùng bảng xác suất 07 §6, không bán bằng tiền thật.
- **Nếu có sau này:** cần luật sư xem xét có bị coi là hình thức cờ bạc / trò chơi may rủi có thưởng hay không (Việt Nam cấm cờ bạc và có quy định riêng cho game có thưởng — **cần kiểm tra**); **công khai tỷ lệ**; có hạn mức; không dùng cho vật phẩm sức mạnh (đã cấm ở [15] §3); cần xem quy định của Apple / Google về hộp ngẫu nhiên.
- **Sự kiện có thưởng bằng tiền thật hoặc quà vật chất:** quy định khuyến mại / trúng thưởng (L25) — **cần kiểm tra** trước khi tổ chức.

## 6. Quy trình cập nhật tài liệu này

- Mọi kết luận của luật sư ghi vào đây bằng một dòng "**Đã xác minh <ngày> bởi <ai>**" trong cột "Chắc?" tương ứng; mục chưa có dòng này vẫn là "Kiểm tra".
- Khi luật thay đổi ảnh hưởng thiết kế (giờ chơi, xác thực, hạn mức chi tiêu), tạo dòng quyết định mới trong [DECISIONS.md](DECISIONS.md) và sửa tài liệu chịu ảnh hưởng ([15], [16], [17]).
- Nếu phát hành ngoài Việt Nam (Web mở toàn cầu hoặc cửa hàng ứng dụng quốc tế), cần thêm một checklist riêng cho từng thị trường (ví dụ luật bảo vệ dữ liệu cá nhân và bảo vệ trẻ em ở nơi đó); tài liệu này **chỉ** bao quát Việt Nam.

## Câu hỏi cần chốt

| #   | Câu hỏi                                                                                                               | Mặc định đề xuất                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Q1  | Ai là luật sư / công ty luật phụ trách xác minh §4 và khi nào (trước closed beta)?                                    | Thuê tư vấn chuyên game / TMĐT / dữ liệu cá nhân tại Việt Nam trước khi có người chơi ngoài đội |
| Q2  | Thư viện i18n cho client Cocos Creator (ví dụ bộ có hỗ trợ ICU MessageFormat) và định dạng tệp                        | Dùng tệp JSON `vi-VN` + thư viện ICU nhẹ; chốt sau thử nghiệm kích thước gói                    |
| Q3  | Hạng mục phông: chọn Be Vietnam Pro / Noto Serif hay phông khác; có thuê phông trả phí không?                         | Phông OFL, cắt tập con; Hán tự bằng sprite                                                      |
| Q4  | Hosting cục bộ → khi nào chuyển đám mây, và có yêu cầu lưu trữ trong nước (L16) không?                                | Giữ hạ tầng trong nước hoặc nhà cung cấp có vùng tại Việt Nam cho đến khi luật sư xác nhận      |
| Q5  | Đăng ký MVP username + mật khẩu có đủ khi luật có thể yêu cầu xác thực (L8)? Có thêm số điện thoại / định danh không? | Chờ ý kiến luật sư; thiết kế tầng Auth mở rộng được bước xác thực                               |
| Q6  | Cơ chế giờ chơi cho người dưới 18 (L9): cần khai báo tuổi lúc đăng ký?                                                | Có, khai báo ngày sinh khi đăng ký + áp dụng giới hạn bảo thủ cho tài khoản chưa xác minh       |
| Q7  | Có phát hành ngoài Việt Nam ở MVP không?                                                                              | Không; chỉ Việt Nam. Ngôn ngữ `en` sau MVP                                                      |
| Q8  | Có cho phép hộp ngẫu nhiên sau này không?                                                                             | Không trong MVP; quyết định lại sau tư vấn pháp lý                                              |
| Q9  | Tên thương hiệu "Vạn Giới Tiên Đồ" là tên tạm — ai tra cứu nhãn hiệu (L27)?                                           | Người phụ trách dự án giao cho luật sư SHTT trước khi đăng ký tên miền và cửa hàng ứng dụng     |
