# Báo cáo cân bằng 6 Đạo Lộ (D115)

> **Tự sinh** bởi `npm run balance -w @vgtd/server` (xem mục 10). Không sửa tay: chạy lại để cập nhật. **Báo cáo này không đổi con số nào**; đề xuất chỉnh ở mục 9 chỉ là gợi ý, mọi thay đổi đi qua `vgtd-formula-change` sau khi chủ dự án duyệt. Mọi số trong `skills.json` vẫn là "Đề xuất – chờ duyệt" (D49).

## 1. Phương pháp và giới hạn

- **Chạy trên mã máy chủ thật**: `WorldNode` (lõi chiến đấu `CombatSystem`, `MobManager` + AI, đòn của quái và telegraph, hồi phục, luật cast của `@vgtd/sim`) trên bản đồ trống với **đúng một quái** của def được chọn (docs/10 §4) và người chơi ở **cùng cảnh giới / tầng** với quái (trận cân sức). Người chơi gửi khung `skill_cast` thật qua `node.receive`, mỗi tick một quyết định; thời gian là giờ sim (20 Hz), ngẫu nhiên là các luồng có seed: kết quả là hàm thuần của cấu hình, chạy lại ra đúng số này.
- **Người chơi kịch bản** (`rotation.ts`): chỉ dựa vào dữ liệu kỹ năng, không dựa id kỹ năng. Hồi khi ai đó dưới 65% HP, khiên khi sẵn sàng, còn lại chọn kỹ năng sát thương có (sát thương / giây thi triển) cao nhất trong số đang sẵn sàng; luôn đứng yên (không né telegraph, không di chuyển), uống đan hồi máu (18%, 3 viên, hồi chiêu 8 s) khi dưới 40% HP. Kỹ năng mà **mọi** hiệu ứng đều bị máy chủ bỏ qua thì không được dùng (mục 2).
- **Dải cảnh giới**: Luyện Khí (quái thường mob_hoi_lang, tinh anh elite_lang_vuong), Trúc Cơ (mob_doc_thiem, elite_thiem_vuong), Kim Đan (mob_huyet_diep, elite_co_can_mau, boss boss_ho_vuong). Chỉ Kim Đan có boss trong docs/10. Mỗi ô chạy 6 / 4 / 3 hạt giống (quái thường / tinh anh / boss); hạt giống chỉ đổi cấp của quái trong cùng cảnh giới, và **mọi lớp gặp đúng các quái đó**. Số trong bảng là **trung vị** qua các hạt giống.
- **Dải ngoại lệ**: một lớp bị gắn cờ khi số đo lệch quá **±15%** so với trung vị của 6 lớp trong cùng ô. Lớp tank / hỗ trợ cố ý chậm hơn về sát thương (docs/11): cờ của chúng cần đọc cùng cột "vai trò".
- **Giới hạn của người chơi kịch bản**: không né telegraph (nên boss gây nhiều sát thương hơn người chơi thật gặp), không đổi vị trí, không dùng kỹ năng dịch chuyển, không có phối hợp. So sánh giữa các lớp công bằng (cùng người chơi, cùng quái), nhưng con số tuyệt đối (đặc biệt boss) là **cận dưới sống sót**.
- **Nhánh (solo / team)**: máy chủ chưa có nhánh (D49). Harness áp nhánh lên dữ liệu kỹ năng (`damage_mult`, `cooldown_mult`, `shield_mult` và `dmg_mult` / `heal_mult` / `shield_mult` của nhánh) rồi đưa cho **chính lõi chiến đấu**; các chỉ số nhánh máy chủ không biểu diễn được (`dmg_taken_mult`, `threat_mult`, `lifesteal_add`, `ally_crit_bonus`, `team_dmg`, `team_dr`) **không** được áp (mục 2 liệt kê).

## 2. Máy chủ mô phỏng được bao nhiêu bộ kỹ năng

`resolveCast` chỉ xử lý hiệu ứng `damage`, `heal`, `shield`. Mọi hiệu ứng khác (dot, trạng thái khống chế, buff, đánh dấu, triệu hồi, dịch chuyển, khiêu khích ...) hiện **không có tác dụng** trên máy chủ. Bảng: số kỹ năng chủ động dùng được đầy đủ / một phần / tổng, và phần sát thương thiết kế (theo "đòn cơ bản tương đương") mà máy chủ tính được.

| Lớp     | Vai trò         | Đủ / một phần / tổng | Sát thương máy chủ tính được | Hiệu ứng bị bỏ qua (số kỹ năng)                                   | Khống chế cứng thiết kế (tiềm năng) |
| ------- | --------------- | -------------------- | ---------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| kiem    | dps_mid         | 4 / 3 / 7            | 100%                         | status ×1, dash ×1, buff ×1, hot ×1                               | 1 kỹ năng, 6% thời gian             |
| phap    | dps_ranged      | 5 / 2 / 8            | 99%                          | status ×2, dot ×1, dash ×1, restore_mp ×1                         | 1 kỹ năng, 17% thời gian            |
| the     | tank_melee      | 3 / 2 / 7            | 100%                         | status ×1, pull ×1, buff ×2, dash ×1, knockback ×1                | 0 kỹ năng, 0% thời gian             |
| dan_phu | support_ranged  | 3 / 1 / 7            | 71%                          | mark ×1, hot ×1, dot ×1, status ×1, dash ×1, buff ×1, detonate ×1 | 1 kỹ năng, 17% thời gian            |
| thuong  | vanguard_mid    | 2 / 5 / 7            | 100%                         | dash ×2, status ×2, buff ×2, debuff ×1                            | 2 kỹ năng, 14% thời gian            |
| dao     | berserker_melee | 2 / 4 / 7            | 100%                         | buff ×4, dash ×1, status ×2                                       | 2 kỹ năng, 15% thời gian            |

Chỉ số nhánh không áp được: kiem (solo: —; team: dmg_taken_mult=0.88, ally_crit_bonus=0.1); phap (solo: dmg_taken_mult=0.85; team: —); the (solo: —; team: dmg_taken_mult=0.85, threat_mult=3, team_dr=0.08); dan_phu (solo: —; team: —); thuong (solo: —; team: threat_mult=1.5, team_dmg=0.05); dao (solo: lifesteal_add=0.03; team: dmg_taken_mult=0.88, threat_mult=2.2, team_dmg=0.06).

**Phát hiện**: hồ sơ chiến đấu của máy chủ (`makeProfile`) lấy chỉ số cảnh giới thô (`roundedStatsAt`) và **không áp `stat_weights` của lớp** (docs/11: HP / MP / ATK / DEF khác nhau theo lớp): mọi lớp cùng cảnh giới có đúng cùng HP, MP, ATK, DEF. Bản sắc lớp trên máy chủ hôm nay chỉ đến từ kỹ năng.

## 3. PvE một mình: thời gian hạ quái (TTK)

Nhánh solo, người chơi cùng cảnh giới với quái, đứng cạnh quái. **TTK** = trung vị số giây tới khi quái chết (chỉ tính các lần hạ được); **TTK dự phóng** = TTK khi hạ được, nếu không thì (thời gian đã đánh) / (phần HP quái đã trừ): so sánh được kể cả khi người chơi chết giữa chừng. DPS = sát thương / giây của cả trận.

### 3.1a Luyện Khí: quái thường `mob_hoi_lang` (giới hạn 120 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 5.0     | 5.0              | +4%         | 121 | 0%              |
| phap    | dps_ranged      | 100%    | 3.9     | 3.9              | -18% ◄      | 186 | 0%              |
| the     | tank_melee      | 100%    | 10.5    | 10.5             | +120% ◄     | 55  | 0%              |
| dan_phu | support_ranged  | 100%    | 11.5    | 11.5             | +141% ◄     | 50  | 0%              |
| thuong  | vanguard_mid    | 100%    | 2.6     | 2.6              | -45% ◄      | 219 | 0%              |
| dao     | berserker_melee | 100%    | 4.6     | 4.6              | -4%         | 128 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ██████████·········· 1.04x
phap     ████████············ 0.82x ◄ ngoài dải
the      ████████████████████ 2.20x ◄ ngoài dải
dan_phu  ████████████████████ 2.41x ◄ ngoài dải
thuong   ██████·············· 0.55x ◄ ngoài dải
dao      ██████████·········· 0.96x
```

### 3.1b Luyện Khí: tinh anh `elite_lang_vuong` (giới hạn 300 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 35.5    | 35.5             | -12%        | 91  | 0%              |
| phap    | dps_ranged      | 100%    | 25.8    | 25.8             | -36% ◄      | 127 | 0%              |
| the     | tank_melee      | 0%      | n/a     | 66.2             | +65% ◄      | 48  | 25%             |
| dan_phu | support_ranged  | 100%    | 82.7    | 82.7             | +106% ◄     | 39  | 0%              |
| thuong  | vanguard_mid    | 100%    | 36.9    | 36.9             | -8%         | 90  | 0%              |
| dao     | berserker_melee | 0%      | n/a     | 43.4             | +8%         | 74  | 40%             |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     █████████··········· 0.88x
phap     ██████·············· 0.64x ◄ ngoài dải
the      ████████████████···· 1.65x ◄ ngoài dải
dan_phu  ████████████████████ 2.06x ◄ ngoài dải
thuong   █████████··········· 0.92x
dao      ███████████········· 1.08x
```

### 3.2a Trúc Cơ: quái thường `mob_doc_thiem` (giới hạn 120 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 5.0     | 5.0              | -1%         | 204 | 0%              |
| phap    | dps_ranged      | 100%    | 5.1     | 5.1              | +1%         | 217 | 0%              |
| the     | tank_melee      | 100%    | 9.8     | 9.8              | +96% ◄      | 120 | 0%              |
| dan_phu | support_ranged  | 100%    | 9.4     | 9.4              | +88% ◄      | 108 | 0%              |
| thuong  | vanguard_mid    | 100%    | 2.6     | 2.6              | -47% ◄      | 389 | 0%              |
| dao     | berserker_melee | 100%    | 3.6     | 3.6              | -28% ◄      | 287 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ██████████·········· 0.99x
phap     ██████████·········· 1.01x
the      ████████████████████ 1.96x ◄ ngoài dải
dan_phu  ███████████████████· 1.88x ◄ ngoài dải
thuong   █████··············· 0.53x ◄ ngoài dải
dao      ███████············· 0.72x ◄ ngoài dải
```

### 3.2b Trúc Cơ: tinh anh `elite_thiem_vuong` (giới hạn 300 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 35.9    | 35.9             | -14%        | 156 | 0%              |
| phap    | dps_ranged      | 0%      | n/a     | 41.0             | -2%         | 134 | 29%             |
| the     | tank_melee      | 100%    | 51.7    | 51.7             | +23% ◄      | 110 | 0%              |
| dan_phu | support_ranged  | 100%    | 69.8    | 69.8             | +67% ◄      | 79  | 0%              |
| thuong  | vanguard_mid    | 100%    | 37.3    | 37.3             | -11%        | 151 | 0%              |
| dao     | berserker_melee | 100%    | 42.8    | 42.8             | +2%         | 132 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     █████████··········· 0.86x
phap     ██████████·········· 0.98x
the      ████████████········ 1.23x ◄ ngoài dải
dan_phu  █████████████████··· 1.67x ◄ ngoài dải
thuong   █████████··········· 0.89x
dao      ██████████·········· 1.02x
```

### 3.3a Kim Đan: quái thường `mob_huyet_diep` (giới hạn 120 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 4.3     | 4.3              | +5%         | 426 | 0%              |
| phap    | dps_ranged      | 100%    | 3.9     | 3.9              | -5%         | 429 | 0%              |
| the     | tank_melee      | 100%    | 14.2    | 14.2             | +243% ◄     | 121 | 0%              |
| dan_phu | support_ranged  | 100%    | 9.4     | 9.4              | +129% ◄     | 191 | 0%              |
| thuong  | vanguard_mid    | 100%    | 2.0     | 2.0              | -50% ◄      | 904 | 0%              |
| dao     | berserker_melee | 100%    | 3.6     | 3.6              | -13%        | 505 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ███████████········· 1.05x
phap     █████████··········· 0.95x
the      ████████████████████ 3.43x ◄ ngoài dải
dan_phu  ████████████████████ 2.29x ◄ ngoài dải
thuong   █████··············· 0.50x ◄ ngoài dải
dao      █████████··········· 0.87x
```

### 3.3b Kim Đan: tinh anh `elite_co_can_mau` (giới hạn 300 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 100%    | 29.2    | 29.2             | -28% ◄      | 371 | 0%              |
| phap    | dps_ranged      | 100%    | 38.0    | 38.0             | -6%         | 273 | 0%              |
| the     | tank_melee      | 0%      | n/a     | 77.0             | +90% ◄      | 128 | 32%             |
| dan_phu | support_ranged  | 100%    | 70.4    | 70.4             | +73% ◄      | 142 | 0%              |
| thuong  | vanguard_mid    | 100%    | 28.3    | 28.3             | -30% ◄      | 339 | 0%              |
| dao     | berserker_melee | 100%    | 43.2    | 43.2             | +6%         | 236 | 0%              |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ███████············· 0.72x ◄ ngoài dải
phap     █████████··········· 0.94x
the      ███████████████████· 1.90x ◄ ngoài dải
dan_phu  █████████████████··· 1.73x ◄ ngoài dải
thuong   ███████············· 0.70x ◄ ngoài dải
dao      ███████████········· 1.06x
```

### 3.3c Kim Đan: boss `boss_ho_vuong` (giới hạn 900 s)

| Lớp     | Vai trò         | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |
| ------- | --------------- | ------- | ------- | ---------------- | ----------- | --- | --------------- |
| kiem    | dps_mid         | 0%      | n/a     | 677.3            | -20% ◄      | 273 | 94%             |
| phap    | dps_ranged      | 0%      | n/a     | 778.9            | -8%         | 239 | 97%             |
| the     | tank_melee      | 0%      | n/a     | 2598.3           | +205% ◄     | 72  | 99%             |
| dan_phu | support_ranged  | 0%      | n/a     | 1731.1           | +103% ◄     | 107 | 95%             |
| thuong  | vanguard_mid    | 0%      | n/a     | 710.9            | -16% ◄      | 258 | 95%             |
| dao     | berserker_melee | 0%      | n/a     | 922.4            | +8%         | 200 | 97%             |

```
TTK dự phóng  (1.00 = trung vị của 6 lớp; thấp hơn = nhanh hơn; | = ±15%)
kiem     ████████············ 0.80x ◄ ngoài dải
phap     █████████··········· 0.92x
the      ████████████████████ 3.05x ◄ ngoài dải
dan_phu  ████████████████████ 2.03x ◄ ngoài dải
thuong   ████████············ 0.84x ◄ ngoài dải
dao      ███████████········· 1.08x
```

### 3.4 Nhánh solo so với nhánh team (TTK dự phóng, team / solo)

| Lớp     | Luyện Khí quái thường | Luyện Khí tinh anh | Trúc Cơ quái thường | Trúc Cơ tinh anh | Kim Đan quái thường | Kim Đan tinh anh |
| ------- | --------------------- | ------------------ | ------------------- | ---------------- | ------------------- | ---------------- |
| kiem    | 1.42x                 | 1.43x              | 1.42x               | 1.42x            | 1.14x               | 1.25x            |
| phap    | 1.22x                 | 1.17x              | 1.17x               | 1.10x            | 1.37x               | 1.32x            |
| the     | 1.30x                 | 1.25x              | 1.00x               | 1.24x            | 1.27x               | 1.33x            |
| dan_phu | 1.53x                 | 1.49x              | 1.43x               | 1.47x            | 1.43x               | 1.48x            |
| thuong  | 1.62x                 | 1.33x              | 1.62x               | 1.40x            | 1.29x               | 1.34x            |
| dao     | 2.02x                 | 1.39x              | 1.68x               | 1.32x            | 1.68x               | 1.36x            |

(>1 = nhánh team chậm hơn khi đánh một mình, đúng thiết kế: nhánh team đổi sát thương cá nhân lấy giá trị cho đội.)

## 4. Sống sót khi đánh một mình

"Sống sót" = không chết trước khi hạ quái hoặc hết giờ. "HP thấp nhất" = trung vị mức HP thấp nhất đã chạm (0% = chết hoặc suýt chết). "Sát thương nhận" = % HP tối đa mất mỗi giây (trung vị). Người chơi không né telegraph nên số này cao hơn thực tế.

**Luyện Khí · quái thường**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 98%          | 2.34                    | -19% ◄      | 0.0      |
| phap    | 100%     | 90%          | 2.52                    | -13%        | 0.0      |
| the     | 100%     | 86%          | 2.51                    | -13%        | 0.0      |
| dan_phu | 100%     | 87%          | 3.33                    | +15%        | 0.0      |
| thuong  | 100%     | 100%         | 3.28                    | +13%        | 0.0      |
| dao     | 100%     | 85%          | 3.35                    | +15% ◄      | 0.0      |

**Luyện Khí · tinh anh**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 34%          | 4.00                    | -2%         | 2.0      |
| phap    | 100%     | 35%          | 3.44                    | -16% ◄      | 1.8      |
| the     | 0%       | 1%           | 4.14                    | +1%         | 3.0      |
| dan_phu | 100%     | 21%          | 5.38                    | +31% ◄      | 1.0      |
| thuong  | 100%     | 13%          | 4.05                    | -1%         | 2.5      |
| dao     | 0%       | 3%           | 5.62                    | +37% ◄      | 2.0      |

**Trúc Cơ · quái thường**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 98%          | 2.33                    | -3%         | 0.0      |
| phap    | 100%     | 85%          | 2.98                    | +24% ◄      | 0.0      |
| the     | 100%     | 90%          | 2.24                    | -7%         | 0.0      |
| dan_phu | 100%     | 95%          | 2.42                    | +0%         | 0.0      |
| thuong  | 100%     | 100%         | 3.22                    | +34% ◄      | 0.0      |
| dao     | 100%     | 91%          | 2.40                    | -0%         | 0.0      |

**Trúc Cơ · tinh anh**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 33%          | 3.60                    | -0%         | 1.0      |
| phap    | 0%       | 2%           | 4.80                    | +33% ◄      | 2.0      |
| the     | 100%     | 34%          | 3.08                    | -14%        | 3.0      |
| dan_phu | 100%     | 60%          | 3.61                    | +0%         | 0.0      |
| thuong  | 100%     | 22%          | 3.61                    | +0%         | 2.5      |
| dao     | 100%     | 4%           | 3.50                    | -3%         | 3.0      |

**Kim Đan · quái thường**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 100%         | 2.14                    | -16% ◄      | 0.0      |
| phap    | 100%     | 89%          | 2.78                    | +9%         | 0.0      |
| the     | 100%     | 75%          | 3.32                    | +31% ◄      | 0.0      |
| dan_phu | 100%     | 100%         | 2.30                    | -9%         | 0.0      |
| thuong  | 100%     | 100%         | 3.15                    | +24% ◄      | 0.0      |
| dao     | 100%     | 92%          | 2.21                    | -13%        | 0.0      |

**Kim Đan · tinh anh**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 100%     | 67%          | 2.45                    | -17% ◄      | 0.0      |
| phap    | 100%     | 29%          | 2.91                    | -1%         | 3.0      |
| the     | 0%       | 1%           | 3.89                    | +32% ◄      | 3.0      |
| dan_phu | 100%     | 62%          | 2.99                    | +1%         | 0.0      |
| thuong  | 100%     | 44%          | 2.45                    | -17% ◄      | 0.0      |
| dao     | 100%     | 23%          | 3.02                    | +2%         | 3.0      |

**Kim Đan · boss**

| Lớp     | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |
| ------- | -------- | ------------ | ----------------------- | ----------- | -------- |
| kiem    | 0%       | 7%           | 5.12                    | -16% ◄      | 3.0      |
| phap    | 0%       | 0%           | 6.18                    | +1%         | 2.0      |
| the     | 0%       | 9%           | 7.88                    | +29% ◄      | 2.0      |
| dan_phu | 0%       | 7%           | 6.02                    | -1%         | 2.0      |
| thuong  | 0%       | 3%           | 5.28                    | -13%        | 3.0      |
| dao     | 0%       | 0%           | 6.18                    | +1%         | 2.0      |

## 5. Đóng góp trong tổ đội

Một thành viên (lớp thử, nhánh solo hoặc team) cộng ba đồng đội tham chiếu cố định (the, dan_phu, dao, kiem, bỏ lớp đang thử) đánh `boss_ho_vuong` (boss Kim Đan, giới hạn 600 s). Đội 4 người cùng cảnh giới, không né đòn, **không đội nào hạ được boss trong giới hạn thời gian** (đội chết rồi hồi sinh liên tục): số đo đáng tin là phần đóng góp, không phải tỷ lệ thắng. "Phần" = (sát thương + hồi + khiên) của lớp thử / tổng của đội. Hồi và khiên được ghi cho người thi triển kỹ năng hồi / khiên trong cùng bước (chia đều nếu nhiều người).

| Lớp     | Nhánh | Hạ boss | Thời gian trận (s) | Chết cả đội / trận | HP boss còn | DPS | Hồi/s | Khiên/s | Phần đóng góp |
| ------- | ----- | ------- | ------------------ | ------------------ | ----------- | --- | ----- | ------- | ------------- |
| kiem    | solo  | 0%      | 600                | 4.0                | 75%         | 33  | 1     | 55      | 33%           |
| kiem    | team  | 0%      | 600                | 4.0                | 80%         | 20  | 0     | 47      | 27%           |
| phap    | solo  | 0%      | 600                | 4.0                | 81%         | 17  | 0     | 0       | 10%           |
| phap    | team  | 0%      | 600                | 4.0                | 82%         | 15  | 0     | 0       | 8%            |
| the     | solo  | 0%      | 600                | 4.0                | 74%         | 9   | 0     | 39      | 18%           |
| the     | team  | 0%      | 600                | 4.0                | 75%         | 7   | 0     | 43      | 19%           |
| dan_phu | solo  | 0%      | 600                | 4.0                | 77%         | 15  | 16    | 80      | 42%           |
| dan_phu | team  | 0%      | 600                | 4.0                | 72%         | 12  | 27    | 115     | 48%           |
| thuong  | solo  | 0%      | 600                | 4.0                | 77%         | 27  | 0     | 14      | 19%           |
| thuong  | team  | 0%      | 600                | 4.0                | 80%         | 19  | 0     | 14      | 16%           |
| dao     | solo  | 0%      | 600                | 4.0                | 73%         | 25  | 0     | 0       | 9%            |
| dao     | team  | 0%      | 600                | 4.0                | 76%         | 16  | 0     | 0       | 6%            |

**Khống chế (uptime)**: máy chủ không áp khống chế lên quái (mục 2) nên không đo được trên mã thật. Cột "Khống chế cứng thiết kế" ở mục 2 là tiềm năng theo dữ liệu (tổng thời lượng / hồi chiêu của các hiệu ứng stun, freeze, knock-up, root), không phải kết quả chạy.

## 6. Ma trận đấu tay đôi 6×6 (chỉ để tham khảo)

Máy chủ chưa có PvP, nên đây **không** chạy trên `WorldNode` mà là mô hình hai thân thể trên chính `makeProfile` + `resolveCast` + cùng người chơi kịch bản (`duel.ts`): cooldown, GCD, MP, thời gian cast, khiên và HP đúng như lõi chiến đấu; không di chuyển, không trạng thái, không đan, không hệ số PvP. Cảnh giới 2 tầng 3, 6 hạt giống mỗi cặp, nhánh solo. Ô = tỷ lệ thắng của **hàng** trước **cột** (hòa tính nửa).

| hàng \ cột | kiem | phap | the  | dan_phu | thuong | dao  | trung bình |
| ---------- | ---- | ---- | ---- | ------- | ------ | ---- | ---------- |
| kiem       | 100% | 0%   | 100% | 100%    | 100%   | 100% | 83%        |
| phap       | 100% | 67%  | 100% | 0%      | 100%   | 100% | 78%        |
| the        | 0%   | 0%   | 50%  | 0%      | 0%     | 0%   | 8%         |
| dan_phu    | 0%   | 100% | 100% | 50%     | 100%   | 100% | 75%        |
| thuong     | 0%   | 0%   | 100% | 0%      | 67%    | 100% | 44%        |
| dao        | 0%   | 0%   | 100% | 0%      | 0%     | 67%  | 28%        |

Thời gian trận (s, trung vị):

| hàng \ cột | kiem | phap | the | dan_phu | thuong | dao |
| ---------- | ---- | ---- | --- | ------- | ------ | --- |
| kiem       | 17   | 14   | 19  | 60      | 15     | 8   |
| phap       | 14   | 9    | 21  | 32      | 14     | 16  |
| the        | 19   | 21   | 180 | 33      | 22     | 13  |
| dan_phu    | 60   | 32   | 33  | 155     | 48     | 33  |
| thuong     | 15   | 14   | 22  | 48      | 21     | 12  |
| dao        | 8    | 16   | 13  | 33      | 12     | 20  |

## 7. Mô phỏng thiết kế (docs/11 §4.5) so với máy chủ

Mô phỏng thiết kế (`skill_sim.ts`) chạy **đủ** bộ kỹ năng; cột máy chủ là DPS trung vị ở Kim Đan, quái thường, nhánh solo. Cả hai chuẩn hoá theo trung vị của 6 lớp: chênh lệch lớn nghĩa là phần bộ kỹ năng chưa cài làm đổi thứ hạng lớp.

| Lớp     | Mô phỏng thiết kế (x đòn cơ bản) | so trung vị | DPS máy chủ | so trung vị | Chênh (máy chủ − thiết kế) |
| ------- | -------------------------------- | ----------- | ----------- | ----------- | -------------------------- |
| kiem    | 1.70                             | +2%         | 426         | -0%         | -3%                        |
| phap    | 1.68                             | +1%         | 429         | +0%         | -1%                        |
| the     | 1.59                             | -5%         | 121         | -72%        | -67%                       |
| dan_phu | 1.55                             | -7%         | 191         | -55%        | -49%                       |
| thuong  | 1.65                             | -1%         | 904         | +111%       | +112%                      |
| dao     | 1.70                             | +2%         | 505         | +18%        | +16%                       |

## 8. Ngoại lệ ngoài dải ±15%

| Ô                         | Lớp     | Vai trò         | Chỉ số          | Giá trị    | Trung vị   | Lệch  |
| ------------------------- | ------- | --------------- | --------------- | ---------- | ---------- | ----- |
| luyen_khi / normal / solo | phap    | dps_ranged      | TTK dự phóng    | 3.9 s      | 4.8 s      | -18%  |
| luyen_khi / normal / solo | the     | tank_melee      | TTK dự phóng    | 10.5 s     | 4.8 s      | +120% |
| luyen_khi / normal / solo | dan_phu | support_ranged  | TTK dự phóng    | 11.5 s     | 4.8 s      | +141% |
| luyen_khi / normal / solo | thuong  | vanguard_mid    | TTK dự phóng    | 2.6 s      | 4.8 s      | -45%  |
| luyen_khi / elite / solo  | phap    | dps_ranged      | TTK dự phóng    | 25.8 s     | 40.2 s     | -36%  |
| luyen_khi / elite / solo  | the     | tank_melee      | TTK dự phóng    | 66.2 s     | 40.2 s     | +65%  |
| luyen_khi / elite / solo  | dan_phu | support_ranged  | TTK dự phóng    | 82.7 s     | 40.2 s     | +106% |
| truc_co / normal / solo   | the     | tank_melee      | TTK dự phóng    | 9.8 s      | 5.0 s      | +96%  |
| truc_co / normal / solo   | dan_phu | support_ranged  | TTK dự phóng    | 9.4 s      | 5.0 s      | +88%  |
| truc_co / normal / solo   | thuong  | vanguard_mid    | TTK dự phóng    | 2.6 s      | 5.0 s      | -47%  |
| truc_co / normal / solo   | dao     | berserker_melee | TTK dự phóng    | 3.6 s      | 5.0 s      | -28%  |
| truc_co / elite / solo    | the     | tank_melee      | TTK dự phóng    | 51.7 s     | 41.9 s     | +23%  |
| truc_co / elite / solo    | dan_phu | support_ranged  | TTK dự phóng    | 69.8 s     | 41.9 s     | +67%  |
| kim_dan / normal / solo   | the     | tank_melee      | TTK dự phóng    | 14.2 s     | 4.1 s      | +243% |
| kim_dan / normal / solo   | dan_phu | support_ranged  | TTK dự phóng    | 9.4 s      | 4.1 s      | +129% |
| kim_dan / normal / solo   | thuong  | vanguard_mid    | TTK dự phóng    | 2.0 s      | 4.1 s      | -50%  |
| kim_dan / elite / solo    | kiem    | dps_mid         | TTK dự phóng    | 29.2 s     | 40.6 s     | -28%  |
| kim_dan / elite / solo    | the     | tank_melee      | TTK dự phóng    | 77.0 s     | 40.6 s     | +90%  |
| kim_dan / elite / solo    | dan_phu | support_ranged  | TTK dự phóng    | 70.4 s     | 40.6 s     | +73%  |
| kim_dan / elite / solo    | thuong  | vanguard_mid    | TTK dự phóng    | 28.3 s     | 40.6 s     | -30%  |
| kim_dan / boss / solo     | kiem    | dps_mid         | TTK dự phóng    | 677.3 s    | 850.7 s    | -20%  |
| kim_dan / boss / solo     | the     | tank_melee      | TTK dự phóng    | 2598.3 s   | 850.7 s    | +205% |
| kim_dan / boss / solo     | dan_phu | support_ranged  | TTK dự phóng    | 1731.1 s   | 850.7 s    | +103% |
| kim_dan / boss / solo     | thuong  | vanguard_mid    | TTK dự phóng    | 710.9 s    | 850.7 s    | -16%  |
| luyen_khi / normal / solo | kiem    | dps_mid         | sát thương nhận | 2.34 %HP/s | 2.90 %HP/s | -19%  |
| luyen_khi / normal / solo | dao     | berserker_melee | sát thương nhận | 3.35 %HP/s | 2.90 %HP/s | +15%  |
| luyen_khi / elite / solo  | phap    | dps_ranged      | sát thương nhận | 3.44 %HP/s | 4.10 %HP/s | -16%  |
| luyen_khi / elite / solo  | dan_phu | support_ranged  | sát thương nhận | 5.38 %HP/s | 4.10 %HP/s | +31%  |
| luyen_khi / elite / solo  | dao     | berserker_melee | sát thương nhận | 5.62 %HP/s | 4.10 %HP/s | +37%  |
| truc_co / normal / solo   | phap    | dps_ranged      | sát thương nhận | 2.98 %HP/s | 2.41 %HP/s | +24%  |
| truc_co / normal / solo   | thuong  | vanguard_mid    | sát thương nhận | 3.22 %HP/s | 2.41 %HP/s | +34%  |
| truc_co / elite / solo    | phap    | dps_ranged      | sát thương nhận | 4.80 %HP/s | 3.60 %HP/s | +33%  |
| kim_dan / normal / solo   | kiem    | dps_mid         | sát thương nhận | 2.14 %HP/s | 2.54 %HP/s | -16%  |
| kim_dan / normal / solo   | the     | tank_melee      | sát thương nhận | 3.32 %HP/s | 2.54 %HP/s | +31%  |
| kim_dan / normal / solo   | thuong  | vanguard_mid    | sát thương nhận | 3.15 %HP/s | 2.54 %HP/s | +24%  |
| kim_dan / elite / solo    | kiem    | dps_mid         | sát thương nhận | 2.45 %HP/s | 2.95 %HP/s | -17%  |
| kim_dan / elite / solo    | the     | tank_melee      | sát thương nhận | 3.89 %HP/s | 2.95 %HP/s | +32%  |
| kim_dan / elite / solo    | thuong  | vanguard_mid    | sát thương nhận | 2.45 %HP/s | 2.95 %HP/s | -17%  |
| kim_dan / boss / solo     | kiem    | dps_mid         | sát thương nhận | 5.12 %HP/s | 6.10 %HP/s | -16%  |
| kim_dan / boss / solo     | the     | tank_melee      | sát thương nhận | 7.88 %HP/s | 6.10 %HP/s | +29%  |

### 8.1 Độ lệch theo lớp (trung bình nhân của TTK dự phóng / trung vị, quái thường và tinh anh, nhánh solo)

```
kiem     █████████··········· 0.92x  (trong dải)
phap     █████████··········· 0.88x  (trong dải)
the      ████████████████████ 1.96x  (chậm hơn dải)
dan_phu  ████████████████████ 1.99x  (chậm hơn dải)
thuong   ███████············· 0.66x  (nhanh hơn dải)
dao      █████████··········· 0.94x  (trong dải)
```

## 9. Đề xuất chỉnh (chưa áp dụng)

Sinh theo quy tắc từ các số trên; **cần chủ dự án / game designer duyệt** trước khi đổi bất kỳ số nào (skill `vgtd-formula-change`: DECISIONS trước, rồi `skills.json`, test, tài liệu). Hệ số gợi ý = nhân sát thương với độ lệch để đưa TTK của lớp về trung vị (TTK tỷ lệ nghịch với sát thương); đây là bước đầu thô, chưa tính tương tác với sống sót và đội.

| #   | Lớp     | Quan sát                                                                                    | Đề xuất                                                                                                                                                       |
| --- | ------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | the     | chậm hơn trung vị 96% về TTK (vai trò tank_melee: một phần là chủ ý)                        | giữ nếu đóng góp đội (mục 5) bù lại; nếu không, tăng sát thương ≈ +96%                                                                                        |
| 2   | dan_phu | chậm hơn trung vị 99% về TTK (vai trò support_ranged: một phần là chủ ý)                    | giữ nếu đóng góp đội (mục 5) bù lại; nếu không, tăng sát thương ≈ +99%                                                                                        |
| 3   | thuong  | nhanh hơn trung vị 34% về TTK                                                               | giảm sát thương ≈ -34%, hoặc tăng chi phí MP / hồi chiêu                                                                                                      |
| 4   | cả 6    | bộ kỹ năng chỉ cài một phần (kiem 4/7, phap 5/8, the 3/7, dan_phu 3/7, thuong 2/7, dao 2/7) | cài hiệu ứng còn thiếu trên máy chủ (dot, trạng thái khống chế, buff, đánh dấu, triệu hồi) **trước** khi chỉnh số: mọi so sánh trên bị lệch bởi phần chưa cài |
| 5   | cả 6    | `stat_weights` của lớp bị bỏ qua                                                            | quyết định: áp `stat_weights` vào `makeProfile` (docs/11 mong muốn) hay bỏ khỏi dữ liệu; rồi chạy lại báo cáo này                                             |
| 6   | cả 6    | nhánh solo / team không có trên máy chủ                                                     | cài nhánh (chỉ số `dmg_taken_mult`, `threat_mult`, `team_dmg` ... chưa có chỗ áp) để mục 3.4 và 5 phản ánh đúng thiết kế                                      |
| 7   | boss    | không đội 4 người không né nào hạ được `boss_ho_vuong`                                      | kiểm tra lại HP × 45 / ATK × 1,5 của boss (docs/10 §4.1) cùng telegraph; hoặc đo lại khi harness biết né                                                      |

## 10. Chạy lại

```bash
npm run balance -w @vgtd/server                       # bản đầy đủ, ghi docs/35-bao-cao-can-bang-dao-lo.md
npm run balance -w @vgtd/server -- --quick --out -    # bản nhanh, in ra màn hình
```

Cấu hình: hạt giống quái thường / tinh anh / boss = 6 / 4 / 3, 6 hạt giống mỗi cặp đấu tay đôi, dải ngoại lệ ±15%. Mã: `apps/server/src/balance/`; thử nghiệm: `apps/server/tests/balance.test.ts`.
