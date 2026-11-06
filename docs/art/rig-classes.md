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

Với mỗi mối nối ở khớp, `partsSpec` nói **mảnh nào phải kéo dài vẽ bù dưới mảnh nào và bao nhiêu px**: `margin = ceil(w · sin(θ/2))` với w = **bề rộng thật của mối nối** tại khớp (`SEAM_WIDTH_PX`, chi/thân 10-26 px, lấy từ các mảnh Kiếm tu thật) và θ = **góc khớp lớn nhất mà bộ animation của lớp đòi hỏi**, đo trên rig (`measuredJointCaps`, làm tròn lên 5°, sàn 20°), không còn lấy bề rộng mảnh danh nghĩa. Mảnh nằm **sau** theo thứ tự vẽ của từng hướng (`drawOrderFor`) kéo dài xuống dưới mảnh nằm trước; các đảo của cùng một slot (chi trong `body`, `arm_*`) không có thứ tự nên cả hai cùng kéo dài. `docs/art/parts-spec.md` là bản sinh cho cả 4 lớp, CI kiểm khớp bản sinh mới; cập nhật bằng `RIG_GEN_PARTS_SPEC=1 npm run gen:parts-spec -w @vgtd/rig`. Đối chiếu: phần dư sau vòng 3 của Kiếm tu (gối 12-18 px, khuỷu 12-15 px, cổ chân 9 px) nằm trong dải margin của bảng.

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

## 8. Ráp chi liền theo lớp (`src/class-profile.ts`, `rig:assemble --class <id>`)

`AssemblyProfile` gom mọi thứ riêng của một lớp khi ráp theo D39: danh sách mảnh (thứ tự vẽ, kiểu gắn xương), xương của rig gốc bị bỏ, luật detail (đổi display theo hành động), dáng chạy (`GaitProfile`), hướng gập gối (`ikBend`) và luật vũ khí cho cổng QA. Thêm lớp = thêm một entry + thư mục mảnh, không thêm nhánh code. Rig Kiếm tu E vẫn là rig gốc cho vai trò xương, IK và socket; xương theo landmark của lớp, IK đặt lại theo mắt cá (`snapIk`).

**Thể tu A** (`THE_TU_PROFILE`, stem `thetu`): quyền sáo là 5 display mỗi bên (`gauntlet_{L,R}_{relaxed,guard,fist,open,ground}`) trên slot `hand_L` / `hand_R`, không có xương/slot kiếm, `weapon_R`, vỏ kiếm, trail hay glint. Tabard chia trước/sau gắn kiểu `skirt` + `spine` (`spineWeights`): phần trên hông theo xương sống như thân, phần dưới theo đùi và cánh váy `robe_front/back`. Cổ gộp vào thân, hai vai tabard gộp một slot, đai + nút gộp một mảnh theo xương sống; 2 đuôi đai và 2 lọn tóc dài là chain, lọn mái ngắn gắn cứng vào đầu. Mắt/mày/miệng đổi theo clip (mày qua `ClipDetail.extra`); mắt chỉ do `blink_cycle` giữ (trừ meditate), `eyes_angry` để dành cho runtime. Dáng chạy `THE_TU_GAIT`: nửa sải, gối nông vừa phải, bước giậm, nghiêng người; cả hai gối gập về phía trước (rig gốc gập gối R ra sau, bị áo dài che trong pilot Kiếm tu, nhưng với quần lộ chân thì thành chân vòng kiềng).

**Theo hướng** (`AssemblyProfile.piecesByDir`, `profilePieces(profile, dir)`; Thể tu: `THE_TU_PIECES_BY_DIR`): E / SE / S dùng thứ tự E (`restOrder` của art). **NE**: tay xa và tấm tabard trước nằm sau thân, tấm tabard sau đè lên thân (mang tag `outfit_upper`), tóc sau đè lên đầu (drawOrder NE), tay gần vẽ cuối; chỉ giữ rìa mặt thấy được (mắt, mày; không miệng, không tai). **N**: cả hai tay sau thân, tabard sau hiển thị, không có mặt (bỏ 11 swap mắt/mày/miệng + tai + lọn mái), tóc sau che đầu. Tên mảnh nguồn giữ nguyên; thiếu tệp chỉ bị báo, không chặn ráp. Tư thế đòn đánh và dáng đi từng hướng vẫn cần kiểm riêng (OPEN-ITEMS 11).
