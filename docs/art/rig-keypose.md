# Bước key pose tham chiếu AI → khớp rig (D39, bổ sung 2026-11-06)

Quyết định của chủ dự án: giữ rig xương, **thêm bước key pose tham chiếu** để sửa dáng đi/chạy (phần thân dưới trước đó trông "què").

## Quy trình

1. **Key pose (worker art):** ảnh toàn thân cùng phong cách/tỉ lệ với master, nền trong, cùng khung 256×256 @2x, gốc `(128, 232)`. Tên file: `assets-src/placeholder/kiem-tu-continuous-v1/keyposes/<hướng>/<clip>_<NN>_<nhãn>.png` + `.landmarks.json` cùng tên.
   - `run`, `walk`: 8 key `R_contact, R_down, R_passing, R_up, L_contact, L_down, L_passing, L_up`; `dash` 3 (`start, reach, end`); `attack`, `attack_2`, `attack_3`: 3 (`anticipation, strike, follow`); `cast` 3 (`gather, release, hold`); `idle` 2 (`in, out`).
   - Landmark (px @2x, x phải, y xuống, gốc góc trên trái): `root, head, neck, chest, pelvis, shoulder_L/R, elbow_L/R, wrist_L/R, hand_L/R, hip_L/R, knee_L/R, ankle_L/R, foot_tip_L/R, sword_tip, hem_left, hem_centre, hem_right, skirt_front_split, skirt_back_split` và `_inferred: [tên khớp bị che]` (khớp suy đoán không tính vào sai số). L = bên xa, R = bên gần (hướng E).
2. **Khớp pose (`@vgtd/rig`, `keypose.ts`):** `fitPose(rig, landmarks, view)` giải góc xoay xương (nhắm theo đoạn landmark), dịch hông (pelvis), đích IK chân (mắt cá), góc hai tà váy (`robe_front` ↔ `hem_right`, `robe_back` ↔ `hem_left`, ≤ 38°) và báo sai số từng landmark + xương lệch độ dài > 5 %.
3. **Dựng clip:** `authorKeyPoseClip` đặt key theo thời lượng/phase của bảng animation (run 8 key trên 15 frame, key R_contact trùng `footstep_R` của bảng; attack: anticipation ở `windup_end`, strike ở `hit_frame`, follow ở `combo_window`; clip một lần nội suy từ/ về tư thế nghỉ). Nội suy ease in-out; **chân đang chạm đất nội suy tuyến tính** (tốc độ mặt đất không đổi, không trượt chân); `motion.speed` suy ra từ chân đạp đất. Sau đó bake lò xo, lớp chi tiết (chớp mắt, đổi tay/miệng, vệt kiếm) như clip viết tay.
4. **Nghiệm thu:** IoU silhouette từng key so với ảnh tham chiếu ≥ 0,85 (bỏ vệt kiếm/bóng), cộng các kiểm tra thân dưới (đùi lộ ngoài váy, độ rộng bước, diện tích váy), strip QA và `rig:gate`.

## Lệnh

```bash
npm run rig:assemble -w @vgtd/rig -- --parts <thư mục có E/> --keyposes <thư mục có E/> [--iou 0.85] --out <thư mục>
```

In sai số khớp + IoU từng key, và ghi `keypose_<clip>_compare.png` (hàng: tham chiếu / rig cũ / rig theo key pose; mỗi cột một key). IoU dưới ngưỡng thì không xuất (trừ `--allow-errors`).

## Ghi chú khớp pose v2 (2026-11-06) và ngưỡng nghiệm thu

- **Giải theo thứ tự cây xương:** hông/pelvis (hạ hông nếu chân không với tới mắt cá) → cột sống/cổ/đầu (nhắm theo **hướng** landmark, đầu luôn thẳng) → tay (IK 2 xương giải tích đặt cổ tay **đúng** landmark, khuỷu giữ phía gập của tư thế nghỉ nên các key liên tiếp không lật khuỷu) → chân (IK đích = mắt cá) → bàn chân/kiếm → hai tà váy sau chân.
- **`hem_left` / `hem_right` là mép ngoài của váy**, không phải trục xương tà váy: tà váy xoay theo **thay đổi hướng** của mép từ pivot so với mép lúc nghỉ đo trên mesh, không theo hướng tuyệt đối.
- **Đích IK chân/tay đặt đúng mắt cá/cổ tay của landmark** (`applyLandmarks`); trước đây đích IK còn ở vị trí rig cũ nên mọi delta chân đều lệch.
- **Khóa chân chạm đất:** khi một chân chạm đất qua các key liên tiếp, đích chân phải lùi với tốc độ mặt đất không đổi; các key được dịch ngang như vật rắn (hông + hai chân) cho đến khi chân chạm đất nằm trên đường đó. Khoảng cách key đều nhau (không làm tròn frame) để không giật ở điểm nối vòng.
- **Cổng mỗi key:** RMS sai số landmark nhìn thấy ≤ 2 px rig **và** IoU silhouette. IoU còn bị giới hạn bởi khác biệt hình dạng giữa ảnh AI và art của rig (tóc dài bay, váy xòe, tay áo): đối chứng idle (tư thế gần như tĩnh) chỉ đạt IoU 0,85-0,87 dù sai số pose = 0. `rig:assemble --keyposes` in thêm IoU theo ba dải (đầu+tay / thân / váy+chân), tịnh tiến tốt nhất của ảnh tham chiếu và ảnh chồng (xám: cả hai; đỏ: chỉ tham chiếu; xanh: chỉ rig) để tách sai lệch đăng ký khỏi sai lệch hình dạng.
