# Bộ prompt sinh asset Thể tu (Sơn Môn Hộ Vệ, concept A) cho ChatGPT

Phiên bản 1, 2026-11-06. Theo cấu trúc "tay chân liền mảnh + chi tiết nhỏ tách riêng" (Track 2).
Nguồn tham chiếu: concept `the-tu-a.png` (artifact của worker 16), palette và art bible `docs/18`.

---

## 0. Cách dùng

1. Mở **một cuộc chat mới** cho Thể tu và giữ nguyên chat đó cho toàn bộ bộ asset. Ảnh cùng chat thường đồng nhất hơn.
2. Tin nhắn đầu tiên: **đính kèm `the-tu-a.png`** và dán **Khối phong cách (mục 1)**. Bảo ChatGPT ghi nhớ khối này cho mọi ảnh sau.
3. Mỗi tin nhắn chỉ sinh **1 ảnh**. Luôn đính kèm lại ảnh master của hướng đang làm (mục 2) khi sinh mảnh của hướng đó.
4. Yêu cầu **PNG nền trong suốt**. Nếu ChatGPT trả nền trắng, nhắn: "Make the background fully transparent, keep the subject unchanged."
5. Tải về, đặt tên theo cột **File** (ví dụ `E/arm_R.png`). Gửi lại cho tôi cả thư mục; pipeline sẽ tự làm sạch viền, khớp màu, đặt khớp và dựng mesh.
6. `{DIR}` = một trong **S, SE, E, NE, N** (SW/W/NW lật gương, không cần vẽ). Nên làm trọn **E** trước để thử.

Mô tả hướng dùng trong prompt:

| DIR | Mô tả cho prompt                                                          |
| --- | ------------------------------------------------------------------------- |
| S   | facing the viewer (front view), slight top-down isometric camera          |
| SE  | three-quarter view facing down-right, slight top-down isometric camera    |
| E   | side profile facing right, slight top-down isometric camera               |
| NE  | three-quarter back view facing up-right, slight top-down isometric camera |
| N   | back view facing away from the viewer, slight top-down isometric camera   |

---

## 1. Khối phong cách (dán ở tin nhắn đầu, nhắc lại bằng "Use the style block")

```text
STYLE BLOCK for all images in this chat (original game "Van Gioi Tien Do", 2D isometric cultivation MMORPG):
- Character: THE TU (body cultivator, earth element tank) of the Van Mon sect, stocky adult male, compact 5.75-head proportions, broad square grounded silhouette, calm strong face, short dark hair tied in a top bun with a jade hairpin.
- Outfit: ivory fitted inner robe with cross collar and long sleeves; mountain-blue short split tabard (sleeveless) with thin pale bronze cloud trim and cloud embroidery; wide dark-blue sash tied at the front with two hanging tails; loose ivory trousers gathered into dark grey-blue boots; paired rectangular bronze EARTH GAUNTLETS made of stone-block plates with a meander (hồi văn) emblem.
- Palette (use exactly): ivory #E9EEF0, mountain blue #5E8798, dark blue #294451, bronze #B58A4A, pale ochre highlight #E3C07F, bronze shade #5B4222, skin warm light, hair near-black brown.
- Rendering: hand-painted 2D game sprite, clean readable dark contour, soft cel shading with 2-3 tones per material, light ALWAYS from the upper-left (north-west), no rim glow, no painterly texture noise, no text, no watermark.
- Output rules: ONE subject per image, fully visible (nothing cropped), centered, at least 8% empty margin on every side, TRANSPARENT background, NO cast shadow, NO ground, NO effects unless asked, square 1024x1024 PNG.
- Consistency: same identity, outfit, colours and line weight as the attached concept sheet in every image.
```

---

## 2. Ảnh master theo hướng (làm trước, mỗi hướng 1 ảnh)

| File               | Prompt   |
| ------------------ | -------- |
| `{DIR}/master.png` | Xem dưới |

```text
Use the style block. Create the MASTER RIG REFERENCE of the full character, {DIR description}.
Neutral rig pose: standing straight, feet shoulder-width apart, arms slightly away from the body (about 20 degrees, relaxed A-pose) so the arms do not overlap the torso, elbows almost straight, both gauntlets worn, fists relaxed, sash tails hanging straight, mouth closed, eyes open.
Full body from hair bun to boots, figure height = 80% of the canvas, boots touching an invisible ground line at 90% height, centered horizontally.
This image is the reference for cutting body parts, so keep edges clean and every part clearly separated.
```

---

## 3. Mảnh cơ thể chính (tay chân LIỀN MẢNH)

Quy tắc chung cho mọi mảnh, thêm vào cuối prompt mỗi mảnh:

```text
Draw ONLY this part, isolated, in the SAME scale, angle and lighting as the attached master for {DIR}. Paint the part COMPLETELY, including areas that are normally hidden under other parts (they will be layered later). Straight neutral pose. Transparent background, no shadow, nothing else in the image.
```

| File               | Mô tả mảnh (điền vào: "Use the style block. Part: ...")                                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{DIR}/torso.png`  | Torso only: ivory inner robe from neck to hips with cross collar, chest and back volume, NO arms, NO tabard, NO sash; extend the shoulder area outward as a rounded shoulder cap that would sit under the sleeves; extend the bottom 15% below the waist so it hides under the trousers. |
| `{DIR}/neck.png`   | Neck only, warm skin, short cylinder with a slightly extended base that tucks under the collar.                                                                                                                                                                                          |
| `{DIR}/arm_L.png`  | ENTIRE LEFT ARM as ONE continuous piece: rounded shoulder ball, upper arm and forearm in the ivory sleeve, sleeve fully painted, ending at the wrist (no hand, no gauntlet); arm drawn STRAIGHT along one axis; include extra sleeve fabric at the top so it overlaps the torso.         |
| `{DIR}/arm_R.png`  | Same as arm_L for the RIGHT arm.                                                                                                                                                                                                                                                         |
| `{DIR}/leg_L.png`  | ENTIRE LEFT LEG as ONE continuous piece: hip joint, thigh and shin in the loose ivory trouser, knee area fully painted, ending at the ankle where the boot starts; drawn STRAIGHT; include extra trouser fabric at the top that would hide under the tabard.                             |
| `{DIR}/leg_R.png`  | Same as leg_L for the RIGHT leg.                                                                                                                                                                                                                                                         |
| `{DIR}/boot_L.png` | LEFT boot only, dark grey-blue, with the ivory trouser cuff painted inside the boot opening so the ankle never shows a gap.                                                                                                                                                              |
| `{DIR}/boot_R.png` | RIGHT boot only, same rules.                                                                                                                                                                                                                                                             |
| `{DIR}/head.png`   | Head base only: face skin, ears, jaw, hairline of the short hair, NO eyes, NO eyebrows, NO mouth (blank face areas painted with skin), NO bun.                                                                                                                                           |

---

## 4. Trang phục (lớp phủ, có chuyển động phụ)

| File                          | Mô tả mảnh                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{DIR}/tabard_front.png`      | Front panel of the mountain-blue split tabard only, from shoulders to mid-thigh, bronze cloud trim, cloud embroidery; painted as a flat cloth panel that can bend. |
| `{DIR}/tabard_back.png`       | Back panel of the tabard only (visible behind the legs), same style.                                                                                               |
| `{DIR}/tabard_shoulder_L.png` | Left shoulder edge of the tabard (the folded trimmed edge over the shoulder) as a separate small piece.                                                            |
| `{DIR}/tabard_shoulder_R.png` | Right shoulder edge, same.                                                                                                                                         |
| `{DIR}/sash_band.png`         | Wide dark-blue sash band wrapped around the waist only, no knot, no tails.                                                                                         |
| `{DIR}/sash_knot.png`         | Sash knot only (the tied bow at the front).                                                                                                                        |
| `{DIR}/sash_tail_1.png`       | First hanging sash tail only, drawn hanging straight down, slightly tapered end.                                                                                   |
| `{DIR}/sash_tail_2.png`       | Second sash tail, slightly shorter than the first.                                                                                                                 |
| `{DIR}/sleeve_cuff_L.png`     | Left sleeve cuff/edge band only (the end of the ivory sleeve at the wrist).                                                                                        |
| `{DIR}/sleeve_cuff_R.png`     | Right sleeve cuff, same.                                                                                                                                           |
| `{DIR}/trouser_hem_L.png`     | Loose gathered trouser fabric bunching above the left boot, separate small piece.                                                                                  |
| `{DIR}/trouser_hem_R.png`     | Same for the right leg.                                                                                                                                            |

---

## 5. Tóc và đầu (chi tiết nhỏ nhất)

| File                                            | Mô tả mảnh                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `{DIR}/hair_back.png`                           | Back mass of the short tied hair (behind the head), no bun.                                                   |
| `{DIR}/hair_bun.png`                            | Top hair bun only, with the hair tie band.                                                                    |
| `{DIR}/hairpin.png`                             | Jade hairpin only (pale jade green with bronze end caps), straight.                                           |
| `{DIR}/hair_strand_1.png` … `hair_strand_3.png` | One loose front/side hair strand each (3 images: left fringe, right fringe, side lock), thin tapered strands. |
| `{DIR}/ear_L.png`, `{DIR}/ear_R.png`            | Only if visible in this direction: single ear.                                                                |

### Mặt (mảnh đổi hình, chỉ cần cho S, SE, E, NE; N không thấy mặt)

| File                      | Mô tả                                                           |
| ------------------------- | --------------------------------------------------------------- |
| `{DIR}/eyes_open.png`     | Eyes only (both eyes as one piece), open, calm determined look. |
| `{DIR}/eyes_half.png`     | Same eyes half-closed (blink in-between).                       |
| `{DIR}/eyes_closed.png`   | Same eyes fully closed (blink / meditation).                    |
| `{DIR}/eyes_angry.png`    | Eyes narrowed, fierce (attack).                                 |
| `{DIR}/brows_neutral.png` | Eyebrows only, neutral.                                         |
| `{DIR}/brows_angry.png`   | Eyebrows only, angled down, angry.                              |
| `{DIR}/brows_pain.png`    | Eyebrows only, raised in pain (hit).                            |
| `{DIR}/mouth_neutral.png` | Mouth only, closed calm line.                                   |
| `{DIR}/mouth_shout.png`   | Mouth only, open shouting (kiai).                               |
| `{DIR}/mouth_grit.png`    | Mouth only, gritted teeth (strain / block).                     |
| `{DIR}/mouth_pain.png`    | Mouth only, open in pain (hit / death).                         |

---

## 6. Găng tay đất (vũ khí của Thể tu) và bàn tay đổi hình

Mỗi bên tay có **găng + bàn tay** là một mảnh đổi hình theo động tác. Thêm vào prompt: "The gauntlet covers the hand and forearm tip; include the wrist opening painted so it overlaps the sleeve cuff."

| File                              | Mô tả                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `{DIR}/gauntlet_R_fist.png`       | Right bronze stone-block gauntlet with a CLOSED FIST, punch-ready.                                            |
| `{DIR}/gauntlet_R_open.png`       | Right gauntlet with an OPEN PALM facing forward (palm strike / push).                                         |
| `{DIR}/gauntlet_R_relaxed.png`    | Right gauntlet with a relaxed half-closed hand (idle / walk).                                                 |
| `{DIR}/gauntlet_R_guard.png`      | Right gauntlet raised edge-on as a guard (block, Thiết Bố Sam).                                               |
| `{DIR}/gauntlet_R_ground.png`     | Right gauntlet fist pointing down, knuckles first (ground slam, Địa Chấn).                                    |
| `{DIR}/gauntlet_L_*.png`          | Same 5 poses for the LEFT gauntlet.                                                                           |
| `{DIR}/gauntlet_plate_glow_R.png` | Optional: only the meander emblem plate of the right gauntlet glowing pale ochre (#E3C07F), for skill charge. |

---

## 7. Hiệu ứng kỹ năng (VFX, vẽ một lần, dùng cho mọi hướng)

Thêm vào prompt: "Game VFX sprite, transparent background, bold readable shapes, earth element palette (bronze #B58A4A, ochre #E3C07F, shade #5B4222, dust grey), light from north-west."

| File                               | Kỹ năng (docs/11)                    | Mô tả                                                                                                                          |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `vfx/rock_chunk_1..4.png`          | chung                                | 4 separate small flying rock fragments, different shapes.                                                                      |
| `vfx/dust_puff_1..3.png`           | chung                                | 3 dust puff shapes (small, medium, large) for footsteps and impacts.                                                           |
| `vfx/ground_crack_decal.png`       | Địa Chấn (T3)                        | Top-down isometric ground crack decal radiating from a center, fits a 2:1 diamond.                                             |
| `vfx/shockwave_ring.png`           | Địa Chấn (T3)                        | Flat isometric shockwave ring of dust and pebbles, 2:1 ellipse.                                                                |
| `vfx/stone_skin_overlay.png`       | Thiết Bố Sam (T2)                    | Semi-transparent stone-plate armor pattern overlay that can be laid over the body silhouette.                                  |
| `vfx/fist_impact_burst.png`        | Phách Quyền (T1), Long Hổ Quyền (T5) | Punch impact burst with stone sparks.                                                                                          |
| `vfx/dragon_tiger_trail.png`       | Long Hổ Quyền (T5)                   | Sweeping arc trail of earth energy with faint dragon/tiger silhouette, horizontal.                                             |
| `vfx/taunt_ring.png`               | Khiêu Khích (T4)                     | Isometric pulsing ground ring with bronze runes.                                                                               |
| `vfx/mountain_charge_trail.png`    | Thiết Sơn Kháo (T7)                  | Dash trail of compressed earth and dust, horizontal streak.                                                                    |
| `vfx/diamond_body_aura.png`        | Kim Cương Bất Hoại (T8, ultimate)    | Golden-bronze diamond-hard aura around a standing figure silhouette (figure NOT drawn, aura only), with floating stone shards. |
| `vfx/diamond_body_shards_1..3.png` | T8                                   | 3 single crystal-stone shards for orbiting particles.                                                                          |

---

## 8. Icon, chân dung, biểu tượng

Thêm vào prompt: "Game UI icon, 256x256, centered subject, transparent background, no frame, no text, no quality rim (the rim is added by the game)."

| File                                    | Mô tả                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `icons/skill_T1_phach_quyen.png`        | Phách Quyền: a bronze gauntlet fist punching forward with stone sparks.              |
| `icons/skill_T2_thiet_bo_sam.png`       | Thiết Bố Sam: torso silhouette covered in stone plate armor.                         |
| `icons/skill_T3_dia_chan.png`           | Địa Chấn: fist slamming the ground with a crack ring.                                |
| `icons/skill_T4_khieu_khich.png`        | Khiêu Khích: glaring eyes over a bronze rune ring.                                   |
| `icons/skill_T5_long_ho_quyen.png`      | Long Hổ Quyền: twin sweeping fists with dragon and tiger energy.                     |
| `icons/skill_T6_kim_than_cong.png`      | Kim Thân Công (passive): seated meditating body glowing bronze.                      |
| `icons/skill_T7_thiet_son_khao.png`     | Thiết Sơn Kháo: shoulder charge with a mountain silhouette behind.                   |
| `icons/skill_T8_kim_cuong_bat_hoai.png` | Kim Cương Bất Hoại: diamond-hard golden body silhouette with shards.                 |
| `icons/class_emblem_the_tu.png`         | Class emblem: bronze square seal with the meander motif and a mountain.              |
| `portrait/the_tu_portrait.png`          | Character portrait bust (head and shoulders), S facing, for UI, 512x512, same style. |
| `icons/item_gauntlet_set.png`           | Item icon of the paired earth gauntlets.                                             |

---

## 9. Kiểm tra trước khi gửi lại

- [ ] Mọi file nền **trong suốt**, không bóng đổ, không chữ.
- [ ] Mảnh tay và chân **liền một khối**, vẽ thẳng, có phần vải thừa ở đầu mảnh (sẽ nằm dưới mảnh khác).
- [ ] Cùng tỉ lệ với ảnh master của hướng đó (so bằng cách xếp chồng).
- [ ] Màu đúng palette, ánh sáng từ trên-trái.
- [ ] Đặt tên đúng cột **File**, mỗi hướng một thư mục (`S/`, `SE/`, `E/`, `NE/`, `N/`), cộng `vfx/`, `icons/`, `portrait/`.

Số lượng ước tính: mỗi hướng khoảng 50 ảnh (S/SE/E/NE; N ít hơn vì không có mặt) → khoảng 230 ảnh nhân vật, cộng 18 VFX và 11 icon/chân dung.

Ghi chú giấy phép (D34): ảnh tạo bằng ChatGPT là **placeholder do AI sinh**. Khi gửi lại, ghi kèm tên công cụ/model ChatGPT hiển thị và ngày tạo để tôi ghi vào `docs/ASSET-LICENSES.md`; cần rà giấy phép trước khi phát hành.
