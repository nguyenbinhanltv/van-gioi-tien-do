# Bản sao lưu khi chủ dự án yêu cầu tạm dừng

Nhánh `wip/van-gioi-tien-do-18-pause-20261107` chỉ là backup. Không mở PR, không merge nhánh này và không tiếp tục công việc trước khi orchestrator nói **RESUME**.

Đã lưu đủ năm hướng E/SE/S/NE/N, 75 clip, 660 frame được chọn, 86 raw generation nguyên gốc trong `../<hướng>/raw/originals/`, prompt/UTC/tool/model/image ID, template, project, calibration, backlog và repair proof. Mỗi hướng có một atlas 2048 PMA; kiểm tra pixel trong `atlas-pixel-evidence.json` đều bằng 0 lỗi. Có 75 GIF và 75 contact sheet Cocos 2x trong `batches/<hướng>/<hướng>/capture/`. Trang review cũ trong `review/` đã liên kết bốn hướng; capture N đầy đủ nằm riêng trong batch N.

Hard gate đều sạch. Finding mềm tự động E/SE/S/NE/N: 12/29/26/22/30. Các pose-hold/reuse thủ công được ghi riêng trong `quality-visual-notes.json` và phần cuối backlog Markdown; không bị giấu trong số liệu QA tự động. N idle dùng lại guard ở ô 5, N emote dùng lại salute ở ô 4; run S/NE có nhịp giữ hai frame.

`license-*.md` là fragment đầy đủ per-file license và prompt, chưa chèn vào `docs/ASSET-LICENSES.md` để tránh ghi đè log mới khi đồng bộ main. Inventory của từng hướng đã được guard xác minh với fragment tương ứng. Chưa chạy bộ kiểm tra root/CI cuối cho PR art. Đây là snapshot WIP, chưa format toàn bộ.

Script chẩn đoán/repro từng ở thư mục tạm được lưu tại `repro/`. Đường dẫn máy riêng đã đổi thành token `$WORKSPACE`, `$TEMP`, `$ARTIFACTS`, `$USER_HOME` hoặc `$LOCAL_PATH`; cần cấu hình lại token nếu dùng script lưu trữ. Không chạy mù các script bootstrap/repair lên nguồn đã chọn: chúng có thể ghi đè template hoặc snapshot. Build thông thường dùng project hiện có và public `@vgtd/sprite`.

## Bước tiếp tục chính xác

1. Chờ **RESUME**, fetch origin và xác nhận PR #122 đã merge. Tạo nhánh art E mới từ `origin/main`; không rebase hay force-push.
2. Khôi phục chỉ `E/`, `batch-E.json`, ba file `thetu_E_*` cùng `.meta`, folder `.meta` và tài liệu E từ commit WIP. Không đưa `pause-backup/`, các hướng khác hoặc commit tooling của nhánh backup vào PR E.
3. Build/gate E bằng công cụ trên main, đối chiếu SHA runtime với `E/export/engine-gate.json`; giữ nguyên 156 frame và scale. Chạy writer license E vào log chung mới nhất, format phạm vi sở hữu, tạo lại inventory, chạy guard và bộ kiểm tra root/CI.
4. Một PR cho mỗi hướng từ main, E trước; không push trong lúc AO review đang chạy. Sau đó lần lượt khôi phục SE, S, NE, N từ cùng backup, tái sử dụng helper đã có và chèn fragment/license theo hướng. Không tạo ảnh mới nếu chưa được yêu cầu sau RESUME.

Không có raw generation gốc bị thiếu; xem `missing-originals.json` và `pause-state.json`.
