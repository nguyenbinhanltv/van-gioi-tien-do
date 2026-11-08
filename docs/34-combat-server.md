# 34. Combat phía server (lõi giải quyết cast, D75)

Lõi chiến đấu server-authoritative (P3): `apps/server/src/world/combat/` quanh `step()` của `@vgtd/sim`, cộng nửa client (`@vgtd/client-combat`) dùng cùng HUD với vòng giả lập offline. Quy tắc chốt ở D75 trong `docs/DECISIONS.md`.

## Phân vai

| Bước mỗi tick                     | Ai làm               | Việc                                                                                                                               |
| --------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `combat.preStep(inputs)`          | `CombatSystem`       | Người chơi đã chết không đi, không cast (trả `Controlled`); chỉ được cast 8 kỹ năng của lớp mình (`UnknownSkill` nếu khác)         |
| `step(world, inputs, ctx)`        | `@vgtd/sim` (có sẵn) | Chấp nhận cast: cooldown, GCD, MP, bị khống chế, tầm, LOS (docs/08 §6); `cast_ok` mang `roll` rút từ luồng PRNG `combat` của world |
| `combat.postStep(world, events)`  | `CombatSystem`       | Cast time, chọn mục tiêu theo hình dạng, sát thương, HP, chết / hồi sinh, mob chết (`MobPort.kill`), rớt đồ (`resolveDrops`)       |
| `skill_result` gửi cho người cast | `WorldNode`          | `hits[]` = chỉ số trong danh sách nhìn thấy của client, sát thương, cờ (bit0 chí mạng, bit1 hạ gục)                                |

Cast bị sim từ chối trả lời ngay (`reason` = `CastReason`, không hits). Cast được chấp nhận trả lời **khi nó được giải quyết**, tức sau `cast_ms + channel_ms` của kỹ năng (kỹ năng tức thời: cùng tick), nên client chỉ cần một `skill_result` cho mỗi `seq`. Người cast chết trong lúc cast: cast bị hủy, trả `Controlled`. Kỹ năng channel (`channel_ms`): mọi hit (`hits`) rơi cùng lúc khi kết thúc channel, chưa tách theo `channel_ticks`.

**Tầm với của mục tiêu do client chọn được kiểm lại khi giải quyết** (không chỉ khi chấp nhận): sim chỉ kiểm tầm / LOS cho kỹ năng `enemy` / `ally_or_self` lúc chấp nhận và không kiểm cho `direction` / `ground`, còn mục tiêu có thể chạy đi trong lúc cast. Mục tiêu (hoặc neo mặt đất) xa hơn `targeting.range_tiles` hoặc bị che LOS (khi kỹ năng cần) bị bỏ qua: kỹ năng đơn mục tiêu không trúng ai, kỹ năng vùng neo vào người cast. Hai cast cùng `(entity, seq)` trong một tick: chỉ cast đầu được xử lý.

## Công thức và dữ liệu

- Sát thương: `damageBreakdown` của `@vgtd/shared` (docs/07 §4): `Raw = stat × c_skill`, `DEF_eff` có Ngũ hành và Pen, `Raw² / (Raw + DEF_eff) × M_elem × Crit × Suppress × U(0,95; 1,05)`, làm tròn, ≥ 1. Test vàng lặp lại ví dụ docs/07 (ATK 563, DEF 350): trung tính **347**, Hỏa khắc Kim **460**, Hỏa bị Thủy khắc **295**.
- Hệ của kỹ năng: `root_main` = hệ chính của lớp, `none` = không tính Ngũ hành. Hệ của mob từ `MobPort` (có thể null).
- Chí mạng: 5 % gốc (docs/31 B-10) + `crit_chance` của bị động lớp (Kiếm Tâm +5 %), trần 60 %; nhân `CRIT_DEFAULT` (1,5). Pen bị động cộng vào `pen` của kỹ năng, trần `PEN_MAX`.
- Chỉ số người chơi: `roundedStatsAt(realm, substage)` (07 §1, số nguyên: HP không bao giờ vượt HP tối đa), mặc định Luyện Khí 1 cho tới khi tiến trình (#205, D76) cấp cảnh giới: `onStageChange` (nạp hồ sơ xong, sau mỗi lần đột phá) gọi `CombatSystem.setRealm`, tính lại hồ sơ, HP / MP tối đa (giữ tỉ lệ HP / MP), và `vitals` gửi lại cho client. HP / MP khởi tạo thực thể lấy từ đây khi bật combat.
- Hình dạng: `single`, `circle`, `ring` quanh neo (người cast / mục tiêu / điểm đất), `cone` và `line` theo hướng nhìn của người cast; tối đa `global.max_targets_per_cast` mục tiêu, gần neo nhất trước.
- Hồi sinh người chơi: 10 s ở điểm hồi sinh (docs/01 §12.2), đầy HP / MP, xóa cooldown. Khiên (`shield`) hấp thụ sát thương trước khi trừ HP.
- Rớt đồ: `resolveDrops` với nguồn `field` / `elite` / `boss` của mob, luồng PRNG `drop` riêng (fork từ seed). Chưa có kho đồ nên kết quả đi qua `onDrops` và sự kiện `drops`.

## Xác định (determinism)

Không đồng hồ, không `Math.random`; toán hình học chỉ + − × ÷ và bảng hướng của sim (không `sin` / `cos` / `pow`). Số ngẫu nhiên của một cast sinh từ PRNG gieo bằng `cast_ok.roll` (chỉ phụ thuộc seed world và thứ tự cast được chấp nhận); thứ tự rút: mỗi effect `damage` (theo thứ tự dữ liệu) → mỗi nạn nhân (gần neo nhất, hòa theo id) → mỗi hit: chí mạng rồi jitter. Test: cùng seed + cùng input → cùng `stateHash`, trạng thái combat, kết quả, sự kiện và drops; seed khác → khác; một test quét mã nguồn module để cấm đồng hồ / ngẫu nhiên ngoài.

## Điểm nối

- **Mob (#204)**: `MobPort { combatStats(id), kill(world, id) }`; `MobManager` thỏa mãn nguyên trạng và là `MobPort` mặc định của `WorldNode` khi có cả `mobs` và `combat` (`combat.mobs` ghi đè). Mob là thực thể sim bình thường nên cast / tầm / LOS của sim áp dụng như với người chơi; `combatStats` cho DEF, cảnh giới, hệ, `dropSource`, HP tối đa, `kill` hủy mob và đặt giờ hồi sinh.
- **Bật trong node**: `new WorldNode({ mobs: true, combat: { onDrops } })` (mob của `MobManager` tự thành mục tiêu); thiếu `combat` thì node hành xử như cũ (cast hợp lệ → `skill_result` không hits).
- **Client online** (`?online=1&combat=1`): `ServerCombat` (client-combat) cài `CombatBackend` giống `MockCombat`; HUD (`Combat.ts`) nhận backend. `OnlineSession.attachCombat` nối hook `NetClient` (#209): `onSkillResult` → `applySkillResult`, `onAoiEnter` / `onAoiLeave` → tên và HP tối đa quái, mỗi frame quái trong tầm nhìn → `upsertEnemy` / `syncEnemy` (vị trí nội suy + `hpPct`), `onSnapshot` → `setServerTime(tick × 50)` và `self.vitals` → `setSelfVitals`. Cast đi qua `NetClient.sendSkillCast`. Server quyết định lớp (chưa có chọn lớp trên dây: mọi người chơi là `kiem`), nên HUD online luôn hiện bộ kỹ năng `kiem`.
- **Dễ đọc trong combat online (client)**: thanh HP trên đầu (`OverheadBar.ts`, quy tắc thuần trong `client-combat/src/fx.ts`: quái hiện khi đang được chọn hoặc vừa bị đánh ~4 s rồi mờ dần, người chơi khác theo `hpPct`, thanh của mình hiện khi mất máu, không hiện khi chết). Số nổi: sát thương lên quái từ `skill_result`; sát thương nhận / hồi máu của mình lấy từ chênh lệch `self.vitals` (`VitalsWatcher`). Chết: `vitals.hp == 0` → sự kiện `death` → lớp phủ tối + đếm ngược hồi sinh (`COMBAT_RULES.RESPAWN_PVE_MS`, đếm trên đồng hồ client từ lúc nhận vitals, chỉ để hiển thị: server hồi sinh tại `spawnPoint()` và `alive` quay lại mới tắt lớp phủ); hotbar bị khóa (`dead`). Chết / hồi sinh không thêm trường nào lên dây.
- **Ngắt kết nối giữa lúc cast** (OPEN-ITEMS 10): `removePlayer` hủy cast đang chờ (`CombatSystem.removePlayer`), không sát thương và không `skill_result`; nếu thực thể đang được giữ để resume (`suspendPlayer`) thì cast vẫn giải quyết phía server và sát thương vẫn tính, không gửi gì tới socket đã chết, đăng ký combat giữ đến hết thời gian giữ. Có test trong `apps/server/tests/combat.test.ts`.
- **Quái tấn công (D86)**: sau `MobManager.step`, `WorldNode.tick` chạy `MobAttackSystem.step(world)`. Quái `chase` có mục tiêu hợp lệ trong tầm + LOS bắt đầu telegraph (khóa hướng / điểm neo); hết `telegraphMs`, người chơi còn trong hình (`inShape`) nhận `damageBreakdown(ATK quái × hệ số, DEF người chơi, ...)` qua `CombatSystem.damagePlayer`. Bảng đòn: `mobAttacksOf(def)` (`@vgtd/shared`). Client thấy sát thương qua `self.vitals` (số nổi, thanh máu, màn hình chết của #225). Xác định: PRNG fork `mobatk`, `digest()` cho test replay. [Cập nhật D89: telegraph đi trên dây từ giao thức v5, `telegraph_start` / `telegraph_end` tới client có AOI chứa điểm neo; client vẽ decal.]

## Giới hạn đã biết (OPEN-ITEMS)

- Effect khác `damage` / `heal` / `shield` (dot, status, dash, buff, summon ...) chưa mô phỏng; module báo `unsupported_effect`.
- **Điểm ngắm và vitals (D78, giao thức v3)**: `skill_cast` mang điểm ngắm tùy chọn (1/32 ô): kỹ năng `ground` neo vào điểm ngắm (rồi mục tiêu, rồi người cast), cone / line quay theo điểm ngắm; điểm ngắm bị kiểm tầm và LOS lúc giải quyết như mục tiêu. Khối `self` của snapshot mang `vitals` (HP, HP tối đa, MP, MP tối đa, khiên) khi đổi. Client lấy điểm ngắm từ vị trí con trỏ (cảm ứng chưa có điểm ngắm: server dùng mục tiêu hoặc hướng nhìn) và ghim vào tầm kỹ năng.
- `CombatSystem.setRealm(world, id, realm, substage)`: móc cho tiến trình (#205 `onStageChange`): tính lại hồ sơ, HP / MP tối đa, giữ tỉ lệ HP / MP.
- Quái tấn công người chơi từ D86 (`MobAttackSystem`, xem bên dưới); `damagePlayer` còn dùng được cho PvP. Chưa có cấp mở khóa kỹ năng, kho đồ, độ bền.
