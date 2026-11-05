# Đặc tả mảnh (parts SPEC) cho từng Đạo Lộ

> Sinh tự động bởi `partsSpecMarkdown` (`@vgtd/rig`): chạy `npm run gen:parts-spec -w @vgtd/rig` để cập nhật; CI kiểm file này khớp bản sinh mới. Mục đích: vẽ đúng ngay lần đầu để rig không hở mối nối.

**Quy tắc chung.** Canvas 128 × 128 @1x, pivot (64, 116); vẽ ở texture 2× (256 × 256), hình học 1×. Mỗi hướng vẽ (S, SE, E, NE, N) có bộ mảnh riêng `parts/<HƯỚNG>/<slot>.png`, PNG RGBA premultiplied alpha, padding atlas 2 px (`BUDGETS.ATLAS_PADDING_PX`), nền trong suốt. SW/W/NW là lật gương, không vẽ.

**Cách tính phần vẽ bù (margin).** Tại mỗi mối nối của khớp, mảnh nằm **sau** (thứ tự vẽ của hướng đó, `drawOrderFor`) phải có thêm **margin px** màu vẽ kéo dài **xuống dưới** mảnh nằm trước; mảnh nằm trước không cần gì. Hai đảo của cùng một slot (các mảnh chi trong `body`, `arm_L`/`arm_R`) không có thứ tự vẽ nên cả hai cùng kéo dài. Margin = `ceil(w · sin(θ/2))`, w = **bề rộng thật của mối nối** tại khớp (chi/thân rộng 10-26 px, không phải bề rộng mảnh lớn kề bên) và θ = **góc khớp lớn nhất mà bộ animation của lớp thực sự đòi hỏi**, đo trên rig (`measuredJointCaps`, làm tròn lên 5°). Nhân đôi số px khi vẽ ở texture 2×. Không che chỗ hở bằng cách dãn mesh.

## Kiếm tu (`kiem-tu`)

Vũ khí: sword (slot weapon_R + weapon_R_mirrored). Texture 2×, atlas padding 2 px.

### Margin theo mối nối (px @1x)

| khớp     | mối nối                                       | rộng mối nối | góc đo | margin | mảnh phải kéo dài (S / SE / E / NE / N)                                            |
| -------- | --------------------------------------------- | -----------: | -----: | -----: | ---------------------------------------------------------------------------------- |
| shoulder | upper arm / vest (`arm_R` / `outfit_upper`)   |           14 |   160° | **14** | `outfit_upper` / `outfit_upper` / `outfit_upper` / `outfit_upper` / `arm_R`        |
| shoulder | upper arm / vest (`arm_L` / `outfit_upper`)   |           14 |   160° | **14** | `outfit_upper` / `arm_L` / `arm_L` / `arm_L` / `arm_L`                             |
| shoulder | upper arm / neck-torso (`arm_R` / `body`)     |           14 |   160° | **14** | `body` / `body` / `body` / `body` / `arm_R`                                        |
| shoulder | upper arm / neck-torso (`arm_L` / `body`)     |           14 |   160° | **14** | `body` / `arm_L` / `arm_L` / `arm_L` / `arm_L`                                     |
| elbow    | upper arm / forearm (`arm_R` / `arm_R`)       |           13 |   105° | **11** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| elbow    | upper arm / forearm (`arm_L` / `arm_L`)       |           13 |   105° | **11** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| wrist    | forearm / hand (`arm_R` / `arm_R`)            |           11 |    30° |  **3** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| wrist    | forearm / hand (`arm_L` / `arm_L`)            |           11 |    30° |  **3** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| hip      | thigh / robe panels (`body` / `outfit_lower`) |           18 |    95° | **14** | `body` / `body` / `body` / `body` / `body`                                         |
| hip      | thigh / torso (`body` / `body`)               |           18 |    95° | **14** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| knee     | thigh / shin (`body` / `body`)                |           17 |   150° | **17** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| ankle    | shin / foot (`body` / `body`)                 |           12 |    70° |  **7** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| neck     | head / neck (`head` / `body`)                 |           10 |    20° |  **2** | `body` / `body` / `body` / `body` / `body`                                         |
| waist    | vest / robe (`outfit_upper` / `outfit_lower`) |           26 |    20° |  **5** | `outfit_lower` / `outfit_lower` / `outfit_lower` / `outfit_lower` / `outfit_lower` |
| waist    | vest / torso (`outfit_upper` / `body`)        |           26 |    20° |  **5** | `body` / `body` / `body` / `body` / `body`                                         |

### Mảnh

| slot           | bắt buộc | rộng danh nghĩa (px) | khớp chạm (margin px)                                  |
| -------------- | :------: | -------------------: | ------------------------------------------------------ |
| `wing`         | tùy chọn |                   20 | —                                                      |
| `cape`         | tùy chọn |                   20 | —                                                      |
| `sword_back`   | tùy chọn |                   20 | —                                                      |
| `hair_back`    |    có    |                   30 | neck 2                                                 |
| `body`         |    có    |                   22 | shoulder 14, hip 14, knee 17, ankle 7, neck 2, waist 5 |
| `outfit_lower` |    có    |                   46 | hip 14, waist 5                                        |
| `outfit_upper` |    có    |                   36 | shoulder 14, waist 5                                   |
| `head`         |    có    |                   26 | neck 2                                                 |
| `hair_front`   |    có    |                   28 | neck 2                                                 |
| `headwear`     | tùy chọn |                   30 | neck 2                                                 |
| `arm_L`        |    có    |                   12 | shoulder 14, elbow 11, wrist 3                         |
| `arm_R`        |    có    |                   12 | shoulder 14, elbow 11, wrist 3                         |
| `weapon_R`     |    có    |                   10 | wrist 3                                                |

## Thể tu (`the-tu`)

Vũ khí: gauntlets (worn on arm_L / arm_R, no weapon_R). Texture 2×, atlas padding 2 px.

### Margin theo mối nối (px @1x)

| khớp     | mối nối                                       | rộng mối nối | góc đo | margin | mảnh phải kéo dài (S / SE / E / NE / N)                                            |
| -------- | --------------------------------------------- | -----------: | -----: | -----: | ---------------------------------------------------------------------------------- |
| shoulder | upper arm / vest (`arm_R` / `outfit_upper`)   |           14 |   160° | **14** | `outfit_upper` / `outfit_upper` / `outfit_upper` / `outfit_upper` / `arm_R`        |
| shoulder | upper arm / vest (`arm_L` / `outfit_upper`)   |           14 |   160° | **14** | `outfit_upper` / `arm_L` / `arm_L` / `arm_L` / `arm_L`                             |
| shoulder | upper arm / neck-torso (`arm_R` / `body`)     |           14 |   160° | **14** | `body` / `body` / `body` / `body` / `arm_R`                                        |
| shoulder | upper arm / neck-torso (`arm_L` / `body`)     |           14 |   160° | **14** | `body` / `arm_L` / `arm_L` / `arm_L` / `arm_L`                                     |
| elbow    | upper arm / forearm (`arm_R` / `arm_R`)       |           13 |   105° | **11** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| elbow    | upper arm / forearm (`arm_L` / `arm_L`)       |           13 |   105° | **11** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| wrist    | forearm / hand (`arm_R` / `arm_R`)            |           11 |    20° |  **2** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| wrist    | forearm / hand (`arm_L` / `arm_L`)            |           11 |    20° |  **2** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| hip      | thigh / robe panels (`body` / `outfit_lower`) |           18 |    95° | **14** | `body` / `body` / `body` / `body` / `body`                                         |
| hip      | thigh / torso (`body` / `body`)               |           18 |    95° | **14** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| knee     | thigh / shin (`body` / `body`)                |           17 |   150° | **17** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| ankle    | shin / foot (`body` / `body`)                 |           12 |    70° |  **7** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| neck     | head / neck (`head` / `body`)                 |           10 |    20° |  **2** | `body` / `body` / `body` / `body` / `body`                                         |
| waist    | vest / robe (`outfit_upper` / `outfit_lower`) |           26 |    20° |  **5** | `outfit_lower` / `outfit_lower` / `outfit_lower` / `outfit_lower` / `outfit_lower` |
| waist    | vest / torso (`outfit_upper` / `body`)        |           26 |    20° |  **5** | `body` / `body` / `body` / `body` / `body`                                         |

### Mảnh

| slot           | bắt buộc | rộng danh nghĩa (px) | khớp chạm (margin px)                                  |
| -------------- | :------: | -------------------: | ------------------------------------------------------ |
| `cape`         | tùy chọn |                   20 | —                                                      |
| `hair_back`    |    có    |                   30 | neck 2                                                 |
| `body`         |    có    |                   22 | shoulder 14, hip 14, knee 17, ankle 7, neck 2, waist 5 |
| `outfit_lower` |    có    |                   46 | hip 14, waist 5                                        |
| `outfit_upper` |    có    |                   36 | shoulder 14, waist 5                                   |
| `head`         |    có    |                   26 | neck 2                                                 |
| `hair_front`   |    có    |                   28 | neck 2                                                 |
| `headwear`     | tùy chọn |                   30 | neck 2                                                 |
| `arm_L`        |    có    |                   12 | shoulder 14, elbow 11, wrist 2                         |
| `arm_R`        |    có    |                   12 | shoulder 14, elbow 11, wrist 2                         |

## Pháp tu (`phap-tu`)

Vũ khí: staff / fan (slot weapon_R + weapon_R_mirrored). Texture 2×, atlas padding 2 px.

### Margin theo mối nối (px @1x)

| khớp     | mối nối                                       | rộng mối nối | góc đo | margin | mảnh phải kéo dài (S / SE / E / NE / N)                                            |
| -------- | --------------------------------------------- | -----------: | -----: | -----: | ---------------------------------------------------------------------------------- |
| shoulder | upper arm / vest (`arm_R` / `outfit_upper`)   |           14 |   160° | **14** | `outfit_upper` / `outfit_upper` / `outfit_upper` / `outfit_upper` / `arm_R`        |
| shoulder | upper arm / vest (`arm_L` / `outfit_upper`)   |           14 |   160° | **14** | `outfit_upper` / `arm_L` / `arm_L` / `arm_L` / `arm_L`                             |
| shoulder | upper arm / neck-torso (`arm_R` / `body`)     |           14 |   160° | **14** | `body` / `body` / `body` / `body` / `arm_R`                                        |
| shoulder | upper arm / neck-torso (`arm_L` / `body`)     |           14 |   160° | **14** | `body` / `arm_L` / `arm_L` / `arm_L` / `arm_L`                                     |
| elbow    | upper arm / forearm (`arm_R` / `arm_R`)       |           13 |   100° | **10** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| elbow    | upper arm / forearm (`arm_L` / `arm_L`)       |           13 |   100° | **10** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| wrist    | forearm / hand (`arm_R` / `arm_R`)            |           11 |    20° |  **2** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| wrist    | forearm / hand (`arm_L` / `arm_L`)            |           11 |    20° |  **2** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| hip      | thigh / robe panels (`body` / `outfit_lower`) |           18 |    95° | **14** | `body` / `body` / `body` / `body` / `body`                                         |
| hip      | thigh / torso (`body` / `body`)               |           18 |    95° | **14** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| knee     | thigh / shin (`body` / `body`)                |           17 |   150° | **17** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| ankle    | shin / foot (`body` / `body`)                 |           12 |    70° |  **7** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| neck     | head / neck (`head` / `body`)                 |           10 |    20° |  **2** | `body` / `body` / `body` / `body` / `body`                                         |
| waist    | vest / robe (`outfit_upper` / `outfit_lower`) |           26 |    20° |  **5** | `outfit_lower` / `outfit_lower` / `outfit_lower` / `outfit_lower` / `outfit_lower` |
| waist    | vest / torso (`outfit_upper` / `body`)        |           26 |    20° |  **5** | `body` / `body` / `body` / `body` / `body`                                         |

### Mảnh

| slot           | bắt buộc | rộng danh nghĩa (px) | khớp chạm (margin px)                                  |
| -------------- | :------: | -------------------: | ------------------------------------------------------ |
| `wing`         | tùy chọn |                   20 | —                                                      |
| `cape`         | tùy chọn |                   20 | —                                                      |
| `hair_back`    |    có    |                   30 | neck 2                                                 |
| `body`         |    có    |                   22 | shoulder 14, hip 14, knee 17, ankle 7, neck 2, waist 5 |
| `outfit_lower` |    có    |                   46 | hip 14, waist 5                                        |
| `outfit_upper` |    có    |                   36 | shoulder 14, waist 5                                   |
| `head`         |    có    |                   26 | neck 2                                                 |
| `hair_front`   |    có    |                   28 | neck 2                                                 |
| `headwear`     | tùy chọn |                   30 | neck 2                                                 |
| `arm_L`        |    có    |                   12 | shoulder 14, elbow 10, wrist 2                         |
| `arm_R`        |    có    |                   12 | shoulder 14, elbow 10, wrist 2                         |
| `weapon_R`     |    có    |                   10 | wrist 2                                                |

## Đan/Phù tu (`dan-phu-tu`)

Vũ khí: whisk / brush (slot weapon_R + weapon_R_mirrored). Texture 2×, atlas padding 2 px.

### Margin theo mối nối (px @1x)

| khớp     | mối nối                                       | rộng mối nối | góc đo | margin | mảnh phải kéo dài (S / SE / E / NE / N)                                            |
| -------- | --------------------------------------------- | -----------: | -----: | -----: | ---------------------------------------------------------------------------------- |
| shoulder | upper arm / vest (`arm_R` / `outfit_upper`)   |           14 |   160° | **14** | `outfit_upper` / `outfit_upper` / `outfit_upper` / `outfit_upper` / `arm_R`        |
| shoulder | upper arm / vest (`arm_L` / `outfit_upper`)   |           14 |   160° | **14** | `outfit_upper` / `arm_L` / `arm_L` / `arm_L` / `arm_L`                             |
| shoulder | upper arm / neck-torso (`arm_R` / `body`)     |           14 |   160° | **14** | `body` / `body` / `body` / `body` / `arm_R`                                        |
| shoulder | upper arm / neck-torso (`arm_L` / `body`)     |           14 |   160° | **14** | `body` / `arm_L` / `arm_L` / `arm_L` / `arm_L`                                     |
| elbow    | upper arm / forearm (`arm_R` / `arm_R`)       |           13 |   105° | **11** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| elbow    | upper arm / forearm (`arm_L` / `arm_L`)       |           13 |   105° | **11** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| wrist    | forearm / hand (`arm_R` / `arm_R`)            |           11 |    20° |  **2** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| wrist    | forearm / hand (`arm_L` / `arm_L`)            |           11 |    20° |  **2** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| hip      | thigh / robe panels (`body` / `outfit_lower`) |           18 |    95° | **14** | `body` / `body` / `body` / `body` / `body`                                         |
| hip      | thigh / torso (`body` / `body`)               |           18 |    95° | **14** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| knee     | thigh / shin (`body` / `body`)                |           17 |   150° | **17** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| ankle    | shin / foot (`body` / `body`)                 |           12 |    70° |  **7** | cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo / cả hai đảo                     |
| neck     | head / neck (`head` / `body`)                 |           10 |    20° |  **2** | `body` / `body` / `body` / `body` / `body`                                         |
| waist    | vest / robe (`outfit_upper` / `outfit_lower`) |           26 |    20° |  **5** | `outfit_lower` / `outfit_lower` / `outfit_lower` / `outfit_lower` / `outfit_lower` |
| waist    | vest / torso (`outfit_upper` / `body`)        |           26 |    20° |  **5** | `body` / `body` / `body` / `body` / `body`                                         |

### Mảnh

| slot           | bắt buộc | rộng danh nghĩa (px) | khớp chạm (margin px)                                  |
| -------------- | :------: | -------------------: | ------------------------------------------------------ |
| `cape`         | tùy chọn |                   20 | —                                                      |
| `hair_back`    |    có    |                   30 | neck 2                                                 |
| `body`         |    có    |                   22 | shoulder 14, hip 14, knee 17, ankle 7, neck 2, waist 5 |
| `outfit_lower` |    có    |                   46 | hip 14, waist 5                                        |
| `outfit_upper` |    có    |                   36 | shoulder 14, waist 5                                   |
| `head`         |    có    |                   26 | neck 2                                                 |
| `hair_front`   |    có    |                   28 | neck 2                                                 |
| `headwear`     | tùy chọn |                   30 | neck 2                                                 |
| `arm_L`        |    có    |                   12 | shoulder 14, elbow 11, wrist 2                         |
| `arm_R`        |    có    |                   12 | shoulder 14, elbow 11, wrist 2                         |
| `weapon_R`     |    có    |                   10 | wrist 2                                                |
