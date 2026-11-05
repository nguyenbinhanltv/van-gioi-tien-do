# Nhiệm vụ: sửa lỗi script sinh asset (chỉ chạy khi bước generate_raw_assets thất bại)

Bối cảnh: repo `tutien-procgen` sinh asset Tu Tiên 2D Isometric bằng code. Lần chạy vừa rồi thất bại.
Log lỗi nằm ở `reports/generate_raw_assets.log`.

Yêu cầu:
1. Đọc log, tìm nguyên nhân gốc trong `src/` (không đoán; chạy lại lệnh để tái hiện).
2. Sửa tối thiểu trong `src/` để hai lệnh sau chạy thành công:
   - `node src/tilemap/generate_tilemap.js --seed "$SEED" --width "$MAP_W" --height "$MAP_H" --out build/raw/tilemap`
   - `node src/items/generate_items.js --seed "$SEED" --swordTier "$SWORD_TIER" --out build/raw/items`
3. Ràng buộc bắt buộc:
   - Không đổi định dạng đầu ra (tên file, khóa JSON trong tileset.json, map.json, flying_sword_frames.json).
   - Giữ tính xác định: cùng seed phải ra cùng kết quả; không dùng Math.random hay thời gian hệ thống.
   - Giữ tile tỷ lệ 2:1 (tileW = 2 × tileH) và atlas ≤ 2048.
   - Không thêm thư viện npm; không sửa `shaders/`, `pipeline/`, `tools/`.
4. Chạy lại cả hai lệnh để xác nhận, rồi trả lời ngắn gọn: nguyên nhân, file đã sửa, kết quả chạy lại.
