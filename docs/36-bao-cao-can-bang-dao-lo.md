# Báo cáo cân bằng 6 Đạo Lộ (D115)

> **Tự sinh** bởi `npm run balance -w @vgtd/server` (xem mục 10). Không sửa tay: chạy lại để cập nhật. **Báo cáo này không đổi con số nào**; đề xuất chỉnh ở mục 9 chỉ là gợi ý, mọi thay đổi đi qua `vgtd-formula-change` sau khi chủ dự án duyệt. Mọi số trong `skills.json` vẫn là "Đề xuất – chờ duyệt" (D49).

## 1. Phương pháp và giới hạn

- **Chạy trên mã máy chủ thật**: `WorldNode` (lõi chiến đấu `CombatSystem`, `MobManager` + AI, đòn của quái và telegraph, hồi phục, luật cast của `@vgtd/sim`) trên bản đồ trống với **đúng một quái** của def được chọn (docs/10 §4) và người chơi ở **cùng cảnh giới / tầng** với quái (trận cân sức). Người chơi gửi khung `skill_cast` thật qua `node.receive`, mỗi tick một quyết định; thời gian là giờ sim (20 Hz), ngẫu nhiên là các luồng có seed: kết quả là hàm thuần của cấu hình, chạy lại ra đúng số này.
- **Người chơi kịch bản** (`rotation.ts`): chỉ dựa vào dữ liệu kỹ năng, không dựa id kỹ năng. Hồi khi ai đó dưới 65% HP, khiên khi sẵn sàng, kỹ năng tiện ích (khống chế, buff, debuff, đánh dấu, khiêu khích, dot) khi sẵn sàng và trong tầm (D116), còn lại chọn kỹ năng sát thương có (sát thương / giây thi triển) cao nhất trong số đang sẵn sàng; luôn đứng yên (không né telegraph, không di chuyển), uống đan hồi máu (18%, 3 viên, hồi chiêu 8 s) khi dưới 40% HP. Kỹ năng mà **mọi** hiệu ứng đều bị máy chủ bỏ qua thì không được dùng (mục 2).
- **Dải cảnh giới**: Luyện Khí (quái thường mob_hoi_lang, tinh anh elite_lang_vuong), Trúc Cơ (mob_doc_thiem, elite_thiem_vuong), Kim Đan (mob_huyet_diep, elite_co_can_mau, boss boss_ho_vuong). Chỉ Kim Đan có boss trong docs/10. Mỗi ô chạy 6 / 4 / 3 hạt giống (quái thường / tinh anh / boss); hạt giống chỉ đổi cấp của quái trong cùng cảnh giới, và **mọi lớp gặp đúng các quái đó**. Số trong bảng là **trung vị** qua các hạt giống.
- **Dải ngoại lệ**: một lớp bị gắn cờ khi số đo lệch quá **±15%** so với trung vị của 6 lớp trong cùng ô. Lớp tank / hỗ trợ cố ý chậm hơn về sát thương (docs/11): cờ của chúng cần đọc cùng cột "vai trò".
- **Giới hạn của người chơi kịch bản**: không né telegraph (nên boss gây nhiều sát thương hơn người chơi thật gặp), không đổi vị trí, không dùng kỹ năng dịch chuyển, không có phối hợp. So sánh giữa các lớp công bằng (cùng người chơi, cùng quái), nhưng con số tuyệt đối (đặc biệt boss) là **cận dưới sống sót**.
- **Nhánh (solo / team)**: máy chủ chưa có nhánh (D49). Harness áp nhánh lên dữ liệu kỹ năng (`damage_mult`, `cooldown_mult`, `shield_mult` và `dmg_mult` / `heal_mult` / `shield_mult` của nhánh) rồi đưa cho **chính lõi chiến đấu**; các chỉ số nhánh máy chủ không biểu diễn được (`dmg_taken_mult`, `threat_mult`, `lifesteal_add`, `ally_crit_bonus`, `team_dmg`, `team_dr`) **không** được áp (mục 2 liệt kê).

## 2. Máy chủ mô phỏng được bao nhiêu bộ kỹ năng

Từ D116 máy chủ mô phỏng **mọi loại hiệu ứng** của bộ kỹ năng MVP: `resolveCast` cho sát thương / hồi / khiên tức thời, hệ thống hiệu ứng cho dot, khống chế, buff, debuff, đánh dấu, thú triệu hồi, lướt / đẩy / kéo, khiêu khích, hồi MP, hồi sinh. Bảng: số kỹ năng chủ động dùng được đầy đủ / một phần / tổng, và phần sát thương thiết kế (theo "đòn cơ bản tương đương") mà máy chủ tính được. Còn thiếu ở tầng khác (không phải loại hiệu ứng): `move_speed_pct`, `invuln_ms` của lướt, `silence`, `tribulation_reduction`, `trait` của lớp, nhánh solo / team (xem OPEN-ITEMS D116).

| Lớp     | Vai trò         | Đủ / một phần / tổng | Sát thương máy chủ tính được | Hiệu ứng bị bỏ qua (số kỹ năng) | Khống chế cứng thiết kế (tiềm năng) |
| ------- | --------------- | -------------------- | ---------------------------- | ------------------------------- | ----------------------------------- |
| kiem    | dps_mid         | 7 / 0 / 7            | 100%                         | —                               | 1 kỹ năng, 6% thời gian             |
| phap    | dps_ranged      | 8 / 0 / 8            | 100%                         | —                               | 1 kỹ năng, 17% thời gian            |
| the     | tank_melee      | 7 / 0 / 7            | 100%                         | —                               | 0 kỹ năng, 0% thời gian             |
| dan_phu | support_ranged  | 7 / 0 / 7            | 100%                         | —                               | 1 kỹ năng, 17% thời gian            |
| thuong  | vanguard_mid    | 7 / 0 / 7            | 100%                         | —                               | 2 kỹ năng, 14% thời gian            |
| dao     | berserker_melee | 7 / 0 / 7            | 100%                         | —                               | 2 kỹ năng, 15% thời gian            |

Chỉ số nhánh không áp được: kiem (solo: —; team: dmg_taken_mult=0.88, ally_crit_bonus=0.1); phap (solo: dmg_taken_mult=0.85; team: —); the (solo: —; team: dmg_taken_mult=0.85, threat_mult=3, team_dr=0.08); dan_phu (solo: —; team: —); thuong (solo: —; team: threat_mult=1.5, team_dmg=0.05); dao (solo: lifesteal_add=0.03; team: dmg_taken_mult=0.88, threat_mult=2.2, team_dmg=0.06).

**Chỉ số lớp** (D117): `makeProfile` áp `stat_weights` của lớp (docs/11) lên HP / MP / ATK / DEF / AGI, nên các lớp cùng cảnh giới có chỉ số khác nhau. Trước D117 mọi lớp cùng cảnh giới có đúng cùng chỉ số.

## 3. PvE một mình: thời gian hạ quái (TTK)

Nhánh solo, người chơi cùng cảnh giới với quái, đứng cạnh quái. **TTK** = trung vị số giây tới khi quái chết (chỉ tính các lần hạ được); **TTK dự phóng** = TTK khi hạ được, nếu không thì (thời gian đã đánh) / (phần HP quái đã trừ): so sánh được kể cả khi người chơi chết giữa chừng. DPS = sát thương / giây của cả trận.

### 3.1a Luyện Khí: quái thường `mob_hoi_lang` (giới hạn 120 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 5.0     | 5.0              | +5%         | 130 | 0%              |
| phap    | dps_ranged      | 100%    | 4.1     | 4.1              | -13%        | 199 | 0%              |
| the     | tank_melee      | 100%    | 7.4     | 7.4              | +57% ◄      | 114 | 0%              |
| dan_phu | support_ranged  | 100%    | 5.5     | 5.5              | +16% ◄      | 133 | 0%              |
| thuong  | vanguard_mid    | 100%    | 2.6     | 2.6              | -44% ◄      | 232 | 0%              |
| dao     | berserker_melee | 100%    | 4.5     | 4.5              | -5%         | 155 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ███████████········· 1.05x
phap     █████████··········· 0.87x
the      ████████████████···· 1.57x ◄ ngoài dải
dan_phu  ████████████········ 1.16x ◄ ngoài dải
thuong   ██████·············· 0.56x ◄ ngoài dải
dao      █████████··········· 0.95x
```

### 3.1b Luyện Khí: tinh anh `elite_lang_vuong` (giới hạn 300 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 30.4    | 30.4             | -5%         | 107 | 0%              |
| phap    | dps_ranged      | 100%    | 22.5    | 22.5             | -29% ◄      | 147 | 0%              |
| the     | tank_melee      | 100%    | 37.9    | 37.9             | +19% ◄      | 85  | 0%              |
| dan_phu | support_ranged  | 100%    | 23.3    | 23.3             | -27% ◄      | 139 | 0%              |
| thuong  | vanguard_mid    | 100%    | 33.3    | 33.3             | +5%         | 98  | 0%              |
| dao     | berserker_melee | 100%    | 38.5    | 38.5             | +21% ◄      | 85  | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ██████████·········· 0.95x
phap     ███████············· 0.71x ◄ ngoài dải
the      ████████████········ 1.19x ◄ ngoài dải
dan_phu  ███████············· 0.73x ◄ ngoài dải
thuong   ██████████·········· 1.05x
dao      ████████████········ 1.21x ◄ ngoài dải
```

### 3.2a Trúc Cơ: quái thường `mob_doc_thiem` (giới hạn 120 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 5.0     | 5.0              | +1%         | 221 | 0%              |
| phap    | dps_ranged      | 100%    | 5.3     | 5.3              | +8%         | 232 | 0%              |
| the     | tank_melee      | 100%    | 7.8     | 7.8              | +58% ◄      | 124 | 0%              |
| dan_phu | support_ranged  | 100%    | 4.8     | 4.8              | -1%         | 200 | 0%              |
| thuong  | vanguard_mid    | 100%    | 2.6     | 2.6              | -46% ◄      | 412 | 0%              |
| dao     | berserker_melee | 100%    | 4.5     | 4.5              | -9%         | 319 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ██████████·········· 1.01x
phap     ███████████········· 1.08x
the      ████████████████···· 1.58x ◄ ngoài dải
dan_phu  ██████████·········· 0.99x
thuong   █████··············· 0.54x ◄ ngoài dải
dao      █████████··········· 0.91x
```

### 3.2b Trúc Cơ: tinh anh `elite_thiem_vuong` (giới hạn 300 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 31.1    | 31.1             | -4%         | 179 | 0%              |
| phap    | dps_ranged      | 0%      | n/a     | 36.6             | +14%        | 149 | 15%             |
| the     | tank_melee      | 100%    | 31.3    | 31.3             | -3%         | 199 | 0%              |
| dan_phu | support_ranged  | 100%    | 17.1    | 17.1             | -47% ◄      | 326 | 0%              |
| thuong  | vanguard_mid    | 100%    | 33.3    | 33.3             | +3%         | 163 | 0%              |
| dao     | berserker_melee | 100%    | 33.1    | 33.1             | +3%         | 166 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ██████████·········· 0.96x
phap     ███████████········· 1.14x
the      ██████████·········· 0.97x
dan_phu  █████··············· 0.53x ◄ ngoài dải
thuong   ██████████·········· 1.03x
dao      ██████████·········· 1.03x
```

### 3.3a Kim Đan: quái thường `mob_huyet_diep` (giới hạn 120 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 4.3     | 4.3              | -1%         | 461 | 0%              |
| phap    | dps_ranged      | 100%    | 4.1     | 4.1              | -7%         | 466 | 0%              |
| the     | tank_melee      | 100%    | 7.3     | 7.3              | +65% ◄      | 291 | 0%              |
| dan_phu | support_ranged  | 100%    | 4.8     | 4.8              | +10%        | 352 | 0%              |
| thuong  | vanguard_mid    | 100%    | 2.0     | 2.0              | -53% ◄      | 955 | 0%              |
| dao     | berserker_melee | 100%    | 4.5     | 4.5              | +1%         | 562 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ██████████·········· 0.99x
phap     █████████··········· 0.93x
the      ████████████████···· 1.65x ◄ ngoài dải
dan_phu  ███████████········· 1.10x
thuong   █████··············· 0.47x ◄ ngoài dải
dao      ██████████·········· 1.01x
```

### 3.3b Kim Đan: tinh anh `elite_co_can_mau` (giới hạn 300 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 23.9    | 23.9             | -17% ◄      | 421 | 0%              |
| phap    | dps_ranged      | 100%    | 31.6    | 31.6             | +9%         | 314 | 0%              |
| the     | tank_melee      | 100%    | 45.3    | 45.3             | +57% ◄      | 245 | 0%              |
| dan_phu | support_ranged  | 100%    | 17.1    | 17.1             | -41% ◄      | 580 | 0%              |
| thuong  | vanguard_mid    | 100%    | 26.2    | 26.2             | -9%         | 386 | 0%              |
| dao     | berserker_melee | 100%    | 34.2    | 34.2             | +18% ◄      | 293 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ████████············ 0.83x ◄ ngoài dải
phap     ███████████········· 1.09x
the      ████████████████···· 1.57x ◄ ngoài dải
dan_phu  ██████·············· 0.59x ◄ ngoài dải
thuong   █████████··········· 0.91x
dao      ████████████········ 1.18x ◄ ngoài dải
```

### 3.3c Kim Đan: boss `boss_ho_vuong` (giới hạn 900 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 0%      | n/a     | 603.9            | -13%        | 309 | 91%             |
| phap    | dps_ranged      | 0%      | n/a     | 702.5            | +1%         | 265 | 97%             |
| the     | tank_melee      | 0%      | n/a     | 1047.4           | +51% ◄      | 197 | 96%             |
| dan_phu | support_ranged  | 0%      | n/a     | 519.1            | -25% ◄      | 359 | 89%             |
| thuong  | vanguard_mid    | 0%      | n/a     | 686.2            | -1%         | 269 | 93%             |
| dao     | berserker_melee | 0%      | n/a     | 820.9            | +18% ◄      | 226 | 96%             |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     █████████··········· 0.87x
phap     ██████████·········· 1.01x
the      ███████████████····· 1.51x ◄ ngoài dải
dan_phu  ███████············· 0.75x ◄ ngoài dải
thuong   ██████████·········· 0.99x
dao      ████████████········ 1.18x ◄ ngoài dải
```

### 3.4 Nhánh solo so với nhánh team (TTK dự phóng, team / solo)

| Lớp     | Luyện Khí quái thường | Luyện Khí tinh anh | Trúc Cơ quái thường | Trúc Cơ tinh anh | Kim Đan quái thường | Kim Đan tinh anh |
| ------- | --------------------- | ------------------ | ------------------- | ---------------- | ------------------- | ---------------- |
| kiem    | 1.15x                 | 1.44x              | 1.29x               | 1.48x            | 1.14x               | 1.35x            |
| phap    | 1.21x                 | 1.21x              | 0.93x               | 1.16x            | 1.21x               | 1.17x            |
| the     | 1.13x                 | 1.27x              | 1.08x               | 1.29x            | 1.15x               | 1.28x            |
| dan_phu | 1.00x                 | 1.03x              | 1.00x               | 1.24x            | 1.00x               | 1.24x            |
| thuong  | 1.47x                 | 1.41x              | 1.55x               | 1.42x            | 1.29x               | 1.33x            |
| dao     | 1.22x                 | 1.38x              | 1.00x               | 1.53x            | 1.00x               | 1.52x            |

(>1 = nhánh team chậm hơn khi đánh một mình, đúng thiết kế: nhánh team đổi sát thương cá nhân lấy giá trị cho đội.)

## 4. Sống sót khi đánh một mình

"Sống sót" = không chết trước khi hạ quái hoặc hết giờ. "HP thấp nhất" = trung vị mức HP thấp nhất đã chạm (0% = chết hoặc suýt chết). "Sát thương nhận" = % HP tối đa mất mỗi giây (trung vị). Người chơi không né telegraph nên số này cao hơn thực tế.

**Luyện Khí · quái thường**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 97%          | 2.55                    | +14%        | 0.0      |
| phap    | 100%     | 92%          | 1.97                    | -12%        | 0.0      |
| the     | 100%     | 100%         | 1.72                    | -23% ◄      | 0.0      |
| dan_phu | 100%     | 100%         | 2.86                    | +28% ◄      | 0.0      |
| thuong  | 100%     | 100%         | 1.07                    | -52% ◄      | 0.0      |
| dao     | 100%     | 92%          | 2.51                    | +12%        | 0.0      |

**Luyện Khí · tinh anh**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 46%          | 4.06                    | +10%        | 0.0      |
| phap    | 100%     | 39%          | 3.29                    | -10%        | 1.0      |
| the     | 100%     | 40%          | 3.07                    | -17% ◄      | 1.0      |
| dan_phu | 100%     | 74%          | 4.33                    | +18% ◄      | 0.0      |
| thuong  | 100%     | 35%          | 3.03                    | -18% ◄      | 2.0      |
| dao     | 100%     | 6%           | 4.51                    | +23% ◄      | 3.0      |

**Trúc Cơ · quái thường**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 98%          | 2.54                    | +138% ◄     | 0.0      |
| phap    | 100%     | 96%          | 0.83                    | -22% ◄      | 0.0      |
| the     | 100%     | 100%         | 1.07                    | +0%         | 0.0      |
| dan_phu | 100%     | 100%         | 1.81                    | +70% ◄      | 0.0      |
| thuong  | 100%     | 100%         | 1.06                    | -0%         | 0.0      |
| dao     | 100%     | 97%          | 0.68                    | -37% ◄      | 0.0      |

**Trúc Cơ · tinh anh**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 63%          | 3.28                    | +13%        | 0.0      |
| phap    | 0%       | 5%           | 4.58                    | +58% ◄      | 2.0      |
| the     | 100%     | 80%          | 2.25                    | -23% ◄      | 0.0      |
| dan_phu | 100%     | 91%          | 2.53                    | -13%        | 0.0      |
| thuong  | 100%     | 32%          | 2.91                    | -0%         | 1.3      |
| dao     | 100%     | 40%          | 2.91                    | +0%         | 1.0      |

**Kim Đan · quái thường**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 100%         | 2.33                    | +87% ◄      | 0.0      |
| phap    | 100%     | 97%          | 0.80                    | -36% ◄      | 0.0      |
| the     | 100%     | 100%         | 2.00                    | +60% ◄      | 0.0      |
| dan_phu | 100%     | 100%         | 1.69                    | +36% ◄      | 0.0      |
| thuong  | 100%     | 100%         | 0.00                    | -100% ◄     | 0.0      |
| dao     | 100%     | 97%          | 0.67                    | -46% ◄      | 0.0      |

**Kim Đan · tinh anh**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 83%          | 2.55                    | +5%         | 0.0      |
| phap    | 100%     | 37%          | 2.72                    | +13%        | 2.0      |
| the     | 100%     | 37%          | 2.92                    | +21% ◄      | 1.0      |
| dan_phu | 100%     | 96%          | 1.91                    | -21% ◄      | 0.0      |
| thuong  | 100%     | 59%          | 1.91                    | -21% ◄      | 0.0      |
| dao     | 100%     | 41%          | 2.29                    | -5%         | 0.0      |

**Kim Đan · boss**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 0%       | 1%           | 5.23                    | -0%         | 3.0      |
| phap    | 0%       | 4%           | 6.41                    | +22% ◄      | 2.0      |
| the     | 0%       | 3%           | 5.26                    | +0%         | 3.0      |
| dan_phu | 0%       | 1%           | 6.09                    | +16% ◄      | 2.0      |
| thuong  | 0%       | 8%           | 4.20                    | -20% ◄      | 3.0      |
| dao     | 0%       | 4%           | 5.00                    | -5%         | 2.0      |

## 5. Đóng góp trong tổ đội

Một thành viên (lớp thử, nhánh solo hoặc team) cộng ba đồng đội tham chiếu cố định (the, dan_phu, dao, kiem, bỏ lớp đang thử) đánh `boss_ho_vuong` (boss Kim Đan, giới hạn 600 s). Đội 4 người cùng cảnh giới, không né đòn, **không đội nào hạ được boss trong giới hạn thời gian** (đội chết rồi hồi sinh liên tục): số đo đáng tin là phần đóng góp, không phải tỷ lệ thắng. "Phần" = (sát thương + hồi + khiên) của lớp thử / tổng của đội. Hồi và khiên được ghi cho người thi triển kỹ năng hồi / khiên trong cùng bước (chia đều nếu nhiều người).

| Lớp     | Nhánh | Hạ boss | Thời gian trận (s) | Chết cả đội / trận | HP boss còn | DPS | Hồi/s | Khiên/s | Phần đóng góp |
| ------- | ----- | ------- | ------------------ | ------------------ | ----------- | --- | ----- | ------- | ------------- |
| kiem    | solo  | 0%      | 600                | 3.3                | 73%         | 7   | 0     | 51      | 31%           |
| kiem    | team  | 0%      | 600                | 3.3                | 74%         | 5   | 1     | 46      | 28%           |
| phap    | solo  | 0%      | 600                | 3.3                | 60%         | 31  | 0     | 0       | 13%           |
| phap    | team  | 0%      | 600                | 3.3                | 63%         | 28  | 0     | 1       | 12%           |
| the     | solo  | 0%      | 600                | 3.0                | 74%         | 13  | 0     | 46      | 23%           |
| the     | team  | 0%      | 600                | 3.0                | 74%         | 13  | 0     | 53      | 25%           |
| dan_phu | solo  | 0%      | 600                | 3.0                | 73%         | 36  | 3     | 78      | 45%           |
| dan_phu | team  | 0%      | 600                | 3.0                | 67%         | 34  | 5     | 101     | 45%           |
| thuong  | solo  | 0%      | 600                | 4.0                | 65%         | 27  | 0     | 16      | 23%           |
| thuong  | team  | 0%      | 600                | 4.0                | 67%         | 22  | 0     | 15      | 20%           |
| dao     | solo  | 0%      | 600                | 3.0                | 72%         | 27  | 0     | 0       | 10%           |
| dao     | team  | 0%      | 600                | 3.3                | 73%         | 17  | 0     | 0       | 7%            |

**Khống chế (uptime)**: từ D116 máy chủ áp khống chế lên quái (choáng / trói / chậm; boss miễn khống chế, chỉ bị ngắt đòn), nhưng harness chưa đo thời gian quái bị khống chế. Cột "Khống chế cứng thiết kế" ở mục 2 là tiềm năng theo dữ liệu (tổng thời lượng / hồi chiêu của các hiệu ứng stun, freeze, knock-up, root), không phải kết quả chạy.

## 6. Ma trận đấu tay đôi 6×6 (chỉ để tham khảo)

Máy chủ chưa có PvP, nên đây **không** chạy trên `WorldNode` mà là mô hình hai thân thể trên chính `makeProfile` + `resolveCast` + cùng người chơi kịch bản (`duel.ts`): cooldown, GCD, MP, thời gian cast, khiên và HP đúng như lõi chiến đấu; không di chuyển, không trạng thái, không đan, không hệ số PvP. Cảnh giới 2 tầng 3, 6 hạt giống mỗi cặp, nhánh solo. Ô = tỷ lệ thắng của **hàng** trước **cột** (hòa tính nửa).

| hàng \ cột | kiem | phap | the  | dan_phu | thuong | dao  | trung bình |
| ---------- | ---- | ---- | ---- | ------- | ------ | ---- | ---------- |
| kiem       | 83%  | 0%   | 100% | 100%    | 100%   | 100% | 81%        |
| phap       | 100% | 67%  | 100% | 0%      | 100%   | 0%   | 61%        |
| the        | 0%   | 0%   | 50%  | 0%      | 0%     | 0%   | 8%         |
| dan_phu    | 0%   | 100% | 100% | 83%     | 0%     | 100% | 64%        |
| thuong     | 0%   | 0%   | 100% | 100%    | 67%    | 100% | 61%        |
| dao        | 0%   | 100% | 100% | 0%      | 0%     | 67%  | 44%        |

Thời gian trận (s, trung vị):

| hàng \ cột | kiem | phap | the | dan_phu | thuong | dao |
| ---------- | ---- | ---- | --- | ------- | ------ | --- |
| kiem       | 15   | 9    | 22  | 37      | 15     | 8   |
| phap       | 9    | 7    | 23  | 35      | 14     | 14  |
| the        | 22   | 23   | 180 | 48      | 26     | 23  |
| dan_phu    | 37   | 35   | 48  | 64      | 38     | 37  |
| thuong     | 15   | 14   | 26  | 38      | 21     | 12  |
| dao        | 8    | 14   | 23  | 40      | 13     | 20  |

## 7. Mô phỏng thiết kế (docs/11 §4.5) so với máy chủ

Mô phỏng thiết kế (`skill_sim.ts`) chạy **đủ** bộ kỹ năng; cột máy chủ là DPS trung vị ở Kim Đan, quái thường, nhánh solo. Cả hai chuẩn hoá theo trung vị của 6 lớp: chênh lệch lớn nghĩa là hệ số / công thức của máy chủ cho thứ hạng khác mô phỏng thiết kế (còn lại: `move_speed_pct`, `invuln_ms`, `trait` của lớp, nhánh solo / team chưa có trên máy chủ; người chơi kịch bản không né, không di chuyển).

| Lớp     | Mô phỏng thiết kế (x đòn cơ bản) | so trung vị | DPS máy chủ | so trung vị | Chênh (máy chủ − thiết kế) |
| ------- | -------------------------------- | ----------- | ----------- | ----------- | -------------------------- |
| kiem    | 1.70                             | +2%         | 461         | -1%         | -3%                        |
| phap    | 1.68                             | +1%         | 466         | +1%         | -0%                        |
| the     | 1.59                             | -5%         | 291         | -37%        | -33%                       |
| dan_phu | 1.55                             | -7%         | 352         | -24%        | -17%                       |
| thuong  | 1.65                             | -1%         | 955         | +106%       | +107%                      |
| dao     | 1.70                             | +2%         | 562         | +21%        | +19%                       |

## 8. Ngoại lệ ngoài dải ±15%

| Ô                         | Lớp     | Vai trò         | Chỉ số          | Giá trị    | Trung vị   | Lệch  |
| ------------------------- | ------- | --------------- | --------------- | ---------- | ---------- | ----- |
| luyen_khi / normal / solo | the     | tank_melee      | TTK dự phóng    | 7.4 s      | 4.7 s      | +57%  |
| luyen_khi / normal / solo | dan_phu | support_ranged  | TTK dự phóng    | 5.5 s      | 4.7 s      | +16%  |
| luyen_khi / normal / solo | thuong  | vanguard_mid    | TTK dự phóng    | 2.6 s      | 4.7 s      | -44%  |
| luyen_khi / elite / solo  | phap    | dps_ranged      | TTK dự phóng    | 22.5 s     | 31.9 s     | -29%  |
| luyen_khi / elite / solo  | the     | tank_melee      | TTK dự phóng    | 37.9 s     | 31.9 s     | +19%  |
| luyen_khi / elite / solo  | dan_phu | support_ranged  | TTK dự phóng    | 23.3 s     | 31.9 s     | -27%  |
| luyen_khi / elite / solo  | dao     | berserker_melee | TTK dự phóng    | 38.5 s     | 31.9 s     | +21%  |
| truc_co / normal / solo   | the     | tank_melee      | TTK dự phóng    | 7.8 s      | 4.9 s      | +58%  |
| truc_co / normal / solo   | thuong  | vanguard_mid    | TTK dự phóng    | 2.6 s      | 4.9 s      | -46%  |
| truc_co / elite / solo    | dan_phu | support_ranged  | TTK dự phóng    | 17.1 s     | 32.2 s     | -47%  |
| kim_dan / normal / solo   | the     | tank_melee      | TTK dự phóng    | 7.3 s      | 4.4 s      | +65%  |
| kim_dan / normal / solo   | thuong  | vanguard_mid    | TTK dự phóng    | 2.0 s      | 4.4 s      | -53%  |
| kim_dan / elite / solo    | kiem    | dps_mid         | TTK dự phóng    | 23.9 s     | 28.9 s     | -17%  |
| kim_dan / elite / solo    | the     | tank_melee      | TTK dự phóng    | 45.3 s     | 28.9 s     | +57%  |
| kim_dan / elite / solo    | dan_phu | support_ranged  | TTK dự phóng    | 17.1 s     | 28.9 s     | -41%  |
| kim_dan / elite / solo    | dao     | berserker_melee | TTK dự phóng    | 34.2 s     | 28.9 s     | +18%  |
| kim_dan / boss / solo     | the     | tank_melee      | TTK dự phóng    | 1047.4 s   | 694.3 s    | +51%  |
| kim_dan / boss / solo     | dan_phu | support_ranged  | TTK dự phóng    | 519.1 s    | 694.3 s    | -25%  |
| kim_dan / boss / solo     | dao     | berserker_melee | TTK dự phóng    | 820.9 s    | 694.3 s    | +18%  |
| luyen_khi / normal / solo | the     | tank_melee      | sát thương nhận | 1.72 %HP/s | 2.24 %HP/s | -23%  |
| luyen_khi / normal / solo | dan_phu | support_ranged  | sát thương nhận | 2.86 %HP/s | 2.24 %HP/s | +28%  |
| luyen_khi / normal / solo | thuong  | vanguard_mid    | sát thương nhận | 1.07 %HP/s | 2.24 %HP/s | -52%  |
| luyen_khi / elite / solo  | the     | tank_melee      | sát thương nhận | 3.07 %HP/s | 3.68 %HP/s | -17%  |
| luyen_khi / elite / solo  | dan_phu | support_ranged  | sát thương nhận | 4.33 %HP/s | 3.68 %HP/s | +18%  |
| luyen_khi / elite / solo  | thuong  | vanguard_mid    | sát thương nhận | 3.03 %HP/s | 3.68 %HP/s | -18%  |
| luyen_khi / elite / solo  | dao     | berserker_melee | sát thương nhận | 4.51 %HP/s | 3.68 %HP/s | +23%  |
| truc_co / normal / solo   | kiem    | dps_mid         | sát thương nhận | 2.54 %HP/s | 1.07 %HP/s | +138% |
| truc_co / normal / solo   | phap    | dps_ranged      | sát thương nhận | 0.83 %HP/s | 1.07 %HP/s | -22%  |
| truc_co / normal / solo   | dan_phu | support_ranged  | sát thương nhận | 1.81 %HP/s | 1.07 %HP/s | +70%  |
| truc_co / normal / solo   | dao     | berserker_melee | sát thương nhận | 0.68 %HP/s | 1.07 %HP/s | -37%  |
| truc_co / elite / solo    | phap    | dps_ranged      | sát thương nhận | 4.58 %HP/s | 2.91 %HP/s | +58%  |
| truc_co / elite / solo    | the     | tank_melee      | sát thương nhận | 2.25 %HP/s | 2.91 %HP/s | -23%  |
| kim_dan / normal / solo   | kiem    | dps_mid         | sát thương nhận | 2.33 %HP/s | 1.25 %HP/s | +87%  |
| kim_dan / normal / solo   | phap    | dps_ranged      | sát thương nhận | 0.80 %HP/s | 1.25 %HP/s | -36%  |
| kim_dan / normal / solo   | the     | tank_melee      | sát thương nhận | 2.00 %HP/s | 1.25 %HP/s | +60%  |
| kim_dan / normal / solo   | dan_phu | support_ranged  | sát thương nhận | 1.69 %HP/s | 1.25 %HP/s | +36%  |
| kim_dan / normal / solo   | thuong  | vanguard_mid    | sát thương nhận | 0.00 %HP/s | 1.25 %HP/s | -100% |
| kim_dan / normal / solo   | dao     | berserker_melee | sát thương nhận | 0.67 %HP/s | 1.25 %HP/s | -46%  |
| kim_dan / elite / solo    | the     | tank_melee      | sát thương nhận | 2.92 %HP/s | 2.42 %HP/s | +21%  |
| kim_dan / elite / solo    | dan_phu | support_ranged  | sát thương nhận | 1.91 %HP/s | 2.42 %HP/s | -21%  |
| kim_dan / elite / solo    | thuong  | vanguard_mid    | sát thương nhận | 1.91 %HP/s | 2.42 %HP/s | -21%  |
| kim_dan / boss / solo     | phap    | dps_ranged      | sát thương nhận | 6.41 %HP/s | 5.25 %HP/s | +22%  |
| kim_dan / boss / solo     | dan_phu | support_ranged  | sát thương nhận | 6.09 %HP/s | 5.25 %HP/s | +16%  |
| kim_dan / boss / solo     | thuong  | vanguard_mid    | sát thương nhận | 4.20 %HP/s | 5.25 %HP/s | -20%  |

### 8.1 Độ lệch theo lớp (trung bình nhân của TTK dự phóng / trung vị, quái thường và tinh anh, nhánh solo)

```
kiem     ██████████·········· 0.96x  (trong dải)
phap     ██████████·········· 0.96x  (trong dải)
the      ██████████████······ 1.40x  (chậm hơn dải)
dan_phu  ████████············ 0.81x  (nhanh hơn dải)
thuong   ███████············· 0.72x  (nhanh hơn dải)
dao      ██████████·········· 1.04x  (trong dải)
```

## 9. Đề xuất chỉnh (chưa áp dụng)

Sinh theo quy tắc từ các số trên; **cần chủ dự án / game designer duyệt** trước khi đổi bất kỳ số nào (skill `vgtd-formula-change`: DECISIONS trước, rồi `skills.json`, test, tài liệu). Hệ số gợi ý = nhân sát thương với độ lệch để đưa TTK của lớp về trung vị (TTK tỷ lệ nghịch với sát thương); đây là bước đầu thô, chưa tính tương tác với sống sót và đội.

| #   | Lớp     | Quan sát                                                             | Đề xuất                                                                                                                  |
| --- | ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | the     | chậm hơn trung vị 40% về TTK (vai trò tank_melee: một phần là chủ ý) | giữ nếu đóng góp đội (mục 5) bù lại; nếu không, tăng sát thương ≈ +40%                                                   |
| 2   | dan_phu | nhanh hơn trung vị 19% về TTK                                        | giảm sát thương ≈ -19%, hoặc tăng chi phí MP / hồi chiêu                                                                 |
| 3   | thuong  | nhanh hơn trung vị 28% về TTK                                        | giảm sát thương ≈ -28%, hoặc tăng chi phí MP / hồi chiêu                                                                 |
| 4   | cả 6    | nhánh solo / team không có trên máy chủ                              | cài nhánh (chỉ số `dmg_taken_mult`, `threat_mult`, `team_dmg` ... chưa có chỗ áp) để mục 3.4 và 5 phản ánh đúng thiết kế |
| 5   | boss    | không đội 4 người không né nào hạ được `boss_ho_vuong`               | kiểm tra lại HP × 45 / ATK × 1,5 của boss (docs/10 §4.1) cùng telegraph; hoặc đo lại khi harness biết né                 |

## 10. Chạy lại

```bash
npm run balance -w @vgtd/server                       # bản đầy đủ, ghi docs/36-bao-cao-can-bang-dao-lo.md
npm run balance -w @vgtd/server -- --quick --out -    # bản nhanh, in ra màn hình
```

Cấu hình: hạt giống quái thường / tinh anh / boss = 6 / 4 / 3, 6 hạt giống mỗi cặp đấu tay đôi, dải ngoại lệ ±15%. Mã: `apps/server/src/balance/`; thử nghiệm: `apps/server/tests/balance.test.ts`.
