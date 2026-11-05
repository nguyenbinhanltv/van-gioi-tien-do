#!/usr/bin/env bash
# Chạy thử cục bộ phần XÁC ĐỊNH của pipeline (bỏ qua Codex / Antigravity / Claude Code và deploy).
#   bash pipeline/local_smoke.sh [nền tảng, mặc định pc]
set -euo pipefail
PLATFORM="${1:-pc}"
SEED="${SEED:-20261031}"
rm -rf build reports && mkdir -p reports
echo "▶ 1/4 generate_raw_assets"
node src/tilemap/generate_tilemap.js --seed "$SEED" --out build/raw/tilemap
node src/items/generate_items.js --seed 7 --out build/raw/items
echo "▶ 2/4 render_paperdoll_layers (script chuẩn)"
bash pipeline/render_layers.sh build/raw
echo "▶ 3/4 qa_validation_gate (phần xác định)"
set +e; node pipeline/validate_assets.js --stage raw --root build/raw --report reports/qa_raw.json; rc=$?; set -e
[ "$rc" -eq 20 ] && { echo "✖ QA chặn"; exit 20; }
echo "▶ 4/4 package_and_compress ($PLATFORM)"
mkdir -p build/atlas
for s in 48 64 128; do
  node pipeline/pack_atlas.js --in build/raw/items/icons --out build/atlas --name atl_icon_$s --size $s --filter '^(pill|talisman)_.*\.png$'
done
for t in $(ls build/raw/items/swords | sed -n 's/^flying_sword_sheet_\(.*\)\.svg$/\1/p'); do
  node pipeline/pack_atlas.js --in build/raw/items/swords --out build/atlas --name atl_sword_$t --filter "^flying_sword_[A-Z]+_${t}\.png$"
done
cp build/raw/tilemap/tileset.png build/raw/tilemap/tileset.json build/raw/tilemap/map.json build/atlas/
node pipeline/validate_assets.js --stage packed --root build/atlas --report reports/qa_packed.json
bash pipeline/compress_textures.sh "$PLATFORM" build/atlas "build/dist/$PLATFORM"
echo "✔ Chạy thử xong: build/dist/$PLATFORM"
