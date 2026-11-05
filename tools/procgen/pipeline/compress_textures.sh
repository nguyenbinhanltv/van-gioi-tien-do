#!/usr/bin/env bash
# =============================================================================
# BƯỚC 4b – nén atlas theo nền tảng
#   bash pipeline/compress_textures.sh <web|android|ios|pc> <thư mục atlas> <thư mục ra>
# Web: KTX2 / Basis Universal (ETC1S cho tile, UASTC cho icon / UI / nhân vật) + WebP dự phòng
# Android, iOS: ASTC (4×4 icon / UI, 6×6 tile, 8×8 VFX) · PC: giữ PNG
# Mã thoát: 0 đạt · 20 vượt ngân sách dung lượng · 3 thiếu công cụ · 1 lỗi khác
# =============================================================================
set -euo pipefail
PLATFORM="$1"; IN="$2"; OUT="$3"
ASTCENC="${ASTCENC:-astcenc-avx2}"
WEB_CORE_BUDGET_KB="${WEB_CORE_BUDGET_KB:-6144}"   # phần atlas trong gói Core Web (tổng gói ≤ 25 MB)
mkdir -p "$OUT"

need() { command -v "$1" >/dev/null || { echo "✖ thiếu công cụ $1"; exit 3; }; }
class_of() {                       # phân loại theo tiền tố tên file
  case "$(basename "$1")" in
    atl_icon_*|atl_ui_*|atl_sword_*|atl_char_*) echo hq ;;
    tileset*|atl_tile_*)                      echo tile ;;
    atl_vfx_*)                                echo vfx ;;
    *)                                        echo hq ;;
  esac
}

case "$PLATFORM" in
  web)
    need basisu; need cwebp
    for f in "$IN"/*.png; do
      c="$(class_of "$f")"; base="$(basename "${f%.png}")"
      if [ "$c" = tile ] || [ "$c" = vfx ]; then
        basisu -ktx2 -q 192 -output_path "$OUT" "$f" >/dev/null           # ETC1S: nhỏ, hợp tile / VFX
        cwebp -quiet -q 85 "$f" -o "$OUT/$base.webp"
      else
        basisu -ktx2 -uastc -output_path "$OUT" "$f" >/dev/null           # UASTC: giữ nét icon / UI
        cwebp -quiet -lossless "$f" -o "$OUT/$base.webp"
      fi
    done ;;
  android|ios)
    need "$ASTCENC"
    for f in "$IN"/*.png; do
      c="$(class_of "$f")"; base="$(basename "${f%.png}")"
      case "$c" in tile) bs=6x6 ;; vfx) bs=8x8 ;; *) bs=4x4 ;; esac
      "$ASTCENC" -cl "$f" "$OUT/$base.astc" "$bs" -medium -silent
    done ;;
  pc)
    cp "$IN"/*.png "$OUT"/ ;;
  *) echo "✖ nền tảng không hợp lệ: $PLATFORM"; exit 1 ;;
esac
cp "$IN"/*.json "$OUT"/ 2>/dev/null || true

# Manifest + kiểm tra ngân sách (Web)
TOTAL_KB=$(du -sk "$OUT" | cut -f1)
node -e '
const fs=require("fs"),path=require("path");const [dir,platform,kb]=process.argv.slice(1);
const files=fs.readdirSync(dir).filter(f=>!f.endsWith("compress_manifest.json")).map(f=>({file:f,bytes:fs.statSync(path.join(dir,f)).size}));
fs.writeFileSync(path.join(dir,"compress_manifest.json"),JSON.stringify({platform,totalKB:+kb,files},null,2));' "$OUT" "$PLATFORM" "$TOTAL_KB"
echo "✔ $PLATFORM: ${TOTAL_KB} KB trong $OUT"
if [ "$PLATFORM" = web ] && [ "$TOTAL_KB" -gt "$WEB_CORE_BUDGET_KB" ]; then
  echo "✖ vượt ngân sách atlas Core Web: ${TOTAL_KB} KB > ${WEB_CORE_BUDGET_KB} KB"; exit 20
fi
