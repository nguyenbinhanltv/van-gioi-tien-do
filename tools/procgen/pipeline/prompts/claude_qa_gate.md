# Nhiệm vụ: kiểm duyệt chất lượng asset (QA gate) – chỉ đọc, không sửa asset

Đầu vào:
- `reports/qa_raw.json`: kết quả kiểm định xác định (kích thước, tỷ lệ 2:1, atlas ≤ 2048, tham chiếu JSON).
- `build/raw/tilemap/tileset.json`, `build/raw/tilemap/map.json`, `build/raw/items/swords/flying_sword_frames.json`.
- Ảnh mẫu: `build/raw/tilemap/map_preview.png`, `build/raw/items/swords/flying_sword_sheet_*.png`,
  `build/raw/items/icons/pills_sheet.png`, `build/raw/items/icons/talismans_sheet.png`, `build/raw/render/*.png`.

Việc cần làm:
1. Đọc `reports/qa_raw.json`. Mọi mục trong `errors` là lỗi chặn; giải thích ngắn nguyên nhân khả dĩ và file cần sửa.
2. Xem các ảnh mẫu và kiểm tra những điều script không đo được:
   - bản đồ có lộ đường lưới, khe sáng giữa các ô hoặc vệt lặp quá rõ không;
   - phi kiếm có đủ 8 hướng, hướng nào bị cắt mép ô, lật sai hay méo không;
   - icon có bị cắt mép, nền không trong suốt, hay phẩm cao trông kém hơn phẩm thấp không;
   - ảnh chụp shader có tia sét, khiên hiển thị hay bị đen / trắng toàn khung không.
3. Ghi `reports/qa_review.md` (tiếng Việt, ngắn gọn, mỗi vấn đề một dòng kèm file).
4. Ghi `reports/qa_verdict.json` đúng dạng:
   `{"verdict": "pass" | "warn" | "fail", "blocking_issues": ["..."], "notes": ["..."]}`
   - "fail" nếu `qa_raw.json` có lỗi hoặc có lỗi hình ảnh khiến asset không dùng được trong game.
   - "warn" nếu chỉ có vấn đề thẩm mỹ nhỏ.
   - "pass" nếu không có vấn đề.

Không sửa, xóa hay tạo file nào ngoài hai file báo cáo trên.
