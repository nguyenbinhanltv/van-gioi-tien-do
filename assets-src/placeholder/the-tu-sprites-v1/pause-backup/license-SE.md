<!-- THE-TU-SPRITES-SE:START -->

## Thể tu SE — sprite sheet từng frame (D41)

Ảnh gốc giữ đầy đủ prompt/tool/model/CLI/UTC và image ID trong metadata. Không tạo lại mốc UTC chưa đo được; timestamp tệp gốc và thời điểm quan sát kết thúc được ghi riêng. UTC trong bảng dưới là lúc lập inventory, không phải lần sinh ảnh mới. Attribution chưa xác minh; không tuyên bố CC0/MIT cho ảnh. Mọi tệp là placeholder, phát hành `no`.

| Tệp / glob | Nguồn | UTC | Công cụ / mô hình | Chủ art tạm | Trạng thái | Phát hành? |
| --- | --- | --- | --- | --- | --- | --- |
| THES-SE-GEN: `assets-src/placeholder/the-tu-sprites-v1/SE/raw/*` | Original image_gen outputs, adjacent full prompt/UTC/image-ID records; deterministic recovery repair proof | 2026-11-06T20:09:45.661Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-SE-SHEET: `assets-src/placeholder/the-tu-sprites-v1/SE/sheets/*; assets-src/placeholder/the-tu-sprites-v1/SE/templates/*` | THES-SE-GEN; public @vgtd/sprite template and cell-local repair; frozen character calibration | 2026-11-06T20:09:45.661Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-SE-QA: `assets-src/placeholder/the-tu-sprites-v1/SE/*.json; assets-src/placeholder/the-tu-sprites-v1/SE/quality-backlog.md; assets-src/placeholder/the-tu-sprites-v1/SE/export/*; assets-src/placeholder/the-tu-sprites-v1/batch-SE.json` | THES-SE-SHEET; project clip-table timing, calibration, quality backlog and sprite export contract | 2026-11-06T20:09:45.661Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-SE-RUNTIME: `apps/client-cocos/assets/resources/dragonbones/the-tu-sprites/thetu_SE_*; apps/client-cocos/assets/resources/dragonbones/the-tu-sprites.meta` | THES-SE-SHEET; @vgtd/sprite PMA atlas and DragonBones display-swap exporter, Cocos Creator metadata | 2026-11-06T20:09:45.661Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-SE-REF: `assets-src/placeholder/the-tu-continuous-v1/reference/SE.master4x.png` | Preserved The tu master from PR #113; see upstream concept/master provenance in the same license log | 2026-11-06T20:09:45.661Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |

### attack.attempt1.generation.json

```json

{
  "clip": "attack",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:57:44 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect2:1. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame RIGHT straight punch toward facing SE/down-right.1 low guard;2 chamber right near fist at ribs/left guards;3 torso windup;4 right gauntlet extends in foreshortened punch DOWN-RIGHT toward viewer;5 hit hold;6 retract;7 unwind;8 originalguard. Natural shoulder/elbow articulation with full-sized sleeves, stable boots shallow lunge, no body shrinking. Opposite gauntlet guards chest. Whole extendedfist stays within owncell, no extraarms. Exact masterSE costume/face/camera, bothfronttabard sides, sashfrontknot2tails. No E side-profile/frontS/back view. Pose can fold/raisehands naturally WITHOUT changing anatomical scale. Pure flat opaque#FF00FF, removeallguides/borders/ticks/text; no floor/shadows/VFX/blur. All8 completefigures inowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/attack.template.png"
  ],
  "selectedOutput": "sheets/attack.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:59:43 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-8ebb1951-f182-40da-9eac-4f3da1a3564f.png",
  "originalBackup": "raw/originals/attack.attempt1.png"
}

```

### attack_2.attempt1.generation.json

```json

{
  "clip": "attack_2",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:57:44 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK_2 SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect2:1. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame LEFT open-palm strike toward SE/down-right.1 low guard;2 both gauntlets chestguard;3 left far palm opens/chambers;4 left open bronze-gauntleted palm extends toward viewer/down-right with clearforeshortening;5 hit hold;6 retract;7 lowerarms;8 guard. Near right fist guards chest, no palm/fist side swap. Same bronze plates, fingers open only in leftpalm, no extra limbs or detachedarmor. Shallow planted weighttransfer, samehead/torso/limb sizes. Exact masterSE costume/face/camera, bothfronttabard sides, sashfrontknot2tails. No E side-profile/frontS/back view. Pose can fold/raisehands naturally WITHOUT changing anatomical scale. Pure flat opaque#FF00FF, removeallguides/borders/ticks/text; no floor/shadows/VFX/blur. All8 completefigures inowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/attack_2.template.png"
  ],
  "selectedOutput": "sheets/attack_2.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:59:43 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-7ae6597e-9b12-4bb4-83c1-47fe769ef288.png",
  "originalBackup": "raw/originals/attack_2.attempt1.png"
}

```

### attack_3.attempt1.generation.json

```json

{
  "clip": "attack_3",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:57:44 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame ATTACK_3 SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect2:1. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame DOUBLE-FIST GROUND SLAM toward SE/down-right.1 standingguard;2 both bronze fists rise besidehead;3 bothfists abovebun, knees soften;4 fists descend with torso bending;5 both worn bronze fists strike ground beforeboots in deep natural squat;6 hold groundcontact;7 rise recovering;8 same standingguard. Same anatomical scale, full-size legs fold rather than shrink. Keep whole fists/body in owncell; no enlarged hands. No impact/dust/cracks/effects/groundline. Exact masterSE costume/face/camera, bothfronttabard sides, sashfrontknot2tails. No E side-profile/frontS/back view. Pose can fold/raisehands naturally WITHOUT changing anatomical scale. Pure flat opaque#FF00FF, removeallguides/borders/ticks/text; no floor/shadows/VFX/blur. All8 completefigures inowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/attack_3.template.png"
  ],
  "selectedOutput": "sheets/attack_3.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:59:43 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-0100be42-cd3a-4321-89d8-0abf902ecf52.png",
  "originalBackup": "raw/originals/attack_3.attempt1.png"
}

```

### cast.attempt1.generation.json

```json

{
  "clip": "cast",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:57:44 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame CAST SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect2:1. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame standing earth palm CAST towardSE/down-right.1 guard;2 open gauntleted palms gather atabdomen;3 palms risetochest;4 gather breath;5 bothopen palms push/release forwardtowardviewer/down-right;6 holdrelease;7 retract/lower;8 originalguard. Feet planted, same217unit stature excepttiny naturallean; fingers within bronze gauntlets, onehandperarm. No magic/light/particles/rocks/seal glyphs or additionalprops. Exact masterSE costume/face/camera, bothfronttabard sides, sashfrontknot2tails. No E side-profile/frontS/back view. Pose can fold/raisehands naturally WITHOUT changing anatomical scale. Pure flat opaque#FF00FF, removeallguides/borders/ticks/text; no floor/shadows/VFX/blur. All8 completefigures inowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/cast.template.png"
  ],
  "selectedOutput": "sheets/cast.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:59:44 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-829f3937-0fde-4086-aaf8-6b64c8ed31a5.png",
  "originalBackup": "raw/originals/cast.attempt1.png"
}

```

### channel.attempt1.generation.json

```json

{
  "clip": "channel",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:10:13 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame CHANNEL SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame CHANNEL loop standing toward SE/down-right. Both open bronze-gauntleted palms forward atchestheight in foreshortening, feetplanted.1-4 slow inhale/tiny palmpress,5-8 exhale/return. Full217unit stature/headsize, no squat; last-tofirst smooth. Exact fronttabard knot/twotails, fingerswithinwornplates, no glyphs/glow/rocks/particles. Pose canfold/tilt without changing anatomy or scale. Exact masterSE face/outfit/camera. Pure flatopaque#FF00FF, removeallguides/borders/text/ticks/ghosts; no floor/shadows/VFX/blur/props. Onecompletefigureeachcell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/channel.template.png"
  ],
  "selectedOutput": "sheets/channel.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:11:50 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-04b89854-f7d4-4707-abe8-c4468f4f0fd0.png",
  "originalBackup": "raw/originals/channel.attempt1.png"
}

```

### dash.attempt1.generation.json

```json

{
  "clip": "dash",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:14:20 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame DASH SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY THREE equal SQUARE columns by TWO rows, 6 full-body frames, row-major left-to-right top-to-bottom, sheet aspect3:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All6 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. SIX-frame DASH toward SE/down-right.1 guard;2 shallow crouched anticipation;3 rearboot drivesbodyforward, gauntlets chestguard;4 brief low forward flight with one leg extended, no tuckedball;5 frontbootlands;6 originalguard. Samefull-size anatomy andhead, natural clothknees/elbows. No blur/speedlines/dust/afterimages. Entirefigure staysincell. ExactmasterSEcamera/costume/identity, notEprofile/Sfront/back. Posecanbend withoutanatomyscalechange. Pure flatopaque#FF00FFbackground; removeallguides/borders/ticks/text/ghosts, no floor/shadows/blur/effects. Onecompletefigureeachowncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "raw/dash.attempt1.template.png"
  ],
  "selectedOutput": "sheets/dash.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:15:22 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-3e2cb15f-9072-4883-a69b-6e89ccb53144.png",
  "layoutNote": "Generation followed requested3x2 layout, not initial4-column reference template. Slicer manifest corrected to actual3x2; no resampling or frame drop.",
  "originalBackup": "raw/originals/dash.attempt1.png"
}

```

### die.attempt1.generation.json

```json

{
  "clip": "die",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:10:13 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame DIE SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame DEATH collapse SE/down-right.1 standingguard;2 chestclutch/stagger;3 kneesbuckle;4 dropsknees/supportswithonegauntlet;5 sinksonto side;6 liesdown naturally;7 settlescloth/eyesclosed;8 samefinallyinghold. Full-sized head/limbs/gauntlets fold androtate, NEVER scale tofit. Allbodyparts inowncell, no blood/gore/weapon/ground/shadows/effects. Pose canfold/tilt without changing anatomy or scale. Exact masterSE face/outfit/camera. Pure flatopaque#FF00FF, removeallguides/borders/text/ticks/ghosts; no floor/shadows/VFX/blur/props. Onecompletefigureeachcell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/die.template.png"
  ],
  "selectedOutput": "sheets/die.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:11:50 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-6bad5d79-805b-42af-bb56-6bc608e8e82d.png",
  "originalBackup": "raw/originals/die.attempt1.png"
}

```

### emote.attempt1.generation.json

```json

{
  "clip": "emote",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:14:20 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame EMOTE SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame fist-and-palm MARTIAL SALUTE.1 neutralSEguard;2 rightgauntletedfisthigher;3 leftopenpalmrises;4 leftpalmcoversrightfistat chest;5 respectfulsmallheadbow;6 headraises;7 handsseparate/lower;8 identicalinitialguard. Feetplanted, upright217unitstature andsameheadsize, no deepbow/squat. Bronzeplatesstayworn, no extrahands. No text/symbols/speech/effects/props. ExactmasterSEcamera/costume/identity, notEprofile/Sfront/back. Posecanbend withoutanatomyscalechange. Pure flatopaque#FF00FFbackground; removeallguides/borders/ticks/text/ghosts, no floor/shadows/blur/effects. Onecompletefigureeachowncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/emote.template.png"
  ],
  "selectedOutput": "sheets/emote.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:16:14 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-44bf0a5e-82e5-47fd-acf0-ef5240375cc2.png",
  "originalBackup": "raw/originals/emote.attempt1.png"
}

```

### hit.attempt1.generation.json

```json

{
  "clip": "hit",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:10:13 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame HIT SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by ONE rows, 4 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:1. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All4 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. FOUR-frame HIT reaction SE/down-right.1 normalguard;2 torso recoils backwards with bothgauntlets defensive, eyesstrained;3 knees soften/shouldersrecover;4 originalguard. Same adultanatomy/headsize, shallow recoil notshrinking, no turningE orS, no impacteffects/enemy or extraarms. Pose canfold/tilt without changing anatomy or scale. Exact masterSE face/outfit/camera. Pure flatopaque#FF00FF, removeallguides/borders/text/ticks/ghosts; no floor/shadows/VFX/blur/props. Onecompletefigureeachcell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/hit.template.png"
  ],
  "selectedOutput": "sheets/hit.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:11:50 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-56f8ec77-6dfe-4e57-8933-d2557c2f3c7a.png",
  "originalBackup": "raw/originals/hit.attempt1.png"
}

```

### idle.attempt1.generation.json

```json

{
  "clip": "idle",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:39:02 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame IDLE SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame IDLE breathing loop. Both boots planted unchanged; gauntlets low relaxed as master. Cells1-2 inhale starts,3-4 chest tiny expansion,5-6 exhale,7-8 settle into first guard. Maximum2unit head bob, no squat, no large arm gesture. Same broad torso and stout legs. Loop last-to-first smoothly. EXACT masterSE view: both sides of chest/tabard visible, front sash knot/two tails, master face angle. Never revert to E side-profile or S front view. Pure flat opaque#FF00FF background; REMOVE all guides/borders/ticks/ghosts/text. No floor/shadows/effects/blur/props. Whole figure inside each own squarecell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/idle.template.png"
  ],
  "selectedOutput": "sheets/idle.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:40:35 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-5c1c6431-42f0-4d70-83c8-7a0b3ef091d8.png",
  "originalBackup": "raw/originals/idle.attempt1.png"
}

```

### meditate.attempt1.generation.json

```json

{
  "clip": "meditate",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:10:13 UTC",
  "prompt": "Production 8-frame seated meditation sprite sheet, FOUR equal SQUARE columns x TWO rows, aspect2:1, each cell256units. First image is EXACT Thể tu A Sơn Môn Hộ Vệ identity/anatomy/style reference, second image is seated-pose framing template. Critical: do NOT enlarge seated character to fill a standing-height cell. Keep EXACT SAME head, torso, arm, gauntlet and thigh anatomical sizes as standing master. Standing master is217units tall. Because legs fold cross-legged, seated figure should be only about150-158units tall: top of bun around y78..82, seat/boot base y232. Leave BIG EMPTY MAGENTA AREA above seated head. Head bun-to-chin about44units, not80; head and shoulders same dimensions as standing master. Seated body width roughly100units, centered x128. Show same adult STOCKY earth tank male facing diagonally DOWN-RIGHT, THREE-QUARTER FRONT, slight overhead isometric three-quarter FRONT view, eyes closed, straight upright back, full-size legs folded cross-legged, bronze stone-block gauntleted hands resting relaxed on knees. Same short darkbrown topbun/jadehairpin, ivory crosscollar robe/sleeves/loose trousers#E9EEF0, short mountain-blue tabard#5E8798 with bronze cloud trim#B58A4A, darkblue sash#294451 knot/two tails, darkboots folded beneath. Bronze gauntlets with square meander emblem and ochre highlights, not removed or enlarged. Preserve fine ink outlines, restrained painterly celshading and NW light. Cells1-2 calm exhale,3-4 tiny inhale chest expansion,5-6 tiny exhale,7-8 return exact first pose. Stable breathing loop, same head/torso size across all8. No chibi/squashing, no inflated head or shoulder. Pure opaque flat#FF00FF background. Remove all template lines/borders/ticks, no text/labels/numbers, shadows/floor/mat/stool/aura/rocks/glow/effects/props. One complete seated figure per cell. EXACT SE master camera; do not revert E side-profile or frontalS.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/meditate.template.png"
  ],
  "selectedOutput": "sheets/meditate.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:11:50 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-75ebb7af-6609-4901-9016-0418965bb4e5.png",
  "originalBackup": "raw/originals/meditate.attempt1.png"
}

```

### run.attempt1.generation.json

```json

{
  "clip": "run",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:39:02 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame RUN SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY SIX equal SQUARE columns by TWO rows, 12 full-body frames, row-major left-to-right top-to-bottom, sheet aspect6:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All12 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TWELVE-frame RUN in place, heavy earth-tank short-stride jog, modest forward lean. Toprow1..6 near/right heel contact, load, passing, toeoff, brief flight/up, precontact. Bottomrow7..12 far/left leads the opposing step. Frame7 MUST reverse leglead and near-gauntlet swing comparedwith1. Both arms counter-swing with bronze fists held balanced, not a boxing punch. Follow colored boot ghosts, cyanR amberL, aligned with SE down-right travel. Full-length limbs bend naturally under trousers/sleeves; no elastic baggy mesh shapes, no giant knees or stuntedlegs. Keep same217unit full-body measured height (211..223) and head size in everyframe, no deep crouch. Seamless12-to1 loop. EXACT masterSE view: both sides of chest/tabard visible, front sash knot/two tails, master face angle. Never revert to E side-profile or S front view. Pure flat opaque#FF00FF background; REMOVE all guides/borders/ticks/ghosts/text. No floor/shadows/effects/blur/props. Whole figure inside each own squarecell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/run.template.png"
  ],
  "selectedOutput": "sheets/run.png",
  "status": "source retained; selected sheet contains documented3-cell repair; upright hard QA PASS",
  "utcEndObserved": "2026-11-06 17:40:03 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-444e3734-4ba1-46a2-b6b4-19286ee03d6d.png",
  "rawOutput": "raw/run.attempt1.png",
  "repairProof": "raw/run.attempt2.repair-proof.json",
  "originalBackup": "raw/originals/run.attempt1.png"
}

```

### run.attempt2.generation.json

```json

{
  "clip": "run",
  "dir": "SE",
  "attempt": 2,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:48:28 UTC",
  "prompt": "CELL-LOCAL REPAIR of the supplied SE RUN sprite sheet. Input1 exact Thá»ƒ tuSE master anatomy/style; input2 EDIT TARGET original12-frame RUN sheet; input3 template. Preserve EXACT6columns2rows, readingorder, canvasaspect3:1 and all12 full figures. ONLY FIX cells5,10,11 (1-based; 0-based indices4,9,10). They are the tucked-up/bunnyhop figures, too short. Redraw natural leg extension and slightly straighter running posture in those3 cells, WITHOUT scaling/resizing the figure or enlarging the head/torso/gauntlets. Match SAME full-body bun-to-lowestboot height and anatomical size as neighboring cells1,2,7,8 in input2. Keep upperbody/head dimensions unchanged; extend one full-length leg down/back rather than folding bothknees up. Lowest boot/bun bounds should match the normal run cells, not float as a compact ball. A shallow run flight pose can have one leg nearlyextended belowbody, other knee slightly forward; keep energy, do not replacewithidle. Both arms still counter-swing and gauntlets stay worn. Keep exact SE three-quarter FRONT facing diagonally DOWN-RIGHT and same face/hairbun/jadepin, ivory robe/trousers, mountainblue short tabard/bronzecloudtrim, darkblue sash2tails, darkboots, pairedbronze blockgauntlets/meander. Fine ink outline,painterlyNW light. NO elastic sleeve/trouser distortion, no extra limbs. The other9 cells MUST remain exactly unchanged, including their positions/scale/colors/poses. In everycell same master proportions. Fix anatomy by drawing legs, NEVER normalize heights/scale individual cells. Keep pure flat opaque#FF00FF background; no guides/borders/text, no shadow/floor/effects/blur. Allcontent stays inowncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "raw/run.attempt1.png",
    "templates/run.template.png"
  ],
  "rawOutput": "raw/run.attempt2.edited.png",
  "repairCells": [
    4,
    9,
    10
  ],
  "status": "source retained; selected sheet contains documented3-cell repair; upright hard QA PASS",
  "utcEndObserved": "2026-11-06 17:48:56 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-3f488f6e-1be4-48d3-acdd-9bfc80ac2414.png",
  "selectedOutput": "sheets/run.png",
  "repairProof": "raw/run.attempt2.repair-proof.json",
  "originalBackup": "raw/originals/run.attempt2.png"
}

```

### sword_fly.attempt1.generation.json

```json

{
  "clip": "sword_fly",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:14:20 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame SWORD_FLY SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY FOUR equal SQUARE columns by TWO rows, 8 full-body frames, row-major left-to-right top-to-bottom, sheet aspect4:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All8 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. EIGHT-frame airborne travel idle loop, legacyname sword_fly but ABSOLUTELY NO SWORD/WEAPON/BOARD/CLOUD/ROCK/PROP. UprightSE-facing earthtank floats, bootsrelaxedbeneathbody, bothbronze gauntlets nearabdomen.1-4 tinyinhale/sashsway,5-8 exhale/return. Same217unit anatomicalstature, bodydoesnotshrink orjump; sameposition runtimehandlestravel. No aura/glow/effects/shadow. ExactmasterSEcamera/costume/identity, notEprofile/Sfront/back. Posecanbend withoutanatomyscalechange. Pure flatopaque#FF00FFbackground; removeallguides/borders/ticks/text/ghosts, no floor/shadows/blur/effects. Onecompletefigureeachowncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/sword_fly.template.png"
  ],
  "selectedOutput": "sheets/sword_fly.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:14:48 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-22938860-3c94-4191-8496-f24bb600297a.png",
  "originalBackup": "raw/originals/sword_fly.attempt1.png"
}

```

### tribulation.attempt1.generation.json

```json

{
  "clip": "tribulation",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 18:14:20 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame TRIBULATION SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY SIX equal SQUARE columns by TWO rows, 12 full-body frames, row-major left-to-right top-to-bottom, sheet aspect6:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All12 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TWELVE-frame TRIBULATION enduranceSE/down-right.1 calmguard;2 tense;3 bothgauntlets rise;4 crossforearms defensiveblock upperchest;5 headbowsunderinvisibleforce;6 kneesbendshallowwhilegauntletsbraceface;7 holdbrace;8 beginunwind;9 straighten;10 lowerarms;11 settle;12 originalguard. Full-sizedhead/limbs/costume retainmaster217standinganatomy; naturalposebendonly, no shrinking. Keep both wornbronze gauntlets, no lightning/sky/aura/electricity/rocks/particles/effects. ExactmasterSEcamera/costume/identity, notEprofile/Sfront/back. Posecanbend withoutanatomyscalechange. Pure flatopaque#FF00FFbackground; removeallguides/borders/ticks/text/ghosts, no floor/shadows/blur/effects. Onecompletefigureeachowncell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/tribulation.template.png"
  ],
  "selectedOutput": "sheets/tribulation.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 18:15:48 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-7835f701-e6a9-498d-a731-61315e9d9b54.png",
  "originalBackup": "raw/originals/tribulation.attempt1.png"
}

```

### walk.attempt1.generation.json

```json

{
  "clip": "walk",
  "dir": "SE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 17:39:02 UTC",
  "prompt": "Use-case: stylized-concept. Production frame-by-frame WALK SE-DIRECTION sprite sheet for Van Gioi Tien Do, THE TU A Son Mon Ho Ve earth tank. Image1 is the EXACT character identity and style master; image2 is exact layout template. EXACTLY SIX equal SQUARE columns by TWO rows, 12 full-body frames, row-major left-to-right top-to-bottom, sheet aspect6:2. In every cell face SOUTHEAST / diagonally DOWN-RIGHT, three-quarter FRONT in the same slightly overhead orthographic isometric three-quarter FRONT view. Preserve compact STOCKY adult male proportions, broad chest, stout full-length legs, same face, short dark brown hair/topbun/jade hairpin, ivory cross-collar inner robe and loose sleeves/trousers #E9EEF0, mountain-blue short split sleeveless tabard #5E8798 with bronze cloud trim #B58A4A, dark-blue #294451 sash band/knot/TWO tails, dark boots, paired large BRONZE stone-block EARTH GAUNTLETS worn on BOTH hands with square meander emblem, ochre highlights #E3C07F and brown bronze shadows #5B4222. NO sword, shield, weapons, long hair or extra armor. Match master fine ink contours, clean soft 2-3 tone painterly cel shading, NW upper-left light. Anatomy and cloth redrawn naturally per pose, no rubber-like bent baggy sleeves or trousers. FRAMING HARD: each cell256 units; bun top y15, planted boot soles y232, standing figure height217 units (allowed211..223), pelvis axis x125.68. All12 identical anatomical scale and head size. Do not shrink figure to center; use85% cellheight and keep whole figure in owncell. TWELVE-frame WALK in place, two complete steps. Toprow1..6 RIGHT anatomical leg (near/screen-left in this3/4 front view) heel contact ahead along down-right facing, weight/load, passing, toeoff, swing-up, precontact. Bottomrow7..12 LEFT leg takes the same sequence; cell7 MUST show OPPOSITE leg leading vs cell1, near gauntlet swing also opposite. Arms swing against legs; preserve worn bronze gauntlets. CyanR/amberL ghosts show foot timing; interpret motion along facing down-right, not lateral side stepping. Near boot consistently brighter, far boot shaded, distinct feet. Upright stature217units in everyframe, no shrinking/squat, natural trouser folds. EXACT masterSE view: both sides of chest/tabard visible, front sash knot/two tails, master face angle. Never revert to E side-profile or S front view. Pure flat opaque#FF00FF background; REMOVE all guides/borders/ticks/ghosts/text. No floor/shadows/effects/blur/props. Whole figure inside each own squarecell.",
  "references": [
    "../../the-tu-continuous-v1/reference/SE.master4x.png",
    "templates/walk.template.png"
  ],
  "selectedOutput": "sheets/walk.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 17:40:35 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-47941d65-d708-4665-8ef9-47427de52208.png",
  "originalBackup": "raw/originals/walk.attempt1.png"
}

```

<!-- THE-TU-SPRITES-SE:END -->
