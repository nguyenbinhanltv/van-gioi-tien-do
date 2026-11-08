# Thể tu — tài sản dùng chung và ảnh tham chiếu

Theo quyết định chủ dự án ngày 2026-11-06, nhân vật người chơi chuyển sang sprite sheet AI từng frame. PR #104 không được merge; nhánh cũ được giữ để tra cứu. Gói này chỉ cứu lại tài sản còn dùng được, không phải bản sản xuất sprite sheet đã duyệt.

Đường dẫn gốc giữ tên lịch sử `assets-src/placeholder/the-tu-continuous-v1/` để các tham chiếu trong prompt không bị thay đổi:

- `icons/`: 8 icon kỹ năng, 1 biểu tượng class, 1 icon bộ quyền sáo; nguồn 256 px và các cỡ 48/64/128 px.
- `portrait/`: chân dung Thể tu A “Sơn Môn Hộ Vệ”.
- `vfx/`: 18 preview tĩnh; `raw/vfx/` giữ ảnh AI và prompt gốc, `reference/shared/vfx/` giữ ảnh tham chiếu trung gian của các preview. Đây chưa phải chuỗi frame hiệu ứng.
- `raw/icons/`, `raw/portrait/`: ảnh AI nguồn và metadata nguyên bản.
- `reference/`: concept/turnaround do chủ dự án cung cấp, master E/S/SE/NE/N và bản thử E dùng làm đầu vào cho master được chọn. Master giữ vai trò tham chiếu nhận diện, không chứng nhận chất lượng chuyển động.

Không có part cơ thể, key-pose, rig, atlas, export DragonBones hoặc tài sản runtime Cocos trong PR này. Không tạo ảnh mới trong đợt tách gói. Sản xuất sprite sheet Thể tu chờ chủ dự án chấp nhận vòng chất lượng Kiếm tu E.

## Nguồn gốc và kiểm tra

`*.generation.json` giữ đầy đủ prompt, `image_gen.imagegen`, model không được công cụ công bố, phiên bản Codex CLI, UTC đã ghi nhận và image ID. Mốc UTC thiếu trong lịch sử vẫn được ghi rõ, không suy đoán lại. `concept-a.source.json` lưu nguồn upstream. Không dùng đường dẫn riêng của máy làm định danh.

`derived-outputs.json` liệt kê SHA-256 từng ảnh và nhóm license tương ứng trong `docs/ASSET-LICENSES.md`. Mốc inventory là thời điểm tách gói, không phải thời điểm tạo ảnh. Mọi ảnh vẫn mang trạng thái `AI-generated, placeholder, needs hand-polish + license review before release`, phát hành `no`.

Chạy kiểm tra UTF-8, đường dẫn riêng tư, bảng license và hash:

```sh
node assets-src/placeholder/the-tu-continuous-v1/verify-provenance.mjs
```

Hàm `inspectText` độc lập với định dạng nhân vật/rig; phần CLI chỉ kiểm tra gói tài sản này. Bổ sung hoặc thay ảnh phải cập nhật inventory và dòng license cùng lúc.
