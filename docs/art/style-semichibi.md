# Phong cách semi-chibi premium — D44

Chủ dự án đã duyệt hướng concept ngày 2026-11-08: “ổn đó triển khai luôn”. Đây là chuẩn mỹ thuật cho bộ Player mới; các sheet concept là tham chiếu, chưa phải sprite sản xuất. [D44](../DECISIONS.md) sửa hướng phong cách của D37/D42/D43, giữ phương pháp AI từng khung của D41 và 5 hướng vẽ + lật theo D14. Bộ cũ được giữ để đối chiếu, không tự động thay thế trong game.

## Tỉ lệ và khuôn mặt cố định

**[Cập nhật D44: dùng chung [sheet dựng tỉ lệ bốn Đạo Lộ](semichibi-proportions.svg).]** Sheet là vector có mốc đo thật, không phải thước do AI vẽ và không thay mặt/costume master. Chuẩn hóa chiều cao đứng H từ đỉnh khối tóc chính đến đế chân; cùng H danh định **216 px @2x (108 px @1x), dung sai pipeline ±3%** cho bốn lớp. Ô logical 256 px, vạch đất 232 để lại khoảng 16 px trên đỉnh danh định cho tóc/trâm. Đây là khóa master mỹ thuật đã đo, không thêm hằng số tooling. Vũ khí giơ cao, mảnh nổi và FX dùng lớp riêng hoặc ngoại lệ pose khai báo; không thu nhỏ thân.

| Mốc dựng        | Dải theo H                     | Cách đo                                                      |
| --------------- | ------------------------------ | ------------------------------------------------------------ |
| Đầu + tóc chính | 20–24%, mục tiêu 22%           | Từ đỉnh khối tóc bám sọ đến cằm; không cộng đuôi tóc/sợi bay |
| Đường mắt       | 15–17% dưới đỉnh, mục tiêu 16% | Mốc dựng mặt; giữ đặc điểm mặt master khi xoay hướng         |
| Vai Kiếm tu     | 26–30%                         | Hai mỏm vai giải phẫu, không tính giáp/áo                    |
| Vai Thể tu      | 30–34%                         | Rộng chắc hơn, không tăng chiều cao thân                     |
| Vai Pháp tu     | 24–28%                         | Không đo theo bề ngang tay áo                                |
| Vai Đan/Phù tu  | 24–28%                         | Không đo theo phất trần/phù                                  |

Các dải vai/mắt là chỉ dẫn dựng mỹ thuật cho master, không phải collider hay giá trị gameplay. Ảnh T1 cũ chưa được đo/khóa không tự thành master chuẩn; chỉnh chiều cao và đầu trước, rồi mới khóa mặt và tạo turnaround. Không bóp méo riêng mặt hoặc chuẩn hóa chiều cao từng frame để che sai lệch.

**Quy ước đỉnh áp dụng cho cả H và đầu:** đỉnh khối tóc chính bám sọ, loại trừ búi cao, topknot, đuôi ngựa, đồ trang trí và sợi bay. Các phần đó có thể vượt lên trên phong bì cơ thể. Chiều cao bbox alpha toàn hình (gồm búi/vũ khí/VFX) là số đo chẩn đoán riêng, không phải H giải phẫu.

- Mục tiêu khoảng **4,5 đầu**, khối đầu + tóc chính khoảng **22% chiều cao**; tay và bàn chân nhỏ, thân/chân gọn. Đo cùng một quy ước ở mọi hướng; tóc đuôi ngựa và sợi bay không được làm sai phép đo. Không tin các thước tỉ lệ do AI tự vẽ.
- Khuôn mặt người trưởng thành được cách điệu, không phải mặt em bé. Mỗi Đạo Lộ có **một mặt cố định**, không tùy biến mặt cho người chơi. Biểu cảm được đổi nhưng cấu trúc mắt, mũi, hàm và chân tóc phải bám master.
- Ánh sáng chính từ Tây Bắc; dáng, trang phục, vũ khí phải đọc được khi nhân vật hiển thị khoảng 110 px ở 1×. Đây là cỡ kiểm tra mỹ thuật, không đổi hằng số runtime.

| Đạo Lộ     | Mặt và tóc khóa theo concept                                                                    | Nền / nhấn / kim loại                  |
| ---------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| Kiếm tu    | Nam, mắt hạnh xám, mày thẳng, mũi nhỏ thẳng, hàm góc mềm; tóc đen buộc cao, hai lọn mái         | Ngà / cyan, bóng navy / vàng champagne |
| Thể tu     | Nam, da rám, hàm vuông, mắt hổ phách, mày dày; tóc đen vuốt ngắn, búi nhỏ                       | Than / cam hổ phách / vàng đồng        |
| Pháp tu    | Nữ, mặt oval, mắt nâu dài, mày cong, nốt ruồi dưới mắt phải; tóc đen buộc nửa, trâm đỏ tách đôi | Mận mực / đỏ son / vàng nhạt           |
| Đan/Phù tu | Nữ, mặt tròn mềm nhưng trưởng thành, mắt nâu olive, mày thanh thẳng; búi ngọc gấp, hai lọn dài  | Ngà ấm / jade / vàng cổ                |

Chi tiết nhỏ trên mặt không được là tín hiệu nhận diện duy nhất vì sẽ mất ở cỡ chơi thật. Master sản xuất phải khóa lại phép đo và đặc điểm mặt từ concept được duyệt; không coi mọi biến thể AI trong sheet là đúng.

## Nét, bóng và chất liệu

Viền sạch, nhuộm theo chất liệu, không dùng đen thuần: navy trên vải ngà, mận tối trên vải đỏ, xanh đậm trên jade, nâu trên vàng. Cel shading **2 tông + 1 highlight**, thêm rim light hẹp để nổi trên bản đồ tối; tránh viền trắng dày như sticker và bóng airbrush nhiều lớp.

Mỗi lớp có một màu nền, một màu nhấn đặc trưng và viền kim loại; màu da/tóc và bóng trung tính là màu hỗ trợ. Ngọn vải có gradient nhấn, mực loang ở gấu áo/VFX; hoa văn kinh mạch hình học thưa tạo chất cyber-xianxia, không chuyển thành giáp khoa học viễn tưởng. Tay áo, đuôi đai và tóc có chuyển động trễ rồi lắng; số khung/nhịp chính thức theo bảng v2 khi tooling công bố, không sao chép bảng tạm vào mã.

## Silhouette bắt buộc

| Đạo Lộ     | Yếu tố không được mất     | Kiểm tra                                                     |
| ---------- | ------------------------- | ------------------------------------------------------------ |
| Kiếm tu    | Kiếm quá cỡ + dải lụa     | Kiếm rút cầm tay; tách đường kiếm/lụa khỏi thân              |
| Thể tu     | Cặp quyền giáp + đai hông | Tay nhỏ còn đọc được trong quyền giáp, thân gọn chắc         |
| Pháp tu    | Quạt mở + tay áo dài      | Có khoảng trống giữa quạt và tay áo, không biến thành trượng |
| Đan/Phù tu | Phất trần + phù nổi       | Tua trắng mềm khác lưỡi kiếm; phù là mảng chữ nhật rõ        |

Giữ các yếu tố từ T1 đến T5. Không dùng mặt, hoa văn nhỏ hoặc màu đơn thuần thay silhouette. Vũ khí cao cấp có tỉ lệ lớn nhưng không che mặt và tay.

## Cấp hình dáng trang bị

Cả **trang phục và vũ khí** đổi hình theo mốc cảnh giới. Cùng mặt, tóc, vóc người và tỉ lệ cơ thể ở tất cả cột; hào quang có thể mở rộng ngoài cơ thể.

| Cấp | Nhóm cảnh giới      | Trang phục và vũ khí                                             |
| --- | ------------------- | ---------------------------------------------------------------- |
| T1  | Luyện Khí           | Vải trơn, vũ khí đơn giản; giữ silhouette Đạo Lộ                 |
| T2  | Trúc Cơ–Kim Đan     | Viền, đồ trang trí nhỏ; vũ khí có tua                            |
| T3  | Nguyên Anh–Hóa Thần | Áo nhiều lớp, miếng vai; vũ khí gắn ngọc, sáng nhẹ               |
| T4  | Luyện Hư–Hợp Thể    | Đuôi vải dài cầu kỳ; vũ khí nguyên tố có vệt, hạt hào quang thưa |
| T5  | Đại Thừa–Độ Kiếp    | Mảnh nguyên tố nổi / pháp tướng; vũ khí biến hình                |

Đây là nhóm **9 cảnh giới hiện hành**, không thêm cảnh giới mới và không đổi cân bằng. Trang phục cosmetic và skin vũ khí **bán riêng**; giá, cửa hàng, chỉ số và quyền lợi còn cần **chủ dự án xác nhận rõ** theo docs/30 §5. D44 không ủy quyền triển khai shop hoặc thanh toán; theo dõi [OPEN-ITEMS §13 D44-01](../OPEN-ITEMS.md#13-semi-chibi-d44-hợp-đồng-và-nghiệm-thu-còn-mở).

**D44 bắt buộc sửa hợp đồng xuất D41 thành các lớp body + weapon + FX (D45, worker 27 đang xây dựng, chưa chốt/triển khai đầy đủ).** Chỉ giữ phương pháp vẽ AI từng khung và các cổng D41; **không giữ nguyên hợp đồng một body slot display-swap** và không khẳng định exporter hiện tại hỗ trợ đổi áo/skin vũ khí độc lập. Cần chốt socket/occlusion, đồng bộ frame, thứ tự vẽ và ghép runtime; không vẽ lại mọi tổ hợp áo × vũ khí × tier. Theo dõi D44-02; runtime tint/glow ở D44-03 và thủ tục khóa/đo canonical master ở D44-04 trong OPEN-ITEMS §13. Concept không đóng các khoảng trống đó.

## Phẩm chất độc lập với cấp hình dáng

Theo D6 và [05 §7](../05-ui-ux-icon.md), sáu phẩm: Trắng `#E8E4DA`, Lục `#5FBF6A`, Lam `#4A90D9`, Tím `#A05FD6`, Vàng `#E8B540`, Đỏ `#E0483A`. **Không vẽ lại** hình dáng theo phẩm: dùng tint viền / glow lúc chạy trên cùng asset. Không nhuộm cả vũ khí, đổi ngọc hoặc mất màu nhận diện Đạo Lộ. Màu Vàng phẩm chất cần khác với viền kim loại vàng vật liệu. Nhãn và dấu góc UI theo D6/05 vẫn cần để không phụ thuộc màu.

Sheet vũ khí minh họa cùng T3 ở sáu tint; AI vẫn có lệch nhỏ hình dáng, nên chúng không phải bằng chứng pixel giống nhau hay shader đã hoạt động.

## Tham chiếu, nguồn gốc và giới hạn

[Bộ concept được duyệt](../../assets-src/placeholder/chibi-concept-v1/README.md) chứa 4 sheet T3, 4 dải T1–T5, 4 sheet vũ khí, mock sáng/tối, lineup và các lần sinh bị thay. Prompt nguyên văn, tool, model không công bố, UTC tệp đầu ra, SHA-256 và ảnh tham chiếu nằm trong `provenance.json`. Không có ảnh mẫu thương mại nào được cung cấp cho phiên sinh; chỉ dùng mô tả phong cách chung và ảnh dự án.

Các lỗi phải sửa trước khi khóa master: mặt/chi tiết fitting lệch giữa pose; Kiếm tu đuôi tóc làm phép đo mơ hồ; T3→T4 Kiếm tu đổi áo chưa mạnh; lưng Pháp tu thiếu quạt; pose thiền Đan/Phù tu thêm sen và bỏ phất trần; T1 Thể tu/Đan còn trang trí thừa. Lineup có hạt màu ở viền. Mock gốc có nhân vật khoảng 240 px dù chữ AI ghi “1x”; trang duyệt HTML trong artifact thu nhỏ và có phép so riêng 110 CSS px, không phải capture engine. Baseline chính xác là `current-kiem-tu-reference.png`; baseline trong mock/lineup là AI vẽ lại.

Concept chưa xác minh animation, đủ hướng, socket, lớp body/vũ khí/FX, atlas, hiệu năng hay tích hợp Cocos. Tăng số khung chỉ là điều kiện cần: nghiệm thu chuyển động còn phải kiểm tra trượt chân, giữ mặt/tỉ lệ, nhịp anticipation–impact–follow-through, đường nối vòng lặp và tóc/vải trễ. Giữ các cổng D41; không đánh dấu các bước chưa chạy là đã đạt.
