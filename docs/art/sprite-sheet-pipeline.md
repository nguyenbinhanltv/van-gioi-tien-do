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

## Quality backlog (làm đủ bộ trước, cải thiện sau)

Mỗi nhân vật có `quality-backlog.json` (cạnh `project.json`, hoặc `project.backlog`) và `quality-backlog.md` sinh tự động:

```json
{
  "format": "vgtd-quality-backlog",
  "version": 1,
  "character": "kiem-tu",
  "entries": [
    {
      "clip": "run",
      "dir": "E",
      "cell": 3,
      "gate": "footSlide",
      "metric": "slide_px_per_frame_R",
      "value": 5.1,
      "limit": 3,
      "note": "giày bị nhấc trong bản vẽ, sửa ở vòng chau chuốt",
      "status": "open"
    }
  ]
}
```

- **Cổng cứng, không bao giờ được ghi vào backlog:** đủ khung (`present`), chiều cao khung của clip `upright` ngoài ±3 % (`height` fail), giống master (`similarity`), đường nối vòng lặp (`loopSeam`), lỗi xuất/rig.
- **Phát hiện mềm (có thể ghi):** `footSlide` (trượt chân; chân đặt đất không nằm trên bóng chân của template), cảnh báo `height` của clip `free` chưa khai báo exception (chỉ số `height_excess_px`: số px vượt ngoài dải).
- **Phán quyết:** mềm **không** có trong backlog → lỗi (`fail-soft`); có trong backlog và `value` hiện tại ≤ giá trị đã ghi (+1 %) → `accepted` (qua, hiện như cảnh báo); tệ hơn → `regression` (lỗi); mục backlog không còn xảy ra → `resolved` (nên xóa bằng `--prune`).
- **Khóa so khớp:** `clip + dir + cell + gate + metric` (`cell` = chỉ số khung 0-based, `-1` = cấp clip).
- **Ghi vào backlog là hành động có chủ ý:** `npm run sprite:backlog -w @vgtd/sprite -- --project <project.json> --accept --note "<lý do>" [--owner <worker>] [--prune]` thêm các phát hiện mềm **hiện tại** chưa được ghi (không bao giờ thêm cổng cứng hay hồi quy); không cờ nào thì chỉ báo cáo. `sprite:build` in phán quyết từng phát hiện và thoát 1 nếu còn lỗi cứng, mềm chưa ghi, hoặc hồi quy.

### Phát hiện hình ảnh thủ công

`quality-backlog.json` v1 có thêm mảng `manual` tùy chọn, tách khỏi `entries` chứa số đo tự động.
Mỗi mục có `kind` (`carry_change`, `weak_reversal`, `redraw_drift`, `hair_spill`, `other`), `clip`, `dir`,
`cells` (chỉ số từ 0; mảng rỗng áp dụng cả clip), `note`, `severity` và `reviewer: "art-worker"`.
Giữ nhãn mức độ của người xem (`warn`: lỗi nhìn thấy; `info`: chẩn đoán chưa xác nhận), không quy đổi thành cổng QA.
Lệnh `sprite:backlog` đếm và liệt kê riêng các mục này; báo cáo batch chuyển chúng tới trang `sprite:review`.
Chúng không chấp nhận lỗi đo, không thay đổi kết quả cổng build, không nằm trong danh sách tự động đã sửa;
`--accept` và `--prune` luôn giữ nguyên. Chỉ người xem art mới sửa hoặc xóa sau khi kiểm tra lại.
Trường `status` tùy chọn (`open`, `planned`, `resolved`, mặc định `open`) chỉ ghi quyết định xem art rõ ràng;
QA không tự thay đổi nó. Số mục người xem art đã xử lý được hiển thị riêng, không nhập vào số đo tự động đã sửa.

Nhập tệp đồng hành của worker 17 bằng `sprite:backlog --backlog <quality-backlog.json> --import-manual <manual-art-findings.json>`
(qua npm workspace như hướng dẫn README). Không cần dựng lại art khi nhập. `leg_reversal` đổi thành `weak_reversal`,
`key_spill` đổi thành `hair_spill`; số chẩn đoán cũ chỉ giữ trong ghi chú, tuyệt đối không tạo `footSlide` giả.
Sau khi nhập, dựng lại báo cáo batch để trang review nhận các mục mới.

## Batch + trang duyệt của chủ dự án

- `batch.json` = `{ "character": "kiem-tu", "projects": ["E/project.json", "SE/project.json", ...] }` (đường dẫn tương đối với file batch; mỗi hướng một project, mỗi project có `quality-backlog.json` cạnh nó).
- `npm run sprite:batch -w @vgtd/sprite -- --batch <batch.json> --out <dir> [--capture] [--keep-staged] [--allow-errors]`: build + QA mọi hướng của nhân vật, ghi `<out>/<DIR>/<stem>_<DIR>_{ske,tex}.json`, `_tex.png`, `.sprite.json`, `batch-report.json` (trạng thái từng clip: `ok` / `warn` (chỉ có mục backlog đã chấp nhận) / `fail`) và `index.html`. Thoát 1 nếu một hướng lỗi cổng cứng, phát hiện mềm chưa ghi, hoặc hồi quy.
- `--capture`: chép từng hướng vào `apps/client-cocos/assets/resources/dragonbones/_batch-<nhân vật>-<DIR>` (git-ignored), build web Cocos **một lần**, chụp mọi clip bằng runtime thật ở **2×** (`--zoom 2 --sample midpoint`) vào `<out>/<DIR>/capture/<clip>.gif`, rồi xóa thư mục tạm (trừ `--keep-staged`). Cần Cocos Creator 3.8.8 và Chrome.
- `npm run sprite:review -w @vgtd/sprite -- --out <dir> --reports <a/batch-report.json> <b/batch-report.json> ...`: một trang `index.html` cho **mọi nhân vật / hướng / clip** với GIF 2× và trạng thái QA (chép GIF và hợp đồng vào `<out>/<nhân vật>/<DIR>/`), để chủ dự án duyệt.

## Cổng QA

| Cổng               | Quy tắc                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chiều cao          | Clip `upright` (idle/walk/run): **mọi khung** trong master ±3 % (mặc định; ví dụ master 208 px → 201,8–214,2). Clip `free` (die, hit, cast, attack giơ kiếm): lệch được ghi nhận **chỉ khi có `exceptions` khai báo** (lý do: `die-collapse`, `raised-sword`, `lunge`, `recoil`); không khai báo = cảnh báo. Không có chế độ "nới lỏng âm thầm". |
| Trượt chân         | Chân đặt đất (theo bóng chân của manifest) phải lùi đúng tốc độ mặt đất của bảng (run `RUN_SPEED_PX_S`, walk `WALK_SPEED_PX_S`, × `viewGain`); sai lệch trung bình > 3 px/khung là lỗi.                                                                                                                                                          |
| Đường nối vòng lặp | Khung cuối → khung đầu của clip lặp không lớn hơn 2,5× bước trung bình (cùng ngưỡng của viewer).                                                                                                                                                                                                                                                 |
| Giống master       | Mặt (20 % trên) và thân (30–55 %) của từng khung giống master (lưới 8×8 khối màu trung bình), ngưỡng 0,7; khung có exception được bỏ qua.                                                                                                                                                                                                        |
| Đủ khung           | Số khung đúng bằng yêu cầu, không khung nào trống.                                                                                                                                                                                                                                                                                               |

## Hạn chế hiện tại

- MaxRects thử giữ một trang; nếu không vừa thì xuất thêm trang, mỗi trang không quá 2048². Không tự giảm kích thước hay bỏ khung để vừa atlas. Vẫn một armature và cùng timeline sự kiện; nhiều trang tăng bộ nhớ texture và có thể tăng draw call khi đổi texture.
- Bóng chân và cổng trượt chân dùng cùng véc-tơ mặt đất đẳng cự theo hướng, tọa độ ảnh y xuống: E sang phải, SE xuống/phải, S xuống, NE lên/phải, N lên. Véc-tơ lấy từ phép chiếu tile của `@vgtd/shared` qua `screenAxis` của `@vgtd/rig`, đổi dấu y tại ranh giới ảnh. Không đổi tốc độ bảng hay `viewGain`.
- Sinh template CLI bằng `--direction <DIR>`; API `locomotionCells` nhận `direction` (mặc định E để giữ tương thích). Trục stride đi theo véc-tơ mặt đất đơn vị; nhấc chân vẫn theo chiều lên của ảnh. Cờ chân dẫn tính theo phase stride, không theo x của hình chiếu.
- QA nhận hướng từ project; với hướng khác E, tìm cạnh đáy đế chân gần ghost trong cả x/y, rồi chiếu độ dời lên trục mặt đất để so với quãng lùi chuẩn mỗi khung. Khoảng cách tới ghost là khoảng cách 2D; mất đế hoặc lệch quá ngưỡng vẫn báo cảnh báo và ngắt chuỗi đo. E giữ phép dò đế và số đo cũ.
- Template hướng khác E phải được sinh lại với hướng đúng. Với clip có stride theo y, dùng hiệu chuẩn cố định và `vertical: "keep"` để giữ mốc mặt đất của ô; căn đáy hình về một hàng y ở từng khung sẽ xóa chuyển động cần đo. Vẫn là dò silhouette gần ghost, không phải bộ nhận dạng giải phẫu; hai chân chồng kín cần người xem art kiểm tra.
- `runProject` báo lỗi cấu hình nếu clip có bóng chân template và tốc độ đo ở hướng có thành phần y nhưng chưa khai báo `vertical: "keep"`; không được tiếp tục đo trên dữ liệu đã xóa stride y.
- Bề rộng thế đứng do art đo từ master: API `stanceWidth`, CLI `--stance-width`, tính bằng pixel texture. Hai chân lệch ±nửa bề rộng theo véc-tơ vuông góc `(-axis.y, axis.x)` để S/N có hai làn x riêng. Mặc định 0 giữ bố trí đường tâm cũ, không tự suy ra bề rộng giải phẫu; E giữ mặc định 0 cho phép dò cũ. Phải lưu riêng template sinh ảnh gốc khi cập nhật bóng chân QA.
- Số đo hướng khác E dùng ID mới `slide_ground_px_per_frame_L/R` và `ghost_distance_2d_px_L/R`, không dùng baseline x cũ. Dựng lại QA, xem số đo rồi chấp nhận có ghi chú nếu phù hợp; không đổi tên hay sao chép giá trị cũ. Mục x cũ không còn khớp có thể được prune sau khi xem. Giữ PNG/manifest template đầu vào gốc và nguồn gốc của chúng; template hướng mới là đầu vào mới, không gắn nhãn lại bóng chân E cũ.
- Palette lock và độ giống master là cổng thô (ngưỡng mặc định, cần chỉnh khi có dữ liệu thật). Ngưỡng là giá trị mặc định chưa duyệt (ghi trong OPEN-ITEMS §12).

### Kiểm chứng MaxRects (2026-11-07)

- Thay shelf bằng MaxRects best-short-side-fit, không xoay; chọn theo cạnh dư ngắn, cạnh dư dài, y, x, rồi thứ tự chiều cao/tên ổn định. Tách mọi vùng trống giao với hình vừa đặt và bỏ vùng bị chứa. Giữ trim, padding, extrude, PMA và hiệu chuẩn đầu vào; không có bước co ảnh để vừa atlas.
- Dữ liệu thật Thể tu E của worker 18: **15 clip / 156 khung**, tổng diện tích trim có biên **3.906.947 px² (93,15 % trang)**. Shelf cần hai trang; MaxRects xuất **một trang 2048×2048**. Fixture kích thước nằm tại `tools/sprite/test/the-tu-E-trims.json`; test buộc giữ một trang cho toàn bộ 156 khung.
- Chạy lại project thật ghi đủ bốn tệp xuất, không lỗi QA cứng; 24 phát hiện mềm chưa ghi backlog vẫn làm lệnh build trả lỗi. Đây là việc chất lượng asset của worker art, không được bỏ qua cổng QA khi đổi thuật toán xếp.
- Tương thích Đan/Phù tu E: skeleton và contract giống từng byte; tọa độ atlas và PNG thay đổi theo bố trí mới. Đủ 156 region giữ nguyên kích thước và pixel PMA. Giữ thứ tự region/display cũ theo chiều cao/tên để tránh đổi chỉ số display không cần thiết. Kết quả QA trước/sau giống nhau; đầu vào trên main vẫn có lỗi QA, không tuyên bố asset đạt chỉ vì xuất được atlas.

### Dự phòng nhiều trang trong Cocos 3.8.8

Đan/Phù tu S chuẩn hóa của worker 21 có **15 clip / 156 khung**, diện tích trim trước biên **3.589.177 px²**.
MaxRects vẫn cần hai trang: **2048² / 155 region** và **256² / 1 region (`meditate_01`)**.
Chọn nhiều trang thay vì tách armature vì factory DragonBones của Cocos 3.8.8 nhận nhiều `TextureAtlasData` dưới cùng khóa atlas;
không cần đổi character API hay chia timeline sự kiện. Cần kiểm chứng bằng capture thật, không suy ra chỉ từ parser.

- Trang đầu giữ `<stem>_<DIR>_tex.json/png`; trang tiếp theo là `<stem>_<DIR>_page1_tex.json/png`, rồi `page2`, v.v.
- Contract `.sprite.json` chỉ thêm `atlas.textures` khi có nhiều trang: danh sách resource stem không có phần mở rộng, trang đầu trước.
  Ví dụ `['danphutu_S_tex', 'danphutu_S_page1_tex']`. `atlas.regions` đếm tổng region của tất cả trang.
- Viewer tải contract nếu có, tải đủ atlas assets, gọi `primary.init(factory)` rồi đăng ký trang thêm bằng API công khai
  `factory.parseTextureAtlasData(data, texture, primary.uuid)` **trước** khi dựng armature. Kiểm tra danh sách factory để không đăng ký trùng khi có nhiều actor.
  Không sửa trường private của engine; atlas phụ giữ PMA và tọa độ riêng của trang đó.
- Skeleton được xuất với kích thước của toàn bộ region, giữ mọi display ở tỷ lệ hình học gốc và sự kiện clip-table nguyên vẹn.
  Batch capture chép đủ PNG/JSON và contract; đường repo lấy từ entry gốc `process.argv[1]`, không từ URL của bundle tạm.
- So với head MaxRects một trang, cả bốn tệp Thể tu E và Đan/Phù tu E giống từng byte sau khi thêm dự phòng nhiều trang.
- Capture thật Cocos Creator **3.8.8** đã hoàn tất đủ **15 clip**, zoom **2×**, **24 mẫu midpoint/clip**, trả mã **0**;
  có 15 GIF và 15 contact sheet. `meditate_01` từ trang phụ hiện đúng rồi chuyển sang các khung ở trang chính trong cùng clip.
  Lệnh tái kiểm: `node apps/client-cocos/scripts/capture.mjs --skip-build --src dragonbones/<folder> --stem danphutu --direction S --mode single --animations all --frames 24 --zoom 2 --sample midpoint --gif --out <out>`.
  Đây là chứng minh tải/render nhiều trang; dữ liệu S chuẩn hóa vẫn có 3 lỗi QA cứng và 24 lỗi mềm của art, không được coi là đã duyệt chất lượng.

### Chuẩn bị DPI có thể tái lập từ project

Project có sheet sinh ở nhiều DPI khai báo `preparation: { kind: "square-cell-dpi-v1", calibration: "../character-calibration.json" }`. File calibration cung cấp `scale` dương hữu hạn, khóa cho nhân vật. `sprite:build`/`sprite:batch` tự chạy bước chuẩn bị trước khi cắt ô; không cần script ngoài hoặc đường dẫn tạm. Không được khai báo `scale` khác calibration.

Phiên bản này giữ thuật toán assembler Đan/Phù tu: chỉ bỏ viền hàng đen/trong suốt ngoài cùng để phục hồi ô vuông, dung sai ô 1 px và làm tròn crop 3 px; chuyển DPI toàn sheet về ô `CELL_PX`, rồi áp dụng scale nhân vật cố định. Không fit từng khung, không thu nhỏ vì atlas. Lỗi lưới không vuông hoặc thiếu calibration báo `non-reproducible project` trước QA art. Assembler đã chuẩn bị sheet phải bỏ trường `preparation` để không chạy hai lần.

Contract giữ `sheetSha1` của PNG chuẩn hóa, thêm `preparation` theo clip: `rawSha1`, kích thước thô/chuẩn hóa, crop và hệ số DPI. Sheet nguồn, guide sinh ảnh, provenance, phase và pose exception giữ nguyên. Audit project đã commit kiểm tra bước chuẩn bị và chặn DPI lẫn chưa khai báo; không diễn giải đầu vào thô thành lỗi art cứng.

## Nhiều clip trên một sheet

`buildGroupedTemplate` và CLI `sprite:template-group --group <json> --master <png> --out <dir>` gộp clip ngắn
vào một lưới tối đa 4×4. JSON gồm `clips: [{ name, frames, cells? }]` và `cols?` (mặc định 4).
API/CLI xuất template, manifest toàn sheet và mapping cho từng clip (`group.clips.json`).
Pose/ghost của từng clip phải được tạo theo thời lượng/hướng của chính clip trước khi gộp.

Trong project, mỗi clip giữ `name`, thời lượng, sự kiện, calibration, loại và exceptions riêng;
cùng trỏ `sheet`/`manifest`, thêm `sheetSelection: { rows, cells }`. `cols`/`rows` mô tả toàn sheet,
`cells` là chỉ số ô từ 0 theo hàng, theo thứ tự phát của clip; số phần tử phải bằng `frames`, không trùng hay vượt lưới.
Manifest được chọn bằng đúng mapping này. Chỉ số exceptions, contacts, referenceFrames và QA vẫn tính từ 0 trong từng clip.
Chuẩn bị DPI chạy trên toàn sheet rồi mới chọn ô; hợp đồng giữ hash toàn sheet + mapping, không suy đoán vị trí từ tên clip.
Không khai báo selection thì giữ đường đi cũ. `hit` 6 + `dash` 10 vừa 4×4; `hit` + `die` hay `idle` + `emote`
của v2 vượt 16 ô, phải tách hoặc chọn nhóm khác. Gộp chỉ giảm lần gọi sinh ảnh, không miễn QA hay giảm số khung.

## Clip semi-chibi mượt v2

[Cập nhật D46: profile mới opt-in, bảng D41 phía trên vẫn phục vụ asset cũ.]

API: `SMOOTH_SPRITE_CLIPS`, `smoothSpriteClip(name)`, `smoothProjectClipDefaults(name)`, `smoothPoseTags(name)`.
CLI: `npm run sprite:template -w @vgtd/sprite -- --profile smooth-v2 --clip run --master <master.png> --direction E --out <dir>`.
Spread `smoothProjectClipDefaults('run')` vào project, rồi thêm `sheet`, `manifest`, calibration và exceptions.
Runtime dùng `attack` cho nhịp đầu (tên sản xuất attack_1); không thêm animation alias.

| Clip                                         | Ô vẽ | Thời lượng danh nghĩa (giây) |
| -------------------------------------------- | ---- | ---------------------------- |
| idle, walk, run, cast, meditate, tribulation | 16   | 16/24                        |
| attack, attack_2, attack_3                   | 14   | 14/24                        |
| dash                                         | 10   | 10/24                        |
| channel, die, emote, sword_fly               | 12   | 12/24                        |
| hit                                          | 6    | 6/24                         |

Mỗi bản vẽ là một pose riêng ở 24 fps danh nghĩa, không nhân bản ô để giả tăng độ mượt.
Chọn 14 khung mỗi đòn để có lấy đà, vung, trúng, giữ lực một khung và thu thế; nhãn pose nằm trong manifest.
`phases` vẫn là chỉ số TABLE cũ, không phải số ô mới; exporter đổi tỉ lệ sự kiện theo thời lượng.
Không kéo dài hit/cancel gameplay theo clip: đây là profile trình diễn, cần tích hợp gameplay riêng khi nối chiến đấu.
Clock DragonBones hiện tại là 30 Hz: thời lượng được làm tròn tới tick gần nhất (sai số ≤ 1/60 giây),
độ dài hiển thị ô có thể khác một tick; test bảo đảm đủ mọi bản vẽ, không tuyên bố cadence 24 Hz chính xác.

Lưới tối đa 4×4. Ô logic giữ 256 px @2x; template 4×4 là 1024², có thể sinh ở 2048²
(512 px thô mỗi ô) rồi dùng `square-cell-dpi-v1` + calibration nhân vật đã khóa để chuẩn hóa.
Không resize master hoặc fit từng pose để lấp ô; giữ cùng camera, tỷ lệ và trục hông.
Walk/run dùng duration v2 để tính stride và ghost; sinh lại template, không dùng ghost từ bảng cũ.
Với hướng có stride y, giữ `vertical: "keep"`; khai báo tiếp đất thật và kiểm QA như D41.
Magenta là đường đi chroma-key hiện hành; giữ sheet gốc và guide/provenance. Atlas nhiều trang được phép,
không giảm ô hay scale để ép vừa một trang. Chưa có helper AI in-between trong profile này.

## Layer manifest và composer D45

`@vgtd/character` xuất `SpriteLayerSet`, `validateSpriteLayerSet`, `composeSpriteLayers`,
`namespaceSpriteLayerAtlas`, `SpriteLayerCache`, `EquipmentVisualMapping` và `resolveEquipmentVisuals`.
Đây là hợp đồng browser-safe, không đọc file hay gọi model/engine. Extraction/export và adapter Cocos là bước riêng;
manifest/composer chưa chứng minh art đã được trích hoặc swap set trong game.

Manifest `vgtd-sprite-layer-set` v1 gồm `id`, `role` (`body`/`weapon`/`fx`), `direction`, `motionId` dùng chung T1,
`frameRate` từ clock công khai, `canvas` (width/height/pivotX/pivotY), `textures` (resource stem trong thư mục set),
`displays` (tên/region, vị trí tâm y xuống so pivot, kích thước logic + kích thước texture) và `clips`.
Clip gồm `name`, `duration` tick, `loop`, `frames: [{ at, display, order? }]`, `events: [{ at, name }]`.
Frame đầu ở tick 0, ticks tăng nghiêm ngặt trong duration. Weapon bắt buộc `order: front/back` ở mọi khung,
kể cả khung ẩn (`display: null`); body không được ẩn. Cả ba set phải có cùng motionId, hướng, canvas, tick, loop và sự kiện.

Composer tạo đúng một armature với display-swap body/weapon, FX additive tùy chọn, z-order từng khung và **một** timeline
sự kiện lấy từ body. Atlas/displays được namespace theo role + setId để các set không đụng region.
Phải namespace từng atlas page trước khi đăng ký chung nhóm texture; không sửa atlas đầu vào.
Geometry dùng tỉ lệ kích thước logic/texture, không giảm body theo atlas. Test parser DragonBones thật Cocos 3.8.8
xác nhận cấu trúc hợp lệ; test render/swap runtime theo sau adapter.

Mapping `vgtd-equipment-visuals` v1 có `tiers.T1..T5: { body, weapon, fx, aura }`, `costumes: { id: { body } }`,
`weaponSkins: { id: { weapon } }` và `qualityGlow` chứa đầy đủ sáu QualityId từ shared, mỗi màu RGBA chuẩn hóa 0..1.
Màu phải lấy từ nội dung chuẩn D6/D44; module không sao chép palette hay quyết định giá/chỉ số.
`resolveEquipmentVisuals(mapping, { tier, quality, costume?, weaponSkin?, hideCostume? })` chọn độc lập body/weapon;
hideCostume chỉ bỏ body cosmetic, không bỏ weapon skin. FX/aura theo tier; glowTint áp dụng slot FX, không nhuộm lại thân.
`aura` là ID hook riêng, không phải chỉ số chiến đấu. Cache chỉ tải cặp set/hướng được yêu cầu, gộp request đồng thời,
cho retry khi lỗi và hỗ trợ evict/clear; không preload toàn bộ tier/cosmetic.

## Biến thể sửa từ master T1

T2–T5 và trang phục phải sửa ảnh từ sheet master T1 với cùng pose. Khai báo `project.variant` loại
`edit-from-master-v1`, `category` (`tier`/`costume`), `id`, đường dẫn/hash SHA256 project T1,
`edit: { tool, prompt }` và `thresholds: { minSilhouetteIou, maxJointDistancePx, minFaceSimilarity }`.
Không có ngưỡng ngầm; phải chọn và ghi rõ qua xem art. Nếu T1 dùng file calibration ngoài, thêm
`masterCalibrationSha256`. Mỗi clip khai báo `variant: { masterSheetSha256, annotations }`.
Giữ PNG nguồn, prompt chính xác và hướng nhân vật; project nguồn không được là một biến thể khác.
Số khung, thời lượng, loop, tableId và phase phải khớp T1. Cả hai cần scale cố định tường minh, không suy từ bbox quần áo.

Annotations là mảng theo thứ tự ô trong clip, mỗi ô có `master`/`edited`: các tọa độ khớp theo `POSE_JOINTS`
(crown của main hair cap, chin, shoulder_L/R, elbow_L/R, hand_L/R, pelvis, knee_L/R, foot_L/R),
và `face: { rect: { x, y, width, height } }`. Tọa độ dùng ô nguồn chuẩn hóa 256 px trước inset/crop/căn/palette lock,
không dùng bbox chứa búi tóc/vũ khí làm chiều cao giải phẫu. Khớp là chú thích thủ công cần xem ảnh; chưa có mô hình dò khớp.
Vùng mặt phải chứa mặt thật, cùng hình chữ nhật cho master/edited; ô mặt rỗng thất bại.
N/NE có thể ghi `face: { occluded: '<lý do đã xem>' }`, luôn báo **chưa đo**, không tuyên bố qua face-lock.

`sprite:variant-check --project <json>` chạy nhanh trước atlas; build/batch tự chạy cùng audit trước palette/căn.
Pose-lock kiểm IoU silhouette (alpha ≥128) và khoảng cách khớp lớn nhất; face-lock so RGBA tiền nhân trên hợp pixel có nội dung.
Không phải nhận dạng danh tính ngữ nghĩa. Áo thay hình có thể đổi silhouette, cần ngưỡng được xem art chấp nhận.
Cổng poseLock/faceLock là cổng cứng, không cho backlog hay exception bỏ qua. Sai hash, thiếu bằng chứng hoặc đổi timing/scale
là lỗi cấu hình. Sheet gộp dùng mapping clip cho cả hai phía. Contract lưu hash nguồn/project/calibration, sheet đã sửa,
annotations và số đo từng ô, kể cả ô đạt. Xem schema/ví dụ ở README của `@vgtd/sprite`.

Biến thể cũng pin masterImageSha256 của PNG master T1 và dùng lại PNG đó làm reference. Khóa mọi điều khiển ngoài storage/provenance: vertical (mặc định sole), kind (upright), contacts, tốc độ, exceptions, manifest cells/guides và slice; giữ đủ clip. Chỉ thay layout/DPI khi scale đầu ra bằng nhau. Khi xuất, dùng lại gốc căn từng ô T1 để phần vải mới không làm lệch thân vì centroid khác. Màu áo mới có thể giữ bằng palette lock tắt; không thay reference hình học T1.

## Bằng chứng kích thước đầu D47

[Cập nhật D47: giữ flight tuck, dash sâu, lunge và tóc secondary động; không làm phẳng pose để ép bbox.]

`smoothProjectClipDefaults` tự gắn `heightPolicy: "head-size-v1"` cho clip upright; dash v2 nay là upright.
Project đã viết trước PR phải thêm trường này và sửa dash thành `kind: "upright"`. Profile legacy không đổi.
Emote upright cũng theo cùng chính sách. Dùng `exceptions` theo chỉ số clip từ 0, chỉ hai reason hợp lệ:
`posture` và `secondary-overhang`. Generic `airborne`, `lunge`, `crouch` không được miễn cổng upright mới.

Schema:

```ts
project.masterHead = { crown: { x, y }, chin: { x, y } };
clip.heightPolicy = 'head-size-v1';
clip.exceptions = { '6': 'posture' };
clip.headEvidence = {
  '6': { crown: { x, y }, chin: { x, y }, note: 'Mô tả pose và bằng chứng đã xem' },
};
```

Mọi x/y là số hữu hạn, đo thực tế, không sao chép tùy tiện từ ví dụ. Crown là đỉnh sọ/main-cap gắn đầu,
không lấy búi tóc, ponytail, dải vải hay secondary hair; chin là cằm. Độ lớn đầu = khoảng cách Euclid crown–chin,
để đầu nghiêng không bị hiểu nhầm là co người. Master đo trên PNG master sau resize về ô 256 px @2x của pipeline.
Điểm từng khung đo trên **ô output đã căn 256 px @2x**, không phải atlas trim, toàn sheet hay tọa độ Cocos.
Nếu đo trên ô đã slice trước căn: `output = slicedPoint * calibration.scale + record.dx/dy`.
Nếu bắt đầu từ toàn ô chuẩn hóa, trừ inset trước; calibration là hệ số cố định của sheet/nhân vật, không fit từng khung.
Sheet gộp vẫn dùng chỉ số cục bộ clip: hit6 + dash10 có dash ở global6..15 nhưng evidence dash là local0..9.

- Ô upright bbox trong master ±3%, không exception: giữ cổng bbox cũ, không bắt buộc evidence.
- Ô exception hoặc bbox ngoài band: bắt buộc evidence + note, masterHead và reason hợp lệ.
- Đầu phải trong master ±3%; sai đầu/thiếu evidence/generic reason là lỗi cứng. Không có crouch band -8%.
- Mọi evidence đã cung cấp đều được kiểm, kể cả ô bbox trong band hay API legacy/free.
- Khi đầu ổn và reason được xem, lưu INFO cùng bbox thật, kích thước đầu, điểm đo và note. Không đổi scale hay ảnh.
- Lỗi chân, khung rỗng và cổng khác vẫn chạy; INFO không cho phép che foot slide/anatomy/face drift thật.

Contract giữ masterHead và headEvidence; batch/backlog report giữ INFO, `sprite:backlog` in chúng và trang review
có mục mở rộng **Head-size INFO evidence** theo ô. Bằng chứng nằm trong project/contract, không tự ghi vào danh sách
soft finding đã chấp nhận của quality-backlog.json. Các pose được chấp nhận phải được người xem kiểm landmarks;
chưa có head detector tự động. Variants phải giữ masterHead và các điều khiển/evidence của T1.

## Primitive trích vũ khí và kiểm tay D45

`extractWeaponLayer` nhận ô full/body-only/matte đã căn cùng kích thước, evidence và thresholds tường minh;
không tự gọi model hay suy ngưỡng. Body-only là image edit bỏ vũ khí + inpaint tay/da. Matte grayscale biểu diễn alpha
(đen/trong=0, trắng=đục, xám=bán trong). Difference + matte phục hồi phần vũ khí nhìn thấy, trả ảnh body/weapon/ghép lại,
số đo và cổng cứng weaponExtraction/handAlignment.

Mỗi ô khai báo front/back, hiện/ẩn, held/ridden/carried/detached, requiredAnchors, source/body/weapon points,
vùng inpaint pixel nguyên và note đã xem. Quyền giáp đôi cần cả hand_L/R; ngự kiếm dùng foot; contact rời tay phải ghi chưa đo.
Inpaint chỉ quanh contact đã xem và trong ngân sách diện tích khai báo. Kiểm repaint ngoài vùng, matte, sai order khi ghép,
vũ khí hiện/ẩn, khoảng cách contact/tay/grip và pixel đục gần điểm bám. Backlog không miễn các lỗi cứng này.
`qualityGlowLayer` tạo halo trắng tiền nhân, tint phẩm chất lúc chạy, không vẽ lại sáu bộ.

Alpha trên thân đục, phần hình học bị che và anatomy inpaint vẫn cần xem art; primitive không nhận dạng anatomy hay tự vẽ
phần khuất. Vùng matte ít khác nền nhưng không đổi được báo để kiểm. Ngưỡng phải khai báo, chưa chốt cấu hình chung.
CLI tạo guide chuẩn và xuất set độc lập theo sau ở PR riêng.

## Guide chuẩn để edit bỏ vũ khí D45

Chạy `sprite:layer-template --project project.json --out <thư-mục>` trong workspace `@vgtd/sprite` sau khi QA nguồn qua,
kể cả canvasLoss và regression backlog. Lệnh ghi source-N.full.png trong suốt và layer-inputs.json có SHA256 của
project/master/guide cùng map clip→ô. Guide là 4×4, mỗi ô256px, sheet1024px; sao chép đúng pixel output đã căn, không fit
hay căn lại từng pose. Sheet nhóm giữ mapping; cùng ô nguồn có hai bản aligned khác nhau thì báo lỗi.

Dùng đúng guide này làm ảnh tham chiếu AI edit bỏ vũ khí + inpaint tay/da lộ ra, giữ body/face/pose/scale và lattice.
Matte grayscale alpha vũ khí phải được xem riêng. Nếu model trả DPI khác thì chuẩn bị toàn sheet, không căn body/weapon
độc lập. Quyền giáp đôi nằm trong weapon set và cần cả hand_L/R. Giữ full-pose gốc làm provenance.

API công khai prepareLayerSources/writeLayerTemplates; runProject có tùy chọn includeAlignedFrames giữ pixel trong RAM,
không đổi file export mặc định. Xuất layer set độc lập theo sau; lệnh này chỉ tạo tham chiếu edit.

## Không mất nội dung khi căn vào canvas

Cổng cứng `canvasLoss` chiếu bbox opaque nguồn (alpha ≥128) qua scale cố định và dx/dy của alignment.
Bất kỳ cạnh nào ra ngoài ô output đều thất bại, kể cả khi bbox sau cắt lọt band chiều cao hoặc head evidence đúng.
Scale/record không hợp lệ cũng thất bại. Cổng không sửa ảnh, thu nhỏ hay fit từng ô; exception/INFO/backlog không được miễn.

Ca thật đã gặp: pre.height241, post.height232, scale1,dy-14 làm mất9px búi tóc nhưng cổng bbox/head vẫn có thể qua.
Regression test giữ nguyên kích thước đầu và tái hiện mất9px secondary hair; canvasLoss chặn source project đó.
Cổng kiểm loss do alignment, không khôi phục phần đã mất trong raw sheet hoặc inset; vẫn cần giữ và xem ảnh nguồn.

## Origin nguồn được duyệt cho pose động

`clip.authoredOrigins` tùy chọn dùng chỉ số ô **nội bộ clip**, kể cả sheet nhóm. Mỗi ô:
`{ "pelvisX": 118, "reason": "Wide lunge pelvis", "evidence": "Reviewed source frame6 landmark" }`.
Tọa độ nằm trên ô NGUỒN chuẩn hóa256px trước inset, x sang phải/y xuống. Pipeline đổi theo pitch thật rồi trừ inset;
scale calibration giữ nguyên. pelvisX thay centroid X bằng pelvis/axis đã xem. Không có groundY thì Y sole/keep như cũ.
`groundY` tùy chọn chỉ cho vertical keep, phải khai báo cùng một ground trên TẤT CẢ ô clip; không fit ground từng frame.
Reason và bằng chứng landmark/ảnh nguồn đã xem bắt buộc, không được dịch tùy ý chỉ để che anatomy/foot sai.

Không khai báo thì giữ hành vi cũ. Contract, backlog CLI và review giữ origin, source point áp dụng, scale,dx/dy dưới INFO.
Các cổng head/height/foot/canvasLoss không đổi; còn mất nội dung vẫn lỗi cứng. Variant giữ origin T1, không được thay.
Đây là annotation thủ công, không phải detector pelvis tự động; không thay bbox hay thu nhỏ body để lách gate.
