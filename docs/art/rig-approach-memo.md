# Memo quyết định: cách làm rig cho nhân vật 4 Đạo Lộ

Ngày 2026-11-06. Người viết: worker 15 (`@vgtd/rig`). Người quyết: chủ dự án. **Không đổi dữ liệu rig trên main.** Số liệu "đo" lấy từ `npm run rig:measure` (chỉ số seam đã sửa ở PR #89: một khe chỉ tính khi đỉnh của mảnh phía trước không được mảnh nào khác che). Số "ước" được ghi rõ.

## 1. Vấn đề

Kiếm tu hiện tại: mỗi mảnh là một hình chữ nhật **cắt từ một ảnh đã hoàn chỉnh**, nên vùng bị che (dưới áo, sau cánh tay) **không có pixel**. Khi khớp gập, mối nối hở. Skinning chỉ kéo giãn pixel có sẵn, không tạo pixel mới.

| bộ dữ liệu (Kiếm tu, 15 clip × 5 hướng)        | seam hở (rigid)    | clip bị rách         | ghi chú                                                      |
| ---------------------------------------------- | ------------------ | -------------------- | ------------------------------------------------------------ |
| main                                           | 90 (tối đa 8,6 px) | 25                   | đo                                                           |
| #88 `081060b`, rigid                           | 215 (17,9 px)      | 32                   | đo; mảnh phình ra nhưng thiếu màu dưới mảnh kề               |
| #88 `081060b` + autoSkin band 16               | 88 (7,0 px)        | 10                   | đo                                                           |
| #88 `254b66c` + autoSkin (số của orchestrator) | 1190 cảnh báo      | 10, xấu nhất 37,5 px | 211 sự kiện giãn, tối đa 695 %: autoSkin đổi khe lấy độ giãn |

Khe hở và độ giãn là **hai mặt của cùng một thiếu hụt**: thiếu pixel ẩn. Thêm đỉnh hay chỉnh trọng số chỉ đổi chỗ xuất hiện lỗi.

## 2. Các phương án

### A. Giữ "cắt từ một ảnh" + thêm topology mesh (contour mesh, nhiều đỉnh, chỉnh trọng số từng khớp)

- **Chất lượng:** trần thấp. Mỗi khớp cần tối thiểu `ceil(w·sin(θ/2))` px màu ẩn (đầu gối 17, hông 14, vai 14, khuỷu 11 @1x, xem `parts-spec.md`); ảnh nguồn không có. Contour mesh chỉ bám viền tốt hơn. Dự đoán: mức #88 + autoSkin (88 mở, 10 rách) gần với tốt nhất đạt được, độ giãn còn hàng trăm %.
- **Công sức:** mỗi lần thử rẻ, nhưng đã lặp nhiều vòng không hội tụ; mỗi lớp mới lại chỉnh tay (ước 2-4 ngày/lớp, không đảm bảo kết quả).
- **Hiệu năng/RAM:** hiện 124-132 đỉnh/hướng, atlas 512×512 mỗi hướng (~60 KB PNG). Contour mesh ước ×3-5 → 400-700 đỉnh/hướng; 30 skeleton × 700 ≈ 21k đỉnh skinning/frame, vẫn nhẹ so với ngân sách docs/06 (≤ 80 draw call, 30 skeleton). Không phải điểm nghẽn.
- **Dùng lại cho 4 lớp:** thấp, chỉnh tay nhân 4.

### B. Vẽ lại từng bộ phận thành mảnh đầy đủ ("vẽ để rig") theo `parts-spec.md`

- **Chất lượng:** cao nhất, giải đúng nguyên nhân: mỗi chi có đủ phần ẩn và nắp khớp, mảnh phía sau kéo dài dưới mảnh phía trước đúng `margin` trong bảng. Đủ margin thì khe hở bằng 0 theo công thức (có test: margin không vượt bề rộng mối nối). Ước: seam hở gần 0, không có sự kiện giãn (như skinning cứng hiện tại: 0).
- **Công sức:** lớn lúc đầu: mỗi hướng ≈ 13-15 mảnh (body chia đảo, 2 tay, outfit trên/dưới, head, hair, weapon) × 5 hướng × 4 lớp ≈ 300 mảnh. Ước 3-5 ngày cho lớp đầu, 1-2 ngày mỗi lớp sau (template và `parts-spec.md` đã sinh sẵn). Rủi ro chính: đồng nhất phong cách giữa các mảnh sinh bằng Codex (mục 4).
- **Hiệu năng/RAM:** mảnh đầy đủ lớn hơn ~30-50 % diện tích (phần ẩn): ước atlas 512×512 vẫn đủ hoặc 512×1024 mỗi hướng; ASTC 4×4 ≈ 0,26-0,5 MB/hướng, ≈ 1,3-2,5 MB/lớp. Số đỉnh không đổi (~130). Nằm trong ngân sách docs/06 (ô 512×512 @1x trong trang động 2048 chứa 16 nhân vật).
- **Dùng lại:** cao: mảnh là dữ liệu theo bộ trang phục, animation là dữ liệu chung (đúng mô hình paperdoll docs/03).

### C. Lai: xương cho thân/chi + đổi sprite theo khung cho biến dạng khó (tay áo, vạt áo)

- **Chất lượng:** tốt cho phần mềm: đổi giữa 3-5 biến thể vẽ sẵn thay vì uốn mesh. Vẫn cần B cho thân/chi, nên C là **bổ sung** cho B.
- **Công sức:** +30-60 % so với B cho các slot áo/vạt (mỗi slot 3-5 biến thể × 5 hướng), thêm authoring "chọn biến thể theo góc khớp" (DragonBones có `displayIndex` theo khung; exporter cần hỗ trợ, ước 1-2 ngày).
- **Hiệu năng/RAM:** atlas ×1,3-1,6 so với B (ước 2-4 MB/lớp ASTC); không thêm draw call nếu cùng trang atlas.
- **Dùng lại:** trung bình, biến thể phụ thuộc kiểu trang phục.

### D. Sprite sheet từng khung, dựng từ rig/3D, cho người chơi

- **Chất lượng:** ổn định (mỗi khung là ảnh hoàn chỉnh, không có khe), nhưng mất tách lớp paperdoll và đổi trang phục động.
- **Hiệu năng/RAM (ước theo docs/03: ô 128×128, atlas 2048 = 256 ô, mỗi lớp ~6 atlas/giới tính):** 15 clip × ~12 khung × 5 hướng (3 hướng lật) ≈ 900 ô/bộ trang phục ≈ 3,5-6 atlas 2048 ≈ 14-24 MB ASTC 4×4 (4 MB/atlas), 56-96 MB không nén, **cho mỗi lớp mỗi bộ trang phục**. Với 7 lớp × 40 bộ (docs/03) vượt ngân sách tải và RAM; đúng lý do docs/03 chọn skeleton.
- **Công sức:** cao, không dùng lại giữa trang phục.
- **Dùng hạn chế:** quái/NPC đông, icon, ảnh xem trước; không dùng cho người chơi.

## 3. Bảng so sánh

|                            | A mesh thêm                   | B vẽ lại mảnh đầy đủ        | C lai (B + đổi sprite)       | D sprite sheet             |
| -------------------------- | ----------------------------- | --------------------------- | ---------------------------- | -------------------------- |
| seam / độ giãn (Kiếm tu)   | tốt nhất: 88 mở, 10 rách (đo) | gần 0 (ước, theo công thức) | gần 0, tay áo mượt hơn (ước) | 0                          |
| công sức lớp đầu / lớp sau | 2-4 ngày, không đảm bảo       | 3-5 / 1-2 ngày              | +1-2 ngày trên B             | rất cao, không dùng lại    |
| RAM / lớp (ASTC)           | ~1 MB                         | 1,3-2,5 MB                  | 2-4 MB                       | 14-24 MB mỗi bộ trang phục |
| đổi trang phục             | có                            | có                          | có                           | không (mỗi bộ một sheet)   |
| rủi ro chính               | không hội tụ                  | đồng nhất phong cách mảnh   | thêm logic biến thể          | RAM / tải                  |

## 4. Khuyến nghị: **B**, thêm **C** cho tay áo/vạt khi B xong

Số đo cho thấy A đã chạm trần (đổi khe lấy độ giãn); D phá ngân sách docs/06 và paperdoll; B giải đúng nguyên nhân. Rủi ro lớn nhất của B là sinh ảnh theo mảnh bằng Codex: (1) đồng nhất màu/ánh sáng/viền giữa các mảnh, (2) vẽ đúng phần ẩn mà không đổi hình dáng. Giảm rủi ro:

1. Quy trình "vẽ cho rig": sinh **toàn bộ nhân vật ở một tư thế** làm tham chiếu, rồi mỗi mảnh sinh từ ảnh tham chiếu + mặt nạ vùng + yêu cầu kéo dài `margin` px dưới mảnh kề (số trong `parts-spec.md`).
2. Cổng kiểm tự động trước khi nhận mảnh: `rig:measure --strict` (khe hở ≤ 3 px, 0 rách, 0 giãn) và kiểm slot/margin của `parts.ts`.
3. Thử trước **một cặp chi** (tay phải + tay trái, hướng E) rồi đo; nếu không về ≤ 3 px với skinning cứng thì dừng và dùng C/D cho phần đó.

**Chưa làm bằng chứng nhỏ:** cần sinh ảnh bằng Codex (ngoài phạm vi worker này) và theo `vgtd-asset-pipeline` phải kiểm nguồn/giấy phép ảnh sinh trước. Có thể chạy ngay khi chủ dự án đồng ý, dùng `parts-spec.md` làm đặc tả và `rig:measure` làm bài đo; ước nửa ngày.

## 5. Quyết định cần chủ dự án

1. Chọn B (khuyến nghị), hoặc A, hoặc C/D cho phần nào.
2. Cho phép chạy thử B cho một cặp chi (Codex) và xác nhận nguồn/giấy phép ảnh sinh.
3. Giữ #88 (art tăng dần) và PR #89 (chỉ số + margin) làm nền; `seamSeverity` chỉ đổi sang `error` khi `rig:measure --strict` sạch.
