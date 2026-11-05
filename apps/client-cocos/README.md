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

Tham số debug: `?input=touch|pointer` ép chế độ nhập; `#autotest` (hoặc `#autotest=dx,dy`) mô phỏng một cú click vào (tâm màn hình + dx,dy px) và in tọa độ nhân vật lên HUD.

## Cấu trúc

| Đường dẫn                       | Nội dung                                                                                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/scenes/Bootstrap.scene` | Scene duy nhất: Canvas + Camera + component `Bootstrap`. Mọi thứ khác dựng bằng code lúc chạy.                                                                                                                                                  |
| `assets/scripts/`               | `Bootstrap` (lắp ráp), `IsoAdapter` (**nơi duy nhất lật trục y**), `WorldView` (tilemap L0), `YSortLayer` (L3), `Actors` (nhân vật, vật thể), `CameraRig`, `InputBridge` (InputManager + AnchorLayout + joystick), `PerfHud`, `PlaceholderArt`. |
| `assets/scripts/vendor/`        | **Sinh ra, không commit**: `vgtd.mjs` bundle của `@vgtd/shared` + `@vgtd/client-core`.                                                                                                                                                          |
| `assets/resources/world/`       | **Sinh ra, không commit**: bản sao tilemap procgen.                                                                                                                                                                                             |
| `vendor-src/`                   | Điểm vào esbuild (`entry.ts`, `shared-subset.ts`).                                                                                                                                                                                              |
| `settings/`                     | Cài đặt dự án (engine modules, trong đó **Spine 4.2**).                                                                                                                                                                                         |
| `build-config.json`             | Tùy chọn build headless.                                                                                                                                                                                                                        |

Xem thêm `.claude/skills/cocos-creator/SKILL.md` (quy ước) và mục "Đề xuất chờ xác nhận" trong `docs/DECISIONS.md` (Spine 4.2, cách nạp `@vgtd/*`).

## Điểm nối cho các task sau

- `WorldView` thay bằng chunk streaming của `client-world`; giữ hợp đồng `isTerrainWalkable(i, j)`.
- `PlayerActor.body` thay bằng paperdoll/Spine của `character`; giữ `pos` (tọa độ ô liên tục) và `update(dt, frame)`.
- `YSortLayer.add(node, depth)` là chỗ đăng ký mọi vật thể L3 (quái, NPC, người chơi khác).
- `CameraRig.follow()` / `clientToWorld()` là giao diện camera cho client-core.
