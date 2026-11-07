# Thể tu — sprite sheet N (D41)

Hướng N của “Sơn Môn Hộ Vệ” có đủ 15 clip / 126 frame, dùng master đã lưu qua #113. Giữ nguyên sheet đã duyệt, không sinh lại ảnh và không scale riêng từng frame.

## Calibration và QA

`N/calibration.json` khóa tỷ lệ chuẩn hóa `0.9033149171270718` từ 32 mẫu upright. Mỗi sheet dùng `calibration.referenceHeight` theo DPI gốc. Không ép sheet hit có ô không vuông qua square-cell preparation.

`prepare-directional-qa.ts N` đo hai đế giày trên master, khóa stance ngang 49 px rồi tạo guide QA mới cho walk/run. Hai clip giữ chuyển động dọc bằng `vertical: keep`. Template sinh ảnh gốc và các sheet giữ nguyên; JSON gốc được lưu đúng byte trong `raw/generation-guides/`, manifest active được kiểm tra theo nội dung JSON.

`qa-migration.json` ghi SHA input, phép đo stance và scale. `quality-backlog.x-baseline.json` giữ lịch sử metric x cũ. Metric theo hướng mới không phải số cũ được đổi tên; prune baseline cũ không có nghĩa là art đã sửa.

QA có 0 hard failure, 0 mềm chưa ghi và 0 regression; 29 finding mềm được ghi theo clip/ô/value/limit. Hai finding thủ công ghi idle ô 5 dùng guard ô 7 và emote ô 4 dùng salute ô 2. Proof giữ nguyên bảy ô còn lại, donor run và trim viền magenta được lưu trong raw; không dùng backlog để nới height upright, similarity, loop seam hay export.

## Tái tạo

```sh
node tools/rig/scripts/run-ts.mjs assets-src/placeholder/the-tu-sprites-v1/prepare-directional-qa.ts N
npm run sprite:build -w @vgtd/sprite -- --project assets-src/placeholder/the-tu-sprites-v1/N/project.json --out <thu-muc-tam>
npm run sprite:batch -w @vgtd/sprite -- --batch assets-src/placeholder/the-tu-sprites-v1/batch-N.json --out <thu-muc-tam> --capture
```

Capture mới và SHA output được ghi trong `N/export/engine-gate.json`; audit pixel atlas nằm trong `atlas-pixel-evidence.json`. Contract `baseline-*` và `capture-index.json` chỉ là bằng chứng trước chuyển QA theo hướng; backup không có engine gate riêng cho N. Runtime chỉ nhận skeleton, atlas JSON/PNG, contract `.sprite.json` và metadata.

License tái tạo bằng `node assets-src/placeholder/the-tu-sprites-v1/write-license.mjs N`; kiểm tra bằng `node assets-src/placeholder/the-tu-sprites-v1/verify-provenance.mjs --dir N`. Prompt/tool/model không công bố/CLI/UTC được giữ trong raw metadata. Tất cả vẫn là placeholder AI, cần hand-polish và license review trước phát hành; release `no`.
