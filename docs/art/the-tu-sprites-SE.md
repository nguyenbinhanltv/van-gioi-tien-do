# Thể tu — sprite sheet SE (D41)

Hướng SE của “Sơn Môn Hộ Vệ” có đủ 15 clip / 126 frame, dùng master đã lưu qua #113. Giữ nguyên sheet được chủ dự án duyệt; không tạo lại ảnh và không scale riêng từng frame.

## DPI và template gốc

`SE/calibration.json` khóa tỷ lệ chuẩn hóa nhân vật `0.9199549041713642` từ 32 mẫu upright ban đầu. Mọi clip khai báo `calibration.referenceHeight` bằng tỷ lệ này nhân chiều cao ô raw; đây là đường per-sheet calibration được audit #129 hỗ trợ. Không dùng `square-cell-dpi-v1` vì sheet hit có ô thật sự không vuông; pipeline không được bóp hình để ép ô vuông.

Các PNG/JSON trong `templates/` là đầu vào sinh ảnh gốc, không bị ghi đè. Guide dash gốc 4 cột được lưu riêng trong `raw/dash.attempt1.template.*`; ảnh thật có 3 cột × 2 hàng nên layout đang chọn là 3 × 2. Đây là sửa mô tả lưới, không resample ảnh.

## QA theo hướng sau #123

`prepare-directional-qa.ts SE` đo hai đế giày trong dải đáy master bằng public `soleRuns`/`nearestSole2D`, rồi chiếu khoảng cách lên phương vuông góc véc-tơ mặt đất. Stance khóa ở **27,73 px**, trước khi xem số đo clip. Walk/run dùng `vertical: keep` và manifest mới trong `qa-templates/`; ảnh và calibration giữ nguyên.

`qa-migration.json` lưu phép đo, SHA master, bốn input template cũ và toàn bộ sheet đang chọn. PNG input giữ nguyên byte; JSON gốc được giữ nguyên byte trong `raw/generation-guides/*.json.txt`, còn manifest active được so sánh theo nội dung JSON để không nhầm whitespace do formatter với thay đổi guide. Metric mới là `slide_ground_px_per_frame_*` và `ghost_distance_2d_px_*`. Snapshot `quality-backlog.x-baseline.json` giữ các số x cũ; prune chúng không có nghĩa là art đã được sửa.

Lượt đo mới có 0 hard failure, 15 finding mềm mới và 13 warning chiều cao clip free còn phù hợp; sau khi ghi baseline, build có 0 mềm chưa ghi / 0 regression / 28 warning đã chấp nhận. Backlog chính thức ghi từng clip/ô/value/limit; mảng `manual` tách riêng hai quan sát đảo chân. Không dùng chúng để nới height upright, similarity, loop seam hoặc cổng export.

## Tái tạo

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/the-tu-sprites-v1/prepare-directional-qa.ts SE
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/the-tu-sprites-v1/SE/project.json --out <thu-muc-tam>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/the-tu-sprites-v1/batch-SE.json --out <thu-muc-tam> --capture
```

Capture cũ trong `export/baseline-*` chỉ là bằng chứng trước khi chuyển QA. Capture mới bằng Cocos Creator 3.8.8, zoom 2 và lấy mẫu midpoint, đã tải đủ 15 clip; toàn bộ bốn file output khớp byte với export cuối. `export/engine-gate.json` lưu SHA và số liệu, `atlas-pixel-evidence.json` ghi 0 lỗi PMA, 0 lỗi extrude và 0 pixel thừa trong padding. Cocos resources chỉ nhận skeleton, atlas JSON/PNG, `.sprite.json` mà viewer đọc và `.meta`; không nhận authoring intermediates.

Log license tái tạo bằng `node assets-src/placeholder/the-tu-sprites-v1/write-license.mjs SE`; guard dùng `node assets-src/placeholder/the-tu-sprites-v1/verify-provenance.mjs --dir SE`. Sau khi tái tạo guide, format các JSON sinh lại trước khi commit; recipe giữ byte input gốc và kiểm tra nội dung manifest độc lập với whitespace.

Prompt/tool/model không công bố/CLI/UTC, raw gốc, donor và repair proof được giữ trong gói nguồn. Tất cả vẫn là placeholder AI, cần hand-polish và license review trước phát hành; release `no`.
