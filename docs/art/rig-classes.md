# Pipeline cho 4 Đạo Lộ (`@vgtd/rig`, data-driven)

> Tổng quát hóa quy trình Kiếm tu (docs/art/rig-pipeline.md) cho Thể tu, Pháp tu, Đan/Phù tu. Concept của ba lớp còn chờ chủ dự án chọn; phần này chuẩn bị sẵn để art vẽ đúng ngay lần đầu và để rig/hoạt cảnh/xuất viewer chạy mà không thêm mã theo lớp.

## 1. Registry (`src/classes.ts`)

Mỗi lớp là một mục dữ liệu `CLASSES[id]`: tên, `stem` file viewer, luật vũ khí, quỹ đạo sprite (`orbit`), slot bắt buộc / tùy chọn, chuỗi chuyển động phụ riêng, giới hạn góc khớp (`caps`). Đường dẫn theo quy ước chung `characterPaths(id)`: dữ liệu `tools/rig/data/<id>.{assets,rig}.json`, gói viewer `apps/client-cocos/assets/resources/dragonbones/<id>/`.

| Lớp        | id           | stem       | Vũ khí và luật slot                                                                          | Quỹ đạo (sprite node) |
| ---------- | ------------ | ---------- | -------------------------------------------------------------------------------------------- | --------------------- |
| Kiếm tu    | `kiem-tu`    | `kiemtu`   | kiếm tay phải, `weapon_R` (+ biến thể lật), `sword_back` có nhưng ẩn khi kiếm trên tay       | phi kiếm ×1           |
| Thể tu     | `the-tu`     | `thetu`    | quyền sáo **mặc vào tay** (`arm_L`/`arm_R`), **không có** `weapon_R`; QA cấm hiện `weapon_R` | không                 |
| Pháp tu    | `phap-tu`    | `phaptu`   | pháp trượng hoặc quạt: `weapon_R` (+ biến thể lật); thêm chuỗi tay áo                        | không                 |
| Đan/Phù tu | `dan-phu-tu` | `danphutu` | phất trần hoặc bút phù: `weapon_R` (+ biến thể lật); đuôi phất trần là chuỗi phụ             | phù lục ×4            |

Luật `weapon` của QA (`runQa({ weapon })`): `'one'` đúng một `weapon_R` hiện mỗi khung và không hiện kiếm lưng cùng lúc; `'none'` (gauntlets) không được hiện `weapon_R`.

## 2. Đặc tả mảnh cho art (`src/parts.ts`, `docs/art/parts-spec.md`)

Từ góc khớp lớn nhất mà bộ animation của lớp yêu cầu, `partsSpec` tính số px **vẽ bù** mỗi mảnh phải kéo dài dưới mảnh kề ở mỗi khớp: `overlap = ceil(2·r·sin(θ/2))` (r = nửa bề rộng mảnh kề, θ = góc khớp), khớp số đo Kiếm tu (đùi/robe 31 px đo được, công thức 33; vest/tay áo 20 đo được, công thức 21). `docs/art/parts-spec.md` là bản sinh tự động cho cả 4 lớp (slot, bắt buộc/tùy chọn, rộng danh nghĩa, vẽ bù từng khớp), CI kiểm khớp bản sinh mới; cập nhật bằng `RIG_GEN_PARTS_SPEC=1 npm run gen:parts-spec -w @vgtd/rig`.

## 3. Sinh rig mẫu từ thư mục mảnh (`src/template.ts`)

`scanPartsFolder('parts', id)` đọc `parts/<HƯỚNG>/<slot>.png` (kích thước PNG ÷ texture scale) → `PartsManifest`; `checkPartsManifest` kiểm luật lớp (slot bắt buộc, vũ khí, `sword_back`, không có `orbit_*`, kích thước); `buildRigTemplate` sinh `RigSet` 5 hướng: bộ xương người chuẩn, slot theo thứ tự vẽ `@vgtd/character` của từng hướng, mảnh quad có trọng số (cùng dạng dữ liệu Kiếm tu nên `autoSkin`, QA, bộ xuất dùng nguyên), chuỗi phụ theo lớp, vũ khí theo luật lớp. `packTemplateAtlas` xếp atlas pow2 tạm (trước khi có packer của dự án).

## 4. Re-target hoạt cảnh (`src/class-clips.ts`)

Mọi lớp dùng lại bộ Kiếm tu (chạy, đi, dash, hit, chết, đả tọa, độ kiếp, emote...) và chỉ ghi đè thứ phụ thuộc vũ khí: combo 3 đòn, cast, channel, tư thế idle. Ghi đè là **bảng pose theo lớp** (`CLASS_CLIPS`: windup/hit, gather/release, pose + tremor), dựng bằng vài hàm chung, nên thêm lớp là thêm bảng. Thể tu: guard + đấm/móc/chưởng đôi + giậm đất; Pháp tu: gậy/quạt vung, đâm hai tay, giơ gậy niệm; Đan/Phù tu: phất trần, vẽ phù, ném phù lục bằng tay trái. `authorClassSet(id, rig)` ra đủ 15 clip, qua cùng cổng QA (kể cả luật vũ khí).

## 5. Xuất cho viewer theo nhân vật (`src/characters.ts`)

`loadCharacterData(repoRoot, id)` đọc dữ liệu theo registry (báo lỗi rõ khi chưa có dữ liệu); `buildViewerPackage` / `writeViewerPackage` xuất `<stem>_<HƯỚNG>_{ske,tex}.json + _tex.png` vào thư mục viewer của nhân vật (mở bằng `#viewer&src=dragonbones/<id>&stem=<stem>`). Lệnh: `RIG_EXPORT_DIR=<thư mục> npm run export:character -w @vgtd/rig` (Kiếm tu hiện tại; lớp khác khi có dữ liệu).

## 6. Thêm một nhân vật

1. Chọn concept, art vẽ theo `parts-spec.md` (đã có vẽ bù).
2. `scanPartsFolder` → `checkPartsManifest` → `buildRigTemplate`; ghi `tools/rig/data/<id>.rig.json` và `<id>.assets.json` (atlas bằng packer dự án).
3. `authorClassSet` + QA; `autoSkin`/`underpaintNeeds` để đo; xuất viewer; thêm hàng `ASSET-LICENSES.md`.

## 7. Giới hạn đã biết

- Pose ghi đè của ba lớp mới là bản đầu theo mô tả docs/11, chưa duyệt trong viewer; `sword_fly` dùng lại clip Kiếm tu cho mọi lớp (cần biến thể theo vũ khí khi có concept).
- Chưa có dữ liệu thật của ba lớp: test dùng rig mẫu sinh từ kích thước danh nghĩa.
