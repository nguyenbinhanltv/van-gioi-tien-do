# Vạn Giới Tiên Đồ

MMORPG tu tiên 2D isometric. Client: Cocos Creator 3.x (TypeScript). Server MVP: TypeScript (Node).

## Cấu trúc monorepo

npm workspaces (`packages/*`, `apps/*`, `tools/*`), Node ≥ 18, TypeScript strict, kiểm thử bằng vitest.

```
packages/shared         Kiểu/hằng số/giao thức dùng chung client ↔ server (@vgtd/shared)
packages/client-core    Input Abstraction Layer + HUD responsive, không phụ thuộc engine (@vgtd/client-core)
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
