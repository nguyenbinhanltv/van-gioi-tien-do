# Đặc tả mảnh (parts SPEC) cho từng Đạo Lộ

> Sinh tự động bởi `partsSpecMarkdown` (`@vgtd/rig`): chạy `npm run gen:parts-spec -w @vgtd/rig` để cập nhật; CI kiểm file này khớp bản sinh mới. Mục đích: vẽ đúng ngay lần đầu để rig không hở mối nối.

**Quy tắc chung.** Canvas 128 × 128 @1x, pivot (64, 116); vẽ ở texture 2× (256 × 256), hình học 1×. Mỗi hướng vẽ (S, SE, E, NE, N) có bộ mảnh riêng `parts/<HƯỚNG>/<slot>.png`, PNG RGBA premultiplied alpha, padding atlas 2 px (`BUDGETS.ATLAS_PADDING_PX`), nền trong suốt. SW/W/NW là lật gương, không vẽ. **Phần vẽ bù (overlap)** ở bảng dưới là số px @1x mỗi mảnh phải kéo dài _dưới_ mảnh kề ở mỗi khớp để khớp gập tới giới hạn vẫn không lộ nền (công thức `ceil(2·r·sin(θ/2))`, r = nửa bề rộng mảnh kề, θ = góc khớp lớn nhất của bộ animation của lớp). Nhân đôi số px khi vẽ ở texture 2×. Không dán ảnh nền lên chỗ hở bằng cách dãn mesh.

## Kiếm tu (`kiem-tu`)

Vũ khí: sword (slot weapon_R + weapon_R_mirrored). Texture 2×, atlas padding 2 px.

| slot           | bắt buộc | rộng danh nghĩa (px) | vẽ bù theo khớp (px @1x, góc tối đa)                                                                                    |
| -------------- | :------: | -------------------: | ----------------------------------------------------------------------------------------------------------------------- |
| `wing`         | tùy chọn |                   20 | —                                                                                                                       |
| `cape`         | tùy chọn |                   20 | —                                                                                                                       |
| `sword_back`   | tùy chọn |                   20 | —                                                                                                                       |
| `hair_back`    |    có    |                   30 | neck **16** (40°)                                                                                                       |
| `body`         |    có    |                   22 | neck **16** (40°), waist **14** (35°), shoulder **35** (150°), hip **33** (90°), knee **38** (110°), ankle **16** (40°) |
| `outfit_lower` |    có    |                   46 | hip **33** (90°), knee **38** (110°)                                                                                    |
| `outfit_upper` |    có    |                   36 | waist **14** (35°), shoulder **35** (150°), neck **16** (40°)                                                           |
| `head`         |    có    |                   26 | neck **16** (40°)                                                                                                       |
| `hair_front`   |    có    |                   28 | neck **16** (40°)                                                                                                       |
| `headwear`     | tùy chọn |                   30 | neck **16** (40°)                                                                                                       |
| `arm_L`        |    có    |                   12 | shoulder **35** (150°), elbow **34** (140°), wrist **18** (60°)                                                         |
| `arm_R`        |    có    |                   12 | shoulder **35** (150°), elbow **34** (140°), wrist **18** (60°)                                                         |
| `weapon_R`     |    có    |                   10 | wrist **18** (60°)                                                                                                      |

## Thể tu (`the-tu`)

Vũ khí: gauntlets (worn on arm_L / arm_R, no weapon_R). Texture 2×, atlas padding 2 px.

| slot           | bắt buộc | rộng danh nghĩa (px) | vẽ bù theo khớp (px @1x, góc tối đa)                                                                                    |
| -------------- | :------: | -------------------: | ----------------------------------------------------------------------------------------------------------------------- |
| `cape`         | tùy chọn |                   20 | —                                                                                                                       |
| `hair_back`    |    có    |                   30 | neck **12** (30°)                                                                                                       |
| `body`         |    có    |                   22 | neck **12** (30°), waist **16** (40°), shoulder **32** (120°), hip **27** (70°), knee **36** (100°), ankle **16** (40°) |
| `outfit_lower` |    có    |                   46 | hip **27** (70°), knee **36** (100°)                                                                                    |
| `outfit_upper` |    có    |                   36 | waist **16** (40°), shoulder **32** (120°), neck **12** (30°)                                                           |
| `head`         |    có    |                   26 | neck **12** (30°)                                                                                                       |
| `hair_front`   |    có    |                   28 | neck **12** (30°)                                                                                                       |
| `headwear`     | tùy chọn |                   30 | neck **12** (30°)                                                                                                       |
| `arm_L`        |    có    |                   12 | shoulder **32** (120°), elbow **35** (150°), wrist **18** (60°)                                                         |
| `arm_R`        |    có    |                   12 | shoulder **32** (120°), elbow **35** (150°), wrist **18** (60°)                                                         |

## Pháp tu (`phap-tu`)

Vũ khí: staff / fan (slot weapon_R + weapon_R_mirrored). Texture 2×, atlas padding 2 px.

| slot           | bắt buộc | rộng danh nghĩa (px) | vẽ bù theo khớp (px @1x, góc tối đa)                                                                                    |
| -------------- | :------: | -------------------: | ----------------------------------------------------------------------------------------------------------------------- |
| `wing`         | tùy chọn |                   20 | —                                                                                                                       |
| `cape`         | tùy chọn |                   20 | —                                                                                                                       |
| `hair_back`    |    có    |                   30 | neck **14** (35°)                                                                                                       |
| `body`         |    có    |                   22 | neck **14** (35°), waist **14** (35°), shoulder **33** (130°), hip **27** (70°), knee **36** (100°), ankle **16** (40°) |
| `outfit_lower` |    có    |                   46 | hip **27** (70°), knee **36** (100°)                                                                                    |
| `outfit_upper` |    có    |                   36 | waist **14** (35°), shoulder **33** (130°), neck **14** (35°)                                                           |
| `head`         |    có    |                   26 | neck **14** (35°)                                                                                                       |
| `hair_front`   |    có    |                   28 | neck **14** (35°)                                                                                                       |
| `headwear`     | tùy chọn |                   30 | neck **14** (35°)                                                                                                       |
| `arm_L`        |    có    |                   12 | shoulder **33** (130°), elbow **34** (140°), wrist **18** (60°)                                                         |
| `arm_R`        |    có    |                   12 | shoulder **33** (130°), elbow **34** (140°), wrist **18** (60°)                                                         |
| `weapon_R`     |    có    |                   10 | wrist **18** (60°)                                                                                                      |

## Đan/Phù tu (`dan-phu-tu`)

Vũ khí: whisk / brush (slot weapon_R + weapon_R_mirrored). Texture 2×, atlas padding 2 px.

| slot           | bắt buộc | rộng danh nghĩa (px) | vẽ bù theo khớp (px @1x, góc tối đa)                                                                                    |
| -------------- | :------: | -------------------: | ----------------------------------------------------------------------------------------------------------------------- |
| `cape`         | tùy chọn |                   20 | —                                                                                                                       |
| `hair_back`    |    có    |                   30 | neck **14** (35°)                                                                                                       |
| `body`         |    có    |                   22 | neck **14** (35°), waist **14** (35°), shoulder **32** (120°), hip **27** (70°), knee **36** (100°), ankle **16** (40°) |
| `outfit_lower` |    có    |                   46 | hip **27** (70°), knee **36** (100°)                                                                                    |
| `outfit_upper` |    có    |                   36 | waist **14** (35°), shoulder **32** (120°), neck **14** (35°)                                                           |
| `head`         |    có    |                   26 | neck **14** (35°)                                                                                                       |
| `hair_front`   |    có    |                   28 | neck **14** (35°)                                                                                                       |
| `headwear`     | tùy chọn |                   30 | neck **14** (35°)                                                                                                       |
| `arm_L`        |    có    |                   12 | shoulder **32** (120°), elbow **34** (140°), wrist **21** (70°)                                                         |
| `arm_R`        |    có    |                   12 | shoulder **32** (120°), elbow **34** (140°), wrist **21** (70°)                                                         |
| `weapon_R`     |    có    |                   10 | wrist **21** (70°)                                                                                                      |
