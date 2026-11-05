# Nhiệm vụ: biên dịch shader và render các layer trang bị

Chạy: `bash pipeline/render_layers.sh build/raw`

- Mã thoát 0: dừng lại, báo "OK" kèm số shader và số PNG đã render.
- Mã thoát 20 (shader biên dịch lỗi): đọc `build/raw/render/logs/*.log`, sửa lỗi cú pháp GLSL ES 1.0 trong
  đúng file `shaders/*.frag` hoặc `shaders/*.vert` bị lỗi. Không đổi tên, kiểu hay số lượng uniform / attribute /
  varying (engine đang bind theo đúng giao diện này). Chạy lại script, tối đa 3 lần.
- Mã thoát 3 (thiếu công cụ) hoặc lỗi khác: không sửa gì, báo nguyên văn thông báo lỗi.

Không sửa `src/`, `pipeline/`, `tools/` và không đụng vào `build/raw/tilemap`.
