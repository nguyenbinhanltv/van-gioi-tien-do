# Kiếm tu: cấu trúc "chi liền" (continuous limbs), hợp đồng mảnh cho art

Quyết định **D39** của chủ dự án (2026-11-06, xem `docs/DECISIONS.md`): bỏ cách "cắt mảnh chữ nhật từ một ảnh", chuyển sang **vẽ từng bộ phận đầy đủ** và dựng **một mesh liền cho cả tay / cả chân**. Bản này là đặc tả mảnh cho worker art; công cụ nằm ở `tools/rig/src/limb.ts` (`buildLimbMesh`, `buildSkirtMesh`). Nền tảng số liệu: `docs/art/rig-approach-memo.md` (phương án B + C).

## 1. Định dạng file

- Mỗi mảnh là **một PNG RGBA 256×256** (@2x của canvas 128×128), cùng hệ tọa độ với ảnh master của hướng đó, nền trong suốt, **vùng bị che phải vẽ đầy đủ**.
- Thư mục: `assets-src/placeholder/kiem-tu-continuous-v1/<hướng>/<mảnh>.png`; thêm `landmarks.json` (`{tên: [x, y]}`, px @2x, x sang phải, y xuống, gốc ở góc trên trái canvas 256).
- Xương của hướng được dựng lại từ `landmarks.json`; vì vậy chi có thể vẽ **thẳng, trung tính** (tay thõng, chân thẳng đứng), không cần khớp tư thế nghỉ cũ.
- Gốc (pivot) của nhân vật: `(128, 232)` @2x. Cả hình cao ~190 px @2x.

## 2. Mốc khớp hiện tại của hướng E (đích, px @2x)

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

## 3. Danh sách mảnh (thứ tự vẽ từ sau ra trước, hướng E)

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

## 4. Quy tắc vẽ ảnh hưởng đến rig

1. Chi **thẳng, bề rộng gần như không đổi dọc chiều dài**; không vẽ sẵn nếp gập hay tay áo gập (gập mesh sẽ nhân đôi nếp).
2. Khuỷu / gối chỉ là hình tròn hoặc thẳng, không có đệm gối hay cổ tay áo vắt ngang đường khớp (đặt trên mảnh tay, cẳng, cổ chân).
3. Không có bóng đổ giữa các mảnh (bóng nằm ở lớp riêng).
4. Bảng màu và ánh sáng (NW) giống master; chuyển màu theo vật liệu về master để không lệch phong cách giữa các mảnh.
5. Chỉ viền ngoài silhouette có anti-alias 1-2 px; các cạnh chồng nội bộ có thể cắt thẳng vì phần chồng đã vẽ đầy đủ.

## 5. Cách rig dựng (để art khớp)

- `buildLimbMesh(rig, {name, slotBone, chain, view, image})`: một mesh dải dọc theo chuỗi xương (`[upper_arm_R, lower_arm_R, hand_R]` hoặc `[thigh_*, shin_*, foot_*]`); mặt cắt lấy theo alpha; **mỗi đỉnh tối đa 2 xương**, trọng số chuyển mượt (smoothstep) quanh khuỷu/gối/cổ tay/cổ chân, bán kính chuyển mặc định 8 px @1x và tự co để hai khoảng chuyển không chồng nhau; ~40-70 đỉnh mỗi chi.
- `buildSkirtMesh`: lưới đều trên vùng vẽ; xương hông ở eo, chuyển dần sang hai đùi (chia theo khoảng cách đến từng xương đùi) tới gối; không có đảo, không có mối nối.
- Tay/mặt/lọn tóc: cứng hoặc theo chain. Ngân sách: ≤ 600 đỉnh mỗi hướng (`RIG_LIMITS.player`), một trang atlas ≤ 2048 (padding 2, extrude 1, PMA), ≤ 2 draw call mỗi nhân vật.
- Cổng nghiệm thu: `rig:measure --strict` (0 khe hở, 0 rách, 0 giãn) và chụp trong engine `npm run capture -w client-cocos` cho đủ 15 clip.

## 6. Việc kế tiếp (rig side)

Dựng xương từ `landmarks.json`, ghép mảnh → rig hướng E, xuất vào `apps/client-cocos/assets/resources/dragonbones/kiem-tu-continuous` (giữ nhân vật cũ để so sánh), thêm blink / đổi tay / đổi miệng vào clip (display index theo khung), sau đó lan sang S/SE/NE/N.

## 7. Lớp chi tiết hoạt cảnh (`tools/rig/src/detail.ts`)

Dữ liệu điều khiển clip, áp dụng cho mọi rig có đủ slot (thiếu slot hoặc display thì bỏ qua, không lỗi).

| slot          | display (tên attachment)                                                     | dùng khi                                                                                               |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `eyes`        | `eyes_open`, `eyes_half`, `eyes_closed`                                      | chớp mắt mỗi 3-5 s (idle, walk, channel, emote); `meditate` nhắm suốt                                  |
| `mouth`       | `mouth_neutral`, `mouth_open`, `mouth_smile`                                 | quát quanh frame trúng đòn (attack 1-3), niệm (cast), đau (hit), cười (emote)                          |
| `hand_R`      | `hand_R_grip`, `hand_R_relaxed`, `hand_R_fist`, `hand_R_palm`, `hand_R_seal` | tay cầm kiếm luôn `grip` (thả lỏng khi die/meditate)                                                   |
| `hand_L`      | `hand_L_relaxed`, `hand_L_fist`, `hand_L_palm`, `hand_L_seal`                | nắm tay khi đánh/bị đánh, kiếm quyết (`seal`) khi cast/channel/sword_fly, `palm` khi emote/tribulation |
| `sword_trail` | `sword_trail` (blend additive)                                               | vệt kiếm từ `windup_end` đến `hit_frame` + 5, alpha 0 → 1 → 0                                          |
| `sword_glint` | `sword_glint` (blend additive)                                               | chớp sáng ±2 frame quanh `hit_frame` (và cast)                                                         |

Chain thứ cấp (`addDetailChains`, bake lò xo ở 30 fps như tóc/đai hiện có): `hair_strand_a/b/c`, `ponytail`, `ribbon_tail_L/R`, `sash_tail_L/R`, `pendant`, `sleeve_edge_L/R`, `robe_hem_front/back`; vị trí đặt (`at`) chỉnh theo rig thật bằng `overrides`. **Ngân sách:** `addDetailChains` không bao giờ vượt `RIG_LIMITS.player` (≤ 60 bone, ≤ 6 chain thứ cấp, docs/03); chain nào không vừa bị bỏ qua theo thứ tự ưu tiên (`DETAIL_CHAIN_PRIORITY`: ponytail, 2 đuôi đai, 2 đuôi dải, tay áo, gấu váy, mặt dây, lọn tóc) và được báo trong `skipped`. Rig Kiếm tu hiện tại đã dùng đủ 6 chain, nên 13 chain chi tiết **cần một quyết định đổi giới hạn** (mục DECISIONS + `@vgtd/character`) hoặc gộp bớt; chưa tự ý vượt. Mỗi chain cần mảnh art riêng đã tách (hoặc nhóm display) và xương cha: `head`, `hips`, `lower_arm_L/R`.

Cổng nghiệm thu một lệnh: `npm run rig:gate -w @vgtd/rig -- <character> --dir E [--src dragonbones/<id> --stem <stem>]` chạy `rig:measure --strict` rồi chụp trong engine đủ clip (kết quả chụp ở thư mục `--out`, đính vào PR).
