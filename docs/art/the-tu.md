# Thể tu — tài sản và sprite sheet AI từng frame (D41)

> Gộp từ `the-tu-sprite-sheets` (lượt E), `the-tu-shared-art` và `the-tu-sprites-{SE,S,NE,N}`: cùng một khuôn ghi chú sản xuất theo hướng. Thân người chơi là sprite sheet AI từng khung theo [sprite-sheet-pipeline.md](sprite-sheet-pipeline.md). Nội dung từng hướng giữ nguyên, tiêu đề hạ một cấp.

## Hướng E (từ the-tu-sprite-sheets.md)

### Phạm vi lượt E

Thể tu A “Sơn Môn Hộ Vệ”: giữ concept và master năm hướng đã lưu qua PR #113. Thân người chơi dùng ảnh từng frame, không dùng mesh uốn tay/chân. Hướng E được sản xuất trước; SE/S/NE/N tiếp tục theo từng PR sau khi E qua gate.

Gói nguồn: `assets-src/placeholder/the-tu-sprites-v1/E/`. Có đủ 15 clip và 156 frame; số ô của lượt đầu lấy từ bảng `ANIMATIONS` trước khi API layout khuyến nghị được bổ sung. Hiện timing, kind và danh sách clip lấy từ `SPRITE_CLIPS`/`projectClipDefaults`; số ô đã sinh được giữ nguyên, không resample để vừa atlas. `attack_2` là chưởng trái, `attack_3` là đập đất hai quyền. Alias `sword_fly` dùng tư thế bay không đạo cụ, không thêm kiếm cho Thể tu.

### Hiệu chuẩn và sửa ô

Master E cao 217 px trên canvas 256. Một hệ số nhân vật chuẩn hóa theo ô được khóa từ median của 30 mẫu idle/walk/run; `calibration.json` giữ từng mẫu và công thức. `sync-dpi.mjs` chỉ quy đổi hệ số đó theo DPI của mỗi sheet. Không có scale riêng từng frame. Idle cuối cao 219 px, walk 214–216 px, run 212–218 px, đều trong dải ±3%.

Đả tọa lượt đầu bị vẽ đầu/thân quá lớn; lượt hai dùng guide ngồi, giữ ảnh bị loại và prompt gốc trong `raw/`. Ô hồi thế cuối của ground slam được chép từ guard đầu của cùng sheet, không scale; `raw/attack_3.recovery-repair.json` chứng minh 9 ô còn lại không đổi. Chênh một pixel biên do kích thước sheet lẻ chỉ chứa nền magenta, đã kiểm tra trước khi chép.

Run khai báo chân trụ R ở ô 0/1/2, L ở ô 5/6/7; ô 3/4/8/9 là pha bay theo hình vẽ. Walk giữ contact theo template; việc đảo chân chưa mạnh và trượt chân được ghi rõ trong backlog. Các exception seated, die-collapse, punch-lunge, raised-gauntlets, ground-slam-crouch và brace-bend mô tả tư thế thực tế; không thay đổi ngưỡng QA.

### Chất lượng lượt đầu

`quality-backlog.json` và `.md` dùng schema chính thức của `@vgtd/sprite`. Mỗi lỗi mềm có clip/hướng/ô 0-based, metric, value, limit và ghi chú; tăng quá giá trị đã ghi (+1%) là regression. Không nhận lỗi thiếu frame, chiều cao upright, similarity, loop seam hoặc export vào backlog. Các quan sát đảo chân được nhập từ `manual-art-findings.json` vào mảng `manual` qua CLI của pipeline (#124), tách khỏi số đo tự động và không tự được đánh dấu đã sửa. Lượt đầu giữ lỗi mềm theo chính sách chủ dự án “làm toàn bộ nhân vật đi xong cải tiến dần trong mỗi assets”.

Packer shelf ban đầu cần hai trang; tổng trim có padding là 3.906.947 px². MaxRects đã lên main qua #122, giữ đủ 156 frame trên một trang 2048 PMA, padding 2 và extrude 1. Build trên main qua gate: 0 hard failure, 0 mềm chưa ghi, 0 regression, 12 finding mềm đã chấp nhận. Ba file hình/animation byte-identical với bản Cocos 3.8.8 đã capture trước reset; #123 giữ nguyên phép đo E và chỉ cập nhật trục cho hướng khác. Kiểm tra pixel atlas ghi nhận 0 lỗi PMA, 0 lỗi extrude và 0 pixel thừa trong padding. Capture trên main dùng zoom 2 và lấy mẫu midpoint cho đủ 15 clip; bằng chứng và SHA runtime nằm trong `E/export/engine-gate.json`.

### Tái tạo

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/the-tu-sprites-v1/E/prepare.ts
node assets-src/placeholder/the-tu-sprites-v1/E/sync-dpi.mjs
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/the-tu-sprites-v1/E/project.json --out <thu-muc-tam>
```

`prepare.ts` giữ nguyên template và layout đã có để bảo toàn đầu vào của prompt, chỉ lấy timing/kind từ bảng công khai. Repair lặp lại từ raw bằng `repair-recovery.ts`; template ngồi tái tạo bằng `meditate-template.ts`. Cocos resources nhận đủ output contract #122: `_ske.json`, `_tex.json`, `_tex.png`, `.sprite.json` và `.meta` cần thiết. Viewer đọc `.sprite.json` để tìm các trang texture; không đưa rig/assembly hoặc authoring intermediate vào resources.

Capture thật dùng `apps/client-cocos/scripts/capture.mjs --zoom 2 --sample midpoint --gif`, mode single, hướng E, đủ 15 clip. GIF/contact sheet nằm trong artifact phiên; không commit capture hoặc file trung gian build. Trang review dùng `sprite:review` của pipeline chung.

Prompt, công cụ `image_gen.imagegen`, model không công bố, `codex-cli 0.166.0`, UTC và image ID được lưu trong metadata cùng `docs/ASSET-LICENSES.md`. Mọi ảnh vẫn là placeholder AI, cần hand-polish và license review trước phát hành; release `no`. Không ghi đường dẫn riêng tư của máy trong commit.

## Tài sản dùng chung và ảnh tham chiếu (từ the-tu-shared-art.md)

Theo quyết định chủ dự án ngày 2026-11-06, nhân vật người chơi chuyển sang sprite sheet AI từng frame. PR #104 không được merge; nhánh cũ được giữ để tra cứu. Gói này chỉ cứu lại tài sản còn dùng được, không phải bản sản xuất sprite sheet đã duyệt.

Đường dẫn gốc giữ tên lịch sử `assets-src/placeholder/the-tu-continuous-v1/` để các tham chiếu trong prompt không bị thay đổi:

- `icons/`: 8 icon kỹ năng, 1 biểu tượng class, 1 icon bộ quyền sáo; nguồn 256 px và các cỡ 48/64/128 px.
- `portrait/`: chân dung Thể tu A “Sơn Môn Hộ Vệ”.
- `vfx/`: 18 preview tĩnh; `raw/vfx/` giữ ảnh AI và prompt gốc, `reference/shared/vfx/` giữ ảnh tham chiếu trung gian của các preview. Đây chưa phải chuỗi frame hiệu ứng.
- `raw/icons/`, `raw/portrait/`: ảnh AI nguồn và metadata nguyên bản.
- `reference/`: concept/turnaround do chủ dự án cung cấp, master E/S/SE/NE/N và bản thử E dùng làm đầu vào cho master được chọn. Master giữ vai trò tham chiếu nhận diện, không chứng nhận chất lượng chuyển động.

Không có part cơ thể, key-pose, rig, atlas, export DragonBones hoặc tài sản runtime Cocos trong PR này. Không tạo ảnh mới trong đợt tách gói. Sản xuất sprite sheet Thể tu chờ chủ dự án chấp nhận vòng chất lượng Kiếm tu E.

### Nguồn gốc và kiểm tra

`*.generation.json` giữ đầy đủ prompt, `image_gen.imagegen`, model không được công cụ công bố, phiên bản Codex CLI, UTC đã ghi nhận và image ID. Mốc UTC thiếu trong lịch sử vẫn được ghi rõ, không suy đoán lại. `concept-a.source.json` lưu nguồn upstream. Không dùng đường dẫn riêng của máy làm định danh.

`derived-outputs.json` liệt kê SHA-256 từng ảnh và nhóm license tương ứng trong `docs/ASSET-LICENSES.md`. Mốc inventory là thời điểm tách gói, không phải thời điểm tạo ảnh. Mọi ảnh vẫn mang trạng thái `AI-generated, placeholder, needs hand-polish + license review before release`, phát hành `no`.

Chạy kiểm tra UTF-8, đường dẫn riêng tư, bảng license và hash:

```sh
node assets-src/placeholder/the-tu-continuous-v1/verify-provenance.mjs
```

Hàm `inspectText` độc lập với định dạng nhân vật/rig; phần CLI chỉ kiểm tra gói tài sản này. Bổ sung hoặc thay ảnh phải cập nhật inventory và dòng license cùng lúc.

## Hướng SE (từ the-tu-sprites-SE.md)

Hướng SE của “Sơn Môn Hộ Vệ” có đủ 15 clip / 126 frame, dùng master đã lưu qua #113. Giữ nguyên sheet được chủ dự án duyệt; không tạo lại ảnh và không scale riêng từng frame.

### DPI và template gốc

`SE/calibration.json` khóa tỷ lệ chuẩn hóa nhân vật `0.9199549041713642` từ 32 mẫu upright ban đầu. Mọi clip khai báo `calibration.referenceHeight` bằng tỷ lệ này nhân chiều cao ô raw; đây là đường per-sheet calibration được audit #129 hỗ trợ. Không dùng `square-cell-dpi-v1` vì sheet hit có ô thật sự không vuông; pipeline không được bóp hình để ép ô vuông.

Các PNG/JSON trong `templates/` là đầu vào sinh ảnh gốc, không bị ghi đè. Guide dash gốc 4 cột được lưu riêng trong `raw/dash.attempt1.template.*`; ảnh thật có 3 cột × 2 hàng nên layout đang chọn là 3 × 2. Đây là sửa mô tả lưới, không resample ảnh.

### QA theo hướng sau #123

`prepare-directional-qa.ts SE` đo hai đế giày trong dải đáy master bằng public `soleRuns`/`nearestSole2D`, rồi chiếu khoảng cách lên phương vuông góc véc-tơ mặt đất. Stance khóa ở **27,73 px**, trước khi xem số đo clip. Walk/run dùng `vertical: keep` và manifest mới trong `qa-templates/`; ảnh và calibration giữ nguyên.

`qa-migration.json` lưu phép đo, SHA master, bốn input template cũ và toàn bộ sheet đang chọn. PNG input giữ nguyên byte; JSON gốc được giữ nguyên byte trong `raw/generation-guides/*.json.txt`, còn manifest active được so sánh theo nội dung JSON để không nhầm whitespace do formatter với thay đổi guide. Metric mới là `slide_ground_px_per_frame_*` và `ghost_distance_2d_px_*`. Snapshot `quality-backlog.x-baseline.json` giữ các số x cũ; prune chúng không có nghĩa là art đã được sửa.

Lượt đo mới có 0 hard failure, 15 finding mềm mới và 13 warning chiều cao clip free còn phù hợp; sau khi ghi baseline, build có 0 mềm chưa ghi / 0 regression / 28 warning đã chấp nhận. Backlog chính thức ghi từng clip/ô/value/limit; mảng `manual` tách riêng hai quan sát đảo chân. Không dùng chúng để nới height upright, similarity, loop seam hoặc cổng export.

### Tái tạo

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/the-tu-sprites-v1/prepare-directional-qa.ts SE
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/the-tu-sprites-v1/SE/project.json --out <thu-muc-tam>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/the-tu-sprites-v1/batch-SE.json --out <thu-muc-tam> --capture
```

Capture cũ trong `export/baseline-*` chỉ là bằng chứng trước khi chuyển QA. Capture mới bằng Cocos Creator 3.8.8, zoom 2 và lấy mẫu midpoint, đã tải đủ 15 clip; toàn bộ bốn file output khớp byte với export cuối. `export/engine-gate.json` lưu SHA và số liệu, `atlas-pixel-evidence.json` ghi 0 lỗi PMA, 0 lỗi extrude và 0 pixel thừa trong padding. Cocos resources chỉ nhận skeleton, atlas JSON/PNG, `.sprite.json` mà viewer đọc và `.meta`; không nhận authoring intermediates.

Log license tái tạo bằng `node assets-src/placeholder/the-tu-sprites-v1/write-license.mjs SE`; guard dùng `node assets-src/placeholder/the-tu-sprites-v1/verify-provenance.mjs --dir SE`. Sau khi tái tạo guide, format các JSON sinh lại trước khi commit; recipe giữ byte input gốc và kiểm tra nội dung manifest độc lập với whitespace.

Prompt/tool/model không công bố/CLI/UTC, raw gốc, donor và repair proof được giữ trong gói nguồn. Tất cả vẫn là placeholder AI, cần hand-polish và license review trước phát hành; release `no`.

## Hướng S (từ the-tu-sprites-S.md)

Hướng S của “Sơn Môn Hộ Vệ” có đủ 15 clip / 126 frame, dùng master đã lưu qua #113. Giữ nguyên sheet đã duyệt, không sinh lại ảnh và không scale riêng từng frame.

### Calibration và QA

`S/calibration.json` khóa tỷ lệ chuẩn hóa `0.9086809470124013` từ 32 mẫu upright. Mỗi sheet dùng `calibration.referenceHeight` theo DPI gốc. Không ép sheet hit có ô không vuông qua square-cell preparation.

`prepare-directional-qa.ts S` đo hai đế giày trên master, khóa stance ngang 63 px rồi tạo guide QA mới cho walk/run. Hai clip giữ chuyển động dọc bằng `vertical: keep`. Template sinh ảnh gốc và các sheet giữ nguyên; JSON gốc được lưu đúng byte trong `raw/generation-guides/`, manifest active được kiểm tra theo nội dung JSON.

`qa-migration.json` ghi SHA input, phép đo stance và scale. `quality-backlog.x-baseline.json` giữ lịch sử metric x cũ. Metric theo hướng mới không phải số cũ được đổi tên; prune baseline cũ không có nghĩa là art đã sửa.

QA có 0 hard failure, 0 mềm chưa ghi và 0 regression; 27 finding mềm được ghi theo clip/ô/value/limit. Một finding thủ công ghi run ô 0 giữ pose tiếp xúc của ô 1 sau ba lần gọi AI. Các repair proof và raw bị loại vẫn được giữ; không dùng backlog để nới height upright, similarity, loop seam hay export.

### Tái tạo

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/the-tu-sprites-v1/prepare-directional-qa.ts S
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/the-tu-sprites-v1/S/project.json --out <thu-muc-tam>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/the-tu-sprites-v1/batch-S.json --out <thu-muc-tam> --capture
```

Capture và SHA output được ghi trong `S/export/engine-gate.json`; audit pixel atlas nằm trong `atlas-pixel-evidence.json`. Snapshot `baseline-*` chỉ là bằng chứng trước chuyển QA theo hướng. Runtime chỉ nhận skeleton, atlas JSON/PNG, contract `.sprite.json` và metadata.

License tái tạo bằng `node assets-src/placeholder/the-tu-sprites-v1/write-license.mjs S`; kiểm tra bằng `node assets-src/placeholder/the-tu-sprites-v1/verify-provenance.mjs --dir S`. Prompt/tool/model không công bố/CLI/UTC được giữ trong raw metadata. Tất cả vẫn là placeholder AI, cần hand-polish và license review trước phát hành; release `no`.

## Hướng NE (từ the-tu-sprites-NE.md)

Hướng NE của “Sơn Môn Hộ Vệ” có đủ 15 clip / 126 frame, dùng master đã lưu qua #113. Giữ nguyên sheet đã duyệt, không sinh lại ảnh và không scale riêng từng frame.

### Calibration và QA

`NE/calibration.json` khóa tỷ lệ chuẩn hóa `0.9177001127395716` từ 32 mẫu upright. Mỗi sheet dùng `calibration.referenceHeight` theo DPI gốc. Không ép sheet hit có ô không vuông qua square-cell preparation.

`prepare-directional-qa.ts NE` đo hai đế giày trên master, khóa stance ngang 22,36 px rồi tạo guide QA mới cho walk/run. Hai clip giữ chuyển động dọc bằng `vertical: keep`. Template sinh ảnh gốc và các sheet giữ nguyên; JSON gốc được lưu đúng byte trong `raw/generation-guides/`, manifest active được kiểm tra theo nội dung JSON.

`qa-migration.json` ghi SHA input, phép đo stance và scale. `quality-backlog.x-baseline.json` giữ lịch sử metric x cũ. Metric theo hướng mới không phải số cũ được đổi tên; prune baseline cũ không có nghĩa là art đã sửa.

QA có 0 hard failure, 0 mềm chưa ghi và 0 regression; 26 finding mềm được ghi theo clip/ô/value/limit. Một finding thủ công ghi run ô 10 giữ pose ô 9 sau ba lần gọi AI. Các repair proof và raw bị loại vẫn được giữ; không dùng backlog để nới height upright, similarity, loop seam hay export.

### Tái tạo

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/the-tu-sprites-v1/prepare-directional-qa.ts NE
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/the-tu-sprites-v1/NE/project.json --out <thu-muc-tam>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/the-tu-sprites-v1/batch-NE.json --out <thu-muc-tam> --capture
```

Capture và SHA output được ghi trong `NE/export/engine-gate.json`; audit pixel atlas nằm trong `atlas-pixel-evidence.json`. Snapshot `baseline-*` chỉ là bằng chứng trước chuyển QA theo hướng. Runtime chỉ nhận skeleton, atlas JSON/PNG, contract `.sprite.json` và metadata.

License tái tạo bằng `node assets-src/placeholder/the-tu-sprites-v1/write-license.mjs NE`; kiểm tra bằng `node assets-src/placeholder/the-tu-sprites-v1/verify-provenance.mjs --dir NE`. Prompt/tool/model không công bố/CLI/UTC được giữ trong raw metadata. Tất cả vẫn là placeholder AI, cần hand-polish và license review trước phát hành; release `no`.

## Hướng N (từ the-tu-sprites-N.md)

Hướng N của “Sơn Môn Hộ Vệ” có đủ 15 clip / 126 frame, dùng master đã lưu qua #113. Giữ nguyên sheet đã duyệt, không sinh lại ảnh và không scale riêng từng frame.

### Calibration và QA

`N/calibration.json` khóa tỷ lệ chuẩn hóa `0.9033149171270718` từ 32 mẫu upright. Mỗi sheet dùng `calibration.referenceHeight` theo DPI gốc. Không ép sheet hit có ô không vuông qua square-cell preparation.

`prepare-directional-qa.ts N` đo hai đế giày trên master, khóa stance ngang 49 px rồi tạo guide QA mới cho walk/run. Hai clip giữ chuyển động dọc bằng `vertical: keep`. Template sinh ảnh gốc và các sheet giữ nguyên; JSON gốc được lưu đúng byte trong `raw/generation-guides/`, manifest active được kiểm tra theo nội dung JSON.

`qa-migration.json` ghi SHA input, phép đo stance và scale. `quality-backlog.x-baseline.json` giữ lịch sử metric x cũ. Metric theo hướng mới không phải số cũ được đổi tên; prune baseline cũ không có nghĩa là art đã sửa.

QA có 0 hard failure, 0 mềm chưa ghi và 0 regression; 29 finding mềm được ghi theo clip/ô/value/limit. Hai finding thủ công ghi idle ô 5 dùng guard ô 7 và emote ô 4 dùng salute ô 2. Proof giữ nguyên bảy ô còn lại, donor run và trim viền magenta được lưu trong raw; không dùng backlog để nới height upright, similarity, loop seam hay export.

### Tái tạo

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/the-tu-sprites-v1/prepare-directional-qa.ts N
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/the-tu-sprites-v1/N/project.json --out <thu-muc-tam>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/the-tu-sprites-v1/batch-N.json --out <thu-muc-tam> --capture
```

Capture mới và SHA output được ghi trong `N/export/engine-gate.json`; audit pixel atlas nằm trong `atlas-pixel-evidence.json`. Contract `baseline-*` và `capture-index.json` chỉ là bằng chứng trước chuyển QA theo hướng; backup không có engine gate riêng cho N. Runtime chỉ nhận skeleton, atlas JSON/PNG, contract `.sprite.json` và metadata.

License tái tạo bằng `node assets-src/placeholder/the-tu-sprites-v1/write-license.mjs N`; kiểm tra bằng `node assets-src/placeholder/the-tu-sprites-v1/verify-provenance.mjs --dir N`. Prompt/tool/model không công bố/CLI/UTC được giữ trong raw metadata. Tất cả vẫn là placeholder AI, cần hand-polish và license review trước phát hành; release `no`.
