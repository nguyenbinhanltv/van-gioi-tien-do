# Vạn Giới Tiên Đồ

MMORPG tu tiên 2D isometric. Client: Cocos Creator 3.x (TypeScript). Server MVP: TypeScript (Node).

## Cấu trúc monorepo

npm workspaces (`packages/*`, `apps/*`, `tools/*`), Node ≥ 18, TypeScript strict, kiểm thử bằng vitest.

```
packages/shared         Kiểu/hằng số/giao thức dùng chung client ↔ server (@vgtd/shared)
packages/client-core    Input Abstraction Layer + HUD responsive, không phụ thuộc engine (@vgtd/client-core)
packages/client-combat  Hotbar kỹ năng lớp + cooldown / GCD, chọn mục tiêu, vòng chiến đấu mô phỏng offline cho HUD chiến đấu, không phụ thuộc engine (@vgtd/client-combat)
packages/client-world   Chunk streaming, draw order L0-L7, occlusion, loader map procgen, không phụ thuộc engine (@vgtd/client-world)
packages/character      Hướng, paperdoll, bảng animation, footprint/socket/hitbox, boss, schema định nghĩa nhân vật (@vgtd/character)
apps/client-cocos       Dự án Cocos Creator 3.x (placeholder)
apps/server             Server MVP TypeScript (placeholder)
tools/procgen           Sinh asset bằng code (tilemap, icon, ...)
tools/dragonbones-testrig Sinh rig thử DragonBones 5.5 cho trình xem animation (@vgtd/dragonbones-testrig)
tools/sprite              Pipeline sprite sheet AI từng khung cho thân Player (D41) (@vgtd/sprite)
docs/                   Tài liệu thiết kế
```

Mỗi package có `package.json` riêng (tên `@vgtd/<name>`), `tsconfig.json` kế thừa `../../tsconfig.base.json`, và script `build` / `test` / `typecheck`.

## Chơi thử (một lệnh)

```bash
npm ci                 # một lần (script chỉ cảnh báo nếu thiếu / cũ, không tự chạy)
npm run play           # online: game server (quái, combat, túi đồ) + client, in URL Local và LAN
npm run play -- --offline   # chỉ client, không cần game server (quái giả lập: ?combat=1)
```

`npm run play` kiểm tra Node ≥ 18, thư viện đã cài và Cocos Creator 3.8.8 (`COCOS_CREATOR_PATH` hoặc đường dẫn mặc định trên Windows), **chỉ build client khi cần** (chưa có bản build, mã nguồn mới hơn bản build, hoặc đổi loại build; `--rebuild` ép build), khởi động game server (`apps/server`, `MOBS`/`COMBAT`/`INVENTORY` bật) và server tĩnh của client (cổng 8456), đợi `/health` rồi in:

- `Local:` `http://localhost:8456/?online=1&combat=1` cho máy đang chạy;
- `LAN:` một dòng cho mỗi card mạng, để **điện thoại cùng Wi-Fi** mở (lần đầu Windows hỏi tường lửa: chọn _Allow access_ cho Node.js, mạng Private);
- URL offline và bảng phím điều khiển (click/WASD, Shift đi bộ, phím 1-8 kỹ năng, Tab chọn mục tiêu, …).

Nhấn **Ctrl+C** để dừng: cả hai tiến trình (và game server con của nó) bị dừng, cổng được giải phóng.

| Tùy chọn                   | Ý nghĩa                                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--offline`                | chỉ client, không game server                                                                                                                                                                                                                                                             |
| `--rebuild`                | ép build client                                                                                                                                                                                                                                                                           |
| `--dev`                    | build bản debug (có art dev của trình xem animation, nặng hơn ~230 MB). Mặc định là bản **release**: nhỏ, không có art dev, tải nhanh hơn nhiều trên điện thoại                                                                                                                           |
| `--open`                   | mở trình duyệt mặc định                                                                                                                                                                                                                                                                   |
| `--no-lan`                 | game server chỉ nghe 127.0.0.1 (mặc định nghe mọi card mạng để điện thoại vào được; chỉ dùng trong mạng tin cậy, tài khoản chơi thử là tài khoản tạm)                                                                                                                                     |
| `--port` / `--server-port` | cổng client (mặc định **8456**; **không dùng 7456** vì đó là server preview của chính Cocos Creator) / game server (8080). Cổng **mặc định** đang bận thì tự chọn cổng trống kế tiếp và URL in ra là cổng thật (cổng khác 8080 thêm `&server=host:cổng`); cổng bạn chỉ định mà bận là lỗi |
| `--smoke`                  | khởi động, đợi khỏe mạnh, in URL rồi dừng (kiểm tra môi trường)                                                                                                                                                                                                                           |

Log build đầy đủ của Cocos nằm ở `apps/client-cocos/build/play-build.log` (console chỉ hiện lỗi, cảnh báo và kết quả).

## Lệnh

```bash
npm ci               # cài đặt
npm run typecheck    # tsc --noEmit ở mọi workspace
npm test             # vitest ở mọi workspace
npm run build        # build mọi workspace
npm run lint         # eslint
npm run format       # prettier
```

Các lệnh dùng `--workspaces --if-present`, nên workspace chưa có script hoặc chưa tồn tại sẽ bị bỏ qua.

CI: `.github/workflows/ci.yml` chạy `npm ci`, typecheck, test, build, lint trên Node 18 và 22.
