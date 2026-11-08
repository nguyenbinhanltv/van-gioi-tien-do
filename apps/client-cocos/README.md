# apps/client-cocos

Dự án **Cocos Creator 3.8.8** (2D, TypeScript, Web trước). Lát cắt dọc offline (P1-4): tilemap do `@vgtd/procgen` sinh, nhân vật placeholder click-to-move / joystick, camera follow, Y-sort L3, HUD hiệu năng.

Logic không phụ thuộc engine nằm ngoài dự án này: hằng số, toán iso, công thức ở `packages/shared` (`@vgtd/shared`); input, A\*, bố cục ở `packages/client-core` (`@vgtd/client-core`). Dự án Cocos chỉ chứa phần dán vào engine.

## Chạy

```bash
npm ci                                   # ở gốc repo
npm run build:web -w client-cocos        # build headless -> apps/client-cocos/build/web-mobile
npm run serve -w client-cocos            # http://localhost:8456
```

- Editor: biến môi trường `COCOS_CREATOR_PATH` (đường dẫn tới file thực thi CocosCreator). Mặc định `C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe`.
- `build:web` tự chạy `prepare:assets` (bundle `@vgtd/*` + sao chép tilemap từ `tools/procgen/out/tilemap`, sinh bằng `npm run gen:tilemap -w @vgtd/procgen` nếu chưa có). Muốn mở bằng Cocos Creator GUI thì chạy `npm run prepare:assets -w client-cocos` trước.
- `--release` (`npm run build:web -w client-cocos -- --release`) build không debug.
- Không chạy được trên CI (CI không có Cocos). `npm run typecheck -w client-cocos` chỉ chạy khi đã có `temp/` (sau lần build đầu), còn lại bỏ qua.

**HUD chiến đấu (P3 groundwork, vòng chiến đấu giả lập offline):** mở `/?combat=1` (thêm `&class=kiem-tu|phap-tu|the-tu|dan-phu-tu|dao-tu|thuong-tu`). Thanh kỹ năng 8 ô của lớp (D49, phím 1-8 hoặc chạm / click ô) với vòng cooldown + GCD, thanh HP / MP / khiên, chọn mục tiêu (click kẻ địch, Tab / Shift+Tab, Esc bỏ chọn), số sát thương bay. Logic nằm trong `packages/client-combat` (có test); mọi con số của vòng giả lập là placeholder, không phải luật chiến đấu (xem OPEN-ITEMS). Online (`?online=1&combat=1`): HUD dùng kết quả của server (`ServerCombat`, D75 / D78): cast gửi qua `skill_cast` (điểm ngắm = con trỏ, ghim vào tầm kỹ năng), HP / MP / khiên từ `self.vitals`, quái và HP từ AOI + snapshot; chưa có chọn lớp trên dây nên HUD online luôn là bộ `kiem`. Smoke test headless: `npm run combat:smoke -w client-cocos` (offline mock) và `npm run combat:online -w client-cocos` (build thật + server dev thật với quái và combat: vitals, quái từ AOI, cast khứ hồi). Server dev (`npm run dev -w @vgtd/server`) bật `MOBS=1` và `COMBAT=1` mặc định.

**Đo hiệu năng P1 trên điện thoại thật qua LAN:** `npm run serve -w client-cocos` in các URL `LAN: http://<IP>:8456/?npcs=20`; mở URL đó trên điện thoại cùng Wi-Fi, số liệu (FPS, draw call, RAM, gói tải) hiện trên HUD. Chi tiết từng bước và cờ URL: [docs/33-p1-perf.md](../../docs/33-p1-perf.md).

Trình xem animation DragonBones: `#viewer` (xem [docs/32-animation-viewer.md](../../docs/32-animation-viewer.md)); chụp QA tự động: `npm run capture -w client-cocos`.

## Chơi thử một lệnh (`npm run play`)

Từ gốc repo: `npm run play` (online, cần game server) hoặc `npm run play -- --offline` (chỉ client). Script build client khi cần, khởi động game server và server tĩnh, đợi `/health`, in URL **Local** / **LAN** (cho điện thoại cùng Wi-Fi; Windows hỏi tường lửa lần đầu: _Allow access_ cho Node.js) và bảng phím; **Ctrl+C** dừng tất cả. Mặc định build bản **release** (nhỏ, không có art dev, nhanh trên điện thoại); `--dev` build bản debug (`npm run build:web` mặc định cũng là debug). Chi tiết và mọi tùy chọn: README gốc, mục "Chơi thử (một lệnh)".

## Chơi thử nhân vật chibi (play-test)

`PlayerActor.body` là armature DragonBones semi-chibi (`assets/scripts/ChibiBody.ts`, tài nguyên `assets/resources/dragonbones/<lớp>-chibi-v1/`), phát đúng 24 Hz như file SKE đã xuất.

```bash
npm run build:web -w client-cocos
npm run serve -w client-cocos     # mở http://localhost:8456/?class=phap-tu
```

- **Lớp**: tham số URL `?class=the-tu|phap-tu|dan-phu-tu|dao-tu|kiem-tu|thuong-tu` (mặc định `the-tu`), hoặc phím số **1-6** (theo thứ tự trên) để đổi ngay trong game.
- **Di chuyển**: click-to-move, WASD hoặc joystick cảm ứng như trước. Clip theo tốc độ thực: `idle` dưới 0,3 ô/s, `walk` dưới 3,2 ô/s, `run` từ 3,2 ô/s. WASD/click đi tối đa nên ra `run`; giữ **Shift** để đi bộ (tốc độ ×0,5). Ngưỡng và hệ số đi bộ là **placeholder chỉ để play-test**, chờ thiết kế (docs/OPEN-ITEMS.md mục 15).
- **Hướng**: 8 hướng từ vector di chuyển (`directionFromTileVector`); 5 hướng vẽ E/SE/S/NE/N, W/SW/NW là bản lật của E/SE/NE (D14). Hướng nào chưa merge thì dùng hướng gần nhất (bước 45°, ưu tiên bản không lật) và HUD ghi `facing X -> nearest Y`. Các hướng đang có của lớp hiện tại hiện trên HUD (`chibi <lớp> [E/SE/S]`); khi merge thêm rig, game tự nhận (dò `resources`, không cần sửa code).
- Y-sort L3, camera follow và `pos` (tọa độ ô liên tục) giữ nguyên.

Chụp headless (cần Chrome/Edge, `CHROME_PATH` nếu không ở vị trí mặc định): `npm run capture:play -w client-cocos -- --class the-tu --dirs E,SE,S,NE [--skip-build] [--out <thư mục>]` mở scene với đầu vào kịch bản `#chibiwalk=E,SE,S,NE` (1,5 s mỗi hướng), chụp mỗi 0,75 s, in hướng/clip/vị trí từng ảnh, ghi `contact.png`, và thoát mã 1 nếu có lỗi trang hoặc nhân vật không di chuyển.

Tham số debug: `?input=touch|pointer` ép chế độ nhập; `#autotest` (hoặc `#autotest=dx,dy`) mô phỏng một cú click vào (tâm màn hình + dx,dy px) và in tọa độ nhân vật lên HUD.

## Chơi online (P2-3): server cục bộ + 2 client trình duyệt

Mặc định client chạy **offline** (như trên). Thêm `?online=1` để nối vào Gateway cục bộ (D27: chỉ chạy local): đăng nhập/đăng ký, dự đoán + đối soát bằng `stepMove` của `@vgtd/sim`, người chơi khác được nội suy từ snapshot và vẽ bằng `ChibiBody`.

```bash
# terminal 1: server (HTTP :8080 + WS /ws, bản đồ 256x256 khớp client, bỏ giới hạn 3 tài khoản/IP/ngày để thử nhiều tab)
REGISTER_PER_IP_PER_DAY=0 npm run dev -w @vgtd/server
# terminal 2: client web
npm run build:web -w client-cocos && npm run serve -w client-cocos
```

Mở **hai** tab/cửa sổ trình duyệt (PowerShell: đặt biến bằng `$env:REGISTER_PER_IP_PER_DAY=0` trước lệnh dev):

- `http://localhost:8456/?online=1&name=alice&class=phap-tu`
- `http://localhost:8456/?online=1&name=bob&class=kiem-tu`

Di chuyển bằng click / WASD / joystick; mỗi tab thấy tab kia chạy (nội suy trễ ~150 ms). HUD ghi `online <tên> | rtt | pending | err | others`: `err` là sai lệch dự đoán so với server (tiệm cận 0 khi trung thực), `others` là số người chơi khác đang thấy.

| Tham số               | Ý nghĩa                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `online=1`            | Bật online (không có = offline, mặc định).                                                                                                                                                                                                                                                          |
| `name=<a-z0-9_ 3-20>` | Tài khoản cố định; mật khẩu sinh ngẫu nhiên và lưu `localStorage` theo tên. Bỏ trống: khách `guest_xxxxxx` theo từng tab (`sessionStorage`).                                                                                                                                                        |
| `server=host:port`    | Mặc định `<host của trang>:8080`; chỉ nhận host của trang hoặc `localhost`/`127.0.0.1` (host khác bị bỏ qua để link lạ không lấy được mật khẩu); mật khẩu lưu theo cặp `server`+tên. Server chỉ cho phép CORS từ `localhost:8456` / `127.0.0.1:8456` (đổi bằng biến môi trường `CORS_ORIGINS=a,b`). |
| `class=<id>`          | Lớp ChibiBody của **mình**. Người khác chưa có lớp trên dây nên lớp của họ suy ra từ `entityId` (docs/OPEN-ITEMS.md, mục P2-3).                                                                                                                                                                     |

Cùng một tên đăng nhập ở hai tab thì tab sau đá tab trước (một kết nối cho mỗi tài khoản). Tài khoản nằm trong bộ nhớ server: khởi động lại server thì đăng ký lại tự động (mật khẩu đã lưu vẫn dùng được). Biến môi trường server: `PORT`, `HOST`, `MAP_TILES` (mặc định 256 ở `npm run dev`, khớp bản đồ client), `SPAWN_SIDE` (cạnh vùng xuất hiện quanh tâm, mặc định 24 ở `npm run dev` để hai tab thấy nhau; server thường dùng 96), `REGISTER_PER_IP_PER_DAY`, `CORS_ORIGINS`.

Logic mạng không phụ thuộc engine nằm ở `packages/client-core/src/net` (`Predictor`, `RemoteWorld`, `NetClient`, có test đơn vị; test đầu-cuối với server thật ở `apps/server/tests/netclient.test.ts`). `OnlineSession.ts` chỉ dán vào scene.

## HUD tu luyện (D76, chỉ online)

Với `?online=1` góc **trên-phải** có bảng tu luyện (300 × 92 đơn vị thiết kế, lề 8 px; thông báo treo ngay dưới): nhãn cảnh giới (vd. `Luyện Khí tầng 3`), thanh tu vi `tuVi / Req(s)` và hai nút. Mọi thứ hiển thị là `char_state` mới nhất của server (model engine-free `ProgressionView` trong `packages/client-core`, có test); client chỉ gửi **ý định** rồi chờ trả lời, không tự đoán tu vi hay kết quả.

- **`M`** (hoặc nút `Đả tọa`): bắt đầu / dừng đả tọa (`meditate_start/stop`). Nhân vật chơi clip `meditate` khi server báo đang ngồi. Server tự ngắt khi nhân vật di chuyển, giao chiến hoặc chết; hết tu vi của tầng thì tự dừng và nút `Đột phá` sáng lên.
- **`N`** (hoặc nút `Đột phá`): xin đột phá (`breakthrough_start`); server tự chọn tiểu cảnh / đại cảnh và roll, toast hiện kết quả. Đại cảnh (tầng 9 Luyện Khí, viên mãn mỗi cảnh giới) hiện bị khóa: toast `Đột phá đại cảnh cần Tâm Ma và Lôi Kiếp, chưa mở ở bản này` cho tới khi hai cơ chế đó có (OPEN-ITEMS 17).
- Bấm nút không kích hoạt click-to-move. Bố cục chung với các bảng khác: thanh kỹ năng ở giữa-dưới, khung mục tiêu giữa-trên, PerfHud trái-trên, bảng này phải-trên (bảng túi đồ nên dùng vùng phải-giữa).
- Dev: đả tọa thật mất ~10 phút cho tầng 1. Để thử nhanh, chạy server với `PROGRESSION_SPEED=400 npm run dev -w @vgtd/server` (nhân tốc độ tích tu vi, **chỉ để dev/test**, mặc định 1).
- Smoke test headless: `npm run progression:online -w client-cocos` (build thật + server dev thật, phím thật: `M` ngồi, thanh tăng, đầy thì tự dừng, `N` lên Luyện Khí tầng 2..9, `D` ngắt đả tọa, đại cảnh bị từ chối) và ghi ảnh `meditating.png`, `breakthrough.png`, `tribulation.png`.

## Cấu trúc

| Đường dẫn                       | Nội dung                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/scenes/Bootstrap.scene` | Scene duy nhất: Canvas + Camera + component `Bootstrap`. Mọi thứ khác dựng bằng code lúc chạy.                                                                                                                                                                                                                                                                                                                                                                        |
| `assets/scripts/`               | `Bootstrap` (lắp ráp), `IsoAdapter` (**nơi duy nhất lật trục y**), `WorldView` (L0 streaming theo chunk), `Npcs` (đám NPC cho perf), `OnlineSession` (nối `NetClient` vào scene, chỉ khi `?online=1`), `ProgressionHud` (bảng tu luyện D76), `YSortLayer` (L3), `Actors` (nhân vật, vật thể), `ChibiBody` (armature chibi: chọn hướng/lật, idle/walk/run, đổi lớp), `CameraRig`, `InputBridge` (InputManager + AnchorLayout + joystick), `PerfHud`, `PlaceholderArt`. |
| `assets/scripts/vendor/`        | **Sinh ra, không commit**: `vgtd.mjs` bundle của `@vgtd/shared` + `@vgtd/client-core` + `@vgtd/client-world`.                                                                                                                                                                                                                                                                                                                                                         |
| `assets/resources/world/`       | **Sinh ra, không commit**: bản sao tilemap procgen.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `vendor-src/`                   | Điểm vào esbuild (`entry.ts`, `shared-subset.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `settings/`                     | Cài đặt dự án (engine modules, trong đó **DragonBones**).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `build-config.json`             | Tùy chọn build headless.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Xem thêm `.claude/skills/cocos-creator/SKILL.md` (quy ước), D25 trong `docs/DECISIONS.md` (DragonBones) và I-07 trong `docs/31-bang-quyet-dinh.md` (cách nạp `@vgtd/*` bằng esbuild, chờ xác nhận).

> **Lưu ý CI:** CI không có Cocos nên không chạy `tsc` với typing của engine, không chạy eslint (thư mục này bị loại khỏi lint) và không build. Chỉ `check:yflip` chạy trong `typecheck` trên CI. Tên package là `client-cocos` (không phải `@vgtd/*`) vì trường `name` của `package.json` đồng thời là tên dự án Cocos và quyết định tên thư mục build; tên có dấu `@`/`/` có thể làm hỏng đường dẫn.

## Điểm nối cho các task sau

- `WorldView` đã dùng chunk streaming của `client-world` (`ChunkStreamer`, tier `?tier=low|medium|high`); hợp đồng `isTerrainWalkable(i, j)` giữ nguyên. Đo hiệu năng P1: `npm run perf:p1 -w client-cocos` ([docs/33-p1-perf.md](../../docs/33-p1-perf.md)); `?npcs=N` sinh NPC đi lang thang (`Npcs.ts`, thân `ChibiBody` nhiều lớp).
- `PlayerActor.body` hiện là armature chibi (`ChibiBody`); paperdoll/trang bị của `character` thay sau; giữ `pos` (tọa độ ô liên tục) và `update(dt, frame)`.
- `YSortLayer.add(node, depth)` là chỗ đăng ký mọi vật thể L3 (quái, NPC, người chơi khác).
- `CameraRig.follow()` / `clientToWorld()` là giao diện camera cho client-core.

## Tải chibi theo bundle (D71)

`npm run prepare:assets` (chạy trong `build:web`) sinh `assets/chibi/` (git-ignored) từ bản xuất `assets/resources/dragonbones/<lớp>-chibi-v1` (không đổi): mỗi (lớp, hướng) là một Asset Bundle `chibi-<lớp>-<hướng>` với hai tier (`full`, `1x` Lanczos3) và hai nhóm clip (`loco` = idle/walk/run, `rest`), cùng `resources/world/chibi-index.json`. Preset nén texture (ASTC 4x4 cho `1x`, ASTC 6x6 cho `full`, WebP dự phòng) nằm ở `settings/v2/packages/builder.json`, gắn vào từng PNG qua `.meta` do `scripts/chibi-bundles.mjs` ghi. `ChibiAssets.ts` nạp bundle, giới hạn tải đồng thời và giữ việc nền (NPC, hướng khác) đến khi người chơi đã hiện hình. `?restier=1x|full` ép tier (mặc định: `full` cho người chơi cục bộ trên desktop, `1x` cho mọi thứ còn lại). Ổ C: đầy thì đặt `library/`, `temp/`, `build/`, `assets/chibi/` thành junction sang ổ khác (đều git-ignored).

## Bản release không có art dev

`npm run build:web -w client-cocos -- --release` build trên **bản stage** của dự án (`scripts/release-stage.mjs`): mọi thứ được sao chép nguyên văn (kể cả `.meta`, giữ nguyên uuid) trừ `assets/resources/dragonbones/**` (≈ 229 MB: art trình xem và bản xuất chibi nguồn). Stage mặc định ở `build/stage-release` (đổi bằng biến môi trường `VGTD_STAGE_DIR`, nên đặt sang ổ còn trống); đồng bộ tăng dần theo kích thước + mtime nên Library của stage được giữ giữa các lần build. Kết quả vẫn ghi vào `build/web-mobile`. Trình xem (`#viewer`) không chạy được trên bản release; thêm `--keep-dev-art` để build đủ. Bản không `--release` vẫn build cả dự án.

## Bảng túi đồ (D79)

Phím **B** bật/tắt bảng túi (`assets/scripts/BagPanel.ts`): lưới 8×5, ví Linh thạch hạ/trung/thượng, nhấn một vật rồi nhấn ô khác để chuyển / hoán đổi / gộp, nút "Claim loot" khi có hàng chờ. Online (`?online=1`) bảng hiện túi thật của server (`net.bag`, thông điệp `inv_state`/`inv_cmd`/`inv_result`); máy chủ dev (`npm run dev -w @vgtd/server`) bật sẵn `INVENTORY=1` nên giết quái online làm túi đầy. Kiểm tra bằng client thật: `npm run bag:smoke -w client-cocos` (build + server dev thật: giết quái → túi cập nhật; chạm trên giả lập di động 360x640 / 390x844 / 844x390; không chạy trong CI). Bố cục / kích thước bảng: `bagPanelPlacement` trong client-core. `#bagdemo` (không cần server) hiện túi mẫu cục bộ để kiểm tra giao diện / chụp headless. Hình tạm: ô màu + mã ngắn + thanh phẩm chất; chưa có art vật phẩm. Logic bố cục / chọn ô nằm ở `packages/client-core/src/ui/BagPanelLogic.ts` (có test).
