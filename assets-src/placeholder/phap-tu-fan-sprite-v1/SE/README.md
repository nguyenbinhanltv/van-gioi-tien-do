# Pháp tu B — hướng SE

Đủ 15 clip / 126 khung theo bảng công khai. Dùng `preparation: square-cell-dpi-v1`, calibration chung `208/237`; walk/run giữ `vertical: keep`, guide hướng SE có đo stance width 19.366 px. Không dùng opt-out UNMEASURED, không scale riêng khung.

QA: 0 lỗi cứng, 45 finding mềm được ghi rõ clip/cell/metric/value/limit trong quality-backlog.json; 3 finding thủ công mở (walk/run đảo chân yếu ở ô 0/6, attack lệch góc thân ở ô 4/5). Khai báo seated cho meditate 0–7 và die-collapse cho die 4–7 theo D41; 12 ô này bỏ so sánh generic standing similarity, phép đo thô giữ trong hợp đồng xuất. Các chiều cao tư thế tự do còn lại được liệt kê trong backlog.

Run: bản đầu co chân quá sâu; reroll1 cải thiện, repair2 chỉ thay ô 0,1,2,3,5,7,8,9. Die chỉ sửa ô 3 để giữ tỷ lệ thân khi bắt đầu quỳ. `repair.ts` tái tạo lựa chọn; `sheets/*.repair.json` giữ hash mọi ô trước/sau, không scale hình riêng. Tất cả bản thô và prompt được giữ nguyên.

Provenance: tám prompt attack/attack_2/attack_3/cast/channel/dash/sword_fly/tribulation có tiền tố `undefined` do biến ngữ cảnh không tồn tại trong phiên sinh; các file generation.json giữ chính xác prompt đã gửi, không sửa lịch sử. Hai ảnh tham chiếu vẫn được truyền cho mỗi lần gọi. Các ảnh này phải qua cùng QA và duyệt hình như mọi clip khác.

Tái tạo: chạy `node tools/rig/scripts/run-ts.mjs assets-src/placeholder/phap-tu-fan-sprite-v1/SE/repair.ts`, rồi `sprite:batch --batch assets-src/placeholder/phap-tu-fan-sprite-v1/SE/batch.json --out <artifact> --capture` trong workspace @vgtd/sprite. Capture thật Cocos 3.8.8 đã hoàn tất cho cả 15 clip, zoom 2, lấy mẫu midpoint, exit 0; GIF và contact sheet nằm trong artifact B-SE-review của phiên.
