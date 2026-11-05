# Đặc tả dữ liệu rig Kiếm tu — Cloud Disciple v1

Ngày: 2026-11-06. **AI placeholder; chưa phát hành.** D35 chọn DragonBones, D36 quy định AI tạo cả art/rig/animation và người chỉ duyệt trong viewer. D37 chọn concept A + kiếm rút tay phải như B cho idle/combat/locomotion; chỉ idle phi chiến đấu/trong thành mới đeo kiếm. Lô này chưa có biến thể trong thành; C chỉ giữ làm tham chiếu trưởng lão.

## 1. Phạm vi và sở hữu

- Worker art sở hữu nguồn art, cutout, atlas và **dữ liệu** trong `tools/rig/data/`.
- `@vgtd/rig` (worker `van-gioi-tien-do-15`) sở hữu schema chuẩn, validator, exporter DragonBones 5.5/5.6 và bộ công cụ animation. **PR art không chứa exporter DragonBones hay Spine.**
- Viewer (worker `van-gioi-tien-do-7`) dùng đầu ra exporter để nạp `dragonBones.ArmatureDisplay`. Dữ liệu rig trung lập không phải JSON runtime để nạp thẳng vào Cocos.
- Không phụ thuộc animator hoặc GUI editor. GUI có thể dùng để kiểm tùy chọn theo D36, không phải bước sản xuất bắt buộc.

## 2. Cây file

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

## 3. Hệ tọa độ và schema

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

## 4. Bone và IK

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

## 5. Paperdoll, mesh và fallback

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

## 6. Atlas

Page hiện 512×512 POT mỗi hướng; packer hiện có dùng **2 px clear padding + 1 px extrusion**, tắt xoay. `AtlasData` có `imagePath,width,height,premultipliedAlpha:true,regions[]`. Region names khớp attachment paths: full-page, từng mảnh và canonical fallback.

PNG giao đã premultiply RGB; không nhân alpha lần hai. Nguồn cutout vẫn straight alpha. Hệ số @2x thuộc texture; region attachment width/height và vertex geometry đã là logical @1x. Exporter phải xử lý tỷ lệ ảnh/geometry đúng, không giả định chúng cùng đơn vị. Không có KTX2/ASTC/WebP hoặc cấu hình bundle trong PR art.

## 7. Idle và bộ công cụ animation

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

## 8. Tái tạo, kiểm chứng và giới hạn

```sh
npm ci
npm run gen:kiemtu -w @vgtd/procgen -- build
npm run gen:kiemtu -w @vgtd/procgen -- validate
npm run gen:kiemtu -w @vgtd/procgen -- review <session-artifact-dir>
```

Đầu vào là năm PNG chuẩn hóa đã commit; tùy chọn `import <sheet.png>` ghi đè từ sheet AI. Mã procgen tách/vẽ bù và tạo **data** theo schema phối hợp; không gọi AI lại, không sinh format runtime. Packer chỉ ghi trung gian vào ignored build; bộ source/data có chủ đích mới vào Git.

Gate kiểm canvas/inventory, slot order API, role/parent/IK/chain references, UV/triangles/weights, rig limits, loop/key grid, regions và PMA channels. Tests kiểm round-trip tọa độ, target tay đi cùng FK, chân cố định, fallback region và vẽ bù không che pixel nguồn tại rest. FK preview/contact sheet là công cụ review độc lập, **không phải capture DragonBones/Cocos hoặc chứng minh exporter chạy**. Runtime export/load và QA hình ảnh trong engine thuộc bước phối hợp tiếp theo.

Mọi asset/prompt/UTC/công cụ/mô hình không công bố nằm trong [ASSET-LICENSES.md](../ASSET-LICENSES.md). Art AI và dữ liệu dẫn xuất vẫn placeholder, bắt buộc rà soát giấy phép/nguồn gốc trước phát hành. Không thêm phụ thuộc animator/editor hoặc triển khai server/netcode.
