<!-- THE-TU-SPRITES-E:START -->

## Thể tu E — sprite sheet từng frame (D41)

Ảnh gốc giữ đầy đủ prompt/tool/model/CLI/UTC và image ID trong metadata. Không tạo lại mốc UTC chưa đo được; timestamp tệp gốc và thời điểm quan sát kết thúc được ghi riêng. UTC trong bảng dưới là lúc lập inventory, không phải lần sinh ảnh mới. Attribution chưa xác minh; không tuyên bố CC0/MIT cho ảnh. Mọi tệp là placeholder, phát hành `no`.

| Tệp / glob | Nguồn | UTC | Công cụ / mô hình | Chủ art tạm | Trạng thái | Phát hành? |
| --- | --- | --- | --- | --- | --- | --- |
| THES-E-GEN: `assets-src/placeholder/the-tu-sprites-v1/E/raw/*` | Original image_gen outputs, adjacent full prompt/UTC/image-ID records; deterministic recovery repair proof | 2026-11-06T20:09:29.274Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-E-SHEET: `assets-src/placeholder/the-tu-sprites-v1/E/sheets/*; assets-src/placeholder/the-tu-sprites-v1/E/templates/*` | THES-E-GEN; public @vgtd/sprite template and cell-local repair; frozen character calibration | 2026-11-06T20:09:29.274Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-E-QA: `assets-src/placeholder/the-tu-sprites-v1/E/*.json; assets-src/placeholder/the-tu-sprites-v1/E/quality-backlog.md; assets-src/placeholder/the-tu-sprites-v1/E/export/*; assets-src/placeholder/the-tu-sprites-v1/batch-E.json` | THES-E-SHEET; project clip-table timing, calibration, quality backlog and sprite export contract | 2026-11-06T20:09:29.274Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-E-RUNTIME: `apps/client-cocos/assets/resources/dragonbones/the-tu-sprites/thetu_E_*; apps/client-cocos/assets/resources/dragonbones/the-tu-sprites.meta` | THES-E-SHEET; @vgtd/sprite PMA atlas and DragonBones display-swap exporter, Cocos Creator metadata | 2026-11-06T20:09:29.274Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-E-REF: `assets-src/placeholder/the-tu-continuous-v1/reference/E.master4x.png` | Preserved The tu master from PR #113; see upstream concept/master provenance in the same license log | 2026-11-06T20:09:29.274Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |

### attack.attempt1.generation.json

```json

{
  "clip": "attack",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:38:45 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FIVE equal SQUARE columns by TWO rows, 10 full-body frames, row-major left-to-right top-to-bottom, sheet aspect5:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All10 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TEN-frame near RIGHT straight heavy PUNCH. Sequence1 guard low,2 raise both bronze gauntlets to chest,3 right fist chambers at ribs and left guards,4 shift weight and twist torso,5 RIGHT near fist extends STRAIGHT FORWARD screen-right at chest height,6 hit held with full extension and firm wrist,7 right retracts,8 shoulders unwind,9 lower guard,10 recover same initial stance. Left far gauntlet guards near chest, never another prop. Punch driven by shoulder/torso, anatomically natural elbow, no inflated sleeves or stretched bronze blocks. Two boots stay grounded, slight shallow lunge, preserve stature and head size, no deep crouch. Whole extended right fist within cell. Preserve exact costume and gauntlet ornament, ONE character per cell. PURE flat opaque#FF00FF background, remove ALL template guides/borders/ticks. No floor/shadows, effects, blur, text, labels or added objects. If pose crouches/raises fists, change pose bounding box naturally but NEVER anatomical scale.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/attack.template.png"
  ],
  "selectedOutput": "sheets/attack.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-3e08e804-ba58-4e46-b808-07197abf3f8b.png",
  "utcEndObserved": "2026-11-06 16:41:07 UTC",
  "originalBackup": "raw/originals/attack.attempt1.png"
}

```

### attack_2.attempt1.generation.json

```json

{
  "clip": "attack_2",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:38:45 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK_2 sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FIVE equal SQUARE columns by TWO rows, 10 full-body frames, row-major left-to-right top-to-bottom, sheet aspect5:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All10 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TEN-frame far LEFT PALM STRIKE combo follow-up. Cells1 low guard,2 both gauntlets chest guard,3 LEFT far hand opens palm inside bronze gauntlet,4 left elbow winds back while right guards,5 LEFT far open bronze-gauntleted palm drives forward screen-right at chest level,6 open palm held extension,7 left retracts,8 torso unwinds,9 hands lower,10 return guard. Near right closed gauntlet stays guarding chest. Fingers visibly open only on left palm, bronze plates retain same rectangular earth-block design. No free-floating hand, no extra arms. Natural joint anatomy, shallow grounded weight shift, same master head/torso/leg dimensions, no squat or scale change. Preserve exact costume and gauntlet ornament, ONE character per cell. PURE flat opaque#FF00FF background, remove ALL template guides/borders/ticks. No floor/shadows, effects, blur, text, labels or added objects. If pose crouches/raises fists, change pose bounding box naturally but NEVER anatomical scale.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/attack_2.template.png"
  ],
  "selectedOutput": "sheets/attack_2.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-00d66d99-7597-41fd-b9ba-4707434e11ff.png",
  "utcEndObserved": "2026-11-06 16:40:14 UTC",
  "originalBackup": "raw/originals/attack_2.attempt1.png"
}

```

### attack_3.attempt1.generation.json

```json

{
  "clip": "attack_3",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:38:45 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK_3 sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FIVE equal SQUARE columns by TWO rows, 10 full-body frames, row-major left-to-right top-to-bottom, sheet aspect5:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All10 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TEN-frame powerful DOUBLE-FIST downward GROUND SLAM finisher. Cells1 standing low guard;2 both heavy bronze gauntlets rise chest;3 both fists beside head;4 both fists lift above head, knees soften;5 torso folds and both fists descend;6 both bronze fists strike ground in front of boots with deep squat;7 hold grounded contact;8 push upward recovering;9 straighten knees and lower fists;10 initial standing guard. A real anatomical crouch with unchanged limb/head size, not shrinking body. Both gauntlets remain worn on hands, never enlarged or detached. Keep entire raised fists and ground-contact figure inside own cell. No baked impact/explosion/dust/cracks or ground line. Preserve exact costume and gauntlet ornament, ONE character per cell. PURE flat opaque#FF00FF background, remove ALL template guides/borders/ticks. No floor/shadows, effects, blur, text, labels or added objects. If pose crouches/raises fists, change pose bounding box naturally but NEVER anatomical scale.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/attack_3.template.png"
  ],
  "selectedOutput": "sheets/attack_3.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-5fc4b898-18be-4c21-9b86-c9c5ee917edd.png",
  "utcEndObserved": "2026-11-06 16:41:07 UTC",
  "rawOutput": "raw/attack_3.attempt1.png",
  "derivation": "sheets/attack_3.png uses recorded cell9 recovery repair; original raw unchanged",
  "originalBackup": "raw/originals/attack_3.attempt1.png"
}

```

### cast.attempt1.generation.json

```json

{
  "clip": "cast",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:38:45 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame CAST sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY SEVEN equal SQUARE columns by TWO rows, 14 full-body frames, row-major left-to-right top-to-bottom, sheet aspect7:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All14 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. FOURTEEN-frame deliberate EARTH cultivation palm cast, NOT sword magic. Cells1 standing guard;2 inhale;3 both open bronze-gauntleted palms gather at abdomen;4 elbows draw inward;5 open palms at chest;6 left palm pushes partly forward;7 both open palms extend forward screen-right;8 release held;9 release held with slight cloth followthrough;10 palms pull back;11 hands close loosely;12 lower gauntlets;13 settle;14 initial guard. Remain standing, planted feet, same217unit stature with natural small lean, same head/face size. Palms visible within worn bronze block gauntlets, one hand per arm, no extra fingers/limbs. No glow, stones, projectile, dust, seal symbols or magic effects baked in. Preserve exact costume and gauntlet ornament, ONE character per cell. PURE flat opaque#FF00FF background, remove ALL template guides/borders/ticks. No floor/shadows, effects, blur, text, labels or added objects. If pose crouches/raises fists, change pose bounding box naturally but NEVER anatomical scale.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/cast.template.png"
  ],
  "selectedOutput": "sheets/cast.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-99e0a8df-3e04-4a9b-a7ed-7ebf6dda197c.png",
  "utcEndObserved": "2026-11-06 16:41:08 UTC",
  "originalBackup": "raw/originals/cast.attempt1.png"
}

```

### channel.attempt1.generation.json

```json

{
  "clip": "channel",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:46:22 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame CHANNEL sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame standing CHANNEL cultivation loop. Feet planted, shallow grounded stance, eyes focused screen-right. Both open bronze-gauntleted palms held forward at chest height, elbows naturally bent, channeling invisible earth power. Cells1..4 subtle inhale and palm press forward3px,5..8 exhale and return. Same pose/anatomical dimensions and217unit stature in all8, head movement <=2px. Both hands in gauntlets with clear fingers, no extra arms or detached armor. No aura, projectile, glow, particles or floating rocks. Lastcell returns smoothly to first. Exact master costume, no added props. Pure flat opaque#FF00FF background, REMOVE ALL guides/borders/ghosts/ticks/text/labels; no floor, shadows, blur or effects. One complete character in each own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/channel.template.png"
  ],
  "selectedOutput": "sheets/channel.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-89331590-d675-4e33-8173-f77037b6718b.png",
  "utcEndObserved": "2026-11-06 16:48:26 UTC",
  "originalBackup": "raw/originals/channel.attempt1.png"
}

```

### dash.attempt1.generation.json

```json

{
  "clip": "dash",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:57:39 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame DASH sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY THREE equal SQUARE columns by TWO rows, 6 full-body frames, row-major left-to-right top-to-bottom, sheet aspect3:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All6 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. SIX-frame heavy martial DASH to screen-right, no loop. Cells1 grounded guard,2 shallow crouched anticipation with gauntlets close chest,3 strong forward drive one boot pushing off,4 body leans forward in brief airborne lunge with both bronze gauntlets leading defensively,5 forward foot lands,6 settles into same standing guard. Same adult head/torso/limb sizes and same gauntlets in all6; no smearing or elastic stretched legs. Keep full figure inside cell, no translation outsidecell. Costume and sash follow naturally. No speed lines, blur, afterimages or dust. Pure flat opaque#FF00FF background; REMOVE ALL template lines/ghosts/ticks/borders, no floor/shadow, blur, text, labels or baked VFX. Each figure stays entirely inside its owncell. No new props or costume.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/dash.template.png"
  ],
  "selectedOutput": "sheets/dash.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-50b05c57-8970-45b9-b5c6-d9ef8b00f058.png",
  "utcEndObserved": "2026-11-06 16:59:55 UTC",
  "originalBackup": "raw/originals/dash.attempt1.png"
}

```

### die.attempt1.generation.json

```json

{
  "clip": "die",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:46:22 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame DIE sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by THREE rows, 12 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:3. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, upright anatomical figure height217 units, seated/collapsed pose naturally shorter without changing limb or head size, pelvis axis x128. All12 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TWELVE-frame DEATH collapse, no loop. Cell1 standing guard exact master;2 stunned chest clutch with gauntlet;3 knees buckle;4 torso bows forward;5 one knee drops;6 both knees ground;7 torso sinks sideways toward screen-left;8 one bronze-gauntleted arm supports ground;9 collapses on side;10 lies sideways motionless;11 same lying pose settles cloth;12 final held lying pose. Full-sized character folds and rotates naturally, NEVER shrinks to fit. Keep head/body/gauntlets/boots all present and within cell. Facing remains screen-right as it falls, no full back-turn. Bronze gauntlets stay worn. Same costume and face, eyes closed on final frames. No blood, gore, weapon, ground/floor/shadow, skull, extra figures or effects. Exact master costume, no added props. Pure flat opaque#FF00FF background, REMOVE ALL guides/borders/ghosts/ticks/text/labels; no floor, shadows, blur or effects. One complete character in each own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/die.template.png"
  ],
  "selectedOutput": "sheets/die.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-780e18bb-23ab-4ebb-8c8a-bc3c674328d6.png",
  "utcEndObserved": "2026-11-06 16:48:26 UTC",
  "originalBackup": "raw/originals/die.attempt1.png"
}

```

### emote.attempt1.generation.json

```json

{
  "clip": "emote",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:57:39 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame EMOTE sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by THREE rows, 12 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:3. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All12 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TWELVE-frame respectful MARTIAL SALUTE emote, no loop. Cells1-2 low neutral standing guard,3 right gauntleted fist rises to chest,4 LEFT open gauntleted palm rises,5 left palm covers right fist in traditional fist-and-palm salute at chest,6 slight respectful head bow,7 hold bow,8 head raises,9 hands separate,10 both hands lower,11 settle,12 identical initialguard. Both gauntlets remain worn with correct bronze block plates, fingers naturally open only asneeded; no extra hands or missing fists. Same upright217unit anatomy, only tiny neck bow; feet planted unchanged. Same face/hair/costume, no smile caricature. No speech/text, glyphs, icons, effects or extra person. Pure flat opaque#FF00FF background; REMOVE ALL template lines/ghosts/ticks/borders, no floor/shadow, blur, text, labels or baked VFX. Each figure stays entirely inside its owncell. No new props or costume.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/emote.template.png"
  ],
  "selectedOutput": "sheets/emote.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-f3dcf4e9-82fe-464b-87ea-d7e87e96640d.png",
  "utcEndObserved": "2026-11-06 16:59:55 UTC",
  "originalBackup": "raw/originals/emote.attempt1.png"
}

```

### hit.attempt1.generation.json

```json

{
  "clip": "hit",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:46:22 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame HIT sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by ONE rows, 4 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:1. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All4 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. FOUR-frame HIT reaction. Cell1 normal standing guard matching master; cell2 recoils torso/head BACK to screen-left after invisible chest hit, both bronze gauntlets rise defensively; cell3 shoulders recover forward, knees softly bent; cell4 return original standing guard. Keep whole body facingRIGHT, adult anatomy and same head/limb lengths; shallow recoil, no face swap to another character, no shrunk body, no mesh-like elastic sleeves. No impact/star/effects/enemy. Entire pose fits owncell. Exact master costume, no added props. Pure flat opaque#FF00FF background, REMOVE ALL guides/borders/ghosts/ticks/text/labels; no floor, shadows, blur or effects. One complete character in each own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/hit.template.png"
  ],
  "selectedOutput": "sheets/hit.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-3fc2700c-e286-4fb6-ad0c-4eb635a6c271.png",
  "utcEndObserved": "2026-11-06 16:48:28 UTC",
  "originalBackup": "raw/originals/hit.attempt1.png"
}

```

### idle.attempt1.generation.json

```json

{
  "clip": "idle",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "utcStart": "2026-11-06 16:30:34 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame IDLE sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by THREE rows, 12 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:3. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All12 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. IDLE loop sequence: cells1-3 neutral guarded stance and beginning inhale,4-6 chest gently expands with tiny gauntlet lift,7-9 exhale,10-12 return smoothly to frame1. Both feet stay planted in the same locations, knees almost straight, no squat, no head bob more than2px. Gauntlets held low slightly away from torso, as master, tiny wrist/shoulder breathing only; retain fingers and rectangular plates. Subtle sash-tail cloth follow-through, no large silhouette or costume drift. Last-to-first seam must be as small as adjacent breathing frames. PURE FLAT opaque magenta #FF00FF background in all cells. REMOVE all grid lines, guides, ticks, markers and labels from final. NO cast shadow, floor, effects, blur, text, numbers, borders, extra figures, blank cells or merged cells.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/idle.template.png"
  ],
  "selectedOutput": "sheets/idle.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "cli": "codex-cli 0.166.0",
  "utcEnd": null,
  "utcEndNote": "Exact completion UTC not sampled; original image file timestamp recorded separately",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-84695827-c4e3-4b9d-959c-398d9d6408ae.png",
  "originalFileLastWriteUtc": "2026-11-06T16:31:11.071919+00:00",
  "originalBackup": "raw/originals/idle.attempt1.png"
}

```

### meditate.attempt1.generation.json

```json

{
  "clip": "meditate",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:46:22 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame MEDITATE sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, upright anatomical figure height217 units, seated/collapsed pose naturally shorter without changing limb or head size, pelvis axis x128. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame seated MEDITATION breathing loop. All eight show SAME adult sitting cross-legged toward screen-right, upright straight back, eyes gently closed, both bronze gauntlets resting on knees with palms relaxed. Cell1 calm settled pose,2 inhale starts,3 chest tiny expansion,4 full inhale,5 exhale,6 relax,7 settle,8 return exact cell1. Fold full-size legs naturally into seated pose; SAME head/torso/limb anatomical dimensions as standing master, NOT a smaller standing figure or chibi. Bounding height becomes shorter because legs fold, sole/seat base stays y232. No stool, mat, rocks, aura, glow, prayer symbols or scenery. Hold character pose stable for seamless loop, tiny sash/robe breathing only. Exact master costume, no added props. Pure flat opaque#FF00FF background, REMOVE ALL guides/borders/ghosts/ticks/text/labels; no floor, shadows, blur or effects. One complete character in each own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "raw/meditate.attempt1.template.png"
  ],
  "selectedOutput": "raw/meditate.attempt1.png",
  "status": "rejected: seated figure fills standing-height cell; head and torso enlarged",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-5cf59741-0f7d-431a-a7f8-b61ea347fb5d.png",
  "utcEndObserved": "2026-11-06 16:48:26 UTC",
  "originalBackup": "raw/originals/meditate.attempt1.png"
}

```

### meditate.attempt2.generation.json

```json

{
  "clip": "meditate",
  "attempt": 2,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:12:18 UTC",
  "prompt": "Production 8-frame seated meditation sprite sheet, FOUR equal SQUARE columns x TWO rows, aspect2:1, each cell256units. First image is EXACT Thá»ƒ tu A SÆ¡n MÃ´n Há»™ Vá»‡ identity/anatomy/style reference, second image is seated-pose framing template. Critical: do NOT enlarge seated character to fill a standing-height cell. Keep EXACT SAME head, torso, arm, gauntlet and thigh anatomical sizes as standing master. Standing master is217units tall. Because legs fold cross-legged, seated figure should be only about150-158units tall: top of bun around y78..82, seat/boot base y232. Leave BIG EMPTY MAGENTA AREA above seated head. Head bun-to-chin about44units, not80; head and shoulders same dimensions as standing master. Seated body width roughly100units, centered x128. Show same adult STOCKY earth tank male facing screenRIGHT, slight overhead isometric profile, eyes closed, straight upright back, full-size legs folded cross-legged, bronze stone-block gauntleted hands resting relaxed on knees. Same short darkbrown topbun/jadehairpin, ivory crosscollar robe/sleeves/loose trousers#E9EEF0, short mountain-blue tabard#5E8798 with bronze cloud trim#B58A4A, darkblue sash#294451 knot/two tails, darkboots folded beneath. Bronze gauntlets with square meander emblem and ochre highlights, not removed or enlarged. Preserve fine ink outlines, restrained painterly celshading and NW light. Cells1-2 calm exhale,3-4 tiny inhale chest expansion,5-6 tiny exhale,7-8 return exact first pose. Stable breathing loop, same head/torso size across all8. No chibi/squashing, no inflated head or shoulder. Pure opaque flat#FF00FF background. Remove all template lines/borders/ticks, no text/labels/numbers, shadows/floor/mat/stool/aura/rocks/glow/effects/props. One complete seated figure per cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/meditate.template.png"
  ],
  "selectedOutput": "sheets/meditate.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-2b398a68-cd2a-4180-99f6-67dfa6f67d7b.png",
  "utcEndObserved": "2026-11-06 17:12:46 UTC",
  "originalBackup": "raw/originals/meditate.attempt2.png"
}

```

### run.attempt1.generation.json

```json

{
  "clip": "run",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:33:52 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame RUN sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FIVE equal SQUARE columns by TWO rows, 10 full-body frames, row-major left-to-right top-to-bottom, sheet aspect5:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All10 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. RUN in-place full two-step cycle, 10 frames, brisk heavy earth-tank short-stride jog with slight forward lean. Cell1 near/R contact ahead,2 weight/load,3 passing,4 toeoff and far/L advances,5 precontact; cell6 far/L contact ahead,7 weight/load,8 passing,9 toeoff and near/R advances,10 precontact. Cell6 MUST show opposite leading boot and opposite near-gauntlet swing to cell1. Gauntlet arms swing opposite legs, near arm BACK first half and FORWARD second half. Near/R boot slightly lighter, far/L boot shadowed, never merge legs or duplicate stance. Follow CYAN R near and AMBER L far foot ghosts, foot travels back during planted phase. Brief flight allowed near5/10 but preserve measured full-body height211..223 units and master head size; no squat or short deformed thighs. Maintain compact stocky anatomy, full sleeves/trousers naturally redrawn around real elbows/knees. Cloth/sash tiny follow-through; no blur. Smooth last-to-first loop, consistent NW lighting and unchanged design. Pure flat opaque #FF00FF background; REMOVE ALL template guides/borders/ghosts/ticks, no floor, shadows, VFX, blur, text or labels. Whole figure in each own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/run.template.png"
  ],
  "selectedOutput": "sheets/run.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-f1654c1e-30ef-4ae4-bbae-309bdfbc1162.png",
  "utcEndObserved": "2026-11-06 16:37:14 UTC",
  "originalBackup": "raw/originals/run.attempt1.png"
}

```

### sword_fly.attempt1.generation.json

```json

{
  "clip": "sword_fly",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:57:39 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame SWORD_FLY sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame AIRBORNE cultivation travel idle loop for a gauntlet earth-tank, legacy animation name sword_fly but ABSOLUTELY NO SWORD, no weapon/rock/cloud/board/prop. Character facesRIGHT, floats calmly in upright relaxed guard, both bronze gauntlets close abdomen, boots together/just apart beneath body, knees lightly relaxed. Cells1..4 subtle inhale and small robe-tail sway,5..8 exhale and return. Hold same full anatomical217unit stature and same scale; no cropped soles or exaggerated folded legs. Stable same position in eachcell, runtime handles travel, not art. No aura, glow or effects, no floor/shadow. Pure flat opaque#FF00FF background; REMOVE ALL template lines/ghosts/ticks/borders, no floor/shadow, blur, text, labels or baked VFX. Each figure stays entirely inside its owncell. No new props or costume.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/sword_fly.template.png"
  ],
  "selectedOutput": "sheets/sword_fly.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-fba533cb-f3db-4ed2-b970-73bb3637418a.png",
  "utcEndObserved": "2026-11-06 16:59:55 UTC",
  "originalBackup": "raw/originals/sword_fly.attempt1.png"
}

```

### tribulation.attempt1.generation.json

```json

{
  "clip": "tribulation",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:57:39 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame TRIBULATION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY SIX equal SQUARE columns by FOUR rows, 24 full-body frames, row-major left-to-right top-to-bottom, sheet aspect6:4. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All24 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TWENTY-FOUR-frame TRIBULATION endurance, EXACT6columns4rows all24 distinct complete figures in reading order. Phase cells1-4 standing calm guard turns tense,5-8 both bronze gauntlets rise cross-block in front of upper chest/face,9-12 shoulders brace knees slightly bend against invisible force,13-16 holds crossed-forearm iron-body guard with subtle strain,17-20 lowers arms gradually and breathes out,21-24 returns to original standing guard. Still same EAST-facing full-grown stocky man in everycell,217unit anatomical stature. Keep head/boots and both worn bronze gauntlets visible, no deep squat/shrinking or enlarged head. Same outfit/meanderemblems and NW light. No lightning, sky, electricity, wounds, glow, rocks, particles or effects baked in. All24cells must be filled with samecharacter, no text/layout labels. Pure flat opaque#FF00FF background; REMOVE ALL template lines/ghosts/ticks/borders, no floor/shadow, blur, text, labels or baked VFX. Each figure stays entirely inside its owncell. No new props or costume.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/tribulation.template.png"
  ],
  "selectedOutput": "sheets/tribulation.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-69d0dd0e-9eeb-481a-af69-4244c3d43d96.png",
  "utcEndObserved": "2026-11-06 16:59:55 UTC",
  "originalBackup": "raw/originals/tribulation.attempt1.png"
}

```

### walk.attempt1.generation.json

```json

{
  "clip": "walk",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 16:33:52 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame WALK sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face EAST / screen RIGHT in the same slightly overhead orthographic isometric side view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x128. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. WALK in-place full two-step loop, 8 frames, smooth grounded short stride. Cells1..4: R-near heel contact forward, weight transfer/down, R supports while L passes, L reaches forward. Cells5..8: L-far heel contact forward, weight transfer/down, L supports while R passes, R reaches forward. Frame5 MUST show OPPOSITE leading leg to frame1. Swing bronze gauntlet arms opposite legs: near right gauntlet BACK when near right leg forward; near gauntlet FORWARD in second half. Both feet distinguishable: near boot outer side lit, far boot shadowed. Follow CYAN near/R and AMBER far/L foot ghosts in template, red/blue lead ticks are guides only. Feet move backward in planted phase while body stays centered. Upright head top remains y15, never crouch or change stature, knees naturally flexible without collapsing trousers. Same garment length and gauntlet shape in every frame. Smooth last-to-first loop, consistent NW lighting and unchanged design. Pure flat opaque #FF00FF background; REMOVE ALL template guides/borders/ghosts/ticks, no floor, shadows, VFX, blur, text or labels. Whole figure in each own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/E.master4x.png",
    "templates/walk.template.png"
  ],
  "selectedOutput": "sheets/walk.png",
  "status": "selected; per-clip hard QA PASS, final atlas/capture pending",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-7eef0a29-176e-4e90-b61f-ca6e7bb1ca20.png",
  "utcEndObserved": "2026-11-06 16:37:13 UTC",
  "originalBackup": "raw/originals/walk.attempt1.png"
}

```

<!-- THE-TU-SPRITES-E:END -->
