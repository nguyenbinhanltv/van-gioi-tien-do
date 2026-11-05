#!/usr/bin/env bash
# =============================================================================
# BƯỚC 2 – lõi xác định: biên dịch shader + render layer trang bị / icon / VFX
#   bash pipeline/render_layers.sh build/raw
# Mã thoát: 0 đạt · 20 shader biên dịch lỗi (lỗi dữ liệu) · 3 thiếu công cụ · 1 lỗi khác
# Antigravity gọi script này; pipeline luôn chạy lại nó sau agent để kết quả là chuẩn.
# =============================================================================
set -uo pipefail
RAW="${1:-build/raw}"
OUT="$RAW/render"
mkdir -p "$OUT/logs"

command -v glslangValidator >/dev/null || { echo "✖ thiếu glslangValidator"; exit 3; }
command -v node >/dev/null || { echo "✖ thiếu node"; exit 3; }

# 1. Biên dịch toàn bộ shader GLSL ES 1.0
SHADER_JSON="["
FAILED=0
for f in shaders/*.frag shaders/*.vert; do
  stage="${f##*.}"
  tmp="$(mktemp --suffix=".$stage")"
  { echo '#version 100'; cat "$f"; } > "$tmp"
  log="$OUT/logs/$(basename "$f").log"
  if glslangValidator -S "$stage" "$tmp" >"$log" 2>&1; then status=ok; else status=error; FAILED=1; fi
  rm -f "$tmp"
  msg="$(head -c 400 "$log" | tr '\n"' ' \047')"
  SHADER_JSON+="{\"file\":\"$f\",\"status\":\"$status\",\"log\":\"$msg\"},"
done
SHADER_JSON="${SHADER_JSON%,}]"

# 2. Render SVG trang bị / icon sang PNG (bản gốc; đóng gói sẽ thu nhỏ 48 / 64 / 128)
if ! node tools/svg_to_png.js "$RAW/items" >"$OUT/logs/svg_to_png.log" 2>&1; then
  echo "✖ render SVG lỗi, xem $OUT/logs/svg_to_png.log"; exit 1
fi

# 3. Ảnh chụp shader (cần Xvfb + gói gl); thiếu thì chỉ cảnh báo, cổng QA sẽ ghi nhận
SNAPS="[]"
if command -v xvfb-run >/dev/null && xvfb-run -a -s "-screen 0 1280x720x24" node tools/shader_snapshot.js "$OUT" >"$OUT/logs/snapshot.log" 2>&1; then
  SNAPS="$(cd "$OUT" && ls *.png 2>/dev/null | node -e 'const l=require("fs").readFileSync(0,"utf8").trim().split("\n").filter(Boolean);console.log(JSON.stringify(l))')"
fi

# 4. Manifest cho cổng QA
node -e '
const [shaders, snaps, out] = process.argv.slice(1);
require("fs").writeFileSync(out + "/render_manifest.json", JSON.stringify({
  shaders: JSON.parse(shaders), snapshots: JSON.parse(snaps), at: new Date().toISOString()
}, null, 2));' "$SHADER_JSON" "$SNAPS" "$OUT"

if [ "$FAILED" -ne 0 ]; then echo "✖ có shader biên dịch lỗi (xem $OUT/logs)"; exit 20; fi
echo "✔ render xong: shader OK, layer PNG trong $RAW/items, ảnh chụp trong $OUT"
