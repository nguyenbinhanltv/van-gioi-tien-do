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
- Chỉ số người chơi: `statsAt(realm, substage)` (07 §1), mặc định Luyện Khí 1 cho tới khi tiến trình (#205) cấp cảnh giới. HP / MP khởi tạo thực thể lấy từ đây khi bật combat.
- Hình dạng: `single`, `circle`, `ring` quanh neo (người cast / mục tiêu / điểm đất), `cone` và `line` theo hướng nhìn của người cast; tối đa `global.max_targets_per_cast` mục tiêu, gần neo nhất trước.
- Hồi sinh người chơi: 10 s ở điểm hồi sinh (docs/01 §12.2), đầy HP / MP, xóa cooldown. Khiên (`shield`) hấp thụ sát thương trước khi trừ HP.
- Rớt đồ: `resolveDrops` với nguồn `field` / `elite` / `boss` của mob, luồng PRNG `drop` riêng (fork từ seed). Chưa có kho đồ nên kết quả đi qua `onDrops` và sự kiện `drops`.

## Xác định (determinism)

Không đồng hồ, không `Math.random`; toán hình học chỉ + − × ÷ và bảng hướng của sim (không `sin` / `cos` / `pow`). Số ngẫu nhiên của một cast sinh từ PRNG gieo bằng `cast_ok.roll` (chỉ phụ thuộc seed world và thứ tự cast được chấp nhận); thứ tự rút: mỗi effect `damage` (theo thứ tự dữ liệu) → mỗi nạn nhân (gần neo nhất, hòa theo id) → mỗi hit: chí mạng rồi jitter. Test: cùng seed + cùng input → cùng `stateHash`, trạng thái combat, kết quả, sự kiện và drops; seed khác → khác; một test quét mã nguồn module để cấm đồng hồ / ngẫu nhiên ngoài.

## Điểm nối

- **Mob (#204)**: `MobPort { combatStats(id), kill(world, id) }`; `MobManager` thỏa mãn nguyên trạng và là `MobPort` mặc định của `WorldNode` khi có cả `mobs` và `combat` (`combat.mobs` ghi đè). Mob là thực thể sim bình thường nên cast / tầm / LOS của sim áp dụng như với người chơi; `combatStats` cho DEF, cảnh giới, hệ, `dropSource`, HP tối đa, `kill` hủy mob và đặt giờ hồi sinh.
- **Bật trong node**: `new WorldNode({ mobs: true, combat: { onDrops } })` (mob của `MobManager` tự thành mục tiêu); thiếu `combat` thì node hành xử như cũ (cast hợp lệ → `skill_result` không hits).
- **Client online**: `ServerCombat` (client-combat) cài `CombatBackend` giống `MockCombat`; HUD (`Combat.ts`) nhận backend. Nối vào chế độ `?online=1` chờ client mạng (#199) merge: `ServerCombat.applySkillResult` nhận `skill_result`, `upsertEnemy` / `removeEnemy` nhận AOI + `hpPct`, `setServerTime` nhận tick snapshot.

## Giới hạn đã biết (OPEN-ITEMS)

- Effect khác `damage` / `heal` / `shield` (dot, status, dash, buff, summon ...) chưa mô phỏng; module báo `unsupported_effect`.
- Giao thức chưa có điểm ngắm (`skill_cast` chỉ có `targetId`): kỹ năng `ground` dùng mục tiêu nếu có, không thì người cast; `direction` dùng hướng nhìn.
- Giao thức chưa gửi HP / MP của chính người chơi (`SelfState` không có): HUD online chưa có nguồn thật.
- Mob chưa tấn công người chơi (`damagePlayer` sẵn sàng cho bước đó và cho PvP); chưa có cấp mở khóa kỹ năng, kho đồ, độ bền.
