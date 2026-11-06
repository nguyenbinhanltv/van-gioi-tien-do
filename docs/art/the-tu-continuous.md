# Thể tu A — Sơn Môn Hộ Vệ, Track 2

Theo yêu cầu chủ dự án ngày 2026-11-06 và D34–D40. Nhánh art chỉ chứa dữ liệu Thể tu; công cụ dùng chung do worker 17 (`tools/procgen`) và worker 19 (`@vgtd/rig`, phối hợp worker 15 về key-pose) phụ trách. Không sửa dữ liệu Kiếm tu.

## Nguồn chuẩn và thứ tự

- Concept: [sheet A](../../assets-src/placeholder/the-tu-continuous-v1/reference/concept-a.png) và [mockup in-game](../../assets-src/placeholder/the-tu-continuous-v1/reference/concept-a-ingame.png), sao chép nguyên byte từ artifact worker 16. Metadata/prompt/UTC upstream trong `reference/concept-a.source.json`; mockup chỉ dùng duyệt, không dùng cắt mảnh.
- Danh sách mảnh, palette, VFX/icon: [prompt pack đã lưu](../../assets-src/placeholder/the-tu-continuous-v1/reference/prompt-pack.md), nguồn từ `C:/Users/PC/.ao/data/artifacts/van-gioi-tien-do-1/Prompt-pack-The-tu.md` (chỉ format Markdown).
- Quy trình: [rig-continuous-parts.md](rig-continuous-parts.md), [rig-classes.md](rig-classes.md), [parts-spec.md](parts-spec.md). Khi khác nhau, yêu cầu chủ dự án và quyết định mới nhất ưu tiên.
- Làm E trước: ảnh → xử lý → ráp rig → idle/run/attack → đo strict và capture Cocos. Báo cáo/contact sheet/capture phải có trước khi mở PR nháp. Sau đó mới S/SE/NE/N và đủ 15 clip; không merge PR.
- Bổ sung từ chủ dự án qua orchestrator: sau khi ráp E, sinh tham chiếu key-pose AI cho walk/run, combo đấm, guard, ground slam; gắn landmarks, dùng `fitPose` / `authorFromKeyPoses` của worker 15 khi có công cụ.

## Dữ liệu nguồn

Gốc: `assets-src/placeholder/the-tu-continuous-v1/`.

| Tệp/thư mục                         | Vai trò                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `production.json`                   | Kiểm kê 48 mảnh cơ bản mỗi hướng, tai có điều kiện, plate glow tùy chọn; 18 VFX và 11 icon/chân dung dùng chung; kế hoạch key-pose |
| `reference/E.master-generated.png`  | Ảnh master lần hai do công cụ sinh, 1254×1254                                                                                      |
| `reference/E.master4x.png`          | Master sinh mảnh, chuẩn hóa về 512×512, giữ nguyên trong quá trình sinh                                                            |
| `reference/E.register-master4x.png` | Master mục tiêu đăng ký riêng: resize 512→448 rồi đặt tại (32,44) trên canvas 512; hình cao khoảng 190 px @2x                      |
| `raw/E/<id>.png`                    | Mỗi ảnh sinh riêng, giữ cả vùng vẽ bị che; chưa phải PNG đưa thẳng vào rig                                                         |
| `raw/E/<id>.generation.json`        | Prompt đầy đủ, tham chiếu, đường dẫn ảnh được chọn, UTC, tool/model/CLI                                                            |
| `E.parts.json`                      | Guide hình học @2x, vật liệu, vùng lấy mẫu palette, bộ lọc, phép đăng ký/crop nguồn                                                |
| `E/landmarks.json`                  | Mốc khớp @2x, cùng tên khóa contract; tọa độ phải kiểm lại sau xử lý                                                               |
| `E/<id>.png`                        | Đích của xử lý: RGBA straight alpha 256×256; chưa coi là đã tồn tại/đạt khi chỉ có ảnh thô                                         |

Master chuẩn hóa bằng `decodePNG` / `resizeArea` của procgen: lọc có trọng số alpha, đầu ra straight alpha. Không thay nguồn tham chiếu trong khi một lượt sinh đang chạy. Ảnh thử đầu tiên giữ riêng để truy xuất, không dùng làm master nghiệm thu.

## Xử lý và ráp

Mỗi tay/chân phải là một mảnh liên tục; không dùng ảnh master cắt ra làm mảnh. Guide chỉ dùng đăng ký các ảnh đã sinh riêng. Vùng vật liệu `gold` là tên classifier hiện có của pipeline cho **đồng**, không phải thay palette thiết kế. `sash` và `boot` có vùng lấy mẫu riêng, tránh trộn xanh đai/giày với tóc.

Ảnh tay áo đầu tiên có lẫn vai tabard xanh. Các lượt yêu cầu sửa bị công cụ từ chối, không có đầu ra. Config crop chỉ chọn vùng vải ngà liên tục đã được AI vẽ để đăng ký về guide tay; không lấy pixel tay từ master, không tô thêm pixel bằng tay. Phải kiểm tra lại vùng chồng vai/cuff sau xử lý; nếu không đủ thì không ráp nghiệm thu.

Công cụ prep chuẩn đã vào main qua PR #100; nhánh art đã merge main và dùng nguyên bản công cụ đó, không còn diff `tools/procgen`. Các cờ crop, rotation, exclusion, clip, material alias và margin giữ nguyên trong manifest. Bộ ráp theo lớp, chuỗi cuff/hem và giữ detail Thể tu khi fit key-pose đã vào main qua PR #98/#99/#102; worker 19 phụ trách phần tooling Thể tu.

Tay áo chọn vùng vải ngà trên ảnh đã resize 512; đầu chọn vùng mặt thay vì co cả khối tóc vào mặt; mắt crop bỏ mày đi kèm; boot giữ vùng đế ngà. Phần đồng sáng trên tabard dùng alias classifier `skin` → `gold`, không đổi màu da của đầu. Khe cổ áo được xóa **trên mảnh tabard trước** bằng guide để lộ torso ngà riêng bên dưới. Không xóa pixel torso hoặc cắt cổ áo từ master.

Các gauntlet đổi hình quay nguồn về cùng phía cổ tay trước khi fit. Guide dùng tâm và bề rộng vùng lót ngà ở miệng gauntlet, lấy `relaxed` làm chuẩn theo từng bên; khôi phục tỷ lệ canvas ảnh nguồn trước khi định kích thước guide. Mọi biến thể cùng bên có cùng mốc miệng cổ tay. Các swap ngoài tư thế nghỉ không bị ép silhouette vào master relaxed; `restOrder` chỉ dùng display nghỉ. Các điểm/mặt nạ đã chọn được lưu đầy đủ trong `E.parts.json`, không cần vẽ pixel thủ công để tái tạo đầu ra.

Lệnh xử lý (có thể thêm đường dẫn báo cáo tạm ngay sau `process` / `check`):

```sh
node tools/procgen/scripts/continuous_parts.mjs process --source assets-src/placeholder/the-tu-continuous-v1 --dir E --manifest assets-src/placeholder/the-tu-continuous-v1/E.parts.json --master assets-src/placeholder/the-tu-continuous-v1/reference/E.register-master4x.png
node tools/procgen/scripts/continuous_parts.mjs check --source assets-src/placeholder/the-tu-continuous-v1 --dir E --manifest assets-src/placeholder/the-tu-continuous-v1/E.parts.json --master assets-src/placeholder/the-tu-continuous-v1/reference/E.register-master4x.png
```

Nguồn dùng chung đã có đủ 18 VFX, 10 icon (8 kỹ năng + biểu tượng lớp + vật phẩm) và một chân dung. `shared.exports.json` ghi từng đầu ra: icon nguồn 256 và bản 48/64/128 theo 05; chân dung 512 theo prompt pack; nguồn VFX 1024 giữ riêng dưới `reference/shared/vfx`, bản thành phần dùng thử 256, ba decal/vòng mặt đất 512×256 với biên 2:1. PNG straight alpha và resize có trọng số alpha; không xóa alpha mềm có chủ ý của khói/glow. Đây là **sprite thành phần tĩnh**, chưa phải flipbook hoặc hệ particle đã tích hợp, không thay đổi tỷ lệ gameplay.

Quyền sáo mặc trên tay, đổi display trong `hand_L` / `hand_R`; **không có bone/slot kiếm hoặc `weapon_R`**. Tabard nguồn kéo từ vai đến giữa đùi: phần ngực/vai cần theo thân, vạt dưới theo hông/đùi; phải kiểm tra rõ khi cúi/đấm. Các mảnh nhỏ giữ tệp nguồn riêng, có thể compose khi ráp để vừa ngân sách slot.

## Cổng nghiệm thu

Kiểm tra rest composite đã đạt: **50 mảnh**, max extra **2 px**, max missing **2 px** so master @2x, giữ nguyên ngưỡng kiểm. Baseline E đã qua **rig/engine gate**: 44/44 mảnh được dùng sau compose, **38 bones, 28 slots, 427 verts, 5 chains**; atlas **512×512 PMA**, padding 2, extrude 1, không có pixel RGB vượt alpha. Đủ **15 body clip** qua strict với **0 openings / 0 tears / 0 stretch / 0 strip faults**, thêm blink_cycle độc lập. Capture Cocos 3.8.8 thật của **đủ 15 body clip đạt**, 8 mẫu mỗi clip; seam idle/run/attack lần lượt 0,85 / 0,77 / 0,99. Chưa nghiệm thu đủ năm hướng. Giữ các cổng sau:

- `rig:measure --strict`: **0 openings / 0 tears / 0 stretch** trên rig đã ráp.
- Capture **Cocos thật**: E idle/run/attack trước, cuối cùng đủ 15 clip × 5 hướng. Không thay bằng render phần mềm.
- Trong `RIG_LIMITS`: 60 bones, 6 chains, 600 verts, 40 slots; atlas pow2 ≤2048, PMA, padding 2, extrude 1. PNG nguồn straight alpha; chỉ atlas/export PMA.
- Registration ≤2 px so master, kiểm tra alpha/white fringe, hướng sáng NW, silhouette và palette bằng contact sheet + capture.
- Trước push: `npm ci`, typecheck, test, build, lint, format:check; CI `verify (18)` và `verify (22)` phải xanh. Không tự merge.

## Trạng thái giấy phép

`image_gen.imagegen`, model không được công cụ công bố, `codex-cli 0.166.0`. Ảnh **AI-generated, placeholder, needs hand-polish + license review before release** theo D34; chưa tự xác nhận giấy phép thương mại. Prompt/UTC và cả các lượt không có đầu ra được ghi trong [ASSET-LICENSES.md](../ASSET-LICENSES.md).

## Tái lập baseline E và kế hoạch tiếp theo

```sh
npm run rig:assemble -w @vgtd/rig -- --class the-tu --parts assets-src/placeholder/the-tu-continuous-v1 --dir E --out apps/client-cocos/assets/resources/dragonbones/the-tu-continuous
npm run rig:gate -w @vgtd/rig -- the-tu --dir E --assembled <absolute-export-directory> --src dragonbones/the-tu-continuous --stem thetu --animations idle,run,attack --out <temporary-capture-directory>
```

Pilot AI idle `in/out` đã **đạt**: chọn `in` lượt 3 và `out` lượt 2 trong `raw/keyposes/E`, chuẩn hóa đồng đều vào `keyposes/E`. RMS của **clip hoàn thiện** 1,12 / 1,48 px; IoU 0,857 / 0,861, dịch tốt nhất (0,0) ở cả hai key. Giữ nguyên RMS ≤2 px, IoU ≥0,85, không dùng `--allow-errors`. E đã export idle fitted với detail Thể tu và qua lại strict/capture **đủ 15 body clip**. Guide trong `reference/keyposes/E` chỉ là render phần mềm phục vụ bố cục, không phải bằng chứng engine. Các lượt chưa đạt và annotation cũ được giữ trong raw/audit; lỗi round-trip spine đã sửa ở main PR #106 (RMS khoảng 0,17 px), annotation pelvis/chest dùng nghĩa origin xương thay vì tâm hình nhìn thấy. **Bulk key-pose run/walk/attack vẫn tạm giữ** chờ orchestrator xác nhận dáng đi chung.

Báo cáo/contact sheet/capture lưu trong artifact phiên `van-gioi-tien-do-18`. **Đủ năm hướng E/S/SE/NE/N đã đạt registration, strict và capture Cocos, tổng 75 body clip**. PR #104 là PR duy nhất; không tự merge. Bulk key-pose chuyển động vẫn giữ theo chỉ đạo, không được coi là đã sinh.

## Checkpoint S

Đã sinh riêng đủ 50 nguồn, xử lý ra PNG straight alpha 256×256 và kiểm tra rest composite: max extra **2 px**, max missing **2 px**, đạt registration. Các ảnh sinh thêm thân/áo được crop nguồn theo `sourceBounds4x` trước registration; raw giữ nguyên. Trâm ngọc lượt đầu sai nội dung được lưu trong `raw/S/rejected/`; lượt hai chỉ sinh trâm đơn lẻ. Hai lượt tay đầu không lưu được đầu ra, wrapper không giữ chi tiết lỗi/UTC bắt đầu; đã ghi rõ thiếu metadata đó thay vì suy đoán. Hai tay được sinh lại bằng mô tả ống tay áo liền và đã có đủ prompt/UTC.

Sau main PR #108, S đã ráp 44/44 mảnh, **38 bones / 28 slots / 445 verts / 5 chains**, atlas 512×512 PMA không có RGB vượt alpha. Nguồn đầu được sinh lại để giữ mũi/tai/hàm; crop overlay mắt/miệng đo trên nguồn 512, mảnh môi nghỉ dùng palette nét tối để đọc ở kích thước game. Đã xuất viewer và gate lại sau thay đổi art cuối: **đủ 15 clip strict 0 openings / 0 tears / 0 stretch / 0 strip faults; capture Cocos đủ 15 clip PASS**. Lỗi gait/hem trước đó được sửa trong tooling do worker 19 sở hữu, không bỏ QA hoặc đổi ngưỡng.

## Nghiệm thu đủ năm hướng

| Hướng | PNG nguồn chọn | Mảnh ráp dùng | Bones | Slots | Verts | Chains | Strict / Cocos |
| ----- | -------------- | ------------- | ----- | ----- | ----- | ------ | -------------- |
| E     | 50             | 44            | 38    | 28    | 427   | 5      | 15/15 đạt      |
| S     | 50             | 44            | 38    | 28    | 445   | 5      | 15/15 đạt      |
| SE    | 50             | 44            | 38    | 28    | 439   | 5      | 15/15 đạt      |
| NE    | 46             | 40            | 38    | 27    | 434   | 5      | 15/15 đạt      |
| N     | 35             | 30            | 34    | 22    | 414   | 4      | 15/15 đạt      |

Mỗi hướng: max extra/missing **2 px**, atlas **512×512 PMA**, pad 2, extrude 1, zero pixel RGB vượt alpha (cả kiểm tra trang pack và PNG encode đọc lại). Strict đo **clip thực đã export** theo main PR #103: **0 openings / 0 tears / 0 stretch / 0 strip faults** trên cả 75 body clip. Capture Cocos thật lấy 8 mẫu/clip, đầy đủ 15 clip/hướng. N không có blink_cycle vì không có slot mắt; bốn hướng còn lại có thêm lớp blink độc lập.

Tooling theo hướng đến từ main PR #108–#112: gait theo tầm chân, hem theo shin, thứ tự lớp sau và visibility. NE chỉ có mép mắt/mày nhìn thấy, không miệng/tai rời; N không có 11 overlay mặt hoặc ba lọn tóc mái trước. Mảnh knot phía trước không compose lên đai sau; hai đuôi đai nằm **dưới** vạt lưng và chỉ ló phần thấp. Raw tùy chọn vẫn được giữ. Số mảnh ít hơn ở NE/N là phần bị che theo registry, không phải thiếu đầu ra bắt buộc.

`eyes_angry` là display dự trữ (blink_cycle giữ quyền mắt, trừ meditate đóng mắt); `gauntlet_plate_glow_R` chưa wire vào rig. Các clip dùng guard/fist/open/ground theo detail lớp Thể tu; attack/attack_2/attack_3 là jab/cross/palm, cast là ground slam. VFX hiện là sprite thành phần tĩnh; không coi là particle/flipbook đã tích hợp.

Để tái lập E fitted idle, thêm `--keyposes assets-src/placeholder/the-tu-continuous-v1/keyposes` vào lệnh assemble. Các hướng khác dùng cùng lệnh với `--dir S|SE|NE|N`, không thêm key-pose chưa được cho phép. `production.json` lưu số đo và danh sách animation của từng capture; báo cáo HTML cùng contact sheet lưu trong artifact, không đưa frame/log build vào repo.
