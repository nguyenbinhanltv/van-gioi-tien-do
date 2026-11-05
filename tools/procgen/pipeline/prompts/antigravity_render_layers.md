# Nhiệm vụ: sửa lỗi biên dịch shader (chỉ khi pipeline đã chạy script render và có shader lỗi)

Bối cảnh: pipeline đã chạy `bash pipeline/render_layers.sh build/raw` và `build/raw/render/render_manifest.json`
báo ít nhất một shader `"status": "error"`. Bạn KHÔNG chạy được lệnh shell; sau khi bạn sửa xong, pipeline sẽ tự chạy
lại script để kiểm tra.

Việc cần làm:
1. Đọc `build/raw/render/render_manifest.json` để biết shader nào lỗi, rồi đọc `build/raw/render/logs/<tên shader>.log`.
2. Sửa lỗi cú pháp GLSL ES 1.0 trong đúng file `shaders/*.frag` hoặc `shaders/*.vert` bị lỗi.
   Không đổi tên, kiểu hay số lượng uniform / attribute / varying (engine đang bind theo đúng giao diện này).
3. Trả lời ngắn gọn: shader nào đã sửa và sửa gì.

Không sửa `src/`, `pipeline/`, `tools/`, không đụng vào `build/raw/tilemap`, không tạo file mới.
