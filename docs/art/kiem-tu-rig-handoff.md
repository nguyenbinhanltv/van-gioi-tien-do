# Bàn giao rig Kiếm tu — Cloud Disciple v1

Ngày: 2026-11-06. **AI placeholder; chưa dùng cho phát hành.** Chủ art tạm thời: người dùng. Theo D35, chọn concept A (đệ tử Vân Môn thanh nhã) và cách cầm kiếm của B: idle/combat/locomotion dùng kiếm rút tay phải; chỉ idle phi chiến đấu/trong thành mới đeo kiếm. Lô này chỉ có tư thế trung tính và idle thử, **chưa có biến thể trong thành**. C giữ làm tham chiếu trưởng lão, không triển khai.

## 1. File và quy ước

- Nguồn: `assets-src/placeholder/kiem-tu-rig-v1/`. `turnaround/<dir>.png` là canvas 256×256 @2x, hình cao 208 px, pivot `(128,232)`; ánh sáng NW, bóng không nướng vào nhân vật.
- `parts/<dir>/<slot>.png`: đủ 15 nhóm logic của `@vgtd/character`. `pieces/<dir>/<piece>.png`: 33 mảnh riêng/canvas 256×256, kèm `layout.json` ghi nhóm, bone và bounding box. Mảnh bị che hoàn toàn có thể trống ở hướng nhìn lưng.
- `spine/<dir>/kiemtu.json` + `kiemtu.png`: bộ **straight alpha** để import Editor. JSON và PNG cùng thư mục, mesh path `kiemtu`; không cần tự unpack atlas.
- Client: `apps/client-cocos/assets/bundles/class-kiem-tu/_placeholder/rig-v1/<dir>/kiemtu.json`, `kiemtu.atlas`, `kiemtu.png`; ảnh này **đã premultiply RGB**, `.atlas` ghi `pma: true`. Không premultiply lần hai. `turnaround.png` và `setup-preview.png` là ảnh kiểm tra 128×128, không phải dữ liệu animation.
- `manifest.json` là hợp đồng bàn giao cho worker viewer; chưa tạo cấu hình bundle Cocos. Tất cả đường dẫn trong từng record hướng là tương đối với thư mục chứa manifest.

Chọn **một skeleton cho mỗi hướng vẽ S, SE, E, NE, N**, skin `default`. SW/W/NW lần lượt dùng SE/E/NE + mirror D14. Root là `(0,0)` tại pivot chân, tọa độ bone/vertex dùng **@1x, y lên**; chỉ texture là @2x. Không scale skeleton thành 0,5 lần nữa. Không đổi gốc toán iso của shared; client chỉ chuyển ở ranh giới render.

## 2. Nhóm slot và mảnh

Thứ tự 13 slot Spine lấy trực tiếp từ `getCharacterViewState(...).slotOrder`; không chép lại bảng số. Hai nhóm orbit là sprite node ngoài skeleton, không thêm thành Spine slot. Manifest có draw order cho **cả tám hướng thật**: không dùng nguyên thứ tự E cho W.

| Nhóm logic                   | Mảnh riêng                                                   | Gắn bone / lưu ý                                                                                         |
| ---------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `orbit_back`, `orbit_front`  | PNG trống dành chỗ                                           | Sprite node ngoài rig, chưa có pháp khí quỹ đạo                                                          |
| `wing`, `cape`, `sword_back` | PNG trống dành chỗ                                           | Không có cánh/phi phong/kiếm đeo lưng trong mẫu này                                                      |
| `body`                       | `torso_base`, `neck`, `thigh_R/L`, `shin_R/L`, `foot_R/L`    | Phần thân/chân bị áo che được vẽ bù đơn giản, không phải anatomy hoàn thiện                              |
| `outfit_lower`               | `robe_front`, `robe_back`, `scabbard`                        | Bone vạt trước/sau, bao kiếm rỗng gắn hip; không đặt bao vào `sword_back` vì API ẩn nhóm đó khi cầm kiếm |
| `outfit_upper`               | `coat`, `sash_L_1/2`, `sash_R_1/2`                           | Coat theo chest; hai đầu đai có hai chain riêng                                                          |
| `head`                       | `face`                                                       | Head; vùng bị tóc che có lớp nền vẽ bù                                                                   |
| `hair_back`                  | `hair_back_1/2`, `hair_ribbon_1/2`                           | Chain tóc sau và chain dải buộc tóc                                                                      |
| `hair_front`                 | `hair_front_1/2`                                             | Mảng tóc trước/strand, không gồm mặt                                                                     |
| `headwear`                   | `hairpin`                                                    | Trâm ngọc theo head                                                                                      |
| `arm_R`, `arm_L`             | `upper_sleeve_*`, `lower_sleeve_*`, `sleeve_tip_*`, `hand_*` | Upper/lower arm, sleeve tip và hand tương ứng                                                            |
| `weapon_R`                   | `sword`                                                      | Bone `weapon` là con `hand_R`; kiểm lại điểm cầm trước khi animate lớn                                   |

Mỗi mảnh là một quad có trọng số vào bone tương ứng. Nhiều quad tách rời được ghép thành **một mesh theo slot logic**; vì vậy vẫn đúng 13 slot, không cần helper slot khiến adapter bỏ sót draw order. Chúng dùng UV các mảnh đã pack trên cùng một page; region `kiemtu` trong atlas bao phủ cả page. Đây là mesh cứng khởi đầu, **không phải mesh deform/weights tinh chỉnh thủ công**.

`weapon_R_mirrored` hiện là alias của attachment idle, có tên để adapter không chọn nhầm attachment thiếu. Không coi alias là bản art bất đối xứng đã vẽ lại. Chủ art/animator phải kiểm tay cầm, ánh sáng và silhouette ở SW/W/NW; attack/cast/channel đủ tám hướng là công việc sau khi được duyệt, không lấy idle này thay thế.

## 3. Hierarchy — 34 bones

```text
root
└─ hip
   ├─ torso → chest → neck → head
   │          ├─ upper_arm_R → lower_arm_R → hand_R → weapon
   │          │                └─ sleeve_tip_R
   │          └─ upper_arm_L → lower_arm_L → hand_L
   │                           └─ sleeve_tip_L
   ├─ thigh_R → shin_R → foot_R
   ├─ thigh_L → shin_L → foot_L
   ├─ sash_L_1 → sash_L_2
   ├─ sash_R_1 → sash_R_2
   ├─ robe_front
   ├─ robe_back
   └─ scabbard
head
├─ hair_back_1 → hair_back_2
├─ hair_front_1 → hair_front_2
└─ ribbon_1 → ribbon_2
```

Các nhánh dưới dòng `head` đều là con của head đã có trong cây, không phải root thứ hai. Chưa có IK, physics constraint hay deform timeline. Chân/thigh/shin gắn hip; idle dịch chest, không dịch root/hip/feet.

## 4. Import vào Spine 4.2 Professional

1. Người có giấy phép phù hợp mở Editor **4.2**. Giấy phép Professional và điều khoản Spine Runtimes vẫn cần con người xác minh; D33 không xác nhận đã mua license. Agent không điều khiển Editor.
2. Dùng **Import Data**, chọn `assets-src/placeholder/kiem-tu-rig-v1/spine/S/kiemtu.json`, tạo skeleton riêng (ví dụ `kiemtu_S`); lặp lại với bốn hướng còn lại. Quy trình theo [hướng dẫn Import của Esoteric Software](https://esotericsoftware.com/spine-import).
3. Nếu thiếu ảnh, đặt đường dẫn Images vào đúng thư mục có `kiemtu.png` **straight alpha** đi cùng JSON. Không chọn texture PMA trong bundle client. Dữ liệu hình dùng trang atlas sẵn, không phải từng PNG độc lập cho mỗi mesh.
4. Kiểm scale @1x, pivot chân, default skin, 13 slot, thứ tự vẽ và animation `idle`. Tag `spine: 4.2.00` là **mục tiêu format sinh bằng mã**, không phải tuyên bố đã export từ Editor. File gốc `.spine` chỉ được tạo khi người rig import và lưu dự án.
5. Kiểm/chỉnh mask quanh cổ, vai, khuỷu, cổ tay, tóc, đai; các vùng vẽ bù là màu vật liệu đơn giản được sinh bằng mã. Mở khớp ở nhiều góc, vẽ tiếp vùng bị che, bỏ pixel thừa, chia thêm mesh/weights nếu cần. Duyệt lại điểm cầm kiếm, chiều bao kiếm rỗng và thứ tự tay/kiếm.
6. Lưu `.spine` bằng Editor, sau đó xuất lại JSON/atlas đúng 4.2; kiểm lại bằng runtime của viewer. Quy ước export JSON/mesh tham khảo [JSON format](https://esotericsoftware.com/spine-json-format) và [reader nhánh 4.2](https://github.com/EsotericSoftware/spine-runtimes/blob/4.2/spine-ts/spine-core/src/SkeletonJson.ts); PMA và tên region theo [atlas format](https://esotericsoftware.com/spine-atlas-format).

**Chưa xác nhận import Editor hoặc render Cocos thành công trong lô này.** Gate cấu trúc/UV, FK preview và kiểm tra atlas không thay thế smoke test runtime. Worker `van-gioi-tien-do-7` nhận hợp đồng để tích hợp viewer, không phải tự coi ảnh xem trước là capture trong engine.

## 5. Adapter viewer

Đọc `manifest.directions[state.skeletonDirection]`, nạp JSON + `.atlas` + PMA PNG cùng record, skin `default`, chạy `idle` với loop. Gọi `getCharacterViewState` bằng `kind: 'player'`, `animation: 'idle'`, `drawnInEight: false`, `equipped: manifest.equipped`, `paperdoll: { swordInHand: true }`, socket override của hướng nguồn. Để API xử lý mirror x; không tự đảo socket lần hai. Áp `state.scaleX` và draw order theo **hướng thật**, ẩn slot theo `visibleSlots`; hai orbit ở ngoài skeleton.

Trong test chỉ có `idle`: không chọn `run`/`attack` mặc định rồi giả vờ đã có animation. Một hướng hoạt động dùng một page → mục tiêu một texture batch, **chưa đo draw call engine**. Không nạp cả năm hướng để suy ra ngân sách GPU cuối cùng.

## 6. Thứ tự animate tiếp theo

Giá trị bảng dưới từ docs/03 §3 và `@vgtd/character.getAnimation`; **FPS Sprite không phải FPS key Spine** (Spine key ở 30 fps).

| Ưu tiên | Animation               | Frame / FPS Sprite | Thời lượng tham chiếu           | Việc cần làm                                                                                 |
| ------- | ----------------------- | ------------------ | ------------------------------- | -------------------------------------------------------------------------------------------- |
| 1       | `idle`                  | 12 / 12            | 1,0 s Sprite; thở Spine 1,5–2 s | Duyệt posture, nhịp thở, tóc/ribbon/đai; chân không trượt                                    |
| 2       | `run`                   | 10 / 20            | 0,5 s                           | Footstep ở frame 2 và 7; kiểm tay/kiếm không xuyên robe                                      |
| 3       | `attack` × combo 3 nhịp | 10 / 24 mỗi nhịp   | 0,42 s mỗi nhịp                 | Lấy đà–trúng–thu; đặt `hit`/`cancel_window` khi animator/designer duyệt, không bịa frame hit |
| 4       | `cast`                  | 14 / 28            | 0,5 s                           | `vfx_spawn` cuối pha lấy đà                                                                  |
| 5       | `hit`                   | 4 / 20             | 0,2 s                           | Phản lực đọc rõ, kiểm điều kiện ngắt theo spec                                               |
| 6       | `die`                   | 12 / 15            | 0,8 s                           | Giữ frame cuối, kiểm pivot/sort key mặt đất                                                  |

Idle **thử** trong JSON kéo dài 2 s, 17 mốc (kể cả điểm đóng loop), lấy mẫu tương đương 8 Hz rồi làm tròn lên lưới key 30 fps (nhịp cách 3/4 frame). Nội suy tuyến tính cho thở và motion nhỏ ở tóc/ribbon/đai/sleeve tips. Điểm đầu/cuối trùng nhau; không phải 8-frame sprite animation hoặc bộ timing sản xuất đã duyệt.

## 7. Tái tạo và kiểm chứng

```sh
npm ci
npm run gen:kiemtu -w @vgtd/procgen -- build
npm run gen:kiemtu -w @vgtd/procgen -- validate
npm run gen:kiemtu -w @vgtd/procgen -- review <session-artifact-dir>
```

Đầu vào tái tạo là năm PNG chuẩn hóa đã commit; tùy chọn `import <sheet.png>` ghi đè chúng từ sheet AI năm cột. Không gọi API AI trong script. `build` sinh cutout/underpaint, pack tạm dưới `tools/procgen/build/kiem-tu/` bằng packer hiện có (POT, padding 2 + extrude 1), rồi ghi bộ nguồn/runtime có chủ đích; không commit thư mục build. Mỗi hướng hiện 256×512, 34 bones, 13 slots, tối đa 136 vertices tính cả alias, 0 physics constraints. Gate kiểm canvas, API draw order, vertex/bone references, UV/triangles, rig limits, loop endpoints, key grid và PMA bytes.

Hồ sơ từng asset/prompt/công cụ/mô hình không công bố nằm trong [ASSET-LICENSES.md](../ASSET-LICENSES.md). Cần chủ art và người animate chỉnh/duyệt trước phát hành; nguồn gốc và giấy phép phải được kiểm lại. Chưa có âm thanh, gameplay hay server/netcode trong PR này.
