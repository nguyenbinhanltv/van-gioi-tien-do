# Quy trình rig và hoạt cảnh bằng AI (D36, `@vgtd/rig`)

> **Trạng thái:** mô tả quy trình đang chạy trong `tools/rig` (`@vgtd/rig`). Căn cứ: [D35](../DECISIONS.md) (DragonBones thay Spine), [D36](../DECISIONS.md) (AI làm toàn bộ concept, tách mảnh, rig, hoạt cảnh; người chỉ duyệt trong viewer), nghiên cứu runtime tại [dragonbones.md](dragonbones.md). Bản đầu do agent tạo: **chưa phải hoạt cảnh hoàn thiện** cho tới khi chủ dự án duyệt trong viewer.

## 1. Tổng quan

```
concept (AI) → các mảnh paperdoll tách lớp → atlas (packer, premultiplied)
            → rig.json (nguồn trung lập, 1 tệp mỗi hướng vẽ)
            → hoạt cảnh (TS DSL trên "vai trò" bone) → bake chuyển động phụ
            → QA tự động (loop, trượt chân, độ dài bone, spike, sự kiện…)
            → xuất DragonBones 5.5 (ske.json + tex.json)
            → nạp trong viewer (apps/client-cocos) → người duyệt / yêu cầu sửa
```

Nguồn chuẩn nằm trong repo: **rig.json + mã hoạt cảnh**. DragonBones JSON là đầu ra sinh tự động (không sửa tay); editor GUI (LoongBones…) chỉ là tùy chọn để đối chiếu hoặc chỉnh thử.

## 2. Rig trung lập (`RigDocument`, `tools/rig/src/schema.ts`)

- **Một skeleton mỗi hướng vẽ** (S, SE, E, NE, N; SW/W/NW lật gương `scaleX = −1` qua `@vgtd/character`, docs/21 §9). Một nhân vật = 5 tệp (hoặc `RigSet`).
- Không gian pivot: gốc ở chân, x phải, **y hướng lên**, góc độ CCW (ADR-021); bộ xuất tự lật y/góc sang DragonBones.
- Nội dung: `bones` (cha trước con, `length`, rest transform), `ik` (1–2 bone, `bendPositive`, `mix`), `chains` (nhóm chuyển động phụ: tóc, dải lụa, đai, tay áo, phi phong), `roles` (vai trò → tên bone: `hips`, `spine_mid`, `spine_upper`, `head`, `upper_arm_L/R`, `hand_L/R`, `thigh_L/R`, `shin_L/R`, `foot_L/R`, `ik_foot_L/R`…), `sockets` (bảng docs/03 §4), `slots` (thứ tự vẽ lùi → tiến theo `drawOrderFor(direction)` của `@vgtd/character`, không có `orbit_*`), `skins` (`default` + trang bị), attachment `region` hoặc `mesh`.
- `validateRig()` kiểm: JSON Schema, tên trùng, cha/con, tham chiếu IK/chain/role/slot, **thứ tự paperdoll theo hướng**, giới hạn rig của docs/03 (`RIG_LIMITS`: 60 bone/40 slot/600 đỉnh/6 chain cho Player).
- Dữ liệu và art thuộc worker nhân vật (`tools/rig/kiem-tu.rig.json`, atlas); **schema thuộc `@vgtd/rig`**. Cho tới khi có rig thật, `buildReferenceHumanoid(direction)` là fixture hợp lệ để viết/kiểm hoạt cảnh.

## 3. Viết hoạt cảnh (DSL)

- `ClipBuilder` viết theo vai trò hoặc tên bone: `rotate`, `translate`, `scale`, `attachment`, `color`, `ikMix`, `event`, `phase`. Giá trị là **delta so với rest pose**; khung nguyên ở 30 fps (`SPINE_KEY_FPS`). Tên sai → lỗi ngay (không im lặng bỏ qua).
- Easing: `linear`, `stepped`, bezier `[x1,y1,x2,y2]` (`EASE.inOut/out/whip/snapOut/back/fall`).
- Nguyên tắc: `anticipation`, `settle` (follow-through), `overlap` (kéo trễ), `hold`, `arc`, `amplify`.
- **Chân không trượt:** `planFeet` điều khiển mục tiêu IK `ik_foot_L/R`; thì đứng chân chuyển động ngược đúng tốc độ mặt đất nên chân đứng yên trong thế giới; pha đá có cung nhấc chân. `clip.motion` ghi tốc độ tác giả và cờ "đang chạm đất" cho QA. Runtime đặt `timeScale = tốc độ thực / tốc độ tác giả` để không trượt.
- **Chuyển động phụ:** `bakeSecondaryMotion` mô phỏng lò xo giảm chấn (tất định, không `Math.random`/`Date.now`) cho chuỗi `chains`, bake thành key xoay 30 fps, giữ liền mạch vòng lặp (`periodicize`). Thay cho physics constraint của Spine.
- **Vòng lặp:** `closeLoop` đặt key cuối bằng key đầu; QA đo khe hở và nhảy tốc độ qua điểm nối.
- **Bộ hoạt cảnh:** `clipSpec(id)` đổi bảng 13 hoạt cảnh (`getAnimationTable`) sang 30 fps: số khung, vòng lặp, khung sự kiện. Ví dụ `attack` 10 khung @24 fps = 12,5 → **13 khung** @30 fps (lệch < 1 khung, trong dung sai); `run` sự kiện `footstep_L/R` ở khung 3 và 11 (khung 2 và 7 của bảng sprite, quy đổi).

### Bộ Kiếm tu (bản đầu)

`authorKiemTuSet(rig)`: `idle`, `run`, `attack`, `attack_2`, `attack_3` (combo 3 đòn; sự kiện `hit` và `cancel_window`), `cast` (`vfx_spawn` cuối pha lấy đà), `hit`, `die`; tóc và đai bake chuyển động phụ. Viết cho góc nhìn nghiêng (E) rồi giảm biên độ theo hướng (`viewGain`: S/N ≈ 0,5; chéo ≈ 0,8). Bộ đầy đủ 13 hoạt cảnh của bảng (15 clip vì `attack` có 3 biến thể): thêm `walk`, `dash` (khinh công), `meditate` (đả tọa), `channel`, `sword_fly`, `tribulation` (đoạn giữa 6–24 là đoạn lặp theo đợt sét, ghi ở `phases`), `emote` (bái).

## 4. QA tự động (`runQa`, `buildCharacterPackage`)

Bộ lấy mẫu chạy không đầu, đánh giá từng khung trên rig và báo `QaIssue` (mức, bone, khung):

| Kiểm tra            | Nội dung                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `loop-seam`         | Khe hở vị trí khung N so với 0; nhảy tốc độ qua điểm nối                                  |
| `foot-slide`        | Chân đang chạm đất trôi trong thế giới (px/khung)                                         |
| `bone-length`       | Khoảng cách cha→con đổi so với rest (kéo giãn)                                            |
| `angular-velocity`  | Quay quá nhanh (> 80°/khung)                                                              |
| `jitter`            | Xoay đổi dấu liên tục từng khung                                                          |
| `ik-reach`          | Mục tiêu IK ngoài tầm với (chi duỗi quá mức)                                              |
| `slot-order`        | Track slot trỏ tới slot/attachment không tồn tại (thứ tự paperdoll do `validateRig` kiểm) |
| `events`/`duration` | Sự kiện chuẩn đúng chỗ (± 1 khung); số khung và cờ lặp khớp bảng 13 hoạt cảnh             |
| `keys`              | Hai key xoay cách nhau > 180° (bộ phát DragonBones nội suy cung ngắn)                     |

`buildCharacterPackage` **không xuất** nếu còn lỗi QA (trừ `allowErrors`). Bài kiểm tra chứng minh từng kiểm tra bắt được lỗi cố ý.

## 5. Xuất DragonBones và kiểm bằng runtime Cocos

- `exportDragonBones(entries, atlas, { name })` → `ske.json` (version/compatibleVersion **5.5**, tối đa 5.6.300 theo Cocos 3.8.8) + `tex.json` (SubTexture từ atlas của packer; cờ `premultipliedAlpha` là phần mở rộng, Cocos nhận PMA qua import texture). Armature đặt tên theo hướng (`S`, `SE`, `E`, `NE`, `N`).
- Cấu trúc theo parser của engine (`@cocos/dragonbones-js` trong thư mục Cocos): `translateFrame`/`rotateFrame`/`scaleFrame`, `curve:[x1,y1,x2,y2]`, `displayFrame`/`colorFrame`, `ik`, sự kiện ở danh sách `frame` mức animation; vòng lặp bỏ key đóng và dùng `playTimes: 0` (key cuối nội suy về key đầu).
- **Kiểm chứng bằng runtime thật:** các bài kiểm tra nạp xuất ra vào chính mã DragonBones của Cocos (bộ nạp + IK + hoạt cảnh, lớp hiển thị rỗng) và so vị trí bone với bộ đánh giá của `@vgtd/rig` (FK, IK cả hai chân, track `ik`, vòng lặp, cả 5 hướng). Sai số < 2,5 px do runtime lấy mẫu lại đường cong bezier theo khung. Các bài này **tự bỏ qua** khi không có Cocos (CI); đặt `COCOS_CREATOR_PATH` để bật cục bộ.
- Phát hiện khi kiểm: runtime ở không gian y-lên (`DragonBones.yDown = false`) nên `bendPositive` giữ nguyên; y và góc lật ở file; hoạt cảnh không lặp có key ở khung N bị bỏ qua khi tua tới cuối (kiểm tới N−1).
- Mesh: cả mesh không trọng số và có trọng số (`slotPose`/`bonePose`/`weights` đúng định dạng engine; kiểm bằng parser thật) đều xuất được.

## 6. Duyệt trong viewer

Viewer (`apps/client-cocos`, worker `van-gioi-tien-do-7`) nạp ske/tex, phát từng hoạt cảnh, 5 hướng + lật; chủ dự án (art owner tạm thời) duyệt hoặc ghi yêu cầu sửa, agent sửa mã hoạt cảnh và chạy lại QA + xuất. Contact sheet PNG/GIF xem trước không cần engine: giai đoạn sau của `@vgtd/rig` (renderer).

## 7. Giới hạn đã biết (ghi OPEN-ITEMS)

- Hướng S/N/chéo chỉ là **chiếu giảm biên độ** từ góc nghiêng; hoạt cảnh đẹp từng hướng cần duyệt trong viewer.
- QA tính theo bezier chính xác; runtime Cocos xấp xỉ đường cong (< ~1 px trên tầm với 90 px).
- Chất lượng cảm giác (trọng lượng, nhịp) không đo bằng QA; cần người duyệt (D36).

## 8. Renderer và artifact duyệt (PR 2)

- `renderPose` / `renderClip` / `contactSheet` / `encodeGif` (`src/render/`, chỉ dùng `node:zlib`, không phụ thuộc native): vẽ nhân vật có texture (attachment `region` và mesh có trọng số, skin, thứ tự slot, tint, additive), lớp phủ gỡ lỗi (bone, mục tiêu IK, chấm đỏ chân đang chạm đất, đường nền), lật gương cho SW/W/NW. `decodePng`/`encodePng` đọc atlas PMA của worker nhân vật.
- Artifact: `RIG_ARTIFACT_DIR=<thư mục> [RIG_DATA_DIR=<thư mục có kiem-tu.rig.json và atlas/<HƯỚNG>/>] npm run artifacts -w @vgtd/rig` sinh: contact sheet PNG và GIF mỗi clip (hướng E), `directions_<clip>.png` (5 hướng), `qa-report.txt`, và gói DragonBones `<id>_<hướng>.ske.json/.tex.json` đã qua cổng QA (nạp thử bằng runtime Cocos nếu có). Không có dữ liệu thật thì dùng rig tham chiếu + atlas giả.
- **Phát hiện nhờ nhìn artifact trên rig thật** (QA số chưa bắt được) và đã sửa: (1) rig thật bật IK tay mặc định nên chuyển động FK của tay bị ghi đè: `armsFk` tắt IK tay trong clip; (2) mũi chân cắm xuống đất khi shin nghiêng: `alignFeet` bake xoay bàn chân giữ phẳng khi chạm đất; (3) tư thế nằm/ngồi phụ thuộc chiều cao hông: `liftToGround` đặt thân sát đất theo rig; (4) chiều dài chân lấy từ rig (`legReach`), không hằng số; (5) kiểm tra mới `ground` (thân không lún xuống nền; kiếm và chuỗi phụ được phép chạm).

## 9. Dữ liệu thật và xuất cho viewer

- `loadKiemTuData(repoRoot)` đọc `tools/rig/data/kiem-tu.assets.json` (manifest), `kiem-tu.rig.json` (RigSet 5 hướng, 38 bone, mesh có trọng số) và atlas PMA 512 (texture 2×, hình học 1×) trong `assets-src/`; test trong CI kiểm RigSet hợp lệ, cả 15 clip qua QA ở 5 hướng và xuất DragonBones được.
- Xuất cho viewer (hợp đồng docs/32 §3): `RIG_EXPORT_DIR=apps/client-cocos/assets/resources/dragonbones/kiem-tu npm run export:kiemtu -w @vgtd/rig` ghi `kiemtu_<HƯỚNG>_ske.json`, `_tex.json`, `_tex.png`; tên data = tên armature = `kiemtu_<HƯỚNG>`; mở bằng `#viewer&src=dragonbones/kiem-tu&stem=kiemtu`. File `.meta` do Cocos sinh khi import (commit ở phía viewer). Sinh lại mỗi khi đổi rig hoặc hoạt cảnh; xuất qua cổng QA và (nếu có Cocos) nạp thử bằng runtime thật.
