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

## 10. Vòng 2: QA mesh, điểm nối vòng lặp, kết quả trên rig thật

- **QA mới** (`runQa` tự chạy phần mesh khi rig có mesh): `detach` (mối nối giữa các mảnh nằm trên hai khớp liền nhau phải đóng kín: so các đỉnh nằm trên mảnh kia lúc nghỉ với tư thế hiện tại, bắt cả kiểu hở hình nêm; ngưỡng 3 px), `mesh-strain` (cạnh tam giác dãn quá 140%), kiểm tra khoảng cách tới khung xương, `islands` (số mảnh rời của bóng alpha so với tư thế nghỉ, `checkSilhouette`, bỏ kiếm), `ground`. Kiểm tra điểm nối vòng lặp nay so **vector** vận tốc (đổi chiều tự nhiên của đầu gối không phải giật; chân chạm đất đúng điểm nối được miễn vì đã có `foot-slide`).
- **Sửa:** giật điểm nối của `run` (E) là báo động giả của phép so độ lớn vận tốc; phép so vector cho kết quả 0 lỗi ở 15 clip × 5 hướng. `skirtFollowsLegs`: các tấm áo `robe_*` treo ở hông nay xoay theo chân (trước đây đứng yên nên chân lòi ra khỏi váy cứng). Cánh tay: đo độ dài vai–cổ tay 26,3 px ± 0,3 trong mọi khung (không dãn); `mesh-strain` = 0 trên rig gốc.
- **Phát hiện chính (cần sửa ở rig, không phải ở hoạt cảnh):** rig thật (`kiem-tu.rig.json`) skin **mỗi mảnh cứng vào đúng một bone** (các "đảo quad"), nên khớp nào gập là mối nối ở khớp đó hở ra: trên 15 clip × 5 hướng QA đo hở tới **~20 px** (đùi–cẳng–bàn chân của lớp `body`, tay áo–vai, tay trên–tay dưới), và `islands` thấy mảnh rời ở 16 clip-hướng (S 2, E 4, NE 10; SE và N 0). Đó là các mảnh "trôi" nhìn thấy ở sleeve/robe. Mức độ của `detach` mặc định là **warning** vì lý do đó; dùng `seamSeverity: 'error'` để chặn khi rig đã sửa.
- **Công cụ giảm nhẹ:** `softenSeams(rig)` chia trọng số đều giữa hai bone ở các đỉnh nằm trên mối nối: giảm số lần hở khoảng một nửa và hở tối đa còn 6–10 px nhưng chưa về 0 (khớp gập mạnh vẫn kéo mảnh ra) và có thể gây dãn tay áo (`mesh-strain` > 140%) → **không bật mặc định**. `fitToSilhouette` thử giảm biên độ chi nhưng các mảnh rời xuất hiện cả ở tư thế gần nghỉ (NE, chân co lúc chạy) nên biên độ không phải nguyên nhân. **Đề nghị cho worker nhân vật:** (1) cho các mảnh kề nhau ở khớp chồng lên nhau ≥ 4–6 px (mở rộng quad về phía khớp, cần phần art tương ứng); (2) chia quad dọc theo chi thành 3–4 dải và gán trọng số mềm qua khớp (đùi/cẳng/bàn chân, tay trên/tay dưới/tay áo); (3) gán `robe_front`/`robe_back` trọng số theo đùi. Tiêu chí nghiệm thu đã có sẵn: `detach` ≤ 3 px, `islands` = rest, `mesh-strain` ≤ 140%, đo bằng `npm run artifacts`.
- **Artifact:** GIF nền xám trung bình + đường nền + onion skin (xanh = trước 2 khung, đỏ = sau 2 khung) cho 15 clip × 5 hướng, `index.html` (bảng tổng hợp có cờ whole/split từ phép đo islands), `qa-report.txt`, contact sheet E, bảng 5 hướng, gói DragonBones từng hướng.

## 11. Vòng 3: auto-skinning, kiếm đôi, vẽ bù

- **`autoSkin(rig, opts)`** (`src/autoskin.ts`, dùng lại được cho mọi lớp): chia lưới các mảnh quad nằm trên một mối nối (nội suy song tuyến vị trí và UV, không đổi art), gán trọng số mềm từ **khoảng cách tới đường mối nối** (trên mối nối hai bone chia đều 0,5/0,5; sau dải `band` thì ghim 100 % vào bone của mảnh), hai mảnh cùng dùng một đường mối nên đỉnh dọc mối nối có trọng số giống nhau (hàn); tối đa 3 ảnh hưởng/đỉnh, tự tăng cỡ ô để giữ ngân sách đỉnh `RIG_LIMITS` (Player 600): rig Kiếm tu ra **556 đỉnh** (cell 6 px) trong giới hạn; Cocos DragonBones chấp nhận mesh có trọng số (đã nạp bằng runtime thật).
- **Kết quả đo trên 15 clip × 5 hướng (cùng một bộ đo mối nối `connectedBones`):** rig cứng: 503 lần hở (tối đa 32,5 px), 16 clip-hướng tách mảnh. Auto-skin tốt nhất (band 6): 364 lần hở, tối đa 13,3 px, nhưng **27** clip-hướng tách mảnh và 189 lần dãn quá 200 % (tối đa 556 %). Quét `band` 6/10/16 và `touchPx` 2/4 không đạt 0. Nghĩa là khớp gập mạnh (vai, hông, đầu gối) làm hở theo **hình học**: chỗ lộ ra không có điểm ảnh nào, trọng số không bịa ra màu được → **không áp auto-skin lên dữ liệu rig** (làm bóng tách mảnh nhiều hơn); công cụ giữ lại, tắt mặc định. `seamSeverity` vẫn **warning** vì chưa sạch.
- **Việc cần art (vẽ bù):** [rig-underpaint.md](rig-underpaint.md) liệt kê chính xác cặp mảnh, bone, kích thước và số px cần kéo dài (lớn nhất: thân `body` đùi / `outfit_lower` robe_back 31 px, vest `outfit_upper` / tay áo vai 20 px, robe_back / robe_front 11 px, bàn chân/cẳng/đùi 4-7 px). Không giả bằng dãn mesh.
- **Kiếm đôi:** mảnh `scabbard` của `outfit_lower` vẽ sẵn một thanh kiếm nằm ở hông nên khi kiếm đang rút trên tay thì thấy hai thanh. `removePieces` đã bỏ mảnh đó khỏi 5 hướng (dữ liệu `kiem-tu.rig.json`, đổi 4 đỉnh/hướng). Cách tái tạo khi worker nhân vật xuất lại rig (chạy cho từng rig của RigSet rồi ghi lại JSON, định dạng bằng prettier): `removePieces(rig, { remove: (slot, bone) => slot === 'outfit_lower' && bone === 'scabbard' })` (mặc định skin `default`); test `kiemtu-data.test.ts` kiểm dữ liệu đã commit không còn mảnh `scabbard`. Bone `scabbard` và vùng atlas của nó được giữ lại (chưa dùng) cho mảnh vỏ kiếm rỗng sắp tới; đánh đổi và việc art còn lại ghi ở `docs/OPEN-ITEMS.md`. Hệ quả đo được: một số clip hướng S lộ đuôi sash rời (S tách mảnh 2 → 11 clip); cần art vỏ kiếm rỗng và vẽ bù sash. QA mới `weapon`: mỗi khung đúng một hiển thị `weapon_R` và kiếm lưng không hiện cùng lúc.
- **Tay ở khung 6 của đòn đánh:** giữ khuỷu hơi gập (10-12°) ở khung đánh thay vì duỗi thẳng (đo trước đó: vai–cổ tay 26,3 px, không dãn); phần "dài" nhìn thấy là các quad cứng chồng nhau.
