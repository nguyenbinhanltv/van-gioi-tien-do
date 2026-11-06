<!-- THE-TU-SPRITES-S:START -->

## Thể tu S — sprite sheet từng frame (D41)

Ảnh gốc giữ đầy đủ prompt/tool/model/CLI/UTC và image ID trong metadata. Không tạo lại mốc UTC chưa đo được; timestamp tệp gốc và thời điểm quan sát kết thúc được ghi riêng. UTC trong bảng dưới là lúc lập inventory, không phải lần sinh ảnh mới. Attribution chưa xác minh; không tuyên bố CC0/MIT cho ảnh. Mọi tệp là placeholder, phát hành `no`.

| Tệp / glob | Nguồn | UTC | Công cụ / mô hình | Chủ art tạm | Trạng thái | Phát hành? |
| --- | --- | --- | --- | --- | --- | --- |
| THES-S-GEN: `assets-src/placeholder/the-tu-sprites-v1/S/raw/*` | Original image_gen outputs, adjacent full prompt/UTC/image-ID records; deterministic recovery repair proof | 2026-11-06T20:09:46.128Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-S-SHEET: `assets-src/placeholder/the-tu-sprites-v1/S/sheets/*; assets-src/placeholder/the-tu-sprites-v1/S/templates/*` | THES-S-GEN; public @vgtd/sprite template and cell-local repair; frozen character calibration | 2026-11-06T20:09:46.128Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-S-QA: `assets-src/placeholder/the-tu-sprites-v1/S/*.json; assets-src/placeholder/the-tu-sprites-v1/S/quality-backlog.md; assets-src/placeholder/the-tu-sprites-v1/S/export/*; assets-src/placeholder/the-tu-sprites-v1/batch-S.json` | THES-S-SHEET; project clip-table timing, calibration, quality backlog and sprite export contract | 2026-11-06T20:09:46.128Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-S-RUNTIME: `apps/client-cocos/assets/resources/dragonbones/the-tu-sprites/thetu_S_*; apps/client-cocos/assets/resources/dragonbones/the-tu-sprites.meta` | THES-S-SHEET; @vgtd/sprite PMA atlas and DragonBones display-swap exporter, Cocos Creator metadata | 2026-11-06T20:09:46.128Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-S-REF: `assets-src/placeholder/the-tu-continuous-v1/reference/S.master4x.png` | Preserved The tu master from PR #113; see upstream concept/master provenance in the same license log | 2026-11-06T20:09:46.128Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |

### attack.attempt1.generation.json

```json

{
  "clip": "attack",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:27:39 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK SOUTH-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect2:1. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell. EIGHT-frame RIGHT straight punch TOWARD VIEWER/screenDOWN, frontalS. AnatomicalR is SCREEN-LEFT.1 lowguard;2 rightfistchambersat ribs/leftguards;3 windup;4 rightbronze fistpunches towardviewer belowface;5 hithold;6 retract;7 unwind;8 guard. Armforeshortens orthographically, gauntlet keeps masterSIZE, not a giantfist. Face staysfrontal/twoeyes, shoulders turnonlyslightly. Shallow groundedlunge, full-sizedlegs/sleeves natural. ExactS master outfit/face/camera. Bending/raisedarms changesbbox naturally, never anatomicalscale. Same pairedbronze gauntlets/meander, centralfrontknot/twotails. Pure flatopaque#FF00FF; removeallguides/borders/ticks/text, no shadows/floor/blur/effects. All8wholefigures inowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/attack.template.png"
  ],
  "selectedOutput": "sheets/attack.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:29:22 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-0c1329c1-8bb8-4d27-8542-e6b1c82df3a0.png",
  "originalBackup": "raw/originals/attack.attempt1.png"
}

```

### attack_2.attempt1.generation.json

```json

{
  "clip": "attack_2",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:27:39 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK_2 SOUTH-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect2:1. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell. EIGHT-frame LEFT openpalm strike towardviewer/screenDOWN. AnatomicalL is SCREEN-RIGHT.1 guard;2 chestguard;3 leftpalmopens/chambers;4 leftbronze-gauntleted palmextends forward belowface;5 hithold;6 retract;7 lowerarms;8 guard. Rightfist stayschestguard. Same hand/plate size, naturalfingerarticulation, no extraarms. True frontalface/body angle, not side-profile. Plantedfeet withsmallweighttransfer. ExactS master outfit/face/camera. Bending/raisedarms changesbbox naturally, never anatomicalscale. Same pairedbronze gauntlets/meander, centralfrontknot/twotails. Pure flatopaque#FF00FF; removeallguides/borders/ticks/text, no shadows/floor/blur/effects. All8wholefigures inowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/attack_2.template.png"
  ],
  "selectedOutput": "sheets/attack_2.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:29:22 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-7d68cba3-dceb-48c3-bae1-1eedae8e2a88.png",
  "originalBackup": "raw/originals/attack_2.attempt1.png"
}

```

### attack_3.attempt1.generation.json

```json

{
  "clip": "attack_3",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:27:39 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK_3 SOUTH-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect2:1. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell. EIGHT-frame doublebronze-fist GROUNDSLAM frontalS.1 standguard;2 bothfistsrise besidehead;3 bothfistsabovebun;4 torsobends/fistsdescend;5 deepnaturalsquat withboth wornfistsstrikingground beforeboots;6 hithold;7 recoveryup;8 originalguard. Full-sizedhead/torso/limbs fold naturally, NO shrinking/inflating. Entirebody/fistsinsideowncell. Keep fronttabard/sashvisibleappropriately, no groundcracks/dust/VFX/props. ExactS master outfit/face/camera. Bending/raisedarms changesbbox naturally, never anatomicalscale. Same pairedbronze gauntlets/meander, centralfrontknot/twotails. Pure flatopaque#FF00FF; removeallguides/borders/ticks/text, no shadows/floor/blur/effects. All8wholefigures inowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/attack_3.template.png"
  ],
  "selectedOutput": "sheets/attack_3.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:28:53 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-8722f60f-eb98-44fb-9440-e25ec036051f.png",
  "originalBackup": "raw/originals/attack_3.attempt1.png"
}

```

### cast.attempt1.generation.json

```json

{
  "clip": "cast",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:27:39 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame CAST SOUTH-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect2:1. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell. EIGHT-frame standing earthpalmCAST frontalS.1 guard;2 opengauntletedpalms gatheratabdomen;3 palmsrisetochest;4 gather;5 bothpalms releaseTOWARDVIEWER belowface;6 hold;7 retractlower;8 guard. Botharms foreshorten without handsizegrowth. Facefront/twoeyes, feetplanted, same210unitstandingstature, no turningE/SE. No aura/glyphs/particles/rocks/glow/VFX. ExactS master outfit/face/camera. Bending/raisedarms changesbbox naturally, never anatomicalscale. Same pairedbronze gauntlets/meander, centralfrontknot/twotails. Pure flatopaque#FF00FF; removeallguides/borders/ticks/text, no shadows/floor/blur/effects. All8wholefigures inowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/cast.template.png"
  ],
  "selectedOutput": "sheets/cast.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:29:22 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-8771fb94-792b-4bf4-b225-62562bf4860f.png",
  "originalBackup": "raw/originals/cast.attempt1.png"
}

```

### channel.attempt1.generation.json

```json

{
  "clip": "channel",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:00:53 UTC",
  "prompt": "Production frame-by-frame CHANNEL SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout guide. EXACTLY 4 equal SQUARE columns by 2 rows, 8 full-body frames row-major, sheet aspect 4:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  Eight-frame seamless standing CHANNEL loop: both bronze gauntlets held symmetrically at lower chest, palms inward, breathing gently, elbows bend naturally. Frame1 neutral;2 inhale;3 inhalepeak;4 relax;5 neutral;6 exhale;7 relax;8 exactlyframe1. Feet planted, bun top22 and soles232 throughout. No effects or aura. Pure flat opaque #FF00FF background. Remove all template guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every figure fits entirely inside its own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/channel.template.png"
  ],
  "selectedOutput": "sheets/channel.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:02:43 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-94cf0f56-db04-463a-95cb-7c1175e2127a.png",
  "originalBackup": "raw/originals/channel.attempt1.png"
}

```

### dash.attempt1.generation.json

```json

{
  "clip": "dash",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:00:53 UTC",
  "prompt": "Production frame-by-frame DASH SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout guide. EXACTLY 3 equal SQUARE columns by 2 rows, 6 full-body frames row-major, sheet aspect 3:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  DASH toward viewer/front. Frames:1 standing guard;2 knees bend and torso leans forward;3 powerful forward push both gauntlets guarding ribs;4 low airborne lunge with legs tucked naturally;5 landing bent knees;6 standing guard identical to1. Keep same full-sized anatomy; no growth during foreshortening. Pure flat opaque #FF00FF background. Remove all template guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every figure fits entirely inside its own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/dash.template.png"
  ],
  "selectedOutput": "sheets/dash.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:02:43 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-ae83e162-1c61-4189-8f52-e4eb83dbe8f1.png",
  "originalBackup": "raw/originals/dash.attempt1.png"
}

```

### die.attempt1.generation.json

```json

{
  "clip": "die",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:03:55 UTC",
  "prompt": "Production frame-by-frame DIE SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout/pose guide. EXACTLY 4 equal SQUARE columns by 2 rows, 8 full-body frames row-major, sheet aspect 4:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  DIE sequence rowmajor:1 exactstandingguard;2 injuredshouldersslump;3 kneeling;4 bothkneestouchground;5 leaningontoonearm;6 full-sizebodyfalls SIDEWAYS toscreenright;7 lyingonrightside;8 exactsamefinallyingpose. Camera staysS, bones naturallybend; maintain samephysicalhead/torso/limbsizes. No shrunk miniature corpse, no blood, no effects. Wholelyingbody mustfitinsidecell. Pure flat opaque #FF00FF background. Remove all guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every complete figure fits entirely inside its own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/die.template.png"
  ],
  "selectedOutput": "sheets/die.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:04:54 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-90812598-5313-4f5c-896b-6632df707ec9.png",
  "originalBackup": "raw/originals/die.attempt1.png"
}

```

### emote.attempt1.generation.json

```json

{
  "clip": "emote",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:03:55 UTC",
  "prompt": "Production frame-by-frame EMOTE SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout/pose guide. EXACTLY 4 equal SQUARE columns by 2 rows, 8 full-body frames row-major, sheet aspect 4:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  Eight-frame EMOTE martial salute:1 standingguard;2 gauntletsrise;3 rightfistmeetsleftopenpalmatthechest;4 holdsalute;5 slightpolitenod;6 lifthead;7 lowerhands;8 exactfirstguard. AnatomicalrightisscreenLEFT. No effects or text. Bothboots planted, same standingheight210 andsameheadsize. Pure flat opaque #FF00FF background. Remove all guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every complete figure fits entirely inside its own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/emote.template.png"
  ],
  "selectedOutput": "raw/emote.attempt1.png",
  "status": "rejected: 217..218px: exceeds upright maximum216.3px",
  "utcEndObserved": "2026-11-06 19:05:48 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-a7a0cef6-436e-45bd-aebf-625bd116c34c.png",
  "originalBackup": "raw/originals/emote.attempt1.png"
}

```

### emote.attempt2.generation.json

```json

{
  "clip": "emote",
  "dir": "S",
  "attempt": 2,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:07:27 UTC",
  "prompt": "Production frame-by-frame EMOTE SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout/pose guide. EXACTLY 4 equal SQUARE columns by 2 rows, 8 full-body frames row-major, sheet aspect 4:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  Eight-frame EMOTE martial salute:1 standingguard;2 gauntletsrise;3 rightfistmeetsleftopenpalmatthechest;4 holdsalute;5 slightpolitenod;6 lifthead;7 lowerhands;8 exactfirstguard. AnatomicalrightisscreenLEFT. No effects or text. Bothboots planted, same standingheight210 andsameheadsize. Pure flat opaque #FF00FF background. Remove all guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every complete figure fits entirely inside its own cell. HEIGHT CORRECTION FOR THIS FRESH SHEET: the prior drawing was uniformly too tall by7..8units, so redraw every figure naturally with the exact master proportions and compact stance. HARD bounding anchors in each256unit cell: topmost bun y24, soles y232, total208units, allowed204..215. Do not fill more than82percent of cell height. Maintain head42units and torso/legs from master; shallow relaxed knee flex in all8frames is fine. All8sameheight, no inflated head or taller elongated legs. Respect the second-image head/ground guides exactly.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/emote.template.png"
  ],
  "selectedOutput": "raw/emote.attempt2.png",
  "status": "rejected: 200px: below upright minimum203.7px",
  "utcEndObserved": "2026-11-06 19:07:52 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-9377e1d5-979d-4e34-82c3-c1e37ba74d6a.png",
  "originalBackup": "raw/originals/emote.attempt2.png"
}

```

### emote.attempt3.generation.json

```json

{
  "clip": "emote",
  "dir": "S",
  "attempt": 3,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:10:07 UTC",
  "prompt": "EDIT image1 (the accepted SOUTH idle sheet) into an eight-frame EMOTE martial salute sheet. Image2 is character identity reference only. Preserve image1 EXACT canvas size, FOUR columns TWO rows, cell positions, full-body height, head/bun top, boot soles, legs, boots, torso width, face identity and all colors. Do not zoom, shrink, stretch or recenter any figure; keep the same compact adult stocky earth tank. Change ONLY the arm/gauntlet poses: frame1 stays exact idle; frame2 gauntlets raise toward chest; frame3 right fist meets open left bronze-gauntleted palm at chest; frame4 hold salute; frame5 small respectful chin dip (no change bun position); frame6 chin returns; frame7 hands lower; frame8 exactly original idle. Hands remain paired bronze stone-block earth gauntlets with square meander, no bare hands. Anatomical right is screen LEFT. Keep exact front-facing SOUTH camera and all eight unchanged foot positions. Retain ivory sleeves/trousers, mountain-blue bronze-cloud tabard, dark blue sash knot/tails, dark boots, jade bun pin. Flat opaque #FF00FF background. No text, guide marks, particles, ground shadow, swords or scenery. Critical: keep every figure's height pixel-identical to image1; only redraw articulated arms/hands and minimal chin expression.",
  "references": [
    "sheets/idle.png",
    "../../the-tu-continuous-v1/reference/S.master4x.png"
  ],
  "selectedOutput": "sheets/emote.png",
  "status": "selected; awaiting hard QA",
  "utcEndObserved": "2026-11-06 19:10:35 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-4301c22a-72f2-4cd5-b627-bc101f025d51.png",
  "originalBackup": "raw/originals/emote.attempt3.png"
}

```

### hit.attempt1.generation.json

```json

{
  "clip": "hit",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:00:53 UTC",
  "prompt": "Production frame-by-frame HIT SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout guide. EXACTLY 4 equal SQUARE columns by 1 rows, 4 full-body frames row-major, sheet aspect 4:1. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  Four-frame HIT reaction:1 standing guard;2 shoulders recoil backwards and knees flex, pained expression;3 recover through shallow bent-knee guard;4 exact standing guard of1. Keep full-sized anatomy and stable facial size. No blood or impact effects. Pure flat opaque #FF00FF background. Remove all template guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every figure fits entirely inside its own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/hit.template.png"
  ],
  "selectedOutput": "sheets/hit.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:01:45 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-9a255ef5-5af7-46fe-8435-c9da9b494f16.png",
  "originalBackup": "raw/originals/hit.attempt1.png"
}

```

### idle.attempt1.generation.json

```json

{
  "clip": "idle",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:45:23 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame IDLE SOUTH-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell. EIGHT-frame frontal IDLE loop. Same standing feet fixed, both bronze gauntlets hang low slightly away from torso. Cells1-2 inhale starts,3-4 tiny chest expansion,5-6 exhale,7-8 settle to initialguard. Head bob<=2units, no squat, no arm gesture. Same upright210unit stature and head size all8. Exact S masterview with symmetrical broad chest, TWO front tabard flaps/cloudtrim, central sash knot/two tails. Never show side-profile/back or mirrored asymmetric costume. Pure flat opaque#FF00FF background, remove all guides/borders/ghosts/ticks/labels/text, no floor/shadow/effects/blur/props. Entire figure in owncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/idle.template.png"
  ],
  "selectedOutput": "sheets/idle.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:46:49 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-8763ac5b-f0fa-4988-9dcf-1f31a0598067.png",
  "originalBackup": "raw/originals/idle.attempt1.png"
}

```

### meditate.attempt1.generation.json

```json

{
  "clip": "meditate",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:03:55 UTC",
  "prompt": "Production frame-by-frame MEDITATE SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout/pose guide. EXACTLY 4 equal SQUARE columns by 2 rows, 8 full-body frames row-major, sheet aspect 4:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  Seated cross-legged MEDITATE loop. CRITICAL keep same master head/torso/limb sizes; standing210units, seatedonly145..150units. Bun at y85, seatedbootbase232, leave large empty magenta above. Head bun-to-chin42units, not80. Full-size legs folded naturally, back straight, eyes closed, bronze gauntlets on knees. Gentle inhale/exhale across8cells, last exactfirst. Do NOT enlarge seatedfigure tostandingheight. Use seatedguide inimage2. Pure flat opaque #FF00FF background. Remove all guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every complete figure fits entirely inside its own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/meditate.template.png"
  ],
  "selectedOutput": "sheets/meditate.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:05:48 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-b5babd27-6e69-42d4-a5da-8ab26217d941.png",
  "originalBackup": "raw/originals/meditate.attempt1.png"
}

```

### run.attempt1.generation.json

```json

{
  "clip": "run",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:45:23 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame RUN SOUTH-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY SIX equal SQUARE columns by TWO rows, 12 full-body frames, row-major left-to-right top-to-bottom, sheet aspect6:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All12 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell. TWELVE-frame heavy earth-tank RUN IN PLACE toward viewer/screenDOWN. Anatomical RIGHT leg = SCREEN-LEFT, LEFT = SCREEN-RIGHT. Toprow1..6 R contact ahead toward viewer, down/load, passing, toeoff, small flight/up, precontact. Bottomrow7..12 L takes lead. Cell7 MUST opposite leading leg and opposite right-gauntlet swing vs1. Broad shoulders rotate only slightly, face continues lookingtowardviewer, no side-profile turn. Full-length natural legs/sleeves under cloth, maintain head-to-lowestboot height204..216units (master210) in EVERY frame including flight; no tucked-bunny-hop squat, shrinking body or oversized head. Arms counter-swing, no punching. Modest small hop/shortstride, keep one leg extended down in flight to retain stature. Pure frontal master proportions. Exact S masterview with symmetrical broad chest, TWO front tabard flaps/cloudtrim, central sash knot/two tails. Never show side-profile/back or mirrored asymmetric costume. Pure flat opaque#FF00FF background, remove all guides/borders/ghosts/ticks/labels/text, no floor/shadow/effects/blur/props. Entire figure in owncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/run.template.png"
  ],
  "selectedOutput": "sheets/run.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:46:49 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-e73789ca-d984-4916-8eb2-c3446130675a.png",
  "rawOutput": "raw/run.attempt1.png",
  "derivation": "Final sheet uses documented six-cell AI repair plus contact/load hold at cell0; frozen scale unchanged",
  "repairProofs": [
    "raw/run.attempt2.repair-proof.json",
    "raw/run.contact-hold-repair.json"
  ],
  "originalBackup": "raw/originals/run.attempt1.png"
}

```

### run.attempt2.generation.json

```json

{
  "clip": "run",
  "dir": "S",
  "attempt": 2,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:57:07 UTC",
  "prompt": "CELL-LOCAL REPAIR of the SOUTH/FRONT RUN sprite sheet. Input1 exact masterS body/face/outfit; input2 EDIT TARGET original12-frame run; input3 layout. Preserve EXACT6columns2rows/aspect3:1 and frontal camera lookingtowardviewer/screenDOWN. ONLY change these six 1-basedcells:1,2,5,7,10,11 (=0based0,1,4,6,9,10). Cells1,2,7 are slightly too upright/tall: gently soften knees/lean stance a few pixels to match full-body height of normalcell3 or9, WITHOUT shrinking/scalinghead,torso orlimbs. Cells5,10,11 are tucked-up/too short: REDRAW knee/hip extension with one full-length leg extending downward under body, not both boots tuckedup, so bun-to-lowestboot height matches normalcell3/9. Preserve head/face dimensions and stocky adult anatomy exactly. Do not scale/resize figures to fit! Change pose joint articulation only. Aim same fullbodyheight across all12, matching normalcells3/9 (standing anatomy210units on256cell, allowed204..216). All other6 cells MUST remain pixel-identical in position,color,scale,pose. R anatomical leg is SCREEN-LEFT, L SCREEN-RIGHT; true frontal run not turning sideways. Keep arm counter-swing, paired worn bronze earth gauntlets/meanderplates, ivory baggy robe/trousers with natural folds not elastic mesh, short mountainblue split tabard/bronzecloudtrim, darkblue sashknot2tails, darkboots, shortdarkbrown topbun/jadepin, exactmasterface. Fine ink and restrained celshading NWlight. No extra limbs/props/swords. Keep opaque flatmagenta#FF00FF, no text,borders,guides,shadows,floor,VFX/blur. One entirefigure eachowncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "raw/run.attempt1.png",
    "templates/run.template.png"
  ],
  "rawOutput": "raw/run.attempt2.edited.png",
  "repairCells": [
    0,
    1,
    4,
    6,
    9,
    10
  ],
  "status": "edited donor; patch selection pending",
  "utcEndObserved": "2026-11-06 17:57:35 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-cc1a73d9-f062-460d-907a-93d2a7d4fb00.png",
  "selectedOutput": "raw/run.attempt2.selected.png",
  "derivation": "Final sheet uses documented six-cell AI repair plus contact/load hold at cell0; frozen scale unchanged",
  "repairProofs": [
    "raw/run.attempt2.repair-proof.json",
    "raw/run.contact-hold-repair.json"
  ],
  "originalBackup": "raw/originals/run.attempt2.png"
}

```

### run.attempt3.generation.json

```json

{
  "clip": "run",
  "dir": "S",
  "attempt": 3,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:07:03 UTC",
  "prompt": "Precise CELL-LOCAL POSE REPAIR. Input1 exact front/S Thá»ƒ tu master; input2 target12-frame RUN sheet6columns2rows; input3 template. Change ONLY TOP-LEFT cell1 (=0-based0). Keep all other11 cells EXACTLY unchanged. In cell1 keep both boots' x/y positions and sizes, head/face/torso/gauntlet sizes, armcounter-swing and frontal camera. Give this runner a CLEAR SHALLOW KNEE BEND to lower pelvis, shoulders, face and bun together by about6units on256cell (roughly8rawpixels). Boot sole stays fixed, knee/hip joints flex naturally. This reduces bun-to-lowestsole boundingheight from217 to about210-212 in finalunits, matching othernormalcells. DO NOT shrink/scale/resize any bodypart or wholefigure; alter pose by folding knees/hipslightly and naturally repaint trouser/sleevefolds. Head stays same dimensions and exactidentity but moves downward with torso. No oversized head or elasticcloth; full-sized thighs/calves under ivory trousers. Preserve right SCREEN-LEFT foot leading towardviewer/SCREEN-DOWN, both worn bronze blockgauntlets/meanderemblems, blue/ivory/bronze costume/sash2tails, darkboots, shortdarkbun/jadepin, NW light and fineink/celshading. Entire12cell layout exactly6x2, same3:1aspect andbackground#FF00FF. No alteredothercells, no guides/text/borders/shadows/floor/effects/props. Only one cell repaired anatomically, never per-frame scaling.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "raw/run.attempt2.selected.png",
    "templates/run.template.png"
  ],
  "rawOutput": "raw/run.attempt3.edited.png",
  "repairCells": [
    0
  ],
  "status": "rejected: cell0 over-bent to193px, fails203.7..216.3 height band",
  "utcEndObserved": "2026-11-06 18:07:21 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-b9380b34-b5e7-467f-ac46-aa883157175c.png",
  "rejectedSelection": "raw/run.attempt3.rejected.png",
  "originalBackup": "raw/originals/run.attempt3.png"
}

```

### sword_fly.attempt1.generation.json

```json

{
  "clip": "sword_fly",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:00:53 UTC",
  "prompt": "Production frame-by-frame SWORD_FLY SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout guide. EXACTLY 4 equal SQUARE columns by 2 rows, 8 full-body frames row-major, sheet aspect 4:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  Eight-frame seamless earth-cultivator HOVER:1 upright relaxed hover, toes below hips;2 rise2units;3 rise4units;4 rise2;5 original;6 lower2;7 lower3;8 original. Palms inward, gauntlets at sides, cloth sways subtly. NO sword or platform, no ground effects. Same210unit standing anatomy, stable head size. Pure flat opaque #FF00FF background. Remove all template guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every figure fits entirely inside its own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/sword_fly.template.png"
  ],
  "selectedOutput": "sheets/sword_fly.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:02:12 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-b8d391a1-c5bf-4881-8eff-2c640dfc80f6.png",
  "originalBackup": "raw/originals/sword_fly.attempt1.png"
}

```

### tribulation.attempt1.generation.json

```json

{
  "clip": "tribulation",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:03:55 UTC",
  "prompt": "Production frame-by-frame TRIBULATION SOUTH sprite sheet for Van Gioi Tien Do. Image1 exact character/style master, image2 layout/pose guide. EXACTLY 6 equal SQUARE columns by 2 rows, 12 full-body frames row-major, sheet aspect 6:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All8 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell.  Twelve-frame TRIBULATION brace reaction:1 standingguard;2 tense;3 gauntletsrise;4 armscrossinfrontofchest;5 bracewithshallowkneeflex;6 lowerheadbehindcrossedgauntlets;7 deepbrace;8 hold;9 rise;10 lowergauntlets;11 returnguard;12 exactfirst. No lightning or effects. Keep full-size anatomy, sleeves drawn naturally, feetplanted. Pure flat opaque #FF00FF background. Remove all guides, arrows, dots, ticks, text and borders. No ground shadow, blur, afterimages, effects or scenery. Every complete figure fits entirely inside its own cell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/tribulation.template.png"
  ],
  "selectedOutput": "sheets/tribulation.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:05:21 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-aef1d096-e4d0-4e72-abde-0d6b485cfb3a.png",
  "originalBackup": "raw/originals/tribulation.attempt1.png"
}

```

### walk.attempt1.generation.json

```json

{
  "clip": "walk",
  "dir": "S",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:45:23 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame WALK SOUTH-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY SIX equal SQUARE columns by TWO rows, 12 full-body frames, row-major left-to-right top-to-bottom, sheet aspect6:2. In every cell face SOUTH / directly toward VIEWER and screen DOWN, straight FRONT in the same slightly overhead orthographic isometric FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y22, planted boot soles y232, standing figure height210 units (allowed204..216), pelvis axis x127.55. All12 identical anatomical scale and head size. Do not shrink figure to center; use82% cellheight and keep whole figure in owncell. TWELVE-frame WALK IN PLACE toward viewer/screenDOWN, two clear alternating steps. Anatomical RIGHT leg is SCREEN-LEFT, LEFT is SCREEN-RIGHT. Toprow1..6 R boot advances toward viewer, loads, passes, toeoff, up, precontact; bottomrow7..12 L boot advances toward viewer and repeats. Cell7 OPPOSITE leg to cell1. R/near gauntlet swings BACK when R foot forward, FORWARD secondhalf; L arm opposite. Preserve same full-size body/head and210unit overall standing height, slight knee flex only. Both feet separate; front-foot sole slightly lower according isometric depth but do not step sideways or turn body. Ghost colors mark timing; keep front-facing camera exactly master, not E/SE profile. Smooth12-to1 loop. Exact S masterview with symmetrical broad chest, TWO front tabard flaps/cloudtrim, central sash knot/two tails. Never show side-profile/back or mirrored asymmetric costume. Pure flat opaque#FF00FF background, remove all guides/borders/ghosts/ticks/labels/text, no floor/shadow/effects/blur/props. Entire figure in owncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/S.master4x.png",
    "templates/walk.template.png"
  ],
  "selectedOutput": "sheets/walk.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:46:49 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-ec366189-1b5e-47cd-bc22-28074b9b58ce.png",
  "originalBackup": "raw/originals/walk.attempt1.png"
}

```

<!-- THE-TU-SPRITES-S:END -->
