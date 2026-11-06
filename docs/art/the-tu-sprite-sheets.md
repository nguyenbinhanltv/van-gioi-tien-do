# Thể tu — sprite sheet AI từng frame (D41)

## Phạm vi lượt E

Thể tu A “Sơn Môn Hộ Vệ”: giữ concept và master năm hướng đã lưu qua PR #113. Thân người chơi dùng ảnh từng frame, không dùng mesh uốn tay/chân. Hướng E được sản xuất trước; SE/S/NE/N tiếp tục theo từng PR sau khi E qua gate.

Gói nguồn: `assets-src/placeholder/the-tu-sprites-v1/E/`. Có đủ 15 clip và 156 frame; số ô của lượt đầu lấy từ bảng `ANIMATIONS` trước khi API layout khuyến nghị được bổ sung. Hiện timing, kind và danh sách clip lấy từ `SPRITE_CLIPS`/`projectClipDefaults`; số ô đã sinh được giữ nguyên, không resample để vừa atlas. `attack_2` là chưởng trái, `attack_3` là đập đất hai quyền. Alias `sword_fly` dùng tư thế bay không đạo cụ, không thêm kiếm cho Thể tu.

## Hiệu chuẩn và sửa ô

Master E cao 217 px trên canvas 256. Một hệ số nhân vật chuẩn hóa theo ô được khóa từ median của 30 mẫu idle/walk/run; `calibration.json` giữ từng mẫu và công thức. `sync-dpi.mjs` chỉ quy đổi hệ số đó theo DPI của mỗi sheet. Không có scale riêng từng frame. Idle cuối cao 219 px, walk 214–216 px, run 212–218 px, đều trong dải ±3%.

Đả tọa lượt đầu bị vẽ đầu/thân quá lớn; lượt hai dùng guide ngồi, giữ ảnh bị loại và prompt gốc trong `raw/`. Ô hồi thế cuối của ground slam được chép từ guard đầu của cùng sheet, không scale; `raw/attack_3.recovery-repair.json` chứng minh 9 ô còn lại không đổi. Chênh một pixel biên do kích thước sheet lẻ chỉ chứa nền magenta, đã kiểm tra trước khi chép.

Run khai báo chân trụ R ở ô 0/1/2, L ở ô 5/6/7; ô 3/4/8/9 là pha bay theo hình vẽ. Walk giữ contact theo template; việc đảo chân chưa mạnh và trượt chân được ghi rõ trong backlog. Các exception seated, die-collapse, punch-lunge, raised-gauntlets, ground-slam-crouch và brace-bend mô tả tư thế thực tế; không thay đổi ngưỡng QA.

## Chất lượng lượt đầu

`quality-backlog.json` và `.md` dùng schema chính thức của `@vgtd/sprite`. Mỗi lỗi mềm có clip/hướng/ô 0-based, metric, value, limit và ghi chú; tăng quá giá trị đã ghi (+1%) là regression. Không nhận lỗi thiếu frame, chiều cao upright, similarity, loop seam hoặc export vào backlog. Các quan sát đảo chân được nhập từ `manual-art-findings.json` vào mảng `manual` qua CLI của pipeline (#124), tách khỏi số đo tự động và không tự được đánh dấu đã sửa. Lượt đầu giữ lỗi mềm theo chính sách chủ dự án “làm toàn bộ nhân vật đi xong cải tiến dần trong mỗi assets”.

Packer shelf ban đầu cần hai trang; tổng trim có padding là 3.906.947 px². MaxRects đã lên main qua #122, giữ đủ 156 frame trên một trang 2048 PMA, padding 2 và extrude 1. Build trên main qua gate: 0 hard failure, 0 mềm chưa ghi, 0 regression, 12 finding mềm đã chấp nhận. Ba file hình/animation byte-identical với bản Cocos 3.8.8 đã capture trước reset; #123 giữ nguyên phép đo E và chỉ cập nhật trục cho hướng khác. Kiểm tra pixel atlas ghi nhận 0 lỗi PMA, 0 lỗi extrude và 0 pixel thừa trong padding. Capture trên main dùng zoom 2 và lấy mẫu midpoint cho đủ 15 clip; bằng chứng và SHA runtime nằm trong `E/export/engine-gate.json`.

## Tái tạo

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/the-tu-sprites-v1/E/prepare.ts
node assets-src/placeholder/the-tu-sprites-v1/E/sync-dpi.mjs
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/the-tu-sprites-v1/E/project.json --out <thu-muc-tam>
```

`prepare.ts` giữ nguyên template và layout đã có để bảo toàn đầu vào của prompt, chỉ lấy timing/kind từ bảng công khai. Repair lặp lại từ raw bằng `repair-recovery.ts`; template ngồi tái tạo bằng `meditate-template.ts`. Cocos resources nhận đủ output contract #122: `_ske.json`, `_tex.json`, `_tex.png`, `.sprite.json` và `.meta` cần thiết. Viewer đọc `.sprite.json` để tìm các trang texture; không đưa rig/assembly hoặc authoring intermediate vào resources.

Capture thật dùng `apps/client-cocos/scripts/capture.mjs --zoom 2 --sample midpoint --gif`, mode single, hướng E, đủ 15 clip. GIF/contact sheet nằm trong artifact phiên; không commit capture hoặc file trung gian build. Trang review dùng `sprite:review` của pipeline chung.

Prompt, công cụ `image_gen.imagegen`, model không công bố, `codex-cli 0.166.0`, UTC và image ID được lưu trong metadata cùng `docs/ASSET-LICENSES.md`. Mọi ảnh vẫn là placeholder AI, cần hand-polish và license review trước phát hành; release `no`. Không ghi đường dẫn riêng tư của máy trong commit.
