# @vgtd/procgen – sinh asset Tu Tiên 2D Isometric bằng code

Nhập từ gói `tutien-procgen` (xem "Hồ sơ tổng hợp", mục 6) + `orchestrator_pipeline.yaml`. Toàn bộ asset do script Node thuần (không bắt buộc thư viện ngoài) và shader GLSL ES 1.0 tạo ra; **cùng seed → cùng asset**, nên chỉ commit seed, không commit ảnh. Thư mục `out/`, `build/`, `reports/`, `preview/` nằm trong `.gitignore`.

Yêu cầu: Node ≥ 18. Chạy từ `tools/procgen/` (hoặc `npm run <script> -w @vgtd/procgen` từ gốc monorepo).

```bash
npm install            # cài vitest + (tùy chọn) @resvg/resvg-js, gl
npm run gen            # = gen:tilemap + gen:items  -> out/
npm run render         # shader compile + SVG→PNG (bỏ qua bước thiếu công cụ)
npm run validate       # cổng QA xác định -> out/reports/qa_raw.json
npm run pack           # atlas icon 48/64/128 + phi kiếm + tileset -> build/atlas
npm run compress       # nhánh PC (copy PNG); xem dưới cho web/android/ios
npm run smoke [-- web] # chạy cả chuỗi trên, bản Node của pipeline/local_smoke.sh
npm test               # vitest
```

| Script | Việc làm |
| --- | --- |
| `gen:tilemap` | `src/tilemap/generate_tilemap.js`: Simplex fBm → Wang theo góc 3 chất liệu → `tileset.png` (40 tile) + `tileset.json` + `map.json` + `map_preview.png`. Mặc định tile 128 × 64 (@2x); thêm `--tileW 64` cho 64 × 32 (@1x). Tham số: `--seed --width --height --noiseScale --waterLevel --grassLevel`. |
| `gen:items` | `src/items/generate_items.js`: phi kiếm 8 hướng × 2 phẩm, 3 đan dược, 6 phù lục — chỉ ra **SVG** (+ `flying_sword_frames.json` chứa pivot). |
| `render` | `pipeline/render_layers.js`: biên dịch `shaders/*` bằng `glslangValidator`; SVG → PNG bằng `@resvg/resvg-js`; chụp shader (Linux + xvfb + `gl`). Ghi `out/render/render_manifest.json`. |
| `validate` | `pipeline/validate_assets.js`: kiểm tỷ lệ 2:1, kích thước tile (64/128), atlas ≤ 2048 lũy thừa 2, khớp manifest, mặt nạ Wang 1..14, id tile hợp lệ, không có lỗ trên bản đồ, pivot phi kiếm, kích thước icon. Mã thoát 0 đạt · 10 chỉ cảnh báo · 20 lỗi (script npm dùng `--allow-warnings` nên cảnh báo trả 0). |
| `pack` | `scripts/pack_all.js` gọi `pipeline/pack_atlas.js`: shelf-pack, padding 2 + extrude, trang lũy thừa 2 ≤ 2048. |
| `compress` | `pipeline/compress_textures.js <web\|android\|ios\|pc> <atlas> <out>`: web → KTX2 (basisu) + WebP (cwebp); android/ios → ASTC (astcenc); pc → PNG. **Thiếu công cụ thì in thông báo rõ ràng, ghi `compress_manifest.json` có `skipped:true` và thoát 0** (thêm `--strict` để thoát 3). |
| `smoke` | `scripts/smoke.js`: gen → render → validate → pack → validate packed → compress. Bản Node, chạy trên Windows không cần bash. |

Bản gốc `pipeline/*.sh` (`local_smoke.sh`, `render_layers.sh`, `compress_textures.sh`) được giữ nguyên cho runner Linux/CI mà `orchestrator_pipeline.yaml` gọi; bản `.js` là bản tương đương cho đa nền tảng (và thân thiện hơn khi thiếu công cụ). `build` / `typecheck` chỉ kiểm cú pháp mọi file `.js` (gói là JavaScript thuần, không có bước biên dịch); `tsconfig.json` có sẵn cho đúng quy ước monorepo (cần `tsconfig.base.json` ở gốc).

## Asset budget gate và CI (`.github/workflows/assets.yml`)

`npm run budget` (`pipeline/budget_gate.mts`, logic ở `src/budget/check.mts`, chạy bằng `tsx`) đọc `build/atlas` (đầu ra của `npm run pack`) và **thoát 20** nếu:

- trang atlas không phải lũy thừa 2, hoặc lớn hơn trần (`BUDGETS.ATLAS_MAX_WEB_MOBILE` = 2048; 4096 chỉ cho atlas map PC, tên bắt đầu `atl_map`, `--platform pc`);
- thiếu padding (JSON khai báo < `BUDGETS.ATLAS_PADDING_PX` = 2, frame cách mép trang hoặc cách nhau không đủ chỗ) hoặc **thiếu extrude** (đọc pixel: viền 1 px quanh frame phải lặp lại pixel mép; cùng quy tắc `pack_atlas.js`);
- atlas icon không phải `atl_icon_48/64/128` hoặc frame không vuông đúng cỡ;
- tile không phải 64 × 32 (@1x) / 128 × 64 (@2x) (`TILE_WIDTH`/`TILE_HEIGHT` của `@vgtd/shared`);
- **gói tải đầu (Web) ước tính > `BUDGETS.INITIAL_DOWNLOAD_MB_WEB` = 25 MB**.

Ước tính = dung lượng asset + phần không phải asset của gói đầu (engine+code 6 MB, audio 1 MB, dự phòng 2 MB, lấy từ bảng ở `docs/02`; hằng này nằm trong `check.mts` vì `@vgtd/shared` chưa có; đổi bằng `--reservedMb`). Asset tính theo `build/dist/web/*.{ktx2,webp,astc}` nếu có; không có (thiếu `basisu`/`cwebp`/`astcenc`) thì dùng PNG đã đóng gói làm **cận trên** và báo cảnh báo `NOT_COMPRESSED`. Hằng số chưa có trong `@vgtd/shared` (cỡ icon 48/64/128, extrude ≥ 1 px) cũng khai báo cục bộ, ghi rõ nguồn doc. Báo cáo Markdown in ra và ghi vào `$GITHUB_STEP_SUMMARY`. `--no-pixels` bỏ kiểm extrude; `--platform web|mobile|pc`; ngân sách 25 MB chỉ áp dụng cho `web`.

Workflow `assets.yml` (Node 22, chỉ khi đổi `tools/procgen/**`, `packages/shared/src/constants.ts` hoặc chính workflow): `npm ci` → `gen:tilemap` → `gen:items` → `render` (SVG→PNG; bỏ qua shader/snapshot vì không cài `glslangValidator`/Xvfb) → `validate` → `pack` → `compress:web` (tự bỏ qua nếu thiếu công cụ) → `budget`. Không có bước AI, không deploy. Job `assets` độc lập với `verify (18)/(22)` (không đổi `ci.yml`); `npm test` ở `verify` chạy test của gate.

## Cài công cụ tùy chọn

Không có công cụ nào dưới đây bắt buộc để chạy `gen`/`validate`/`pack`/`smoke` nhánh PC.

| Công cụ | Dùng cho | Cài |
| --- | --- | --- |
| `@resvg/resvg-js` | SVG → PNG (**cần cho `pack`**) | `npm install` (đã là optionalDependency, có bản build sẵn cho Windows/macOS/Linux) |
| `glslangValidator` | biên dịch shader | Windows: `choco install glslang` hoặc `winget install KhronosGroup.glslang` hoặc tải từ github.com/KhronosGroup/glslang/releases; Ubuntu: `apt install glslang-tools`; macOS: `brew install glslang` |
| `basisu` | KTX2 cho Web | build từ github.com/BinomialLLC/basis_universal (CMake) hoặc tải release; để trong `PATH` |
| `cwebp` | WebP dự phòng cho Web | `apt install webp` · `brew install webp` · `choco install webp` |
| `astcenc` | ASTC cho Android/iOS | release tại github.com/ARM-software/astc-encoder; tên mặc định `astcenc-avx2`, đổi bằng biến `ASTCENC=astcenc-sse4.1` |
| `xvfb` + `gl` | chụp shader trong CI (Linux) | `apt install xvfb libgl1-mesa-dri` rồi `npm i gl` |

## Đã kiểm chứng (Windows 11, Node 24, Git Bash)

- `npm run gen` — tilemap 32 × 32 (≈ 0,6 s) và items chạy đạt; `--tileW 64` cũng chạy.
- `npm run render` — SVG → PNG bằng resvg đạt.
- `npm run validate` — `0 lỗi`; cảnh báo duy nhất là shader chưa biên dịch / chưa chụp (thiếu công cụ, xem dưới).
- `npm run pack` — 3 atlas icon (48/64/128), 2 atlas phi kiếm (blue/gold), đều ≤ 2048 và lũy thừa 2; `validate --stage packed` → PASS.
- `npm run smoke` (nhánh `pc`) — đạt trọn bước 1–4, ra `build/dist/pc` (≈ 470 KB). `smoke web` chạy hết và bỏ qua nén với thông báo.
- `npm test` — 13 test vitest: tile 64 × 32 @1x / 128 × 64 @2x và tỷ lệ 2:1; hình dạng `tileset.json`/`map.json`; Wang (đủ mặt nạ 1..14 khác nhau, tile trên bản đồ 64 × 64 khớp mặt nạ tính từ 4 góc); xác định theo seed (cùng seed → trùng từng byte `tileset.png`, khác seed → khác địa hình); phi kiếm 8 hướng + pivot; 3 đan dược + 6 phù lục.
- `bash pipeline/local_smoke.sh` (bản gốc) trên máy này dừng ở bước 2 vì thiếu `glslangValidator` (đúng thiết kế, mã thoát 3).

## Chưa kiểm chứng

- **Biên dịch shader** (`glslangValidator` không có trên máy này) và **ảnh chụp shader** (cần Linux + Xvfb + `gl`): shader `loi_kiep.frag`, `kim_quang.frag` và 2 vertex shader được nhập nguyên văn; hồ sơ tổng hợp ghi đã qua glslang ở môi trường gốc, ở đây chưa chạy lại.
- **Nén KTX2 / ASTC**: `basisu`, `cwebp`, `astcenc` không có ở đây — nhánh web/android/ios của `compress` mới chỉ được thử ở đường "thiếu công cụ → bỏ qua". Ngân sách atlas Core Web (6144 KB) chưa được đo trên đầu ra thật.
- **Các bước AI** trong `orchestrator_pipeline.yaml` (Codex sửa generator, Antigravity render, Claude Code QA) — cần khóa/tài khoản trên runner; chỉ nhập file và prompt (`pipeline/prompts/`), chưa gọi.
- **Deploy** (tạo PR sang repo client) và **schema thật của `orchestrator.inc`**: YAML chỉ là bản thiết kế theo schema giả định; `workdir: ${workspace}/tutien-procgen` trong đó vẫn trỏ về cấu trúc gói gốc, cần đổi thành `tools/procgen` khi ánh xạ.
- Chưa chạy `shader_snapshot.js`, `preview/shader_preview.html` (`npm run preview` tạo ra) trên trình duyệt/GPU thật; chưa nạp tileset vào Cocos Creator.

## Lưu ý bảo mật (trước khi chạy `orchestrator_pipeline.yaml` trên runner thật)

Rà soát tự động đã chỉ ra rủi ro trong YAML (nhập nguyên văn, chưa từng chạy):

- Bước 2 gọi `agy ... --dangerously-skip-permissions`: agent chạy không bị chặn quyền, có thể đọc/ghi/thực thi tùy ý trong runner.
- `secrets: [ANTHROPIC_API_KEY, CODEX_API_KEY, GIT_PUSH_TOKEN, SLACK_WEBHOOK_URL]` khai báo ở cấp pipeline nên mọi task, kể cả bước render do agent điều khiển, đều thấy `GIT_PUSH_TOKEN` và webhook.

Cần xử lý **trước khi bật bước này**: bỏ `--dangerously-skip-permissions` và cho agy allowlist lệnh (chỉ `bash pipeline/render_layers.sh` / `node pipeline/render_layers.js`, `glslangValidator`); nếu agy không có allowlist thì chạy trong container không có mạng ra ngoài, mount workspace chỉ đọc trừ `build/raw`, không tiêm secret; và chỉ cấp `GIT_PUSH_TOKEN` / `SLACK_WEBHOOK_URL` cho `deploy_assets` và `on_failure`. Vì render đã có bản xác định (`render_layers.js|sh`) và pipeline luôn chạy lại nó sau agent, có thể bỏ hẳn agent khỏi bước này. Các thay đổi này phụ thuộc schema thật của orchestrator nên chưa sửa trong YAML.

## Cấu trúc

```
src/lib/        rng.js · noise.js · png.js (PRNG seed, Simplex/fBm, mã hóa/giải mã PNG)
src/tilemap/    generate_tilemap.js
src/items/      generate_items.js
shaders/        loi_kiep.frag · kim_quang.frag · fullscreen.vert · sprite_quad.vert
tools/          svg_to_png.js · shader_snapshot.js · build_preview.js
pipeline/       orchestrator_pipeline.yaml · prompts/ · validate_assets.js · pack_atlas.js
                render_layers.{sh,js} · compress_textures.{sh,js} · local_smoke.sh
scripts/        smoke.js · pack_all.js · check_syntax.js (cross-platform)
test/           procgen.test.mjs
```

Tích hợp engine (Wang index = N·1 + E·2 + S·4 + W·8; toạ độ đỉnh ô `x = (i − j)·W/2, y = (i + j)·H/2`; thứ tự vẽ liquid → dirt → grass; dán shader vào `CCProgram` của `.effect` cho Cocos Creator) giữ nguyên như tài liệu gói gốc.
