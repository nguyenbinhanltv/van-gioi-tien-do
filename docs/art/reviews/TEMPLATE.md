# Duyệt hoạt cảnh: <nhân-vật> – <YYYY-MM-DD>

> Sao chép file này thành `docs/art/reviews/<nhân-vật>-<YYYY-MM-DD>.md` và điền. Một file cho mỗi lần duyệt. Công cụ: viewer ([32](../../32-animation-viewer.md)), mở bằng `#viewer&mode=review&src=dragonbones/<nhân-vật>&stem=<stem>`.

| Mục               | Giá trị                                          |
| ----------------- | ------------------------------------------------ |
| Nhân vật / bộ rig | <tên, thư mục, hướng đã có>                      |
| Phiên bản dữ liệu | <commit / PR; DragonBones data version>          |
| Người duyệt       | <tên>                                            |
| Cách xem          | viewer trực tiếp / contact sheet + GIF của agent |
| Kết luận chung    | ☐ Duyệt ☐ Duyệt có sửa nhỏ ☐ Không duyệt         |

## Kiểm tra chung

| Kiểm tra                                                                 | Đạt | Ghi chú |
| ------------------------------------------------------------------------ | --- | ------- |
| 5 hướng vẽ + lật gương đúng (SW/W/NW = gương của SE/E/NE, trừ "vẽ đủ 8") | ☐   |         |
| Thứ tự lớp đúng ở mọi hướng (không lớp nào lộn)                          | ☐   |         |
| Bật/tắt từng lớp paperdoll không lộ lỗ hổng                              | ☐   |         |
| Điểm nối vòng lặp mượt (huy hiệu `wrap` không giật; ratio ≤ 2,5)         | ☐   |         |
| Sự kiện bắn đúng mốc (hit, footstep, vfx_spawn, cancel_window)           | ☐   |         |
| Hiệu năng: draw call ≤ 80, texture ≤ 220 MB, 60 FPS trong viewer         | ☐   |         |

## Từng animation

Điểm: 1 = làm lại, 2 = sửa nhiều, 3 = sửa nhỏ, 4 = tốt, 5 = rất tốt. "Seam" = số đo `ratio` từ viewer/`index.json`.

| Animation   | Điểm (1–5) | Seam | Vấn đề / yêu cầu sửa (hướng nào, frame nào) |
| ----------- | ---------- | ---- | ------------------------------------------- |
| idle        |            |      |                                             |
| meditate    |            |      |                                             |
| walk        |            |      |                                             |
| run         |            |      |                                             |
| dash        |            |      |                                             |
| sword_fly   |            |      |                                             |
| attack      |            |      |                                             |
| cast        |            |      |                                             |
| channel     |            |      |                                             |
| hit         |            |      |                                             |
| die         |            |      |                                             |
| tribulation |            |      |                                             |
| emote       |            |      |                                             |

## Yêu cầu sửa (theo thứ tự ưu tiên)

1. <animation / hướng / frame – mô tả – mong muốn>

## Quyết định

- Ngày duyệt: <YYYY-MM-DD>
- Việc tiếp theo: <ai làm gì, khi nào duyệt lại>
