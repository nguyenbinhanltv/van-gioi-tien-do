# apps/client-cocos

Dự án **Cocos Creator 3.8.8** (2D, TypeScript, Web trước). Lát cắt dọc offline (P1-4): tilemap do `@vgtd/procgen` sinh, nhân vật placeholder click-to-move / joystick, camera follow, Y-sort L3, HUD hiệu năng.

Logic không phụ thuộc engine nằm ngoài dự án này: hằng số, toán iso, công thức ở `packages/shared` (`@vgtd/shared`); input, A\*, bố cục ở `packages/client-core` (`@vgtd/client-core`). Dự án Cocos chỉ chứa phần dán vào engine.

## Chạy

```bash
npm ci                                   # ở gốc repo
npm run build:web -w client-cocos        # build headless -> apps/client-cocos/build/web-mobile
npm run serve -w client-cocos            # http://localhost:7456
```

- Editor: biến môi trường `COCOS_CREATOR_PATH` (đường dẫn tới file thực thi CocosCreator). Mặc định `C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe`.
- `build:web` tự chạy `prepare:assets` (bundle `@vgtd/*` + sao chép tilemap từ `tools/procgen/out/tilemap`, sinh bằng `npm run gen:tilemap -w @vgtd/procgen` nếu chưa có). Muốn mở bằng Cocos Creator GUI thì chạy `npm run prepare:assets -w client-cocos` trước.
- `--release` (`npm run build:web -w client-cocos -- --release`) build không debug.
- Không chạy được trên CI (CI không có Cocos). `npm run typecheck -w client-cocos` chỉ chạy khi đã có `temp/` (sau lần build đầu), còn lại bỏ qua.

Trình xem animation DragonBones: `#viewer` (xem [docs/32-animation-viewer.md](../../docs/32-animation-viewer.md)); chụp QA tự động: `npm run capture -w client-cocos`.

## Chơi thử nhân vật chibi (play-test)

`PlayerActor.body` là armature DragonBones semi-chibi (`assets/scripts/ChibiBody.ts`, tài nguyên `assets/resources/dragonbones/<lớp>-chibi-v1/`), phát đúng 24 Hz như file SKE đã xuất.

```bash
npm run build:web -w client-cocos
npm run serve -w client-cocos     # mở http://localhost:7456/?class=phap-tu
```

- **Lớp**: tham số URL `?class=the-tu|phap-tu|dan-phu-tu|dao-tu|kiem-tu|thuong-tu` (mặc định `the-tu`), hoặc phím số **1-6** (theo thứ tự trên) để đổi ngay trong game.
- **Di chuyển**: click-to-move, WASD hoặc joystick cảm ứng như trước. Clip theo tốc độ thực: `idle` dưới 0,3 ô/s, `walk` dưới 3,2 ô/s, `run` từ 3,2 ô/s. WASD/click đi tối đa nên ra `run`; giữ **Shift** để đi bộ (tốc độ ×0,5). Ngưỡng và hệ số đi bộ là **placeholder chỉ để play-test**, chờ thiết kế (docs/OPEN-ITEMS.md mục 15).
- **Hướng**: 8 hướng từ vector di chuyển (`directionFromTileVector`); 5 hướng vẽ E/SE/S/NE/N, W/SW/NW là bản lật của E/SE/NE (D14). Hướng nào chưa merge thì dùng hướng gần nhất (bước 45°, ưu tiên bản không lật) và HUD ghi `facing X -> nearest Y`. Các hướng đang có của lớp hiện tại hiện trên HUD (`chibi <lớp> [E/SE/S]`); khi merge thêm rig, game tự nhận (dò `resources`, không cần sửa code).
- Y-sort L3, camera follow và `pos` (tọa độ ô liên tục) giữ nguyên.

Chụp headless (cần Chrome/Edge, `CHROME_PATH` nếu không ở vị trí mặc định): `npm run capture:play -w client-cocos -- --class the-tu --dirs E,SE,S,NE [--skip-build] [--out <thư mục>]` mở scene với đầu vào kịch bản `#chibiwalk=E,SE,S,NE` (1,5 s mỗi hướng), chụp mỗi 0,75 s, in hướng/clip/vị trí từng ảnh, ghi `contact.png`, và thoát mã 1 nếu có lỗi trang hoặc nhân vật không di chuyển.

Tham số debug: `?input=touch|pointer` ép chế độ nhập; `#autotest` (hoặc `#autotest=dx,dy`) mô phỏng một cú click vào (tâm màn hình + dx,dy px) và in tọa độ nhân vật lên HUD.

## Cấu trúc

| Đường dẫn                       | Nội dung                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/scenes/Bootstrap.scene` | Scene duy nhất: Canvas + Camera + component `Bootstrap`. Mọi thứ khác dựng bằng code lúc chạy.                                                                                                                                                                                                                        |
| `assets/scripts/`               | `Bootstrap` (lắp ráp), `IsoAdapter` (**nơi duy nhất lật trục y**), `WorldView` (tilemap L0), `YSortLayer` (L3), `Actors` (nhân vật, vật thể), `ChibiBody` (armature chibi: chọn hướng/lật, idle/walk/run, đổi lớp), `CameraRig`, `InputBridge` (InputManager + AnchorLayout + joystick), `PerfHud`, `PlaceholderArt`. |
| `assets/scripts/vendor/`        | **Sinh ra, không commit**: `vgtd.mjs` bundle của `@vgtd/shared` + `@vgtd/client-core`.                                                                                                                                                                                                                                |
| `assets/resources/world/`       | **Sinh ra, không commit**: bản sao tilemap procgen.                                                                                                                                                                                                                                                                   |
| `vendor-src/`                   | Điểm vào esbuild (`entry.ts`, `shared-subset.ts`).                                                                                                                                                                                                                                                                    |
| `settings/`                     | Cài đặt dự án (engine modules, trong đó **DragonBones**).                                                                                                                                                                                                                                                             |
| `build-config.json`             | Tùy chọn build headless.                                                                                                                                                                                                                                                                                              |

Xem thêm `.claude/skills/cocos-creator/SKILL.md` (quy ước), D25 trong `docs/DECISIONS.md` (DragonBones) và I-07 trong `docs/31-bang-quyet-dinh.md` (cách nạp `@vgtd/*` bằng esbuild, chờ xác nhận).

> **Lưu ý CI:** CI không có Cocos nên không chạy `tsc` với typing của engine, không chạy eslint (thư mục này bị loại khỏi lint) và không build. Chỉ `check:yflip` chạy trong `typecheck` trên CI. Tên package là `client-cocos` (không phải `@vgtd/*`) vì trường `name` của `package.json` đồng thời là tên dự án Cocos và quyết định tên thư mục build; tên có dấu `@`/`/` có thể làm hỏng đường dẫn.

## Điểm nối cho các task sau

- `WorldView` thay bằng chunk streaming của `client-world`; giữ hợp đồng `isTerrainWalkable(i, j)`.
- `PlayerActor.body` hiện là armature chibi (`ChibiBody`); paperdoll/trang bị của `character` thay sau; giữ `pos` (tọa độ ô liên tục) và `update(dt, frame)`.
- `YSortLayer.add(node, depth)` là chỗ đăng ký mọi vật thể L3 (quái, NPC, người chơi khác).
- `CameraRig.follow()` / `clientToWorld()` là giao diện camera cho client-core.
