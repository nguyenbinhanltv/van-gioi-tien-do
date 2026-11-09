# Việc còn mở & mảng thiết kế còn thiếu

Nguồn gốc: mục "chưa kiểm tra được" và "việc còn mở" của hồ sơ tổng hợp ([00-ho-so-tong-hop.md](00-ho-so-tong-hop.md)); các mục đó đã được chuyển hẳn về đây và gỡ khỏi 00 (xem lịch sử git). Từ D63 trở đi, mỗi mục kỹ thuật có tiêu đề theo số D và PR; mục đã được PR đã merge xử lý ghi số PR (#...) và gạch ngang, nội dung gốc giữ nguyên. Câu hỏi chờ chủ dự án nằm ở [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md), không ở đây. Số mục (§1–§19) được các tài liệu khác trích dẫn nên không đánh số lại.

## Mục lục theo mảng

| Mảng                                  | Mục                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tổng quan, quy trình, tài liệu        | §1, §2, §3, §4, §6, §7, §8, Design A (01, 10, 11), Design C (20–29)                                         |
| Công thức và dữ liệu (`@vgtd/shared`) | §5, §16, "P2-1", D83 (số quái)                                                                              |
| Nhân vật, rig, art, animation         | §9, §10, §11, §12, §13, §15, D54, D55, Asset Gemini, Asset Gemini PART 2                                    |
| Hệ kỹ năng và combat                  | §14, "D74 — quái", D83, D88 (hồi HP / MP), D89 (telegraph quái)                                             |
| Server, mạng, hiệu năng               | "P2-2", "P2-3", D73, "P2 exit", D80, D85, D88 (hồi HP / MP phía server), D92 (lưu trữ bằng tệp), §20 (chat) |
| Client, render, HUD                   | D71 (hai mục), §15, §18, §19, D79, D84, D89 (telegraph), Mob hiển thị tạm thời (standee), §20 (chat)        |
| Tu luyện, túi đồ, kinh tế (server)    | §17, D77, D79, D90 (dùng vật phẩm)                                                                          |

## 1. Việc cần làm

| #   | Việc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Lý do                                                                                                                                                                                                                                                                                                           | Ưu tiên    | Trạng thái                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cập nhật GDD sang 2D Isometric / Web / Cocos Creator, số Ngũ hành và công thức đột phá mới                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | GDD vẫn ghi 3D, UE5 và các giá trị cũ ở D1–D4, D8–D10                                                                                                                                                                                                                                                           | Cao        | **Đã làm trong repo**: [01-gdd.md](01-gdd.md) (dựng lại do không có docx GDD). Cần chủ GDD đối chiếu với bản gốc                             |
| 2   | Cập nhật Asset Matrix: gói đầu 25 MB, 6 phẩm, kích thước icon                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tránh hai tài liệu nói hai số khác nhau                                                                                                                                                                                                                                                                         | Cao        | **Đã làm**: [02-asset-matrix-2d.md](02-asset-matrix-2d.md)                                                                                   |
| 3   | Ánh xạ `orchestrator_pipeline.yaml` theo schema thật của orchestrator.inc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Chưa có tài liệu schema công khai                                                                                                                                                                                                                                                                               | Cao        | **Thay bằng GitHub Actions** (D28, D29): không cần ánh xạ orchestrator                                                                       |
| 4   | Chạy pipeline trên runner thật (basisu, astcenc, claude, codex, agy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Các bước này chưa kiểm tra được                                                                                                                                                                                                                                                                                 | Cao        | **Thay bằng GitHub Actions** (D28): CI ngắn, không CD                                                                                        |
| 5   | Prototype client trong Cocos Creator: InputManager + tilemap sinh tự động + 1 nhân vật paperdoll (skeleton DragonBones – D35)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Kiểm chứng ngân sách draw call, RAM và Y-sort trên máy thật (đo cuối trên Web headless sau D71: draw call 69, RAM 226 MB, 33,5 FPS với 20 NPC chibi (WebGL phần mềm), gói đầu 9,3 MB, đều đạt, xem [docs/33](33-p1-perf.md) báo cáo thoát P1; còn thiếu: đo trên 1 máy mobile thật qua LAN, các bước ở docs/33) | Cao        | Mở                                                                                                                                           |
| 6   | Module `step()` dùng chung client / server, World Node mẫu, đo AOI với 100 vs 100                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Kiểm chứng băng thông và CPU của tài liệu Server                                                                                                                                                                                                                                                                | Trung bình | **Đã làm trên máy dev** (#202 băng thông AOI 100 vs 100, #212 bộ đo P2 exit, #222 tick rẻ hơn ~45 %); đo trên máy đích còn mở, xem "P2 exit" |
| 7   | Mô phỏng kinh tế (drop so với tiêu hao) trước closed beta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Khóa các hệ số trong Công thức bằng dữ liệu                                                                                                                                                                                                                                                                     | Trung bình | Mở                                                                                                                                           |
| 8   | Shader nước lệch hoa văn theo tọa độ thế giới                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Hồ lớn đang thấy hoa văn lặp                                                                                                                                                                                                                                                                                    | Thấp       | Mở                                                                                                                                           |
| 9   | Vòng chiến đấu giả lập offline của HUD chiến đấu (`@vgtd/client-combat`, `?combat=1`) dùng con số placeholder (sát thương = hệ số × ATK Luyện Khí 1, chí mạng 10 % ×1,5, hồi MP 2 %/s, kẻ địch đánh 4 % HP mỗi 2 s, hồi sinh 5 s; bỏ qua buff / debuff / CC / dash / triệu hồi)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Chỉ để HUD có dữ liệu trước khi server có chiến đấu; luật thật do server quyết định (docs/08, docs/11). Thay bằng sự kiện server khi có                                                                                                                                                                         | Thấp       | Một phần: online đã có `ServerCombat` (#206, #213), vòng giả lập chỉ còn cho chế độ offline                                                  |
| 10  | Combat online còn thiếu: ~~chọn lớp trên dây (mọi người chơi là `kiem`)~~ [Đã làm: #223, D82], điểm ngắm cho thiết bị cảm ứng (D78 chỉ có điểm ngắm từ con trỏ), xử lý ngắt kết nối giữa cast [Cập nhật: nhắm bằng cảm ứng (Skill Wheel kéo để nhắm) đã có, xem docs/34; còn thiếu icon kỹ năng trên bánh xe (đang dùng chữ viết tắt), nút Né / Bay chưa nối server; ngắt giữa cast đã xử lý và có test, xem docs/34; thanh HP, số nổi, màn hình chết + đếm ngược hồi sinh đã có ở client online (#225)]                                                                                                                                                                                                                                                                                                                                                                                              | Điểm ngắm và vitals đã vào giao thức v3 (D78); các phần này cần thiết kế thêm                                                                                                                                                                                                                                   | Trung bình | Mở                                                                                                                                           |
| 11  | Combat server chưa mô phỏng effect dot / status / dash / buff / summon, mob tấn công người chơi từ D86 (hình telegraph trên client đã có từ D89 / v5; [Cập nhật D91: tinh anh / boss có kỹ năng, trói / chậm / độc / vũng độc và pha boss đã mô phỏng phía server; tín hiệu pha đã lên dây (`boss_phase`); trạng thái trói / chậm / độc đã lên dây và được dự đoán (D94, không còn giật); còn thiếu: icon trạng thái thật, đổi skin / chớp sáng boss phía client, triệu hồi thật (Tru gọi hiện chỉ kéo quái có sẵn), animation biến hình, đổi decal đấu trường]; số liệu đòn là tạm, cần game designer duyệt), chưa có cấp mở khóa kỹ năng, ~~kho đồ nhận drops~~ [đã có: #211, #214; túi hiển thị #216], độ bền khi chết (docs/01 §12.2); `ServerCombat` đã nối với client mạng (`?online=1&combat=1`). `MobPort` đã nối sẵn: `WorldNode({ mobs, combat })` dùng `MobManager` làm `MobPort` mặc định | Lõi combat (D75) chỉ giải quyết damage / heal / shield; phần còn lại cần hệ thống trạng thái và các PR đang mở                                                                                                                                                                                                  | Trung bình | Mở                                                                                                                                           |

## 2. Chưa kiểm tra được (từ mục §6 cũ của 00)

- Nén KTX2 / ASTC (basisu, astcenc không có trong môi trường thử).
- Ba bước gọi Codex, Antigravity và Claude Code trong `orchestrator_pipeline.yaml` (chỉ còn là tài liệu tham khảo, D29).
- Bước deploy: không còn trong phạm vi (D28: không CD). "orchestrator.inc" trong tài liệu nguồn là nhầm lẫn (D29).
- Demo canvas `example/` của gói client mới biên dịch, chưa chạy trong trình duyệt thật.

### Art/animation ưu tiên trước — quyết định 2026-11-06

[Cập nhật D32: ưu tiên thiết kế nhân vật/asset trau chuốt + animation mượt. Kỹ thuật chỉ phục vụ trình xem animation trong engine (PR #7, #67 + viewer); server/netcode tiếp tục tạm dừng.] Các mục server ở bảng trên không có nghĩa được mở lại.

- ~~Chưa chỉ định người rig/animate (human animator not assigned).~~ **[Đóng bởi D36: AI làm toàn bộ concept, tách mảnh, rig và hoạt cảnh; chủ dự án (art owner tạm thời) chỉ duyệt trong viewer. Không còn chặn.]**
- **Rủi ro mới (D36): chất lượng animation khi không có animator.** Hoạt cảnh do agent sinh có thể cứng/thiếu trọng lượng; chỉ coi là hoàn thiện sau khi chủ dự án duyệt trong viewer. Cần tiêu chí duyệt (timing, footstep, độ liền mạch vòng lặp) và quy trình sửa lặp.
- **Cần QA hình ảnh tự động (D36).** Không có người xem từng frame: cần kiểm tự động (xuyên mảnh, lệch pivot/socket, rách mesh, vòng lặp không khớp, vượt giới hạn rig docs/03, ảnh chụp so sánh trong engine) trước khi đưa tới người duyệt. Xây ở bộ công cụ AI animation (task sau PR #76).
- **`@vgtd/rig` (tools/rig) – việc còn mở sau PR lõi:** (1) rig thật của Kiếm tu (`tools/rig/kiem-tu.rig.json`, worker nhân vật) chưa nạp: bộ hoạt cảnh mới chạy và qua QA trên rig tham chiếu `buildReferenceHumanoid`; cần xác nhận tên bone/vai trò khi có rig thật. (2) Hướng S/N/chéo là chiếu giảm biên độ từ góc nghiêng, cần duyệt trong viewer. (4) Chưa có renderer PNG/GIF (contact sheet) và 7 hoạt cảnh còn lại (walk, dash, meditate, channel, sword_fly, tribulation, emote). (5) Kiểm bằng runtime Cocos chỉ chạy cục bộ (CI không có Cocos). Xem [art/rig-pipeline.md](art/rig-pipeline.md).
- **Rig Kiếm tu: kiếm đôi và mối nối hở (vòng 3, `@vgtd/rig`).** (1) Mảnh `scabbard` của `outfit_lower` có một thanh kiếm vẽ sẵn nên khi kiếm rút trên tay thì thấy hai thanh; đã bỏ mảnh đó khỏi 5 hướng bằng `removePieces`. Đánh đổi đo được: đuôi sash mà mảnh đó nối giờ lộ ra, hướng S tách mảnh 2 → 11 clip. Bone `scabbard` và vùng atlas tương ứng **giữ nguyên, chưa dùng**, để gắn lại khi có mảnh vỏ kiếm rỗng. (2) Cần art vẽ bù dưới khớp (danh sách chính xác từng cặp mảnh và số px: [art/rig-underpaint.md](art/rig-underpaint.md); lớn nhất: đùi / robe_back 31 px, vest / tay áo vai 20 px, robe_back / robe_front 11 px) và một mảnh vỏ kiếm rỗng cùng vẽ bù đuôi sash. (3) Sau khi art xong: áp lại `autoSkin`, đo lại bằng `npm run artifacts -w @vgtd/rig`, rồi mới đặt `seamSeverity` mặc định thành `error` (hiện `warning` vì chưa sạch). Xem [art/rig-pipeline.md §11](art/rig-pipeline.md).
- ~~Cần xác minh giấy phép Spine Professional và điều khoản Spine Runtimes~~ **[Thay bởi D35: không dùng Spine; mục này đóng.]** Các mục mới từ nghiên cứu [art/dragonbones.md](art/dragonbones.md):
  - ~~**Editor DragonBones Pro không còn tải chính thức (editor availability).**~~ **[Đóng bởi D36: editor GUI là tùy chọn, không còn chặn.]** (ghi chú lịch sử) Trang tải của Egret trả 404; bản desktop cuối 5.6.2 (2018) chỉ có từ bên thứ ba. Công cụ hiện hành là **LoongBones** (web, đổi tên 2025-10-13). Chủ dự án chọn công cụ và nguồn tải được chấp nhận; [Cập nhật D36: không còn chặn.]
  - **Điều khoản LoongBones (chủ dự án đã kiểm 2026-11-06, giá theo ảnh chụp của chủ dự án; không chặn, D36):** gói Free **$0** = dùng thử 7 ngày (10 dự án, 10 MB lưu đám mây, 20K AI token/ngày; thử kết thúc ~2026-11-13). VIP 1 tháng **$9.9/tháng** (không giới hạn dự án, 2 GB, 60K AI token/ngày). VIP 1 năm **$89.9/năm** (không giới hạn dự án, 20 GB, 60K token/ngày). Loong Coins **$9.9 một lần** (6.000 coin cho tính năng AI; giá niêm yết $19.9). Xuất tệp: **được phép, không watermark**. Dùng thương mại tệp xuất: **được phép (theo cách đọc điều khoản của chủ dự án, không phải tư vấn pháp lý)**. Nhập DragonBones 5.x JSON: **không làm (chủ dự án bỏ qua 2026-11-06)**. Chưa mua; LoongBones vẫn tùy chọn và hiện không dùng (D36).
- **Giá/ToS LoongBones và quyền thương mại với asset xuất ra chưa xác minh (editor terms/risk).** Có mục "会员订阅", báo cáo trái chiều miễn phí/trả phí. Cần người đọc `loongbones.com` và ghi vào [ASSET-LICENSES.md](ASSET-LICENSES.md) khi có asset đầu.
  - **Phiên bản dữ liệu xuất chưa kiểm với Cocos 3.8.8 (export-format risk).** Runtime đọc tối đa 5.6.300; cần sinh mẫu từ nguồn rig trung lập (D36; LoongBones chỉ tùy chọn), nạp thử, ghim fixture (liên quan 31 I-06, worker rig/viewer).
  - **Thiếu tính năng so với Spine (physics constraint, `Skin.addSkin`).** Cần quyết định cách làm vải/tóc/phi phong (key tay hoặc bone chain) và đổi trang bị bằng `replaceSlotDisplay` trong spike.
  - **Công cụ ít bảo trì (abandonment risk).** Giảm thiểu: runtime MIT trong engine + nguồn rig trung lập sinh DragonBones JSON bằng mã; có thể xem lại Spine sau MVP.

[Cập nhật D34: tạm chấp nhận ảnh từ `image_gen.imagegen` khi mô hình/phiên bản không được công bố; vẫn phải ghi CLI version, ngày/giờ, prompt đầy đủ vào ASSET-LICENSES.md và rà soát giấy phép/xác minh nguồn gốc trước phát hành.]

## 3. Mảng chưa có tài liệu thiết kế

> Cập nhật: các tầng vòng lặp thời gian (5 phút → 12 tháng), cơ chế từng cảnh giới và chiến tranh Linh Mạch đã có **đề xuất** ở [01-gdd.md](01-gdd.md) §3–§4, §9 (chờ duyệt; xem mục "Design A"); nhiệm vụ, chế tạo, PvP, kiếm tiền, onboarding, LiveOps, telemetry có đề xuất ở 12–17 (PR #69). Danh sách dưới giữ nguyên làm lịch sử.

- Nhiệm vụ và cốt truyện
- Nghề luyện đan / luyện khí / chế phù chi tiết
- Luật PvP và đấu trường
- Kiếm tiền (Tiên Ngọc, Battle Pass, cửa hàng)
- Hướng dẫn người chơi mới (onboarding)
- Sự kiện và LiveOps
- Đo lường (telemetry, dashboard KPI)

## 4. Lưu ý khi chuyển đổi tài liệu

- Không có docx GDD riêng; 01-gdd.md chỉ chứa những gì hồ sơ tổng hợp và tài liệu Công thức ghi lại. Các tầng vòng lặp thời gian (5 phút → 12 tháng), cơ chế riêng của từng cảnh giới và chiến tranh Linh Mạch hiện có **thiết kế đề xuất** trong 01 §3–§4, §9 (chờ duyệt, mục "Design A" ở cuối file); vẫn chưa có nguồn gốc.
- 03–08 giữ nguyên văn docx, kể cả các chỗ nhắc giá trị cũ để so sánh.

## 5. Điểm mơ hồ của spec phát hiện khi viết `@vgtd/shared` (PR #4)

Nguồn: mô tả PR #4 (`packages/shared`). Tất cả A1–A13 đã được chốt ngày 2026-11-05 (xem [DECISIONS.md](DECISIONS.md) D14–D24); các mục gameplay được đánh dấu cần game designer duyệt khi cân bằng.

| #   | Điểm mơ hồ                                                                                                                                                                                                                                                                            | Trạng thái                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A1  | Bảng chỉ số in trong 07 lệch công thức của chính nó tới ~0,02% (Độ Kiếp sơ kỳ HP in 120.936, tính ra 120.932; Viên Mãn 156.733 so với 156.758). Nằm trong ngưỡng CI 1% của tài liệu. Code dùng công thức; HP_ref của ví dụ 81 đạo dùng số in 156.733.                                 | **Đã chốt 2026-11-05** (D16)                                                                    |
| A2  | Tổng Lôi Kiếp: bảng làm tròn 81 đạo thành 3,0 × HP_ref, công thức cho ≈ 2,999×; số học ví dụ lệch ≤ 2 HP so với 90.904 / 250.772 in trong tài liệu. `tribulationOutcome` có `totalMultiplierOverride` để tái hiện đúng số in.                                                         | **Đã chốt 2026-11-05** (D16)                                                                    |
| A3  | Số Hộ Mạch Đan: "172 s → 4 viên" được cài là `floor(172/45) + 1` (viên đầu tại t = 0).                                                                                                                                                                                                | **Đã chốt 2026-11-05** (D17) (chờ game designer duyệt khi cân bằng)                             |
| A4  | Thứ tự chia sát thương cho hộ pháp so với giảm của trận pháp không được nêu; code áp dụng nhân sau khi giảm. Trần 50% giả định áp cho trận pháp + Thể tu gộp. Độ bền khiên mất 10%/đợt mới chỉ là hằng số.                                                                            | **Đã chốt 2026-11-05** (D18) (chờ game designer duyệt khi cân bằng)                             |
| A5  | Đột phá tiểu cảnh: chỉ có Base 0,90 / 0,85 và nửa Karma_Penalty; đan và pity **không** áp dụng, clamp 5–95% là giả định.                                                                                                                                                              | **Đã chốt 2026-11-05** (D19) (chờ game designer duyệt khi cân bằng)                             |
| A6  | Hướng nào được vẽ cho Player / Boss: 00 §3 ghi 8, tài liệu Nhân vật ghi 5 + lật.                                                                                                                                                                                                      | **Đã chốt 2026-11-05**: 5 hướng + lật, animation bất đối xứng có thể vẽ đủ 8 (D14)              |
| A7  | Gốc iso: (i, j) nguyên là tâm ô hay đỉnh N; trục y.                                                                                                                                                                                                                                   | **Đã chốt 2026-11-05**: đỉnh N, tâm (i + 0,5; j + 0,5), y hướng xuống, client Cocos lật y (D15) |
| A8  | Sort theo tầng cao: Tilemap định nghĩa nhóm theo tầng nhưng không có khóa số; `compareDrawOrder` sắp theo nhóm → Y → X → id. Tối đa 4 tầng → nhóm 0..4 (mặt vách tầng L thuộc nhóm L−1).                                                                                              | **Đã chốt 2026-11-05** (D20)                                                                    |
| A9  | AOI `EXIT_FACTOR` 1,15 cho 46 / 51,75; tài liệu dùng 46 / 52 (làm tròn); hằng số dùng 46 / 52.                                                                                                                                                                                        | **Đã chốt 2026-11-05** (D16)                                                                    |
| A10 | Pity "xác suất lần thứ n = 0,002·(1 + 0,15n)": n coi là số lần thử tính từ 1, bảo đảm ở n = 30 (công thức chỉ cho 0,9% ở đó).                                                                                                                                                         | **Đã chốt 2026-11-05** (D21) (chờ game designer duyệt khi cân bằng)                             |
| A11 | Drop cảnh giới thấp: chênh ≥ 2 cảnh giới thì chỉ rơi nguyên liệu; `lowRealmFactor` trả `null` cho trường hợp này (nơi gọi phải xử lý).                                                                                                                                                | **Đã chốt 2026-11-05** (D22) (chờ game designer duyệt khi cân bằng)                             |
| A12 | Lỗi nhỏ của schema mẫu: trip `strictRequired` của Ajv (chạy với `strictRequired:false`, schema giữ nguyên văn); `realms.minItems` là 7 nhưng có 9 cảnh giới; `max_pills` tối đa 5 so với luật "m ≤ 3"; `Trúc Cơ → Kim Đan` là `heart_demon` trong JSON nhưng "Tâm Ma nhẹ" trong bảng. | **Đã chốt 2026-11-05** (D23)                                                                    |
| A13 | `realms[].breakthrough.main_pill_ids` trong JSON (`pill_ket_kim_dan` cho Trúc Cơ, …) khác tên đan trong bảng §2 ("Trúc Cơ Đan", "Kết Anh Đan"); giữ như JSON.                                                                                                                         | **Đã chốt 2026-11-05** (D24)                                                                    |

## 6. Thiếu hạ tầng cho mô phỏng xác định và giấy phép asset

- `@vgtd/shared` chưa có PRNG có seed dùng chung client ↔ server (các công thức hiện nhận giá trị ngẫu nhiên được truyền vào). Cần thêm trước khi viết World Node (xem skill `vgtd-sim-determinism`).
- Chưa có `docs/ASSET-LICENSES.md`; tạo khi nhập asset bên thứ ba đầu tiên (xem skill `vgtd-asset-pipeline`).

## Design A (01, 10, 11)

Các tài liệu [01-gdd.md](01-gdd.md), [10-mvp-scope.md](10-mvp-scope.md), [11-he-phai-ky-nang.md](11-he-phai-ky-nang.md) đã **thiết kế bổ sung** các tầng thời gian, cơ chế từng cảnh giới, chiến tranh Linh Mạch, Nghiệp Lực / Đạo Tâm, phạm vi closed beta và hệ phái / kỹ năng. **Mọi giá trị mới là đề xuất, chờ chủ dự án duyệt** (chưa phải quyết định; chưa vào DECISIONS). Các câu hỏi cần chốt (mỗi mục có mặc định đề xuất):

- GDD: mục "Câu hỏi cần chốt" của 01 (G1–G15; nay ở [31](31-bang-quyet-dinh.md)), gồm ba mức hậu quả Lôi Kiếp (G1), Linh Mạch 5 hay 6 phẩm (G6).
- MVP: mục "Câu hỏi cần chốt" của 10 (M1–M13; nay ở [31](31-bang-quyet-dinh.md), M13 là L-01).
- Hệ phái / kỹ năng: mục "Câu hỏi cần chốt" của 11 (S1–S11; nay ở [31](31-bang-quyet-dinh.md); S12–S14 là L-02…L-04).
- Cần duyệt thêm: ρ của Hậu sơn Sơn Môn khi đả tọa (0,6 theo 07 §5 hay giá trị riêng) — 01 §11.

## Design C (20–29)

Nguồn: PR #68. Mọi ADR ở [29-adr.md](29-adr.md) đang là "Đề xuất – chờ duyệt". Bảng "Câu hỏi cần chốt" của từng tài liệu: [20](20-kien-truc-tong-the.md#câu-hỏi-cần-chốt), [21](21-kien-truc-client.md#câu-hỏi-cần-chốt), [22](22-server-modules.md#câu-hỏi-cần-chốt), [23](23-mo-hinh-du-lieu.md#câu-hỏi-cần-chốt), [24](24-giao-thuc-mang.md#câu-hỏi-cần-chốt), [25](25-xac-thuc-bao-mat.md#câu-hỏi-cần-chốt), [26](26-kinh-te-ledger.md#câu-hỏi-cần-chốt), [27](27-van-hanh-quan-sat.md#câu-hỏi-cần-chốt), [28](28-chien-luoc-kiem-thu.md#câu-hỏi-cần-chốt), [29](29-adr.md#câu-hỏi-cần-chốt).

| #   | Việc                                                                                                                                                                                 | Nguồn                                                               | Trạng thái                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | PRNG có seed dùng chung trong `@vgtd/shared` (đề xuất xoshiro128\*\*, luồng đặt tên, seed bí mật cho roll kinh tế); đổi băm vàng của PR #10. Giải quyết mục §6 ở trên khi được duyệt | [29 ADR-010](29-adr.md)                                             | Chờ duyệt                                                                                                                                       |
| T2  | Quy tắc làm tròn số nguyên cho hàm kinh tế của `@vgtd/shared` (`sellerProceeds` trả số thực; sổ cái cần số nguyên, đề xuất thuế làm tròn lên)                                        | [26 §2.1, §5.3](26-kinh-te-ledger.md), ADR-024                      | Mở                                                                                                                                              |
| T3  | Luật Đấu Giá Hội: tỷ lệ hủy tiền, chống sniping, ai được đưa hàng (chưa có số)                                                                                                       | [26 §5.4](26-kinh-te-ledger.md)                                     | Mở                                                                                                                                              |
| T4  | Bản ghi snapshot thêm 1 bit "tuyệt đối" (37–44 bit so với 36–43 trong 08 §8) – cần xác nhận hoặc sửa 08                                                                              | [24 §6](24-giao-thuc-mang.md), PR #10                               | Chờ xác nhận                                                                                                                                    |
| T5  | Ngân sách 8/13/25 KB/s có tính tiêu đề WS + TCP/TLS không                                                                                                                            | [24 §9, Q4](24-giao-thuc-mang.md)                                   | Mở                                                                                                                                              |
| T6  | Điểm mơ hồ PR #9 (stream tier, 4–6 chunk, tie-break `compareDrawOrder`, pivot mặt vách, schema `elevation`/`objects`) và PR #10 (`qinggong`, input bị bỏ, cờ bậc thang…)             | [29 Phụ lục B](29-adr.md)                                           | Chờ xác nhận                                                                                                                                    |
| T7  | Điểm mơ hồ PR #7 còn leo thang: trục ellipse quỹ đạo, số khung sự kiện, hitbox elite và giới hạn rig quái Spine không phải boss, dữ liệu mẫu Boss                                    | [29 Phụ lục A](29-adr.md)                                           | Chờ chủ art / game design                                                                                                                       |
| T8  | Chưa kiểm chứng: Cocos 3.8.8 + DragonBones (D35; trước đó Spine 4.2), ngân sách engine ≤ 6 MB, đóng gói dữ liệu chunk (spike S1–S5)                                                  | [21 §12](21-kien-truc-client.md)                                    | Mở                                                                                                                                              |
| T9  | Mọi ngân sách ms, trần CCU, rate limit, kích thước thông điệp họ Lạnh là giả thiết thiết kế, chưa đo (cần loadbot 100v100)                                                           | [22 §3.4](22-server-modules.md), [28 §6](28-chien-luoc-kiem-thu.md) | Mở                                                                                                                                              |
| T10 | Đối chiếu telemetry/KPI với docs/17 và các tài liệu game design 10–19 khi chúng vào repo                                                                                             | [27](27-van-hanh-quan-sat.md)                                       | Mở                                                                                                                                              |
| T11 | Chính sách quyền riêng tư / xóa dữ liệu, kiểm thử xâm nhập độc lập trước closed beta                                                                                                 | [23 §7](23-mo-hinh-du-lieu.md), [25](25-xac-thuc-bao-mat.md)        | Mở                                                                                                                                              |
| T12 | Đối chiếu 20–28 với docs 10–19 sau khi PR #69/#70 vào `main`: sửa link, thống nhất tên sổ cái (`ledger`/`SRC_*` ↔ `ledger_entries`/`SYSTEM_*`), kiểm tra lại số CCU/tick             | [29 Phụ lục C](29-adr.md)                                           | **Đã đối chiếu 2026-11-05**: tên sổ cái thống nhất theo 26 (docs/13, 15, 17 đã sửa); link 20–29 → 10–19 đã kiểm (0 lỗi); phần còn lại xem mục 8 |

## 7. Đề xuất từ thiết kế B (PR #69, chờ game designer duyệt)

- FTUE bước 9 ([16-onboarding.md](16-onboarding.md) §4.2): theo D19 lần đột phá tiểu cảnh đầu tiên là 90% cố định, không đan, không pity. Đề xuất (chưa áp dụng): cân nhắc nâng tỷ lệ riêng cho nhân vật chưa từng đột phá, hoặc giữ nguyên 90%.
- Nút Né trên Mobile: `docs/05` chưa mô tả vị trí ([16-onboarding.md](16-onboarding.md) Q4).
- Đã đối chiếu với 12–19 (PR #69): phần phe / Nghiệp / rơi đồ và chiến tranh Linh Mạch của 01 chuyển sang tham chiếu 14; FTUE của 10 chuyển sang 16, KPI sang 17, nhiệm vụ sang 12, chế tạo sang 13. Còn lệch cần chốt: số Trận Nhãn 3 (14) so với 5 (04 §5) (G15); lợi thế phe (G14); chế phù trong beta (M13).

- Đã đối chiếu với 20–29 (PR #68): số CCU 100 / tick p99 ≤ 40 ms của 10 và `CastStart` / AOE trên lưới ô của 11 đã được 20–24, 28, 29 dùng làm đầu vào; không phát sinh lệch mới (T12 vẫn mở cho phần sổ cái / link của 20–28).

## 8. Rà soát chéo 2026-11-05 (docs 00–29): mâu thuẫn và khoảng trống còn mở

Nguồn: báo cáo rà soát chéo trong mô tả PR của nhánh `docs-cross-review`. Các mục dưới **không được tự quyết**; mỗi mục cần chủ dự án hoặc chủ tài liệu chốt (đề xuất mặc định nằm ở các bảng "Câu hỏi cần chốt" được dẫn).

| #   | Mâu thuẫn / khoảng trống                                                                                                                                                                                                                        | Vị trí                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| X1  | Số World Node ở beta: 1 worker chạy hai `MapInstance` (20 §5.3, 22 §3) hay một World Node mỗi bản đồ / 2 World Node (10 §8.2, M12)                                                                                                              | 10 §8.2, M12; 20 §5.3; 22 §3                |
| X2  | Biên giá niêm yết Vạn Bảo Lâu: 50%–200% giá trung bình 7 ngày (01 G13) hay [P_ref/10, P_ref×10] (26 Q3)                                                                                                                                         | 01 G13; 26 Q3; 24 §8 (`PRICE_OUT_OF_RANGE`) |
| X3  | Tiên Ngọc trong closed beta: tắt hoàn toàn (01 §10.2, G7; 10 §7.3) hay có Tiên Ngọc nội bộ để thử luồng (15 Q8)                                                                                                                                 | 01 §10.2; 10 §7.3; 15 Q8                    |
| X4  | Chương 1 (Luyện Khí) chỉ ghi bản đồ Sơn Môn (12 §3.2), nhưng Sơn Môn không có quái (10 §3, M3: mộc nhân); quái thật đầu tiên ở Bìa rừng Rừng Độc                                                                                                | 12 §3.2; 10 §3, M3                          |
| X5  | Cốt truyện 12 dừng ở chương 3 (đầu Kim Đan) nhưng phạm vi beta có ~12 giờ Kim Đan, boss, Kết Anh (10 §2): chưa có nhiệm vụ / cốt truyện cho Kim Đan                                                                                             | 12 §3.2, Q1; 10 §2                          |
| X6  | Cống hiến có nhiều faucet (12 loại `sect`, 13 Q6, 14 §4–§5, 15) và sink (11 §5 nâng rank, kho tông môn) nhưng không có mục tiêu cân bằng hay chỉ số theo dõi như Linh thạch (26 chỉ có mã `CONG_HIEN`)                                          | 11 §5; 12 §4.2; 14; 15; 26 §1               |
| X7  | `NPC_SELL` là faucet Linh thạch trong 26 (§2.2, I5) nhưng không tài liệu game design nào định nghĩa NPC mua đồ (giá, trần, loại đồ)                                                                                                             | 26 §2.2, I5; 07 §6                          |
| X8  | Chưa có module / giao thức sở hữu: tổ đội (4) + bạn bè (10 §7.1), nhiệm vụ (chỉ có bảng `quest_progress`), tông môn, hàng chờ đấu trường / cờ PK / nút Báo cáo (14), Kiếp Đài và Tâm Cảnh (01 §5.3–§5.4). 24 chỉ giữ chỗ id `sect_*`, `quest_*` | 20 §4; 22; 23; 24 §5; 10 §7.1; 14; 01 §5    |
| X9  | Cửa sổ bảo trì Thứ Tư 05:00–06:00 (15 Q7) trùng giờ reset ngày 05:00 UTC+7 (12 Q2)                                                                                                                                                              | 15 Q7; 12 Q2                                |
| X10 | Ô nhân vật thứ hai bán bằng Tiên Ngọc (15 Q6) trong khi mặc định mỗi tài khoản đã có 3 nhân vật (01 G10, 10 §7.1)                                                                                                                               | 15 Q6; 01 G10                               |
| X11 | Đăng ký "bước 0 ngắn gọn, không email" (16 Q1) so với khai báo ngày sinh khi đăng ký (19 Q6) và email tùy chọn (25 Q4)                                                                                                                          | 16 Q1; 19 Q6; 25 Q4                         |
| X12 | Issue backlog D-25…D-29 đánh số tài liệu lệch thực tế: D-25 "Auth (docs/25)" nhưng docs/25 gồm cả bảo mật; D-27 "Observability", D-28 "Security", D-29 "Test strategy" ứng với docs 27, 25, 28; docs/29 là ADR                                  | Issue #59–#63; 25–29                        |

## 9. Nhân vật (`@vgtd/character`, PR #7): điểm mơ hồ 1–5

Chi tiết và đề xuất: [29-adr.md Phụ lục A](29-adr.md). Các hàng còn mở nằm ở [31-bang-quyet-dinh.md](31-bang-quyet-dinh.md) (F-01…F-05); mã giữ mặc định có thể cấu hình.

1. Animation bất đối xứng của Player (D14): mặc định `attack`, `cast`, `channel`; Boss mặc định không có (ADR-020, F-01).
2. Draw Order vs lật gương: SW/W/NW dùng preset riêng; lật chỉ áp lên hình, `mirrored` chọn biến thể lật.
3. Trục socket: pivot-space y lên, không lật (ADR-021, F-02); `head_top` "theo cỡ nhân vật" chưa có công thức (dùng `socketsOverride`).
4. Quỹ đạo ellipse 36 × 18: rộng × cao đầy đủ hay bán trục (F-05).
5. Định nghĩa "draw call": số engine báo là chuẩn, `checkRepack` chỉ ước lượng tĩnh (ADR-022, F-03).

## 10. Kiếm tu "chi liền": dáng đi váy dài vs bảng animation

1. `GAIT_PROFILES.robe` (mặc định của `rig:assemble`) rút ngắn bước chạy/đi cho váy dài bằng cách đặt **hai cặp bước trong clip có thời lượng của bảng animation** (run 0,5 s, walk ~0,67 s), tốc độ mặt đất giữ nguyên: nhịp bước gấp đôi (≈ 8 bước/s khi chạy) nhưng không cần `timeScale` ở runtime. Hệ quả: clip chạy có **4 sự kiện footstep** (mỗi chân 2 lần, tại các lần chạm đất thật) thay vì 2 theo bảng (docs/03 ghi footstep ở frame 2 và 7 trên 10): đây là một lệch khỏi bảng, QA kiểm tra footstep theo từng chu kỳ (`clip.motion.cycles`). **Cần chủ dự án quyết:** chấp nhận nhịp gấp đôi và 4 footstep, hay dùng dáng từ key pose tham chiếu (`docs/art/rig-legacy-player.md` §D) thay cho dáng viết tay.
2. **Ngưỡng IoU của bước key pose (D40) cần chủ dự án chọn.** Mã giữ mặc định 0,85 (`rig:assemble --keyposes --iou`). Số liệu RUN-8 (8 key chạy do worker art tạo, PR #97, váy dài, dáng `robe`): RMS sai số landmark nhìn thấy 0,48-0,61 px rig (đạt ≤ 2); IoU silhouette 0,66-0,80 từng key, 0,76-0,83 sau khi tịnh tiến tốt nhất 2-4 px rig (lệch đăng ký của ảnh tham chiếu); theo dải đầu+tay / thân / váy+chân khoảng 0,6-0,8 mỗi dải. Phần còn lại khác biệt hình dạng giữa ảnh AI và art của rig (tóc dài bay, váy xòe, tay áo) và lệch đăng ký ngang ~2-4 px rig của ảnh run. **Đính chính:** đối chứng idle trước đây chỉ đạt IoU 0,85-0,87 do lỗi của công cụ khớp (đích IK cũ, mép váy), không phải trần do khác phong cách; sau khi sửa (PR #97) idle đạt IoU 0,93-0,94, RMS ≤ 0,12 px, tịnh tiến tốt nhất (0, 0). Vì vậy khoảng cách còn lại của run nhiều khả năng là hình dạng/đăng ký của ảnh run và dải động (hình học thực sự khác), cần kiểm tra thêm trước khi hạ ngưỡng. Đề xuất: **RMS ≤ 2 px và IoU ≥ 0,75 sau tịnh tiến tốt nhất cho key chuyển động** (0,85 chỉ cho key gần tĩnh như idle). Phương án khác: giữ 0,85 và sửa art/ảnh tham chiếu cho gần art rig hơn, hoặc đo IoU chỉ trên dải thân dưới. Chưa hạ ngưỡng trong mã.

## 11. Thể tu "chi liền": tư thế đòn đánh chỉ chuẩn cho hướng E

1. Bảng `CLASS_CLIPS['the-tu']` (`tools/rig/src/class-clips.ts`: đấm / móc / chưởng đôi, hit, stance, cast) **không phụ thuộc hướng**, nhưng góc đòn đánh được hiệu chỉnh theo tư thế nghỉ nghiêng của tay Thể tu hướng **E** (`upper_arm` world: R −115°, L −69°; đấm ngang ≈ +115 / −9 trên R, +69 / +10 trên L). Trên S / SE / NE / N và trên rig mẫu (tay nghỉ thẳng đứng) delta +115 đưa nắm đấm lên trên mặt phẳng ngang. Chỉ E đã kiểm trong engine. Khi ráp các hướng còn lại: hiệu chỉnh lại theo từng hướng, hoặc suy góc từ góc nghỉ của rig từng hướng (cần áp cho cả stance / idle / cast để chỗ nối clip không lệch). Sau đó key pose AI (D40) sẽ thay các bảng này.

## 12. Pipeline sprite sheet (D41): ngưỡng mặc định chưa duyệt

- **Đang chờ chuyển dữ liệu Đan/Phù SE (PR #123):** `walk`/`run` trên main được sinh từ bóng chân ngang kiểu E và căn `sole`.
  Hai clip khai báo `footSlideUnmeasuredReason` tạm thời: vẫn dựng được, nhưng trượt chân là **chưa đo**, không phải đã đạt.
  Giữ nguyên template/manifest sinh ảnh và provenance; chủ art phải thêm bộ bóng chân QA riêng theo SE với bề rộng thế đứng đo từ master,
  dùng `vertical: "keep"`, đo lại và duyệt baseline ID mới rồi mới bỏ opt-out. Không đổi tốc độ/ngưỡng, không đổi tên baseline x cũ.
  Trong thời gian chưa đo, giữ nguyên baseline cũ; QA không tự đánh dấu đã sửa và `--prune` không xóa chúng.
  Cùng tình trạng và đường chuyển dữ liệu áp dụng cho Kiếm tu SE (`walk`/`run`) vừa nhập main qua PR #127;
  kiểm tra inventory toàn bộ project đã phát hiện trường hợp này khi main cập nhật trong lúc đồng bộ PR #123.

1. Các ngưỡng QA của `@vgtd/sprite` là **mặc định chưa được duyệt**: chiều cao ±3 % (theo chủ dự án), trượt chân 3 px/khung, đường nối vòng lặp 2,5×, độ giống master 0,7 (mặt/thân), palette lock strength 0,6 / khoảng cách 60. Cần chỉnh khi có sheet thật của cả 13 animation; **không** nới lỏng cổng chiều cao âm thầm: tư thế giải phẫu phải khai báo `exceptions`.
2. Nhiều trang atlas ≤ 2048 đã có đường tải một armature và capture Cocos 3.8.8 (PR #122). QA theo hướng có PR #123; dữ liệu SE cũ vẫn cần chuyển bóng chân/hiệu chuẩn như mục chờ ở trên, không được coi là đã đo đúng theo hướng chỉ vì xuất được atlas.
3. Mục §10 mục 2 (ngưỡng IoU của key pose D40) không còn áp dụng cho thân Player (D41).

### Ngưỡng kiểm biến thể từ T1

- Tooling cung cấp pose-lock (IoU silhouette + khoảng cách khớp chú thích) và face-lock pixel theo từng ô,
  nhưng chưa có dữ liệu art đã duyệt để chốt ngưỡng chung cho T2–T5/trang phục. Project phải khai báo ngưỡng tường minh;
  ví dụ kiểm đúng tuyệt đối không phải cân chỉnh art đã duyệt. Cần xem biến thể thật để chọn ngưỡng và ghi lại.
- Chú thích khớp/mặt là bằng chứng thủ công, không phải nhận dạng giải phẫu tự động; mặt khuất N/NE phải giữ nhãn chưa đo.

### Nghiệm thu extraction D45 trên art thật

- Primitive, guide chuẩn, exporter set độc lập và runtime Cocos đã có đường kiểm thử procedural; vẫn cần art owner xem
  removal edit/matte/hand inpaint thật của từng lớp, kể cả quyền giáp đôi và weapon sau body. Không suy geometry bị che từ difference.
- Difference/reconstruction, diện tích inpaint và khoảng cách contact dùng thresholds tường minh, chưa có ngưỡng chung đã
  duyệt theo dữ liệu thật. Ghi lại ngưỡng/evidence trong report; không dùng fixture tuyệt đối làm baseline mỹ thuật.
- Runtime đã kiểm multi-page, swap độc lập, quality tint/aura hook và event/clock bằng capture3.8.8. Nghiệm thu production
  với đủ skin/tier, nền sáng/tối, sáu màu/accessibility và ngân sách render vẫn thuộc D44-02/03; không tự đóng các mục đó.

## 13. Semi-chibi D44: hợp đồng và nghiệm thu còn mở

Các mục sau chưa được concept hoặc D44 giải quyết. Không coi việc chủ dự án duyệt hướng art là nghiệm thu kỹ thuật hoặc ủy quyền làm cửa hàng/thanh toán.

| ID     | Khoảng trống                                                                                                               | Trạng thái / người chốt                                                                                                                                                                                                            | Điều kiện đóng                                                                                                                                                                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D44-01 | Giá, cửa hàng, quyền lợi/entitlement và ảnh hưởng chỉ số của trang phục cosmetic / skin vũ khí bán riêng                   | **Mở — phải có chủ dự án xác nhận rõ** theo docs/30 §5 (thanh toán / Tiên Ngọc). “Bán riêng” chỉ chốt phân loại sản phẩm, **không ủy quyền triển khai shop, giá, thanh toán hoặc chỉ số**                                          | Ghi quyết định chủ dự án về giá/đơn vị tiền, nơi mua, quyền sở hữu/sử dụng và có/không ảnh hưởng chỉ số; sau đó mới thiết kế/triển khai phần được duyệt                                                                                                                                                                  |
| D44-02 | Hợp đồng tách body + weapon + FX, socket/occlusion theo hướng/frame, skin áo và vũ khí độc lập, thứ tự vẽ và ghép runtime  | **Mở nghiệm thu art production; hợp đồng/tooling D45 đã triển khai và kiểm procedural trong Cocos** (PR #150/#155/#157/#158 và exporter set độc lập). Cần duyệt removal edit/matte/inpaint thật; không nhân body theo skin vũ khí. | Spec + schema/export/load/viewer nhiều lớp, khóa liên kết frame và QA tương ứng được duyệt, kiểm trong Cocos; xác minh không nhân bản toàn bộ body theo từng skin vũ khí                                                                                                                                                 |
| D44-03 | Shader/tint viền/glow phẩm chất trên vũ khí, phân biệt màu nhấn lớp và kim loại, 6 màu D6, accessibility                   | **Mở nghiệm thu hình ảnh/accessibility/ngân sách production**. Runtime đã có FX trắng tint phẩm chất, halo gắn đúng weapon và aura hook (PR #158); còn kiểm đủ sáu màu trên art thật, nền sáng/tối và D6/05.                       | Cùng một geometry/texture vũ khí qua 6 tint, không nhuộm thân hoặc đổi ngọc; capture nền sáng/tối, nhãn/dấu hỗ trợ màu theo D6/05, ngân sách render được kiểm                                                                                                                                                            |
| D44-04 | Quy trình khóa canonical master/turnaround, đo landmark giải phẫu riêng với alpha bbox, giữ mặt và scale trước sinh motion | **Mở — art 23–26 + tooling 27**. H216 px @2x ±3%, đầu20–24%H, mắt15–17%H và dải vai đã chốt D44; thủ tục/gate landmark còn cần hoàn tất, không suy pass từ prompt hoặc bbox                                                        | Lưu raw, prompt/hash/UTC, crown tóc chính/chin/eye/shoulder/sole cùng cách chọn; loại bun/ponytail/ornament khỏi H, một scale cố định, kiểm đủ5 hướng và mặt, đủ headroom; tooling kiểm landmark + provenance và người phụ trách khóa master trước motion. Bbox QA D41 vẫn là kiểm tra riêng, không thay số đo giải phẫu |

Tham chiếu: [D44](DECISIONS.md), [chuẩn semi-chibi](art/style-semichibi.md), [sheet tỉ lệ](art/semichibi-proportions.svg). D46 chỉ chốt profile số khung/thời gian smooth-v2, không tự đóng các mục D44-02–04.

## 14. Hệ kỹ năng 6 Đạo Lộ (D49): việc còn mở

Số liệu D49 đều là **Đề xuất – chờ duyệt**; mô phỏng ở `@vgtd/shared` chỉ là mốc kiểm tra, không phải cân bằng cuối.

| ID     | Khoảng trống                                                                                                                                                                                                       | Trạng thái / người chốt                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| D49-01 | Concept ngoại hình, tên, bảng màu và bộ clip **Thương tu** (trường thương) và **Đao tu** (trảm đao) theo D41/D44/D45 (master, body / weapon / FX tách lớp; weapon thương dài 3–4 ô cần socket / hitbox dài hơn)    | **Mở — art + chủ dự án duyệt concept** |
| D49-02 | Ngân sách asset 10-mvp-scope (Pháp y 4 Đạo Lộ × 3 mốc = 12 bộ, phi kiếm, class pack 02 §5) cần tính lại cho 6 Đạo Lộ                                                                                               | **Mở — orchestrator / art**            |
| D49-03 | Game designer duyệt hệ số cân bằng: DPS solo, hệ số nhánh TEAM, ETD (hệ số 0,5), boss / đàn quái mẫu; thay bằng dữ liệu chơi thật khi có beta                                                                      | **Mở — game designer** (OPEN-ITEMS #7) |
| D49-04 | Chưa mô phỏng PvP, quái có CC, kite liên tục của Pháp tu, dấu hệ Linh căn và phạt ngoài hệ, boss nhiều mục tiêu; Pháp tu chết nhiều nhất khi quái mạnh (21%) — theo dõi                                            | **Mở — mở rộng `skill_sim.ts`**        |
| D49-05 | Phí / hồi chiêu đổi nhánh công pháp (docs/11 S12), quy tắc đổi trong chiến tranh tông môn / PvP; hệ Lôi (Thương) và Phong (Đao) là đề xuất, cần xác nhận với bảng Ngũ hành / biến dị                               | **Mở — chủ dự án**                     |
| D49-06 | Kỹ năng quái / boss dùng chung schema nhưng `skill_definitions.schema.json` hiện chỉ phủ `owner = player`; mở rộng (telegraph, owner) khi làm nội dung quái; cơ chế "CC cứng ngắt chiêu boss" cần vào docs/08 / 24 | **Mở — network / server**              |
| D49-07 | Phù Linh (linh thú của Đan/Phù tu) là thực thể phụ chưa có spec asset / netcode (AOI, đồng bộ, giới hạn số thực thể)                                                                                               | **Mở — network + art**                 |

Tham chiếu: [D49](DECISIONS.md), [docs/11 §2.0, §4, §4.8](11-he-phai-ky-nang.md).

## 15. Play-test chibi: chế độ đi bộ và ngưỡng idle/walk/run (client tạm)

Bản play-test `ChibiBody` / `PlayerActor` (apps/client-cocos) dùng các giá trị **placeholder chỉ để play-test**, chưa có trong docs:

- **Chế độ đi bộ**: giữ Shift thì tốc độ di chuyển nhân với `PlayerActor.WALK_SPEED_FACTOR = 0,5` (4,5 → 2,25 ô/s).
- **Ngưỡng clip theo tốc độ ô thực đã đi**: dưới 0,3 ô/s là `idle`, dưới 3,2 ô/s là `walk`, từ 3,2 ô/s là `run`.

docs/08 §4 chỉ quy định công thức tốc độ di chuyển (4,5 × (1+(TP−100)/400)) và docs/31 I-08 vẫn ghi 4,5 là placeholder; không tài liệu nào định nghĩa chế độ đi bộ, tốc độ đi bộ hay ngưỡng chuyển clip. Cần game designer hoặc owner quyết định (có chế độ đi bộ không, hệ số tốc độ, ngưỡng clip) trước khi coi các giá trị này là cuối cùng; trong code chúng được đánh dấu PLAY-TEST ONLY.

## 16. Công thức lõi P3 (`@vgtd/shared`): mặc định đã chọn khi docs chưa rõ

Các hàm `drops.ts` (docs/07 §6) và `skill_table.ts` (docs/11 §4) dùng mặc định có ghi dưới đây; chưa có giá trị mới nào được bịa, cần game designer xác nhận:

- **Quái thấp hơn 1 cảnh giới**: nhân ×0,2 cho **xác suất** của mọi vật phẩm (không nhân số lượng). Thấp hơn từ 2 cảnh giới: chỉ còn nguyên liệu nghề, giữ nguyên xác suất in trong bảng (docs chỉ nói "chỉ còn nguyên liệu").
- **Linh khí cạn kiệt (>2 giờ liên tục)** ×0,5 và **tổ đội 1/√n** nhân vào **xác suất**, không phải số lượng; áp cho cả mục 100% (docs chỉ nói "×0,5" / "hệ số 1/√n").
- **Số lượng Linh thạch ×1,5^(r−1)**: nhân sau khi roll khoảng số lượng, làm tròn half-up, tối thiểu 1 khi đã rơi (docs không nêu làm tròn). Vật phẩm khác không nhân theo cảnh giới.
- **Boss lặp lại (rương tuần đã nhận)**: chỉ còn Linh thạch, số lượng ×0,3 (làm tròn như trên, tối thiểu 1), không đan, bản vẽ hay nguyên liệu (docs: "chỉ nhận Linh thạch × 0,3, không có bản vẽ").
- **Pity bản vẽ Vàng–Đỏ**: từ lần 1 đến 29 xác suất lần n thay cho 0,2% in trong bảng khi truyền `goldRedAttempt` (không truyền thì dùng 0,2%); docs không nói đoạn dốc này có nhân hệ số quái thấp/cạn kiệt/tổ đội hay không: hiện vẫn nhân. Từ lần 30 trở đi trả về 1 ("chắc chắn rơi" là quy tắc rõ của docs/07 §6), bất chấp mọi hệ số; chỉ còn bị loại khi nguồn không rơi bản vẽ (boss lặp lại, quái thấp từ 2 cảnh giới).
- **Phẩm bản vẽ**: roll trong khoảng phẩm của dòng đã trúng, theo phân bổ của nguồn được chuẩn hóa lại trên khoảng đó (Trắng–Lục, Lam–Tím, Vàng–Đỏ); đan dược dùng toàn bộ phân bổ.
- **Thứ tự RNG** của `resolveDrops` (một lần rút cho trúng/trượt mỗi vật phẩm theo `DROP_ITEM_ORDER`, rồi số lượng, rồi phẩm) là quy ước kỹ thuật để xác định; server sẽ dùng PRNG có seed như mô phỏng D49.
- **docs/11 §4.5**: dòng đầu bảng Thương tu (S1) in nhầm một câu mô tả "Chốt D49" thay cho hàng `xuyen_van_thich`; số liệu kỹ năng này lấy từ `skills.json`, test đối chiếu docs/11 bỏ riêng hàng này. Cần sửa lại hàng S1 trong docs/11.

## D54 — rebuild các hướng sprite đã merge (worker24, 2026-11-08)

[Cập nhật D55: mục D54 dưới đây là lịch sử trước D55. Audit pin mới xác nhận cả 33 ô hết lỗi cứng A+C; danh sách đang mở hiện tại là 11 ô Lab trong mục D55 bên dưới. Không cần repaint chỉ vì L1 cũ.]

**Mở — các hướng dưới đây không thể rebuild sạch sau D54 cho tới khi sửa art và kiểm lại similarity.** Ngưỡng vẫn ≥0,70; không hạ ngưỡng, không đổi dash thành free, không sửa art trong PR tooling. `validation.json` hiện có là bằng chứng lịch sử trước D54, không phải nghiệm thu lại.

| Project                                                     | Clip   | Ô local (0-based) fail | Chủ sửa  |
| ----------------------------------------------------------- | ------ | ---------------------- | -------- |
| `assets-src/placeholder/dan-phu-tu-chibi-v1/E/project.json` | `dash` | 1–7                    | worker26 |
| `assets-src/placeholder/dan-phu-tu-chibi-v1/E/project.json` | `run`  | 0–15                   | worker26 |
| `assets-src/placeholder/dao-tu-chibi-v1/SE/project.json`    | `dash` | 3–6                    | worker33 |
| `assets-src/placeholder/the-tu-chibi-v1/E/project.json`     | `dash` | 3–6                    | worker24 |
| `assets-src/placeholder/the-tu-chibi-v1/E/project.json`     | `run`  | 5–6                    | worker24 |

Bản [tóm tắt audit trong repo](art/head-reason-similarity-audit-d54.md) giữ số lượng, mốc mã/hash và phạm vi exemptions. 15 ô bow upright D41 giữ miễn như trước, không phát sinh gate mới; head reasons không miễn similarity.

Tái lập từ repo root sau `npm ci`:

```bash
npm run sprite:audit-head-similarity -w @vgtd/sprite -- --root assets-src/placeholder --out D:/Temp/head-reason-similarity-audit.json
```

Điều kiện đóng: PR art riêng giữ motion arc, edit-from-master và khóa mặt/thân; similarity ≥0,70, các gate khác và capture Cocos theo pipeline. Worker24 sửa 6 ô Thể tu E sau PR NE; worker26 phụ trách Đan/Phù E. Audit đầy đủ chỉ báo cáo, không tự đóng mục này.

## D55 — 11 ô palette chặn rebuild (worker24, 2026-11-08)

**Mở — gate cứng Lab: đầu ≤15 / thân ≤23.** Các project/ô dưới đây không rebuild sạch cho tới khi sửa hoặc có
quyết định tiếp theo chứng minh đó là lighting/expression hay vấn đề cửa sổ đo. Không tự hạ trần, đổi điểm để hợp score,
hoặc thêm pose exception để che lỗi. `validation.json` đã commit trước D55 là bằng chứng lịch sử, không thay audit hiện tại.
Không sửa art/evidence/export trong PR tooling này.

| Project                                                       | Clip       | Ô local (0-based)      | Owner    |
| ------------------------------------------------------------- | ---------- | ---------------------- | -------- |
| `assets-src/placeholder/phap-tu-fan-sprite-v1/N/project.json` | `attack`   | 2                      | worker25 |
| `assets-src/placeholder/phap-tu-fan-sprite-v1/N/project.json` | `cast`     | 3                      | worker25 |
| `assets-src/placeholder/the-tu-sprites-v1/S/project.json`     | `attack_2` | 0, 1, 2, 3, 4, 5, 6, 7 | worker24 |

Artifact `similarity-identity-temporal-audit-palette-findings.html` trong [session worker24](ao://sessions/van-gioi-tien-do/van-gioi-tien-do-24)
có từng crop master/ô, context 256px, tọa độ và SHA256. Không scale lại frame; crop chỉ phóng to đồng đều để xem.
Bản [tóm tắt D55 trong repo](art/identity-temporal-calibration-d55.md) giữ từng ô và giá trị; audit JSON giữ mọi score/pair/hash.
Tái lập bằng `sprite:audit-similarity-controls` và `sprite:audit-similarity-crops` theo README của `@vgtd/sprite`.

[Cập nhật worker25, 2026-11-08: đóng riêng Pháp tu semi-chibi S dash3 bằng evidence thật, không repaint. Cửa sổ fallback cũ kết thúc y61, bỏ phần lớn mặt trong tư thế dash; crown chính của cap (loại bun/curl nâng cao) là (130,44), chin thật (130,92), alpha255. Dùng cùng semantic với master S và ô dash2 đã lưu; hàng cap44 có run liên tục x128–132, midpoint130. Head48,000/master48,010px (ratio0,999783) qua D47; D55 cửa sổ neo cho headLab6,063786 và torso5,631270, dưới trần15/23. QA0 hard/0 soft mới/0 regression; 17 foot findings vẫn mở. Năm tệp render byte-identical, không đổi pose exception hoặc ngưỡng. Bằng chứng và hash ở [S/dash3-d55-review.json](../assets-src/placeholder/phap-tu-chibi-v1/S/dash3-d55-review.json). Bảng/số liệu audit D55 ban đầu được giữ như lịch sử, hai finding legacy Pháp N chưa sửa.]

**Đánh giá lại D54: 33 ô L1 cũ đều có 0 lỗi cứng A+C và 0 lỗi cứng khác trong audit pin D55.** Đan/Phù E run0–15,
dash1–7; Thể E run5–6, dash3–6; Đao SE dash3–6 không còn là rebuild blockers theo metric mới. Đóng phần việc repaint
chỉ do L1 của danh sách D54, không gọi đó là sửa art hoặc chứng nhận identity bằng thuật toán. L1 chỉ chẩn đoán;
review contact sheet bằng mắt vẫn bắt buộc. Bảng D54 phía trên giữ lịch sử của gate trước D55.

Temporal pair <0,45 là INFO review-by-eye, không fail; mirror được flag này cộng review contact sheet. Head-size ±3%
vẫn là gate scale. 10 ô thiếu opaque đều miễn D41, ghi coverage riêng và không tính fail. Đan/Phù SE candidate dash5
vẫn fail head-size thật; Kiếm E candidate còn thiếu bằng chứng đầu, không được suy pass từ palette.

### D55 — annotation cần review, không phải repaint (Đao SE, worker33)

Emote local7/8 có điểm đầu cũ chưa đăng ký semantic đúng theo kiểm tra native của owner33: chin7 ở cheek, crown7 ở
curl nâng cao, breadth chưa ở cực trị tóc ôm sọ; điểm8 cũng chưa theo đúng dịch chuyển đầu. Face/costume vẫn nhất quán,
không repaint từ score. Chưa có full replacement landmarks được freeze; không sửa điểm trong PR D55 và không dịch điểm
để hợp ngưỡng. Pair temporal thấp được flag review-by-eye; owner33 cần cross-check cùng contour master rồi đánh giá lại.
Đây là việc review annotation riêng, không cộng vào11ô Lab hard ở trên. Cohort33ô D54 được lưu portable tại
`docs/art/head-reason-similarity-cohort-d54.json` để mọi worker tái lập A+C.

## P2-1 — còn mở sau D68/D69

- `CastInput` chưa mang điểm đất / hướng nên kỹ năng `ground` / `direction` chưa có kiểm tra tầm và LOS tới điểm; cần mở rộng giao thức (v2) khi làm chiến đấu server. [Cập nhật: `skill_cast` có điểm ngắm tùy chọn từ giao thức v3, #213 (D78); điểm ngắm cảm ứng vẫn mở, xem §1 dòng 10.]
- `skill_patches` của nhánh (cooldown_mult, …) chưa áp trong `compileSkills()`; cần hồ sơ nhân vật ở World Node.
- PRNG theo luồng đặt tên: mới dùng `combat`; thứ tự rút của `ai`, `drop`, `breakthrough`, `tribulation`, `craft` phải được ghi khi từng hệ thống được cài đặt (ADR-010 điểm 3).

## P2-2 — còn mở sau D70

- Argon2id thay scrypt (docs/25 §2.3): cần thử thư viện native trên Windows/Linux/CI rồi đo thời gian băm thật; hiện **chưa đo** trên máy chủ thật.
- Refresh token / xoay vòng họ token / thu hồi cả họ, cookie `__Host-`, CSRF, kho `AccountStore` PostgreSQL, `audit_log` cho đăng nhập (docs/25 §3).
- `hello` / `hello_ack` Protobuf (docs/24 §4): vẫn là JSON. ~~`resume` sau rớt mạng ≤ 10 s~~ **đã xử lý ở D80** (qua `hello` JSON, không phải thông điệp Protobuf `resume`).
- Chưa có Cell Handover giữa nhiều World Node, lag compensation, kỹ năng có sát thương (`hits[]` rỗng; [đã có sát thương: #206]), `CastInput` điểm đất/hướng ([đã có: #213]).
- Số đo tải mới chạy bot trên cùng máy với server (worker thread, loopback): chưa phản ánh độ trễ mạng thật, TLS, nhiều lõi bận khác; cần chạy lại trên máy chủ mục tiêu và với client Cocos thật.

## D71 — phần client (đã triển khai ở PR client-cocos)

Preset nén ASTC/WebP, bundle `chibi-<lớp>-<hướng>` sinh trong `prepare:assets`, nạp lười có hàng đợi (bootstrap chỉ nhóm `loco` của người chơi) và `?restier=1x|full` có trong PR client-cocos. Số đo ở `docs/06-toi-uu-render.md`; các việc còn mở ở mục kế tiếp.

## D71 — còn mở sau tối ưu runtime atlas chibi (worker39, 2026-11-08)

1. **Điện thoại thật / WebP**: số đo D71 là headless SwiftShader (có ASTC). Cần chạy `perf:p1` trên 1 điện thoại thật (LAN, docs/33) và trên trình duyệt không có ASTC (đường WebP) trước khi đóng P1.
2. **ETC2**: công cụ ETC2 của Cocos 3.8.8 (Mali etcpack) báo `Invalid Parameter - tmp.ppm` trên Windows nên preset chỉ có ASTC + WebP. Thiết bị WebGL không có ASTC dùng WebP (RAM GPU RGBA8 ≈ 4–9× ASTC). Cần kiểm tra lại trên máy build Linux/CI hoặc chấp nhận.
3. **KTX2/Basis**: Cocos 3.8.8 không có đường build KTX2 gốc (docs/00 §3 vẫn ghi KTX2). Cần quyết định giữ ASTC/WebP của builder hay thêm bước hậu build.
4. ~~**Bản release còn chứa art dev**~~ — đã xử lý (#200): `build:web --release` build trên bản stage không có `assets/resources/dragonbones` (`scripts/release-stage.mjs`; bundle `resources` 229 MB → 0,2 MB, cả build 346 → 119 MB). Trình xem `#viewer` không có trong bản release; `--keep-dev-art` build đủ.
5. **Nhóm `rest`**: `ChibiBody.ensureGroup('rest')` đã có nhưng chưa clip chiến đấu nào gọi; gọi trước khi phát clip ngoài idle/walk/run. Chất lượng 1x (Lanczos3, ASTC 4x4) chưa được art duyệt bằng mắt trên máy thật.
6. **Ngân sách `CHIBI_RUNTIME`** (trần loco/bundle/GPU lớp) là mặc định kỹ thuật, cần game designer/đo thiết bị duyệt.
7. **Atlas tile/bản đồ**: đo `perf:p1 --route` (bản đồ 8×8 chunk, release, ASTC/WebP): gói tải đầu 7,29 MB (gzip 2,51), trong đó `iso-tileset.png` 0,16 MB và JSON bản đồ 0,62 MB (≈ 11 %); engine `cc.js` 1,86 MB và các armature chibi của người chơi chiếm phần lớn. Nén atlas tile **chưa cần**; nếu bản đồ lớn hơn, ứng viên là tách JSON bản đồ theo chunk (nạp lười) chứ không phải nén tileset.

## P2-3 — còn mở sau D72 (client online)

- **Bản đồ**: server dùng lưới mở, client vẽ tilemap procgen 256x256; nước/cây/đá chỉ chặn ở client offline (không chặn online). Cần nạp lưới va chạm procgen (cờ đi được, tầng) vào `WorldNode`/client chung nguồn trước khi coi online là chơi được.
- ~~**Lớp nhân vật trên dây**~~ [đã xử lý: #223, D82 — `defId` mang lớp, có picker]: `aoi_enter` chưa có lớp, nên lớp người khác suy ra từ `entityId` (D72); cần giao thức v2 (kèm tên hiển thị, trang bị cho paperdoll).
- **Nội suy**: tuyến tính, không ngoại suy, không Hermite (docs/08 §5); trễ đã thích ứng theo từng thực thể (D73: max(150 ms, 1,25 × khoảng cách snapshot), tối đa 250 ms) nhưng chưa tính jitter mạng riêng; đồng hồ server (8 gói ping/pong, trung vị) chưa có nên dùng giờ nhận gói.
- **Chưa làm phía client** [Cập nhật: `skill_cast`/`skill_result` và `ServerCombat` đã có, #206, #209, #213; thanh HP, số nổi, màn chết, #225]: `skill_cast`/`skill_result`, bay/né/khinh công (cờ có trong input nhưng chưa gán phím), hiển thị tên/HP người khác, quái/NPC (chỉ vẽ `kind` 0).
- **Chưa chạy được trên CI**: build Cocos và chơi 2 tab không có trong CI; phần tự động là test đơn vị `packages/client-core/tests/net.test.ts` và test đầu-cuối `apps/server/tests/netclient.test.ts` (2 NetClient + server thật). Chưa kiểm bằng trình duyệt thật trên di động.
- **Tiêu chí P2 còn lại (đo 2026-11-08, bot trên cùng máy, loopback, 100 bot, 30 s)**:
  - Chặn gian lận: 3 bot speedhack bị ngắt sau 0,3 s, 3 bot teleport bị ngắt sau 3,8 s (tốc độ quan sát tối đa được kẹp ở tốc độ trung thực 4,55 ô/s): **đạt**.
  - AOI 100 vs 100 (cả 100 bot trong một vùng 30-40 ô, mỗi người thấy 96-99 người khác): 100/100 giữ kết nối, nhưng **băng thông xuống của người xấu nhất vượt ngân sách 8 KB/s**: 8,04 KB/s (vùng 40 ô, trung bình 7,08, thấy 96,6) và 8,67 KB/s (vùng 30 ô, trung bình 8,08, thấy 98,6). Tick p99 25,2 ms và 38,5 ms (sát 40 ms; lần sau đo khi máy còn Chrome/Cocos chạy nền nên có nhiễu CPU). Mật độ vừa (~40 người thấy nhau) vẫn đạt: 3,3-3,7 KB/s.
  - [Đã xử lý bởi #202 (D73): băng thông 100 vs 100 xuống dưới 8 KB/s, xem D74 mục 6 và "P2 exit".] Hướng giảm (khi đó chưa làm, cần quyết định): hạ tần số dải "gần" khi số người thấy > ~60, bỏ `anim`/`dir` khi không đổi, hoặc hạ `MAX_VISIBLE` từ 120. Cho tới khi đó tiêu chí "100 vs 100 ≤ 8 KB/s" **chưa đạt** ở mật độ 100%.
  - Chưa đo với client Cocos thật trên mạng thật.

## D73 — băng thông snapshot: còn mở

- ~~Client chưa chịu được tần số thấp~~ **Đã xử lý (#207)**: `RemoteWorld` dùng trễ nội suy theo từng thực thể = max(150 ms, 1,25 × khoảng cách snapshot quan sát được), tối đa 250 ms (`NETWORK.INTERP_SPACING_FACTOR`), và chèn mẫu "đứng yên" sau khoảng lặng dài (bản ghi không đổi bị bỏ, D73) để thực thể không giật khi bắt đầu đi. Có test độ mượt ở 5 Hz (`packages/client-core/tests/interp.test.ts`). Chưa kiểm bằng mắt trên client thật với bot 5 Hz.
- Chưa có "luôn 20 Hz cho đồng đội / mục tiêu / kẻ tấn công" (chưa có nhóm và chọn mục tiêu); trần 40 thực thể ở 20 Hz đang áp cho mọi người.
- Số đo mới chạy bot trên cùng máy, loopback (xem PR); bot không nội suy nên chưa đo cảm giác mượt của vùng 10/5 Hz.

## D74 — quái trên World Node: còn mở (worker39, 2026-11-08; #204)

1. **Số AI / hồi sinh / số lượng spawn là mặc định tạm** (`MOB_AI`, `MOB_RESPAWN_MS`, `ZONE_SPAWN_TABLES` trong `@vgtd/shared`): aggro, dây xích, tầm áp sát, lang thang, hồi sinh, số quái mỗi vùng. Cần game designer duyệt; docs/07 §6 chỉ có nhịp hạ gục theo giờ (150 thường / 20 tinh anh), chưa có mật độ hay thời gian hồi sinh.
2. **Vùng trên bản đồ thật**: server dùng `defaultMobZones(n)` (4 góc quanh tâm) cho bản đồ thử; tọa độ vùng thật phải đến từ bản đồ (docs/04 §5 chưa có tọa độ ô).
3. **Chưa có chiến đấu** [Cập nhật: quái nhận sát thương qua lõi combat #206, drop vào túi #214, quái tấn công người chơi #229 (D86)]: quái không nhận/gây sát thương; `MobManager.kill()` là móc cho bước tiếp theo (hồi sinh theo tick đã có test). Kỹ năng đặc biệt có telegraph (docs/10 §4), tinh anh gọi quái, boss nhiều pha, drop (07 §6) chưa làm.
4. **Aggro đơn giản** [bảng threat: #224, D83]: mục tiêu = người chơi gần nhất, chưa có bảng aggro/threat (docs/11 có hệ số aggro theo nhánh), chưa có tầm nhìn/LOS, chưa có chia sẻ aggro theo nhóm, chưa có AI né chướng ngại ngoài va chạm `stepMove` (quái có thể kẹt tường; lượt lang thang tự hủy sau 6 s).
5. **Client**: chưa có art quái nên `defId` chưa được dùng để chọn hình; client v1 (nếu có) bị gateway từ chối do `PROTOCOL_VERSION = 2`.
6. **Băng thông với nhiều quái** (đã chạy lại SAU #202 / D73): `npm run loadtest -w @vgtd/server -- --bots 100 --duration 20 --mobs N` (100 bot trong ô 96×96, N quái cùng ô, máy dev dùng chung với worker khác): N = 0 → tick p99 15,3 ms (mẫu lớn nhất 25 ms), tải xuống xấu nhất 2,67 KB/s, 39 thực thể nhìn thấy; N = 150 → p99 12,95 / 23,5 ms ở hai lần chạy lại (lần đầu 52,8 ms với 8 tick > 50 ms, do nhiễu máy dùng chung), 4,8–4,9 KB/s, 91; N = 301 → 12,9 ms, 5,70 KB/s, 117; N = 602 → 15,0 ms, 6,42 KB/s, 120 (kín trần `MAX_VISIBLE` = 120). Trước #202 (tham khảo): 301 quái 8,04 KB/s và 602 quái 9,30 KB/s đều trượt ngưỡng 8; #202 (bỏ bản ghi không đổi + dải theo khoảng cách ô) đưa cả hai về dưới 8. Còn mở: tick p99 thỉnh thoảng có mẫu đơn lẻ > 50 ms (GC / máy dùng chung), cần đo lại trên máy riêng.
7. ~~**Id người chơi không được tái sử dụng**~~ — đã xử lý: `WorldNode` giữ danh sách id đã giải phóng với thời gian cách ly theo giờ sim (`WORLD_CONFIG.PLAYER_ID_QUARANTINE_MS` = 30 s) rồi mới cấp lại (id thả sớm nhất trước), nên số id dùng được bám theo số người chơi đồng thời chứ không phải tổng lượt vào; với quái bật, id vẫn dưới `MOB_ID_BASE`. `canAcceptPlayer()` cho gateway kiểm tra chỗ **trước** khi thay kết nối cũ của cùng tài khoản (join bị từ chối không còn đá phiên đang chơi). Hết id (mọi id đang dùng hoặc đang cách ly) vẫn ném `WorldFullError` → `ServerFull`.

## P2 exit — số đo bằng `npm run p2exit` (2026-11-08; #212)

Công cụ: `npm run p2exit -w @vgtd/server -- <flight|badnet|loginstorm|cooldown|soak|war> [tùy chọn]` (mã ở `apps/server/src/loadtest/scenarios.ts`; mỗi kịch bản in số đo + PASS/FAIL và thoát mã 1 nếu trượt). Tất cả số dưới đây là **cùng một máy, loopback, không TLS**, máy dev có tiến trình khác chạy nền (p99 dao động).

| Kịch bản (docs/28 §6)      | Lệnh / tham số                                                                   | Kết quả                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4 bay ngự kiếm 18 ô/s     | `flight` (50 bay, vùng 200x200, 30 s)                                            | **Đạt**: 50/50 không bị đá, tốc độ quan sát 18,2 ô/s (giới hạn 18), không vi phạm; tick p99 6,0 ms; xuống tối đa 1,05 KB/s; AOI vào/ra 2,7/s mỗi người.                                                                                                                                                                                                                                              |
| S6 mạng xấu                | `badnet` (50 bot + 10 client netcode thật)                                       | **Đạt**: qua proxy 150 ms một chiều ±80 ms, 5 % mất gói (mô hình hóa thành TCP dừng chờ phát lại 300 ms): RTT p50 405 ms (p99 900 ms); 50/50 không rớt, 0 ngắt phía server; 10/10 client netcode thật còn online, **sai lệch đối soát 0** ở 6002 snapshot (không lần nào > 0,15 ô); tick p99 10,5 ms. Snapshot đầy đủ 0 % (chưa chạm ngưỡng 1 s không ack nên **đường resync chưa được thử** ở đây). |
| S7 bão đăng nhập           | `loginstorm` (500 đăng nhập / 10 s, 100 bot online)                              | **Đạt**: 500 × 200, độ trễ p50 36 ms / p99 45 ms, tick p99 8,0 ms, 100/100 bot không rớt. Ép hơn (`--window 1`, 500 trong 1 s): 211 × 200 + 289 × 503 (hàng đợi băm đầy trả `503` ngay, p99 812 ms), tick p99 8,7 ms. Dùng **scrypt**, chưa phải argon2id.                                                                                                                                           |
| Cooldown hack              | `cooldown` (3 bot spam kỹ năng 0 mỗi tick)                                       | **Đạt**: 3/3 bị đá sau 1,4 s, mỗi bot ≤ 1 lần cast được chấp nhận; 154 vi phạm cooldown; 30/30 bot trung thực không ảnh hưởng.                                                                                                                                                                                                                                                                       |
| S5 soak                    | `soak --minutes 2` (100 bot)                                                     | **Đạt trong 2 phút**: heap sau gc +0,9 % so với mốc 25 %, lệch nhịp tick 0,013 % (16 ms / 120 s), p99 cửa sổ tệ nhất 10,4 ms, 0 bot rớt. **Chưa chạy 4-8 giờ với 200 bot** (docs/28): cần máy đích; lệnh `--minutes 240 --bots 200` đã sẵn.                                                                                                                                                          |
| S3 chiến tranh (200 người) | `war` (200 người / 40x40 ô, 150 quái, mỗi người cast ~1 lần / 0,9 s, bật combat) | Xuống tối đa **6,8 KB/s** (ngân sách war 25), lên 0,4 KB/s, thấy 120 thực thể (trần), 0 bot rớt, ~4,5 nghìn cast được chấp nhận, ~400 hit. **Tick p99 31,4 / 42,9 / 43,9 ms ở 3 lần chạy: trượt/sát ngưỡng 40 ms ở 200 người** (p50 16-17 ms; AOI ~10 ms mỗi nhịp AOI + mã hóa snapshot ~9 ms, tăng gần theo bình phương số người).                                                                  |

Còn mở / lưu ý:

- **S3 chưa phải "100 vs 100" đúng nghĩa**: chưa có PvP nên không có hai phe; đây là 200 người đánh quái. `skill_result` chỉ gửi cho người cast, nên chưa có băng thông "sát thương gộp" cho người xem (docs/08 §8 dự tính ~20-25 KB/s). Đo lại khi có PvP / thông báo sát thương cho người khác.
- **Tick p99 ở 200 người là rủi ro thật**: sát 40 ms trên máy dev. Chi phí chính là AOI (mỗi người sắp xếp ứng viên) và mã hóa snapshot, đều tuyến tính theo người nhận × số thực thể thấy được. Cần đo trên máy đích; nếu vẫn sát thì tối ưu AOI (băm theo ô đã có, bỏ sắp xếp toàn bộ) / chia việc mã hóa ra worker. Tiêu chí docs/10 (p99 <= 40 ms ở **100** CCU) vẫn đạt với biên lớn (6-10 ms).
- **Cập nhật — tối ưu chi phí tick (AOI + mã hóa snapshot), đầu ra giữ nguyên từng byte (#222)**: đo bằng `npm run bench:tick -w @vgtd/server` (World Node trong tiến trình, không socket, không worker, đầu vào xác định, đồng hồ gói ảo; có `--hash` để so từng byte). 200 người dồn trong 40x40 ô + 150 quái, tốt nhất của 5 lần chạy, cùng điều kiện máy, đối chiếu logic cũ (main) với logic mới: tick **13,3 -> 7,3 ms** (trung bình), p99 **30,5 -> 15,6 ms**, CPU mỗi tick **12,5 -> 7,0 ms**; AOI mỗi nhịp AOI **10,9 -> 3,8 ms**, snapshot **7,0 -> 4,3 ms**; số khung / số byte **y hệt** (170975 khung, 27.976.427 B). Thay đổi: bỏ quét + sắp xếp ứng viên AOI khi người nhận đã đủ trần thực thể (trong đám đông gần như mọi người đều ở trần), một lượt duyệt tập thấy được thay vì ba, khoảng cách bình phương thay `Math.hypot` và chỉ sắp xếp tập vùng gần, bộ nhớ đệm snapshot theo thực thể mỗi tick (thay vì mỗi cặp người nhận x thực thể), `BitWriter` theo khối và bộ ghi dùng lại. Bảo vệ: `tests/snapshot-golden.test.ts` (checksum của toàn bộ luồng byte, lấy từ **mã chưa tối ưu**).
  - **Chưa chứng minh được "p99 rất xa dưới 40 ms" ở kịch bản `war` có socket**: trên máy dev dùng chung, p99 của `war` dao động 30-124 ms giữa các lần (CPU của tiến trình khác làm mọi pha cùng khựng, kể cả bước mô phỏng trung bình 1 ms nhảy lên 186 ms), nên không phân biệt nổi 5 ms. Những lần yên tĩnh cho p99 38-40 ms. Phần còn lại là chi phí `ws.send` trên socket (pha snapshot trong `war` ~10 ms so với ~4,3 ms của bench): ~30 µs x 200 khách mỗi tick trên Windows. Cần đo lại trên máy đích (Linux).
  - Việc tiếp theo nếu vẫn sát: xếp lệch AOI (nửa số khách ở tick chẵn, nửa ở tick lẻ: mỗi khách vẫn 10 Hz nhưng tick chẵn không còn nặng gấp đôi, p99 giảm ~nửa chi phí AOI) — đổi dòng byte nên cần cập nhật golden và ghi rõ; hoặc gộp ghi socket.
- Bot chưa theo dõi GCD hoàn hảo nên vẫn ~12 % cast bị từ chối vì cooldown từng kỹ năng (~0,1 vi phạm/giây/bot, điểm nghi vấn trừ 1/phút): với client thật (đọc `readyAtMs`) thấp hơn; nếu soak dài với `war` thấy bot bị đá thì xem lại ở bot, không phải ở guard.
- **S6 là mô hình**: proxy TCP trong tiến trình (trễ + jitter + dừng chờ phát lại, giữ nguyên thứ tự byte), không phải bộ giả lập mất gói của hệ điều hành, không giới hạn băng thông, không điều khiển tắc nghẽn. Đã sửa một lỗi của chính proxy khi viết (hai `setTimeout` có độ trễ gần nhau có thể bắn sai thứ tự, làm đảo khung WebSocket và hiện ra thành "sai lệch đối soát 1 ô"): nay dùng một hàng đợi FIFO một bộ hẹn giờ cho mỗi chiều, có test.
- Chưa đo: S5 nhiều giờ, mất gói thật ở tầng mạng, TLS, thiết bị di động thật, argon2id.

## 17. Tiến trình tu luyện server (D76, #205): mặc định đã chọn khi docs chưa rõ

`apps/server/src/progression` dùng các mặc định sau, chưa có giá trị gameplay mới nào được bịa; cần game designer xác nhận:

- **Hậu quả thất bại đột phá** ("linh áp phản phệ", docs/01): chỉ cộng `n_fail` (đại cảnh) và giữ nguyên tu vi đã tích; docs chưa nêu mất tu vi, thời gian hồi phục hay phạt khác. Tiểu cảnh thất bại không cộng pity (07 §2 chỉ nói pity cho ngưỡng lớn).
- **Giới hạn chống lạm dụng** (mốc kỹ thuật, không phải số game design): đả tọa bị chặn nếu có input di chuyển trong 400 ms, hoặc cast/trúng đòn trong 10 s; bucket 6 lệnh hồi 1 lệnh/0,5 s; đột phá cách nhau 3 s. Cần quyết định có "chiến đấu" bao gồm cả bị đánh khi chưa có quái, và thời gian khóa thật.
- **Tu vi đầy**: tự dừng đả tọa ở `Req(s)` (không tích thừa); đột phá không tiêu hao tu vi khi thất bại.
- **Đả tọa ở mọi nơi**: mặc định ρ = 1,0 và đất ngũ hành đều (Match = 1) cho tới khi có dữ liệu map/Linh Mạch (`MeditationEnv`); thành chính 0,6 và Linh Mạch của 07 §5 chưa nối.
- **Linh căn nhân vật mới** roll từ PRNG theo `characterId` (tỷ lệ loại và 2% biến dị của 07 §5; mỗi hệ có trọng số bằng nhau, biến dị chỉ ở Mộc/Kim/Thủy vì chỉ ba hệ này có dạng biến dị). Cách người chơi chọn hay đổi linh căn chưa có.
- **Cột dữ liệu**: `n_fail` (bộ đếm pity) chưa có trong docs/23 §4.2; hiện lưu cùng bản ghi (`ProgressRecord.nFail`) và cần thêm cột/`jsonb` khi viết migration.
- **[Cập nhật D97: Trúc Cơ → Kim Đan và Kim Đan → Nguyên Anh đã chạy (Tâm Ma + Lôi Kiếp, mục 22); Luyện Khí → Trúc Cơ roll thẳng; cảnh giới cao hơn vẫn bị `TribulationRequired`.]** **Đột phá đại cảnh bị khóa** (D76): docs/01 §5 định nghĩa ngưỡng lớn là Tâm Ma → roll → Lôi Kiếp (thất bại có ý nghĩa, P1); các cơ chế đó chưa có nên server từ chối mọi lần đột phá đại cảnh bằng `ProgressionReason.TribulationRequired` (9), đồng thời cooldown 3 s và việc giữ nguyên tu vi khi thất bại là mốc kỹ thuật tạm. Bật lại bằng `allowMajorBreakthrough` khi Tâm Ma/Lôi Kiếp xong; cần quyết định hậu quả thất bại.
- **Giai đoạn cuối**: tầng 41 (Độ Kiếp viên mãn) không thể đột phá tiếp (Phi Thăng chưa thiết kế).
- **Hết hạn kết quả idempotency**: chỉ giữ 16 kết quả đột phá gần nhất mỗi phiên trong RAM; docs/26 §4 chưa chọn nơi lưu khóa idempotency lâu dài.
- **Thân thông điệp họ Lạnh** là bố cục nhị phân cố định thay cho Protobuf cho tới khi có pipeline `buf` (docs/24 §2).

## 18. HUD tu luyện (D76, worker35, #215): chữ giao diện và bố cục còn mở

- **Chuỗi tiếng Việt** (tên cảnh giới `REALM_NAMES` / `SUB_STAGE_NAMES` trong `@vgtd/shared`, các câu từ chối và toast trong `client-core/ui/ProgressionView.ts`) là bản đầu, chưa qua biên tập viên; chưa có hệ khóa i18n (docs/21), nên chuỗi nằm trong code. Cần chốt thuật ngữ (vd. "đả tọa" / "đột phá tiểu cảnh").
- **Phím tắt**: `M` đả tọa và `N` đột phá là mặc định kỹ thuật; docs/21 chưa có bảng phím và `B` thuộc túi đồ. Cần bảng phím thống nhất (kể cả cảm ứng: hiện chỉ có nút trên bảng).
- **Bố cục**: bảng cố định phải-trên 300 × 92; chưa có thiết kế HUD chung (docs/21 §HUD), nên vị trí các bảng (túi đồ phải-giữa) là thỏa thuận tạm giữa các worker.
- **Không dự đoán phía client**: thanh tu vi chỉ nhảy theo `char_state` (~1 Hz khi đang ngồi); nếu muốn thanh mượt cần nội suy tốc độ `Absorb` (chưa có trên dây).
- **Tiểu cảnh thất bại** hiện chỉ có toast (không hiệu ứng); không có hiển thị tỉ lệ trước khi bấm (server mới trả `chance` sau khi roll).

## 19. Chọn lớp trên dây (D82, worker35, #223): còn mở

- **Đổi lớp / respec**: lớp chỉ chọn một lần lúc tạo nhân vật; chưa có thiết kế đổi lớp (giá, hạn chế, mất tiến trình?). Hiện muốn lớp khác phải tạo tài khoản khác.
- **Nhiều nhân vật / tài khoản**: docs/10 G10 nói 3 nhân vật mỗi tài khoản; MVP vẫn 1 nhân vật = 1 tài khoản (`characterId` = `accountId`), nên "chọn lớp" gắn với tài khoản. Khi có `char_select` (docs/24 id 14), picker chuyển thành bước tạo nhân vật.
- **Chưa có tên / ngoại hình** nhân vật; picker chỉ chọn lớp. Chuỗi tiếng Việt của picker (`ClassPicker.ts`) là bản đầu, chưa qua biên tập viên, cùng ghi chú i18n ở mục 18.
- **Người chơi khác thấy lớp qua `defId`**: id 0 (server cũ / chưa biết) vẫn rơi về cách đoán theo `entityId % 6` của client; xóa nhánh này khi mọi server đã gửi lớp.
- **Mở khóa kỹ năng theo cấp vẫn chưa ép** (mục 11): người mới tạo thấy cả 8 kỹ năng của lớp trên hotbar.
- **Bản ghi trước D82** không có `classId`: lần đăng nhập đầu sau nâng cấp sẽ nhận lớp theo `hello` (hoặc `kiem`); cần quyết định có cho người chơi cũ chọn lại một lần không.

## D77 — túi đồ và điểm nhận drop: còn mở (worker39, 2026-11-08; #211, #214)

1. **Số mặc định tạm** (cần game designer): số ô túi (40), hàng chờ (50), giới hạn chồng (99 / 999), `quality` nằm trong khóa chồng (docs/23 §4.3 chưa có), id vật phẩm 1–6, số khóa phát lại giữ lại (10.000).
2. ~~**Chưa nối chiến đấu**~~ — đã nối bằng `DropSink` (killerId → tài khoản, khóa `mobId@tick`, nguồn faucet từ `MobPort.combatStats` đọc trước `kill`). Còn mở: killer ngắt kết nối cùng tick trước khi `onDrops` chạy thì drop không được cấp cho ai (`DropSink.stats.noOwner`); cần chốt luật (cấp theo tài khoản gần nhất / bỏ) khi có tổ đội và loot cá nhân (07 §6).
3. ~~**Chưa có giao thức**~~ [đã xử lý: #216, giao thức v4 `inv_state` / `inv_cmd` / `inv_result`; ví vẫn chưa hiển thị]: client chưa thấy túi đồ / ví (không có thông điệp `inv_*`, `inv_cmd`); thêm sau khi các thay đổi giao thức của 35 và 37 đã merge, tránh va id.
4. **Chưa có**: trang bị / mặc, độ bền hao theo 07 §7 (mới có API `loseDurability`), sửa chữa (sink `REPAIR`), kho / thư / chợ / ký quỹ, Tiên Ngọc và mọi tiền tệ khác Linh thạch, nhân vật (chủ hiện là tài khoản), `affixes`.
5. **Lưu trữ thật**: ví thuộc sổ cái và hiện chỉ ở bộ nhớ (mất khi khởi động lại); khóa idempotency chỉ giữ trong tiến trình (docs/26 §4.1: 7 ngày); cần PostgreSQL (docs/23 §4.3-4.4, `item_events` MINT/BURN/MOVE, đối chiếu §3.3), giao dịch đồng thời giữa vật phẩm và sổ cái cho cùng một kill.
6. **Drop vào túi đầy**: roll không vừa thì cả roll vào hàng chờ (tất cả hoặc không gì); chưa có UI nhắc hay thời hạn hết hạn cho hàng chờ.

## D79 — túi đồ hiển thị: còn mở (worker39, 2026-11-09; #216, #219)

1. **Chưa có art vật phẩm, tên hiển thị, mô tả, tooltip**: bảng túi dùng ô màu + mã ngắn (HP, BT, B1-B3, MA) và ASCII; cần icon (docs/05), tên Việt hóa, chi tiết khi chạm.
2. **Chưa có**: dùng / tách chồng / vứt / sắp xếp / ô nhanh (giao diện `InventoryInteraction` có sẵn trong client-core cho kéo-thả chưa nối), trang bị và độ bền hiển thị khi mặc, kho, thư, chợ.
3. **Nhịp lệnh (10/s, burst 10), số ô túi 40 (D77), số mục hàng chờ tối đa** là mặc định tạm cần game designer duyệt.
4. **Gửi toàn bộ túi mỗi thay đổi** (≤ ~0,6 KB với 40 ô, tối đa 20/s mỗi người khi nhặt liên tục): đủ cho beta, cần delta nếu túi lớn hơn hoặc nhặt dày đặc; chưa đo băng thông với 100 người nhặt cùng lúc.
5. **Bảng túi chưa kiểm trên điện thoại THẬT**; [Cập nhật worker39, 2026-11-09] giết quái → túi (client thật, server dev thật) và chạm trên giả lập di động 360x640 / 390x844 / 844x390 đã kiểm bằng `npm run bag:smoke -w client-cocos` (không chạy trong CI); ô chạm trên điện thoại chỉ ~37-45 px CSS (lưới 8 cột rộng 400 đơn vị thiết kế trên màn FIXED_HEIGHT) — màn dọc hẹp cần ít cột hơn (chưa làm). Chạm dùng sự kiện pointer cùng đường với click-to-move (đã chặn lan truyền khi bấm trong bảng).
6. **Phát hiện khi chạy client thật** [xử lý bằng tín dụng trễ: #227, D85; còn kiểm chứng ở mục D85]: máy chủ đang bị CPU bão hòa (Chrome SwiftShader ở 1280x720) không kịp tick nên hàng đợi input đầy → vi phạm `queue` → bị kick `anti-cheat` sau vài phút; bật `LOG_VIOLATIONS=1` ở máy chủ dev để xem bộ đếm. Chưa kết luận đây có phải lỗi thật hay chỉ do máy kiểm thử quá tải (harness dùng 960x540 để tránh).
7. **Hàng chờ có trần số lượng**: mỗi mục hàng chờ tối đa 65.535 (giới hạn u16 của dây); phần vượt của một roll bị tính mất (`lostItems`), không bao giờ làm `inv_state` lỗi mã hóa; mỗi chủ gửi lỗi chỉ tính vào `metrics.inventorySendErrors` và không dừng tick. Cần luật cho hàng chờ đầy lâu (hết hạn / thư hệ thống).
8. ~~**Phiên bản giao thức v4** dùng chung với việc nối lại của worker 38~~ [đã xử lý: #216 và #217 đều đã merge]: nếu 38 merge trước, bản này chỉ dựa vào mức tăng đó.

## D80 — resume: còn mở (#217)

- **Refresh token** (docs/25 §3: xoay vòng họ token, thu hồi, cookie `__Host-`, kho bền) chưa có; token resume dùng một lần chỉ phủ các lần rớt ≤ 10 s. Quá hạn thì client đăng nhập lại bằng mật khẩu đã lưu, nên một client không lưu mật khẩu (đăng nhập tay) sẽ rơi về màn hình đăng nhập.
- Thông điệp Protobuf `resume{sessionId, lastSnapshotSeq}` của docs/24 §5 (id 12) không dùng: resume nằm trong `hello` JSON. Cũng chưa gửi lại phần snapshot "thiếu" theo `lastSnapshotSeq`: nối lại luôn nhận trạng thái đầy đủ mới.
- Giữ nhân vật chỉ trong **một** World Node (chưa có nhiều node / chuyển giao ô); nhân vật đang giữ vẫn bị quái đánh và có thể chết (hồi sinh theo luật combat); chưa có "đang ngắt kết nối" hiển thị cho người khác.
- Chỉ phát hiện nửa mở **phía client** (3 s không có khung): server chưa ngắt khách im lặng bằng ping WebSocket, nên một socket chết giữ thực thể "đang nối" cho tới khi OS báo đóng hoặc client resume và chiếm phiên.
- Thông điệp trong tay người chơi khi rớt (input chưa ack, cast đang bay) bị bỏ: client dựng lại từ trạng thái server sau khi nối. Client Cocos mới đứng yên khi `reconnecting`; chưa có giao diện báo "mất kết nối".
- `revokeSession` / đổi `token_version` mới chặn **resume** và `hello` mới; một kết nối **đang sống** của phiên bị thu hồi vẫn không bị đá (đã vậy từ D70): cần đường thu hồi đá cả thực thể đang nối khi có tính năng đổi mật khẩu / thu hồi.
- Chưa đo resume dưới tải (nhiều người rớt cùng lúc, ví dụ khởi động lại cổng): thêm vào `npm run p2exit` nếu cần.

## Asset Gemini (props và icon vật phẩm, 2026-11-09): còn mở

- Điều khoản sử dụng thương mại của output Google Gemini chưa được kiểm tra riêng (ghi trong `docs/ASSET-LICENSES.md`, mục GEMINI-PROPS-ICONS); chủ dự án không lưu prompt gốc nên không tái tạo được từng ảnh. Cần chốt trước khi phát hành công khai.
- Map lát cắt chỉ có nước / đất / cỏ: chưa có biome đầm lầy hay dung nham. `tree_dead_swamp` đặt gần mép nước, `rock_lava_cooled` chỉ xuất hiện khi bản đồ có địa hình `lava` (chưa có), nên hiện chưa thấy đá dung nham trong game.
- `tree_pine_01/02` và `rock_mossy_small` / `rock_large_spirit` gần như trùng nhau: nên xin thêm biến thể (xem báo cáo PR).

## D83 — quái: vùng, bầy, đe dọa: còn mở (worker39, 2026-11-09; #224)

1. **Mọi số là tạm, cần game designer duyệt**: băng khoảng cách theo cấp, kích thước bầy 3, số lượng 12/2/1, bán kính bầy 3 ô, `MOB_THREAT` (tỉ lệ đổi mục tiêu 1,1, quên sau 24 ô, giảm 20%/s). docs/10 chưa nói quái đứng ở đâu so với điểm vào.
2. **Chưa có tên vùng thật của Sơn Môn**: `defaultMobZones` vẫn là bốn góc phần tư của bản đồ thử; cần tọa độ vùng từ level designer (docs/10 §4) thay cho tỉ lệ R.
3. **Đe dọa chỉ từ sát thương**: chưa có đe dọa từ hồi máu / khiên / taunt, chưa chia sẻ đe dọa trong bầy (đánh một con không kéo cả bầy ngoài `aggroRadius`), chưa có quái đánh trả người chơi (combat chưa cho quái gây sát thương) [Cập nhật: quái tấn công người chơi, #229, D86], chưa có luật nhóm / chia công.
4. **Thủ lĩnh**: một ô tạm cho mỗi loại; chưa có cơ chế phòng thủ lĩnh (docs/10), thời gian hồi sinh 30 phút là mặc định D74.
5. **Chi phí AI dưới tải đo trên máy CPU chung**: chỉ đo 100 bot + ~300 quái trong một vùng nhỏ; chưa đo toàn bản đồ (4 vùng, ~500+ quái) và chưa có AOI theo ô cho quái xa người (việc của worker tối ưu AOI).

## D84 — vòng lặp phiên đầu: còn mở (worker39, 2026-11-09)

1. **Mọi số là tạm, cần game designer duyệt**: 3 lần hạ quái, lề 2 ô của bước khu săn, thứ tự năm bước, 10 s hiển thị sau khi xong. Chưa có kịch bản onboarding thật (lời thoại, NPC dẫn đường, phần thưởng).
2. **Tiến độ do client đếm, không phải server xác nhận**: kill đếm từ `skill_result` của chính mình, tiến độ lưu `localStorage` (mất khi đổi trình duyệt / xóa dữ liệu, đổi tên đăng nhập thì làm lại). Cần số kill / mốc phía server (hồ sơ nhân vật) nếu sau này gắn phần thưởng hoặc chống gian lận.
3. **Bước đột phá phụ thuộc tu vi đầy**, mà tốc độ đả tọa là mặc định tạm (D76); trong smoke test headless bước này chỉ kiểm tới trạng thái "đang chờ tu vi", chưa kiểm một lần đột phá thật.
4. **Chưa có chọn lớp / phím tắt ẩn-hiện widget / chạm trên màn hình nhỏ**: widget cố định 330×142 đơn vị thiết kế ở góc trên trái (co theo bề ngang); trên điện thoại dọc nó có thể chồng lên túi đồ (túi vẽ phía trên).
5. **Mốc "khu săn" lấy theo bố cục mặc định `defaultMobZones`**: khi có vùng Sơn Môn thật (OPEN-ITEMS D83 #2) cần đổi bước 1 sang vùng đó.
6. **Phát hiện khi chạy client thật: server chưa hồi MP**: `CombatSystem` không có hồi MP (chỉ mô phỏng offline `skill_sim` có `MP_REGEN_COMBAT_PCT_PER_S`), nên cả phiên chỉ có đúng 400 MP (khoảng 5 con quái ~500 HP với bộ kỹ năng đầu của Kiếm tu). Quái ~1.500 HP gần như không hạ nổi; bước "hạ 3 quái" của vòng phiên đầu vẫn đạt được nhưng không dư dả. Cần luật hồi MP phía server (việc của worker combat) trước khi cân bằng onboarding.
7. **bag:smoke** cần `class=` trên URL (hộp chọn lớp D82 chặn tài khoản mới) và có thể chạy chậm khi hết MP (ngân sách 400 s); nó không chạy trong CI.

## D85 — tín dụng trễ: còn mở (#227)

- Xử lý mục 6 của "D79 — túi đồ hiển thị: còn mở" (khách thật bị kick vì máy chủ chậm). Chỉ phủ các guard trong `step()`; **hẹn giờ trong sim vẫn theo giờ sim** (AI quái, hồi sinh, hồi chiêu phía combat do worker 37, thời gian cast): máy chủ quá tải thì thế giới chạy chậm hơn giờ thật nhưng không ai bị phạt. Không "bắt kịp" giờ sim.
- Chưa có số đo trên máy đích: kiểm bằng test mô phỏng (đồng hồ thật giả). Cần chạy lại bag-smoke trên máy đang bị CPU bão hòa để xác nhận không còn bị kick.
- Kích thước tín dụng không hiện ra metric / log: nên thêm `lagCreditMs` lớn nhất vào số đo World Node (và cảnh báo vận hành khi một khách có > 1 s tín dụng: máy chủ đang quá tải).
- Khách nối lại (resume) giữ tín dụng cũ của phiên (mốc lúc vào không đổi) và luật trượt ngân sách lúc resume (D80) chạy trên **đồng hồ của guard** (giờ sim + tín dụng), nên không để lại ngân sách chưa kiếm; phiên đăng nhập mới bắt đầu từ 0. Khách vào giữa lúc máy chủ đang đơ cũng không nhận tín dụng cho khoảng đơ trước khi nó vào (mốc = drift thật lúc vào).

## D88 — hồi HP / MP phía server: còn mở (worker39, 2026-11-09)

1. **Chỉ MP có số trong docs** (docs/11 §2.4: 1 % / 4 % / 8 % MP tối đa mỗi giây). **Hồi HP (2 %/s ngoài chiến đấu, 0 trong chiến đấu) và ngưỡng "ngoài chiến đấu" 5 s là mặc định tạm, cần game designer duyệt**; docs/ cũng chưa nói đả tọa có hồi HP hay không, hay hồi trong vùng an toàn có khác không.
2. **Chưa làm**: +0,5 % MP mỗi đòn thường trúng, đan hồi MP / HP, hồi cho đồng đội (Tương sinh hồi 10 % Chân Nguyên, docs/01 §8), dùng `mp_regen_pct_per_s` trong dữ liệu kỹ năng (hiện chỉ mô phỏng offline `skill_sim` đọc tham số đó).
3. **"Trong chiến đấu" chỉ tính sát thương gây / nhận**: một cú cast không trúng, buff hoặc hồi máu không khóa hồi; tiến trình (progression) có `COMBAT_LOCK_MS` = 10 s riêng cho đả tọa (D76) khác 5 s này: nên thống nhất một định nghĩa khi game designer duyệt.
4. **Băng thông**: regen làm sinh lực đổi ở 4 Hz khi đang hồi (golden 150 người + 30 quái: +0,9 % byte, 5.814.930 → 5.868.270); loadtest 100 bot trên máy dùng chung quá nhiễu để thấy khác biệt tick.

## Mob hiển thị tạm thời (standee, 2026-11-09): còn mở

- 14 quái đang hiển thị bằng ảnh concept Gemini tĩnh (**INTERIM**, `MobArt.ts`): chưa có hoạt hình đi / đánh / chết, chỉ lật theo hướng đi, nhún nhẹ, nháy đỏ khi trúng đòn và mờ dần khi chết. Thay bằng sprite hoạt hình khi có; giữ nguyên chỗ nối trong `Combat.ts` (`mobArt`).
- Chỉ có ảnh @1x (chung trang atlas với prop, 128 / 192 / 256 / 512 px thiết kế): ở zoom 1,5–2,0× (D81) quái hơi mờ; cần bản @2x khi làm sprite thật.
- Quái nhận biết qua tên `Mob <id>` của backend (`mobDefIdOfName`) vì `EnemyView` chưa mang `defId`; nên thêm `defId` vào `EnemyView` khi `@vgtd/client-combat` được sửa.

## 20. Chat (D87, worker35): còn mở

- **Danh sách từ cấm thật**: hiện chỉ có 2 từ GIẢ (`placeholder`) để chứng minh cơ chế; cần chủ dự án / kiểm duyệt viên cung cấp danh sách tiếng Việt (có biến thể không dấu, leetspeak, ký tự tách) và chính sách che hay chặn. Che bằng `*` theo ký tự gốc là mặc định tạm.
- **Lưu bền tin riêng (30 ngày)** và nhật ký kiểm toán (docs/22 §7, docs/25): chưa có bảng `chat_messages`; thì thầm hiện chỉ ở RAM. Cần chính sách riêng tư (docs/23 §7) trước khi lưu.
- **Báo cáo / chặn người chơi, vi phạm lặp lại**: chưa có `report`, danh sách chặn phía người nhận, tự mute khi spam lặp; `mute()` mới là API nội bộ, chưa có lệnh GM hay tự động.
- **Hạn mức là đề xuất** (docs/24 §7): Thế giới 1/5 s bùng nổ 2, Vùng và thì thầm 1/2 s bùng nổ 3 (Vùng không có trong bảng nên lấy mức thì thầm). Chưa chặn tin lặp lại giống hệt, chưa có hạn mức theo IP.
- **Kênh Đội / Tông môn / Hệ thống**: `Party = 4` để dành; Đội cần tính năng tổ đội (docs/10 §7.1), Tông môn cần tông môn NPC. Tin hệ thống (`senderId` 0) chưa dùng.
- **Vùng = hộp AOI của người gửi**: chưa có khái niệm "vùng bản đồ" (Sơn Môn / Rừng Độc là hai `MapInstance` theo docs/22 §3); khi có nhiều bản đồ, Vùng nên là cả bản đồ.
- **Link vật phẩm / Shift+click** (docs/05 §tương tác) và **emoji / biểu tượng**: chưa có.
- **i18n**: chuỗi tiếng Việt của hộp chat và lệnh nằm trong code (`ChatLog.ts`), cùng ghi chú mục 18; tên kênh hiển thị là bản đầu chưa qua biên tập.
- **Hộp chat là DOM overlay**: không phụ thuộc engine nhưng không nằm trong cây Cocos (không bị camera / zoom chi phối); trên Web/H5 thật cần kiểm với bàn phím ảo che màn hình (viewport resize) và IME.
- **Hàng đợi gửi / ngân sách**: fan-out Thế giới gửi từng người (mã hóa mỗi lần); ngân sách docs/22 §7 (≤ 0,2 ms/tin) chưa đo ở 200 người.

## D89 — telegraph quái: còn mở

- Decal chỉ là placeholder (đường viền + tô lớn dần, không art, không âm thanh); thời gian chạy theo đồng hồ cục bộ từ lúc nhận `telegraph_start` (không bù độ trễ).
- Chưa có telegraph cho boss có bộ kỹ năng riêng và các hiệu ứng (vũng độc, triệu hồi) vì server chưa mô phỏng chúng (xem mục 11).
- Chưa gộp nhiều telegraph cùng lúc (bầy quái): mỗi đòn một khung 20 B. Nếu đo thực tế thấy tốn, gộp theo tick.
- Đã có smoke test trình duyệt thật `npm run telegraph:online -w client-cocos` (decal hiện khi `telegraph_start` tới, biến mất khi đòn kết thúc); nó đếm điểm ảnh đỏ nên chỉ là kiểm tra thô, chưa đánh giá thẩm mỹ / độ rõ của decal trên mọi nền bản đồ.

## D90 — dùng vật phẩm: còn mở (worker39, 2026-11-09)

1. **Số liệu tạm, cần game designer duyệt**: đan hồi máu không phụ thuộc phẩm; áp công thức đan của đột phá đại cảnh cho đột phá tiểu cảnh (trần 95 % của công thức nên đan chỉ thêm tối đa +5 % so với 90 %); một đan đột phá chờ mỗi lúc; hồi chiêu 8 s chung cho mọi đan hồi máu.
2. **Đan đột phá chỉ sống trong phiên**: không nằm trong hồ sơ nhân vật (cần đổi lược đồ `ProgressRecord` và cờ trong `char_state`); client chưa có chỉ báo "đang có đan chờ" (chỉ thấy tỉ lệ trong `breakthrough_result`); rớt mạng làm mất đan đã dùng.
3. **Chưa làm**: đan hồi MP, đan chủ / đan phụ theo ngưỡng (`pillBonus` với `main` / `support` và tối đa 3 viên), đan hồi máu thường bị khóa trong Lôi Kiếp (docs/01 §5), dùng vật phẩm instance (trang bị / bản vẽ), tách / vứt, ô nhanh nhiều phím (chỉ phím H cho đan hồi máu), hồi chiêu hiển thị trên client (chỉ biết khi bị từ chối `OnCooldown`).
4. **Giao thức**: `Use` và các lý do 6-10 chỉ thêm giá trị vào enum, `PROTOCOL_VERSION` không đổi; khi có bản server và client khác nhau cùng chạy cần bật lại kiểm tra phiên bản (docs/24).

## D92 — lưu trữ bằng tệp: còn mở

- Không phải cơ sở dữ liệu: một tệp JSON mỗi kho, nạp hết vào bộ nhớ lúc khởi động, ghi lại toàn bộ tệp (gộp theo 250 ms). Đủ cho play-test và vài nghìn nhân vật; `ledger.json` tăng vô hạn vì bút toán chỉ thêm (cần JSONL hoặc DB thật trước khi mở cho nhiều người).
- Một tiến trình duy nhất: không khóa tệp, hai server cùng `DATA_DIR` sẽ ghi đè nhau. Chưa có sao lưu định kỳ ngoài `.bak` (bản trước đó).
- Chưa lưu: khóa idempotency của sổ cái (xem D92), nhật ký roll (`roll_log`), token nối lại; vị trí / máu hiện tại của nhân vật không được lưu (vào lại ở điểm xuất hiện, như trước). Kỹ năng / hotbar / hồi chiêu không thuộc dữ liệu bền.
- `npm run play` dừng game server bằng dòng `quit` trên stdin (tắt máy sạch, lưu hết; không có cổng điều khiển mới) rồi mới kill sau 3,5 s nếu chưa thoát. Chỉ khi tiến trình bị kill cứng (đóng cửa sổ, `taskkill /F`) mới có thể mất tới ~5 s thay đổi túi đồ gần nhất (bản ghi tài khoản / nhân vật ghi sau <= 250 ms).
- Adapter PostgreSQL chưa viết (giao diện `AccountStore` / `InventoryStore` cần chuyển sang bất đồng bộ; xem D92).

- Chỉ có ảnh @1x (chung trang atlas với prop, 128 / 192 / 256 / 512 px thiết kế): ở zoom 1,5–2,0× (D81) quái hơi mờ. Đã đo bản @2x (2026-11-09): prop @2x + quái @2x cần 3,74 / 4,19 MP, xếp thành **2 trang** 2048² (thêm ~16 MB GPU và Y-sort bị ngắt batch giữa prop và quái), nên chưa làm; làm khi có sprite hoạt hình thật (atlas riêng cho quái, nén ASTC).
- Quái nhận biết bằng `EnemyView.defId` (id dây của `MOB_DEFS`, do `aoi_enter` mang); tên `Mob <id>` chỉ còn là đường lùi cho backend chưa gán `defId`.

## Skin pha boss (INTERIM, 2026-11-09): còn mở

- Skin pha đổi khi client nhận `boss_phase`; client vào tầm nhìn SAU lúc boss đã đổi pha (AOI) chưa nhận lại thông điệp nên vẫn thấy skin pha đầu cho tới lần đổi pha kế: cần `phase` trong `aoi_enter` / snapshot (giao thức) để dựng đúng skin ngay.
- Thanh máu trên đầu boss giữ độ cao của skin pha đầu (skin pha sau thấp hơn); chưa dùng sprite hoạt hình: chỉ nháy + đổi ảnh tĩnh trong cửa sổ biến hình (`TRANSFORM_SWAP_AT` = giữa cửa sổ).
- Skin pha boss nằm trong trang atlas riêng `atl_mobphase_1x` (@1x cho mọi tier, ~0,9 MB PNG, tải lười khi có boss có pha trong tầm nhìn; cổng ngân sách tính riêng qua `LAZY_ATLAS_PREFIXES`, không vào gói tải đầu). Trang prop vẫn một trang (`atl_prop_2x` 2048², `atl_prop_1x` 2048×1024). Còn mở: nếu boss đổi pha trước khi trang tải xong thì dùng tạm màu pha (hiếm: trang tải ngay khi boss vào tầm nhìn).

## 21. Tổ đội (D93, worker35): còn mở

- **Chia chiến lợi phẩm là PLACEHOLDER**: mỗi người trong 20 ô tự roll với hệ số 1/√n (docs/07 §6). Cần game designer duyệt: bán kính chia, có tính người đã chết / ngoại tuyến không, nhặt chung hay riêng (Need / Greed), chia **kinh nghiệm** (MVP chưa có XP khi hạ quái), boss bí cảnh "1 lần mỗi tuần mỗi người" khi đi đội.
- **Hạn mức là đề xuất**: 1 lệnh / s bùng nổ 5 theo tài khoản; lời mời sống 30 s, tối đa 4 lời mời treo mỗi người; giải tán khi còn 1 người; nhường đội trưởng cho người vào lâu nhất. Chưa có "đồng ý tự nhận lời mời của bạn bè", chưa có cấm nhận lời mời / chặn người chơi (OPEN-ITEMS 20).
- **Chỉ trong phiên**: đội tan khi ngắt kết nối hoặc server khởi động lại; resume trong cửa sổ giữ chỗ vẫn tính là **chưa** ngắt kết nối (đội giữ nguyên), nhưng chưa có test cho trường hợp này. Chưa lưu bền (cần bàn với nhóm lưu trữ).
- **Chưa có**: chuyển quyền đội trưởng chủ động (`/leader tên`), đội hình / đánh dấu mục tiêu, tìm đội công khai, đội liên bản đồ (hiện chỉ một bản đồ), nhóm chat Đội lưu lịch sử, thông báo ngoại tuyến cho người mời khi bị từ chối (từ chối im lặng với người mời).
- **Hiển thị**: khung đồng đội là DOM overlay dưới khung người chơi, chưa có icon lớp / icon hiệu ứng (buff / debuff), chưa kéo-thả, chưa có "đồng đội ngoài tầm nhìn" trên minimap; HP / MP gửi 5 Hz khi đổi (không tính vào ngân sách snapshot).
- **Kỹ năng ngữ cảnh nhóm** (docs/11 §2, `context: group`): server combat chưa biết "còn đồng đội sống" nên mọi kỹ năng ⚑C vẫn chạy nhánh solo; cần `PartyService.membersOf` làm nguồn khi hiện thực.

## Nền đất và khung UI từ Gemini (2026-11-09): còn mở

- Map lát cắt chỉ có nước / đất / cỏ: **chưa có** địa hình đá, đầm lầy, nham thạch. Các họ ghép viền tương ứng (bờ đá, vỏ nham thạch, bờ đầm lầy, 16 Wang mỗi họ) đã được sinh vào `tileset_ext` nhưng client chưa tải; cần bản đồ có các chất liệu đó (bộ sinh bản đồ chỉ có 3 chất liệu).
- Mỗi ô lặp lại cùng một patch (chu kỳ = một ô, biến thể chỉ khác phần trong ô), nên thấy lưới hình thoi nhạt trên mặt nước / cỏ rộng; muốn bớt cần patch lớn hơn một ô (thêm lớp biến thể theo vị trí ô) hoặc nhiều biến thể hơn.
- Khung UI mới đã áp dụng cho túi đồ, HUD tu luyện, nút Claim; **hộp chat là lớp phủ HTML** (`ChatBox.ts`, không phải node Cocos) nên chưa áp khung 9-slice (cần CSS `border-image` từ ảnh khung); nút của bộ chọn lớp và các HUD khác vẫn phẳng.
- `progression-online-smoke.mjs` đã lỗi thời trên `main`: bộ chọn lớp (D82) chặn luồng đăng nhập của nó nên chờ `__vgtdProgression` quá hạn (không liên quan khung UI); cần sửa riêng.

## D101 — làm cứng đầu vào: còn mở (worker39, 2026-11-09)

1. **Chưa giới hạn theo IP** cho kết nối WebSocket chưa xác thực và số kết nối đồng thời: cần quyết định về proxy ngược / `X-Forwarded-For` (docs/25 §5) trước khi tin vào địa chỉ. Hiện chỉ có hello timeout 5 s và `MAX_PLAYERS`.
2. **Số của `SECURITY_CONFIG` là ước lượng** theo nhịp client hiện tại (20 Hz input); cần đo trên bài tải 37 và trên thiết bị thật (tab nền, mạng chập chờn) rồi chỉnh.
3. **Điểm nghi vấn xuyên phiên + hàng đợi xem xét thủ công** (docs/25 §7.3) chưa có; nhật ký an ninh hiện chỉ là dòng log, chưa đẩy vào `audit_log` / cảnh báo (docs/27 §3).
4. **Thực thể chỉ-chủ-sở-hữu** (loot / NPC riêng) chưa có trong giao thức; khi thêm phải lọc theo chủ ở lựa chọn mục tiêu của combat và ở AOI.
5. **HTTP auth** chưa được fuzz bằng thân yêu cầu đột biến (đã có giới hạn 4 KB, JSON lỗi trả 400).

## D99 — sao lưu / khôi phục: còn mở (worker39, 2026-11-09)

1. **Bản sao nằm cùng ổ đĩa mặc định** (`DATA_DIR/backups`): chưa có đẩy ra máy khác, mã hóa hay lịch chép ngoài; bản sao chứa băm mật khẩu như dữ liệu gốc. Người vận hành phải chép tay (docs/27 §9.1).
2. **Phát hiện "server đang chạy" chỉ bằng mtime** (3 s): không có tệp khóa / pid; `restore --force` bỏ qua. Cần khóa thư mục dữ liệu khi có nhiều tiến trình.
3. **Sao lưu ngoại tuyến khi server chạy** đọc tệp trên đĩa, trễ tới `flushMs` + chu kỳ lưu túi (5 s) so với bộ nhớ; chỉ sao lưu trực tiếp của server (`BACKUP_EVERY_MIN`, stdin `backup`) là đúng thời điểm.
4. **Không có**: sao lưu tăng dần / nén, khôi phục một tài khoản, kiểm định kỳ tự động của bản sao cũ (chỉ `verify` thủ công), cảnh báo khi sao lưu lỗi ngoài dòng log (docs/27 §3 alert).
5. **Kho PostgreSQL** (docs/08) cần sao lưu riêng (`pg_dump` + WAL / PITR) và thử khôi phục tương tự; giao diện lệnh ở đây chỉ phủ kho tệp D92.

## NPC Sơn Môn dạng standee (INTERIM, 2026-11-09): còn mở

- 6 NPC (`npc_chuong_mon`, `npc_truong_lao_dan`, `npc_ve_binh`, `npc_su_huynh`, `npc_tho_ren`, `npc_thuong_nhan`) chỉ là ảnh concept tĩnh đứng quanh quảng trường gần spawn; chưa có hội thoại, nhiệm vụ, cửa hàng hay hoạt hình. Khoá `npc_<tên>` theo kiểu docs/12; hệ thống NPC tông môn (D98) ánh xạ NPC id của nó vào các khoá này (`NPC_STANDEE_KEYS` trong `NpcPlacement.ts`), vị trí ưu tiên trong `SECT_NPC_LAYOUT` (chỉ phía client, chưa lấy từ server).
- Mỗi NPC chiếm một ô đi bộ (chặn như prop); NPC không lật theo người chơi vì ảnh nhìn thẳng.

## 22. Đột phá đại cảnh: Tâm Ma + Lôi Kiếp (D97, worker37): còn mở

- **Số liệu tạm, cần game designer duyệt**: độ khó Tâm Ma (Đạo Tâm mặc định 60), 90 s, vòng đánh 2,5 s / r2 / 0,8 s, Khí Huyết ≥ 80 % để vào, mây tụ 3 s, cảnh báo tia 1,2 s, nghỉ Thiên Mệnh 2 s, khóa 30 phút / 24 giờ, mất tu vi 25 % / 50 %. Công thức tỉ lệ và sát thương sét **không đổi** (07 §2-§3).
- **Chưa có hệ để làm**: buff "Đạo Cơ Chấn Động" (24 / 72 giờ, −10 / −20 % chỉ số gốc), mất 15 % độ bền trang bị, mất Đạo Tâm (không có hệ Đạo Tâm), nguồn giảm trừ kiếp (trận bàn, pháp bảo khiên, hộ pháp ×2, Thể tu) và khóa đan hồi máu thường trong kiếp (D90 là việc của lõi dùng vật phẩm).
- **Tâm Cảnh chưa là instance riêng**: bóng Tâm Ma hiện cạnh người chơi ở thế giới mở nhưng **chỉ chủ nhân thấy và đánh được** (người khác không thấy, không gây sát thương, quái không nhắm); thế giới mở vẫn là nơi chủ nhân đứng (quái xung quanh vẫn tấn công họ), và Kiếp Đài do server cấp (docs/01 §5.4 bước 1) chưa có nên sét chỉ nhắm chủ kiếp. "Nghiệp Ảnh" (bóng phụ theo nghiệp âm) và Tâm Ma đa người chưa làm.
- **Client**: overlay và sét là placeholder procedural (không art); bóng Tâm Ma vẽ bằng ô quái mặc định (defId 200 chưa có tranh); không có BGM / rung camera.
- **Khóa đột phá** tính theo đồng hồ mô phỏng và lưu theo thời gian còn lại tại lần ghi gần nhất; một khoảng ngoại tuyến không làm khóa chạy tiếp (cần quyết định: tính theo giờ thật).
- **Rời / ngắt kết nối giữa sự kiện** tính là thua (Tâm Ma) hoặc gục (Kiếp, theo số đợt đã qua); chưa có chế độ "nối lại phiên giữa kiếp".

## D95 — bản đồ 4 vùng: còn mở (worker39, 2026-11-09)

1. **Mọi bố cục là mặc định tạm, cần game designer duyệt**: tên và vị trí vùng (bốn góc phần tư của bản đồ thử, chưa phải tọa độ Sơn Môn thật của docs/10 §4 / level designer), bãi trống cây cổ thụ ở giữa `co_thu_trung_tam` (chưa có cây: prop do worker 40), tỉ lệ nước / nham thạch (ngưỡng 0,52 của nham thạch, độ ẩm đầm lầy).
2. **Đường nét vẫn khá "nhão"**: bản đồ vùng đã dùng nhiễu thưa hơn (`zoneNoiseScale` 0,035, mảng lớn hơn bản đồ cũ), nhưng vẫn chỉ là một trường nhiễu: chưa có đường mòn, hồ lớn, vách, cầu qua nham thạch; một vùng nham thạch lớn không có lối đi riêng cho người chơi bay (chưa có luật ngự kiếm trên nham thạch).
3. **Mép chuyển vùng là dải đất thẳng** rộng ~6 ô dọc các đường chia vùng và quảng trường vuông ở giữa: nhìn nhân tạo; chưa có tile chuyển tiếp trực tiếp giữa các họ (cỏ ↔ nham thạch...).
4. **Tile viền của họ bổ sung** (bờ đá có bọt trắng, bờ đầm lầy) vẽ cho viền với nước; trong vùng cổ thụ vòng đá nằm trên cỏ nên viền trắng hơi sáng; cần Gemini / 42 duyệt hoặc vẽ riêng viền đá-trên-cỏ.
5. **Server vẫn chỉ biết ô đi được hay không**, không biết loại nền: chưa có sát thương nền (nham thạch, độc), chậm chân trong đầm lầy, hay quái theo loại nền; `terrain.json` chỉ có `.` / `#`.
6. **`MAP_FILE` chỉ ở server dev**: `npm run play` / dev dùng khi file có; server test và loadtest giữ bản đồ mở; đồng bộ client-server do người chạy giữ (cùng lần `prepare:assets`).
7. **Chi phí**: tileset 1024 × 1024 (tăng gấp đôi so với 1024 × 512); số đo ngân sách và P1 xem PR D95.

## Asset Gemini PART 2 (props vùng, icon trạng thái, huy hiệu cảnh giới, hạt, key art, 2026-11-09): còn mở

1. **Địa hình vùng chưa có trên bản đồ lát cắt**: bản đồ chỉ có nước / đất / cỏ, không có đầm lầy, rừng cổ thụ hay dung nham. Prop vùng (swamp\_\*, ancient\_\*, lava\_\*) được rải trên đất / cỏ trong bốn góc phần tư mà server dùng cho vùng mob (`mobZoneAt` trong `@vgtd/shared`, trùng `defaultMobZones`), nên là "trang trí theo vùng", không phải địa hình thật. Trang trí vùng là một lượt rải riêng (PRNG riêng, +60 prop trên lượt rải gốc) và chỉ cách điểm xuất phát từ 16 ô (`ZONE_MIN_DIST`): khung nhìn lúc vào game giữ nguyên bố cục cũ, vì prop vùng gần điểm xuất phát làm cổng draw call 65 của `perf:p1 --mobs` vượt (68–70 so với 62). Khi có tọa độ vùng Sơn Môn thật (D83 mục 2) và ground từng vùng (PR Gemini ground), đổi `mobZoneAt` sang hình chữ nhật của bản đồ thật.
2. **Số đo prop vùng là ước lượng**: kích thước `target` (ancient_tree_giant 520 px @2x cho nền 4×4 ô, lava_charred_tree cao 342 px) bị ép để trang atlas prop @2x vẫn là MỘT trang 2048×2048 (đang dùng ~74 % diện tích; thêm prop lớn nữa sẽ tràn sang trang 2 và phá batch Y-sort: cần nâng trần trang hoặc tách atlas theo vùng). Ô chặn (khối 2×2 cho fire_vent / obsidian / sulfur, 4×4 cho cây cổ thụ, 2×2 cho cổng rễ và đền đá) chưa qua level designer; `swamp_lilypads` là prop phẳng bằng chuẩn "lá sen trên nước" nhưng chưa có nước trong vùng đầm, nên đang đặt ven bờ.
3. **Hàng trạng thái của HUD (D94) đã dùng icon**: `Combat.setStatuses` gọi `getStatusIcon(id)` của `PropArt.ts` (ids root, slow, poison, shield; bản stub `StatusIcons.ts` đã xóa). Còn mở: `burn`, `regen`, `atk_up`, `def_up`, `invulnerable`, `breakthrough_buff` đã có icon nhưng chưa có hiệu ứng tương ứng ở server / client-core (`statusRowItems` mới có root / slow / poison / shield).
4. **Huy hiệu cảnh giới chỉ ở HUD tu luyện** (cạnh tên cảnh giới, 30 px); chưa có ở khung nhân vật / bảng xếp hạng / chat. Huy hiệu thứ 9 (Độ Kiếp) có quầng sáng bị cắt nhẹ ở góc dưới-phải do dấu ✦ chồng lên nó (xoá bằng hộp góc 7,5 %).
5. **Hạt chỉ là kho texture + registry** (`ArtRegistry.ts`, `getParticleFrame`): chưa hệ VFX nào dùng; chế độ blend (additive / alpha) chỉ là gợi ý (Cocos 3.8 không có hệ số blend theo sprite; thử vật liệu custom `builtin-sprite` với blend cộng thì render lỗi `localSetLayout`, nên `LevelUpFx` vẽ bằng alpha thường) trong `ParticleSpec`, node dùng chúng phải đặt blend riêng. Chưa kiểm hiển thị trên máy thật với `tier low` (trang @1x, 96 px).
6. **Màn "đăng nhập" chỉ là hộp chọn Đạo Lộ**: client chưa có màn đăng nhập thật (tài khoản tự sinh), nên nền `login_bg` và emblem hiện ở hộp chọn Đạo Lộ của lần đăng nhập online đầu tiên; thêm màn đăng nhập / tạo nhân vật thật (D82 mục "Nhiều nhân vật") thì chuyển sang đó. URL ảnh cho DOM lấy từ `ImageAsset` (nguồn `HTMLImageElement.src`, dự phòng `nativeUrl`); chưa kiểm trong mọi cấu hình build (đóng bundle từ xa / CDN).
7. **Dung lượng key art**: `login_bg` 1024×576 PNG ≈ 1,4 MB và emblem 512 px ≈ 0,6 MB (tải theo yêu cầu, chỉ khi hộp chọn Đạo Lộ hiện); chưa có preset nén WebP/ASTC cho hai ảnh này. Cần nén nếu gói tải đầu sát trần 25 MB.
8. **NPC và pha boss mới là concept**: `assets-src/concepts/npcs/` (6) và `assets-src/concepts/mobs_phase/` (3) chỉ là tham chiếu; worker 42 dựng NPC đứng và skin đổi pha boss sau.
9. **Giấy phép**: như mục "Asset Gemini": điều khoản thương mại của output Gemini chưa kiểm riêng; mục GEMINI-PART2 trong `ASSET-LICENSES.md`.

## D102 — giao dịch trực tiếp: còn mở

- Sao lưu (D99) và nhật ký ghi trước (D102): `readLiveDocs` từ chối sao lưu nguội khi còn `journal.json` (một commit nhiều tài liệu bị cắt ngang: hãy khởi động server một lần để nó hoàn tất rồi mới sao lưu; khi đang chạy thì tệp biến mất sau vài ms và việc đọc lại tự thử lại), và `restoreBackup` chuyển `journal.json` vào `pre-restore-<id>/` cùng các tài liệu cũ để một nhật ký cũ không bị áp lại lên dữ liệu vừa khôi phục. `--reset-data` cũng xóa `journal.json`. Sao lưu sống (`FileStores.snapshot`) lấy trạng thái trong bộ nhớ nên không bị ảnh hưởng.
- **Số tạm** (docs không ghi): tầm 12 ô, hạn lời mời 30 s, 8 dòng vật phẩm, nhịp lệnh (burst 8). Chưa có trần tốc độ / giá trị mỗi ngày chống RMT (docs/26 §5.5 và docs/25 §6.1: tham số, chưa có số), chưa phát hiện wash trading giữa hai tài khoản.
- **Cam kết nhiều tệp** (đã đóng cho giao dịch): bước thực hiện đi qua nhật ký ghi trước (`TxJournal`, xem D102 và D92), nên crash giữa các lần ghi không còn nhân đôi / mất đồ. Còn mở: các thao tác nhiều tệp khác chưa dùng nó (mua bí tịch tông môn D98 = sect + sổ cái, dùng vật phẩm = túi + sổ cái; `FileStores.commitAtomic` dùng lại được); nhật ký chưa tự nén / chưa có mã khóa tiến trình duy nhất (hai server cùng `DATA_DIR` vẫn ghi đè nhau); adapter PostgreSQL thay bằng một giao dịch SQL.
- **Khóa idempotency của sổ cái chỉ sống một tiến trình** (như D92): sau khởi động lại cửa sổ đang mở cũng không còn, nên không có gì để phát lại.
- Thuế chỉ đánh Linh thạch (docs không định giá vật phẩm): hoán đổi vật phẩm lấy vật phẩm không tốn thuế; nếu muốn thuế theo giá trị vật phẩm cần bảng giá tham chiếu (có liên quan CPI của Vạn Bảo Lâu).
- Cửa sổ vẫn mở khi hai bên đi xa nhau (chỉ kiểm tầm lúc mời). Nếu cần: hủy khi cách > 2 × tầm.
- Cống hiến (`CONG_HIEN`) và vật phẩm khóa không giao dịch được; chưa có giao dịch gửi cho người **ngoại tuyến** (thư, docs/26 chợ).
- Panel: tên vật phẩm là tên giữ chỗ (chưa có bảng i18n), chưa có icon vật phẩm, chưa có nút mở bảng trên màn hình cảm ứng (dùng `/trade`); smoke trình duyệt chỉ chạy cửa sổ rỗng (tài khoản mới không có đồ): việc chuyển đồ / thuế được kiểm bằng test server.

## D98 — tông môn NPC: còn mở

- **Số tạm** (docs không ghi, cần game designer): thưởng Cống hiến theo quái (1 / 5 / 25), giá bí tịch cơ bản (3 × cấp), tầm NPC (20 ô), rời tông môn giữ Cống hiến và bí tịch, không trần ngày, không thời gian chờ khi vào lại. Chưa đo tốc độ kiếm so với giá (OPEN-ITEMS X6: Cống hiến chưa có mục tiêu faucet / sink).
- **Mở khóa bí tịch chưa có tác dụng ở combat**: server ghi và lưu bí tịch đã mua nhưng cast không bị chặn / mở theo đó (combat chưa có cấp mở khóa kỹ năng). Cần nối `SectService.owns()` vào luật tung kỹ năng khi combat có `unlock`.
- **Chưa làm**: nâng rank bằng Bí Tịch Tàn Trang + Cống hiến (docs/11 §5; rank chưa có ở server), nhiệm vụ tông môn / mốc hành trình đầu thưởng Cống hiến (bộ theo dõi D84 chỉ ở client, server chưa biết mốc), nạp tài nguyên, chức vị, kho tông môn, phe Chính / Tà / Ma và trục xuất theo Nghiệp (docs/01 §9.2).
- **Tên bí tịch**: dữ liệu kỹ năng chỉ có khóa i18n nên tên hiển thị là id kỹ năng viết hoa chữ đầu, không dấu ("Kim Quang Quet"); cần bảng tên tiếng Việt.
- **Nhất quán hai tệp**: mua bí tịch ghi sổ cái (`ledger.json`) rồi ghi `sect.json` bằng hai lần ghi tệp riêng; một cú crash đúng giữa hai lần ghi có thể trừ Cống hiến mà chưa ghi bí tịch (và khóa idempotency không lưu qua lần khởi động lại nên mua lại sẽ trừ lần nữa). Adapter PostgreSQL phải làm hai việc đó trong một giao dịch SQL.
- **Chưa có NPC thật trong thế giới**: chỉ có vị trí (giữa vùng spawn) và khóa giữ chỗ cho standee; chưa có tương tác bấm vào NPC (bảng mở bằng K / `/sect`), chưa có nút mở bảng trên màn hình cảm ứng.
- Tên hiển thị trong thư viện và Cống hiến chỉ biết trong một World Node; nhiều node cần sổ cái chung (docs/23).

## D96 — bạn bè: còn mở

- Chưa có danh sách chặn / bỏ qua, chưa có ghi chú bạn bè, nhóm bạn, hay gợi ý bạn (người cùng tổ đội gần đây). Mọi giới hạn (50 / 20 / 20, 5 lệnh burst) là tạm.
- Lời mời không hết hạn (chỉ mất khi nhận, từ chối hoặc thu hồi); cần quyết định của game designer (hạn dùng, hoặc xóa lời mời cũ khi đầy hộp thư).
- Gửi lời mời cho tên không tồn tại vẫn trả `NoSuchPlayer` (đã tốn token nên không dò nhanh được); vẫn có thể dò chậm tên tài khoản đã đăng ký, giống `/auth/register` (`username_taken`). Nếu cần kín hơn: luôn trả `Ok` và chỉ báo "đã gửi" (đổi UX).
- `friend_state` luôn gửi đầy đủ (tối đa ~1 KB) và gộp theo tick; một người có 50 bạn đăng nhập / thoát liên tục làm 50 bạn nhận một tin mỗi lần. Nếu đo thấy tốn: tin delta riêng cho trạng thái online.
- Trạng thái online chỉ biết trong một World Node (một tiến trình); nhiều node cần kênh trạng thái chung (docs/20 / Redis).
- Hiển thị: bảng bạn bè chưa có icon lớp, chưa có chấm "bận / đang trong tổ đội"; chỉ kiểm tra bằng smoke thô, chưa thử trên màn hình cảm ứng (chưa có nút mở bảng trên cảm ứng: dùng `/friends`).
