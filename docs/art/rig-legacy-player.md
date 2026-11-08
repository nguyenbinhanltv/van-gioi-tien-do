# Rig Player thời D39/D40 (lịch sử; thay thế một phần bởi D41)

> **Trạng thái:** gộp từ năm tài liệu rig-era: `kiem-tu-rig-spec` (dữ liệu rig Kiếm tu), `rig-classes` (registry 4 Đạo Lộ), `rig-continuous-parts` (D39, chi liền), `rig-keypose` (D40, key pose) và `rig-approach-memo` (memo chọn phương án trước D39). Từ D41 thân nhân vật **Player** là sprite sheet AI từng khung ([sprite-sheet-pipeline.md](sprite-sheet-pipeline.md)); các mục dưới chỉ còn đúng cho Boss / NPC dùng `@vgtd/rig` ([rig-pipeline.md](rig-pipeline.md)) và cho lịch sử. Mỗi phần giữ nguyên nội dung gốc, tiêu đề hạ một cấp. Bản đặc tả mảnh sinh tự động: [parts-spec.md](parts-spec.md); danh sách vẽ bù sinh tự động: [rig-underpaint.md](rig-underpaint.md).

## A. Dữ liệu rig Kiếm tu (từ kiem-tu-rig-spec.md)

Ngày: 2026-11-06. **AI placeholder; chưa phát hành.** D35 chọn DragonBones, D36 quy định AI tạo cả art/rig/animation và người chỉ duyệt trong viewer. D37 chọn concept A + kiếm rút tay phải như B cho idle/combat/locomotion; chỉ idle phi chiến đấu/trong thành mới đeo kiếm. Lô này chưa có biến thể trong thành; C chỉ giữ làm tham chiếu trưởng lão.

### 1. Phạm vi và sở hữu

- Worker art sở hữu nguồn art, cutout, atlas và **dữ liệu** trong `tools/rig/data/`.
- `@vgtd/rig` (worker `van-gioi-tien-do-15`) sở hữu schema chuẩn, validator, exporter DragonBones 5.5/5.6 và bộ công cụ animation. **PR art không chứa exporter DragonBones hay Spine.**
- Viewer (worker `van-gioi-tien-do-7`) dùng đầu ra exporter để nạp `dragonBones.ArmatureDisplay`. Dữ liệu rig trung lập không phải JSON runtime để nạp thẳng vào Cocos.
- Không phụ thuộc animator hoặc GUI editor. GUI có thể dùng để kiểm tùy chọn theo D36, không phải bước sản xuất bắt buộc.

### 2. Cây file

| File / thư mục                                                   | Nội dung                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `tools/rig/data/kiem-tu.rig.json`                                | `RigSet { id, rigs }`, năm `RigDocument` S/SE/E/NE/N theo schema của worker 15                |
| `tools/rig/data/kiem-tu.idle.json`                               | Một `Clip` trung lập `idle`, dùng tên bone chung cho cả năm hướng                             |
| `tools/rig/data/kiem-tu.assets.json`                             | Manifest đường dẫn atlas/texture, thông số source scale, mirror, slot order và source sockets |
| `assets-src/placeholder/kiem-tu-rig-v1/turnaround/<dir>.png`     | Năm canvas 256×256 @2x, hình cao 208 px, pivot (128,232), ánh sáng NW                         |
| `parts/<dir>/<slot>.png` dưới thư mục nguồn                      | Đủ 15 nhóm paperdoll; nhóm không trang bị có PNG trống dành chỗ                               |
| `pieces/<dir>/<piece>.png` + `layout.json`                       | 33 mảnh/canvas 256×256 mỗi hướng, bone/group/bounds; mảnh bị che hoàn toàn có thể trống       |
| `atlas/<dir>/atlas.json` + `kiemtu_<dir>.png` dưới thư mục nguồn | `AtlasData` và một page **PMA** chứa mảnh riêng lẫn canonical region fallback                 |
| `preview/` và `contact-sheet.png` dưới thư mục nguồn             | Ảnh review tĩnh; không phải capture trong Cocos                                               |

Các đường dẫn trong assets manifest là **tương đối repo root**. `AtlasData.imagePath` tương đối thư mục atlas. Không có file `.atlas` hoặc skeleton Spine trong lô hiện hành. File runtime DragonBones do `@vgtd/rig` sinh sau từ các đầu vào này, không tạo exporter thứ hai ở procgen.

### 3. Hệ tọa độ và schema

Rig space: gốc ở pivot chân, x sang phải, **y lên**, góc CCW; toàn bộ bone/vertex/region transform dùng **@1x**, canvas 128×128. Texture @2x; không scale skeleton xuống 0,5 lần nữa. Exporter chịu trách nhiệm chuyển sang hệ tọa độ DragonBones.

Một `RigDocument` có:

- `format: 'vgtd-rig'`, `version: 1`, `id`, `kind: 'player'`, `direction`, `canvas`.
- `bones`: parent đứng trước con; root đầu tiên có `parent: null`, (0,0). Các biến đổi là local so với parent, length dọc local +x.
- `roles`: đủ 21 vai trò của schema phối hợp, gồm `root`, `hips`, `spine_mid`, `spine_upper`, `head`, các đoạn tay/chân và bốn IK target.
- `ik`: bốn constraint hai bone, target là helper độc lập dưới root, `bendPositive` theo rig space y-lên; exporter đổi dấu khi đổi hệ.
- `chains`: sáu nhóm secondary motion; `stiffness/damping/inertia` là tham số authoring thử, không phải giá trị gameplay đã khóa.
- `sockets`: gắn bone với offset local; dùng socket công khai của character, override vị trí tay theo art. `head_top`/orbit/feet UI đặt trên root để không rung theo đầu.
- `slots`, `skins`: cấu trúc theo `@vgtd/rig`, mô tả ở dưới.

Đã chạy **validator thật của `@vgtd/rig` trên main** qua public entry point với `requireRoles: BONE_ROLES`: cả năm hướng không có lỗi/cảnh báo. Schema chuẩn là `RIG_JSON_SCHEMA` do `@vgtd/rig` export; lô art không sao chép schema.

Test `tools/procgen/test/kiem-tu-export.test.mjs` kiểm RigSet đã commit bằng `validateRigSet` với `KIEMTU_REQUIRED_ROLES`, rồi gọi `exportDragonBones` cho từng hướng với atlas thật và idle Clip. Test kiểm skin weighted, skin fallback, bone/slot/IK và idle loop; chỉ export trong bộ nhớ, không commit output runtime. Hai constraint chân tên `ik_leg_L/R` để toolkit điều khiển mix khi chết; target bone vẫn tên `ik_foot_L/R`. Đây chưa phải kiểm hình ảnh/nạp asset trong viewer Cocos.

Test cũng chạy `runQa` cho idle trên cả năm rig: khai báo `spine_upper` được dịch chuyển có chủ đích để thở, giữ các ngoại lệ root/hips/IK mặc định; các kiểm tra seam, trượt chân, reach và key vẫn chạy. Manifest phải trỏ đúng texture; kích thước PNG, bounds/kích thước từng region và toàn bộ pixel PMA phải khớp PNG part/piece đã commit.

### 4. Bone và IK

**34 bones art + 4 helper IK = 38**, dưới giới hạn player 60. Bone anatomical/chain có length và hướng dọc chuỗi; root, target và hand anchor có thể length 0.

```text
root
├─ hip
│  ├─ spine_mid → spine_upper → neck → head
│  │              ├─ upper_arm_R → lower_arm_R → hand_R → weapon
│  │              │                └─ sleeve_tip_R
│  │              └─ upper_arm_L → lower_arm_L → hand_L
│  │                               └─ sleeve_tip_L
│  ├─ thigh_R → shin_R → foot_R
│  ├─ thigh_L → shin_L → foot_L
│  ├─ sash_L_1 → sash_L_2
│  ├─ sash_R_1 → sash_R_2
│  ├─ robe_front / robe_back / scabbard
│  └─ (head có các nhánh bên dưới)
├─ ik_foot_L / ik_foot_R
└─ ik_hand_L / ik_hand_R

head
├─ hair_back_1 → hair_back_2
├─ hair_front_1 → hair_front_2
└─ ribbon_1 → ribbon_2
```

Hai foot IK dùng thigh/shin; hai hand IK dùng upper/lower arm. Target đặt tại rest foot/hand; idle giữ foot target cố định và cho hand target đi cùng nhịp thở để không mâu thuẫn FK. Preview FK không phải bộ giải IK runtime; package toolkit phải kiểm cả nghiệm IK.

Sáu chain: tóc sau, ribbon, sash L/R, sleeve L/R. Sleeve chain chỉ gồm bone tip, không đưa forearm vào mô phỏng vải để tránh kéo bàn tay/kiếm. Tóc trước còn bone riêng và key idle, không thêm chain thứ bảy vượt hạn mức secondary motion.

### 5. Paperdoll, mesh và fallback

13 slot skeleton lấy từ `getCharacterViewState(...).slotOrder`; hai orbit nằm ngoài skeleton. Tên API cũ như `SPINE_SLOT_IDS`/`SPINE_KEY_FPS` vẫn là identifier public hiện tại, **không có nghĩa dữ liệu dùng format Spine**. Mỗi slot có `paperdoll` trùng nhóm logic; manifest ghi draw order cho cả tám hướng thật, không lấy thứ tự E áp nguyên cho W.

| Nhóm                                                   | Mảnh riêng                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `orbit_back/orbit_front`, `wing`, `cape`, `sword_back` | PNG trống dành chỗ; mẫu không có pháp khí quỹ đạo/cánh/phi phong/kiếm đeo lưng |
| `body`                                                 | torso_base, neck, thigh/shin/foot L/R; vùng bị áo che được vẽ bù bằng mã       |
| `outfit_lower`                                         | robe_front, robe_back, scabbard rỗng gắn hip                                   |
| `outfit_upper`                                         | coat, sash_L_1/2, sash_R_1/2                                                   |
| `head`                                                 | face và nền vẽ bù dưới tóc                                                     |
| `hair_back`                                            | hair_back_1/2, hair_ribbon_1/2                                                 |
| `hair_front`                                           | hair_front_1/2                                                                 |
| `headwear`                                             | hairpin                                                                        |
| `arm_R/arm_L`                                          | upper_sleeve, lower_sleeve, sleeve_tip, hand theo bên                          |
| `weapon_R`                                             | sword, bone weapon là con hand_R                                               |

Skin **default** ghép nhiều quad island thành mesh theo slot. `vertices` là cặp x/y trong **slot-bone space**; `weights[vertex]` là danh sách `[[boneName, weight], ...]` cộng bằng 1, không phải mảng encoded theo format engine. UV chuẩn hóa trên region, v hướng xuống ảnh. Region `kiemtu_page` bao phủ cả page; từng island lấy vùng pack của mảnh. Hiện mỗi vertex có một influence, chưa có soft blend/FFD; toolkit có thể tinh chỉnh weights.

Skin **bones-only** dùng region canonical `slot_<slotName>` và transform bù đúng slot bone. Đây là fallback cứng theo nhóm để kiểm tương thích; không có biến dạng khuỷu/gối chi tiết như weighted skin. Hai skin dùng chung page. Exporter do worker 15 sở hữu phải chọn/hỗ trợ skin phù hợp; không được âm thầm coi weighted skin là đã chạy được chỉ vì có fallback.

`weapon_R_mirrored` hiện là alias idle để adapter không chọn attachment thiếu; chưa là art bất đối xứng được vẽ riêng. SW/W/NW dùng SE/E/NE + mirror D14 và thứ tự vẽ theo hướng thật. Toolkit phải kiểm tay cầm, grip, ánh sáng và blade ở bản mirror; không lấy bộ idle này thay cho attack/cast/channel tám hướng.

### 6. Atlas

Page hiện 512×512 POT mỗi hướng; packer hiện có dùng **2 px clear padding + 1 px extrusion**, tắt xoay. `AtlasData` có `imagePath,width,height,premultipliedAlpha:true,regions[]`. Region names khớp attachment paths: full-page, từng mảnh và canonical fallback.

PNG giao đã premultiply RGB; không nhân alpha lần hai. Nguồn cutout vẫn straight alpha. Hệ số @2x thuộc texture; region attachment width/height và vertex geometry đã là logical @1x. Exporter phải xử lý tỷ lệ ảnh/geometry đúng, không giả định chúng cùng đơn vị. Không có KTX2/ASTC/WebP hoặc cấu hình bundle trong PR art.

### 7. Idle và bộ công cụ animation

`kiem-tu.idle.json` dùng đúng kiểu `Clip` phối hợp: `name,frames,loop,bones,slots,ik,events`. Các `BoneTrack` chứa key `{frame,value}`; translate là vector local, rotate là delta độ, không phải tọa độ tuyệt đối. Clip thử 60 frame ở key FPS 30 (2 s), 17 key lấy mẫu gần 8 Hz rồi lượng tử hóa trên lưới 30 fps. Đầu/cuối trùng nhau; root/hip/feet cố định; có motion nhẹ ở chest/tóc/ribbon/sash/sleeve tips. Không phải sprite animation 8 frame.

Toolkit authoring sẽ làm bộ đầy đủ; chưa có clip run/attack/cast/hit/die trong lô này. Thứ tự kiểm theo docs/03 và API:

| Animation             | Frame / FPS Sprite | Thời lượng                         | Ghi chú                                    |
| --------------------- | ------------------ | ---------------------------------- | ------------------------------------------ |
| idle                  | 12 / 12            | 1,0 s Sprite; thở skeletal 1,5–2 s | Bộ thử hiện 2 s, cần chủ art duyệt viewer  |
| run                   | 10 / 20            | 0,5 s                              | Footstep frame 2 và 7                      |
| attack × combo 3 nhịp | 10 / 24 mỗi nhịp   | 0,42 s mỗi nhịp                    | Lấy đà–hit–thu; không bịa frame hit/cancel |
| cast                  | 14 / 28            | 0,5 s                              | vfx_spawn cuối lấy đà                      |
| hit                   | 4 / 20             | 0,2 s                              | Theo điều kiện ngắt của spec               |
| die                   | 12 / 15            | 0,8 s                              | Giữ frame cuối                             |

FPS Sprite không phải FPS key của rig. Người chỉ duyệt trong engine theo D36; chất lượng chưa hoàn thiện cho tới khi được chấp nhận. Bộ QA/animation toolkit phải kiểm xuyên mảnh, vùng bù ở khớp, loop, IK, chân trượt, grip, slot order và giới hạn rig.

### 8. Tái tạo, kiểm chứng và giới hạn

```sh
npm ci
npm run gen:kiemtu -w @vgtd/procgen -- build
npm run gen:kiemtu -w @vgtd/procgen -- validate
npm run gen:kiemtu -w @vgtd/procgen -- review <session-artifact-dir>
```

Đầu vào là năm PNG chuẩn hóa đã commit; tùy chọn `import <sheet.png>` ghi đè từ sheet AI. Mã procgen tách/vẽ bù và tạo **data** theo schema phối hợp; không gọi AI lại, không sinh format runtime. Packer chỉ ghi trung gian vào ignored build; bộ source/data có chủ đích mới vào Git.

Gate kiểm canvas/inventory, slot order API, role/parent/IK/chain references, UV/triangles/weights, rig limits, loop/key grid, regions và PMA channels. Tests kiểm round-trip tọa độ, target tay đi cùng FK, chân cố định, fallback region và vẽ bù không che pixel nguồn tại rest. FK preview/contact sheet là công cụ review độc lập, **không phải capture DragonBones/Cocos hoặc chứng minh exporter chạy**. Runtime export/load và QA hình ảnh trong engine thuộc bước phối hợp tiếp theo.

Mọi asset/prompt/UTC/công cụ/mô hình không công bố nằm trong [ASSET-LICENSES.md](../ASSET-LICENSES.md). Art AI và dữ liệu dẫn xuất vẫn placeholder, bắt buộc rà soát giấy phép/nguồn gốc trước phát hành. Không thêm phụ thuộc animator/editor hoặc triển khai server/netcode.

## B. Registry 4 Đạo Lộ (từ rig-classes.md)

> Tổng quát hóa quy trình Kiếm tu (docs/art/rig-pipeline.md) cho Thể tu, Pháp tu, Đan/Phù tu. Concept của ba lớp còn chờ chủ dự án chọn; phần này chuẩn bị sẵn để art vẽ đúng ngay lần đầu và để rig/hoạt cảnh/xuất viewer chạy mà không thêm mã theo lớp.

### 1. Registry (`src/classes.ts`)

Mỗi lớp là một mục dữ liệu `CLASSES[id]`: tên, `stem` file viewer, luật vũ khí, quỹ đạo sprite (`orbit`), slot bắt buộc / tùy chọn, chuỗi chuyển động phụ riêng, giới hạn góc khớp (`caps`). Đường dẫn theo quy ước chung `characterPaths(id)`: dữ liệu `tools/rig/data/<id>.{assets,rig}.json`, gói viewer `apps/client-cocos/assets/resources/dragonbones/<id>/`.

| Lớp        | id           | stem       | Vũ khí và luật slot                                                                          | Quỹ đạo (sprite node) |
| ---------- | ------------ | ---------- | -------------------------------------------------------------------------------------------- | --------------------- |
| Kiếm tu    | `kiem-tu`    | `kiemtu`   | kiếm tay phải, `weapon_R` (+ biến thể lật), `sword_back` có nhưng ẩn khi kiếm trên tay       | phi kiếm ×1           |
| Thể tu     | `the-tu`     | `thetu`    | quyền sáo **mặc vào tay** (`arm_L`/`arm_R`), **không có** `weapon_R`; QA cấm hiện `weapon_R` | không                 |
| Pháp tu    | `phap-tu`    | `phaptu`   | pháp trượng hoặc quạt: `weapon_R` (+ biến thể lật); thêm chuỗi tay áo                        | không                 |
| Đan/Phù tu | `dan-phu-tu` | `danphutu` | phất trần hoặc bút phù: `weapon_R` (+ biến thể lật); đuôi phất trần là chuỗi phụ             | phù lục ×4            |

Luật `weapon` của QA (`runQa({ weapon })`): `'one'` đúng một `weapon_R` hiện mỗi khung và không hiện kiếm lưng cùng lúc; `'none'` (gauntlets) không được hiện `weapon_R`.

### 2. Đặc tả mảnh cho art (`src/parts.ts`, `docs/art/parts-spec.md`)

Với mỗi mối nối ở khớp, `partsSpec` nói **mảnh nào phải kéo dài vẽ bù dưới mảnh nào và bao nhiêu px**: `margin = ceil(w · sin(θ/2))` với w = **bề rộng thật của mối nối** tại khớp (`SEAM_WIDTH_PX`, chi/thân 10-26 px, lấy từ các mảnh Kiếm tu thật) và θ = **góc khớp lớn nhất mà bộ animation của lớp đòi hỏi**, đo trên rig (`measuredJointCaps`, làm tròn lên 5°, sàn 20°), không còn lấy bề rộng mảnh danh nghĩa. Mảnh nằm **sau** theo thứ tự vẽ của từng hướng (`drawOrderFor`) kéo dài xuống dưới mảnh nằm trước; các đảo của cùng một slot (chi trong `body`, `arm_*`) không có thứ tự nên cả hai cùng kéo dài. `docs/art/parts-spec.md` là bản sinh cho cả 4 lớp, CI kiểm khớp bản sinh mới; cập nhật bằng `RIG_GEN_PARTS_SPEC=1 npm run gen:parts-spec -w @vgtd/rig`. Đối chiếu: phần dư sau vòng 3 của Kiếm tu (gối 12-18 px, khuỷu 12-15 px, cổ chân 9 px) nằm trong dải margin của bảng.

### 3. Sinh rig mẫu từ thư mục mảnh (`src/template.ts`)

`scanPartsFolder('parts', id)` đọc `parts/<HƯỚNG>/<slot>.png` (kích thước PNG ÷ texture scale) → `PartsManifest`; `checkPartsManifest` kiểm luật lớp (slot bắt buộc, vũ khí, `sword_back`, không có `orbit_*`, kích thước); `buildRigTemplate` sinh `RigSet` 5 hướng: bộ xương người chuẩn, slot theo thứ tự vẽ `@vgtd/character` của từng hướng, mảnh quad có trọng số (cùng dạng dữ liệu Kiếm tu nên `autoSkin`, QA, bộ xuất dùng nguyên), chuỗi phụ theo lớp, vũ khí theo luật lớp. `packTemplateAtlas` xếp atlas pow2 tạm (trước khi có packer của dự án).

### 4. Re-target hoạt cảnh (`src/class-clips.ts`)

Mọi lớp dùng lại bộ Kiếm tu (chạy, đi, dash, hit, chết, đả tọa, độ kiếp, emote...) và chỉ ghi đè thứ phụ thuộc vũ khí: combo 3 đòn, cast, channel, tư thế idle. Ghi đè là **bảng pose theo lớp** (`CLASS_CLIPS`: windup/hit, gather/release, pose + tremor), dựng bằng vài hàm chung, nên thêm lớp là thêm bảng. Thể tu: guard + đấm/móc/chưởng đôi + giậm đất; Pháp tu: gậy/quạt vung, đâm hai tay, giơ gậy niệm; Đan/Phù tu: phất trần, vẽ phù, ném phù lục bằng tay trái. `authorClassSet(id, rig)` ra đủ 15 clip, qua cùng cổng QA (kể cả luật vũ khí).

### 5. Xuất cho viewer theo nhân vật (`src/characters.ts`)

`loadCharacterData(repoRoot, id)` đọc dữ liệu theo registry (báo lỗi rõ khi chưa có dữ liệu); `buildViewerPackage` / `writeViewerPackage` xuất `<stem>_<HƯỚNG>_{ske,tex}.json + _tex.png` vào thư mục viewer của nhân vật (mở bằng `#viewer&src=dragonbones/<id>&stem=<stem>`). Lệnh: `RIG_EXPORT_DIR=<thư mục> npm run export:character -w @vgtd/rig` (Kiếm tu hiện tại; lớp khác khi có dữ liệu).

### 6. Thêm một nhân vật

1. Chọn concept, art vẽ theo `parts-spec.md` (đã có vẽ bù).
2. `scanPartsFolder` → `checkPartsManifest` → `buildRigTemplate`; ghi `tools/rig/data/<id>.rig.json` và `<id>.assets.json` (atlas bằng packer dự án).
3. `authorClassSet` + QA; `autoSkin`/`underpaintNeeds` để đo; xuất viewer; thêm hàng `ASSET-LICENSES.md`.

### 7. Giới hạn đã biết

- Pose ghi đè của ba lớp mới là bản đầu theo mô tả docs/11, chưa duyệt trong viewer; `sword_fly` dùng lại clip Kiếm tu cho mọi lớp (cần biến thể theo vũ khí khi có concept).
- Chưa có dữ liệu thật của ba lớp: test dùng rig mẫu sinh từ kích thước danh nghĩa.

### 8. Ráp chi liền theo lớp (`src/class-profile.ts`, `rig:assemble --class <id>`)

`AssemblyProfile` gom mọi thứ riêng của một lớp khi ráp theo D39: danh sách mảnh (thứ tự vẽ, kiểu gắn xương), xương của rig gốc bị bỏ, luật detail (đổi display theo hành động), dáng chạy (`GaitProfile`), hướng gập gối (`ikBend`) và luật vũ khí cho cổng QA. Thêm lớp = thêm một entry + thư mục mảnh, không thêm nhánh code. Rig Kiếm tu E vẫn là rig gốc cho vai trò xương, IK và socket; xương theo landmark của lớp, IK đặt lại theo mắt cá (`snapIk`).

**Thể tu A** (`THE_TU_PROFILE`, stem `thetu`): quyền sáo là 5 display mỗi bên (`gauntlet_{L,R}_{relaxed,guard,fist,open,ground}`) trên slot `hand_L` / `hand_R`, không có xương/slot kiếm, `weapon_R`, vỏ kiếm, trail hay glint. Tabard chia trước/sau gắn kiểu `skirt` + `spine` (`spineWeights`): phần trên hông theo xương sống như thân, phần dưới theo đùi và cánh váy `robe_front/back`. Cổ gộp vào thân, hai vai tabard gộp một slot, đai + nút gộp một mảnh theo xương sống; 2 đuôi đai và 2 lọn tóc dài là chain, lọn mái ngắn gắn cứng vào đầu. Mắt/mày/miệng đổi theo clip (mày qua `ClipDetail.extra`); mắt chỉ do `blink_cycle` giữ (trừ meditate), `eyes_angry` để dành cho runtime. Dáng chạy `THE_TU_GAIT`: nửa sải, gối nông vừa phải, bước giậm, nghiêng người; cả hai gối gập về phía trước (rig gốc gập gối R ra sau, bị áo dài che trong pilot Kiếm tu, nhưng với quần lộ chân thì thành chân vòng kiềng).

**Theo hướng** (`AssemblyProfile.piecesByDir`, `profilePieces(profile, dir)`; Thể tu: `THE_TU_PIECES_BY_DIR`): E / SE / S dùng thứ tự E (`restOrder` của art). **NE**: tay xa và tấm tabard trước nằm sau thân, tấm tabard sau đè lên thân (mang tag `outfit_upper`), tóc sau đè lên đầu (drawOrder NE), tay gần vẽ cuối; chỉ giữ rìa mặt thấy được (mắt, mày; không miệng, không tai). **N**: cả hai tay sau thân, tabard sau hiển thị, không có mặt (bỏ 11 swap mắt/mày/miệng + tai + lọn mái), tóc sau che đầu. NE và N: hai đuôi đai vẽ TRƯỚC tabard sau (ngay sau thân): tabard sau che phần trên, chỉ đầu đuôi lòi ra dưới gấu, dải đai vẫn đè lên tabard sau; đai chỉ ghép `sash_band` (nút đai ở phía trước, bị che; hai đuôi đai lòi ra dưới tabard sau). Tên mảnh nguồn giữ nguyên; thiếu tệp chỉ bị báo, không chặn ráp. Tư thế đòn đánh và dáng đi từng hướng vẫn cần kiểm riêng (OPEN-ITEMS 11).

## C. Chi liền, hợp đồng mảnh cho art (D39; từ rig-continuous-parts.md)

> **[Thay thế một phần bởi D41, 2026-11-06]** Với **thân nhân vật Player**, quyết định D41 (sprite sheet AI từng khung, xem [sprite-sheet-pipeline.md](sprite-sheet-pipeline.md)) thay cách làm bằng rig xương trong tài liệu này; tài liệu giữ lại làm tham chiếu cho boss/NPC và mã `@vgtd/rig` (không phát triển thêm cho thân Player).

Quyết định **D39** của chủ dự án (2026-11-06, xem `docs/DECISIONS.md`): bỏ cách "cắt mảnh chữ nhật từ một ảnh", chuyển sang **vẽ từng bộ phận đầy đủ** và dựng **một mesh liền cho cả tay / cả chân**. Bản này là đặc tả mảnh cho worker art; công cụ nằm ở `tools/rig/src/limb.ts` (`buildLimbMesh`, `buildSkirtMesh`). Nền tảng số liệu: `docs/art/rig-approach-memo.md` (phương án B + C).

### 1. Định dạng file

- Mỗi mảnh là **một PNG RGBA 256×256** (@2x của canvas 128×128), cùng hệ tọa độ với ảnh master của hướng đó, nền trong suốt, **vùng bị che phải vẽ đầy đủ**.
- Thư mục: `assets-src/placeholder/kiem-tu-continuous-v1/<hướng>/<mảnh>.png`; thêm `landmarks.json` (`{tên: [x, y]}`, px @2x, x sang phải, y xuống, gốc ở góc trên trái canvas 256).
- Xương của hướng được dựng lại từ `landmarks.json`; vì vậy chi có thể vẽ **thẳng, trung tính** (tay thõng, chân thẳng đứng), không cần khớp tư thế nghỉ cũ.
- Gốc (pivot) của nhân vật: `(128, 232)` @2x. Cả hình cao ~190 px @2x.

### 2. Mốc khớp hiện tại của hướng E (đích, px @2x)

| mốc            | x, y     | mốc        | x, y     |
| -------------- | -------- | ---------- | -------- |
| cổ (neck base) | 118, 78  | hông R     | 110, 139 |
| gốc đầu        | 124, 55  | gối R      | 109, 185 |
| vai R          | 120, 86  | cổ chân R  | 108, 223 |
| khuỷu R        | 120, 112 | mũi chân R | 120, 232 |
| cổ tay R       | 128, 138 | hông L     | 126, 139 |
| vai L          | 112, 86  | gối L      | 127, 185 |
| khuỷu L        | 110, 110 | cổ chân L  | 128, 223 |
| cổ tay L       | 116, 134 | mũi chân L | 140, 232 |
| eo             | 118, 118 |            |          |

Sai lệch cho phép so với master: ~3 px. Hướng E: L là bên xa, R là bên gần.

### 3. Danh sách mảnh (thứ tự vẽ từ sau ra trước, hướng E)

|   # | mảnh                                                                      | slot                         | ghi chú                                                                               |
| --: | ------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
|   1 | `hair_back`                                                               | hair_back                    | khối tóc sau                                                                          |
|   2 | `ribbon_tails`                                                            | slot phụ                     | 2 đuôi dải buộc tóc, chain `ribbon_1/2`                                               |
|   3 | `leg_L`                                                                   | slot phụ `leg_L`             | **cả chân** đùi→gối→cẳng→giày; phần đỉnh đùi vẽ kéo vào xương chậu ≥ 18 px @2x        |
|   4 | `robe_back`                                                               | outfit_lower                 | váy sau, từ eo đến gấu, vẽ đầy đủ cả sau chân                                         |
|   5 | `torso`                                                                   | body                         | cổ + ngực + chậu, **không có chi**, kéo dài dưới áo và dưới váy                       |
|   6 | `arm_L`                                                                   | arm_L                        | **cả tay** vai→tay áo→cổ tay, gồm cổ tay áo; đỉnh cánh tay vẽ kéo vào vai ≥ 14 px @1x |
|   7 | `leg_R`                                                                   | slot phụ `leg_R`             | như `leg_L`                                                                           |
|   8 | `robe_front`                                                              | outfit_lower                 | váy trước                                                                             |
|   9 | `vest`                                                                    | outfit_upper                 | áo khoác ngoài, cổ áo, viền; vùng lỗ tay áo vẽ đầy đủ                                 |
|  10 | `sash`, `sash_tail_L`, `sash_tail_R`                                      | slot phụ                     | đai + nút; 2 đuôi (chain `sash_L_1/2`, `sash_R_1/2`)                                  |
|  11 | `arm_R`                                                                   | arm_R                        | như `arm_L`                                                                           |
|  12 | `hand_R_{grip,relaxed,fist,palm,seal}`, `hand_L_{relaxed,fist,palm,seal}` | slot phụ trên xương `hand_*` | tay đổi theo hành động; chồng 8 px @2x vào cổ tay áo                                  |
|  13 | `head`, `eyes_{open,half,closed}`, `brows`, `mouth_{neutral,open,smile}`  | head + slot phụ              | mặt gốc không có mắt/miệng; mỗi biểu cảm là một PNG đã đăng ký lên đầu                |
|  14 | `hair_front_1..N`, `ponytail`, `hairpin`                                  | hair_front + slot phụ        | 3-5 lọn (chain `hair_front_1/2`), đuôi tóc (chain `hair_back_1/2`)                    |
|  15 | `scabbard`, `weapon_R`, `sword_glint`                                     | slot phụ, weapon_R           | vỏ kiếm rỗng, kiếm rút, lớp sáng cộng                                                 |

Tùy chọn sau: mặt dây ngọc (chain), lót tay áo, váy lớp trong, lớp bóng.

**Pilot E** gồm 1-12 (chỉ `hand_R_grip`, `hand_R_relaxed`, `hand_L_relaxed`), `head` + `eyes_open` + `mouth_neutral`, các lọn tóc, vỏ kiếm, kiếm.

### 4. Quy tắc vẽ ảnh hưởng đến rig

1. Chi **thẳng, bề rộng gần như không đổi dọc chiều dài**; không vẽ sẵn nếp gập hay tay áo gập (gập mesh sẽ nhân đôi nếp).
2. Khuỷu / gối chỉ là hình tròn hoặc thẳng, không có đệm gối hay cổ tay áo vắt ngang đường khớp (đặt trên mảnh tay, cẳng, cổ chân).
3. Không có bóng đổ giữa các mảnh (bóng nằm ở lớp riêng).
4. Bảng màu và ánh sáng (NW) giống master; chuyển màu theo vật liệu về master để không lệch phong cách giữa các mảnh.
5. Chỉ viền ngoài silhouette có anti-alias 1-2 px; các cạnh chồng nội bộ có thể cắt thẳng vì phần chồng đã vẽ đầy đủ.

### 5. Cách rig dựng (để art khớp)

- `buildLimbMesh(rig, {name, slotBone, chain, view, image})`: một mesh dải dọc theo chuỗi xương (`[upper_arm_R, lower_arm_R, hand_R]` hoặc `[thigh_*, shin_*, foot_*]`); mặt cắt lấy theo alpha; **mỗi đỉnh tối đa 2 xương**, trọng số chuyển mượt (smoothstep) quanh khuỷu/gối/cổ tay/cổ chân, bán kính chuyển mặc định 8 px @1x và tự co để hai khoảng chuyển không chồng nhau; ~40-70 đỉnh mỗi chi.
- `buildSkirtMesh`: lưới đều trên vùng vẽ; xương hông ở eo, chuyển dần sang hai đùi (chia theo khoảng cách đến từng xương đùi) tới gối; không có đảo, không có mối nối.
- Tay/mặt/lọn tóc: cứng hoặc theo chain. Ngân sách: ≤ 600 đỉnh mỗi hướng (`RIG_LIMITS.player`), một trang atlas ≤ 2048 (padding 2, extrude 1, PMA), ≤ 2 draw call mỗi nhân vật.
- Cổng nghiệm thu: `rig:measure --strict` (0 khe hở, 0 rách, 0 giãn) và chụp trong engine `npm run capture -w client-cocos` cho đủ 15 clip.

### 6. Việc kế tiếp (rig side)

Dựng xương từ `landmarks.json`, ghép mảnh → rig hướng E, xuất bằng `npm run rig:assemble -w @vgtd/rig -- --parts <thư mục> --out <thư mục>` (mặc định ra thư mục tạm; để xem trong viewer dùng `--out apps/client-cocos/assets/resources/dragonbones/kiem-tu-continuous`, không commit thư mục đó trước khi pilot được nghiệm thu; giữ nhân vật cũ để so sánh), thêm blink / đổi tay / đổi miệng vào clip (display index theo khung), sau đó lan sang S/SE/NE/N.

### 6b. Dáng đi cho váy dài (`GAIT_PROFILES`)

Với váy dài, bước rộng + gập gối sâu trông như tư thế cưỡi ngựa. `rig:assemble --gait robe` (mặc định) dựng run/walk/dash với **hai cặp bước trong cùng một clip** (`cycles: 2`): clip giữ **thời lượng của bảng animation** (run 0,5 s) và **tốc độ mặt đất thật** (`motion.speed` = tốc độ di chuyển, `timeScale` luôn 1), nhưng mỗi bước chỉ dài một nửa; gối nông, nâng chân thấp, nghiêng người. Nhịp bước gấp đôi được **ghi sẵn trong clip**, không phụ thuộc runtime. `--gait free` giữ dáng gốc. Chủ dự án cần xác nhận nhịp bước nhanh hơn: `docs/OPEN-ITEMS.md` §10. Hướng chính để sửa dáng đi là bước key pose tham chiếu (`docs/art/rig-keypose.md`).

### 7. Lớp chi tiết hoạt cảnh (`tools/rig/src/detail.ts`)

Dữ liệu điều khiển clip, áp dụng cho mọi rig có đủ slot (thiếu slot hoặc display thì bỏ qua, không lỗi).

| slot          | display (tên attachment)                                                     | dùng khi                                                                                               |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `eyes`        | `eyes_open`, `eyes_half`, `eyes_closed`                                      | chớp mắt mỗi 3-5 s (idle, walk, channel, emote); `meditate` nhắm suốt                                  |
| `mouth`       | `mouth_neutral`, `mouth_open`, `mouth_smile`                                 | quát quanh frame trúng đòn (attack 1-3), niệm (cast), đau (hit), cười (emote)                          |
| `hand_R`      | `hand_R_grip`, `hand_R_relaxed`, `hand_R_fist`, `hand_R_palm`, `hand_R_seal` | tay cầm kiếm luôn `grip` (thả lỏng khi die/meditate)                                                   |
| `hand_L`      | `hand_L_relaxed`, `hand_L_fist`, `hand_L_palm`, `hand_L_seal`                | nắm tay khi đánh/bị đánh, kiếm quyết (`seal`) khi cast/channel/sword_fly, `palm` khi emote/tribulation |
| `sword_trail` | `sword_trail` (blend additive)                                               | vệt kiếm từ `windup_end` đến `hit_frame` + 5, alpha 0 → 1 → 0                                          |
| `sword_glint` | `sword_glint` (blend additive)                                               | chớp sáng ±2 frame quanh `hit_frame` (và cast)                                                         |

**Chớp mắt độc lập:** các clip thân (idle 1 s, walk 0,67 s...) quá ngắn để chứa nhịp chớp 3-5 s, nên chớp mắt là một clip riêng `blink_cycle` (`authorBlinkCycle`): lặp 10 s, không có bone, chỉ key slot `eyes` (open → half → closed → half → open; **mọi** khoảng cách giữa hai lần chớp, kể cả qua điểm nối vòng, nằm trong 3-5 s). **Clip thân không bao giờ key chớp mắt**: slot `eyes` thuộc về `blink_cycle`. Ngoại lệ duy nhất là giữ mắt cố định của `meditate` (mắt nhắm, key `eyes_closed`); khi phát `meditate`, `die`, `hit` client **phải dừng layer blink** (DragonBonesActor đã làm). Runtime phát `blink_cycle` trên **một layer animation riêng** cạnh clip thân (`fadeIn` layer 1, loop). Vòng lặp 151-179 frame không có chớp (hai lần chớp sẽ cách nhau < 3 s, một lần thì khoảng cách > 5 s); `blink_cycle` dùng 300 frame. Xuất cùng bộ clip (16 animation cho E). Cổng nghiệm thu chỉ chứng minh clip có trong export và key đúng; nhịp chớp thực xem bằng `npm run capture -w client-cocos -- --blink ...`.

Chain thứ cấp (`addDetailChains`, bake lò xo ở 30 fps như tóc/đai hiện có): 13 mẫu `hair_strand_a/b/c`, `ponytail`, `ribbon_tail_L/R`, `sash_tail_L/R`, `pendant`, `sleeve_edge_L/R`, `robe_hem_front/back`, vị trí đặt (`at`) chỉnh theo rig thật bằng `overrides`. **Ngân sách (không đổi `RIG_LIMITS`):** docs/03 cho phép ≤ 6 chain thứ cấp và ≤ 60 bone mỗi rig người chơi. Vì lò xo được bake thành key nên một chain có thể là một nhóm nhiều dải xương cùng thông số; 13 mẫu được gộp thành **5 chain** (`DETAIL_GROUPS`: `hair_group` = đuôi tóc + 3 lọn, `sash_group` = 2 đuôi đai + mặt dây, `ribbon_group`, `sleeve_group`, `hem_group`), tổng 30 bone, còn 1 chain trống. Trên thân Kiếm tu đã bỏ 10 bone chain cũ (28 bone) tổng cộng 58 bone (≤ 60). `addDetailChains` không bao giờ vượt giới hạn: mẫu nào không vừa bị bỏ qua và nằm trong `skipped` (`strict` thì báo lỗi). Mỗi mẫu cần một mảnh art riêng đã tách và xương cha: `head`, `hips`, `lower_arm_L/R`.

Cổng nghiệm thu một lệnh: `npm run rig:gate -w @vgtd/rig -- <character> --dir E [--src dragonbones/<id> --stem <stem>]` chạy `rig:measure --strict` rồi chụp trong engine đủ clip (kết quả chụp ở thư mục `--out`, đính vào PR).

## D. Key pose tham chiếu AI (D40; từ rig-keypose.md)

> **[Thay thế một phần bởi D41, 2026-11-06]** Với **thân nhân vật Player**, quyết định D41 (sprite sheet AI từng khung, xem [sprite-sheet-pipeline.md](sprite-sheet-pipeline.md)) thay cách làm bằng rig xương trong tài liệu này; tài liệu giữ lại làm tham chiếu cho boss/NPC và mã `@vgtd/rig` (không phát triển thêm cho thân Player).

Quyết định **D40** của chủ dự án (xem `docs/DECISIONS.md`; bổ sung cho D39): giữ rig xương, **thêm bước key pose tham chiếu** để sửa dáng đi/chạy (phần thân dưới trước đó trông "què").

### Quy trình

1. **Key pose (worker art):** ảnh toàn thân cùng phong cách/tỉ lệ với master, nền trong, cùng khung 256×256 @2x, gốc `(128, 232)`. Tên file: `assets-src/placeholder/kiem-tu-continuous-v1/keyposes/<hướng>/<clip>_<NN>_<nhãn>.png` + `.landmarks.json` cùng tên.
   - `run`, `walk`: 8 key `R_contact, R_down, R_passing, R_up, L_contact, L_down, L_passing, L_up`; `dash` 3 (`start, reach, end`); `attack`, `attack_2`, `attack_3`: 3 (`anticipation, strike, follow`); `cast` 3 (`gather, release, hold`); `idle` 2 (`in, out`).
   - Landmark (px @2x, x phải, y xuống, gốc góc trên trái): `root, head, neck, chest, pelvis, shoulder_L/R, elbow_L/R, wrist_L/R, hand_L/R, hip_L/R, knee_L/R, ankle_L/R, foot_tip_L/R, sword_tip, hem_left, hem_centre, hem_right, skirt_front_split, skirt_back_split` và `_inferred: [tên khớp bị che]` (khớp suy đoán không tính vào sai số). L = bên xa, R = bên gần (hướng E).
2. **Khớp pose (`@vgtd/rig`, `keypose.ts`):** `fitPose(rig, landmarks, view)` giải góc xoay xương (nhắm theo đoạn landmark), dịch hông (pelvis), đích IK chân (mắt cá), góc hai tà váy (`robe_front` ↔ `hem_right`, `robe_back` ↔ `hem_left`, ≤ 38°) và báo sai số từng landmark + xương lệch độ dài > 5 %.
3. **Dựng clip:** `authorKeyPoseClip` đặt key theo thời lượng/phase của bảng animation (run 8 key trên 15 frame, key R_contact trùng `footstep_R` của bảng; attack: anticipation ở `windup_end`, strike ở `hit_frame`, follow ở `combo_window`; clip một lần nội suy từ/ về tư thế nghỉ). Nội suy ease in-out; **chân đang chạm đất nội suy tuyến tính** (tốc độ mặt đất không đổi, không trượt chân); `motion.speed` suy ra từ chân đạp đất. Sau đó bake lò xo, lớp chi tiết (chớp mắt, đổi tay/miệng, vệt kiếm) như clip viết tay.
4. **Nghiệm thu:** IoU silhouette từng key so với ảnh tham chiếu ≥ 0,85 (bỏ vệt kiếm/bóng), cộng các kiểm tra thân dưới (đùi lộ ngoài váy, độ rộng bước, diện tích váy), strip QA và `rig:gate`.

### Lệnh

```bash
npm run rig:assemble -w @vgtd/rig -- --parts <thư mục có E/> --keyposes <thư mục có E/> [--iou 0.85] --out <thư mục>
```

In sai số khớp + IoU từng key, và ghi `keypose_<clip>_compare.png` (hàng: tham chiếu / rig cũ / rig theo key pose; mỗi cột một key). IoU dưới ngưỡng thì không xuất (trừ `--allow-errors`).

### Ghi chú khớp pose v2 (2026-11-06) và ngưỡng nghiệm thu

- **Giải theo thứ tự cây xương:** hông/pelvis (hạ hông nếu chân không với tới mắt cá) → cột sống/cổ/đầu (nhắm theo **hướng** landmark, đầu luôn thẳng) → tay (IK 2 xương giải tích đặt cổ tay **đúng** landmark, khuỷu giữ phía gập của tư thế nghỉ nên các key liên tiếp không lật khuỷu) → chân (IK đích = mắt cá) → bàn chân/kiếm → hai tà váy sau chân.
- **`hem_left` / `hem_right` là mép ngoài của váy**, không phải trục xương tà váy: tà váy xoay theo **thay đổi hướng** của mép từ pivot so với mép lúc nghỉ đo trên mesh, không theo hướng tuyệt đối.
- **Đích IK chân/tay đặt đúng mắt cá/cổ tay của landmark** (`applyLandmarks`); trước đây đích IK còn ở vị trí rig cũ nên mọi delta chân đều lệch.
- **Khóa chân chạm đất:** khi một chân chạm đất qua các key liên tiếp, đích chân phải lùi với tốc độ mặt đất không đổi; các key được dịch ngang như vật rắn (hông + hai chân) cho đến khi chân chạm đất nằm trên đường đó. Khoảng cách key đều nhau (không làm tròn frame) để không giật ở điểm nối vòng.
- **Cổng mỗi key:** RMS sai số landmark nhìn thấy ≤ 2 px rig **và** IoU silhouette (ngưỡng IoU do chủ dự án chọn: `docs/OPEN-ITEMS.md` §10 mục 2; mã giữ 0,85). IoU còn bị giới hạn bởi khác biệt hình dạng giữa ảnh AI và art của rig (tóc dài bay, váy xòe, tay áo) và bởi lệch đăng ký của ảnh tham chiếu. Đối chứng idle (pose gần tĩnh) đạt IoU 0,93-0,94 với sai số pose ≈ 0 sau khi sửa công cụ khớp (trước đó 0,85-0,87 là do lỗi công cụ, không phải trần của phong cách), nên ngưỡng cho key chuyển động cần được chọn dựa trên số liệu run thật. `rig:assemble --keyposes` in thêm IoU theo ba dải (đầu+tay / thân / váy+chân), tịnh tiến tốt nhất của ảnh tham chiếu và ảnh chồng (xám: cả hai; đỏ: chỉ tham chiếu; xanh: chỉ rig) để tách sai lệch đăng ký khỏi sai lệch hình dạng.

## E. Memo chọn phương án rig (trước D39; từ rig-approach-memo.md)

Ngày 2026-11-06. Người viết: worker 15 (`@vgtd/rig`). Người quyết: chủ dự án. **Không đổi dữ liệu rig trên main.** Số liệu "đo" lấy từ `npm run rig:measure` (chỉ số seam đã sửa ở PR #89: một khe chỉ tính khi đỉnh của mảnh phía trước không được mảnh nào khác che). Số "ước" được ghi rõ.

### 1. Vấn đề

Kiếm tu hiện tại: mỗi mảnh là một hình chữ nhật **cắt từ một ảnh đã hoàn chỉnh**, nên vùng bị che (dưới áo, sau cánh tay) **không có pixel**. Khi khớp gập, mối nối hở. Skinning chỉ kéo giãn pixel có sẵn, không tạo pixel mới.

| bộ dữ liệu (Kiếm tu, 15 clip × 5 hướng)        | seam hở (rigid)    | clip bị rách         | ghi chú                                                      |
| ---------------------------------------------- | ------------------ | -------------------- | ------------------------------------------------------------ |
| main                                           | 90 (tối đa 8,6 px) | 25                   | đo                                                           |
| #88 `081060b`, rigid                           | 215 (17,9 px)      | 32                   | đo; mảnh phình ra nhưng thiếu màu dưới mảnh kề               |
| #88 `081060b` + autoSkin band 16               | 88 (7,0 px)        | 10                   | đo                                                           |
| #88 `254b66c` + autoSkin (số của orchestrator) | 1190 cảnh báo      | 10, xấu nhất 37,5 px | 211 sự kiện giãn, tối đa 695 %: autoSkin đổi khe lấy độ giãn |

Khe hở và độ giãn là **hai mặt của cùng một thiếu hụt**: thiếu pixel ẩn. Thêm đỉnh hay chỉnh trọng số chỉ đổi chỗ xuất hiện lỗi.

### 2. Các phương án

#### A. Giữ "cắt từ một ảnh" + thêm topology mesh (contour mesh, nhiều đỉnh, chỉnh trọng số từng khớp)

- **Chất lượng:** trần thấp. Mỗi khớp cần tối thiểu `ceil(w·sin(θ/2))` px màu ẩn (đầu gối 17, hông 14, vai 14, khuỷu 11 @1x, xem `parts-spec.md`); ảnh nguồn không có. Contour mesh chỉ bám viền tốt hơn. Dự đoán: mức #88 + autoSkin (88 mở, 10 rách) gần với tốt nhất đạt được, độ giãn còn hàng trăm %.
- **Công sức:** mỗi lần thử rẻ, nhưng đã lặp nhiều vòng không hội tụ; mỗi lớp mới lại chỉnh tay (ước 2-4 ngày/lớp, không đảm bảo kết quả).
- **Hiệu năng/RAM:** hiện 124-132 đỉnh/hướng, atlas 512×512 mỗi hướng (~60 KB PNG). Contour mesh ước ×3-5 → 400-700 đỉnh/hướng; 30 skeleton × 700 ≈ 21k đỉnh skinning/frame, vẫn nhẹ so với ngân sách docs/06 (≤ 80 draw call, 30 skeleton). Không phải điểm nghẽn.
- **Dùng lại cho 4 lớp:** thấp, chỉnh tay nhân 4.

#### B. Vẽ lại từng bộ phận thành mảnh đầy đủ ("vẽ để rig") theo `parts-spec.md`

- **Chất lượng:** cao nhất, giải đúng nguyên nhân: mỗi chi có đủ phần ẩn và nắp khớp, mảnh phía sau kéo dài dưới mảnh phía trước đúng `margin` trong bảng. Đủ margin thì khe hở bằng 0 theo công thức (có test: margin không vượt bề rộng mối nối). Ước: seam hở gần 0, không có sự kiện giãn (như skinning cứng hiện tại: 0).
- **Công sức:** lớn lúc đầu: mỗi hướng ≈ 13-15 mảnh (body chia đảo, 2 tay, outfit trên/dưới, head, hair, weapon) × 5 hướng × 4 lớp ≈ 300 mảnh. Ước 3-5 ngày cho lớp đầu, 1-2 ngày mỗi lớp sau (template và `parts-spec.md` đã sinh sẵn). Rủi ro chính: đồng nhất phong cách giữa các mảnh sinh bằng Codex (mục 4).
- **Hiệu năng/RAM:** mảnh đầy đủ lớn hơn ~30-50 % diện tích (phần ẩn): ước atlas 512×512 vẫn đủ hoặc 512×1024 mỗi hướng; ASTC 4×4 ≈ 0,26-0,5 MB/hướng, ≈ 1,3-2,5 MB/lớp. Số đỉnh không đổi (~130). Nằm trong ngân sách docs/06 (ô 512×512 @1x trong trang động 2048 chứa 16 nhân vật).
- **Dùng lại:** cao: mảnh là dữ liệu theo bộ trang phục, animation là dữ liệu chung (đúng mô hình paperdoll docs/03).

#### C. Lai: xương cho thân/chi + đổi sprite theo khung cho biến dạng khó (tay áo, vạt áo)

- **Chất lượng:** tốt cho phần mềm: đổi giữa 3-5 biến thể vẽ sẵn thay vì uốn mesh. Vẫn cần B cho thân/chi, nên C là **bổ sung** cho B.
- **Công sức:** +30-60 % so với B cho các slot áo/vạt (mỗi slot 3-5 biến thể × 5 hướng), thêm authoring "chọn biến thể theo góc khớp" (DragonBones có `displayIndex` theo khung; exporter cần hỗ trợ, ước 1-2 ngày).
- **Hiệu năng/RAM:** atlas ×1,3-1,6 so với B (ước 2-4 MB/lớp ASTC); không thêm draw call nếu cùng trang atlas.
- **Dùng lại:** trung bình, biến thể phụ thuộc kiểu trang phục.

#### D. Sprite sheet từng khung, dựng từ rig/3D, cho người chơi

- **Chất lượng:** ổn định (mỗi khung là ảnh hoàn chỉnh, không có khe), nhưng mất tách lớp paperdoll và đổi trang phục động.
- **Hiệu năng/RAM (ước theo docs/03: ô 128×128, atlas 2048 = 256 ô, mỗi lớp ~6 atlas/giới tính):** 15 clip × ~12 khung × 5 hướng (3 hướng lật) ≈ 900 ô/bộ trang phục ≈ 3,5-6 atlas 2048 ≈ 14-24 MB ASTC 4×4 (4 MB/atlas), 56-96 MB không nén, **cho mỗi lớp mỗi bộ trang phục**. Với 7 lớp × 40 bộ (docs/03) vượt ngân sách tải và RAM; đúng lý do docs/03 chọn skeleton.
- **Công sức:** cao, không dùng lại giữa trang phục.
- **Dùng hạn chế:** quái/NPC đông, icon, ảnh xem trước; không dùng cho người chơi.

### 3. Bảng so sánh

|                            | A mesh thêm                   | B vẽ lại mảnh đầy đủ        | C lai (B + đổi sprite)       | D sprite sheet             |
| -------------------------- | ----------------------------- | --------------------------- | ---------------------------- | -------------------------- |
| seam / độ giãn (Kiếm tu)   | tốt nhất: 88 mở, 10 rách (đo) | gần 0 (ước, theo công thức) | gần 0, tay áo mượt hơn (ước) | 0                          |
| công sức lớp đầu / lớp sau | 2-4 ngày, không đảm bảo       | 3-5 / 1-2 ngày              | +1-2 ngày trên B             | rất cao, không dùng lại    |
| RAM / lớp (ASTC)           | ~1 MB                         | 1,3-2,5 MB                  | 2-4 MB                       | 14-24 MB mỗi bộ trang phục |
| đổi trang phục             | có                            | có                          | có                           | không (mỗi bộ một sheet)   |
| rủi ro chính               | không hội tụ                  | đồng nhất phong cách mảnh   | thêm logic biến thể          | RAM / tải                  |

### 4. Khuyến nghị: **B**, thêm **C** cho tay áo/vạt khi B xong

Số đo cho thấy A đã chạm trần (đổi khe lấy độ giãn); D phá ngân sách docs/06 và paperdoll; B giải đúng nguyên nhân. Rủi ro lớn nhất của B là sinh ảnh theo mảnh bằng Codex: (1) đồng nhất màu/ánh sáng/viền giữa các mảnh, (2) vẽ đúng phần ẩn mà không đổi hình dáng. Giảm rủi ro:

1. Quy trình "vẽ cho rig": sinh **toàn bộ nhân vật ở một tư thế** làm tham chiếu, rồi mỗi mảnh sinh từ ảnh tham chiếu + mặt nạ vùng + yêu cầu kéo dài `margin` px dưới mảnh kề (số trong `parts-spec.md`).
2. Cổng kiểm tự động trước khi nhận mảnh: `rig:measure --strict` (khe hở ≤ 3 px, 0 rách, 0 giãn) và kiểm slot/margin của `parts.ts`.
3. Thử trước **một cặp chi** (tay phải + tay trái, hướng E) rồi đo; nếu không về ≤ 3 px với skinning cứng thì dừng và dùng C/D cho phần đó.

**Chưa làm bằng chứng nhỏ:** cần sinh ảnh bằng Codex (ngoài phạm vi worker này) và theo `vgtd-asset-pipeline` phải kiểm nguồn/giấy phép ảnh sinh trước. Có thể chạy ngay khi chủ dự án đồng ý, dùng `parts-spec.md` làm đặc tả và `rig:measure` làm bài đo; ước nửa ngày.

### 5. Quyết định cần chủ dự án

1. Chọn B (khuyến nghị), hoặc A, hoặc C/D cho phần nào.
2. Cho phép chạy thử B cho một cặp chi (Codex) và xác nhận nguồn/giấy phép ảnh sinh.
3. Giữ #88 (art tăng dần) và PR #89 (chỉ số + margin) làm nền; `seamSeverity` chỉ đổi sang `error` khi `rig:measure --strict` sạch.
