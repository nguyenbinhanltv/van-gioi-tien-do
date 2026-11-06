# Pháp tu B — hướng S

Đủ 15 clip / 126 khung, D42 quạt mở ở tay phải giải phẫu (bên trái người xem). `preparation: square-cell-dpi-v1` dùng calibration chung `208/237`. Walk/run `vertical: keep`, guide S đo khoảng cách ngang hai boot 43.407867 px; không UNMEASURED opt-out, không scale từng khung.

QA tự động: 0 lỗi cứng, 27 finding mềm trong quality-backlog.json, giữ số đo clip/cell/metric/value/limit. Meditate 0–7 khai báo seated, die 4–7 khai báo die-collapse theo D41: 12 ô bỏ generic standing similarity; phép đo thô giữ trong hợp đồng xuất. Cổng này không chứng nhận so sánh đứng cho tư thế ngồi/nằm.

Nguồn đầu giữ nguyên. Hit đầu yêu cầu 4×1 nhưng công cụ trả ô chữ nhật 3:1; bị loại, dùng reroll 2×2 với template mới riêng, không bóp méo ảnh. Meditate đầu bị vẽ lớn; reroll vẽ lại tư thế ngồi với kích thước đầu/thân theo idle, không scale riêng khung. Walk chỉ sửa ô 3,4,7,8,9; run chỉ sửa 2,7,8. `repair.ts` tái tạo lựa chọn, `sheets/*.repair.json` chứng minh hash các ô khác không đổi. DPI của cả sheet edit được đăng ký đồng nhất trước khi lấy ô.

`prepare-guides.ts` là provenance tạo project/template trước khi sinh ảnh; không chạy lại sau lựa chọn vì sẽ ghi đè project. Tái tạo sản phẩm từ project.json đã commit bằng sprite:build/batch, không cần chạy script này. `repair.ts` chỉ dùng để tái tạo các ô đã chọn.

Capture thật Cocos Creator 3.8.8 đã hoàn tất cả 15 clip, zoom 2, midpoint, exit 0. Artifact B-S-review của phiên lưu GIF và contact sheet. Repository typecheck/test/build/lint/format:check đều đạt; PNG dùng Git LFS, từng file có dòng giấy phép placeholder.
