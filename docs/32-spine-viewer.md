# Trình xem animation Spine 4.2 và quy trình xuất từ Spine Editor

> **Trạng thái:** công cụ dev đã chạy được (PR animation viewer). Không đổi [00 §3–4](00-ho-so-tong-hop.md), D1–D30. Kiến trúc client: [21 §9](21-kien-truc-client.md); dữ liệu nhân vật: `@vgtd/character` (`getCharacterViewState`, `getAnimationTable`); bảng 13 animation: [03 §3](03-nhan-vat-quai-vat.md).

Trình xem (viewer) là một scene Cocos riêng trong `apps/client-cocos` dành cho họa sĩ/animator: nạp skeleton Spine 4.2, đổi animation, đổi hướng, bật/tắt lớp paperdoll, tua/đổi tốc độ, so sánh hai animation và đo draw call/RAM ngay trong engine (Web, desktop và mobile).

## 1. Chạy viewer

```bash
npm ci                                      # gốc repo
npm run build:web -w client-cocos           # sinh rig thử + build web (cần Cocos Creator 3.8.8, biến COCOS_CREATOR_PATH)
npm run serve -w client-cocos               # http://localhost:7456
# mở:  http://localhost:7456/#viewer
```

Tham số trong phần hash của URL (tất cả tùy chọn, nối bằng `&`):

| Tham số                | Ý nghĩa                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `viewer`               | Bắt buộc: mở scene Viewer thay vì demo thế giới                                                                                    |
| `anim=attack`          | Animation của A (một trong 13 id: idle, meditate, walk, run, dash, sword_fly, attack, cast, channel, hit, die, tribulation, emote) |
| `animb=cast&compare=1` | Bật chế độ so sánh, B chạy `animb`                                                                                                 |
| `dir=NE`               | Hướng nhìn (8 hướng; 5 hướng vẽ + 3 hướng lật gương, D14)                                                                          |
| `paused=1&t=0.25`      | Dừng và tua tới giây thứ 0,25                                                                                                      |
| `ts=0.5`               | `timeScale`                                                                                                                        |
| `skin=red`             | Skin biến thể                                                                                                                      |
| `off=wing+weapon_R`    | Ẩn các slot (danh sách nối bằng `+`)                                                                                               |
| `src=viewer`           | Thư mục con của `assets/resources/` chứa rig (mặc định `viewer` = rig thử sinh bằng code)                                          |
| `mobile`               | Ép bố cục mobile (bottom sheet) khi test trên desktop                                                                              |

Phím tắt (desktop): `Space` tạm dừng, `←/→` đổi hướng, `↑/↓` đổi animation, `[` `]` đổi tốc độ.

## 2. Các chức năng

- **Animation (13):** bảng nút; `repeat one-shots` lặp các animation không loop để xem liên tục (sự kiện bắn mỗi vòng).
- **Hướng:** la bàn 8 hướng, ô nét đứt là hướng lật gương. Dòng thông tin cho biết viewer đang chạy rig nào và có lật (`scaleX = -1`) không; hộp "drawn in 8" mô phỏng animation vẽ đủ 8 hướng (không lật, D14). Logic chọn rig/lật lấy từ `@vgtd/character` (`resolveDirection`), không tự viết lại.
- **Playback:** Pause/Play, Restart, ±1 frame (1/30 s), thanh tua (tự dừng khi kéo), `timeScale` 0,05–3, `mix` 0–0,5 s (thời gian pha trộn khi đổi animation), `profile` pc/mobile-web/far (hiển thị fps phát Spine 60/30/15 theo bảng; **chưa** giả lập việc giảm tần số cập nhật), thời gian/frame hiện tại theo fps của bảng.
- **Paperdoll:** 13 slot Spine bật/tắt (hai quỹ đạo `orbit_*` là sprite node ngoài skeleton nên không có trong rig), cờ xung đột (mounted, kiếm trong tay, ngự kiếm, mũ trùm, áo dài) áp qua `getCharacterViewState` — slot bị luật ẩn được liệt kê kèm lý do; chọn skin biến thể.
- **Compare:** hai skeleton cạnh nhau (A trái, B phải), chung hướng/lớp/skin/timeScale; nút "Sync restart" cho cả hai chạy lại từ 0.
- **Info:** nhật ký sự kiện Spine (hit, footstep_L/R, vfx_spawn, cancel_window…) kèm thời điểm; kiểm tra thứ tự vẽ: so Draw Order của bảng paperdoll cho hướng đang chọn với thứ tự slot thật của rig (hướng lật gương dùng lại rig của hướng đã vẽ nên có thể lệch vài slot — viewer cảnh báo thay vì che giấu).
- **HUD hiệu năng:** FPS, draw call (so với `BUDGETS.DRAW_CALLS_WEB_MOBILE`), tris, bộ nhớ texture GFX (so với `BUDGETS.TEXTURE_RAM_MB_WEB`), JS heap (`performance.memory`, Chromium), số node.
- **Bố cục:** desktop = thanh bên phải; hẹp (≤ 820 px) hoặc cảm ứng = bottom sheet có tab (Anim / Dir / Play / Layers / Compare / Info), nút ≥ 44 px.

Lỗi nạp rig/ngoại lệ hiện ở dải đỏ trên cùng thanh điều khiển (và `console.error`).

## 3. Rig thử (test rig)

`tools/spine-testrig` (`@vgtd/spine-testrig`) sinh bằng code, không dùng asset bên thứ ba và **không** dùng ví dụ chính thức của Spine (không có giấy phép rõ ràng cho repo này):

- 8 skeleton `rig_<S|SE|E|NE|N|NW|W|SW>.json` (5 hướng vẽ + 3 hướng cho animation vẽ đủ 8), mỗi cái kèm `.atlas` + `.png`. Thứ tự slot khi dựng = bảng Draw Order của hướng đó (`slotsInDrawOrder`).
- 13 slot Spine đúng id `@vgtd/character` (wing, cape, sword_back, hair_back, body, outfit_lower, outfit_upper, head, hair_front, headwear, arm_L, arm_R, weapon_R) với mảnh placeholder đơn giản (mắt/mũi theo hướng nhìn, mũi kiếm đỏ để thấy lật gương).
- 13 animation đúng id, thời lượng = `frames / fps` của bảng, loop theo bảng, khóa 30 fps; chuyển động thủ tục (đủ để phân biệt, không phải animation thật). Sự kiện chuẩn đặt theo bảng (`hit`, `footstep_L/R`, `vfx_spawn`, `cancel_window`); số frame đọc theo chỉ số 0 (`EVENT_FRAME_INDEX_BASE`), mốc `hit_frame`/`windup_end`/`combo_window` là giá trị tạm (45% / 35% / 70% thời lượng).
- 2 skin: `default` (xanh) và `red` (đổi `outfit_upper`, `outfit_lower`, `cape`).
- Atlas theo đúng thiết lập xuất ở §4 (pow2, ≤ 2048, padding 2, premultiplied alpha). Kiểm thử trong `tools/spine-testrig/test` (chạy trong CI).

Sinh lại: `npm run gen -w @vgtd/spine-testrig` (ra `tools/spine-testrig/out/`, không commit); `npm run prepare:assets -w client-cocos` tự chạy và chép vào `assets/resources/viewer/` (không commit).

## 4. Animator xuất từ Spine Editor 4.2 vào viewer

Cần **Spine Editor 4.2.x** (D25; file 3.8 hay 4.1 không nạp được) với giấy phép hợp lệ ([21 §9](21-kien-truc-client.md)).

**Đặt tên (bắt buộc để `@vgtd/character` khớp):**

- Slot: đúng 13 id ở §3 (phân biệt hoa thường). `orbit_back`/`orbit_front` không nằm trong skeleton.
- Animation: đúng 13 id ở §3; thời lượng = `frames / fps` của bảng (xem `getAnimationTable()`), khóa ở 30 fps.
- Sự kiện: `hit`, `vfx_spawn`, `sfx`, `footstep_L`, `footstep_R`, `cancel_window` (tên chuẩn).
- Một skeleton cho **mỗi hướng vẽ**: S, SE, E, NE, N; thêm SW, W, NW chỉ khi có animation vẽ đủ 8 hướng. Gốc (root) tại chân nhân vật, trục y hướng lên; socket theo trục pivot y-lên ([21 §8](21-kien-truc-client.md), F-02).
- Tên file: `rig_<HƯỚNG>.json` (hoặc `.skel` nhị phân) + `rig_<HƯỚNG>.atlas` + `rig_<HƯỚNG>.png` cùng thư mục.

**Xuất dữ liệu (Export → JSON hoặc Binary):** phiên bản 4.2.x, bỏ "Nonessential data" khi build phát hành.

**Đóng gói atlas (Texture Packer trong Spine):**

| Thiết lập          | Giá trị                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Premultiply alpha  | **Bật** (atlas ghi `pma:true`; Cocos `Skeleton.premultipliedAlpha = true`)                       |
| Power of two       | **Bật**                                                                                          |
| Max width / height | **2048** (= `BUDGETS.ATLAS_MAX_WEB_MOBILE`; xem [06 §4](06-toi-uu-render.md) cho quy tắc repack) |
| Padding X/Y        | **2** (= `BUDGETS.ATLAS_PADDING_PX`), bật "Bleed"/"Edge padding"                                 |
| Rotation           | Tắt                                                                                              |
| Filter             | Linear / Linear, không mipmap                                                                    |

**Đưa vào viewer:**

1. Chép các file vào `apps/client-cocos/assets/resources/<thư-mục-của-bạn>/` (ví dụ `viewer-anim`); không dùng `viewer/` vì thư mục đó bị `prepare:assets` ghi đè.
2. Chạy `npm run build:web -w client-cocos` (hoặc mở dự án bằng Cocos Creator 3.8.8 để import), rồi `npm run serve -w client-cocos`.
3. Mở `http://localhost:7456/#viewer&src=viewer-anim`. Thiếu rig của một hướng → dải đỏ báo `rig_<HƯỚNG>`.
4. Kiểm tra: đủ 13 animation chạy đúng thời lượng, sự kiện bắn đúng mốc (Info), thứ tự vẽ khớp bảng (Info), bộ nhớ texture và draw call trong ngân sách.

## 5. Giới hạn đã biết

- Viewer là công cụ Web; bảng điều khiển là DOM phủ lên canvas, không phải UI Cocos (đủ cho animator, không dùng cho game).
- Chưa áp `playbackFps` (60/30/15) lên Spine; chưa giả lập repack texture (≤ 2 draw call/nhân vật) — rig thử có một atlas mỗi hướng.
- Thứ tự vẽ lấy từ rig của hướng đã vẽ (setup order); chưa đặt lại Draw Order cho hướng lật gương lúc chạy.
- Chưa thử trên thiết bị thật (chỉ trình duyệt desktop; bố cục mobile ép bằng `#mobile`).
