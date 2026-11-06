# Pipeline sprite sheet AI từng khung cho thân nhân vật Player (D41, 2026-11-06)

Quyết định **D41** (xem `docs/DECISIONS.md`, `docs/31` F-22): thân nhân vật Player dùng **sprite sheet AI từng khung** thay cho rig xương liền chi (D39) và bước key pose (D40). Tài liệu này là quy trình + hợp đồng công cụ `@vgtd/sprite` (`tools/sprite`). Rig xương vẫn dùng cho boss/NPC và mã `@vgtd/rig` được giữ nguyên.

## Đánh đổi (đã chấp nhận)

- Không còn paperdoll từng bộ phận: **đổi trang phục = sinh lại sheet**; **đổi màu = hoán đổi palette** (khóa palette theo master), không tách lớp.
- Mỗi hướng vẽ (S, SE, E, NE, N) × mỗi animation là một sheet; SW/W/NW lật gương (D14).
- Quy mô một hướng ≈ 60–130 khung 256×256 @2x đã trim, vừa một trang atlas 2048².

## Runtime: một armature DragonBones, đổi display từng khung

`root` (gốc tại pivot, `pivotOf` = (128, 232) @2x) → một slot `body` → mỗi khung là một display (region đã trim, offset tính từ gốc), đổi bằng timeline `displayFrame` **bậc thang 30 fps**. Sự kiện `footstep_L/R`, `hit`, `cancel_window`, `vfx_spawn`, `sfx` lấy từ bảng animation (`docs/03`, `@vgtd/character` `ANIMATIONS`) và nằm trên cùng đồng hồ với việc đổi khung. Viewer (docs/32), `DragonBonesActor` và bộ chụp QA chạy nguyên không đổi. Lý do không dùng hoạt ảnh khung riêng của Cocos: xem D41.

Thời lượng clip = `durationSec` của bảng; N khung của sheet phân bố đều theo thời gian (khung i hiện từ tick `round(i·ticks/N)`); sự kiện ở **số khung của bảng** được quy theo tỉ lệ sang tick 30 fps (`eventsFromTable`).

## Các bước

| Bước            | Lệnh / API                                                                                                                                                     | Ghi chú                                                                                                                                                                                                                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Template     | `npm run sprite:template -w @vgtd/sprite -- --clip run --frames 12 --cols 6 --gait run --master <master.png> --out <dir>` / `buildTemplate`, `locomotionCells` | Lưới N ô 256×256, nền magenta `#FF00FF`, vạch đất/đầu/hông (đo từ **master thật**; trục hông = x hông đo được, ví dụ 128,15), dấu chân dẫn (xanh = L, đỏ = R), bóng chân (cyan = chân gần R, hổ phách = chân xa L), **không có chữ**. `--cells <json>` thay ô sinh tự động (khung bay của chạy, v.v.). Kèm `<clip>.template.json` (manifest). |
| 2. Sheet thô    | (worker art) `<char>/<DIR>/sheets/<clip>.png`                                                                                                                  | Cùng cols × rows với template, độ phân giải bất kỳ, nền magenta.                                                                                                                                                                                                                                                                              |
| 3. Cắt          | `sliceSheet`                                                                                                                                                   | Khóa nền magenta (mềm, tách màu khỏi key), khử viền (defringe), bỏ mảnh vụn (`removeFragments`).                                                                                                                                                                                                                                              |
| 4. Khóa palette | `paletteFromMaster`, `lockPalette`                                                                                                                             | Palette median-cut từ master; điểm gần palette bị kéo về, màu xa giữ nguyên (không làm phẳng đổ bóng).                                                                                                                                                                                                                                        |
| 5. Căn          | `calibrate`, `alignFrame`                                                                                                                                      | **Một tỉ lệ cố định cho mỗi nhân vật (hoặc mỗi sheet có DPI sinh khác)**, khóa theo chiều cao master; mỗi khung chỉ **tịnh tiến** (x hông → trục, y đế → vạch đất). Không bao giờ chuẩn hóa chiều cao từng khung. Tư thế giải phẫu (chết gục, giơ kiếm, lùi) khai báo `exceptions` theo khung: ghi lại, **không** co/giãn.                    |
| 6. Atlas        | `packFrames`                                                                                                                                                   | Trim, trang ≤ 2048, padding 2 px, extrude 1 px, premultiplied (như chính sách PMA hiện hành).                                                                                                                                                                                                                                                 |
| 7. Xuất         | `buildArmature`, `runProject`                                                                                                                                  | `<stem>_<DIR>_{ske,tex}.json` + `_tex.png` + `<stem>_<DIR>.sprite.json` (hợp đồng: hiệu chuẩn, số đo trước/sau từng khung, atlas, kết quả QA).                                                                                                                                                                                                |
| 8. QA           | `runQa`                                                                                                                                                        | Xem dưới.                                                                                                                                                                                                                                                                                                                                     |
| 9. Chụp         | `npm run capture -w client-cocos -- --src dragonbones/<thư mục> --stem <stem> --direction E --mode single --gif`                                               | Chép thư mục xuất vào `apps/client-cocos/assets/resources/dragonbones/<thư mục>/`.                                                                                                                                                                                                                                                            |

Chạy cả chuỗi: `npm run sprite:build -w @vgtd/sprite -- --project <project.json> --out <dir>` (xem mô tả `Project` trong `src/project.ts`: master, palette, các clip với `sheet`, `cols`, `frames`, `durationSec`, `loop`, `tableId`, `kind`, `calibration`, `exceptions`, `vertical`, `manifest`).

### Hiệu chuẩn tỉ lệ

- Mặc định: tỉ lệ nhân vật = chiều cao master / **trung vị chiều cao thô** của các khung đứng thẳng (clip `kind: upright`).
- Một sheet có DPI sinh khác (AI trả ảnh độ phân giải khác nhau): khai báo **tỉ lệ cố định riêng cho sheet đó** bằng `calibration: { scale }`, hoặc `{ referenceHeight }` (px thô của tư thế đứng thẳng), hoặc `{ referenceFrames: [..] }` (chỉ số các khung đứng thẳng). Vẫn là **một hệ số cho cả sheet**, không bao giờ theo từng khung. Hợp đồng ghi hệ số đã dùng cho từng sheet.

### Sửa một ô (`sprite:repair`)

`npm run sprite:repair -w @vgtd/sprite -- --sheet <gốc.png> --edited <đã sửa.png> --cell <chỉ số> --cols <n> --rows <n> --out <ra.png>`: chép **đúng một ô** từ sheet đã sửa (model hay vẽ lại cả ảnh) vào sheet gốc; mọi ô khác **giống từng byte** (kiểm bằng sha1 từng ô, lệnh lỗi nếu có ô khác đổi).

### Ghi chú khóa nền, chạy nước rút và cổng trượt chân (bổ sung)

- **Dọn màu magenta lọt vào trong (hair strands):** `slice.spill` (`despillInterior`) bỏ ám magenta của **mọi** pixel đục (không chỉ viền): pixel có đỏ và xanh dương cùng vượt xanh lá quá `threshold` (24) bị kéo về `min(r, b) = g`, trừ khi nằm gần một màu của palette master (`keepDistance` 36; `runProject` tự thêm palette master), để không làm hỏng vải tím/hồng thật. Mặc định tắt; bật bằng `"slice": { "spill": {} }` trong project.
- **Chạy nước rút:** chân chạm đất ngắn hơn nửa chu kỳ. `locomotionCells(..., { stance })` / `sprite:template --stance 0.33` sinh ô bay (cả hai chân rời đất), và `halfStrideFor(speed, duration, stance)` = `speed · duration · 2 · stance / 2` giữ bóng chân khớp cổng trượt chân; dùng **cùng một** `stance` cho cả hai.
- **Chú thích tiếp đất thật:** `contacts: { R: [...], L: [...] }` trong clip của project thay cờ `planted` của template bằng các khung mà bản vẽ **thực sự** có chân chạm đất (vị trí bóng chân giữ nguyên).
- **Đo đế chân:** `soleRuns` tách từng bàn chân (cách nhau ≥ 3 cột) nên hai giày gần nhau không còn bị trung bình hóa; chân đặt đất cách bóng chân > 20 px **không** bị bỏ qua âm thầm mà báo `warn` ("chân không nằm trên template").

## Bảng clip dùng chung (15 clip Player)

`import { SPRITE_CLIPS, SPRITE_CLIP_NAMES, spriteClip, projectClipDefaults } from '@vgtd/sprite'` (`tools/sprite/src/clips.ts`). Bảng **sinh từ `ANIMATIONS`** (`docs/03`) nên thời lượng, cờ lặp, fps, sự kiện không bao giờ lệch; ba nhịp combo `attack`, `attack_2`, `attack_3` dùng chung đặc tả `attack`.

| Clip                             | Bảng (`tableId`) | Ô sheet đề xuất (cols) | Loại    | Gợi ý exception      |
| -------------------------------- | ---------------- | ---------------------- | ------- | -------------------- |
| `idle`                           | idle             | 8 (4)                  | upright | -                    |
| `meditate`                       | meditate         | 8 (4)                  | free    | seated               |
| `walk`                           | walk             | 12 (6)                 | upright | -                    |
| `run`                            | run              | 12 (6)                 | upright | -                    |
| `dash`                           | dash             | 6 (4)                  | free    | lunge                |
| `sword_fly`                      | sword_fly        | 8 (4)                  | free    | airborne, sword-ride |
| `attack`, `attack_2`, `attack_3` | attack           | 8 (4)                  | free    | raised-sword, lunge  |
| `cast`                           | cast             | 8 (4)                  | free    | raised-arms          |
| `channel`                        | channel          | 8 (4)                  | free    | raised-arms          |
| `hit`                            | hit              | 4 (4)                  | free    | recoil               |
| `die`                            | die              | 8 (4)                  | free    | die-collapse         |
| `tribulation`                    | tribulation      | 12 (6)                 | free    | kneel, raised-arms   |
| `emote`                          | emote            | 8 (4)                  | upright | -                    |

- `spriteClip(name)` trả `{ tableId, loop, durationSec, asymmetric, kind, sheet: { frames, cols }, events, phases, exceptionHints }`; `phases` là **số khung của bảng** mặc định cho sự kiện neo theo pha (`hit_frame`, `combo_window`, `windup_end`) — giá trị mặc định lấy từ nhịp rig Kiếm tu, chỉnh theo sheet thật (cần game designer duyệt khi cân bằng).
- `projectClipDefaults(name)` trả các trường của clip trong `project.json` lấy từ bảng (`name`, `cols`, `frames`, `durationSec`, `loop`, `tableId`, `kind`, `phases`); thêm `sheet`, `manifest`, `exceptions`, `calibration`.
- `sprite:template --clip <tên>` lấy `--frames` / `--cols` mặc định từ bảng này.

## Cổng QA

| Cổng               | Quy tắc                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chiều cao          | Clip `upright` (idle/walk/run): **mọi khung** trong master ±3 % (mặc định; ví dụ master 208 px → 201,8–214,2). Clip `free` (die, hit, cast, attack giơ kiếm): lệch được ghi nhận **chỉ khi có `exceptions` khai báo** (lý do: `die-collapse`, `raised-sword`, `lunge`, `recoil`); không khai báo = cảnh báo. Không có chế độ "nới lỏng âm thầm". |
| Trượt chân         | Chân đặt đất (theo bóng chân của manifest) phải lùi đúng tốc độ mặt đất của bảng (run `RUN_SPEED_PX_S`, walk `WALK_SPEED_PX_S`, × `viewGain`); sai lệch trung bình > 3 px/khung là lỗi.                                                                                                                                                          |
| Đường nối vòng lặp | Khung cuối → khung đầu của clip lặp không lớn hơn 2,5× bước trung bình (cùng ngưỡng của viewer).                                                                                                                                                                                                                                                 |
| Giống master       | Mặt (20 % trên) và thân (30–55 %) của từng khung giống master (lưới 8×8 khối màu trung bình), ngưỡng 0,7; khung có exception được bỏ qua.                                                                                                                                                                                                        |
| Đủ khung           | Số khung đúng bằng yêu cầu, không khung nào trống.                                                                                                                                                                                                                                                                                               |

## Hạn chế hiện tại

- Mỗi hướng một trang atlas (xuất nhiều trang sẽ báo lỗi rõ ràng); đủ cho ≈ 130 khung.
- Bóng chân và cổng trượt chân hiện hiểu hướng E (mặt về phía +x); hướng khác cần chỉnh khi bắt đầu vẽ hướng đó.
- Palette lock và độ giống master là cổng thô (ngưỡng mặc định, cần chỉnh khi có dữ liệu thật). Ngưỡng là giá trị mặc định chưa duyệt (ghi trong OPEN-ITEMS §12).
