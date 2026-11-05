# Trình xem animation DragonBones, QA hình ảnh tự động và duyệt hoạt cảnh

> **Trạng thái:** công cụ dev đã chạy được. Theo [D35/D36](DECISIONS.md) (PR #76): định dạng hoạt cảnh là **DragonBones ≤ 5.6** (runtime built-in của Cocos 3.8.8), AI làm toàn bộ hoạt cảnh, con người chỉ **duyệt trong viewer này**. Kiến trúc client: [21 §9](21-kien-truc-client.md); nghiên cứu runtime: [art/dragonbones.md](art/dragonbones.md); dữ liệu nhân vật: `@vgtd/character` (`getCharacterViewState`, `getAnimationTable`); bảng 13 animation: [03 §3](03-nhan-vat-quai-vat.md).

Viewer là một scene Cocos riêng trong `apps/client-cocos` (`Viewer.scene`). Nó nạp armature DragonBones, đổi animation/hướng/lớp paperdoll, tua/đổi tốc độ, có chế độ **so sánh** và chế độ **review** (cả 8 hướng cạnh nhau), đo draw call/RAM, và có script **chụp tự động** cho agent. Web desktop và mobile.

## 1. Chạy viewer

```bash
npm ci                                      # gốc repo
npm run build:web -w client-cocos           # sinh rig thử + build web (cần Cocos Creator 3.8.8, biến COCOS_CREATOR_PATH)
npm run serve -w client-cocos               # http://localhost:7456
# mở:  http://localhost:7456/#viewer
```

Tham số trong phần hash của URL (tùy chọn, nối bằng `&`):

| Tham số             | Ý nghĩa                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `viewer`            | Bắt buộc: mở scene Viewer thay vì demo thế giới                                                                          |
| `anim=attack`       | Animation của A (13 id: idle, meditate, walk, run, dash, sword_fly, attack, cast, channel, hit, die, tribulation, emote) |
| `mode=review`       | `single` (mặc định), `compare` (A và B, cần `animb=cast`), `review` (8 hướng)                                            |
| `dir=NE`            | Hướng nhìn (8 hướng; 5 hướng vẽ + 3 hướng lật gương, D14)                                                                |
| `paused=1&t=0.25`   | Dừng và tua tới giây 0,25                                                                                                |
| `ts=0.5`            | `timeScale`                                                                                                              |
| `skin=red`          | Biến thể paperdoll (display thứ 2 của slot)                                                                              |
| `off=wing+weapon_R` | Ẩn các slot (nối bằng `+`)                                                                                               |
| `onion=1`           | Bật onion-skin (bóng mờ −2 frame xanh, +2 frame đỏ)                                                                      |
| `cache=shared`      | Chế độ cache DragonBones: `realtime` (mặc định), `shared`, `private`                                                     |
| `src=…&stem=…`      | Thư mục con của `assets/resources/` chứa rig (mặc định `dragonbones/viewer`) và tiền tố tên file (`rig`)                 |
| `mobile`            | Ép bố cục mobile (bottom sheet) khi thử trên desktop                                                                     |

Phím tắt (desktop): `Space` tạm dừng, `←/→` đổi hướng, `↑/↓` đổi animation, `[` `]` đổi tốc độ.

## 2. Chức năng

- **Animation (13)**, **Hướng** (la bàn 8 hướng, ô nét đứt = lật gương; hộp "drawn in 8" = animation vẽ đủ 8 hướng, không lật — logic chọn rig/lật lấy từ `@vgtd/character`, không viết lại).
- **Playback:** Pause/Play, Restart, ±1 frame (1/30 s), thanh tua, `timeScale` 0,05–3, `mix` 0–0,5 s (thời gian `fadeIn` khi đổi animation; **không** fade khi đang pause vì đồng hồ fade bị đóng băng), `repeat one-shots`, hiển thị `playbackFps` theo bảng (60/30/15, chưa áp thật).
- **Paperdoll:** 13 slot bật/tắt (`slot.displayIndex = -1`), cờ xung đột (mounted, kiếm trong tay, ngự kiếm, mũ trùm, áo dài) qua `getCharacterViewState` — slot bị luật ẩn được liệt kê kèm lý do; biến thể (skin) = display thứ hai của slot (`outfit_upper/lower`, `cape`).
- **Modes → Review:** chạy animation của A ở **cả 8 hướng** (5 vẽ + 3 lật gương, hoặc 8 rig nếu animation "vẽ đủ 8") trên một đồng hồ chung nên frame-step và điểm nối vòng lặp giống nhau ở mọi hướng; mỗi ô có nhãn hướng và rig thật được dùng.
- **Chỉ báo điểm nối vòng lặp (loop seam):** huy hiệu `wrap` nháy đỏ mỗi lần vòng lặp quay lại, và số đo định lượng: lấy mẫu mọi frame, tính bước chuyển động trung bình (bone global x, y, góc) và bước giữa frame cuối → frame đầu; `ratio = bước nối / bước trung bình`, ≈ 1 là liền mạch, **> 2,5 là giật** (cảnh báo). Chỉ **animation loop theo bảng** bị coi là lỗi khi giật; animation một lần (die, dash, hit, cast…) vẫn báo `ratio` nhưng chỉ để tham khảo. Chế độ realtime.
- **Onion-skin:** hai bản mờ của A trước/sau 2 frame, vẽ phía sau A nên chỉ lộ ra chỗ tư thế khác.
- **Compare:** hai armature cạnh nhau (A trái, B phải); **Sync restart**.
- **Cache mode** (Modes): realtime / shared cache / private cache để so hiệu năng; xem §5.
- **Info:** nhật ký sự kiện (hit, footstep_L/R, vfx_spawn, cancel_window…) kèm thời điểm; so Draw Order bảng paperdoll với thứ tự slot thật của rig.
- **HUD:** FPS, draw call (so `BUDGETS.DRAW_CALLS_WEB_MOBILE`), tris, bộ nhớ texture GFX (so `BUDGETS.TEXTURE_RAM_MB_WEB`), JS heap, node.
- **Bố cục:** desktop = thanh bên phải; hẹp (≤ 820 px) hoặc cảm ứng = bottom sheet có tab (Anim / Dir / Play / Layers / Modes / Info), nút ≥ 44 px. Lỗi nạp rig hiện ở dải đỏ trên cùng thanh điều khiển.

## 3. Adapter và hợp đồng nạp rig

Viewer chỉ nói chuyện với `CharacterActor` (`assets/scripts/viewer/CharacterActor.ts`): `apply(viewState, options)`, `time()`, `seek()`, `restart()`, `seamMetric()`… Hiện có **một** hiện thực: `DragonBonesActor` (`dragonBones.ArmatureDisplay`, `DragonBonesAsset`, `DragonBonesAtlasAsset`). Không cài adapter Spine; nếu sau MVP có giấy phép Spine thì thêm một `SpineActor` cùng interface (xem [art/dragonbones.md §4](art/dragonbones.md)).

**Thêm một nhân vật mới** (ví dụ bộ Kiếm tu của `van-gioi-tien-do-14`):

1. Xuất theo hướng: `<stem>_<HƯỚNG>_ske.json` + `<stem>_<HƯỚNG>_tex.json` + `<stem>_<HƯỚNG>_tex.png` cho S, SE, E, NE, N (thêm SW, W, NW chỉ khi có animation vẽ đủ 8) vào `apps/client-cocos/assets/resources/dragonbones/<nhân-vật>/` (không dùng `dragonbones/viewer/`: bị `prepare:assets` ghi đè). Tên armature trong `_ske.json` nên là `<stem>_<HƯỚNG>` (nếu không viewer lấy armature đầu tiên).
2. Slot đúng 13 id của `@vgtd/character` (wing, cape, sword_back, hair_back, body, outfit_lower, outfit_upper, head, hair_front, headwear, arm_L, arm_R, weapon_R), đúng thứ tự vẽ của hướng đó (`slotsInDrawOrder`); animation đúng 13 id, thời lượng = `frames / fps` của bảng; sự kiện chuẩn (`hit`, `vfx_spawn`, `sfx`, `footstep_L`, `footstep_R`, `cancel_window`) là frame event.
3. Biến thể trang phục = thêm display vào cùng slot (display 0 mặc định, 1 là biến thể).
4. Chạy `npm run build:web -w client-cocos` (hoặc mở dự án bằng Cocos Creator 3.8.8) để import, rồi mở `#viewer&src=dragonbones/<nhân-vật>&stem=<stem>`.

## 4. Rig thử và xuất từ DragonBones Pro / LoongBones

> **Sẽ được thay:** theo phân công mới, `tools/rig` (`@vgtd/rig`, PR #78) sở hữu schema rig và bộ xuất DragonBones; rig thử này chỉ là fixture tối thiểu để viewer chạy, sẽ chuyển sang sinh qua bộ xuất của `@vgtd/rig` (việc tiếp theo). Viewer nạp mọi DragonBones JSON từ `assets/resources/dragonbones/<nhân-vật>/` (cần nằm dưới `resources/` để nạp lúc chạy).

`tools/dragonbones-testrig` (`@vgtd/dragonbones-testrig`) sinh rig thử **bằng code**, không dùng asset bên thứ ba: một **mô tả rig trung lập** (y lên, độ CCW, px @1x: `neutral.ts`) + bộ xuất DragonBones 5.5 (`dragonbones.ts`: y xuống, độ CW, thời lượng theo frame; mọi chuyển trục nằm trong bộ xuất).

- 8 armature `rig_<HƯỚNG>` (5 vẽ + 3 cho animation vẽ đủ 8), thứ tự slot = bảng Draw Order của hướng; 10 bone; 13 slot; mảnh placeholder (mắt/mũi theo hướng, mũi kiếm đỏ để thấy lật gương); **không** mesh/IK/FFD.
- 13 animation đúng id, thời lượng/loop theo bảng, khóa 30 fps, chuyển động thủ tục; sự kiện theo bảng (số frame đọc theo chỉ số 0, `EVENT_FRAME_INDEX_BASE`; mốc `hit_frame`/`windup_end`/`combo_window` là giá trị tạm 45/35/70 %).
- Atlas pow2, ≤ 2048 (`BUDGETS.ATLAS_MAX_WEB_MOBILE`), padding 2 (`BUDGETS.ATLAS_PADDING_PX`), PNG **premultiplied alpha** (viewer đặt `premultipliedAlpha = true`).
- Dữ liệu version `5.5` (`version` = `compatibleVersion` = `"5.5"`): runtime Cocos 3.8.8 đọc tới 5.6.x.

Sinh lại: `npm run gen -w @vgtd/dragonbones-testrig` (ra `tools/dragonbones-testrig/out/`, không commit); `prepare:assets` tự chạy và chép vào `assets/resources/dragonbones/viewer/`. Test (chạy trong CI): `tools/dragonbones-testrig/test`.

**Nếu dùng editor** (tùy chọn từ D36; DragonBones Pro 5.6.x hoặc LoongBones): xuất **DragonBones JSON** (chọn Data Version thấp nhất, ≤ 5.6), một armature mỗi hướng, atlas JSON + PNG với: premultiply alpha **bật**, pow2 **bật**, tối đa **2048**, padding **2**, không xoay; đặt tên theo §3. Kiểm tra bằng viewer: đủ 13 animation, sự kiện đúng mốc, thứ tự vẽ khớp bảng (Info), bộ nhớ/draw call trong ngân sách. File xuất mẫu để thử nhập vào LoongBones: thư mục `dragonbones-import-test/` (artifact của PR).

## 5. Giới hạn của runtime DragonBones đã gặp

- **Cache mode:** chỉ `realtime` hỗ trợ `fadeIn` (mix), tua (`AnimationState.currentTime`), đổi display slot và đọc thời gian. `shared`/`private` cache bake frame ở 1/60 s: viewer chỉ còn `playAnimation` + `timeScale` (thanh tua, mix, bật/tắt slot, onion, review đồng bộ bị vô hiệu — panel báo "CACHED mode"). Với rig thử, draw call/FPS không đổi giữa các chế độ (một nhân vật quá nhẹ để thấy khác biệt); cần spike nhiều bản sao (S2).
- `getArmatureNames()` trả mảng rỗng lúc chạy trên Web (dựng cho editor): viewer dùng quy ước tên `<stem>_<HƯỚNG>`.
- Không có `Skin.addSkin`: biến thể trang phục dùng display thứ hai của slot (`slot.displayIndex`).
- Mesh, FFD, IK: rig thử không dùng nên **chưa kiểm** hiệu năng/độ đúng; IK có parser, không có physics/path/transform constraint như Spine 4.x.
- Mỗi hướng một texture riêng: chế độ review (8 hướng) tốn 25 draw call, 18 MB texture GFX trong rig thử; repack texture ≤ 2 draw call/nhân vật chưa làm.
- Thứ tự vẽ lấy từ setup order của rig hướng đã vẽ; chưa đặt lại Draw Order lúc chạy cho hướng lật gương (viewer cảnh báo khi khác bảng).
- `playbackFps` (60/30/15) chỉ hiển thị.
- Chưa thử trên thiết bị thật (bố cục mobile ép bằng `#mobile`).

## 6. Số đo build (web-mobile, debug)

| Cấu hình                       | Tổng `build/web-mobile` | `cocos-js` (engine) |
| ------------------------------ | ----------------------- | ------------------- |
| Spine 4.2 (trước), 2D tối giản | 6.428.069 B             | 5.165.254 B         |
| DragonBones (bật), Spine cắt   | 6.179.081 B             | 4.612.847 B         |

Chênh −249 KB tổng (WASM Spine ~0,5 MB bỏ đi, module dragon-bones thêm vào); còn ≈ 6 MB so với ngân sách tải đầu 25 MB (`BUDGETS.INITIAL_DOWNLOAD_MB_WEB`, chưa nén brotli — xem [21](21-kien-truc-client.md)). Đo viewer (Chrome, GL phần mềm): 1 nhân vật 60 FPS, 5 draw call, ~17 MB texture GFX, JS heap ~20 MB; review 8 hướng 60 FPS, 25–27 draw call.

Hoàn tác (quay lại Spine) cần một `SpineActor` mới và đổi `engine.json`: `spine._value = true`, thêm `spine-4.2` vào `includeModules`.

## 7. QA hình ảnh tự động (cho agent) và duyệt của con người

```bash
npm run capture -w client-cocos -- --out <thư-mục> --animations idle,attack --frames 8 --gif   # thêm --skip-build nếu đã build
```

Script `apps/client-cocos/scripts/capture.mjs`: build web-mobile (trừ khi `--skip-build`), phục vụ bản build, mở viewer bằng Chrome/Edge **headless** (`puppeteer-core`, dùng trình duyệt có sẵn: đặt `CHROME_PATH` nếu cần; WebGL phần mềm), ẩn panel/HUD và với mỗi animation (mặc định cả 13; chế độ `review` = 8 hướng mỗi ô):

- `<animation>.sheet.png`: contact sheet N frame (3 ô mỗi hàng, đánh số bằng chấm);
- `<animation>.gif` (với `--gif`): GIF lặp toàn animation;
- `index.json`: thời lượng, số frame, số đo loop seam; script thoát mã 1 nếu một animation loop theo bảng có seam giật (> 2,5×) hoặc viewer báo lỗi (animation một lần không tính).

Thư mục đầu ra mặc định là `<tmp>/vgtd-capture`, **không commit**. Hook cho script/kiểm thử: `window.__vgtdViewer` (`ready()`, `set({...})`, `seekNorm()`, `info()`, `seam()`, `chrome(visible)`).

**Ghi chú duyệt:** con người điền [art/reviews/TEMPLATE.md](art/reviews/TEMPLATE.md) (một file mỗi lần duyệt: `docs/art/reviews/<nhân-vật>-<YYYY-MM-DD>.md`) sau khi xem trong viewer (hoặc contact sheet/GIF do agent chụp).
