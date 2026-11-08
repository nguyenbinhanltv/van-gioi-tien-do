# D54 — tóm tắt audit similarity sau review PR #172

Audit chỉ báo cáo, không sửa art, export, backlog hoặc `validation.json`. So mọi exception mà quy tắc cũ miễn với predicate mới: chỉ tập old-skip/new-check được đo lại. Ngoại lệ pose D41 đã xem giữ miễn trên mọi kind; `posture`, `secondary-overhang`, `rear-*` không cấp miễn similarity. Không suy miễn từ head evidence.

Mốc mã audit: `45375d9e852e8f6bafdff269dac56428e18d3e45`; UTC `2026-11-08T01:29:34.381Z`. Commit tài liệu sau mốc này không đổi mã gate hay art đầu vào.

| Tập chọn                              |         Số ô |
| ------------------------------------- | -----------: |
| Quy tắc cũ từng miễn                  |         1797 |
| Quy tắc mới kiểm lại                  |          283 |
| Miễn D41 giữ nguyên (không phải pass) |         1514 |
| Đo lại: pass / fail / không đo được   | 250 / 33 / 0 |

15 ô bow upright của `dan-phu-tu-sprite-v1` vẫn được miễn D41: E=4; SE=4; S=2; NE=2; N=3. Chúng không thuộc tập thay đổi và không được gọi là similarity pass.

| Bộ / hướng              | Ô kiểm lại | Pass | Fail |
| ----------------------- | ---------: | ---: | ---: |
| dan-phu-tu-chibi-v1 / E |         24 |    1 |   23 |
| dao-tu-chibi-v1 / E     |         70 |   70 |    0 |
| dao-tu-chibi-v1 / SE    |         70 |   66 |    4 |
| phap-tu-chibi-v1 / E    |         16 |   16 |    0 |
| phap-tu-chibi-v1 / SE   |         18 |   18 |    0 |
| phap-tu-chibi-v1 / S    |         19 |   19 |    0 |
| the-tu-chibi-v1 / E     |         17 |   11 |    6 |
| the-tu-chibi-v1 / SE    |         34 |   34 |    0 |
| the-tu-chibi-v1 / S     |         15 |   15 |    0 |

## Các hướng chưa thể rebuild sạch sau D54

Các ô dưới đây fail gate cứng similarity. `validation.json` đã commit là kết quả lịch sử của gate trước D54, không chứng minh rebuild hiện tại có 0 lỗi cứng. Không sửa art hoặc hạ ngưỡng trong PR tooling này. Chủ sở hữu sửa bằng PR art riêng, giữ motion arc và khóa mặt/thân.

| Project đã merge                                            | Clip   | Ô local (0-based) fail | Chủ sửa                |
| ----------------------------------------------------------- | ------ | ---------------------- | ---------------------- |
| `assets-src/placeholder/dan-phu-tu-chibi-v1/E/project.json` | `dash` | 1–7                    | worker26               |
| `assets-src/placeholder/dan-phu-tu-chibi-v1/E/project.json` | `run`  | 0–15                   | worker26               |
| `assets-src/placeholder/dao-tu-chibi-v1/SE/project.json`    | `dash` | 3–6                    | orchestrator phân công |
| `assets-src/placeholder/the-tu-chibi-v1/E/project.json`     | `dash` | 3–6                    | worker24               |
| `assets-src/placeholder/the-tu-chibi-v1/E/project.json`     | `run`  | 5–6                    | worker24               |

## Tái lập

Chạy từ repo root sau `npm ci`:

```bash
npm run sprite:audit-head-similarity -w @vgtd/sprite -- --root assets-src/placeholder --out D:/Temp/head-reason-similarity-audit.json
```

JSON/Markdown đầy đủ chứa từng ô, kết quả, inventory miễn D41 giữ nguyên, hash project đã quét và toàn bộ đầu vào các project đo lại. Không nhận fail vào backlog. Hash mã:

- `tools/sprite/src/qa.ts`: `9650fbd20f8e625c61750d4263843bd6be93d85f8433d108912f10848e358981`
- `tools/sprite/src/head-evidence.ts`: `b98db5aceaaa3b21e8e81cbd539909d5ba07994b0069683b8c61b7c5a6b8b07a`

Theo dõi tại [OPEN-ITEMS](../OPEN-ITEMS.md); artifact đầy đủ được đính kèm AO worker24, PR #172.
