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

Tham số debug: `?input=touch|pointer` ép chế độ nhập; `#autotest` (hoặc `#autotest=dx,dy`) mô phỏng một cú click vào (tâm màn hình + dx,dy px) và in tọa độ nhân vật lên HUD.

## Cấu trúc

| Đường dẫn                       | Nội dung                                                                                                                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/scenes/Bootstrap.scene` | Scene duy nhất: Canvas + Camera + component `Bootstrap`. Mọi thứ khác dựng bằng code lúc chạy.                                                                                                                                                                                          |
| `assets/scripts/`               | `Bootstrap` (lắp ráp), `IsoAdapter` (**nơi duy nhất lật trục y**), `WorldView` (L0 streaming theo chunk), `Npcs` (đám NPC cho perf), `YSortLayer` (L3), `Actors` (nhân vật, vật thể), `CameraRig`, `InputBridge` (InputManager + AnchorLayout + joystick), `PerfHud`, `PlaceholderArt`. |
| `assets/scripts/vendor/`        | **Sinh ra, không commit**: `vgtd.mjs` bundle của `@vgtd/shared` + `@vgtd/client-core` + `@vgtd/client-world`.                                                                                                                                                                           |
| `assets/resources/world/`       | **Sinh ra, không commit**: bản sao tilemap procgen.                                                                                                                                                                                                                                     |
| `vendor-src/`                   | Điểm vào esbuild (`entry.ts`, `shared-subset.ts`).                                                                                                                                                                                                                                      |
| `settings/`                     | Cài đặt dự án (engine modules, trong đó **DragonBones**).                                                                                                                                                                                                                               |
| `build-config.json`             | Tùy chọn build headless.                                                                                                                                                                                                                                                                |

Xem thêm `.claude/skills/cocos-creator/SKILL.md` (quy ước), D25 trong `docs/DECISIONS.md` (DragonBones) và I-07 trong `docs/31-bang-quyet-dinh.md` (cách nạp `@vgtd/*` bằng esbuild, chờ xác nhận).

> **Lưu ý CI:** CI không có Cocos nên không chạy `tsc` với typing của engine, không chạy eslint (thư mục này bị loại khỏi lint) và không build. Chỉ `check:yflip` chạy trong `typecheck` trên CI. Tên package là `client-cocos` (không phải `@vgtd/*`) vì trường `name` của `package.json` đồng thời là tên dự án Cocos và quyết định tên thư mục build; tên có dấu `@`/`/` có thể làm hỏng đường dẫn.

## Điểm nối cho các task sau

- `WorldView` đã dùng chunk streaming của `client-world` (`ChunkStreamer`, tier `?tier=low|medium|high`); hợp đồng `isTerrainWalkable(i, j)` giữ nguyên. Đo hiệu năng P1: `npm run perf:p1 -w client-cocos` ([docs/33-p1-perf.md](../../docs/33-p1-perf.md)); `?npcs=N` sinh NPC đi lang thang (`Npcs.ts`, thay thân bằng `ChibiBody` qua `NpcBodyFactory`).
- `PlayerActor.body` thay bằng paperdoll/armature DragonBones của `character`; giữ `pos` (tọa độ ô liên tục) và `update(dt, frame)`.
- `YSortLayer.add(node, depth)` là chỗ đăng ký mọi vật thể L3 (quái, NPC, người chơi khác).
- `CameraRig.follow()` / `clientToWorld()` là giao diện camera cho client-core.
