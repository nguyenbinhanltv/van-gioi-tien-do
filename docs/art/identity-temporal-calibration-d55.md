# D55 — gate palette identity và temporal review

Quyết định đã duyệt: A là gate cứng Lab (đầu ≤15, thân ≤23); C giữ head-size ±3%. L1 8×8 chỉ chẩn đoán. B dưới 0,45 ghi INFO `review-by-eye`, không fail; mirror được flag B và review contact sheet bằng mắt bắt buộc mỗi PR hướng.

Audit pin: 31 project / 4922 ô (29 đã merge, Kiếm E candidate và Đan/Phù SE self-contained v4). 1655 ô miễn D41 được ghi riêng, không gọi pass. Master chuẩn hóa 256px đúng `runProject`; không fit scale/rotation, không sửa art/evidence/export. Hash nguồn và mã được kiểm trước/sau chạy.

## Control matrix

| Control              | Vai trò và kết quả                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Đầu lớp khác         | A: Lab 18,9767 >15, hard reject                                                          |
| Outfit/thân lớp khác | A: Lab 35,3382 >23, hard reject                                                          |
| Hue thay đổi         | A: Lab 31,8389 >15, hard reject; luminance SSIM 0,9978 không đủ phát hiện                |
| Đầu mirror           | B: SSIM 0,368293 <0,45, review-by-eye INFO + review contact sheet; không gọi hard reject |
| Đầu thu nhỏ 85%      | C: full QA đo 42,8247px <49,1743px, hard reject                                          |

Sequence control là master/control/master tổng hợp, dùng geometry dựng fixture, không tạo annotation production. Công cụ `sprite:audit-similarity-controls` tái lập cả năm control và ghi nguồn/hash.

## Hiệu chuẩn

Lab dùng alpha≥250, unpremultiply RGB, CIELab(D65), histogram một đơn vị cho L/a/b, 1-Wasserstein từng trục kết hợp Euclid. Đây là khoảng cách phân bố biên, không phải nhận diện khuôn mặt hay DeltaE từng pixel. Cửa sổ, margin tổng8%, torso25%×44% H master và fallback được ghi tại README.

| Tập | Minimum | Median | Maximum |
| --- | --- | --- |
| Lab đầu, 965 ô tốt idle/walk/emote không miễn D41 đã merge | 1.749462 | 4.267448 | 11.053497 |
| Lab thân, cùng tập | 1.624133 | 3.380858 | 11.576608 |
| Temporal min(head,torso), 931 pair cùng tập | 0.174881 | 0.939429 | 0.998401 |

Trần15/23 có biên xấp xỉ4 đơn vị Lab trở lên so tập tốt/control màu. Temporal còn chồng lấn pose, nên chỉ diagnostic: 12/931 pair tập tốt và 612/4257 pair toàn tập đã merge được flag. Không gọi mọi pair thấp là drift. Alpha IoU chỉ chẩn đoán. Static-master SSIM đã loại khỏi vai trò gate: tại0,70 từng làm 387/965 ô tốt fail.

Lab không đủ opaque ở 10 ô, tất cả miễn D41; không tính pass hoặc fail mới. Có 0 cửa sổ invalid. Thiếu landmark dùng centroid-fallback có cờ, không bịa điểm.

## 11 rebuild blockers hiện tại

Cần sửa hoặc quyết định giải thích lighting/expression/crop; không tự hạ trần hoặc chỉnh điểm theo score. Các ảnh/crop master và ô nằm trong artifact `similarity-identity-temporal-audit-palette-findings.html`; PNG crop giữ nguyên pixel nguồn, chỉ zoom đồng đều khi xem.

| Project                                                       | Clip       | Ô local | Lab đầu   | Owner    |
| ------------------------------------------------------------- | ---------- | ------- | --------- | -------- |
| `assets-src/placeholder/phap-tu-chibi-v1/S/project.json`      | `dash`     | 3       | 15.499404 | worker25 |
| `assets-src/placeholder/phap-tu-fan-sprite-v1/N/project.json` | `attack`   | 2       | 15.734166 | worker25 |
| `assets-src/placeholder/phap-tu-fan-sprite-v1/N/project.json` | `cast`     | 3       | 17.036543 | worker25 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 0       | 16.433189 | worker24 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 1       | 16.591523 | worker24 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 2       | 16.579874 | worker24 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 3       | 16.257127 | worker24 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 4       | 16.007028 | worker24 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 5       | 16.312185 | worker24 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 6       | 16.236918 | worker24 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 7       | 15.689508 | worker24 |

## Đánh giá lại 33 ô D54 và candidate

Audit pin xác nhận cả 33 ô D54 có 0 palette failures, 0 head-size failures và 0 hard failures khác. Danh sách repaint chỉ do L1 được đóng theo D55, không sửa art hoặc tự chứng nhận identity. Các nhóm lịch sử: Đan/Phù E run0–15/dash1–7; Thể E run5–6/dash3–6; Đao SE dash3–6. Điều này không miễn review bằng mắt và không đóng 11 Lab blockers mới.

- Candidate kiem-tu-chibi-v1 E: 0 ô palette hard, 13 ô head-evidence/head-size hard, 13 ô có hard failure. Không suy identity/scale pass chỉ từ palette.
- Candidate dan-phu-tu-chibi-v1 SE: 0 ô palette hard, 1 ô head-evidence/head-size hard, 1 ô có hard failure. Không suy identity/scale pass chỉ từ palette.

Đan/Phù SE dash5 vẫn giữ bằng chứng head-size oversize thật đã adjudicate, không waiver hoặc dời điểm. Kiếm E chưa có motion landmarks chứng nhận; source/stencil không phải bằng chứng scale.

## Tái lập và provenance

```bash
npm run sprite:audit-similarity-controls -w @vgtd/sprite -- --out D:/Temp/d55-controls.json
npm run sprite:audit-similarity-crops -w @vgtd/sprite -- --root assets-src/placeholder --control-matrix D:/Temp/d55-controls.json --out D:/Temp/d55-merged-audit.json
```

Tập 31 project thêm `--project D:/Temp/vgtd23-d55-E-input/project.json --project D:/Temp/vgtd26-SE-D55/selfcontained-v4/project.json`; đây là snapshot local chỉ đọc, không nhập vào repo. `--baseline` nhận JSON audit D54 để gắn chính xác 33 ô. Report ghi lệnh đầy đủ, mọi ô/pair, source/code SHA256, windows, annotations, registration và coverage. Các file/mã đo không được đổi trong lần chạy.

HTML/JSON đầy đủ, control matrix và crop 11 ô được đính kèm tại [session worker24](ao://sessions/van-gioi-tien-do/van-gioi-tien-do-24). Công thức: [Wang 2004 Eq.13](https://ece.uwaterloo.ca/~z70wang/publications/ssim.pdf), [W3C chuyển đổi màu](https://www.w3.org/TR/css-color-4/#color-conversion-code).
